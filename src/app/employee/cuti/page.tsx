import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leaves } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { cancelLeaveAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PAY_TYPE_LABEL, formatDateID, localDateString } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { leaveKindLabel, leaveStatusTone } from "@/lib/leave";
import { statusLabel } from "@/lib/labels";

export default async function EmployeeLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { ok, err } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const rows = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.orgId, org.id), eq(leaves.employeeId, employee.id)))
    .orderBy(desc(leaves.startDate));

  const pending = rows.filter((row) => row.status === "pending");
  const approvedDaysThisPeriod = rows
    .filter(
      (row) =>
        row.status === "approved" && row.startDate <= period.end && row.endDate >= period.start,
    )
    .reduce((sum, row) => sum + row.days, 0);

  // Cuti hanya untuk gaji bulanan: tipe lain dibayar dari kehadiran/tugas.
  if (employee.payType !== "monthly") {
    return (
      <>
        <header>
          <h1 className="text-lg font-semibold tracking-tight">Cuti</h1>
          <p className="text-xs text-muted-foreground">
            Tipe gajimu: {PAY_TYPE_LABEL[employee.payType] ?? employee.payType}
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Cuti tidak berlaku untuk tipe gajimu</CardTitle>
            <CardDescription>
              Cuti hanya dipakai karyawan bulanan, karena gaji mereka dihitung per hari kerja.
              Gaji {PAY_TYPE_LABEL[employee.payType] ?? employee.payType} sudah otomatis mengikuti
              kehadiran atau tugas yang kamu kerjakan, jadi tidak perlu pengajuan cuti.
            </CardDescription>
          </CardHeader>
        </Card>
      </>
    );
  }

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Cuti</h1>
        <p className="text-xs text-muted-foreground">
          Cuti berbayar tetap dihitung sebagai hari kerja saat gaji bulanan dihitung.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Menunggu" value={pending.length} hint="pengajuan" />
        <StatCard
          label="Cuti periode ini"
          value={`${approvedDaysThisPeriod} hari`}
          hint={periodLabel(period)}
        />
      </div>

      <Button asChild className="w-full">
        <Link href="/employee/cuti/baru">+ Ajukan cuti</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat cuti</CardTitle>
          <CardDescription>{rows.length} pengajuan</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada pengajuan cuti"
              hint="Pengajuan yang kamu kirim akan muncul di sini beserta statusnya."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {leaveKindLabel(row.kind)} · {row.days} hari
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateID(row.startDate)} – {formatDateID(row.endDate)} ·{" "}
                        {row.paid ? "berbayar" : "tanpa upah"}
                      </p>
                      {row.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
                      ) : null}
                      {row.status === "rejected" && row.rejectReason ? (
                        <p className="mt-1 text-xs text-destructive">
                          Alasan ditolak: {row.rejectReason}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={leaveStatusTone(row.status)}>
                      {statusLabel(row.status)}
                    </StatusBadge>
                  </div>

                  {row.status === "pending" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/employee/cuti/${row.id}`}>Ubah</Link>
                      </Button>
                      <form action={cancelLeaveAction}>
                        <input type="hidden" name="leaveId" value={row.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Batalkan pengajuan
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
