import type { PayslipDoc } from "@/lib/payslip-doc";
import { PAY_TYPE_LABEL, formatDateID, formatDateTimeID, rupiah, toNumber } from "@/lib/utils";

const DEDUCTION_KINDS = new Set(["kasbon", "deduction"]);

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  final: "Final",
  paid: "Sudah dibayar",
};

function Row({
  label,
  qty,
  unit,
  unitRate,
  amount,
  negative,
}: {
  label: string;
  qty: number;
  unit: string;
  unitRate: number;
  amount: number;
  negative?: boolean;
}) {
  return (
    <tr className="border-b border-stone-200 last:border-0">
      <td className="py-1.5 pr-3 text-stone-800">{label}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-stone-600">
        {qty} {unit}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-stone-600">{rupiah(unitRate)}</td>
      <td className="py-1.5 text-right tabular-nums font-medium text-stone-900">
        {negative ? "−" : ""}
        {rupiah(amount)}
      </td>
    </tr>
  );
}

export function PayslipSheet({ orgName, doc }: { orgName: string; doc: PayslipDoc }) {
  const { slip, employee, period, items } = doc;

  const earnings = items.filter((item) => !DEDUCTION_KINDS.has(item.kind));
  const deductions = items.filter((item) => DEDUCTION_KINDS.has(item.kind));

  return (
    <article className="mx-auto w-full max-w-[210mm] rounded-2xl border border-line bg-white p-8 text-sm text-stone-800 print:max-w-none print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-6 border-b border-stone-300 pb-4">
        <div>
          <p className="text-base font-semibold text-stone-900">{orgName}</p>
          <p className="text-xs text-stone-500">Slip gaji karyawan</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-stone-500">Periode</p>
          <p className="font-semibold text-stone-900">
            {formatDateID(period.periodStart)} – {formatDateID(period.periodEnd)}
          </p>
          <p className="text-xs text-stone-500">
            {STATUS_LABEL[slip.status] ?? slip.status}
            {period.payDate ? ` · bayar ${formatDateID(period.payDate)}` : ""}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-stone-300 py-4 text-xs sm:grid-cols-4">
        <div>
          <p className="text-stone-500">Nama</p>
          <p className="text-sm font-medium text-stone-900">{employee.fullName}</p>
        </div>
        <div>
          <p className="text-stone-500">Kode</p>
          <p className="text-sm font-medium text-stone-900">{employee.code ?? "—"}</p>
        </div>
        <div>
          <p className="text-stone-500">Tipe gaji</p>
          <p className="text-sm font-medium text-stone-900">{PAY_TYPE_LABEL[slip.payType] ?? slip.payType}</p>
        </div>
        <div>
          <p className="text-stone-500">Tarif</p>
          <p className="text-sm font-medium text-stone-900">{rupiah(toNumber(slip.payRate))}</p>
        </div>
      </section>

      <section className="py-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Penerimaan</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="py-1 pr-3 font-medium">Komponen</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 pr-3 text-right font-medium">Tarif</th>
              <th className="py-1 text-right font-medium">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {earnings.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-stone-500">
                  Tidak ada komponen penerimaan.
                </td>
              </tr>
            ) : (
              earnings.map((item) => (
                <Row
                  key={item.id}
                  label={item.label}
                  qty={toNumber(item.qty)}
                  unit={item.unit}
                  unitRate={toNumber(item.unitRate)}
                  amount={toNumber(item.amount)}
                />
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="pb-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Potongan</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="py-1 pr-3 font-medium">Komponen</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 pr-3 text-right font-medium">Tarif</th>
              <th className="py-1 text-right font-medium">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {deductions.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-stone-500">
                  Tidak ada potongan.
                </td>
              </tr>
            ) : (
              deductions.map((item) => (
                <Row
                  key={item.id}
                  label={item.label}
                  qty={toNumber(item.qty)}
                  unit={item.unit}
                  unitRate={toNumber(item.unitRate)}
                  amount={toNumber(item.amount)}
                  negative
                />
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-3 gap-3 border-t border-stone-300 pt-4 text-xs">
        <div>
          <p className="text-stone-500">Bruto</p>
          <p className="text-sm font-semibold tabular-nums text-stone-900">{rupiah(toNumber(slip.gross))}</p>
        </div>
        <div>
          <p className="text-stone-500">Potongan</p>
          <p className="text-sm font-semibold tabular-nums text-stone-900">
            {rupiah(toNumber(slip.totalDeductions))}
          </p>
        </div>
        <div className="rounded-lg bg-stone-100 px-3 py-2">
          <p className="text-stone-500">Diterima (net)</p>
          <p className="text-base font-bold tabular-nums text-stone-900">{rupiah(toNumber(slip.net))}</p>
        </div>
      </section>

      <footer className="mt-6 flex items-end justify-between gap-6 border-t border-stone-300 pt-3 text-[11px] text-stone-500">
        <p>
          Slip ini dibuat otomatis oleh sistem Gaji dan menyimpan snapshot tarif saat payroll dihitung.
          {slip.paidAt ? ` Dibayar ${formatDateTimeID(slip.paidAt)}.` : ""}
        </p>
        <p className="whitespace-nowrap">Dicetak {formatDateTimeID(new Date())}</p>
      </footer>
    </article>
  );
}
