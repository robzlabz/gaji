import "server-only";

import { and, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notExists, or } from "drizzle-orm";
import { db } from "@/db";
import {
  cashAdvancePlans,
  cashAdvances,
  employees,
  leaves,
  payPeriods,
  payRateHistory,
  payslipItems,
  payslips,
  timeEntries,
  wageFloats,
  wageFloatTxns,
  workTasks,
} from "@/db/schema";
import { computePayslip, type PayslipComputation } from "@/lib/payroll";
import { advanceLabel, isAdvanceEligible, resolveAdvanceDeduction } from "@/lib/kasbon";
import { balanceBefore, coverageForPeriod, periodLedgerSummary, rateAtDate } from "@/lib/saldo";
import type { Period } from "@/lib/period";
import { toNumber } from "@/lib/format";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = Tx | typeof db;

export type AdvanceSummary = {
  /** Total yang akan dipotong dari slip periode ini. */
  deductTotal: number;
  /** Jumlah kasbon yang ditunda karyawan/admin. */
  deferredCount: number;
  /** Sisa saldo kasbon yang ditunda. */
  deferredTotal: number;
  /** Jumlah kasbon aktif (approved & bersaldo). */
  activeCount: number;
};

export type PayrollRow = {
  employee: typeof employees.$inferSelect;
  computation: PayslipComputation;
  advanceSummary: AdvanceSummary;
  /** Bagian upah periode ini yang sudah dibayar lewat saldo prabayar. */
  saldo: SaldoPeriodSummary;
};

export type SaldoPeriodSummary = {
  /** Ada/tidak baris saldo milik karyawan ini. */
  active: boolean;
  balanceStart: number;
  fundingInPeriod: number;
  accrualTotal: number;
  /** Upah yang ditutup saldo (dikurangkan dari tunai). */
  covered: number;
  /** Kekurangan bayar yang harus diserahkan tunai saat finalisasi. */
  shortfall: number;
};

export type PayrollPreview = {
  rows: PayrollRow[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
};

const EMPTY_SUMMARY: AdvanceSummary = {
  deductTotal: 0,
  deferredCount: 0,
  deferredTotal: 0,
  activeCount: 0,
};

/** Hitung ulang payroll dari data mentah (approved) untuk sebuah periode. */
export async function previewPayroll(
  orgId: string,
  period: Period,
  settings: { overtimeMultiplier: number },
  conn: Conn = db,
): Promise<PayrollPreview> {
  // Masa kerja beririsan dengan periode: batas `endedAt` berlaku untuk semua karyawan,
  // termasuk yang masih ditandai aktif (berhenti 30 Sep tidak dibayar untuk Oktober).
  // Karyawan aktif dipilih lewat `inEmploymentRange`; karyawan nonaktif tetap ikut bila
  // tanggal berhentinya beririsan dengan periode (mis. berhenti 16 Okt — karyawan bulanan
  // tetap dibayar 1–16 Okt meski tanpa absensi) atau masih punya absensi/tugas approved
  // atau kasbon aktif pada periode itu, supaya upah dan potongan kasbonnya tidak hilang.
  const inEmploymentRange = and(
    or(isNull(employees.joinedAt), lte(employees.joinedAt, period.end)),
    or(isNull(employees.endedAt), gte(employees.endedAt, period.start)),
  );

  // Tugas lama yang belum pernah masuk slip periode lain: dibayar pada periode ini
  // sebagai bawaan (lihat `carriedTasks`). Dipakai juga untuk mendeteksi aktivitas.
  const carriedTaskCondition = and(
    lt(workTasks.workDate, period.start),
    notExists(
      conn
        .select({ id: payslipItems.id })
        .from(payslipItems)
        .innerJoin(payslips, eq(payslipItems.payslipId, payslips.id))
        .innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
        .where(
          and(
            eq(payslipItems.sourceTable, "work_tasks"),
            eq(payslipItems.sourceId, workTasks.id),
            ne(payPeriods.status, "void"),
            ne(payPeriods.periodStart, period.start),
          ),
        ),
    ),
  );

  const hasPeriodActivity = or(
    exists(
      conn
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.orgId, orgId),
            eq(timeEntries.employeeId, employees.id),
            eq(timeEntries.status, "approved"),
            isNull(timeEntries.deletedAt),
            gte(timeEntries.workDate, period.start),
            lte(timeEntries.workDate, period.end),
          ),
        ),
    ),
    exists(
      conn
        .select({ id: workTasks.id })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.orgId, orgId),
            eq(workTasks.employeeId, employees.id),
            eq(workTasks.status, "approved"),
            // Sama dengan tugas yang dimuat untuk slip: dalam periode ini, atau
            // tugas lama yang belum pernah dibayar (lihat `carriedTasks`).
            or(
              and(gte(workTasks.workDate, period.start), lte(workTasks.workDate, period.end)),
              carriedTaskCondition,
            ),
          ),
        ),
    ),
    exists(
      conn
        .select({ id: cashAdvances.id })
        .from(cashAdvances)
        .where(
          and(
            eq(cashAdvances.orgId, orgId),
            eq(cashAdvances.employeeId, employees.id),
            eq(cashAdvances.status, "approved"),
            gt(cashAdvances.balance, "0"),
            lte(cashAdvances.requestedAt, period.end),
          ),
        ),
    ),
  );

  const staff = await conn
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        or(
          and(eq(employees.isActive, true), inEmploymentRange),
          and(
            eq(employees.isActive, false),
            or(and(isNotNull(employees.endedAt), inEmploymentRange), hasPeriodActivity),
          ),
        ),
      ),
    );

  const employeeIds = staff.map((e) => e.id);

  if (employeeIds.length === 0) {
    return { rows: [], totalGross: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0 };
  }

  const entries = await conn
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.orgId, orgId),
        eq(timeEntries.status, "approved"),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
      ),
    );

  const tasks = await conn
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.orgId, orgId),
        eq(workTasks.status, "approved"),
        gte(workTasks.workDate, period.start),
        lte(workTasks.workDate, period.end),
      ),
    );

  // Tugas dari periode lama yang baru disetujui setelah payroll periode itu difinalkan:
  // belum pernah masuk slip mana pun (selain periode yang sedang dihitung — slip lama
  // periode ini masih ada saat recalculate) sehingga dibayar sekarang sebagai bawaan.
  const carriedTasks = await conn
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.orgId, orgId),
        eq(workTasks.status, "approved"),
        carriedTaskCondition,
      ),
    );

  const advances = await conn
    .select()
    .from(cashAdvances)
    .where(
      and(
        eq(cashAdvances.orgId, orgId),
        eq(cashAdvances.status, "approved"),
        inArray(cashAdvances.employeeId, employeeIds),
      ),
    );

  // Cuti approved yang menyentuh periode ini; hanya dipakai untuk karyawan bulanan.
  const leaveRows = await conn
    .select()
    .from(leaves)
    .where(
      and(
        eq(leaves.orgId, orgId),
        eq(leaves.status, "approved"),
        lte(leaves.startDate, period.end),
        gte(leaves.endDate, period.start),
        inArray(leaves.employeeId, employeeIds),
      ),
    );

  // Keputusan karyawan/admin khusus untuk periode ini (potong sebagian / tunda).
  const plans = await conn
    .select({
      cashAdvanceId: cashAdvancePlans.cashAdvanceId,
      decision: cashAdvancePlans.decision,
      amount: cashAdvancePlans.amount,
    })
    .from(cashAdvancePlans)
    .where(and(eq(cashAdvancePlans.orgId, orgId), eq(cashAdvancePlans.periodStart, period.start)));

  const planByAdvance = new Map(plans.map((plan) => [plan.cashAdvanceId, plan]));

  // Riwayat tarif dipakai untuk "tarif saat kejadian": absensi tanggal lama tetap
  // dihitung dengan tarif yang berlaku saat itu, bukan tarif sekarang.
  const rateRows = await conn
    .select({
      employeeId: payRateHistory.employeeId,
      kind: payRateHistory.kind,
      payRate: payRateHistory.payRate,
      effectiveFrom: payRateHistory.effectiveFrom,
    })
    .from(payRateHistory)
    .where(inArray(payRateHistory.employeeId, employeeIds));

  const rateHistoryByEmployee = new Map<string, typeof rateRows>();
  for (const row of rateRows) {
    const list = rateHistoryByEmployee.get(row.employeeId) ?? [];
    list.push(row);
    rateHistoryByEmployee.set(row.employeeId, list);
  }

  // Saldo prabayar: hanya karyawan yang punya baris saldo yang upahnya dipotong saldo.
  const floats = await conn
    .select()
    .from(wageFloats)
    .where(and(eq(wageFloats.orgId, orgId), inArray(wageFloats.employeeId, employeeIds)));

  const floatByEmployee = new Map(floats.map((row) => [row.employeeId, row]));

  const saldoTxns = floats.length
    ? await conn
        .select({
          floatId: wageFloatTxns.floatId,
          kind: wageFloatTxns.kind,
          amount: wageFloatTxns.amount,
          occurredAt: wageFloatTxns.occurredAt,
        })
        .from(wageFloatTxns)
        .where(and(eq(wageFloatTxns.orgId, orgId), inArray(wageFloatTxns.floatId, floats.map((row) => row.id))))
    : [];

  const txnsByFloat = new Map<string, typeof saldoTxns>();
  for (const txn of saldoTxns) {
    const list = txnsByFloat.get(txn.floatId) ?? [];
    list.push(txn);
    txnsByFloat.set(txn.floatId, list);
  }

  /** Ringkasan saldo untuk satu karyawan pada periode ini (dari ledger, bukan cache). */
  function saldoFor(employeeId: string): SaldoPeriodSummary {
    const floatRow = floatByEmployee.get(employeeId);
    if (!floatRow) {
      return {
        active: false,
        balanceStart: 0,
        fundingInPeriod: 0,
        accrualTotal: 0,
        covered: 0,
        shortfall: 0,
      };
    }

    const txns = txnsByFloat.get(floatRow.id) ?? [];
    const balanceStart = balanceBefore(txns, period.start);
    const { accrualTotal, fundingInPeriod } = periodLedgerSummary(txns, period);
    const coverage = coverageForPeriod({ accrualTotal, balanceStart, fundingInPeriod });

    return {
      active: true,
      balanceStart,
      fundingInPeriod,
      accrualTotal,
      covered: coverage.covered,
      shortfall: coverage.shortfall,
    };
  }

  const rows: PayrollRow[] = staff.map((employee) => {
    const own = advances.filter(
      (advance) =>
        advance.employeeId === employee.id &&
        toNumber(advance.balance) > 0 &&
        isAdvanceEligible(advance, period.end),
    );

    const resolved = own.map((advance, index) => ({
      advance,
      resolution: resolveAdvanceDeduction(advance, planByAdvance.get(advance.id)),
      label: advanceLabel(advance, index, own.length),
    }));

    const advanceSummary: AdvanceSummary = resolved.length
      ? {
          activeCount: resolved.length,
          deductTotal: resolved.reduce((sum, item) => sum + item.resolution.amount, 0),
          deferredCount: resolved.filter((item) => item.resolution.deferred).length,
          deferredTotal: resolved
            .filter((item) => item.resolution.deferred)
            .reduce((sum, item) => sum + toNumber(item.advance.balance), 0),
        }
      : EMPTY_SUMMARY;

    const saldo = saldoFor(employee.id);

    const computation = computePayslip({
      payType: employee.payType,
      payRate: employee.payRate,
      period,
      joinedAt: employee.joinedAt,
      endedAt: employee.endedAt,
      isActive: employee.isActive,
      overtimeMultiplier: settings.overtimeMultiplier,
      saldoCovered: saldo.covered,
      timeEntries: entries
        .filter((entry) => entry.employeeId === employee.id)
        .map((entry) => ({
          id: entry.id,
          workDate: entry.workDate,
          clockInAt: entry.clockInAt,
          clockOutAt: entry.clockOutAt,
          breakMinutes: entry.breakMinutes,
          overtimeMinutes: entry.overtimeMinutes,
          transportAmount: entry.transportAmount,
          rateAt: rateAtDate(
            rateHistoryByEmployee.get(employee.id) ?? [],
            entry.workDate,
            "wage",
            employee.payRate,
          ),
        })),
      tasks: [
        ...tasks
          .filter((task) => task.employeeId === employee.id)
          .map((task) => ({
            id: task.id,
            title: task.title,
            qty: task.qty,
            unit: task.unit,
            unitRate: task.unitRate,
            workDate: task.workDate,
          })),
        ...carriedTasks
          .filter((task) => task.employeeId === employee.id)
          .map((task) => ({
            id: task.id,
            title: task.title,
            qty: task.qty,
            unit: task.unit,
            unitRate: task.unitRate,
            workDate: task.workDate,
            carriedOver: true,
          })),
      ],
      advances: resolved.map((item) => ({
        id: item.advance.id,
        balance: item.advance.balance,
        installmentAmount: item.advance.installmentAmount,
        amountOverride:
          item.resolution.source === "plan-amount" ? item.resolution.amount : null,
        deferred: item.resolution.deferred,
        label: item.label,
      })),
      leaves: leaveRows
        .filter((leave) => leave.employeeId === employee.id)
        .map((leave) => ({
          id: leave.id,
          kind: leave.kind,
          startDate: leave.startDate,
          endDate: leave.endDate,
          paid: leave.paid,
          status: leave.status,
        })),
    });

    return { employee, computation, advanceSummary, saldo };
  });

  const totalGross = rows.reduce((sum, row) => sum + row.computation.gross, 0);
  const totalDeductions = rows.reduce((sum, row) => sum + row.computation.deductions, 0);
  const totalNet = rows.reduce((sum, row) => sum + row.computation.net, 0);

  return {
    rows,
    totalGross,
    totalDeductions,
    totalNet,
    employeeCount: rows.length,
  };
}

/** Kasbon aktif milik karyawan + keputusan untuk periode tertentu (dipakai halaman kasbon). */
export async function advancePlansForPeriod(
  orgId: string,
  period: Period,
  options: { employeeId?: string } = {},
) {
  const where = [eq(cashAdvances.orgId, orgId), eq(cashAdvances.status, "approved")];
  if (options.employeeId) where.push(eq(cashAdvances.employeeId, options.employeeId));

  const [advances, plans] = await Promise.all([
    db
      .select()
      .from(cashAdvances)
      .where(and(...where))
      .orderBy(cashAdvances.requestedAt),
    db
      .select()
      .from(cashAdvancePlans)
      .where(and(eq(cashAdvancePlans.orgId, orgId), eq(cashAdvancePlans.periodStart, period.start))),
  ]);

  const planByAdvance = new Map(plans.map((plan) => [plan.cashAdvanceId, plan]));

  return advances
    .filter((advance) => toNumber(advance.balance) > 0 && isAdvanceEligible(advance, period.end))
    .map((advance) => {
      const plan = planByAdvance.get(advance.id);
      return {
        advance,
        plan,
        resolution: resolveAdvanceDeduction(advance, plan),
      };
    });
}
