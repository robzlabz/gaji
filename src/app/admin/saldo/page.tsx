import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { topUpSaldoAction } from "../actions";
import { Flash } from "@/components/flash";
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
import { formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";
import { isSaldoLow, saldoTone } from "@/lib/saldo";
import { listSaldoOverview } from "@/lib/saldo-server";

export default async function SaldoPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  const [rows, staff] = await Promise.all([
    listSaldoOverview(org.id),
    db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        payType: employees.payType,
        transportRate: employees.transportRate,
      })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
      .orderBy(employees.fullName),
  ]);

  const withSaldo = rows.filter((row) => row.floatId !== null);
  const totalBalance = withSaldo.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  const totalMinus = withSaldo.reduce(
    (sum, row) => sum + Math.min(0, row.balance),
    0,
  );
  const low = withSaldo.filter((row) => isSaldoLow(row.balance));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Saldo</h1>
        <p className="text-sm text-muted-foreground">
          Uang yang dikirim lebih dulu ke karyawan. Setiap absensi approved otomatis memotong saldo.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Saldo beredar" value={rupiah(totalBalance)} hint="uang owner di tangan karyawan" />
        <StatCard
          label="Kurang bayar"
          value={rupiah(Math.abs(totalMinus))}
          hint="saldo minus — sudah kerja melebihi uang"
        />
        <StatCard label="Saldo tipis" value={low.length} hint="di bawah Rp 200.000" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kirim uang</CardTitle>
          <CardDescription>
            Saldo dibuat otomatis saat top up pertama. Tanpa saldo, karyawan dibayar tunai seperti biasa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={topUpSaldoAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="backTo" value="/admin/saldo" />
            <FormField label="Karyawan">
              <SelectInput name="employeeId" required defaultValue="">
                <option value="">Pilih karyawan…</option>
                {staff.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.fullName}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Nominal (Rp)">
              <Input name="amount" inputMode="numeric" placeholder="500000" required />
            </FormField>
            <FormField label="Tanggal kirim">
              <Input type="date" name="occurredAt" defaultValue={today} />
            </FormField>
            <FormField label="Catatan">
              <Input name="note" placeholder="opsional" />
            </FormField>
            <div className="sm:col-span-4">
              <Button type="submit">Tambah saldo</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saldo per karyawan</CardTitle>
          <CardDescription>
            {withSaldo.length === 0
              ? "Belum ada karyawan dengan sistem saldo."
              : `${withSaldo.length} karyawan memakai sistem saldo.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada karyawan" hint="Tambahkan karyawan dulu di menu Karyawan." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Ongkos/kedatangan</TableHead>
                  <TableHead>Saldo</TableHead>
                  <TableHead>Transaksi terakhir</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell>
                      <Link
                        href={`/admin/saldo/${row.employeeId}`}
                        className="font-medium hover:underline"
                      >
                        {row.employeeName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {toNumber(row.transportRate) > 0 ? rupiah(toNumber(row.transportRate)) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">{rupiah(row.balance)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.lastTxnAt ? formatDateID(row.lastTxnAt) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.floatId === null ? (
                        <StatusBadge>tunai</StatusBadge>
                      ) : (
                        <StatusBadge tone={saldoTone(row.balance)}>
                          {row.balance < 0 ? "minus" : isSaldoLow(row.balance) ? "tipis" : "aman"}
                        </StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/saldo/${row.employeeId}`}>Detail</Link>
                      </Button>
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
