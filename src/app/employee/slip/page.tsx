import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods, payslipItems, payslips } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateID, rupiah, toNumber } from "@/lib/format";

export default async function EmployeePayslips() {
  const { employee } = await requireEmployee();

  const rows = await db
    .select({
      id: payslips.id,
      gross: payslips.gross,
      totalDeductions: payslips.totalDeductions,
      net: payslips.net,
      status: payslips.status,
      paidAt: payslips.paidAt,
      periodStart: payPeriods.periodStart,
      periodEnd: payPeriods.periodEnd,
    })
    .from(payslips)
    .innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
    .where(and(eq(payslips.employeeId, employee.id)))
    .orderBy(desc(payPeriods.periodStart));

  const visible = rows.filter((row) => row.status === "final" || row.status === "paid");
  const slipIds = visible.map((row) => row.id);

  const items = slipIds.length
    ? await db.select().from(payslipItems).where(inArray(payslipItems.payslipId, slipIds))
    : [];

  const itemsBySlip = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySlip.get(item.payslipId) ?? [];
    list.push(item);
    itemsBySlip.set(item.payslipId, list);
  }

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Slip gaji</h1>
        <p className="text-xs text-muted-foreground">Slip muncul setelah admin memfinalkan periode.</p>
      </header>

      {visible.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="Belum ada slip gaji"
              hint="Slip akan muncul di sini setelah payroll difinalkan."
            />
          </CardContent>
        </Card>
      ) : (
        visible.map((slip) => (
          <Card key={slip.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle>
                    {formatDateID(slip.periodStart)} – {formatDateID(slip.periodEnd)}
                  </CardTitle>
                  <CardDescription>
                    {slip.paidAt ? `Dibayar ${formatDateID(slip.paidAt)}` : "Menunggu pembayaran"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={slip.status === "paid" ? "good" : "info"}>
                    {slip.status}
                  </StatusBadge>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/employee/slip/${slip.id}`}>Detail</Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <p className="text-2xl font-semibold tabular-nums">{rupiah(toNumber(slip.net))}</p>
              <p className="text-xs text-muted-foreground">
                bruto {rupiah(toNumber(slip.gross))} · potongan {rupiah(toNumber(slip.totalDeductions))}
              </p>

              <Separator className="my-3" />

              <ul className="flex flex-col divide-y">
                {(itemsBySlip.get(slip.id) ?? []).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className={item.kind === "kasbon" ? "text-destructive" : undefined}>
                      {item.label}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {toNumber(item.qty)} {item.unit}
                      </span>
                    </span>
                    <span
                      className={
                        item.kind === "kasbon"
                          ? "font-medium tabular-nums text-destructive"
                          : "font-medium tabular-nums"
                      }
                    >
                      {item.kind === "kasbon" ? "−" : ""}
                      {rupiah(toNumber(item.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </>
  );
}
