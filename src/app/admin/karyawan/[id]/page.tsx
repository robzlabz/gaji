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
import {
  createAdvanceAction,
  createContractAction,
  resetPinAction,
  updateEmployeeAction,
} from "../../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CheckField, FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONTRACT_KIND_LABEL,
  PAY_TYPE_LABEL,
  formatDateID,
  formatTimeID,
  localDateString,
  minutesToHoursLabel,
  rupiah,
  toNumber,
} from "@/lib/format";
import { workedMinutes } from "@/lib/payroll";

const PAY_TYPE_OPTIONS = [
  { value: "hourly", label: "Per jam" },
  { value: "daily", label: "Per hari" },
  { value: "monthly", label: "Per bulan" },
  { value: "per_task", label: "Per tugas" },
];

const CONTRACT_KIND_OPTIONS = [
  { value: "pkwt", label: "PKWT" },
  { value: "probation", label: "Percobaan" },
  { value: "pkwtt", label: "PKWTT" },
  { value: "other", label: "Lainnya" },
];

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
    db
      .select()
      .from(payRateHistory)
      .where(eq(payRateHistory.employeeId, id))
      .orderBy(desc(payRateHistory.effectiveFrom)),
  ]);

  const today = localDateString(new Date(), org.timezone);
  const outstanding = advanceRows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/karyawan" className="text-xs text-muted-foreground hover:underline">
            ← Karyawan
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{employee.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {PAY_TYPE_LABEL[employee.payType]} · {rupiah(toNumber(employee.payRate))} · masuk{" "}
            {formatDateID(employee.joinedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusBadge tone={employee.isActive ? "good" : "bad"}>
            {employee.isActive ? "aktif" : "nonaktif"}
          </StatusBadge>
          <StatusBadge tone={employee.userId ? "info" : "default"}>
            {employee.userId ? "punya akun" : "tanpa akun"}
          </StatusBadge>
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data &amp; tarif</CardTitle>
            <CardDescription>Perubahan tarif tercatat di riwayat.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form action={updateEmployeeAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="employeeId" value={employee.id} />
              <FormField label="Nama">
                <Input name="fullName" defaultValue={employee.fullName} />
              </FormField>
              <FormField label="NIK / kode">
                <Input name="code" defaultValue={employee.code ?? ""} />
              </FormField>
              <FormField label="Tipe penggajian">
                <SelectInput name="payType" defaultValue={employee.payType}>
                  {PAY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Tarif (Rp)">
                <Input
                  name="payRate"
                  inputMode="numeric"
                  defaultValue={Math.round(toNumber(employee.payRate))}
                />
              </FormField>
              <FormField label="Tanggal berhenti" hint="Kosongkan bila masih aktif">
                <Input type="date" name="endedAt" defaultValue={employee.endedAt ?? ""} />
              </FormField>
              <div className="flex items-end pb-1">
                <CheckField name="isActive" label="Karyawan aktif" defaultChecked={employee.isActive} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit">Simpan perubahan</Button>
              </div>
            </form>

            {rateRows.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium">Riwayat tarif</p>
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {rateRows.slice(0, 5).map((row) => (
                      <li key={row.id}>
                        {formatDateID(row.effectiveFrom)} — {PAY_TYPE_LABEL[row.payType]}{" "}
                        {rupiah(toNumber(row.payRate))}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Akun login</CardTitle>
              <CardDescription>Nomor HP + PIN 6 digit</CardDescription>
            </CardHeader>
            <CardContent>
              {employee.userId ? (
                <form action={resetPinAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="employeeId" value={employee.id} />
                  <FormField label="PIN baru" className="min-w-40 flex-1">
                    <Input name="pin" inputMode="numeric" maxLength={6} placeholder="6 digit" />
                  </FormField>
                  <Button type="submit" variant="outline">
                    Ganti PIN
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Karyawan ini belum punya akun login. Akun hanya bisa dibuat saat menambah karyawan
                  baru.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kasbon</CardTitle>
              <CardDescription>Sisa saldo {rupiah(outstanding)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form action={createAdvanceAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <input type="hidden" name="backTo" value={`/admin/karyawan/${employee.id}`} />
                <FormField label="Pokok kasbon">
                  <Input name="principal" inputMode="numeric" placeholder="1000000" required />
                </FormField>
                <FormField label="Cicilan / periode" hint="Kosong = potong penuh">
                  <Input name="installmentAmount" inputMode="numeric" placeholder="250000" />
                </FormField>
                <FormField label="Tanggal">
                  <Input type="date" name="requestedAt" defaultValue={today} />
                </FormField>
                <FormField label="Catatan">
                  <Input name="note" placeholder="Kebutuhan keluarga" />
                </FormField>
                <div className="sm:col-span-2">
                  <Button type="submit">Ajukan kasbon</Button>
                </div>
              </form>

              {advanceRows.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Pokok</TableHead>
                      <TableHead>Sisa</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {advanceRows.slice(0, 5).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatDateID(row.requestedAt)}
                        </TableCell>
                        <TableCell className="tabular-nums">{rupiah(toNumber(row.principal))}</TableCell>
                        <TableCell className="tabular-nums">{rupiah(toNumber(row.balance))}</TableCell>
                        <TableCell>
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kontrak</CardTitle>
          <CardDescription>Kontrak baru menggantikan yang lama (status lama menjadi renewed).</CardDescription>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/kontrak">Semua kontrak</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contractRows.length === 0 ? (
            <EmptyState title="Belum ada kontrak" hint="Tambahkan kontrak pertama di bawah." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Berakhir</TableHead>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{CONTRACT_KIND_LABEL[row.kind] ?? row.kind}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.startDate)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.endDate ? formatDateID(row.endDate) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{rupiah(toNumber(row.payRate))}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          row.status === "active" ? "good" : row.status === "expired" ? "bad" : "default"
                        }
                      >
                        {row.status}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Separator />

          <form action={createContractAction} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="backTo" value={`/admin/karyawan/${employee.id}`} />
            <FormField label="Jenis kontrak">
              <SelectInput name="kind" defaultValue="pkwt">
                {CONTRACT_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Mulai">
              <Input type="date" name="startDate" defaultValue={today} required />
            </FormField>
            <FormField label="Berakhir" hint="Kosongkan untuk PKWTT">
              <Input type="date" name="endDate" />
            </FormField>
            <FormField label="Tipe gaji">
              <SelectInput name="payType" defaultValue={employee.payType}>
                {PAY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Tarif kontrak">
              <Input
                name="payRate"
                inputMode="numeric"
                defaultValue={Math.round(toNumber(employee.payRate))}
              />
            </FormField>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Tambah kontrak
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Absensi terakhir</CardTitle>
            <CardDescription>8 entri terbaru</CardDescription>
          </CardHeader>
          <CardContent>
            {entryRows.length === 0 ? (
              <EmptyState title="Belum ada absensi" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Masuk</TableHead>
                    <TableHead>Keluar</TableHead>
                    <TableHead>Durasi</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entryRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateID(row.workDate)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatTimeID(row.clockInAt)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.clockOutAt ? formatTimeID(row.clockOutAt) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {minutesToHoursLabel(
                          workedMinutes({
                            id: row.id,
                            workDate: row.workDate,
                            clockInAt: row.clockInAt,
                            clockOutAt: row.clockOutAt,
                            breakMinutes: row.breakMinutes,
                            overtimeMinutes: row.overtimeMinutes,
                          }),
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"
                          }
                        >
                          {row.status}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slip gaji terakhir</CardTitle>
            <CardDescription>6 periode terakhir</CardDescription>
          </CardHeader>
          <CardContent>
            {slipRows.length === 0 ? (
              <EmptyState title="Belum ada slip gaji" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slipRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/admin/payroll/${row.periodId}`} className="hover:underline">
                          {formatDateID(row.periodStart)} – {formatDateID(row.periodEnd)}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums font-medium">
                        {rupiah(toNumber(row.net))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={row.status === "paid" ? "good" : "default"}>
                          {row.status}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
