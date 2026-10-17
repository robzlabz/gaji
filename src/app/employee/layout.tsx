import { requireEmployee } from "@/lib/session";
import { BottomNav, type NavItem } from "@/components/nav";
import { SignOutButton } from "@/components/session-controls";
import { PAY_TYPE_LABEL, rupiah, toNumber } from "@/lib/utils";

const items: NavItem[] = [
  { href: "/employee", label: "Absen", icon: "⏱" },
  { href: "/employee/absensi", label: "Riwayat", icon: "☰" },
  { href: "/employee/tugas", label: "Tugas", icon: "✓" },
  { href: "/employee/kasbon", label: "Kasbon", icon: "₪" },
  { href: "/employee/slip", label: "Slip", icon: "▤" },
];

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { org, employee } = await requireEmployee();

  return (
    <div className="min-h-dvh pb-20">
      <header className="border-b border-line bg-card print:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-stone-900">{employee.fullName}</p>
            <p className="truncate text-xs text-muted">
              {org.name} · {PAY_TYPE_LABEL[employee.payType]} · {rupiah(toNumber(employee.payRate))}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-4">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
