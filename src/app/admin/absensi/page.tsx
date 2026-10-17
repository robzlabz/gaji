import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, timeEntries } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decideTimeEntryAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, btnDanger, btnPrimary, inputClass } from "@/components/ui";
import { formatDateID, formatTimeID, localDateString, minutesToHoursLabel } from "@/lib/utils";
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
        <h1 className="text-xl font-semibold text-stone-900">Absensi</h1>
        <p className="text-sm text-muted">Periode {periodLabel(period)} · hanya yang approved dihitung ke gaji.</p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="flex flex-wrap gap-2 text-xs">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/absensi?status=${tab.key}`}
            className={
              statusFilter === tab.key
                ? "rounded-full bg-brand px-3 py-1.5 font-semibold text-white"
                : "rounded-full border border-line bg-white px-3 py-1.5 text-stone-600"
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Card title="Daftar absensi" subtitle="Sesuaikan istirahat & lembur sebelum menyetujui.">
        {rows.length === 0 ? (
          <EmptyState title="Tidak ada data" hint="Coba tab lain atau tunggu karyawan clock in." />
        ) : (
          <div className="space-y-3">
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
                <div key={row.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium text-stone-900">
                        {row.employeeName}
                      </Link>
                      <p className="text-xs text-muted">
                        {formatDateID(row.workDate)} · {formatTimeID(row.clockInAt)} –{" "}
                        {row.clockOutAt ? formatTimeID(row.clockOutAt) : "belum keluar"} ·{" "}
                        {minutesToHoursLabel(minutes)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={row.source === "pwa" ? "info" : "default"}>{row.source}</Badge>
                      {row.withinGeofence === false && <Badge tone="warn">luar area</Badge>}
                      {row.inLat !== null && row.inLng !== null && (
                        <a
                          href={`https://maps.google.com/?q=${row.inLat},${row.inLng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand"
                        >
                          lokasi
                        </a>
                      )}
                      <Badge
                        tone={row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"}
                      >
                        {row.status}
                      </Badge>
                    </div>
                  </div>

                  {row.inPhoto && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.inPhoto}
                      alt={`Foto clock in ${row.employeeName}`}
                      className="mt-2 h-24 w-24 rounded-lg border border-line object-cover"
                    />
                  )}

                  {row.status === "pending" && (
                    <form action={decideTimeEntryAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="entryId" value={row.id} />
                      <label className="text-xs text-stone-600">
                        Istirahat (menit)
                        <input
                          name="breakMinutes"
                          defaultValue={row.breakMinutes}
                          className={`${inputClass} mt-1 w-24`}
                          inputMode="numeric"
                        />
                      </label>
                      <label className="text-xs text-stone-600">
                        Lembur (menit)
                        <input
                          name="overtimeMinutes"
                          defaultValue={row.overtimeMinutes}
                          className={`${inputClass} mt-1 w-24`}
                          inputMode="numeric"
                        />
                      </label>
                      <label className="flex-1 text-xs text-stone-600">
                        Catatan lembur / alasan
                        <input name="reason" className={`${inputClass} mt-1`} placeholder="opsional" />
                      </label>
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        className={`${btnPrimary} h-9`}
                      >
                        Setujui
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="reject"
                        className={`${btnDanger} h-9`}
                      >
                        Tolak
                      </button>
                    </form>
                  )}

                  {row.status === "approved" && (row.breakMinutes > 0 || row.overtimeMinutes > 0) && (
                    <p className="mt-2 text-xs text-muted">
                      Istirahat {row.breakMinutes} menit · lembur {row.overtimeMinutes} menit
                      {row.overtimeNote ? ` (${row.overtimeNote})` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
