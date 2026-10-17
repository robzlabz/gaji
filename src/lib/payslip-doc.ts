import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payPeriods, payslipItems, payslips } from "@/db/schema";

export type PayslipDoc = {
  slip: typeof payslips.$inferSelect;
  employee: typeof employees.$inferSelect;
  period: typeof payPeriods.$inferSelect;
  items: Array<typeof payslipItems.$inferSelect>;
};

/** Ambil satu slip lengkap (selalu difilter org) untuk halaman cetak. */
export async function loadPayslipDoc(orgId: string, payslipId: string): Promise<PayslipDoc | null> {
  const [row] = await db
    .select({ slip: payslips, employee: employees, period: payPeriods })
    .from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
    .where(and(eq(payslips.id, payslipId), eq(payslips.orgId, orgId)))
    .limit(1);

  if (!row) return null;

  const items = await db
    .select()
    .from(payslipItems)
    .where(eq(payslipItems.payslipId, payslipId))
    .orderBy(payslipItems.createdAt);

  return { ...row, items };
}

/** Satu slip untuk kombinasi periode + karyawan. */
export async function findPayslipDoc(
  orgId: string,
  periodId: string,
  employeeId: string,
): Promise<PayslipDoc | null> {
  const [slip] = await db
    .select({ id: payslips.id })
    .from(payslips)
    .where(
      and(
        eq(payslips.orgId, orgId),
        eq(payslips.payPeriodId, periodId),
        eq(payslips.employeeId, employeeId),
      ),
    )
    .limit(1);

  if (!slip) return null;
  return loadPayslipDoc(orgId, slip.id);
}
