import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createAdvanceAction, decideAdvanceAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Stat, Table, Td, btnDanger, btnPrimary, inputClass } from "@/components/ui";
import { formatDateID, localDateString, rupiah, toNumber } from "@/lib/utils";

export default async function AdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  const [staff, rows] = await Promise.all([
    db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
      .orderBy(employees.fullName),
    db
      .select({
        id: cashAdvances.id,
        principal: cashAdvances.principal,
        balance: cashAdvances.balance,
        installmentAmount: cashAdvances.installmentAmount,
        requestedAt: cashAdvances.requestedAt,
        status: cashAdvances.status,
        note: cashAdvances.note,
        employeeId: employees.id,
        employeeName: employees.fullName,
      })
      .from(cashAdvances)
      .innerJoin(employees, eq(cashAdvances.employeeId, employees.id))
      .where(eq(cashAdvances.orgId, org.id))
      .orderBy(desc(cashAdvances.requestedAt))
      .limit(100),
  ]);

  const outstanding = rows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);
  const pending = rows.filter((row) => row.status === "pending");

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-stone-900">Kasbon</h1>
        <p className="text-sm text-muted">
          Kasbon approved otomatis dipotong dari slip gaji berikutnya (cicilan atau penuh).
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Sisa kasbon" value={rupiah(outstanding)} tone={outstanding > 0 ? "warn" : "default"} />
        <Stat label="Menunggu approval" value={pending.length} tone={pending.length > 0 ? "warn" : "default"} />
        <Stat label="Total pengajuan" value={rows.length} />
      </div>

      <Card title="Ajukan kasbon">
        <form action={createAdvanceAction} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="backTo" value="/admin/kasbon" />
          <Field label="Karyawan">
            <select name="employeeId" className={inputClass} required>
              <option value="">Pilih karyawan…</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pokok (Rp)">
            <input name="principal" className={inputClass} inputMode="numeric" placeholder="1000000" required />
          </Field>
          <Field label="Cicilan per periode (Rp)" hint="Kosong = potong penuh sekali bayar">
            <input name="installmentAmount" className={inputClass} inputMode="numeric" placeholder="250000" />
          </Field>
          <Field label="Tanggal pengajuan">
            <input type="date" name="requestedAt" className={inputClass} defaultValue={today} />
          </Field>
          <Field label="Catatan" className="sm:col-span-2">
            <input name="note" className={inputClass} placeholder="opsional" />
          </Field>
          <div className="flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>
              Simpan
            </button>
          </div>
        </form>
      </Card>

      <Card title="Daftar kasbon">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada kasbon" />
        ) : (
          <Table head={["Karyawan", "Tanggal", "Pokok", "Sisa", "Cicilan", "Status", ""]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium text-stone-900">
                    {row.employeeName}
                  </Link>
                </Td>
                <Td className="tabular-nums text-stone-600">{formatDateID(row.requestedAt)}</Td>
                <Td className="tabular-nums">{rupiah(toNumber(row.principal))}</Td>
                <Td className="tabular-nums font-medium">{rupiah(toNumber(row.balance))}</Td>
                <Td className="tabular-nums text-stone-600">
                  {row.installmentAmount ? rupiah(toNumber(row.installmentAmount)) : "penuh"}
                </Td>
                <Td>
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
                </Td>
                <Td>
                  {row.status === "pending" && (
                    <form action={decideAdvanceAction} className="flex gap-2">
                      <input type="hidden" name="advanceId" value={row.id} />
                      <button type="submit" name="decision" value="approve" className={`${btnPrimary} h-8 px-3 text-xs`}>
                        Setujui
                      </button>
                      <button type="submit" name="decision" value="reject" className={`${btnDanger} h-8 px-3 text-xs`}>
                        Tolak
                      </button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
