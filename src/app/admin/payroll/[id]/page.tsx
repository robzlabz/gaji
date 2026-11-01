import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, payPeriods, payslipItems, payslips } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { deletePayrollDraftAction, markSlipTransferredAction, recalculatePayrollDraftAction, updatePayPeriodStatusAction } from "../../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAY_TYPE_LABEL, formatDateID, formatDateTimeID, rupiah, toNumber } from "@/lib/format";
import { isDeductionLine } from "@/lib/payroll";
import { maskAccountNumber, bankLabel, isPayoutEligible, PAYOUT_FORMAT_CHOICES, PAYOUT_FORMATS, rowsForFormat, summarizeBatch } from "@/lib/payout";
import { loadPayoutBatch } from "@/lib/payout-server";
import { periodLabel } from "@/lib/period";

export default async function PayrollDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, id), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) notFound();

  const slips = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.code,
      bankCode: employees.bankCode,
      bankAccountNumber: employees.bankAccountNumber,
      bankAccountName: employees.bankAccountName,
      payType: payslips.payType,
      payRate: payslips.payRate,
      gross: payslips.gross,
      totalDeductions: payslips.totalDeductions,
      saldoCovered: payslips.saldoCovered,
      net: payslips.net,
      status: payslips.status,
      transferredAt: payslips.transferredAt,
    })
    .from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .where(eq(payslips.payPeriodId, period.id))
    .orderBy(employees.fullName);

  const slipIds = slips.map((slip) => slip.id);

  const items = slipIds.length
    ? await db.select().from(payslipItems).where(inArray(payslipItems.payslipId, slipIds))
    : [];

  const itemsBySlip = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySlip.get(item.payslipId) ?? [];
    list.push(item);
    itemsBySlip.set(item.payslipId, list);
  }

  const totalGross = slips.reduce((sum, slip) => sum + toNumber(slip.gross), 0);
  const totalDeductions = slips.reduce((sum, slip) => sum + toNumber(slip.totalDeductions), 0);
  const totalNet = slips.reduce((sum, slip) => sum + toNumber(slip.net), 0);
  const totalSaldo = slips.reduce((sum, slip) => sum + toNumber(slip.saldoCovered), 0);

  // Berkas transfer memakai fungsi yang sama dengan route unduhan, jadi daftar gagal
  // di layar identik dengan isi berkas.
  const payout = await loadPayoutBatch(org.id, period);
  const payoutSummary = summarizeBatch(payout);
  const transferRowsByEmployee = new Map(payout.rows.map((row) => [row.employeeId, row]));
  const formatLabel = new Map(PAYOUT_FORMAT_CHOICES.map((choice) => [choice.value, choice.label]));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/payroll" className="text-xs text-muted-foreground hover:underline">
            ← Payroll
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {periodLabel({ start: period.periodStart, end: period.periodEnd })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {slips.length} slip · tanggal bayar{" "}
            {period.payDate ? formatDateID(period.payDate) : "belum diset"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={`/admin/payroll/${period.id}/export`}>Unduh CSV</a>
          </Button>

          {payout.rows.length > 0 && (
            <Button asChild variant="outline">
              <a href={`/admin/payroll/${period.id}/transfer?format=generic`}>Berkas transfer</a>
            </Button>
          )}

          <StatusBadge
            tone={
              period.status === "paid"
                ? "good"
                : period.status === "approved"
                  ? "info"
                  : period.status === "void"
                    ? "bad"
                    : "default"
            }
          >
            {statusLabel(period.status)}
          </StatusBadge>

          {period.status === "draft" && (
            <>
              <Button asChild variant="outline">
                <Link href="/admin/kasbon">Atur kasbon</Link>
              </Button>
              <form action={recalculatePayrollDraftAction}>
                <input type="hidden" name="periodId" value={period.id} />
                <Button type="submit" variant="outline">
                  Hitung ulang
                </Button>
              </form>
            </>
          )}

          {period.status === "draft" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="approved" />
              <Button type="submit">Finalkan</Button>
            </form>
          )}

          {period.status === "approved" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="paid" />
              <Button type="submit">Tandai sudah dibayar</Button>
            </form>
          )}

          {period.status === "draft" && (
            <form action={deletePayrollDraftAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" variant="destructive">
                Hapus draft
              </Button>
            </form>
          )}

          {period.status === "paid" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="void" />
              <Button type="submit" variant="outline">
                Batalkan
              </Button>
            </form>
          )}
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Bruto" value={rupiah(totalGross)} />
        <StatCard label="Potongan" value={rupiah(totalDeductions)} hint="kasbon & potongan lain" />
        <StatCard label="Total net" value={rupiah(totalNet)} hint="yang dibayarkan" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Berkas transfer</CardTitle>
          <CardDescription>
            {payoutSummary.rowCount} penerima · {rupiah(payoutSummary.total)} siap ditransfer.
            {payoutSummary.transferredCount > 0
              ? ` ${payoutSummary.transferredCount} sudah ditandai ditransfer.`
              : ""}{" "}
            Hanya slip yang sudah difinalkan dan punya rekening valid yang masuk berkas. Berkas per
            bank hanya memuat rekening bank itu; format generik memuat semua bank.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {PAYOUT_FORMATS.map((format) => {
            const rows = rowsForFormat(payout, format);
            const total = rows.reduce((sum, row) => sum + row.amount, 0);
            const label = formatLabel.get(format) ?? format;
            return (
              <div key={format} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {rows.length} penerima · {rupiah(total)}
                  </p>
                </div>
                {rows.length > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/admin/payroll/${period.id}/transfer?format=${format}`}>
                      Unduh {format === "generic" ? "generik" : format.toUpperCase()}
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">belum ada penerima</span>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Nama berkas memuat periode dan tanggal ekspor. Baris terakhir selalu baris kontrol{" "}
            <span className="font-mono">TOTAL,&lt;jumlah penerima&gt;,&lt;jumlah nominal&gt;</span>{" "}
            supaya total bisa dicocokkan dengan rekap di atas.
          </p>
        </CardContent>
      </Card>

      {payout.failures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tidak ikut transfer ({payout.failures.length})</CardTitle>
            <CardDescription>
              Slip berikut sudah difinalkan tetapi tidak bisa ditransfer. Lengkapi rekeningnya di
              data karyawan, lalu unduh berkasnya lagi — slip yang sama tidak akan dobel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payout.failures.map((failure) => (
                  <TableRow key={failure.slipId}>
                    <TableCell>
                      <Link href={`/admin/karyawan/${failure.employeeId}`} className="hover:underline">
                        {failure.employeeName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(failure.amount)}</TableCell>
                    <TableCell className="text-xs text-destructive">{failure.reason}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/karyawan/${failure.employeeId}?tab=akun`}>Isi rekening</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalSaldo > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dibayar lewat saldo</CardTitle>
            <CardDescription>
              {rupiah(totalSaldo)} dari bruto periode ini sudah dibayar di muka lewat saldo, jadi
              tidak perlu diserahkan lagi. Angka &quot;net&quot; di bawah adalah uang tunai yang masih
              harus dibayar — kalau saldo tidak cukup, selisihnya otomatis masuk ke net.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {slips.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Slip gaji</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState title="Tidak ada slip" hint="Periode ini belum punya karyawan yang dihitung." />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {slips.map((slip) => {
            const slipItems = itemsBySlip.get(slip.id) ?? [];
            return (
              <Card key={slip.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle>
                        <Link href={`/admin/karyawan/${slip.employeeId}`} className="hover:underline">
                          {slip.employeeName}
                        </Link>
                      </CardTitle>
                      <CardDescription>
                        {PAY_TYPE_LABEL[slip.payType]} · tarif {rupiah(toNumber(slip.payRate))}
                      </CardDescription>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {slip.bankCode && slip.bankAccountNumber
                          ? `${bankLabel(slip.bankCode)} ${maskAccountNumber(slip.bankAccountNumber)} a.n. ${slip.bankAccountName ?? "-"}`
                          : "Rekening belum diisi — slip ini tidak ikut berkas transfer."}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/payroll/${period.id}/slip/${slip.employeeId}`}>
                            Cetak slip
                          </Link>
                        </Button>
                        {slip.transferredAt ? (
                          <span className="text-xs text-muted-foreground">
                            sudah ditransfer {formatDateTimeID(slip.transferredAt)}
                          </span>
                        ) : isPayoutEligible(slip.status) && transferRowsByEmployee.has(slip.employeeId) ? (
                          <form action={markSlipTransferredAction}>
                            <input type="hidden" name="slipId" value={slip.id} />
                            <input type="hidden" name="backTo" value={`/admin/payroll/${period.id}`} />
                            <Button type="submit" variant="outline" size="sm">
                              Tandai sudah ditransfer
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{rupiah(toNumber(slip.net))}</p>
                      <p className="text-xs text-muted-foreground">
                        bruto {rupiah(toNumber(slip.gross))} · potongan{" "}
                        {rupiah(toNumber(slip.totalDeductions))}
                      </p>
                      {toNumber(slip.saldoCovered) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          termasuk saldo {rupiah(toNumber(slip.saldoCovered))}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Komponen</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Tarif</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {slipItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell
                            className={isDeductionLine(item.kind) ? "text-destructive" : undefined}
                          >
                            {item.label}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {toNumber(item.qty)} {item.unit}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {rupiah(toNumber(item.unitRate))}
                          </TableCell>
                          <TableCell
                            className={
                              isDeductionLine(item.kind)
                                ? "text-right font-medium tabular-nums text-destructive"
                                : "text-right font-medium tabular-nums"
                            }
                          >
                            {isDeductionLine(item.kind) ? "−" : ""}
                            {rupiah(toNumber(item.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Slip menyimpan snapshot tarif &amp; kuantitas saat payroll dihitung, jadi perubahan tarif
        berikutnya tidak mengubah slip lama.
        {period.status === "draft"
          ? " Draft masih bisa dihitung ulang setelah rencana potong kasbon diubah."
          : ""}
      </p>
    </>
  );
}
