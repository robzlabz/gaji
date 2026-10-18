import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabNavItem = {
  key: string;
  label: string;
  href: string;
  /** Angka kecil di kanan label (mis. jumlah data). 0/kosong = tidak ditampilkan. */
  badge?: number;
};

/**
 * Tab navigasi berbasis URL (server component, tanpa state klien).
 * Setiap tab punya URL sendiri sehingga tab tetap terbuka setelah server action
 * melakukan redirect — perilaku yang tidak didapat dari Tabs radix client-side.
 */
export function TabNav({ items, active }: { items: TabNavItem[]; active: string }) {
  return (
    <div
      role="tablist"
      aria-label="Detail karyawan"
      className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground focus-visible:text-foreground",
            )}
          >
            {item.label}
            {typeof item.badge === "number" && item.badge > 0 ? (
              <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
