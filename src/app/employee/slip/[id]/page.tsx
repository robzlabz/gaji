import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { loadPayslipDoc } from "@/lib/payslip-doc";
import { PayslipSheet } from "@/components/payslip-sheet";
import { PrintButton } from "@/components/print-button";

export default async function EmployeePayslipDetail({ params }: { params: Promise<{ id: string }> }) {
  const { org, employee } = await requireEmployee();
  const { id } = await params;

  const doc = await loadPayslipDoc(org.id, id);
  if (!doc || doc.employee.id !== employee.id) notFound();
  if (doc.slip.status !== "final" && doc.slip.status !== "paid") notFound();

  return (
    <div className="space-y-3">
      <div className="no-print flex items-center justify-between gap-2">
        <Link href="/employee/slip" className="text-xs text-muted">
          ← Semua slip
        </Link>
        <PrintButton label="Cetak slip" />
      </div>

      <PayslipSheet orgName={org.name} doc={doc} />
    </div>
  );
}
