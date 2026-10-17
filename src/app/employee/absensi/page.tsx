import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDateID, formatTimeID, localDateString, minutesToHoursLabel } from "@/lib/utils";
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
        <h1 className="text-lg font-semibold text-stone-900">Riwayat absensi</h1>
        <p className="text-xs text-muted">
          {periodLabel(period)} · total disetujui {minutesToHoursLabel(totalMinutes)}
        </p>
      </header>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Belum ada absensi pada periode ini" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-stone-800">{formatDateID(row.workDate)}</p>
                  <p className="text-xs text-muted">
                    {formatTimeID(row.clockInAt)} – {row.clockOutAt ? formatTimeID(row.clockOutAt) : "belum keluar"}
                    {row.breakMinutes > 0 && ` · istirahat ${row.breakMinutes}m`}
                    {row.overtimeMinutes > 0 && ` · lembur ${row.overtimeMinutes}m`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums text-stone-800">
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
                  <Badge tone={row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"}>
                    {row.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
