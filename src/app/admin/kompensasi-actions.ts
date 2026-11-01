"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { payPeriods, payslipItems, payslips } from "@/db/schema";
import { audit } from "@/lib/audit";
import { formatDateID } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { previewSeverance, previewThr } from "@/lib/thr-server";

/**
 * Aksi pembuatan slip THR & pesangon.
 *
 * Slip dibuat sebagai periode payroll bertipe `thr` / `severance` (bukan periode gaji
 * reguler), memakai tabel `payslip_items` yang sudah ada dengan kind `thr` / `severance`.
 * Alur payroll reguler (`previewPayroll`, hitung ulang draft) tidak tersentuh karena
 * hanya bekerja pada periode `kind = 'regular'`.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function str(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Redirect dengan pesan flash; selalu melempar, jadi tidak pernah kembali. */
function flash(path: string, params: Record<string, string>): never {
  const url = new URL(path, "http://flash.local");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}${url.hash}`);
}

function fail(path: string, message: string): never {
  flash(path, { err: message });
}

function ok(path: string, message: string): never {
  flash(path, { ok: message });
}

/** Path halaman pratinjau dengan tanggal acuan tetap terbawa setelah redirect. */
function datePath(path: string, date: string): string {
  return date ? `${path}?date=${encodeURIComponent(date)}` : path;
}

/** Buat slip THR (satu slip per karyawan yang berhak) untuk tanggal acuan. */
export async function createThrSlipsAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const referenceDate = str(formData, "referenceDate");
  const target = datePath("/admin/thr", referenceDate);

  if (!DATE_ONLY.test(referenceDate)) fail("/admin/thr", "Tanggal acuan tidak valid.");

  const preview = await previewThr(org.id, referenceDate);
  const eligible = preview.rows.filter((row) => row.result.eligible && row.result.amount > 0);
  if (eligible.length === 0) {
    fail(target, "Tidak ada karyawan yang berhak THR pada tanggal ini.");
  }

  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.orgId, org.id),
        eq(payPeriods.periodStart, referenceDate),
        eq(payPeriods.kind, "thr"),
      ),
    )
    .limit(1);

  if (existing) {
    fail(target, `Slip THR untuk ${formatDateID(referenceDate)} sudah dibuat.`);
  }

  const periodId = await db.transaction(async (tx) => {
    const [period] = await tx
      .insert(payPeriods)
      .values({
        orgId: org.id,
        kind: "thr",
        periodStart: referenceDate,
        periodEnd: referenceDate,
        payDate: referenceDate,
        status: "draft",
        createdBy: user.id,
      })
      .returning();

    for (const row of eligible) {
      const result = row.result;
      const [slip] = await tx
        .insert(payslips)
        .values({
          orgId: org.id,
          payPeriodId: period.id,
          employeeId: row.employee.id,
          payType: row.employee.payType,
          payRate: row.employee.payRate,
          gross: String(result.amount),
          totalDeductions: "0",
          saldoCovered: "0",
          net: String(result.amount),
          status: "draft",
        })
        .returning();

      await tx.insert(payslipItems).values({
        payslipId: slip.id,
        kind: "thr",
        label: `THR ${referenceDate.slice(0, 4)} · masa kerja ${result.monthsWorked} bulan`,
        // Qty = bulan upah yang dibayar (maks 12) supaya slip bisa dibaca
        // "8 bulan × upah/12" tanpa pecahan 0,67 yang membingungkan.
        qty: String(Math.min(result.monthsWorked, 12)),
        unit: "bulan upah",
        unitRate: String(Math.round(result.monthlyWage / 12)),
        amount: String(result.amount),
        sourceTable: "employees",
        sourceId: row.employee.id,
        meta: {
          referenceDate,
          monthsWorked: result.monthsWorked,
          ratio: result.ratio,
          monthlyWage: result.monthlyWage,
          wageSource: result.wageSource,
          monthsAveraged: result.monthsAveraged,
          rule: "Permenaker 6/2016 Pasal 3 ayat (1)",
        },
      });
    }

    return period.id;
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "pay_periods",
    entityId: periodId,
    action: "create_thr",
    diff: { referenceDate, employees: eligible.length, total: preview.total },
  });

  revalidatePath("/admin/thr");
  revalidatePath("/admin/payroll");
  revalidatePath(`/admin/payroll/${periodId}`);

  ok(
    `/admin/payroll/${periodId}`,
    `Slip THR ${formatDateID(referenceDate)} dibuat untuk ${eligible.length} karyawan.`,
  );
}

/** Buat slip pesangon (pesangon + penghargaan + penggantian hak) untuk tanggal acuan. */
export async function createSeveranceSlipsAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const referenceDate = str(formData, "referenceDate");
  const target = datePath("/admin/pesangon", referenceDate);

  if (!DATE_ONLY.test(referenceDate)) fail("/admin/pesangon", "Tanggal acuan tidak valid.");

  const preview = await previewSeverance(org.id, referenceDate);
  const eligible = preview.rows.filter((row) => row.result.eligible && row.result.total > 0);
  if (eligible.length === 0) {
    fail(target, "Tidak ada karyawan yang berhak pesangon pada tanggal ini.");
  }

  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.orgId, org.id),
        eq(payPeriods.periodStart, referenceDate),
        eq(payPeriods.kind, "severance"),
      ),
    )
    .limit(1);

  if (existing) {
    fail(target, `Slip pesangon untuk ${formatDateID(referenceDate)} sudah dibuat.`);
  }

  const periodId = await db.transaction(async (tx) => {
    const [period] = await tx
      .insert(payPeriods)
      .values({
        orgId: org.id,
        kind: "severance",
        periodStart: referenceDate,
        periodEnd: referenceDate,
        payDate: referenceDate,
        status: "draft",
        createdBy: user.id,
      })
      .returning();

    for (const row of eligible) {
      const result = row.result;
      const [slip] = await tx
        .insert(payslips)
        .values({
          orgId: org.id,
          payPeriodId: period.id,
          employeeId: row.employee.id,
          payType: row.employee.payType,
          payRate: row.employee.payRate,
          gross: String(result.total),
          totalDeductions: "0",
          saldoCovered: "0",
          net: String(result.total),
          status: "draft",
        })
        .returning();

      const meta = {
        referenceDate: row.endDate,
        monthsWorked: result.monthsWorked,
        monthlyWage: result.monthlyWage,
        rule: "PP 35/2021 Pasal 40",
      };

      await tx.insert(payslipItems).values([
        {
          payslipId: slip.id,
          kind: "severance",
          label: `Uang pesangon (${result.pesangonMonths} bulan upah)`,
          qty: String(result.pesangonMonths),
          unit: "bulan upah",
          unitRate: String(result.monthlyWage),
          amount: String(result.pesangonAmount),
          sourceTable: "employees",
          sourceId: row.employee.id,
          meta: { ...meta, component: "pesangon", months: result.pesangonMonths },
        },
        {
          payslipId: slip.id,
          kind: "severance",
          label: `Uang penghargaan masa kerja (${result.serviceAwardMonths} bulan upah)`,
          qty: String(result.serviceAwardMonths),
          unit: "bulan upah",
          unitRate: String(result.monthlyWage),
          amount: String(result.serviceAwardAmount),
          sourceTable: "employees",
          sourceId: row.employee.id,
          meta: { ...meta, component: "penghargaan-masa-kerja", months: result.serviceAwardMonths },
        },
        {
          payslipId: slip.id,
          kind: "severance",
          label: "Uang penggantian hak (15%)",
          qty: "1",
          unit: "kali",
          unitRate: String(result.replacementAmount),
          amount: String(result.replacementAmount),
          sourceTable: "employees",
          sourceId: row.employee.id,
          meta: { ...meta, component: "penggantian-hak", rate: result.replacementRate },
        },
      ]);
    }

    return period.id;
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "pay_periods",
    entityId: periodId,
    action: "create_severance",
    diff: { referenceDate, employees: eligible.length, total: preview.total },
  });

  revalidatePath("/admin/pesangon");
  revalidatePath("/admin/payroll");
  revalidatePath(`/admin/payroll/${periodId}`);

  ok(
    `/admin/payroll/${periodId}`,
    `Slip pesangon ${formatDateID(referenceDate)} dibuat untuk ${eligible.length} karyawan.`,
  );
}
