import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { setMyAdvancePlanAction, requestAdvanceAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KasbonPlanList } from "@/components/kasbon-plan-list";
import { formatDateID, rupiah, toNumber } from "@/lib/format";
import { periodLabel } from "@/lib/period";
import { summarizePlans } from "@/lib/kasbon";
import { planningPeriod } from "@/lib/kasbon-server";
import { advancePlansForPeriod } from "@/lib/payroll-run";

export default async function EmployeeAdvances({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { ok, err } = await searchParams;

  const rows = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.employeeId, employee.id)))
    .orderBy(desc(cashAdvances.requestedAt));

  const outstanding = rows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + toNumber(row.balance), 0);

  // Periode gaji yang masih bisa diatur — di sinilah kasbon dipotong atau ditunda.
  const { period, nextPeriod } = await planningPeriod(org);
  const planItems = await advancePlansForPeriod(org.id, period, { employeeId: employee.id });
  const planSummary = summarizePlans(
    planItems.map((item) => ({ advance: item.advance, plan: item.plan })),
  );

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Kasbon</h1>
        <p className="text-xs text-muted-foreground">
          Pilih kasbon mana yang dipotong periode ini, sisanya bisa ditunda ke periode depan.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <StatCard label="Sisa kasbon" value={rupiah(outstanding)} hint="belum dipotong ke gaji" />

      <Card>
        <CardHeader>
          <CardTitle>Rencana potong gaji</CardTitle>
          <CardDescription>
            Periode {periodLabel(period)} · potong {rupiah(planSummary.deductTotal)}
            {planSummary.deferredCount > 0
              ? ` · ${planSummary.deferredCount} kasbon ditunda (${rupiah(planSummary.deferredTotal)})`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KasbonPlanList
            items={planItems.map((item) => ({
              advance: {
                id: item.advance.id,
                principal: item.advance.principal,
                balance: item.advance.balance,
                installmentAmount: item.advance.installmentAmount,
                requestedAt: item.advance.requestedAt,
                note: item.advance.note,
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
            action={setMyAdvancePlanAction}
            emptyHint="Belum ada kasbon aktif. Kalau ada kasbon yang disetujui admin, aturannya muncul di sini."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajukan kasbon</CardTitle>
          <CardDescription>Admin akan meninjau pengajuanmu.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={requestAdvanceAction} className="flex flex-col gap-3">
            <FormField label="Nominal (Rp)">
              <Input name="principal" inputMode="numeric" placeholder="500000" required />
            </FormField>
            <FormField label="Keterangan / catatan" hint="Opsional">
              <Input name="note" placeholder="biaya sekolah anak" />
            </FormField>
            <Button type="submit" className="w-full">
              Kirim pengajuan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat kasbon</CardTitle>
          <CardDescription>{rows.length} pengajuan</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada kasbon" />
          ) : (
            <ul className="flex flex-col divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums">
                      {rupiah(toNumber(row.principal))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateID(row.requestedAt)}
                      {row.installmentAmount
                        ? ` · cicilan ${rupiah(toNumber(row.installmentAmount))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-xs tabular-nums text-muted-foreground">
                      sisa {rupiah(toNumber(row.balance))}
                    </p>
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
