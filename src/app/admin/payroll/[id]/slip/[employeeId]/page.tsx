import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { findPayslipDoc } from "@/lib/payslip-doc";
import { PayslipSheet } from "@/components/payslip-sheet";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";

export default async function AdminPayslipPrintPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>;
}) {
  const { org } = await requireAdmin();
  const { id, employeeId } = await params;

  const doc = await findPayslipDoc(org.id, id, employeeId);
  if (!doc) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="px-0">
          <Link href={`/admin/payroll/${id}`}>← Kembali ke payroll</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={`/admin/payroll/${id}/export`}>Unduh CSV</a>
          </Button>
          <PrintButton />
        </div>
      </div>

      <PayslipSheet orgName={org.name} doc={doc} />
    </div>
  );
}
