import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, timeEntries } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decideTimeEntryAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateID, formatTimeID, localDateString, minutesToHoursLabel } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { workedMinutes } from "@/lib/payroll";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; status?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, status } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);
  const statusFilter = status ?? "pending";

  const rows = await db
    .select({
      id: timeEntries.id,
      workDate: timeEntries.workDate,
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
      breakMinutes: timeEntries.breakMinutes,
      overtimeMinutes: timeEntries.overtimeMinutes,
      overtimeNote: timeEntries.overtimeNote,
      status: timeEntries.status,
      source: timeEntries.source,
      inPhoto: timeEntries.inPhoto,
      inLat: timeEntries.inLat,
      inLng: timeEntries.inLng,
      withinGeofence: timeEntries.withinGeofence,
      employeeId: employees.id,
      employeeName: employees.fullName,
      payType: employees.payType,
    })
    .from(timeEntries)
    .innerJoin(employees, eq(timeEntries.employeeId, employees.id))
    .where(
      and(
        eq(timeEntries.orgId, org.id),
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
        statusFilter === "all" ? sql`true` : eq(timeEntries.status, statusFilter),
      ),
    )
    .orderBy(desc(timeEntries.clockInAt))
    .limit(100);

  const tabs = [
    { key: "pending", label: "Menunggu" },
    { key: "approved", label: "Disetujui" },
    { key: "rejected", label: "Ditolak" },
    { key: "all", label: "Semua" },
  ];

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Absensi</h1>
        <p className="text-sm text-muted-foreground">
          Periode {periodLabel(period)} · hanya yang approved dihitung ke gaji.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            asChild
            size="sm"
            variant={statusFilter === tab.key ? "secondary" : "outline"}
          >
            <Link href={`/admin/absensi?status=${tab.key}`}>{tab.label}</Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar absensi</CardTitle>
          <CardDescription>Sesuaikan istirahat &amp; lembur sebelum menyetujui.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Tidak ada data" hint="Coba tab lain atau tunggu karyawan clock in." />
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((row) => {
                const minutes = workedMinutes({
                  id: row.id,
                  workDate: row.workDate,
                  clockInAt: row.clockInAt,
                  clockOutAt: row.clockOutAt,
                  breakMinutes: row.breakMinutes,
                  overtimeMinutes: row.overtimeMinutes,
                });

                return (
                  <div key={row.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/karyawan/${row.employeeId}`}
                          className="font-medium hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatDateID(row.workDate)} · {formatTimeID(row.clockInAt)} –{" "}
                          {row.clockOutAt ? formatTimeID(row.clockOutAt) : "belum keluar"} ·{" "}
                          {minutesToHoursLabel(minutes)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={row.source === "pwa" ? "info" : "default"}>
                          {row.source}
                        </StatusBadge>
                        {row.withinGeofence === false && <StatusBadge tone="warn">luar area</StatusBadge>}
                        {row.inLat !== null && row.inLng !== null && (
                          <Button asChild variant="link" size="sm" className="px-0">
                            <a
                              href={`https://maps.google.com/?q=${row.inLat},${row.inLng}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              lokasi
                            </a>
                          </Button>
                        )}
                        <StatusBadge
                          tone={
                            row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"
                          }
                        >
                          {row.status}
                        </StatusBadge>
                      </div>
                    </div>

                    {row.inPhoto && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.inPhoto}
                        alt={`Foto clock in ${row.employeeName}`}
                        className="mt-2 h-24 w-24 rounded-lg border object-cover"
                      />
                    )}

                    {row.status === "pending" && (
                      <form
                        action={decideTimeEntryAction}
                        className="mt-3 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="entryId" value={row.id} />
                        <FormField label="Istirahat (menit)" className="w-28">
                          <Input
                            name="breakMinutes"
                            defaultValue={row.breakMinutes}
                            inputMode="numeric"
                          />
                        </FormField>
                        <FormField label="Lembur (menit)" className="w-28">
                          <Input
                            name="overtimeMinutes"
                            defaultValue={row.overtimeMinutes}
                            inputMode="numeric"
                          />
                        </FormField>
                        <FormField label="Catatan lembur / alasan" className="min-w-40 flex-1">
                          <Input name="reason" placeholder="opsional" />
                        </FormField>
                        <Button type="submit" name="decision" value="approve">
                          Setujui
                        </Button>
                        <Button type="submit" name="decision" value="reject" variant="destructive">
                          Tolak
                        </Button>
                      </form>
                    )}

                    {row.status === "approved" && (row.breakMinutes > 0 || row.overtimeMinutes > 0) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Istirahat {row.breakMinutes} menit · lembur {row.overtimeMinutes} menit
                        {row.overtimeNote ? ` (${row.overtimeNote})` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
