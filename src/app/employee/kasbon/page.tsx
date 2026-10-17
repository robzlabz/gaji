import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { requestAdvanceAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateID, rupiah, toNumber } from "@/lib/format";

export default async function EmployeeAdvances({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { employee } = await requireEmployee();
  const { ok, err } = await searchParams;

  const rows = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.employeeId, employee.id)))
    .orderBy(desc(cashAdvances.requestedAt));

  const outstanding = rows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Kasbon</h1>
        <p className="text-xs text-muted-foreground">
          Sisa kasbon dipotong otomatis dari slip gaji berikutnya.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <StatCard label="Sisa kasbon" value={rupiah(outstanding)} hint="belum dipotong ke gaji" />

      <Card>
        <CardHeader>
          <CardTitle>Ajukan kasbon</CardTitle>
          <CardDescription>Admin akan meninjau pengajuanmu.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={requestAdvanceAction} className="flex flex-col gap-3">
            <FormField label="Nominal (Rp)">
              <Input name="principal" inputMode="numeric" placeholder="500000" required />
            </FormField>
            <FormField label="Keterangan / catatan" hint="Opsional">
              <Input name="note" placeholder="biaya sekolah anak" />
            </FormField>
            <Button type="submit" className="w-full">
              Kirim pengajuan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat kasbon</CardTitle>
          <CardDescription>{rows.length} pengajuan</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada kasbon" />
          ) : (
            <ul className="flex flex-col divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums">
                      {rupiah(toNumber(row.principal))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateID(row.requestedAt)}
                      {row.installmentAmount
                        ? ` · cicilan ${rupiah(toNumber(row.installmentAmount))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-xs tabular-nums text-muted-foreground">
                      sisa {rupiah(toNumber(row.balance))}
                    </p>
                    <StatusBadge
                      tone={
                        row.status === "approved"
                          ? "good"
                          : row.status === "settled"
                            ? "info"
                            : row.status === "rejected"
                              ? "bad"
                              : "warn"
                      }
                    >
                      {row.status}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
