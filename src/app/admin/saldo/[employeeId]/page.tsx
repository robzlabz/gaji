import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { Flash } from "@/components/flash";
import { PAY_TYPE_LABEL, rupiah, toNumber } from "@/lib/format";
import { SaldoPanel } from "../saldo-panel";

export default async function SaldoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { employeeId } = await params;
  const { ok, err } = await searchParams;

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) notFound();

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/admin/saldo" className="text-xs text-muted-foreground hover:underline">
          ← Semua saldo
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{employee.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {PAY_TYPE_LABEL[employee.payType] ?? employee.payType} · upah{" "}
          {rupiah(toNumber(employee.payRate))} · ongkos{" "}
          {toNumber(employee.transportRate) > 0
            ? `${rupiah(toNumber(employee.transportRate))}/kedatangan`
            : "tidak ada"}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <SaldoPanel employeeId={employee.id} backTo={`/admin/saldo/${employee.id}`} />
    </>
  );
}
