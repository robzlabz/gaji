import Link from "next/link";
import type { ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-brand focus:ring-2 focus:ring-brand/20";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50";

export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50";

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(0,0,0,0.03)]",
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "warn" | "good";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-200 bg-amber-50"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50"
        : "border-line bg-card";
  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-stone-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const badgeTones = {
  default: "bg-stone-100 text-stone-700 border-stone-200",
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  brand: "bg-brand-soft text-brand border-emerald-200",
};

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            {head.map((cell, i) => (
              <th key={i} className="whitespace-nowrap py-2 pr-4 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("py-2.5 pr-4 align-middle", className)}>{children}</td>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-stone-50/60 px-4 py-8 text-center">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
        active
          ? "bg-brand-soft font-semibold text-brand"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
      )}
    >
      {children}
    </Link>
  );
}
