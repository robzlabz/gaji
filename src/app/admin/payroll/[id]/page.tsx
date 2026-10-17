import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, payPeriods, payslipItems, payslips } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { deletePayrollDraftAction, updatePayPeriodStatusAction } from "../../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Stat, Table, Td, btnDanger, btnGhost, btnPrimary } from "@/components/ui";
import { PAY_TYPE_LABEL, formatDateID, rupiah, toNumber } from "@/lib/utils";
import { periodLabel } from "@/lib/period";

export default async function PayrollDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, id), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) notFound();

  const slips = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      employeeName: employees.fullName,
      payType: payslips.payType,
      payRate: payslips.payRate,
      gross: payslips.gross,
      totalDeductions: payslips.totalDeductions,
      net: payslips.net,
      status: payslips.status,
    })
    .from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .where(eq(payslips.payPeriodId, period.id))
    .orderBy(employees.fullName);

  const slipIds = slips.map((slip) => slip.id);

  const items = slipIds.length
    ? await db.select().from(payslipItems).where(inArray(payslipItems.payslipId, slipIds))
    : [];

  const itemsBySlip = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySlip.get(item.payslipId) ?? [];
    list.push(item);
    itemsBySlip.set(item.payslipId, list);
  }

  const totalGross = slips.reduce((sum, slip) => sum + toNumber(slip.gross), 0);
  const totalDeductions = slips.reduce((sum, slip) => sum + toNumber(slip.totalDeductions), 0);
  const totalNet = slips.reduce((sum, slip) => sum + toNumber(slip.net), 0);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/payroll" className="text-xs text-muted">
            ← Payroll
          </Link>
          <h1 className="text-xl font-semibold text-stone-900">
            {periodLabel({ start: period.periodStart, end: period.periodEnd })}
          </h1>
          <p className="text-sm text-muted">
            {slips.length} slip · tanggal bayar {period.payDate ? formatDateID(period.payDate) : "belum diset"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/admin/payroll/${period.id}/export`} className={btnGhost}>
            Unduh CSV
          </a>

          <Badge
            tone={
              period.status === "paid"
                ? "good"
                : period.status === "approved"
                  ? "info"
                  : period.status === "void"
                    ? "bad"
                    : "default"
            }
          >
            {period.status}
          </Badge>

          {period.status === "draft" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="approved" />
              <button type="submit" className={btnPrimary}>
                Finalkan
              </button>
            </form>
          )}

          {period.status === "approved" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="paid" />
              <button type="submit" className={btnPrimary}>
                Tandai sudah dibayar
              </button>
            </form>
          )}

          {period.status === "draft" && (
            <form action={deletePayrollDraftAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <button type="submit" className={btnDanger}>
                Hapus draft
              </button>
            </form>
          )}

          {period.status === "paid" && (
            <form action={updatePayPeriodStatusAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <input type="hidden" name="status" value="void" />
              <button type="submit" className={btnGhost}>
                Batalkan
              </button>
            </form>
          )}
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Bruto" value={rupiah(totalGross)} />
        <Stat label="Potongan" value={rupiah(totalDeductions)} tone={totalDeductions > 0 ? "warn" : "default"} />
        <Stat label="Total net" value={rupiah(totalNet)} tone="good" />
      </div>

      {slips.length === 0 ? (
        <Card title="Slip gaji">
          <EmptyState title="Tidak ada slip" />
        </Card>
      ) : (
        <div className="space-y-3">
          {slips.map((slip) => {
            const slipItems = itemsBySlip.get(slip.id) ?? [];
            return (
              <Card key={slip.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/karyawan/${slip.employeeId}`}
                      className="font-medium text-stone-900"
                    >
                      {slip.employeeName}
                    </Link>
                    <p className="text-xs text-muted">
                      {PAY_TYPE_LABEL[slip.payType]} · tarif {rupiah(toNumber(slip.payRate))}
                    </p>
                    <Link
                      href={`/admin/payroll/${period.id}/slip/${slip.employeeId}`}
                      className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                    >
                      Cetak slip
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-stone-900">{rupiah(toNumber(slip.net))}</p>
                    <p className="text-xs text-muted">
                      bruto {rupiah(toNumber(slip.gross))} · potongan {rupiah(toNumber(slip.totalDeductions))}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <Table head={["Komponen", "Qty", "Tarif", "Jumlah"]}>
                    {slipItems.map((item) => (
                      <tr key={item.id}>
                        <Td className={item.kind === "kasbon" ? "text-red-700" : "text-stone-700"}>
                          {item.label}
                        </Td>
                        <Td className="tabular-nums text-stone-600">
                          {toNumber(item.qty)} {item.unit}
                        </Td>
                        <Td className="tabular-nums text-stone-600">{rupiah(toNumber(item.unitRate))}</Td>
                        <Td
                          className={
                            item.kind === "kasbon"
                              ? "tabular-nums font-medium text-red-700"
                              : "tabular-nums font-medium"
                          }
                        >
                          {item.kind === "kasbon" ? "−" : ""}
                          {rupiah(toNumber(item.amount))}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted">
        Slip menyimpan snapshot tarif &amp; kuantitas saat payroll dihitung, jadi perubahan tarif berikutnya
        tidak mengubah slip lama.
      </p>
    </>
  );
}
