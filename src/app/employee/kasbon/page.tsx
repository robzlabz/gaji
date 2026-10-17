import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { requestAdvanceAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Stat, btnPrimary, inputClass } from "@/components/ui";
import { formatDateID, rupiah, toNumber } from "@/lib/utils";

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
        <h1 className="text-lg font-semibold text-stone-900">Kasbon</h1>
        <p className="text-xs text-muted">Sisa kasbon dipotong otomatis dari slip gaji berikutnya.</p>
      </header>

      <Flash ok={ok} err={err} />

      <Stat label="Sisa kasbon" value={rupiah(outstanding)} tone={outstanding > 0 ? "warn" : "default"} />

      <Card title="Ajukan kasbon" subtitle="Admin akan meninjau pengajuanmu.">
        <form action={requestAdvanceAction} className="space-y-3">
          <Field label="Nominal (Rp)">
            <input name="principal" className={inputClass} inputMode="numeric" placeholder="500000" required />
          </Field>
          <Field label="Keterangan / catatan" hint="Opsional">
            <input name="note" className={inputClass} placeholder="biaya sekolah anak" />
          </Field>
          <button type="submit" className={`${btnPrimary} w-full`}>
            Kirim pengajuan
          </button>
        </form>
      </Card>

      <Card title="Riwayat kasbon">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada kasbon" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium tabular-nums text-stone-900">
                    {rupiah(toNumber(row.principal))}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateID(row.requestedAt)}
                    {row.installmentAmount ? ` · cicilan ${rupiah(toNumber(row.installmentAmount))}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs tabular-nums text-muted">sisa {rupiah(toNumber(row.balance))}</p>
                  <Badge
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
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
