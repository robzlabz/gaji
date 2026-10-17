import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { findPayslipDoc } from "@/lib/payslip-doc";
import { PayslipSheet } from "@/components/payslip-sheet";
import { PrintButton } from "@/components/print-button";
import { btnGhost } from "@/components/ui";

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
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/payroll/${id}`} className="text-xs text-muted">
          ← Kembali ke payroll
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/admin/payroll/${id}/export`} className={btnGhost}>
            Unduh CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <PayslipSheet orgName={org.name} doc={doc} />
    </div>
  );
}
