import Link from "next/link";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createContractAction, terminateContractAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { FormField, SelectInput } from "@/components/form-field";
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
import { CONTRACT_KIND_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";

const KIND_OPTIONS = [
  { value: "pkwt", label: "PKWT" },
  { value: "probation", label: "Percobaan" },
  { value: "pkwtt", label: "PKWTT" },
  { value: "other", label: "Lainnya" },
];

const PAY_TYPE_OPTIONS = [
  { value: "hourly", label: "Per jam" },
  { value: "daily", label: "Per hari" },
  { value: "monthly", label: "Per bulan" },
  { value: "per_task", label: "Per tugas" },
];

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; renew?: string; filter?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, renew, filter } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const alertDate = new Date(`${today}T00:00:00Z`);
  alertDate.setUTCDate(alertDate.getUTCDate() + org.contractAlertDays);
  const alertLimit = alertDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: contracts.id,
      kind: contracts.kind,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
      payRate: contracts.payRate,
      payType: contracts.payType,
      note: contracts.note,
      employeeId: employees.id,
      employeeName: employees.fullName,
      renewedFromId: contracts.renewedFromId,
    })
    .from(contracts)
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .where(
      filter === "expiring"
        ? and(
            eq(contracts.orgId, org.id),
            eq(contracts.status, "active"),
            isNotNull(contracts.endDate),
            lte(contracts.endDate, alertLimit),
          )
        : filter === "ended"
          ? and(eq(contracts.orgId, org.id), sql`${contracts.status} in ('expired','renewed','terminated')`)
          : eq(contracts.orgId, org.id),
    )
    .orderBy(contracts.endDate, employees.fullName);

  const renewing = renew ? rows.find((row) => row.id === renew) : undefined;

  const staff = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      payType: employees.payType,
      payRate: employees.payRate,
    })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
    .orderBy(employees.fullName);

  // Form tambah kontrak hanya untuk karyawan yang belum punya kontrak aktif.
  const activeContractEmployeeIds = new Set(
    (
      await db
        .select({ employeeId: contracts.employeeId })
        .from(contracts)
        .where(and(eq(contracts.orgId, org.id), eq(contracts.status, "active")))
    ).map((row) => row.employeeId),
  );
  const staffWithoutActiveContract = staff.filter((row) => !activeContractEmployeeIds.has(row.id));

  const activeCount = rows.filter((row) => row.status === "active").length;
  const expiringCount = rows.filter(
    (row) => row.status === "active" && row.endDate && row.endDate <= alertLimit,
  ).length;

  const tabs = [
    { key: "", label: "Semua" },
    { key: "expiring", label: "Akan berakhir" },
    { key: "ended", label: "Sudah selesai" },
  ];
  const activeFilter = filter ?? "";

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Kontrak</h1>
        <p className="text-sm text-muted-foreground">
          Kelola masa berlaku kontrak dan perpanjangannya.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Kontrak aktif" value={activeCount} />
        <StatCard
          label="Akan berakhir"
          value={expiringCount}
          hint={`≤ ${org.contractAlertDays} hari`}
        />
        <StatCard label="Total kontrak" value={rows.length} hint="sesuai filter aktif" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key || "all"}
            asChild
            size="sm"
            variant={activeFilter === tab.key ? "secondary" : "outline"}
          >
            <Link href={tab.key ? `/admin/kontrak?filter=${tab.key}` : "/admin/kontrak"}>
              {tab.label}
            </Link>
          </Button>
        ))}
      </div>

      {renewing && (
        <Card>
          <CardHeader>
            <CardTitle>Perpanjang kontrak — {renewing.employeeName}</CardTitle>
            <CardDescription>
              Kontrak lama berakhir{" "}
              {renewing.endDate ? formatDateID(renewing.endDate) : "tanpa batas"}. Kontrak baru akan
              menggantikannya.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createContractAction} className="flex flex-col gap-3">
              <input type="hidden" name="employeeId" value={renewing.employeeId} />
              <input type="hidden" name="renewedFromId" value={renewing.id} />
              <input type="hidden" name="backTo" value="/admin/kontrak" />
              <FormField label="Jenis kontrak">
                <SelectInput name="kind" defaultValue="pkwt">
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Mulai">
                <Input
                  type="date"
                  name="startDate"
                  defaultValue={renewing.endDate ?? today}
                  required
                />
              </FormField>
              <FormField label="Berakhir">
                <Input type="date" name="endDate" />
              </FormField>
              <FormField label="Tipe gaji">
                <SelectInput name="payType" defaultValue={renewing.payType}>
                  {PAY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Tarif">
                <Input
                  name="payRate"
                  inputMode="numeric"
                  defaultValue={Math.round(toNumber(renewing.payRate))}
                />
              </FormField>
              <div>
                <Button type="submit">Simpan perpanjangan</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar kontrak</CardTitle>
          <CardDescription>Baris kuning menandakan kontrak yang mendekati berakhir.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada kontrak"
              hint="Tambahkan kontrak dari halaman detail karyawan."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Berakhir</TableHead>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const days = row.endDate
                    ? Math.ceil(
                        (new Date(`${row.endDate}T00:00:00Z`).getTime() -
                          new Date(`${today}T00:00:00Z`).getTime()) /
                          86_400_000,
                      )
                    : null;
                  const soon = row.status === "active" && days !== null && days <= org.contractAlertDays;

                  return (
                    <TableRow key={row.id} className={soon ? "bg-amber-50/60 dark:bg-amber-500/10" : undefined}>
                      <TableCell>
                        <Link
                          href={`/admin/karyawan/${row.employeeId}`}
                          className="font-medium hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {CONTRACT_KIND_LABEL[row.kind] ?? row.kind}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateID(row.startDate)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        <span className="flex flex-col items-start gap-1">
                          <span>{row.endDate ? formatDateID(row.endDate) : "—"}</span>
                          {soon && (
                            <StatusBadge tone={days !== null && days < 0 ? "bad" : "warn"}>
                              {days !== null && days < 0 ? "sudah lewat" : `${days} hari lagi`}
                            </StatusBadge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{rupiah(toNumber(row.payRate))}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            row.status === "active"
                              ? "good"
                              : row.status === "renewed"
                                ? "info"
                                : row.status === "terminated"
                                  ? "default"
                                  : "bad"
                          }
                        >
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.status === "active" && (
                            <Button asChild variant="link" size="sm" className="px-0">
                              <Link href={`/admin/kontrak?renew=${row.id}`}>Perpanjang</Link>
                            </Button>
                          )}
                          {row.status === "active" && (
                            <form action={terminateContractAction}>
                              <input type="hidden" name="contractId" value={row.id} />
                              <input type="hidden" name="backTo" value="/admin/kontrak" />
                              <Button type="submit" variant="destructive" size="xs">
                                Akhiri
                              </Button>
                            </form>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tambah kontrak baru</CardTitle>
          <CardDescription>
            {staffWithoutActiveContract.length === 0
              ? "Semua karyawan aktif sudah punya kontrak. Pakai Perpanjang untuk memperbarui."
              : "Untuk karyawan yang belum punya kontrak aktif."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createContractAction} className="flex flex-col gap-3">
            <input type="hidden" name="backTo" value="/admin/kontrak" />
            <FormField label="Karyawan">
              <SelectInput name="employeeId" required defaultValue="">
                <option value="">Pilih karyawan…</option>
                {staffWithoutActiveContract.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.fullName}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Jenis kontrak">
              <SelectInput name="kind" defaultValue="pkwt">
                {KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Nomor kontrak">
              <Input name="contractNo" placeholder="001/PKWT/I/2026" />
            </FormField>
            <FormField label="Mulai">
              <Input type="date" name="startDate" defaultValue={today} required />
            </FormField>
            <FormField label="Berakhir">
              <Input type="date" name="endDate" />
            </FormField>
            <FormField label="Tarif">
              <Input name="payRate" inputMode="numeric" placeholder="25000" />
            </FormField>
            <div>
              <Button type="submit">Simpan kontrak</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
