import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/utils";
import { SideNav, type NavItem } from "@/components/nav";
import { OrgSwitcher, SignOutButton } from "@/components/session-controls";

const items: NavItem[] = [
  { href: "/admin", label: "Ringkasan", icon: "◎" },
  { href: "/admin/karyawan", label: "Karyawan", icon: "☺" },
  { href: "/admin/kontrak", label: "Kontrak", icon: "✎" },
  { href: "/admin/absensi", label: "Absensi", icon: "⏱" },
  { href: "/admin/tugas", label: "Tugas", icon: "✓" },
  { href: "/admin/kasbon", label: "Kasbon", icon: "₪" },
  { href: "/admin/payroll", label: "Payroll", icon: "▤" },
  { href: "/admin/pengaturan", label: "Pengaturan", icon: "⚙" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { org, user, membership, allMemberships } = await requireAdmin();

  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-56 md:shrink-0 print:hidden">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
              G
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-900">{org.name}</p>
              <p className="text-xs text-muted">{ROLE_LABEL[membership.role] ?? membership.role}</p>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <OrgSwitcher
              orgs={allMemberships.map((row) => ({ id: row.org.id, name: row.org.name }))}
              activeId={org.id}
            />
          </div>

          <div className="hidden md:block">
            <SideNav items={items} />
            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-2 truncate text-xs text-muted">{user.name}</p>
              <SignOutButton />
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1.5 text-xs text-stone-700"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-5 pb-10">{children}</main>
      </div>
    </div>
  );
}
