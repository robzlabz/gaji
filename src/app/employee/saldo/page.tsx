import { requireEmployee } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID, rupiah, rupiahShort, toNumber } from "@/lib/format";
import { isSaldoLow, saldoKindLabel, saldoKindTone, saldoMessage, saldoTone } from "@/lib/saldo";
import { loadSaldoHistory } from "@/lib/saldo-server";

/**
 * Saldo karyawan (read-only).
 *
 * Karyawan tidak boleh mengubah saldo sendiri — yang tampil hanya sisa saldo dan
 * riwayat pemotongan, supaya jelas kenapa uang yang diterima berbeda dari jumlah jam kerja.
 */
export default async function EmployeeSaldoPage() {
  const { org, employee } = await requireEmployee();
  const history = await loadSaldoHistory(org.id, employee.id, 40);

  const accruals = history.txns.filter((txn) => txn.kind === "accrual");
  const lastAccrual = accruals[0];
  const totalReceived = history.txns
    .filter(
      (txn) =>
        txn.kind === "topup" ||
        txn.kind === "adjust" ||
        txn.kind === "settle" ||
        txn.kind === "kasbon",
    )
    .reduce((sum, txn) => sum + toNumber(txn.amount), 0);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Saldo saya</h1>
        <p className="text-sm text-muted-foreground">
          Uang yang sudah dikirim owner. Setiap absensi yang disetujui memotong saldo ini.
        </p>
      </header>

      {history.float === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum pakai sistem saldo</CardTitle>
            <CardDescription>
              Gaji kamu dibayar tunai/transfer saat payroll, bukan lewat saldo.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Saldo sekarang"
              value={rupiah(history.balance)}
              hint="sisa uang owner di kamu"
            />
            <StatCard
              label="Total diterima"
              value={rupiah(totalReceived)}
              hint="top up + pelunasan"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>{saldoMessage(history.balance)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge tone={saldoTone(history.balance)}>
                {history.balance < 0 ? "minus" : isSaldoLow(history.balance) ? "tipis" : "aman"}
              </StatusBadge>
              {lastAccrual && (
                <span className="text-muted-foreground">
                  Potongan terakhir {formatDateID(lastAccrual.occurredAt)} ·{" "}
                  {rupiahShort(Math.abs(toNumber(lastAccrual.amount)))}
                </span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat</CardTitle>
              <CardDescription>40 transaksi terakhir.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.txns.length === 0 ? (
                <EmptyState title="Belum ada transaksi" />
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.txns.map((txn) => {
                    const amount = toNumber(txn.amount);
                    return (
                      <li
                        key={txn.id}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {saldoKindLabel(txn.kind)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {formatDateID(txn.occurredAt)}
                            {txn.note ? ` · ${txn.note}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={
                              amount < 0
                                ? "tabular-nums font-medium text-red-600 dark:text-red-400"
                                : "tabular-nums font-medium text-emerald-700 dark:text-emerald-400"
                            }
                          >
                            {amount > 0 ? "+" : "−"}
                            {rupiahShort(Math.abs(amount))}
                          </span>
                          <StatusBadge tone={saldoKindTone(txn.kind)}>
                            {amount < 0 ? "potong" : "masuk"}
                          </StatusBadge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
