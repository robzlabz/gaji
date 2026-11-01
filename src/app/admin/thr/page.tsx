import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createThrSlipsAction } from "../kompensasi-actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { PrintButton } from "@/components/print-button";
import { StatCard } from "@/components/stat-card";
import { FormField } from "@/components/form-field";
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
import { PAY_TYPE_LABEL, formatDateID, localDateString, rupiah } from "@/lib/format";
import { previewThr } from "@/lib/thr-server";
import { THR_FULL_MONTHS, thrWageSourceLabel } from "@/lib/thr";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ThrPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { date, ok, err } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const referenceDate = date && DATE_ONLY.test(date) ? date : today;
  const preview = await previewThr(org.id, referenceDate);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">THR</h1>
          <p className="text-sm text-muted-foreground">
            Permenaker 6/2016: masa kerja ≥ 12 bulan = 1× upah sebulan, 1–11 bulan = masa
            kerja/12 × upah sebulan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/pesangon?date=${referenceDate}`}>Pesangon</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/payroll">Payroll</Link>
          </Button>
          <PrintButton label="Cetak pratinjau" />
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Karyawan berhak" value={preview.eligibleCount} />
        <StatCard
          label="Total THR"
          value={rupiah(preview.total)}
          hint={`acuan ${formatDateID(referenceDate)}`}
        />
        <StatCard
          label="Belum berhak"
          value={preview.ineligibleCount}
          hint="masa kerja < 1 bulan atau upah belum ada"
        />
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Tanggal acuan</CardTitle>
          <CardDescription>
            Masa kerja dihitung dari tanggal masuk sampai tanggal ini, dibulatkan ke bawah per
            bulan penuh. Karyawan yang berhenti sebelum tanggal acuan tidak dihitung.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <FormField label="Tanggal acuan" className="w-48">
              <Input type="date" name="date" defaultValue={referenceDate} />
            </FormField>
            <Button type="submit" variant="outline">
              Hitung
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pratinjau THR</CardTitle>
          <CardDescription>
            Upah dasar karyawan bulanan = tarif bulanan; karyawan harian/jam/tugas memakai
            rata-rata upah 12 bulan terakhir dari absensi &amp; tugas yang sudah approved
            (ongkos kedatangan tidak dihitung).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.rows.length === 0 ? (
            <EmptyState
              title="Belum ada karyawan"
              hint="Tambahkan karyawan dulu di menu Karyawan agar THR bisa dihitung."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Masuk</TableHead>
                  <TableHead>Masa kerja</TableHead>
                  <TableHead>Dasar upah</TableHead>
                  <TableHead className="text-right">THR</TableHead>
                  <TableHead>Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.employee.id}>
                    <TableCell>
                      <Link
                        href={`/admin/karyawan/${row.employee.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.employee.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {PAY_TYPE_LABEL[row.employee.payType] ?? row.employee.payType}
                      </p>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.employee.joinedAt)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.result.monthsWorked} bulan
                      <p className="text-xs text-muted-foreground">{row.result.daysWorked} hari</p>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {rupiah(row.result.monthlyWage)}
                      <p className="text-xs text-muted-foreground">
                        {thrWageSourceLabel(row.basis.source, row.basis.monthsAveraged)}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.result.eligible ? (
                        <>
                          <span className="font-medium">{rupiah(row.result.amount)}</span>
                          <p className="text-xs text-muted-foreground">
                            {row.result.monthsWorked >= THR_FULL_MONTHS
                              ? "1× upah sebulan"
                              : `${row.result.monthsWorked}/12 × upah`}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs text-muted-foreground">
                      {row.result.eligible ? row.result.explanation : row.result.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Buat slip THR</CardTitle>
          <CardDescription>
            Slip dibuat sebagai periode payroll bertipe THR (draf) berisi satu baris
            <code className="mx-1 rounded bg-muted px-1">kind = &quot;thr&quot;</code>
            per karyawan yang berhak. Setelah dibuat, slip bisa dicetak dari halaman payroll.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action={createThrSlipsAction}>
            <input type="hidden" name="referenceDate" value={referenceDate} />
            <Button type="submit" disabled={preview.eligibleCount === 0}>
              Buat slip THR untuk {preview.eligibleCount} karyawan
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            THR wajib dibayar paling lambat 7 hari sebelum hari raya (Permenaker 6/2016 Pasal 5).
            Karyawan dengan masa kerja belum 1 bulan penuh tidak mendapat THR dan ditandai “—”
            pada tabel di atas.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
