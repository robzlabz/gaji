import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID, formatTimeID, localDateString, minutesToHoursLabel } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { workedMinutes } from "@/lib/payroll";

export default async function EmployeeHistory() {
  const { org, employee } = await requireEmployee();
  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const rows = await db
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

  const totalMinutes = rows
    .filter((row) => row.status === "approved")
    .reduce(
      (sum, row) =>
        sum +
        workedMinutes({
          id: row.id,
          workDate: row.workDate,
          clockInAt: row.clockInAt,
          clockOutAt: row.clockOutAt,
          breakMinutes: row.breakMinutes,
          overtimeMinutes: row.overtimeMinutes,
        }),
      0,
    );

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Riwayat absensi</h1>
        <p className="text-xs text-muted-foreground">
          {periodLabel(period)} · total disetujui {minutesToHoursLabel(totalMinutes)}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Absensi periode ini</CardTitle>
          <CardDescription>{rows.length} entri tercatat</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada absensi pada periode ini" />
          ) : (
            <ul className="flex flex-col divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDateID(row.workDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTimeID(row.clockInAt)} –{" "}
                      {row.clockOutAt ? formatTimeID(row.clockOutAt) : "belum keluar"}
                      {row.breakMinutes > 0 && ` · istirahat ${row.breakMinutes}m`}
                      {row.overtimeMinutes > 0 && ` · lembur ${row.overtimeMinutes}m`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-sm tabular-nums">
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
                    </p>
                    <StatusBadge
                      tone={row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"}
                    >
                      {statusLabel(row.status)}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
