"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BanknoteIcon,
  CalendarClockIcon,
  CalendarOffIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PlugIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SignOutButton } from "@/components/session-controls";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const adminItems: NavItem[] = [
  { href: "/admin", label: "Ringkasan", icon: LayoutDashboardIcon },
  { href: "/admin/karyawan", label: "Karyawan", icon: UsersIcon },
  { href: "/admin/kontrak", label: "Kontrak", icon: FileTextIcon },
  { href: "/admin/absensi", label: "Absensi", icon: CalendarClockIcon },
  { href: "/admin/cuti", label: "Cuti", icon: CalendarOffIcon },
  { href: "/admin/tugas", label: "Tugas", icon: ClipboardCheckIcon },
  { href: "/admin/kasbon", label: "Kasbon", icon: WalletIcon },
  { href: "/admin/payroll", label: "Payroll", icon: BanknoteIcon },
  { href: "/admin/pengaturan", label: "Pengaturan", icon: SettingsIcon },
  { href: "/admin/mcp", label: "MCP", icon: PlugIcon },
];

/**
 * Menu admin yang dipakai harian — tampil langsung di bottom navigation mobile.
 * Sisanya masuk sheet "Lainnya" supaya bar bawah tetap 5 slot dan bisa disentuh jempol.
 */
const ADMIN_PRIMARY_HREFS = new Set(["/admin", "/admin/karyawan", "/admin/absensi", "/admin/payroll"]);

const adminPrimaryItems = adminItems.filter((item) => ADMIN_PRIMARY_HREFS.has(item.href));
const adminMoreItems = adminItems.filter((item) => !ADMIN_PRIMARY_HREFS.has(item.href));

const employeeItems: NavItem[] = [
  { href: "/employee", label: "Absen", icon: CalendarClockIcon },
  { href: "/employee/absensi", label: "Riwayat", icon: HistoryIcon },
  { href: "/employee/tugas", label: "Tugas", icon: ClipboardCheckIcon },
  { href: "/employee/cuti", label: "Cuti", icon: CalendarOffIcon },
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

/**
 * Bottom navigation admin (mobile).
 * Dulu berupa strip badge yang bisa digulir horizontal di atas konten — di layar
 * 390px separuh menu tidak terlihat dan posisinya jauh dari jempol. Sekarang pola
 * yang sama dengan dashboard karyawan: bar tetap di bawah, menu sekunder lewat sheet.
 */
export function AdminBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = adminMoreItems.some((item) => isActive(pathname, item.href, "/admin"));

  return (
    <nav
      aria-label="Navigasi admin"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur md:hidden print:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between gap-0.5 px-1 py-1">
        {adminPrimaryItems.map((item) => {
          const active = isActive(pathname, item.href, "/admin");
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

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto flex-1 flex-col gap-1 py-1.5 text-[11px]",
                moreActive ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <MenuIcon className="size-4" />
              Lainnya
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetHeader className="pb-1">
              <SheetTitle>Menu lainnya</SheetTitle>
              <SheetDescription>Kontrak, tugas, kasbon, dan pengaturan.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-4">
              {adminMoreItems.map((item) => {
                const active = isActive(pathname, item.href, "/admin");
                const Icon = item.icon;
                return (
                  <Button
                    key={item.href}
                    asChild
                    variant={active ? "secondary" : "ghost"}
                    className={cn("w-full justify-start gap-2", active && "font-semibold")}
                  >
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 px-4">
              <p className="text-xs text-muted-foreground">Keluar dari akun ini</p>
              <SignOutButton />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
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
