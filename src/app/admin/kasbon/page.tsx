import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createAdvanceAction, decideAdvanceAction, setAdvancePlanAction } from "../actions";
import { Flash } from "@/components/flash";
import { KasbonPlanList } from "@/components/kasbon-plan-list";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";
import { periodLabel } from "@/lib/period";
import { summarizePlans } from "@/lib/kasbon";
import { planningPeriod } from "@/lib/kasbon-server";
import { advancePlansForPeriod } from "@/lib/payroll-run";

export default async function AdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  const [staff, rows] = await Promise.all([
    db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
      .orderBy(employees.fullName),
    db
      .select({
        id: cashAdvances.id,
        principal: cashAdvances.principal,
        balance: cashAdvances.balance,
        installmentAmount: cashAdvances.installmentAmount,
        requestedAt: cashAdvances.requestedAt,
        status: cashAdvances.status,
        note: cashAdvances.note,
        employeeId: employees.id,
        employeeName: employees.fullName,
      })
      .from(cashAdvances)
      .innerJoin(employees, eq(cashAdvances.employeeId, employees.id))
      .where(eq(cashAdvances.orgId, org.id))
      .orderBy(desc(cashAdvances.requestedAt))
      .limit(100),
  ]);

  const outstanding = rows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);
  const pending = rows.filter((row) => row.status === "pending");

  // Rencana potong kasbon untuk periode gaji yang masih bisa diatur.
  const { period, nextPeriod } = await planningPeriod(org);
  const planItems = await advancePlansForPeriod(org.id, period);
  const planSummary = summarizePlans(
    planItems.map((item) => ({ advance: item.advance, plan: item.plan })),
  );

  const planEmployeeIds = [...new Set(planItems.map((item) => item.advance.employeeId))];
  const planNames = planEmployeeIds.length
    ? await db
        .select({ id: employees.id, fullName: employees.fullName })
        .from(employees)
        .where(and(eq(employees.orgId, org.id), inArray(employees.id, planEmployeeIds)))
    : [];
  const nameById = new Map(planNames.map((row) => [row.id, row.fullName]));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Kasbon</h1>
        <p className="text-sm text-muted-foreground">
          Tentukan kasbon mana yang dipotong periode ini; sisanya bisa ditunda ke periode berikutnya.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Sisa kasbon" value={rupiah(outstanding)} hint="belum dipotong ke gaji" />
        <StatCard label="Menunggu approval" value={pending.length} />
        <StatCard label="Total pengajuan" value={rows.length} hint="100 pengajuan terakhir" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rencana potong periode ini</CardTitle>
          <CardDescription>
            Periode {periodLabel(period)} · total potong {rupiah(planSummary.deductTotal)}
            {planSummary.deferredCount > 0
              ? ` · ${planSummary.deferredCount} ditunda (${rupiah(planSummary.deferredTotal)})`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KasbonPlanList
            items={[...planItems]
              .sort((a, b) =>
                (nameById.get(a.advance.employeeId) ?? "").localeCompare(
                  nameById.get(b.advance.employeeId) ?? "",
                ),
              )
              .map((item) => ({
                advance: {
                  id: item.advance.id,
                  principal: item.advance.principal,
                  balance: item.advance.balance,
                  installmentAmount: item.advance.installmentAmount,
                  requestedAt: item.advance.requestedAt,
                  note: item.advance.note,
                  employeeName: nameById.get(item.advance.employeeId) ?? "Karyawan",
                },
                resolution: item.resolution,
                planDecision:
                  item.plan?.decision === "deduct" || item.plan?.decision === "defer"
                    ? item.plan.decision
                    : null,
                planAmount: item.plan?.amount ? Math.round(toNumber(item.plan.amount)) : null,
              }))}
            period={period}
            nextPeriod={nextPeriod}
            action={setAdvancePlanAction}
            showEmployee
            emptyHint="Tidak ada kasbon aktif pada periode ini."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajukan kasbon</CardTitle>
          <CardDescription>Pengajuan dari admin langsung berstatus pending.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAdvanceAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="backTo" value="/admin/kasbon" />
            <FormField label="Karyawan">
              <SelectInput name="employeeId" required defaultValue="">
                <option value="">Pilih karyawan…</option>
                {staff.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.fullName}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Pokok (Rp)">
              <Input name="principal" inputMode="numeric" placeholder="1000000" required />
            </FormField>
            <FormField label="Cicilan per periode (Rp)" hint="Kosong = potong penuh sekali bayar">
              <Input name="installmentAmount" inputMode="numeric" placeholder="250000" />
            </FormField>
            <FormField label="Tanggal pengajuan">
              <Input type="date" name="requestedAt" defaultValue={today} />
            </FormField>
            <FormField label="Catatan" className="sm:col-span-2">
              <Input name="note" placeholder="opsional" />
            </FormField>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Simpan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar kasbon</CardTitle>
          <CardDescription>Sisa saldo berkurang setiap kali dipotong dari payroll.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada kasbon" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Pokok</TableHead>
                  <TableHead>Sisa</TableHead>
                  <TableHead>Cicilan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium hover:underline">
                        {row.employeeName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.requestedAt)}
                    </TableCell>
                    <TableCell className="tabular-nums">{rupiah(toNumber(row.principal))}</TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {rupiah(toNumber(row.balance))}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.installmentAmount ? rupiah(toNumber(row.installmentAmount)) : "penuh"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          row.status === "approved"
                            ? "good"
                            : row.status === "settled"
                              ? "info"
                              : row.status === "rejected"
                                ? "bad"
                                : "warn"
                        }
                      >
                        {statusLabel(row.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {row.status === "pending" && (
                        <form action={decideAdvanceAction} className="flex gap-2">
                          <input type="hidden" name="advanceId" value={row.id} />
                          <Button type="submit" name="decision" value="approve" size="sm">
                            Setujui
                          </Button>
                          <Button
                            type="submit"
                            name="decision"
                            value="reject"
                            variant="destructive"
                            size="sm"
                          >
                            Tolak
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
