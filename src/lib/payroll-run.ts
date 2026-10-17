import "server-only";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances, employees, timeEntries, workTasks } from "@/db/schema";
import { computePayslip, type PayslipComputation } from "@/lib/payroll";
import type { Period } from "@/lib/period";
import { toNumber } from "@/lib/utils";

export type PayrollRow = {
  employee: typeof employees.$inferSelect;
  computation: PayslipComputation;
};

export type PayrollPreview = {
  rows: PayrollRow[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
};

/** Hitung ulang payroll dari data mentah (approved) untuk sebuah periode. */
export async function previewPayroll(
  orgId: string,
  period: Period,
  settings: { overtimeMultiplier: number },
): Promise<PayrollPreview> {
  const staff = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.isActive, true)));

  const employeeIds = staff.map((e) => e.id);

  if (employeeIds.length === 0) {
    return { rows: [], totalGross: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0 };
  }

  const entries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.orgId, orgId),
        eq(timeEntries.status, "approved"),
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
      ),
    );

  const tasks = await db
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

  const advances = await db
    .select()
    .from(cashAdvances)
    .where(
      and(
        eq(cashAdvances.orgId, orgId),
        eq(cashAdvances.status, "approved"),
        inArray(cashAdvances.employeeId, employeeIds),
      ),
    );

  const rows: PayrollRow[] = staff.map((employee) => {
    const computation = computePayslip({
      payType: employee.payType,
      payRate: employee.payRate,
      period,
      joinedAt: employee.joinedAt,
      overtimeMultiplier: settings.overtimeMultiplier,
      timeEntries: entries
        .filter((entry) => entry.employeeId === employee.id)
        .map((entry) => ({
          id: entry.id,
          workDate: entry.workDate,
          clockInAt: entry.clockInAt,
          clockOutAt: entry.clockOutAt,
          breakMinutes: entry.breakMinutes,
          overtimeMinutes: entry.overtimeMinutes,
        })),
      tasks: tasks
        .filter((task) => task.employeeId === employee.id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          qty: task.qty,
          unit: task.unit,
          unitRate: task.unitRate,
          workDate: task.workDate,
        })),
      advances: advances
        .filter((advance) => advance.employeeId === employee.id && toNumber(advance.balance) > 0)
        .map((advance) => ({
          id: advance.id,
          balance: advance.balance,
          installmentAmount: advance.installmentAmount,
        })),
    });

    return { employee, computation };
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
