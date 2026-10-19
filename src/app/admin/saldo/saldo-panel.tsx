import { db } from "@/db";
import { requireAdmin } from "@/lib/session";
import { adjustSaldoAction, resyncSaldoAction, topUpSaldoAction } from "../actions";
import { EmptyState } from "@/components/empty-state";
import { FormField, SelectInput } from "@/components/form-field";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
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
import {
  daysLeftFromSaldo,
  isSaldoLow,
  saldoKindLabel,
  saldoKindTone,
  saldoMessage,
  saldoTone,
} from "@/lib/saldo";
import { averageDailyAccrual, loadSaldoHistory } from "@/lib/saldo-server";

/**
 * Panel saldo satu karyawan: ringkasan, form top up/koreksi, dan riwayat ledger.
 *
 * Dipakai di dua tempat (tab Saldo pada detail karyawan dan halaman /admin/saldo/[id])
 * supaya angka dan aksi tidak pernah berbeda antar halaman.
 */
export async function SaldoPanel({
  employeeId,
  backTo,
  compact = false,
}: {
  employeeId: string;
  backTo: string;
  /** true = tanpa judul kartu (dipakai di dalam tab). */
  compact?: boolean;
}) {
  const { org } = await requireAdmin();
  const today = localDateString(new Date(), org.timezone);

  const history = await loadSaldoHistory(org.id, employeeId);
  const since = localDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), org.timezone);
  const average = await averageDailyAccrual(db, {
    orgId: org.id,
    employeeId,
    since,
  });
  const daysLeft = daysLeftFromSaldo(history.balance, average);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Saldo sekarang"
          value={rupiah(history.balance)}
          hint={history.float ? "uang owner yang belum terpakai" : "belum pernah top up"}
        />
        <StatCard
          label="Rata-rata / hari kerja"
          value={average > 0 ? rupiah(average) : "—"}
          hint="30 hari terakhir"
        />
        <StatCard
          label="Cukup untuk"
          value={
            daysLeft === null
              ? "—"
              : daysLeft <= 0
                ? "< 1 hari"
                : `${daysLeft} hari`
          }
          hint="perkiraan dari rata-rata di atas"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status saldo</CardTitle>
          <CardDescription>{saldoMessage(history.balance)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={saldoTone(history.balance)}>
            {history.balance < 0 ? "minus" : isSaldoLow(history.balance) ? "tipis" : "aman"}
          </StatusBadge>
          <form action={resyncSaldoAction}>
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="backTo" value={backTo} />
            <Button type="submit" variant="outline" size="sm">
              Hitung ulang dari absensi approved
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kirim uang (top up)</CardTitle>
            <CardDescription>Menambah saldo karyawan.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={topUpSaldoAction} className="flex flex-col gap-3">
              <input type="hidden" name="employeeId" value={employeeId} />
              <input type="hidden" name="backTo" value={backTo} />
              <FormField label="Nominal (Rp)">
                <Input name="amount" inputMode="numeric" placeholder="500000" required />
              </FormField>
              <FormField label="Tanggal kirim">
                <Input type="date" name="occurredAt" defaultValue={today} />
              </FormField>
              <FormField label="Catatan">
                <Input name="note" placeholder="mis. transfer BCA" />
              </FormField>
              <div>
                <Button type="submit">Tambah saldo</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Koreksi saldo</CardTitle>
            <CardDescription>Untuk uang tunai atau selisih yang tidak tercatat.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={adjustSaldoAction} className="flex flex-col gap-3">
              <input type="hidden" name="employeeId" value={employeeId} />
              <input type="hidden" name="backTo" value={backTo} />
              <FormField label="Arah koreksi">
                <SelectInput name="direction" defaultValue="in">
                  <option value="in">Tambah saldo (+)</option>
                  <option value="out">Kurangi saldo (−)</option>
                </SelectInput>
              </FormField>
              <FormField label="Nominal (Rp)">
                <Input name="amount" inputMode="numeric" placeholder="50000" required />
              </FormField>
              <FormField label="Tanggal">
                <Input type="date" name="occurredAt" defaultValue={today} />
              </FormField>
              <FormField label="Alasan">
                <Input name="note" placeholder="wajib jelas: ini uang apa" required />
              </FormField>
              <div>
                <Button type="submit" variant="outline">
                  Simpan koreksi
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat saldo</CardTitle>
          <CardDescription>
            {compact ? "" : "60 transaksi terakhir · "}
            Top up menambah, absensi approved memotong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.txns.length === 0 ? (
            <EmptyState
              title="Belum ada transaksi saldo"
              hint="Top up pertama akan membuat baris saldo karyawan ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Nominal</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.txns.map((txn) => {
                  const amount = toNumber(txn.amount);
                  return (
                    <TableRow key={txn.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateID(txn.occurredAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={saldoKindTone(txn.kind)}>
                          {saldoKindLabel(txn.kind)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell
                        className={
                          amount < 0
                            ? "tabular-nums font-medium text-red-600 dark:text-red-400"
                            : "tabular-nums font-medium text-emerald-700 dark:text-emerald-400"
                        }
                      >
                        {amount > 0 ? "+" : "−"}
                        {rupiahShort(Math.abs(amount))}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {txn.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
