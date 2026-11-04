import type { PayslipDoc } from "@/lib/payslip-doc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAY_TYPE_LABEL, formatDateID, formatDateTimeID, rupiah, toNumber } from "@/lib/format";
import { DEDUCTION_LINE_KINDS } from "@/lib/payroll";
import { formatPct } from "@/lib/statutory";

const DEDUCTION_KINDS = DEDUCTION_LINE_KINDS;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  final: "Final",
  paid: "Sudah dibayar",
};

type Item = PayslipDoc["items"][number];

function ItemRows({ items, negative }: { items: Item[]; negative?: boolean }) {
  if (items.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-center text-muted-foreground">
          {negative ? "Tidak ada potongan." : "Tidak ada komponen penerimaan."}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="font-medium whitespace-normal">{item.label}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {toNumber(item.qty)} {item.unit}
          </TableCell>
          <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
            {rupiah(toNumber(item.unitRate))}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {negative ? "−" : ""}
            {rupiah(toNumber(item.amount))}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function PayslipSheet({ orgName, doc }: { orgName: string; doc: PayslipDoc }) {
  const { slip, employee, period, items } = doc;

  const earnings = items.filter((item) => !DEDUCTION_KINDS.has(item.kind));
  const deductions = items.filter((item) => DEDUCTION_KINDS.has(item.kind));

  // Snapshot pajak/BPJS yang tersimpan di slip. Slip lama (sebelum fitur ini) tidak
  // punya snapshot, jadi bagian ini tidak dirender sama sekali untuk slip tersebut.
  const statutory = slip.statutory;
  const employerLines = statutory?.bpjs.filter((line) => line.employer > 0) ?? [];
  const statutoryWarnings = statutory?.warnings ?? [];

  return (
    <Card className="mx-auto w-full max-w-[210mm] print:max-w-none print:ring-0">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{orgName}</CardTitle>
            <CardDescription>Slip gaji karyawan</CardDescription>
          </div>
          <div className="text-right">
            <CardDescription>Periode</CardDescription>
            <p className="font-semibold tabular-nums">
              {formatDateID(period.periodStart)} – {formatDateID(period.periodEnd)}
            </p>
            <CardDescription>
              {STATUS_LABEL[slip.status] ?? slip.status}
              {period.payDate ? ` · bayar ${formatDateID(period.payDate)}` : ""}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Nama</dt>
            <dd className="font-medium">{employee.fullName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Kode</dt>
            <dd className="font-medium">{employee.code ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tipe gaji</dt>
            <dd className="font-medium">{PAY_TYPE_LABEL[slip.payType] ?? slip.payType}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tarif</dt>
            <dd className="font-medium tabular-nums">{rupiah(toNumber(slip.payRate))}</dd>
          </div>
        </dl>

        <Separator />

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Penerimaan</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Komponen</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Tarif</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ItemRows items={earnings} />
            </TableBody>
          </Table>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Potongan</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Komponen</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Tarif</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ItemRows items={deductions} negative />
            </TableBody>
          </Table>
        </section>

        <Separator />

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Bruto</dt>
            <dd className="text-base font-semibold tabular-nums">{rupiah(toNumber(slip.gross))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Potongan</dt>
            <dd className="text-base font-semibold tabular-nums">
              {rupiah(toNumber(slip.totalDeductions))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Diterima (net)</dt>
            <dd className="text-lg font-bold tabular-nums">{rupiah(toNumber(slip.net))}</dd>
          </div>
        </dl>

        {statutory && (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Iuran perusahaan (bukan potongan)</h2>
              <p className="text-xs text-muted-foreground">
                Ditanggung perusahaan dan tidak mengurangi net karyawan. Ditampilkan sebagai
                informasi biaya tenaga kerja.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Program</TableHead>
                    <TableHead className="text-right">Tarif</TableHead>
                    <TableHead className="text-right">Iuran perusahaan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employerLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Tidak ada iuran perusahaan.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {employerLines.map((line) => (
                        <TableRow key={`employer-${line.code}`}>
                          <TableCell className="font-medium">{line.label}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatPct(line.employerPct)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupiah(line.employer)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={2} className="font-semibold">
                          Total iuran perusahaan
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {rupiah(toNumber(slip.bpjsEmployer))}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </section>

            <p className="text-xs text-muted-foreground">
              PPh 21 metode setahun
              {statutory.pph21.computed
                ? ` · PTKP ${statutory.pph21.ptkpStatus} (${rupiah(statutory.pph21.ptkpAnnual)}/tahun) · PKP ${rupiah(statutory.pph21.pkp)}`
                : " · belum dihitung"}
              {statutory.pph21.noNpwp && statutory.pph21.computed ? " · tarif tanpa NPWP (+20%)" : ""}.
            </p>
          </>
        )}

        {statutoryWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Data pajak/BPJS perlu dilengkapi
            </p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-amber-700 dark:text-amber-400">
              {statutoryWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <CardDescription>
          Slip ini dibuat otomatis oleh sistem Gaji dan menyimpan snapshot tarif saat payroll dihitung.
          {slip.paidAt ? ` Dibayar ${formatDateTimeID(slip.paidAt)}.` : ""} Dicetak{" "}
          {formatDateTimeID(new Date())}.
        </CardDescription>
      </CardContent>
    </Card>
  );
}
