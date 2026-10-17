import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods, payslips } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createPayrollRunAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Stat, Table, Td, btnPrimary, inputClass } from "@/components/ui";
import { formatDateID, localDateString, rupiah, rupiahShort, toNumber } from "@/lib/utils";
import { periodLabel, recentPeriods } from "@/lib/period";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);
  const options = recentPeriods(today, org.payPeriodStartDay, 6);

  const rows = await db
    .select({
      id: payPeriods.id,
      periodStart: payPeriods.periodStart,
      periodEnd: payPeriods.periodEnd,
      payDate: payPeriods.payDate,
      status: payPeriods.status,
      employees: sql<number>`count(${payslips.id})`,
      totalNet: sql<string>`coalesce(sum(${payslips.net}), 0)`,
    })
    .from(payPeriods)
    .leftJoin(payslips, eq(payslips.payPeriodId, payPeriods.id))
    .where(eq(payPeriods.orgId, org.id))
    .groupBy(payPeriods.id)
    .orderBy(desc(payPeriods.periodStart))
    .limit(24);

  const lastPaid = rows.find((row) => row.status === "paid");

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-stone-900">Payroll</h1>
        <p className="text-sm text-muted">
          Periode gaji mengikuti tanggal mulai {org.payPeriodStartDay} yang diatur di Pengaturan.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Periode dihitung" value={rows.length} />
        <Stat
          label="Periode terakhir dibayar"
          value={lastPaid ? rupiahShort(toNumber(lastPaid.totalNet)) : "—"}
          hint={lastPaid ? periodLabel({ start: lastPaid.periodStart, end: lastPaid.periodEnd }) : undefined}
          tone="good"
        />
        <Stat
          label="Draft menunggu"
          value={rows.filter((row) => row.status === "draft").length}
          tone={rows.some((row) => row.status === "draft") ? "warn" : "default"}
        />
      </div>

      <Card title="Hitung payroll baru" subtitle="Hanya absensi & tugas berstatus approved yang dihitung.">
        <form action={createPayrollRunAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Periode">
            <select name="period" className={inputClass} defaultValue={`${options[0].start}|${options[0].end}`}>
              {options.map((period) => (
                <option key={period.start} value={`${period.start}|${period.end}`}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal bayar" hint="Opsional">
            <input type="date" name="payDate" className={inputClass} />
          </Field>
          <div className="flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>
              Hitung & buat draft
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted">
          Catatan: nilai periode diambil dari pilihan di atas. Kalau periode sudah pernah dihitung, sistem
          menolak untuk mencegah dobel bayar.
        </p>
      </Card>

      <Card title="Riwayat periode">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada payroll" hint="Hitung periode pertama lewat form di atas." />
        ) : (
          <Table head={["Periode", "Tanggal bayar", "Karyawan", "Total net", "Status"]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <Link href={`/admin/payroll/${row.id}`} className="font-medium text-brand">
                    {formatDateID(row.periodStart)} – {formatDateID(row.periodEnd)}
                  </Link>
                </Td>
                <Td className="tabular-nums text-stone-600">
                  {row.payDate ? formatDateID(row.payDate) : "—"}
                </Td>
                <Td className="tabular-nums text-stone-600">{row.employees}</Td>
                <Td className="tabular-nums font-medium">{rupiah(toNumber(row.totalNet))}</Td>
                <Td>
                  <Badge
                    tone={
                      row.status === "paid"
                        ? "good"
                        : row.status === "approved"
                          ? "info"
                          : row.status === "void"
                            ? "bad"
                            : "default"
                    }
                  >
                    {row.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
