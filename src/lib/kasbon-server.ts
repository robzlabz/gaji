import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvancePlans, cashAdvances, payPeriods } from "@/db/schema";
import { localDateString, toNumber } from "@/lib/format";
import { isAdvanceEligible } from "@/lib/kasbon";
import { periodContaining, periodLabel, shiftPeriod, type Period } from "@/lib/period";

export class PlanError extends Error {}

type OrgLike = { id: string; timezone: string; payPeriodStartDay: number };

export type PlanPeriodResult =
  | { ok: true; period: Period }
  | { ok: false; message: string };

/**
 * Periode yang masih boleh diatur rencana kasbonnya: periode berjalan, atau periode
 * berikutnya bila periode berjalan sudah difinalkan/dibayar. Tanpa ini, halaman kasbon
 * menampilkan periode yang sudah dikunci sehingga setiap perubahan pasti ditolak.
 */
export async function planningPeriod(
  org: OrgLike,
): Promise<{ period: Period; nextPeriod: Period }> {
  const today = localDateString(new Date(), org.timezone);
  const rows = await db
    .select({ periodStart: payPeriods.periodStart, status: payPeriods.status })
    .from(payPeriods)
    .where(eq(payPeriods.orgId, org.id));
  const statusByStart = new Map(rows.map((row) => [row.periodStart, row.status]));

  let period = periodContaining(today, org.payPeriodStartDay);
  for (let i = 0; i < 12; i += 1) {
    const status = statusByStart.get(period.start);
    if (!status || status === "draft") break;
    period = shiftPeriod(period.start, 1, org.payPeriodStartDay);
  }

  return { period, nextPeriod: shiftPeriod(period.start, 1, org.payPeriodStartDay) };
}

/**
 * Tentukan periode target untuk keputusan kasbon.
 * - `periodStart` dari form harus tepat sama dengan awal periode gaji organisasi.
 * - Kosong = periode yang sedang berjalan.
 * - Periode yang sudah difinalkan/dibayar tidak boleh diubah lagi.
 */
export async function resolvePlanPeriod(
  org: OrgLike,
  periodStart?: string | null,
): Promise<PlanPeriodResult> {
  const today = localDateString(new Date(), org.timezone);
  const fallback = periodContaining(today, org.payPeriodStartDay);

  const wanted = periodStart?.trim() || fallback.start;
  const period = periodContaining(wanted, org.payPeriodStartDay);

  if (period.start !== wanted) {
    return { ok: false, message: "Tanggal awal periode tidak sesuai pengaturan gaji." };
  }

  const [existing] = await db
    .select({ id: payPeriods.id, status: payPeriods.status })
    .from(payPeriods)
    .where(and(eq(payPeriods.orgId, org.id), eq(payPeriods.periodStart, period.start)))
    .limit(1);

  if (existing && existing.status !== "draft") {
    return {
      ok: false,
      message: `Periode ${periodLabel(period)} sudah ${existing.status === "paid" ? "dibayar" : "difinalkan"}.`,
    };
  }

  return { ok: true, period };
}

export type SaveAdvancePlanInput = {
  orgId: string;
  advanceId: string;
  period: Period;
  decision: string;
  amount: number;
  note?: string | null;
  userId: string;
};

/**
 * Simpan / hapus keputusan potong kasbon.
 * - `deduct` + amount > 0 → potong sebesar itu (dibatasi sisa saldo)
 * - `deduct` tanpa amount  → ikut cicilan, atau sisa penuh bila cicilan kosong
 * - `defer`                → lewati periode ini, tetap menunggu periode berikutnya
 * - `auto`                 → hapus keputusan, kembali ke aturan default
 */
export async function saveAdvancePlan(input: SaveAdvancePlanInput): Promise<void> {
  const decision = input.decision;
  if (!["deduct", "defer", "auto"].includes(decision)) {
    throw new PlanError("Keputusan kasbon tidak dikenal.");
  }

  const [advance] = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, input.advanceId), eq(cashAdvances.orgId, input.orgId)))
    .limit(1);

  if (!advance) throw new PlanError("Kasbon tidak ditemukan.");
  if (advance.status !== "approved") throw new PlanError("Kasbon ini belum disetujui.");

  const balance = Math.round(toNumber(advance.balance));
  if (balance <= 0) throw new PlanError("Kasbon ini sudah lunas.");

  const period = input.period;
  if (!isAdvanceEligible(advance, period.end)) {
    throw new PlanError("Kasbon ini dicairkan setelah periode tersebut selesai.");
  }

  if (decision === "auto") {
    await db
      .delete(cashAdvancePlans)
      .where(
        and(
          eq(cashAdvancePlans.cashAdvanceId, input.advanceId),
          eq(cashAdvancePlans.periodStart, period.start),
        ),
      );
    return;
  }

  const amount = Math.round(input.amount);
  if (decision === "deduct" && amount > balance) {
    throw new PlanError("Nominal potong melebihi sisa kasbon.");
  }
  if (decision === "deduct" && amount < 0) {
    throw new PlanError("Nominal potong tidak valid.");
  }

  await db
    .insert(cashAdvancePlans)
    .values({
      orgId: input.orgId,
      cashAdvanceId: input.advanceId,
      periodStart: period.start,
      decision,
      amount: decision === "deduct" && amount > 0 ? amount.toString() : null,
      note: input.note?.trim() || null,
      decidedBy: input.userId,
      decidedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [cashAdvancePlans.cashAdvanceId, cashAdvancePlans.periodStart],
      set: {
        decision,
        amount: decision === "deduct" && amount > 0 ? amount.toString() : null,
        note: input.note?.trim() || null,
        decidedBy: input.userId,
        decidedAt: new Date(),
      },
    });
}
