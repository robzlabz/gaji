"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BanknoteIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const adminItems: NavItem[] = [
  { href: "/admin", label: "Ringkasan", icon: LayoutDashboardIcon },
  { href: "/admin/karyawan", label: "Karyawan", icon: UsersIcon },
  { href: "/admin/kontrak", label: "Kontrak", icon: FileTextIcon },
  { href: "/admin/absensi", label: "Absensi", icon: CalendarClockIcon },
  { href: "/admin/tugas", label: "Tugas", icon: ClipboardCheckIcon },
  { href: "/admin/kasbon", label: "Kasbon", icon: WalletIcon },
  { href: "/admin/payroll", label: "Payroll", icon: BanknoteIcon },
  { href: "/admin/pengaturan", label: "Pengaturan", icon: SettingsIcon },
];

const employeeItems: NavItem[] = [
  { href: "/employee", label: "Absen", icon: CalendarClockIcon },
  { href: "/employee/absensi", label: "Riwayat", icon: HistoryIcon },
  { href: "/employee/tugas", label: "Tugas", icon: ClipboardCheckIcon },
  { href: "/employee/kasbon", label: "Kasbon", icon: WalletIcon },
  { href: "/employee/slip", label: "Slip", icon: ReceiptTextIcon },
];

function isActive(pathname: string, href: string, rootHref: string) {
  if (pathname === href) return true;
  if (href === rootHref) return false;
  return pathname.startsWith(`${href}/`);
}

/** Sidebar navigasi admin (desktop). */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden flex-col gap-1 md:flex">
      {adminItems.map((item) => {
        const active = isActive(pathname, item.href, "/admin");
        const Icon = item.icon;
        return (
          <Button
            key={item.href}
            asChild
            variant={active ? "secondary" : "ghost"}
            className={cn("w-full justify-start gap-2", active && "font-semibold")}
          >
            <Link href={item.href} aria-current={active ? "page" : undefined}>
              <Icon className="size-4" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

/** Strip navigasi admin untuk layar kecil. */
export function AdminMobileNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
      {adminItems.map((item) => {
        const active = isActive(pathname, item.href, "/admin");
        return (
          <Link key={item.href} href={item.href}>
            <Badge
              variant={active ? "default" : "outline"}
              className="h-7 px-2.5 text-xs whitespace-nowrap"
            >
              {item.label}
            </Badge>
          </Link>
        );
      })}
    </div>
  );
}

/** Bottom navigation untuk dashboard karyawan (mobile-first). */
export function EmployeeNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between gap-0.5 px-1 py-1">
        {employeeItems.map((item) => {
          const active = isActive(pathname, item.href, "/employee");
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              asChild
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto flex-1 flex-col gap-1 py-1.5 text-[11px]",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <Link href={item.href} aria-current={active ? "page" : undefined}>
                <Icon className="size-4" />
                {item.label}
              </Link>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
