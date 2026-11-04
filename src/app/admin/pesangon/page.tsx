import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createSeveranceSlipsAction } from "../kompensasi-actions";
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
import { previewSeverance } from "@/lib/thr-server";
import {
  REPLACEMENT_RIGHTS_RATE,
  pesangonTierLabel,
  serviceAwardTierLabel,
} from "@/lib/severance";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export default async function SeverancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { date, ok, err } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const referenceDate = date && DATE_ONLY.test(date) ? date : today;
  const preview = await previewSeverance(org.id, referenceDate);
  const replacementPercent = Math.round(REPLACEMENT_RIGHTS_RATE * 100);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Pesangon</h1>
          <p className="text-sm text-muted-foreground">
            PP 35/2021 Pasal 40: uang pesangon maksimum 9 bulan upah, penghargaan masa kerja
            maksimum 10 bulan, ditambah penggantian hak {replacementPercent}%.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/thr?date=${referenceDate}`}>THR</Link>
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
          label="Total pesangon"
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
            Masa kerja dihitung dari tanggal masuk sampai tanggal ini (atau tanggal berhenti bila
            lebih awal), dibulatkan ke bawah per bulan penuh.
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
          <CardTitle>Pratinjau pesangon</CardTitle>
          <CardDescription>
            Tabel penuh Pasal 40 (tanpa pengali menurut alasan PHK) · upah dasar karyawan
            harian/jam/tugas memakai rata-rata 12 bulan terakhir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.rows.length === 0 ? (
            <EmptyState
              title="Belum ada karyawan"
              hint="Tambahkan karyawan dulu di menu Karyawan agar pesangon bisa dihitung."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Masuk</TableHead>
                  <TableHead>Masa kerja</TableHead>
                  <TableHead className="text-right">Upah sebulan</TableHead>
                  <TableHead className="text-right">Pesangon</TableHead>
                  <TableHead className="text-right">Penghargaan</TableHead>
                  <TableHead className="text-right">Penggantian hak</TableHead>
                  <TableHead className="text-right">Total</TableHead>
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
                        {row.ended
                          ? ` · berhenti ${formatDateID(row.endDate)}`
                          : ""}
                      </p>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.employee.joinedAt)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.result.monthsWorked} bulan
                      <p className="text-xs text-muted-foreground">{row.result.daysWorked} hari</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupiah(row.result.monthlyWage)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.result.eligible ? (
                        <>
                          {rupiah(row.result.pesangonAmount)}
                          <p className="text-xs text-muted-foreground">
                            {row.result.pesangonMonths}× · {pesangonTierLabel(row.result.monthsWorked)}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.result.eligible ? (
                        <>
                          {rupiah(row.result.serviceAwardAmount)}
                          <p className="text-xs text-muted-foreground">
                            {row.result.serviceAwardMonths}× ·{" "}
                            {serviceAwardTierLabel(row.result.monthsWorked)}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.result.eligible ? (
                        <>
                          {rupiah(row.result.replacementAmount)}
                          <p className="text-xs text-muted-foreground">{replacementPercent}%</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {row.result.eligible ? (
                        <>
                          {rupiah(row.result.total)}
                          <p className="max-w-56 text-left text-xs font-normal text-muted-foreground">
                            {row.result.explanation}
                          </p>
                        </>
                      ) : (
                        <span className="max-w-56 text-left text-xs font-normal text-muted-foreground">
                          {row.result.reason}
                        </span>
                      )}
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
          <CardTitle>Buat slip pesangon</CardTitle>
          <CardDescription>
            Slip dibuat sebagai periode payroll bertipe pesangon (draf) dengan tiga baris
            <code className="mx-1 rounded bg-muted px-1">kind = &quot;severance&quot;</code>
            per karyawan: pesangon, penghargaan masa kerja, dan penggantian hak.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action={createSeveranceSlipsAction}>
            <input type="hidden" name="referenceDate" value={referenceDate} />
            <Button type="submit" disabled={preview.eligibleCount === 0}>
              Buat slip pesangon untuk {preview.eligibleCount} karyawan
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Modul ini hanya menghitung dan membuat slip: status karyawan tidak diubah otomatis.
            Pengali menurut alasan PHK (PP 35/2021 Pasal 41–57) dan pajak PPh 21 tidak dihitung
            di sini.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
