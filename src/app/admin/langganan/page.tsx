import { requireAdmin } from "@/lib/session";
import { loadBillingState, sumPaid } from "@/lib/billing-server";
import { recordPaymentAction } from "../actions";
import { Flash } from "@/components/flash";
import { FormField, SelectInput } from "@/components/form-field";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateID, formatDateTimeID, localDateString, rupiah, toNumber } from "@/lib/format";
import {
  ANNUAL_BILLED_MONTHS,
  branchQuota,
  CYCLE_LABEL,
  employeeQuota,
  PLAN_LIST,
  planLabel,
  planPrice,
} from "@/lib/plans";

const STATUS_TONE: Record<string, Tone> = {
  active: "good",
  free: "info",
  expired: "bad",
  cancelled: "default",
  paid: "good",
  unpaid: "warn",
};

const STATUS_LABEL: Record<string, string> = {
  active: "aktif",
  free: "gratis",
  expired: "kedaluwarsa",
  cancelled: "dibatalkan",
  paid: "lunas",
  unpaid: "belum bayar",
};

const METHOD_LABEL: Record<string, string> = {
  transfer: "Transfer",
  qris: "QRIS",
};

/** Sisa kuota atau "tanpa batas"; dipakai di kartu pemakaian. */
function quotaText(limit: number | null, remaining: number | null): string {
  if (limit === null) return "tanpa batas";
  return `sisa ${remaining ?? 0} dari ${limit}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const state = await loadBillingState(org.id, today);

  const employeeUse = employeeQuota(state.plan.id, state.employeesUsed);
  const branchUse = branchQuota(state.plan.id, state.branchesUsed);
  const paidTotal = sumPaid(state.invoices);

  const employeePercent =
    employeeUse.limit === null
      ? 0
      : Math.min(100, Math.round((state.employeesUsed / employeeUse.limit) * 100));
  const branchPercent =
    branchUse.limit === null
      ? 0
      : Math.min(100, Math.round((state.branchesUsed / branchUse.limit) * 100));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Langganan</h1>
        <p className="text-sm text-muted-foreground">
          Paket {state.plan.name}, kuota pemakaian, dan tagihan {org.name}. Pembayaran dicatat manual
          (transfer/QRIS) — belum ada payment gateway.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Paket aktif"
          value={state.plan.name}
          hint={
            state.hasSubscription
              ? `${CYCLE_LABEL[state.cycle]} · ${state.status === "expired" ? "periode lewat" : "berjalan"}`
              : "belum ada langganan — dianggap paket Gratis"
          }
        />
        <StatCard
          label="Periode berakhir"
          value={state.periodEnd ? formatDateID(state.periodEnd) : "—"}
          hint={
            state.periodStart && state.periodEnd
              ? `${formatDateID(state.periodStart)} s/d ${formatDateID(state.periodEnd)}`
              : "paket Gratis tanpa periode"
          }
        />
        <StatCard
          label="Total dibayar"
          value={rupiah(paidTotal)}
          hint={`${state.invoices.filter((row) => row.status === "paid").length} tagihan lunas`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pemakaian vs kuota</CardTitle>
          <CardDescription>
            Kuota paket {state.plan.name}: {employeeUse.limit ?? "tanpa batas"} karyawan aktif,{" "}
            {branchUse.limit ?? "tanpa batas"} cabang.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">Karyawan aktif</span>
              <span className="tabular-nums text-muted-foreground">
                {state.employeesUsed}
                {employeeUse.limit === null ? "" : ` / ${employeeUse.limit}`} ·{" "}
                {quotaText(employeeUse.limit, employeeUse.remaining)}
              </span>
            </div>
            <Progress value={employeePercent} />
            {employeeUse.allowed ? null : (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Kuota karyawan penuh: menambah karyawan baru akan ditolak sampai paket dinaikkan
                atau karyawan lain dinonaktifkan. Data yang sudah ada tetap bisa dibuka.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">Cabang</span>
              <span className="tabular-nums text-muted-foreground">
                {state.branchesUsed}
                {branchUse.limit === null ? "" : ` / ${branchUse.limit}`} ·{" "}
                {quotaText(branchUse.limit, branchUse.remaining)}
              </span>
            </div>
            <Progress value={branchPercent} />
            <p className="text-xs text-muted-foreground">
              Satu cabang = satu organisasi di akun owner yang sama.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pilihan paket</CardTitle>
          <CardDescription>
            Tagihan tahunan = {ANNUAL_BILLED_MONTHS}× harga bulanan, jadi 2 bulan gratis untuk
            periode 12 bulan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Bulanan</TableHead>
                <TableHead className="text-right">Tahunan</TableHead>
                <TableHead className="text-right">Karyawan</TableHead>
                <TableHead className="text-right">Cabang</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLAN_LIST.map((plan) => {
                const active = plan.id === state.plan.id;
                return (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={active ? "font-semibold" : "font-medium"}>{plan.name}</span>
                        {active ? <StatusBadge tone="good">aktif</StatusBadge> : null}
                        {plan.highlight ? <StatusBadge tone="info">rekomendasi</StatusBadge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{plan.tagline}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {planPrice(plan.id, "monthly") === null
                        ? "nego"
                        : rupiah(planPrice(plan.id, "monthly"))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {planPrice(plan.id, "annual") === null
                        ? "nego"
                        : rupiah(planPrice(plan.id, "annual"))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.employeeLimit ?? "∞"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{plan.branchLimit ?? "∞"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catat pembayaran</CardTitle>
          <CardDescription>
            Untuk transfer manual atau QRIS. Nominal paket Dasar/Lengkap diisi otomatis; paket
            Konsultan harganya nego jadi isi nominal sendiri.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={recordPaymentAction} className="grid gap-4 sm:grid-cols-2">
            <FormField label="Paket" hint="Paket berlaku untuk seluruh organisasi ini.">
              <SelectInput name="plan" defaultValue={state.plan.id}>
                {PLAN_LIST.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                    {planPrice(plan.id, "monthly") === null
                      ? " (nego)"
                      : ` — ${rupiah(planPrice(plan.id, "monthly"))}/bulan`}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField
              label="Siklus"
              hint={`Bulanan +1 bulan · Tahunan +12 bulan seharga ${ANNUAL_BILLED_MONTHS}× bulanan.`}
            >
              <SelectInput name="cycle" defaultValue={state.cycle}>
                <option value="monthly">Bulanan</option>
                <option value="annual">Tahunan (2 bulan gratis)</option>
              </SelectInput>
            </FormField>
            <FormField label="Metode" hint="Bukti transfer disimpan di luar aplikasi.">
              <SelectInput name="method" defaultValue="transfer">
                <option value="transfer">Transfer bank</option>
                <option value="qris">QRIS</option>
              </SelectInput>
            </FormField>
            <FormField
              label="Nominal (opsional)"
              hint="Kosongkan untuk paket dengan harga tetap. Wajib untuk paket Konsultan."
            >
              <Input name="amount" type="number" min={0} step={1000} placeholder="0" />
            </FormField>
            <FormField label="Catatan" className="sm:col-span-2" hint="Mis. nama pengirim & bank.">
              <Input name="note" maxLength={200} placeholder="Transfer BCA a/n ..." />
            </FormField>
            <div className="sm:col-span-2">
              <Button type="submit">Simpan pembayaran</Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Periode baru dihitung dari sehari setelah periode aktif berakhir, jadi sisa hari
                yang sudah dibayar tidak hangus. Upgrade/turun paket belum diprorata.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat tagihan</CardTitle>
          <CardDescription>
            {state.invoices.length === 0
              ? "Belum ada tagihan — organisasi masih di paket Gratis."
              : `${state.invoices.length} tagihan terakhir.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.invoices.length === 0 ? (
            <EmptyState
              title="Belum ada tagihan"
              hint="Catat pembayaran pertama di form di atas untuk mengaktifkan paket berbayar."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor</TableHead>
                  <TableHead>Terbit</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">{invoice.number}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(invoice.issuedAt)}
                    </TableCell>
                    <TableCell>
                      {planLabel(invoice.plan)}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {CYCLE_LABEL[invoice.cycle as "monthly" | "annual"] ?? invoice.cycle}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateID(invoice.periodStart)} s/d {formatDateID(invoice.periodEnd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupiah(toNumber(invoice.amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.method ? METHOD_LABEL[invoice.method] ?? invoice.method : "—"}
                      {invoice.paidAt ? (
                        <span className="block text-xs">{formatDateTimeID(invoice.paidAt)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[invoice.status] ?? "default"}>
                        {STATUS_LABEL[invoice.status] ?? invoice.status}
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
