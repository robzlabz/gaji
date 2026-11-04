import "server-only";

import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, payRateHistory, timeEntries, workTasks } from "@/db/schema";
import { toNumber } from "@/lib/format";
import { workedMinutes } from "@/lib/payroll";
import { rateAtDate } from "@/lib/saldo";
import {
  addMonthsIso,
  averageMonthlyWageFromPayments,
  computeThr,
  fullMonthsBetween,
  THR_FULL_MONTHS,
  type PaymentRow,
  type ThrResult,
  type ThrWageSource,
} from "@/lib/thr";
import { computeSeverance, type SeveranceResult } from "@/lib/severance";

/**
 * Lapisan data untuk pratinjau THR & pesangon.
 *
 * Perhitungannya sendiri ada di `lib/thr.ts` dan `lib/severance.ts` (murni). Modul ini
 * hanya menyiapkan **dasar upah** yang benar untuk setiap tipe gaji:
 * - `monthly` → `employees.pay_rate` (upah sebulan).
 * - `hourly` / `daily` / `per_task` → rata-rata upah 12 bulan terakhir dari absensi dan
 *   tugas yang sudah approved (Permenaker 6/2016 Pasal 3 ayat (2)).
 *
 * Ongkos kedatangan (`transport_amount`) sengaja **tidak** ikut: itu penggantian biaya,
 * bukan upah. Lembur ikut karena dibayarkan sebagai upah.
 */

export type EmployeeLite = {
  id: string;
  fullName: string;
  code: string | null;
  payType: string;
  payRate: string;
  joinedAt: string;
  endedAt: string | null;
  isActive: boolean;
};

export type WageBasis = {
  /** Upah sebulan yang dipakai sebagai dasar THR/pesangon (rupiah). */
  monthlyWage: number;
  source: ThrWageSource;
  /** Jumlah bulan yang ikut dirata-rata; 0 untuk karyawan bulanan. */
  monthsAveraged: number;
  /** Ada absensi/tugas approved di jendela rata-rata? */
  hasPayments: boolean;
  /** Awal jendela 12 bulan (null untuk karyawan bulanan). */
  windowStart: string | null;
  /** Total upah yang jadi dasar rata-rata. */
  totalPaid: number;
};

const employeeColumns = {
  id: employees.id,
  fullName: employees.fullName,
  code: employees.code,
  payType: employees.payType,
  payRate: employees.payRate,
  joinedAt: employees.joinedAt,
  endedAt: employees.endedAt,
  isActive: employees.isActive,
};

/**
 * Hitung dasar upah bulanan semua karyawan untuk tanggal acuan masing-masing.
 * `references` = tanggal akhir masa kerja yang dipakai menghitung rata-rata
 * (tanggal acuan, atau tanggal berhenti bila lebih awal).
 */
export async function loadWageBasis(
  orgId: string,
  staff: EmployeeLite[],
  references: Map<string, string>,
): Promise<Map<string, WageBasis>> {
  const basis = new Map<string, WageBasis>();

  for (const employee of staff) {
    if (employee.payType !== "monthly") continue;
    basis.set(employee.id, {
      monthlyWage: Math.round(toNumber(employee.payRate)),
      source: "monthly",
      monthsAveraged: 0,
      hasPayments: true,
      windowStart: null,
      totalPaid: 0,
    });
  }

  const variable = staff.filter((employee) => employee.payType !== "monthly");
  if (variable.length === 0) return basis;

  // Jendela rata-rata per karyawan: min(12 bulan, masa kerja) sebelum tanggal acuannya.
  const windows = new Map<string, { start: string; end: string; months: number }>();
  for (const employee of variable) {
    const end = references.get(employee.id) ?? employee.joinedAt;
    const monthsWorked = fullMonthsBetween(employee.joinedAt, end);
    const months = Math.min(THR_FULL_MONTHS, Math.max(1, monthsWorked));
    windows.set(employee.id, { start: addMonthsIso(end, -months), end, months });
  }

  const ids = variable.map((employee) => employee.id);
  const windowList = [...windows.values()];
  const from = windowList.reduce((min, w) => (w.start < min ? w.start : min), windowList[0].start);
  const to = windowList.reduce((max, w) => (w.end > max ? w.end : max), windowList[0].end);

  const [entries, tasks, rateRows] = await Promise.all([
    db
      .select({
        employeeId: timeEntries.employeeId,
        workDate: timeEntries.workDate,
        clockInAt: timeEntries.clockInAt,
        clockOutAt: timeEntries.clockOutAt,
        breakMinutes: timeEntries.breakMinutes,
        overtimeMinutes: timeEntries.overtimeMinutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.status, "approved"),
          isNull(timeEntries.deletedAt),
          inArray(timeEntries.employeeId, ids),
          gte(timeEntries.workDate, from),
          lte(timeEntries.workDate, to),
        ),
      ),
    db
      .select({
        employeeId: workTasks.employeeId,
        workDate: workTasks.workDate,
        qty: workTasks.qty,
        unitRate: workTasks.unitRate,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.orgId, orgId),
          eq(workTasks.status, "approved"),
          inArray(workTasks.employeeId, ids),
          gte(workTasks.workDate, from),
          lte(workTasks.workDate, to),
        ),
      ),
    db
      .select({
        employeeId: payRateHistory.employeeId,
        kind: payRateHistory.kind,
        payRate: payRateHistory.payRate,
        effectiveFrom: payRateHistory.effectiveFrom,
      })
      .from(payRateHistory)
      .where(inArray(payRateHistory.employeeId, ids)),
  ]);

  for (const employee of variable) {
    const window = windows.get(employee.id);
    if (!window) continue;

    const history = rateRows.filter((row) => row.employeeId === employee.id);
    const payments: PaymentRow[] = [];

    const ownEntries = entries.filter(
      (entry) =>
        entry.employeeId === employee.id &&
        entry.workDate >= window.start &&
        entry.workDate <= window.end &&
        entry.clockOutAt,
    );

    if (employee.payType === "hourly") {
      // Upah per jam = menit kerja × tarif yang berlaku saat absensi (termasuk lembur).
      for (const entry of ownEntries) {
        const minutes = workedMinutes({
          id: "",
          workDate: entry.workDate,
          clockInAt: entry.clockInAt,
          clockOutAt: entry.clockOutAt,
          breakMinutes: entry.breakMinutes,
          overtimeMinutes: entry.overtimeMinutes,
        });
        if (minutes <= 0) continue;
        const rate = rateAtDate(history, entry.workDate, "wage", employee.payRate);
        payments.push({ date: entry.workDate, amount: Math.round((minutes / 60) * rate) });
      }
    } else if (employee.payType === "daily") {
      // Upah per hari = satu pembayaran per tanggal kehadiran.
      const rateByDate = new Map<string, number>();
      for (const entry of ownEntries) {
        rateByDate.set(entry.workDate, rateAtDate(history, entry.workDate, "wage", employee.payRate));
      }
      for (const [date, amount] of rateByDate) payments.push({ date, amount });
    }

    // Tugas approved menambah upah untuk semua tipe gaji (sama seperti slip payroll).
    for (const task of tasks) {
      if (task.employeeId !== employee.id) continue;
      if (task.workDate < window.start || task.workDate > window.end) continue;
      const amount = Math.round(toNumber(task.qty) * toNumber(task.unitRate));
      if (amount <= 0) continue;
      payments.push({ date: task.workDate, amount });
    }

    const average = averageMonthlyWageFromPayments({
      payments,
      joinedAt: employee.joinedAt,
      referenceDate: window.end,
    });

    basis.set(employee.id, {
      monthlyWage: average.average,
      source: "average-12m",
      monthsAveraged: average.monthsCounted,
      hasPayments: payments.length > 0,
      windowStart: average.windowStart,
      totalPaid: average.total,
    });
  }

  return basis;
}

export type ThrPreviewRow = {
  employee: EmployeeLite;
  basis: WageBasis;
  result: ThrResult;
};

export type ThrPreview = {
  referenceDate: string;
  rows: ThrPreviewRow[];
  eligibleCount: number;
  ineligibleCount: number;
  total: number;
};

/** Pratinjau THR untuk seluruh karyawan yang masih bekerja pada tanggal acuan. */
export async function previewThr(orgId: string, referenceDate: string): Promise<ThrPreview> {
  const staff = await db
    .select(employeeColumns)
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        lte(employees.joinedAt, referenceDate),
        or(isNull(employees.endedAt), gte(employees.endedAt, referenceDate)),
      ),
    )
    .orderBy(employees.fullName);

  const references = new Map(staff.map((employee) => [employee.id, referenceDate]));
  const basis = await loadWageBasis(orgId, staff, references);

  const rows: ThrPreviewRow[] = staff.map((employee) => {
    const employeeBasis: WageBasis = basis.get(employee.id) ?? {
      monthlyWage: 0,
      source: "monthly",
      monthsAveraged: 0,
      hasPayments: false,
      windowStart: null,
      totalPaid: 0,
    };
    const result = computeThr({
      joinedAt: employee.joinedAt,
      referenceDate,
      monthlyWage: employeeBasis.monthlyWage,
      wageSource: employeeBasis.source,
      monthsAveraged: employeeBasis.monthsAveraged,
    });
    return { employee, basis: employeeBasis, result };
  });

  const eligible = rows.filter((row) => row.result.eligible);
  return {
    referenceDate,
    rows,
    eligibleCount: eligible.length,
    ineligibleCount: rows.length - eligible.length,
    total: eligible.reduce((sum, row) => sum + row.result.amount, 0),
  };
}

export type SeverancePreviewRow = {
  employee: EmployeeLite;
  basis: WageBasis;
  result: SeveranceResult;
  /** Tanggal akhir masa kerja yang dipakai (tanggal acuan atau tanggal berhenti). */
  endDate: string;
  /** Karyawan sudah punya `ended_at` sebelum tanggal acuan. */
  ended: boolean;
};

export type SeverancePreview = {
  referenceDate: string;
  rows: SeverancePreviewRow[];
  eligibleCount: number;
  ineligibleCount: number;
  total: number;
};

/**
 * Pratinjau pesangon untuk seluruh karyawan yang masa kerjanya sudah dimulai.
 * Karyawan yang sudah berhenti (punya `ended_at`) dihitung sampai tanggal berhentinya.
 */
export async function previewSeverance(
  orgId: string,
  referenceDate: string,
): Promise<SeverancePreview> {
  const staff = await db
    .select(employeeColumns)
    .from(employees)
    .where(and(eq(employees.orgId, orgId), lte(employees.joinedAt, referenceDate)))
    .orderBy(employees.fullName);

  const endDates = new Map(
    staff.map((employee) => [
      employee.id,
      employee.endedAt && employee.endedAt < referenceDate ? employee.endedAt : referenceDate,
    ]),
  );

  const basis = await loadWageBasis(orgId, staff, endDates);

  const rows: SeverancePreviewRow[] = staff.map((employee) => {
    const employeeBasis: WageBasis = basis.get(employee.id) ?? {
      monthlyWage: 0,
      source: "monthly",
      monthsAveraged: 0,
      hasPayments: false,
      windowStart: null,
      totalPaid: 0,
    };
    const endDate = endDates.get(employee.id) ?? referenceDate;
    const result = computeSeverance({
      joinedAt: employee.joinedAt,
      referenceDate: endDate,
      monthlyWage: employeeBasis.monthlyWage,
    });
    return {
      employee,
      basis: employeeBasis,
      result,
      endDate,
      ended: Boolean(employee.endedAt && employee.endedAt < referenceDate),
    };
  });

  const eligible = rows.filter((row) => row.result.eligible);
  return {
    referenceDate,
    rows,
    eligibleCount: eligible.length,
    ineligibleCount: rows.length - eligible.length,
    total: eligible.reduce((sum, row) => sum + row.result.total, 0),
  };
}
