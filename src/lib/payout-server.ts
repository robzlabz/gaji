import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payslips } from "@/db/schema";
import { toNumber } from "@/lib/format";
import { buildPayoutBatch, type PayoutBatch } from "@/lib/payout";

export type PayoutPeriodRef = {
  id: string;
  periodStart: string;
  periodEnd: string;
};

/**
 * Muat slip satu periode lalu susun berkas transfernya.
 *
 * Halaman admin dan route unduhan memakai fungsi yang sama, jadi daftar "gagal"
 * yang tampil di layar selalu sama dengan isi berkas yang diunduh.
 */
export async function loadPayoutBatch(
  orgId: string,
  period: PayoutPeriodRef,
): Promise<PayoutBatch> {
  const rows = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.code,
      net: payslips.net,
      status: payslips.status,
      transferredAt: payslips.transferredAt,
      bankCode: employees.bankCode,
      bankAccountNumber: employees.bankAccountNumber,
      bankAccountName: employees.bankAccountName,
    })
    .from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .where(eq(payslips.payPeriodId, period.id))
    .orderBy(employees.fullName);

  return buildPayoutBatch({
    periodLabel: `${period.periodStart} s/d ${period.periodEnd}`,
    slips: rows.map((row) => ({
      slipId: row.id,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      employeeCode: row.employeeCode,
      net: toNumber(row.net),
      status: row.status,
      bankCode: row.bankCode,
      bankAccountNumber: row.bankAccountNumber,
      bankAccountName: row.bankAccountName,
      transferredAt: row.transferredAt,
    })),
  });
}
