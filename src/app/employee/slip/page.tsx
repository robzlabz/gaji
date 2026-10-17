import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods, payslipItems, payslips } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDateID, rupiah, toNumber } from "@/lib/utils";

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
    ? await db
        .select()
        .from(payslipItems)
        .where(inArray(payslipItems.payslipId, slipIds))
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
        <h1 className="text-lg font-semibold text-stone-900">Slip gaji</h1>
        <p className="text-xs text-muted">Slip muncul setelah admin memfinalkan periode.</p>
      </header>

      {visible.length === 0 ? (
        <Card>
          <EmptyState title="Belum ada slip gaji" hint="Slip akan muncul di sini setelah payroll difinalkan." />
        </Card>
      ) : (
        visible.map((slip) => (
          <Card key={slip.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-stone-900">
                  {formatDateID(slip.periodStart)} – {formatDateID(slip.periodEnd)}
                </p>
                <p className="text-xs text-muted">
                  {slip.paidAt ? `Dibayar ${formatDateID(slip.paidAt)}` : "Menunggu pembayaran"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={slip.status === "paid" ? "good" : "info"}>{slip.status}</Badge>
                <Link
                  href={`/employee/slip/${slip.id}`}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium text-stone-700"
                >
                  Detail
                </Link>
              </div>
            </div>

            <p className="mt-3 text-2xl font-semibold tabular-nums text-stone-900">
              {rupiah(toNumber(slip.net))}
            </p>
            <p className="text-xs text-muted">
              bruto {rupiah(toNumber(slip.gross))} · potongan {rupiah(toNumber(slip.totalDeductions))}
            </p>

            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(itemsBySlip.get(slip.id) ?? []).map((item) => (
                <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                  <span className={item.kind === "kasbon" ? "text-red-700" : "text-stone-700"}>
                    {item.label}
                    <span className="ml-1 text-xs text-muted">
                      {toNumber(item.qty)} {item.unit}
                    </span>
                  </span>
                  <span
                    className={
                      item.kind === "kasbon"
                        ? "tabular-nums font-medium text-red-700"
                        : "tabular-nums font-medium text-stone-900"
                    }
                  >
                    {item.kind === "kasbon" ? "−" : ""}
                    {rupiah(toNumber(item.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </>
  );
}
