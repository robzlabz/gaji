import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cashAdvances,
  contracts,
  employees,
  payRateHistory,
  payslips,
  payPeriods,
  timeEntries,
} from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createAdvanceAction, createContractAction, resetPinAction, updateEmployeeAction } from "../../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Table, Td, btnGhost, btnPrimary, inputClass } from "@/components/ui";
import {
  CONTRACT_KIND_LABEL,
  PAY_TYPE_LABEL,
  formatDateID,
  formatTimeID,
  localDateString,
  minutesToHoursLabel,
  rupiah,
  toNumber,
} from "@/lib/utils";
import { workedMinutes } from "@/lib/payroll";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) notFound();

  const [contractRows, advanceRows, entryRows, slipRows, rateRows] = await Promise.all([
    db.select().from(contracts).where(eq(contracts.employeeId, id)).orderBy(desc(contracts.startDate)),
    db.select().from(cashAdvances).where(eq(cashAdvances.employeeId, id)).orderBy(desc(cashAdvances.requestedAt)),
    db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.employeeId, id))
      .orderBy(desc(timeEntries.clockInAt))
      .limit(8),
    db
      .select({
        id: payslips.id,
        net: payslips.net,
        gross: payslips.gross,
        status: payslips.status,
        periodStart: payPeriods.periodStart,
        periodEnd: payPeriods.periodEnd,
        periodId: payPeriods.id,
      })
      .from(payslips)
      .innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
      .where(eq(payslips.employeeId, id))
      .orderBy(desc(payPeriods.periodStart))
      .limit(6),
    db.select().from(payRateHistory).where(eq(payRateHistory.employeeId, id)).orderBy(desc(payRateHistory.effectiveFrom)),
  ]);

  const today = localDateString(new Date(), org.timezone);
  const outstanding = advanceRows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/karyawan" className="text-xs text-muted">
            ← Karyawan
          </Link>
          <h1 className="text-xl font-semibold text-stone-900">{employee.fullName}</h1>
          <p className="text-sm text-muted">
            {PAY_TYPE_LABEL[employee.payType]} · {rupiah(toNumber(employee.payRate))} · masuk{" "}
            {formatDateID(employee.joinedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {employee.isActive ? <Badge tone="brand">aktif</Badge> : <Badge tone="bad">nonaktif</Badge>}
          <Badge tone={employee.userId ? "good" : "default"}>
            {employee.userId ? "punya akun" : "tanpa akun"}
          </Badge>
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Data & tarif" subtitle="Perubahan tarif tercatat di riwayat.">
          <form action={updateEmployeeAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="employeeId" value={employee.id} />
            <Field label="Nama">
              <input name="fullName" className={inputClass} defaultValue={employee.fullName} />
            </Field>
            <Field label="NIK / kode">
              <input name="code" className={inputClass} defaultValue={employee.code ?? ""} />
            </Field>
            <Field label="Tipe penggajian">
              <select name="payType" className={inputClass} defaultValue={employee.payType}>
                <option value="hourly">Per jam</option>
                <option value="daily">Per hari</option>
                <option value="monthly">Per bulan</option>
                <option value="per_task">Per tugas</option>
              </select>
            </Field>
            <Field label="Tarif (Rp)">
              <input
                name="payRate"
                className={inputClass}
                inputMode="numeric"
                defaultValue={Math.round(toNumber(employee.payRate))}
              />
            </Field>
            <Field label="Tanggal berhenti" hint="Kosongkan bila masih aktif">
              <input type="date" name="endedAt" className={inputClass} defaultValue={employee.endedAt ?? ""} />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-stone-700">
              <input type="checkbox" name="isActive" defaultChecked={employee.isActive} className="h-4 w-4" />
              Karyawan aktif
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={btnPrimary}>
                Simpan perubahan
              </button>
            </div>
          </form>

          {rateRows.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-stone-700">Riwayat tarif</p>
              <ul className="space-y-1 text-xs text-muted">
                {rateRows.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    {formatDateID(row.effectiveFrom)} — {PAY_TYPE_LABEL[row.payType]} {rupiah(toNumber(row.payRate))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Akun login" subtitle="Nomor HP + PIN 6 digit">
            {employee.userId ? (
              <form action={resetPinAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <Field label="PIN baru" className="flex-1">
                  <input name="pin" className={inputClass} inputMode="numeric" maxLength={6} placeholder="6 digit" />
                </Field>
                <button type="submit" className={btnGhost}>
                  Ganti PIN
                </button>
              </form>
            ) : (
              <p className="text-sm text-muted">
                Karyawan ini belum punya akun login. Akun hanya bisa dibuat saat menambah karyawan baru.
              </p>
            )}
          </Card>

          <Card title="Kasbon" subtitle={`Sisa saldo ${rupiah(outstanding)}`}>
            <form action={createAdvanceAction} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="employeeId" value={employee.id} />
              <input type="hidden" name="backTo" value={`/admin/karyawan/${employee.id}`} />
              <Field label="Pokok kasbon">
                <input name="principal" className={inputClass} inputMode="numeric" placeholder="1000000" required />
              </Field>
              <Field label="Cicilan / periode" hint="Kosong = potong penuh">
                <input name="installmentAmount" className={inputClass} inputMode="numeric" placeholder="250000" />
              </Field>
              <Field label="Tanggal">
                <input type="date" name="requestedAt" className={inputClass} defaultValue={today} />
              </Field>
              <Field label="Catatan">
                <input name="note" className={inputClass} placeholder="Kebutuhan keluarga" />
              </Field>
              <div className="sm:col-span-2">
                <button type="submit" className={btnPrimary}>
                  Ajukan kasbon
                </button>
              </div>
            </form>

            {advanceRows.length > 0 && (
              <div className="mt-4">
                <Table head={["Tanggal", "Pokok", "Sisa", "Status"]}>
                  {advanceRows.slice(0, 5).map((row) => (
                    <tr key={row.id}>
                      <Td className="tabular-nums text-stone-600">{formatDateID(row.requestedAt)}</Td>
                      <Td className="tabular-nums">{rupiah(toNumber(row.principal))}</Td>
                      <Td className="tabular-nums">{rupiah(toNumber(row.balance))}</Td>
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
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Kontrak"
        subtitle="Kontrak baru menggantikan yang lama (status lama menjadi renewed)."
        action={
          <Link href="/admin/kontrak" className="text-xs font-medium text-brand">
            Semua kontrak
          </Link>
        }
      >
        {contractRows.length === 0 ? (
          <EmptyState title="Belum ada kontrak" hint="Tambahkan kontrak pertama di bawah." />
        ) : (
          <Table head={["Jenis", "Mulai", "Berakhir", "Tarif", "Status"]}>
            {contractRows.map((row) => (
              <tr key={row.id}>
                <Td className="text-stone-700">{CONTRACT_KIND_LABEL[row.kind] ?? row.kind}</Td>
                <Td className="tabular-nums text-stone-600">{formatDateID(row.startDate)}</Td>
                <Td className="tabular-nums text-stone-600">{row.endDate ? formatDateID(row.endDate) : "—"}</Td>
                <Td className="tabular-nums">{rupiah(toNumber(row.payRate))}</Td>
                <Td>
                  <Badge
                    tone={
                      row.status === "active" ? "good" : row.status === "expired" ? "bad" : "default"
                    }
                  >
                    {row.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}

        <form action={createContractAction} className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
          <input type="hidden" name="employeeId" value={employee.id} />
          <input type="hidden" name="backTo" value={`/admin/karyawan/${employee.id}`} />
          <Field label="Jenis kontrak">
            <select name="kind" className={inputClass} defaultValue="pkwt">
              <option value="pkwt">PKWT</option>
              <option value="probation">Percobaan</option>
              <option value="pkwtt">PKWTT</option>
              <option value="other">Lainnya</option>
            </select>
          </Field>
          <Field label="Mulai">
            <input type="date" name="startDate" className={inputClass} defaultValue={today} required />
          </Field>
          <Field label="Berakhir" hint="Kosongkan untuk PKWTT">
            <input type="date" name="endDate" className={inputClass} />
          </Field>
          <Field label="Tipe gaji">
            <select name="payType" className={inputClass} defaultValue={employee.payType}>
              <option value="hourly">Per jam</option>
              <option value="daily">Per hari</option>
              <option value="monthly">Per bulan</option>
              <option value="per_task">Per tugas</option>
            </select>
          </Field>
          <Field label="Tarif kontrak">
            <input
              name="payRate"
              className={inputClass}
              inputMode="numeric"
              defaultValue={Math.round(toNumber(employee.payRate))}
            />
          </Field>
          <div className="flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>
              Tambah kontrak
            </button>
          </div>
        </form>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Absensi terakhir">
          {entryRows.length === 0 ? (
            <EmptyState title="Belum ada absensi" />
          ) : (
            <Table head={["Tanggal", "Masuk", "Keluar", "Durasi", "Status"]}>
              {entryRows.map((row) => (
                <tr key={row.id}>
                  <Td className="tabular-nums text-stone-600">{formatDateID(row.workDate)}</Td>
                  <Td className="tabular-nums text-stone-600">{formatTimeID(row.clockInAt)}</Td>
                  <Td className="tabular-nums text-stone-600">
                    {row.clockOutAt ? formatTimeID(row.clockOutAt) : "—"}
                  </Td>
                  <Td className="tabular-nums">{minutesToHoursLabel(workedMinutes({
                    id: row.id,
                    workDate: row.workDate,
                    clockInAt: row.clockInAt,
                    clockOutAt: row.clockOutAt,
                    breakMinutes: row.breakMinutes,
                    overtimeMinutes: row.overtimeMinutes,
                  }))}</Td>
                  <Td>
                    <Badge
                      tone={row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"}
                    >
                      {row.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Slip gaji terakhir">
          {slipRows.length === 0 ? (
            <EmptyState title="Belum ada slip gaji" />
          ) : (
            <Table head={["Periode", "Bruto", "Net", "Status"]}>
              {slipRows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <Link href={`/admin/payroll/${row.periodId}`} className="text-brand">
                      {formatDateID(row.periodStart)} – {formatDateID(row.periodEnd)}
                    </Link>
                  </Td>
                  <Td className="tabular-nums">{rupiah(toNumber(row.gross))}</Td>
                  <Td className="tabular-nums font-medium">{rupiah(toNumber(row.net))}</Td>
                  <Td>
                    <Badge tone={row.status === "paid" ? "good" : "default"}>{row.status}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
