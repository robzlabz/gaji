import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaves } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createLeaveAction, decideLeaveAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
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
import { formatDateID, localDateString } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { LEAVE_KIND_OPTIONS, leaveKindLabel, leaveStatusTone } from "@/lib/leave";
import { statusLabel } from "@/lib/labels";

const BACK_TO = "/admin/cuti";

export default async function AdminLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const [staff, rows] = await Promise.all([
    db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, org.id),
          eq(employees.isActive, true),
          eq(employees.payType, "monthly"),
        ),
      )
      .orderBy(employees.fullName),
    db
      .select({
        id: leaves.id,
        kind: leaves.kind,
        startDate: leaves.startDate,
        endDate: leaves.endDate,
        days: leaves.days,
        paid: leaves.paid,
        status: leaves.status,
        note: leaves.note,
        rejectReason: leaves.rejectReason,
        employeeId: employees.id,
        employeeName: employees.fullName,
      })
      .from(leaves)
      .innerJoin(employees, eq(leaves.employeeId, employees.id))
      .where(eq(leaves.orgId, org.id))
      .orderBy(desc(leaves.startDate))
      .limit(100),
  ]);

  const pending = rows.filter((row) => row.status === "pending");
  const approvedThisPeriod = rows
    .filter(
      (row) =>
        row.status === "approved" && row.startDate <= period.end && row.endDate >= period.start,
    )
    .reduce((sum, row) => sum + row.days, 0);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cuti</h1>
        <p className="text-sm text-muted-foreground">
          Cuti hanya untuk karyawan bulanan. Cuti berbayar yang disetujui tetap dihitung sebagai
          hari kerja di payroll.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Menunggu" value={pending.length} hint="perlu keputusan" />
        <StatCard
          label="Disetujui periode ini"
          value={`${approvedThisPeriod} hari`}
          hint={periodLabel(period)}
        />
        <StatCard label="Total pengajuan" value={rows.length} hint="100 terakhir" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Menunggu persetujuan</CardTitle>
          <CardDescription>
            Setujui bila cuti berbayar — harinya tetap dibayar saat payroll dihitung.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState
              title="Tidak ada pengajuan menunggu"
              hint="Pengajuan cuti karyawan bulanan akan muncul di sini."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((row) => (
                <li key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {row.employeeName} · {leaveKindLabel(row.kind)} {row.days} hari
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateID(row.startDate)} – {formatDateID(row.endDate)} ·{" "}
                        {row.paid ? "berbayar" : "tanpa upah"}
                      </p>
                      {row.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
                      ) : null}
                    </div>
                    <StatusBadge tone={leaveStatusTone(row.status)}>
                      {statusLabel(row.status)}
                    </StatusBadge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <form action={decideLeaveAction}>
                      <input type="hidden" name="leaveId" value={row.id} />
                      <input type="hidden" name="decision" value="approved" />
                      <input type="hidden" name="backTo" value={BACK_TO} />
                      <Button type="submit" size="sm">
                        Setujui
                      </Button>
                    </form>

                    <form action={decideLeaveAction} className="flex flex-1 items-end gap-2">
                      <input type="hidden" name="leaveId" value={row.id} />
                      <input type="hidden" name="decision" value="rejected" />
                      <input type="hidden" name="backTo" value={BACK_TO} />
                      <FormField label="Alasan tolak" className="min-w-40 flex-1">
                        <Input name="rejectReason" placeholder="opsional" />
                      </FormField>
                      <Button type="submit" size="sm" variant="outline">
                        Tolak
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catat cuti</CardTitle>
          <CardDescription>
            Untuk cuti yang sudah disepakati langsung — tersimpan sebagai disetujui. Hanya karyawan
            bulanan yang muncul di daftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <EmptyState
              title="Belum ada karyawan bulanan"
              hint="Ubah tipe penggajian karyawan menjadi bulanan untuk memakai cuti."
            />
          ) : (
            <form action={createLeaveAction} className="flex flex-col gap-3">
              <input type="hidden" name="backTo" value={BACK_TO} />
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Karyawan">
                  <SelectInput name="employeeId" required>
                    {staff.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.fullName}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Jenis">
                  <SelectInput name="kind" defaultValue="cuti">
                    {LEAVE_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Tanggal mulai">
                  <Input type="date" name="startDate" defaultValue={today} required />
                </FormField>
                <FormField label="Tanggal selesai" hint="Isi sama bila hanya satu hari">
                  <Input type="date" name="endDate" defaultValue={today} />
                </FormField>
                <FormField label="Upah">
                  <SelectInput name="paid" defaultValue="1">
                    <option value="1">Berbayar (gaji tetap)</option>
                    <option value="0">Tanpa upah</option>
                  </SelectInput>
                </FormField>
                <FormField label="Catatan" hint="Opsional">
                  <Input name="note" placeholder="cuti tahunan" />
                </FormField>
              </div>
              <div>
                <Button type="submit">Simpan cuti</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat cuti</CardTitle>
          <CardDescription>{rows.length} pengajuan terakhir</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada cuti"
              hint="Catat cuti atau tunggu pengajuan dari karyawan bulanan."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Hari</TableHead>
                  <TableHead>Upah</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.employeeName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateID(row.startDate)} – {formatDateID(row.endDate)}
                    </TableCell>
                    <TableCell>{leaveKindLabel(row.kind)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.days}</TableCell>
                    <TableCell>{row.paid ? "berbayar" : "tanpa upah"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={leaveStatusTone(row.status)}>
                        {statusLabel(row.status)}
                      </StatusBadge>
                      {row.status === "rejected" && row.rejectReason ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.rejectReason}
                        </span>
                      ) : null}
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
