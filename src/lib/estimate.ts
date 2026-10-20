import "server-only";

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvancePlans, cashAdvances, leaves, payRateHistory, timeEntries, workTasks } from "@/db/schema";
import { computePayslip, type PayslipComputation } from "@/lib/payroll";
import { advanceLabel, isAdvanceEligible, resolveAdvanceDeduction } from "@/lib/kasbon";
import { rateAtDate } from "@/lib/saldo";
import { saldoForPeriod } from "@/lib/saldo-server";
import type { Period } from "@/lib/period";
import { toNumber } from "@/lib/format";

export type EstimateCounts = {
  /** Absensi yang sudah disetujui admin. */
  entriesApproved: number;
  /** Absensi yang masih menunggu approval (ikut dihitung di angka "potensi"). */
  entriesPending: number;
  tasksApproved: number;
  /** Tugas yang sudah ditandai selesai tapi belum diputuskan admin. */
  tasksWaiting: number;
  /** Tugas yang harganya belum diisi admin — belum bernilai sepeser pun. */
  tasksUnpriced: number;
  leavesApproved: number;
};

export type PayEstimate = {
  /** Hitungan aman: hanya data yang sudah disetujui admin. */
  approved: PayslipComputation;
  /** Hitungan bila semua yang menunggu ikut disetujui (selisih = potensi tambahan). */
  potential: PayslipComputation;
  counts: EstimateCounts;
  /** Saldo prabayar: berapa bagian upah yang sudah dibayar di muka periode ini. */
  saldo: { active: boolean; covered: number; balance: number };
};

export type EstimateEmployee = {
  id: string;
  payType: string;
  payRate: string;
  joinedAt: string | null;
};

/**
 * Estimasi gaji satu karyawan untuk satu periode.
 *
 * Slip resmi baru dibuat saat payroll difinalkan, jadi karyawan butuh gambaran
 * berjalan: angka "approved" (aman) dan angka "potential" (kalau absensi/tugas yang
 * masih menunggu ikut disetujui). Rumusnya memakai `computePayslip` yang sama dengan
 * payroll, supaya estimasi tidak pernah berbeda rumus dari slip finalnya.
 */
export async function estimatePay(params: {
  orgId: string;
  employee: EstimateEmployee;
  period: Period;
  overtimeMultiplier: number;
}): Promise<PayEstimate> {
  const { orgId, employee, period, overtimeMultiplier } = params;

  const [entries, tasks, advances, plans, leaveRows, rateRows, saldo] = await Promise.all([
    db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.employeeId, employee.id),
          isNull(timeEntries.deletedAt),
          gte(timeEntries.workDate, period.start),
          lte(timeEntries.workDate, period.end),
        ),
      )
      .orderBy(timeEntries.workDate),
    db
      .select()
      .from(workTasks)
      .where(
        and(
          eq(workTasks.orgId, orgId),
          eq(workTasks.employeeId, employee.id),
          gte(workTasks.workDate, period.start),
          lte(workTasks.workDate, period.end),
        ),
      )
      .orderBy(workTasks.workDate),
    db
      .select()
      .from(cashAdvances)
      .where(
        and(
          eq(cashAdvances.orgId, orgId),
          eq(cashAdvances.employeeId, employee.id),
          eq(cashAdvances.status, "approved"),
        ),
      )
      .orderBy(cashAdvances.requestedAt),
    db
      .select()
      .from(cashAdvancePlans)
      .where(and(eq(cashAdvancePlans.orgId, orgId), eq(cashAdvancePlans.periodStart, period.start))),
    db
      .select()
      .from(leaves)
      .where(
        and(
          eq(leaves.orgId, orgId),
          eq(leaves.employeeId, employee.id),
          inArray(leaves.status, ["pending", "approved"]),
          lte(leaves.startDate, period.end),
          gte(leaves.endDate, period.start),
        ),
      ),
    db
      .select({
        kind: payRateHistory.kind,
        payRate: payRateHistory.payRate,
        effectiveFrom: payRateHistory.effectiveFrom,
      })
      .from(payRateHistory)
      .where(eq(payRateHistory.employeeId, employee.id)),
    saldoForPeriod(db, { orgId, employeeId: employee.id, period }),
  ]);

  const planByAdvance = new Map(plans.map((plan) => [plan.cashAdvanceId, plan]));

  const activeAdvances = advances.filter(
    (advance) => toNumber(advance.balance) > 0 && isAdvanceEligible(advance, period.end),
  );

  const advanceInputs = activeAdvances.map((advance, index) => {
    const resolution = resolveAdvanceDeduction(advance, planByAdvance.get(advance.id));
    return {
      id: advance.id,
      balance: advance.balance,
      installmentAmount: advance.installmentAmount,
      amountOverride: resolution.source === "plan-amount" ? resolution.amount : null,
      deferred: resolution.deferred,
      label: advanceLabel(advance, index, activeAdvances.length),
    };
  });

  const leaveInputs = leaveRows.map((leave) => ({
    id: leave.id,
    kind: leave.kind,
    startDate: leave.startDate,
    endDate: leave.endDate,
    paid: leave.paid,
    status: leave.status,
  }));

  function compute(includePending: boolean): PayslipComputation {
    return computePayslip({
      payType: employee.payType,
      payRate: employee.payRate,
      period,
      joinedAt: employee.joinedAt,
      overtimeMultiplier,
      timeEntries: entries
        .filter((entry) => (includePending ? entry.status !== "rejected" : entry.status === "approved"))
        .map((entry) => ({
          id: entry.id,
          workDate: entry.workDate,
          clockInAt: entry.clockInAt,
          clockOutAt: entry.clockOutAt,
          breakMinutes: entry.breakMinutes,
          overtimeMinutes: entry.overtimeMinutes,
          transportAmount: entry.transportAmount,
          rateAt: rateAtDate(rateRows, entry.workDate, "wage", employee.payRate),
        })),
      tasks: tasks
        .filter((task) =>
          includePending
            ? task.status === "approved" || task.status === "done"
            : task.status === "approved",
        )
        .map((task) => ({
          id: task.id,
          title: task.title,
          qty: task.qty,
          unit: task.unit,
          unitRate: task.unitRate,
          workDate: task.workDate,
        })),
      advances: advanceInputs,
      leaves: leaveInputs,
      // Estimasi tetap memakai angka saldo yang benar-benar tercatat (approved saja);
      // potensi upah dari absensi pending belum memotong saldo sampai di-approve.
      saldoCovered: saldo.covered,
    });
  }

  return {
    approved: compute(false),
    potential: compute(true),
    counts: {
      entriesApproved: entries.filter((entry) => entry.status === "approved").length,
      entriesPending: entries.filter((entry) => entry.status === "pending").length,
      tasksApproved: tasks.filter((task) => task.status === "approved").length,
      tasksWaiting: tasks.filter((task) => task.status === "done").length,
      tasksUnpriced: tasks.filter((task) => task.status === "requested").length,
      leavesApproved: leaveRows.filter((leave) => leave.status === "approved").length,
    },
    saldo: {
      active: saldo.floatId !== null,
      covered: saldo.covered,
      balance: saldo.balanceNow,
    },
  };
}
