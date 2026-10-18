import Link from "next/link";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances, timeEntries, workTasks } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { ClockCard } from "./clock-card";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatDateID,
  formatTimeID,
  localDateString,
  minutesToHoursLabel,
  rupiah,
  rupiahShort,
  toNumber,
} from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { computePayslip, workedMinutes } from "@/lib/payroll";

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

  // Pakai mesin payroll yang sama dengan slip final supaya estimasi tidak berbeda dari slip.
  const [approvedTasks, openAdvances] = await Promise.all([
    db
      .select()
      .from(workTasks)
      .where(
        and(
          eq(workTasks.employeeId, employee.id),
          eq(workTasks.status, "approved"),
          gte(workTasks.workDate, period.start),
          lte(workTasks.workDate, period.end),
        ),
      ),
    db
      .select()
      .from(cashAdvances)
      .where(and(eq(cashAdvances.employeeId, employee.id), eq(cashAdvances.status, "approved"))),
  ]);

  const estimate = computePayslip({
    payType: employee.payType,
    payRate: employee.payRate,
    period,
    joinedAt: employee.joinedAt,
    overtimeMultiplier: toNumber(org.overtimeMultiplier),
    timeEntries: approved.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      breakMinutes: entry.breakMinutes,
      overtimeMinutes: entry.overtimeMinutes,
    })),
    tasks: approvedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      qty: task.qty,
      unit: task.unit,
      unitRate: task.unitRate,
      workDate: task.workDate,
    })),
    advances: openAdvances
      .filter((advance) => toNumber(advance.balance) > 0)
      .map((advance) => ({
        id: advance.id,
        balance: advance.balance,
        installmentAmount: advance.installmentAmount,
      })),
  });

  return (
    <>
      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>{openEntry ? "Sesi berjalan" : "Mulai kerja"}</CardTitle>
          <CardDescription>
            {openEntry
              ? `Clock in ${formatTimeID(openEntry.clockInAt)} · ${formatDateID(openEntry.workDate)}`
              : `Hari ini ${formatDateID(today)} · ${org.timezone}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Jam disetujui"
          value={minutesToHoursLabel(approvedMinutes)}
          hint={periodLabel(period)}
        />
        <StatCard
          label="Estimasi gaji"
          value={rupiah(estimate.net)}
          hint={
            estimate.deductions > 0
              ? `bruto ${rupiahShort(estimate.gross)} · potongan ${rupiahShort(estimate.deductions)}`
              : "dari absensi & tugas approved"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hari ini</CardTitle>
          <CardDescription>Absensi yang tercatat hari ini</CardDescription>
        </CardHeader>
        <CardContent>
          {todayEntries.length === 0 ? (
            <EmptyState title="Belum ada absensi hari ini" hint="Tekan Clock in untuk mulai." />
          ) : (
            <ul className="flex flex-col gap-2">
              {todayEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="tabular-nums">
                    {formatTimeID(entry.clockInAt)} –{" "}
                    {entry.clockOutAt ? formatTimeID(entry.clockOutAt) : "…"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
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
                    <StatusBadge
                      tone={entry.status === "approved" ? "good" : entry.status === "rejected" ? "bad" : "warn"}
                    >
                      {statusLabel(entry.status)}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {pending.length} absensi menunggu approval admin.{" "}
          <Link href="/employee/absensi" className="font-medium underline underline-offset-4">
            Lihat riwayat
          </Link>
        </p>
      )}
    </>
  );
}
