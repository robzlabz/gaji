"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export type NavItem = { href: string; label: string; icon: string };

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/admin" && item.href !== "/employee" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
              active
                ? "bg-brand-soft font-semibold text-brand"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            <span aria-hidden className="w-4 text-center text-xs opacity-70">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-1">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/employee" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px]",
                active ? "font-semibold text-brand" : "text-stone-500",
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
