import Link from "next/link";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { estimatePay } from "@/lib/estimate";
import { ClockCard } from "./clock-card";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { LiveDuration } from "@/components/live-duration";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { saldoMessage, saldoTone } from "@/lib/saldo";
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
    .where(and(eq(timeEntries.employeeId, employee.id), isNull(timeEntries.clockOutAt), isNull(timeEntries.deletedAt)))
    .limit(1);

  const periodEntries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.employeeId, employee.id),
        isNull(timeEntries.deletedAt),
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

  // Pakai mesin estimasi yang sama dengan slip final & halaman estimasi, supaya angka
  // di dashboard tidak pernah beda dari slip (termasuk ongkos kedatangan & saldo).
  const estimate = await estimatePay({
    orgId: org.id,
    employee: {
      id: employee.id,
      payType: employee.payType,
      payRate: employee.payRate,
      joinedAt: employee.joinedAt,
    },
    period,
    overtimeMultiplier: toNumber(org.overtimeMultiplier),
  });
  const saldo = estimate.saldo;

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
            payType={employee.payType}
            transportRate={toNumber(employee.transportRate)}
            openEntry={
              openEntry
                ? {
                    clockInAtISO: openEntry.clockInAt.toISOString(),
                    breakMinutes: openEntry.breakMinutes,
                    overtimeMinutes: openEntry.overtimeMinutes,
                    overtimeNote: openEntry.overtimeNote,
                    outPhotoSaved: Boolean(openEntry.outPhoto),
                    outLat: openEntry.outLat,
                    outLng: openEntry.outLng,
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
          value={rupiah(estimate.approved.net)}
          hint={
            estimate.approved.deductions > 0
              ? `bruto ${rupiahShort(estimate.approved.gross)} · potongan ${rupiahShort(estimate.approved.deductions)}`
              : "dari absensi & tugas approved"
          }
        />
      </div>

      {saldo.active && (
        <Link href="/employee/saldo" className="block">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                Saldo saya
                <StatusBadge tone={saldoTone(saldo.balance)}>
                  {saldo.balance < 0 ? "minus" : "aktif"}
                </StatusBadge>
              </CardTitle>
              <CardDescription>
                {saldoMessage(saldo.balance)} Periode ini ditutup saldo {rupiah(saldo.covered)}.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      )}

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
                      {entry.clockOutAt ? (
                        minutesToHoursLabel(
                          workedMinutes({
                            id: entry.id,
                            workDate: entry.workDate,
                            clockInAt: entry.clockInAt,
                            clockOutAt: entry.clockOutAt,
                            breakMinutes: entry.breakMinutes,
                            overtimeMinutes: entry.overtimeMinutes,
                          }),
                        )
                      ) : (
                        // Sesi masih berjalan: jamnya hidup sendiri, tidak me-render ulang halaman.
                        <LiveDuration since={entry.clockInAt.toISOString()} className="tabular-nums" />
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
