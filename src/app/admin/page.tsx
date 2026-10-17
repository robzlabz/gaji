import Link from "next/link";
import { and, count, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  cashAdvances,
  contracts,
  employees,
  payPeriods,
  timeEntries,
} from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { previewPayroll } from "@/lib/payroll-run";
import { localDateString, formatDateID, PAY_TYPE_LABEL, rupiah, rupiahShort, toNumber } from "@/lib/utils";
import { periodContaining, periodLabel } from "@/lib/period";
import { Badge, Card, EmptyState, Stat, Table, Td } from "@/components/ui";

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
    .where(and(eq(timeEntries.orgId, org.id), eq(timeEntries.status, "pending")));

  const [openShifts] = await db
    .select({ total: count() })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.orgId, org.id),
        sql`${timeEntries.clockOutAt} is null`,
      ),
    );

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
        gte(timeEntries.workDate, period.start),
        lte(timeEntries.workDate, period.end),
      ),
    )
    .orderBy(desc(timeEntries.clockInAt))
    .limit(5);

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-stone-900">Ringkasan</h1>
        <p className="text-sm text-muted">
          Periode berjalan {periodLabel(period)} · {today}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Karyawan aktif" value={headcount?.total ?? 0} hint="termasuk tanpa akun login" />
        <Stat
          label="Estimasi gaji periode"
          value={rupiahShort(preview.totalNet)}
          hint={`${preview.employeeCount} karyawan · bruto ${rupiahShort(preview.totalGross)}`}
          tone="good"
        />
        <Stat
          label="Absensi perlu approval"
          value={pendingEntries?.total ?? 0}
          hint={`${openShifts?.total ?? 0} shift masih terbuka`}
          tone={(pendingEntries?.total ?? 0) > 0 ? "warn" : "default"}
        />
        <Stat
          label="Kasbon berjalan"
          value={rupiahShort(toNumber(advanceOutstanding?.total))}
          hint="sisa saldo yang belum dipotong"
          tone="warn"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Kontrak akan berakhir"
          subtitle={`Dalam ${org.contractAlertDays} hari ke depan`}
          action={
            <Link href="/admin/kontrak" className="text-xs font-medium text-brand">
              Lihat semua
            </Link>
          }
        >
          {expiring.length === 0 ? (
            <EmptyState title="Tidak ada kontrak yang mendekati berakhir" />
          ) : (
            <Table head={["Karyawan", "Berakhir", "Sisa", ""]}>
              {expiring.map((row) => {
                const days = Math.ceil(
                  (new Date(`${row.endDate}T00:00:00Z`).getTime() -
                    new Date(`${today}T00:00:00Z`).getTime()) /
                    86_400_000,
                );
                return (
                  <tr key={row.id}>
                    <Td>
                      <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium text-stone-900">
                        {row.employeeName}
                      </Link>
                    </Td>
                    <Td className="tabular-nums text-stone-600">{formatDateID(row.endDate)}</Td>
                    <Td>
                      <Badge tone={days <= 14 ? "bad" : days <= 30 ? "warn" : "info"}>
                        {days < 0 ? `lewat ${Math.abs(days)}h` : `${days} hari`}
                      </Badge>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/kontrak?renew=${row.id}`}
                        className="text-xs font-medium text-brand"
                      >
                        Perpanjang
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Komposisi tipe gaji" subtitle="Karyawan aktif per tipe penggajian">
          <ul className="space-y-2">
            {byPayType.length === 0 && <EmptyState title="Belum ada karyawan" />}
            {byPayType.map((row) => (
              <li key={row.payType} className="flex items-center justify-between text-sm">
                <span className="text-stone-700">{PAY_TYPE_LABEL[row.payType] ?? row.payType}</span>
                <span className="font-semibold tabular-nums text-stone-900">{row.total}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-line pt-4 text-sm">
            <p className="text-muted">Payroll terakhir</p>
            {latestPeriod ? (
              <p className="mt-1">
                <Link href={`/admin/payroll/${latestPeriod.id}`} className="font-medium text-brand">
                  {formatDateID(latestPeriod.periodStart)} – {formatDateID(latestPeriod.periodEnd)}
                </Link>{" "}
                <Badge tone={latestPeriod.status === "paid" ? "good" : latestPeriod.status === "approved" ? "info" : "default"}>
                  {latestPeriod.status}
                </Badge>
              </p>
            ) : (
              <p className="mt-1 text-muted">Belum ada payroll dihitung.</p>
            )}
          </div>
        </Card>
      </div>

      <Card title="Absensi terbaru" subtitle="5 entri terakhir pada periode berjalan">
        {recentEntries.length === 0 ? (
          <EmptyState title="Belum ada absensi" hint="Karyawan hourly melakukan clock in dari dashboard mereka." />
        ) : (
          <Table head={["Karyawan", "Tanggal", "Masuk", "Keluar", "Status"]}>
            {recentEntries.map((row) => (
              <tr key={row.id}>
                <Td className="font-medium text-stone-900">{row.employeeName}</Td>
                <Td className="tabular-nums text-stone-600">{formatDateID(row.workDate)}</Td>
                <Td className="tabular-nums text-stone-600">
                  {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: org.timezone }).format(row.clockInAt)}
                </Td>
                <Td className="tabular-nums text-stone-600">
                  {row.clockOutAt
                    ? new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: org.timezone }).format(row.clockOutAt)
                    : "—"}
                </Td>
                <Td>
                  <Badge
                    tone={
                      row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn"
                    }
                  >
                    {row.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted">
        Estimasi gaji dihitung dari absensi & tugas berstatus approved saja. Total bruto periode ini{" "}
        {rupiah(preview.totalGross)}.
      </p>
    </>
  );
}
