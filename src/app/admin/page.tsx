import Link from "next/link";
import { and, count, desc, eq, gte, isNull, lte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances, contracts, employees, payPeriods, timeEntries } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { previewPayroll } from "@/lib/payroll-run";
import { localDateString, formatDateID, PAY_TYPE_LABEL, rupiah, rupiahShort, toNumber } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { EmptyState } from "@/components/empty-state";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export default async function AdminDashboard() {
  const { org } = await requireAdmin();
  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const alertLimitDate = new Date(`${today}T00:00:00Z`);
  alertLimitDate.setUTCDate(alertLimitDate.getUTCDate() + org.contractAlertDays);
  const alertLimit = alertLimitDate.toISOString().slice(0, 10);

  const [headcount] = await db
    .select({ total: count() })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)));

  const [pendingEntries] = await db
    .select({ total: count() })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, org.id), eq(timeEntries.status, "pending"), isNull(timeEntries.deletedAt)));

  const [openShifts] = await db
    .select({ total: count() })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, org.id), sql`${timeEntries.clockOutAt} is null`, isNull(timeEntries.deletedAt)));

  const [advanceOutstanding] = await db
    .select({ total: sum(cashAdvances.balance) })
    .from(cashAdvances)
    .where(and(eq(cashAdvances.orgId, org.id), eq(cashAdvances.status, "approved")));

  const expiring = await db
    .select({
      id: contracts.id,
      employeeName: employees.fullName,
      endDate: contracts.endDate,
      kind: contracts.kind,
      employeeId: employees.id,
    })
    .from(contracts)
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .where(
      and(
        eq(contracts.orgId, org.id),
        eq(contracts.status, "active"),
        sql`${contracts.endDate} is not null`,
        lte(contracts.endDate, alertLimit),
      ),
    )
    .orderBy(contracts.endDate)
    .limit(6);

  const byPayType = await db
    .select({ payType: employees.payType, total: count() })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
    .groupBy(employees.payType);

  const [latestPeriod] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.orgId, org.id))
    .orderBy(desc(payPeriods.periodStart))
    .limit(1);

  const preview = await previewPayroll(org.id, period, {
    overtimeMultiplier: toNumber(org.overtimeMultiplier),
  });

  const recentEntries = await db
    .select({
      id: timeEntries.id,
      workDate: timeEntries.workDate,
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
      status: timeEntries.status,
      employeeName: employees.fullName,
    })
    .from(timeEntries)
    .innerJoin(employees, eq(timeEntries.employeeId, employees.id))
    .where(
      and(
        eq(timeEntries.orgId, org.id),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
      ),
    )
    .orderBy(desc(timeEntries.clockInAt))
    .limit(5);

  const timeFmt = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: org.timezone,
  });

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ringkasan</h1>
        <p className="text-sm text-muted-foreground">
          Periode berjalan {periodLabel(period)} · {formatDateID(today)}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Karyawan aktif" value={headcount?.total ?? 0} hint="termasuk tanpa akun login" />
        <StatCard
          label="Estimasi gaji periode"
          value={rupiahShort(preview.totalNet)}
          hint={`${preview.employeeCount} karyawan · bruto ${rupiahShort(preview.totalGross)}`}
        />
        <StatCard
          label="Absensi perlu approval"
          value={pendingEntries?.total ?? 0}
          hint={`${openShifts?.total ?? 0} shift masih terbuka`}
        />
        <StatCard
          label="Kasbon berjalan"
          value={rupiahShort(toNumber(advanceOutstanding?.total))}
          hint="sisa saldo yang belum dipotong"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kontrak akan berakhir</CardTitle>
            <CardDescription>Dalam {org.contractAlertDays} hari ke depan</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/kontrak">Lihat semua</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {expiring.length === 0 ? (
              <EmptyState title="Tidak ada kontrak yang mendekati berakhir" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Berakhir</TableHead>
                    <TableHead>Sisa</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiring.map((row) => {
                    const days = Math.ceil(
                      (new Date(`${row.endDate}T00:00:00Z`).getTime() -
                        new Date(`${today}T00:00:00Z`).getTime()) /
                        86_400_000,
                    );
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium hover:underline">
                            {row.employeeName}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatDateID(row.endDate)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={days <= 14 ? "bad" : days <= 30 ? "warn" : "info"}>
                            {days < 0 ? `lewat ${Math.abs(days)}h` : `${days} hari`}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <Button asChild variant="link" size="sm" className="px-0">
                            <Link href={`/admin/kontrak/baru?renew=${row.id}`}>Perpanjang</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Komposisi tipe gaji</CardTitle>
            <CardDescription>Karyawan aktif per tipe penggajian</CardDescription>
          </CardHeader>
          <CardContent>
            {byPayType.length === 0 ? (
              <EmptyState title="Belum ada karyawan" />
            ) : (
              <ul className="flex flex-col gap-2">
                {byPayType.map((row) => (
                  <li key={row.payType} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {PAY_TYPE_LABEL[row.payType] ?? row.payType}
                    </span>
                    <span className="font-semibold tabular-nums">{row.total}</span>
                  </li>
                ))}
              </ul>
            )}

            <Separator className="my-4" />

            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">Payroll terakhir</p>
              {latestPeriod ? (
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/payroll/${latestPeriod.id}`} className="font-medium hover:underline">
                    {formatDateID(latestPeriod.periodStart)} – {formatDateID(latestPeriod.periodEnd)}
                  </Link>
                  <StatusBadge
                    tone={
                      latestPeriod.status === "paid"
                        ? "good"
                        : latestPeriod.status === "approved"
                          ? "info"
                          : "default"
                    }
                  >
                    {statusLabel(latestPeriod.status)}
                  </StatusBadge>
                </p>
              ) : (
                <p className="text-muted-foreground">Belum ada payroll dihitung.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Absensi terbaru</CardTitle>
          <CardDescription>5 entri terakhir pada periode berjalan</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEntries.length === 0 ? (
            <EmptyState
              title="Belum ada absensi"
              hint="Karyawan hourly melakukan clock in dari dashboard mereka."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Masuk</TableHead>
                  <TableHead>Keluar</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEntries.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.employeeName}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.workDate)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {timeFmt.format(row.clockInAt)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.clockOutAt ? timeFmt.format(row.clockOutAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"
                        }
                      >
                        {statusLabel(row.status)}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Estimasi gaji dihitung dari absensi &amp; tugas berstatus approved saja. Total bruto periode ini{" "}
        {rupiah(preview.totalGross)}.
      </p>
    </>
  );
}
