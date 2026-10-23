import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, payPeriods, payslipItems, payslips } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { PAY_TYPE_LABEL, toNumber } from "@/lib/format";
import { DEDUCTION_LINE_KINDS } from "@/lib/payroll";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

const DEDUCTION_KINDS = DEDUCTION_LINE_KINDS;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { org } = await requireAdmin();
  const { id } = await params;

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, id), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) {
    return new Response("Periode tidak ditemukan", { status: 404 });
  }

  const slips = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.code,
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

  const periodLabel = `${period.periodStart} s/d ${period.periodEnd}`;
  const lines: string[] = [];

  lines.push(
    [
      "Periode",
      "Karyawan",
      "Kode",
      "Tipe Gaji",
      "Tarif",
      "Komponen",
      "Jenis",
      "Qty",
      "Satuan",
      "Tarif Satuan",
      "Jumlah",
      "Bruto",
      "Potongan",
      "Net",
      "Status Slip",
    ]
      .map(csvCell)
      .join(","),
  );

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  for (const slip of slips) {
    const gross = toNumber(slip.gross);
    const deductions = toNumber(slip.totalDeductions);
    const net = toNumber(slip.net);
    totalGross += gross;
    totalDeductions += deductions;
    totalNet += net;

    const slipItems = items.filter((item) => item.payslipId === slip.id);
    const base = [
      periodLabel,
      slip.employeeName,
      slip.employeeCode ?? "",
      PAY_TYPE_LABEL[slip.payType] ?? slip.payType,
      toNumber(slip.payRate),
    ];

    if (slipItems.length === 0) {
      lines.push([...base, "", "", "", "", "", "", gross, deductions, net, slip.status].map(csvCell).join(","));
      continue;
    }

    for (const item of slipItems) {
      lines.push(
        [
          ...base,
          item.label,
          DEDUCTION_KINDS.has(item.kind) ? "potongan" : "penerimaan",
          toNumber(item.qty),
          item.unit,
          toNumber(item.unitRate),
          toNumber(item.amount),
          gross,
          deductions,
          net,
          slip.status,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  lines.push(
    ["TOTAL", `${slips.length} slip`, "", "", "", "", "", "", "", "", "", totalGross, totalDeductions, totalNet, ""]
      .map(csvCell)
      .join(","),
  );

  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const filename = `rekap-gaji_${period.periodStart}_${period.periodEnd}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
