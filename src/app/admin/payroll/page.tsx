import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods, payslips } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createPayrollRunAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateID, localDateString, rupiah, rupiahShort, toNumber } from "@/lib/format";
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
  const draftCount = rows.filter((row) => row.status === "draft").length;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Periode gaji mengikuti tanggal mulai {org.payPeriodStartDay} yang diatur di Pengaturan.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Periode dihitung" value={rows.length} />
        <StatCard
          label="Periode terakhir dibayar"
          value={lastPaid ? rupiahShort(toNumber(lastPaid.totalNet)) : "—"}
          hint={
            lastPaid
              ? periodLabel({ start: lastPaid.periodStart, end: lastPaid.periodEnd })
              : "belum ada pembayaran"
          }
        />
        <StatCard
          label="Draft menunggu"
          value={draftCount}
          hint={draftCount > 0 ? "perlu difinalkan" : "semua sudah difinalkan"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hitung payroll baru</CardTitle>
          <CardDescription>Hanya absensi &amp; tugas berstatus approved yang dihitung.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <form action={createPayrollRunAction} className="grid gap-3 sm:grid-cols-3">
            <FormField label="Periode">
              <SelectInput name="period" defaultValue={`${options[0].start}|${options[0].end}`}>
                {options.map((period) => (
                  <option key={period.start} value={`${period.start}|${period.end}`}>
                    {periodLabel(period)}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Tanggal bayar" hint="Opsional">
              <Input type="date" name="payDate" />
            </FormField>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Hitung &amp; buat draft
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            Nilai periode diambil dari pilihan di atas. Kalau periode sudah pernah dihitung, sistem
            menolak untuk mencegah dobel bayar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat periode</CardTitle>
          <CardDescription>24 periode terakhir</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada payroll"
              hint="Hitung periode pertama lewat form di atas."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Periode</TableHead>
                  <TableHead>Tanggal bayar</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Total net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/admin/payroll/${row.id}`} className="font-medium hover:underline">
                        {formatDateID(row.periodStart)} – {formatDateID(row.periodEnd)}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.payDate ? formatDateID(row.payDate) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{row.employees}</TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {rupiah(toNumber(row.totalNet))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
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
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
