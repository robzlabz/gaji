import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaves } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decideLeaveAction, deleteLeaveAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { FormField } from "@/components/form-field";
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
import { leaveKindLabel, leavePaidLabel, leaveStatusTone } from "@/lib/leave";
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

  const rows = await db
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
    .limit(100);

  const pending = rows.filter((row) => row.status === "pending");
  const approvedThisPeriod = rows
    .filter(
      (row) =>
        row.status === "approved" && row.startDate <= period.end && row.endDate >= period.start,
    )
    .reduce((sum, row) => sum + row.days, 0);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cuti</h1>
          <p className="text-sm text-muted-foreground">
            Cuti hanya untuk karyawan bulanan. Cuti berbayar yang disetujui tetap dihitung sebagai
            hari kerja di payroll.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/cuti/baru">+ Catat cuti</Link>
        </Button>
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
            Setujui bila cuti berbayar — harinya tetap dibayar saat payroll dihitung. Isi cuti bisa
            diperbaiki dulu lewat Ubah.
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
                        {leavePaidLabel(row.paid)}
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

                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/cuti/${row.id}`}>Ubah</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat cuti</CardTitle>
          <CardDescription>
            {rows.length} pengajuan terakhir. Ubah untuk memperbaiki isi, hapus untuk membuangnya.
          </CardDescription>
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
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const deleteFormId = `delete-leave-row-${row.id}`;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateID(row.startDate)} – {formatDateID(row.endDate)}
                      </TableCell>
                      <TableCell>{leaveKindLabel(row.kind)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.days}</TableCell>
                      <TableCell>{leavePaidLabel(row.paid)}</TableCell>
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
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/cuti/${row.id}`}>Ubah</Link>
                          </Button>
                          <form id={deleteFormId} action={deleteLeaveAction}>
                            <input type="hidden" name="leaveId" value={row.id} />
                            <input type="hidden" name="backTo" value={BACK_TO} />
                            <ConfirmDeleteButton
                              formId={deleteFormId}
                              title="Hapus cuti ini?"
                              description={`Cuti ${leaveKindLabel(row.kind)} ${row.days} hari milik ${row.employeeName} (${formatDateID(row.startDate)} – ${formatDateID(row.endDate)}) akan dihapus permanen.`}
                              confirmLabel="Ya, hapus"
                            />
                          </form>
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
    </>
  );
}
