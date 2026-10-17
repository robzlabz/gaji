import Link from "next/link";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { ClockCard } from "./clock-card";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import {
  formatDateID,
  formatTimeID,
  localDateString,
  minutesToHoursLabel,
  rupiah,
  toNumber,
} from "@/lib/utils";
import { periodContaining, periodLabel } from "@/lib/period";
import { workedMinutes } from "@/lib/payroll";

export default async function EmployeeHome({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { ok, err } = await searchParams;

  const now = new Date();
  const today = localDateString(now, org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const [openEntry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeId, employee.id), isNull(timeEntries.clockOutAt)))
    .limit(1);

  const periodEntries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employee.id),
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
      ),
    )
    .orderBy(desc(timeEntries.clockInAt));

  const approved = periodEntries.filter((entry) => entry.status === "approved");
  const pending = periodEntries.filter((entry) => entry.status === "pending");

  const approvedMinutes = approved.reduce(
    (sum, entry) =>
      sum +
      workedMinutes({
        id: entry.id,
        workDate: entry.workDate,
        clockInAt: entry.clockInAt,
        clockOutAt: entry.clockOutAt,
        breakMinutes: entry.breakMinutes,
        overtimeMinutes: entry.overtimeMinutes,
      }),
    0,
  );

  const todayEntries = periodEntries.filter((entry) => entry.workDate === today);
  const rate = toNumber(employee.payRate);
  const estimate =
    employee.payType === "hourly"
      ? Math.round((approvedMinutes / 60) * rate)
      : employee.payType === "daily"
        ? Math.round(new Set(approved.map((entry) => entry.workDate)).size * rate)
        : employee.payType === "monthly"
          ? rate
          : null;

  return (
    <>
      <Flash ok={ok} err={err} />

      <Card
        title={openEntry ? "Sesi berjalan" : "Mulai kerja"}
        subtitle={
          openEntry
            ? `Clock in ${formatTimeID(openEntry.clockInAt)} · ${formatDateID(openEntry.workDate)}`
            : `Hari ini ${formatDateID(today)} · ${org.timezone}`
        }
      >
        <ClockCard
          openEntry={
            openEntry
              ? {
                  clockInAtISO: openEntry.clockInAt.toISOString(),
                  breakMinutes: openEntry.breakMinutes,
                  overtimeMinutes: openEntry.overtimeMinutes,
                  overtimeNote: openEntry.overtimeNote,
                }
              : null
          }
        />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Jam disetujui"
          value={minutesToHoursLabel(approvedMinutes)}
          hint={periodLabel(period)}
        />
        <Stat
          label={estimate === null ? "Periode" : "Estimasi gaji"}
          value={estimate === null ? periodLabel(period) : rupiah(estimate)}
          hint={estimate === null ? "dihitung dari tugas approved" : "dari data approved"}
          tone="good"
        />
      </div>

      <Card title="Hari ini">
        {todayEntries.length === 0 ? (
          <EmptyState title="Belum ada absensi hari ini" hint="Tekan Clock in untuk mulai." />
        ) : (
          <ul className="space-y-2">
            {todayEntries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span className="tabular-nums text-stone-700">
                  {formatTimeID(entry.clockInAt)} – {entry.clockOutAt ? formatTimeID(entry.clockOutAt) : "…"}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">
                    {minutesToHoursLabel(
                      workedMinutes({
                        id: entry.id,
                        workDate: entry.workDate,
                        clockInAt: entry.clockInAt,
                        clockOutAt: entry.clockOutAt,
                        breakMinutes: entry.breakMinutes,
                        overtimeMinutes: entry.overtimeMinutes,
                      }),
                    )}
                  </span>
                  <Badge
                    tone={entry.status === "approved" ? "good" : entry.status === "rejected" ? "bad" : "warn"}
                  >
                    {entry.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pending.length > 0 && (
        <p className="text-center text-xs text-muted">
          {pending.length} absensi menunggu approval admin.{" "}
          <Link href="/employee/absensi" className="text-brand">
            Lihat riwayat
          </Link>
        </p>
      )}
    </>
  );
}
