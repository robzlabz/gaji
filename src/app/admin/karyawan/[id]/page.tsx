import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cashAdvances,
  contracts,
  employees,
  payRateHistory,
  payPeriods,
  payslips,
  timeEntries,
  user,
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
import { TabNav, type TabNavItem } from "@/components/tab-nav";
import { statusLabel } from "@/lib/labels";
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

/** Tab detail karyawan; urutan ini juga urutan tampil di halaman. */
const TABS = [
  { key: "akun", label: "Akun login" },
  { key: "kasbon", label: "Kasbon" },
  { key: "kontrak", label: "Kontrak" },
  { key: "absensi", label: "Absensi" },
  { key: "slip", label: "Slip gaji" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | undefined): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string; tab?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err, tab: rawTab } = await searchParams;

  const tab: TabKey = isTabKey(rawTab) ? rawTab : "akun";
  /** URL tab = tujuan redirect server action, supaya tab aktif tidak hilang. */
  const tabUrl = (key: TabKey) => `/admin/karyawan/${id}?tab=${key}`;

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) notFound();

  const today = localDateString(new Date(), org.timezone);

  const rateRows = await db
    .select()
    .from(payRateHistory)
    .where(eq(payRateHistory.employeeId, id))
    .orderBy(desc(payRateHistory.effectiveFrom));

  // Data per tab dimuat sesuai tab aktif supaya halaman tidak query semuanya.
  const loginRow =
    tab === "akun" && employee.userId
      ? (
          await db
            .select({ phoneNumber: user.phoneNumber, email: user.email })
            .from(user)
            .where(eq(user.id, employee.userId))
            .limit(1)
        )[0]
      : undefined;

  const advanceRows =
    tab === "kasbon"
      ? await db
          .select()
          .from(cashAdvances)
          .where(eq(cashAdvances.employeeId, id))
          .orderBy(desc(cashAdvances.requestedAt))
      : [];

  const contractRows =
    tab === "kontrak"
      ? await db
          .select()
          .from(contracts)
          .where(eq(contracts.employeeId, id))
          .orderBy(desc(contracts.startDate))
      : [];

  const entryRows =
    tab === "absensi"
      ? await db
          .select()
          .from(timeEntries)
          .where(eq(timeEntries.employeeId, id))
          .orderBy(desc(timeEntries.clockInAt))
          .limit(20)
      : [];

  const slipRows =
    tab === "slip"
      ? await db
          .select({
            id: payslips.id,
            gross: payslips.gross,
            totalDeductions: payslips.totalDeductions,
            net: payslips.net,
            status: payslips.status,
            periodStart: payPeriods.periodStart,
            periodEnd: payPeriods.periodEnd,
            periodId: payPeriods.id,
          })
          .from(payslips)
          .innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
          .where(eq(payslips.employeeId, id))
          .orderBy(desc(payPeriods.periodStart))
          .limit(12)
      : [];

  const outstanding = advanceRows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);

  const tabItems: TabNavItem[] = TABS.map((item) => ({
    key: item.key,
    label: item.label,
    href: tabUrl(item.key),
  }));

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

      <Card>
        <CardHeader>
          <CardTitle>Detail karyawan</CardTitle>
          <CardDescription>Perubahan tarif tercatat di riwayat.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={updateEmployeeAction} className="flex flex-col gap-4">
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="backTo" value={tabUrl(tab)} />
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
            <CheckField name="isActive" label="Karyawan aktif" defaultChecked={employee.isActive} />
            <div>
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

      <TabNav items={tabItems} active={tab} />

      {tab === "akun" && (
        <Card>
          <CardHeader>
            <CardTitle>Akun login</CardTitle>
            <CardDescription>Nomor HP + PIN 6 digit untuk masuk dashboard karyawan.</CardDescription>
          </CardHeader>
          <CardContent>
            {employee.userId ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Nomor HP</span>
                    <span className="text-sm font-medium tabular-nums">
                      {loginRow?.phoneNumber ? `+${loginRow.phoneNumber}` : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Email internal</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {loginRow?.email ?? "—"}
                    </span>
                  </div>
                </div>

                <Separator />

                <form action={resetPinAction} className="flex flex-col gap-3">
                  <input type="hidden" name="employeeId" value={employee.id} />
                  <input type="hidden" name="backTo" value={tabUrl("akun")} />
                  <FormField label="PIN baru" hint="6 digit angka">
                    <Input name="pin" inputMode="numeric" maxLength={6} placeholder="6 digit" />
                  </FormField>
                  <div>
                    <Button type="submit" variant="outline">
                      Ganti PIN
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <EmptyState
                title="Belum punya akun login"
                hint="Akun hanya bisa dibuat saat menambah karyawan baru dengan nomor HP dan PIN."
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "kasbon" && (
        <Card>
          <CardHeader>
            <CardTitle>Kasbon</CardTitle>
            <CardDescription>
              Sisa saldo {rupiah(outstanding)} · {advanceRows.length} pengajuan
            </CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/kasbon">Kelola kasbon</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form action={createAdvanceAction} className="flex flex-col gap-3">
              <input type="hidden" name="employeeId" value={employee.id} />
              <input type="hidden" name="backTo" value={tabUrl("kasbon")} />
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
              <div>
                <Button type="submit">Ajukan kasbon</Button>
              </div>
            </form>

            <Separator />

            {advanceRows.length === 0 ? (
              <EmptyState title="Belum ada kasbon" hint="Ajukan kasbon pertama lewat form di atas." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Pokok</TableHead>
                    <TableHead>Cicilan</TableHead>
                    <TableHead>Sisa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advanceRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateID(row.requestedAt)}
                      </TableCell>
                      <TableCell className="tabular-nums">{rupiah(toNumber(row.principal))}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.installmentAmount ? rupiah(toNumber(row.installmentAmount)) : "penuh"}
                      </TableCell>
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
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {row.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "kontrak" && (
        <Card>
          <CardHeader>
            <CardTitle>Kontrak</CardTitle>
            <CardDescription>
              Tambah kontrak baru hanya jika tidak ada kontrak aktif. Untuk memperbarui, pakai
              Perpanjang di halaman Kontrak.
            </CardDescription>
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
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Separator />

            <form action={createContractAction} className="flex flex-col gap-3">
              <input type="hidden" name="employeeId" value={employee.id} />
              <input type="hidden" name="backTo" value={tabUrl("kontrak")} />
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
              <div>
                <Button type="submit">Tambah kontrak</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "absensi" && (
        <Card>
          <CardHeader>
            <CardTitle>Absensi</CardTitle>
            <CardDescription>20 entri terbaru.</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/absensi">Semua absensi</Link>
              </Button>
            </CardAction>
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
                    <TableHead>Istirahat</TableHead>
                    <TableHead>Lembur</TableHead>
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
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.breakMinutes > 0 ? minutesToHoursLabel(row.breakMinutes) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.overtimeMinutes > 0 ? minutesToHoursLabel(row.overtimeMinutes) : "—"}
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
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "slip" && (
        <Card>
          <CardHeader>
            <CardTitle>Slip gaji</CardTitle>
            <CardDescription>12 periode terakhir.</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/payroll">Semua payroll</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {slipRows.length === 0 ? (
              <EmptyState title="Belum ada slip gaji" hint="Slip dibuat saat payroll periode dijalankan." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead>Bruto</TableHead>
                    <TableHead>Potongan</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
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
                      <TableCell className="tabular-nums text-muted-foreground">
                        {rupiah(toNumber(row.gross))}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {rupiah(toNumber(row.totalDeductions))}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium">{rupiah(toNumber(row.net))}</TableCell>
                      <TableCell>
                        <StatusBadge tone={row.status === "paid" ? "good" : "default"}>
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/payroll/${row.periodId}/slip/${employee.id}`}>Cetak slip</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
