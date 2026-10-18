import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "default" | "good" | "warn" | "bad" | "info";

const TONE_CLASS: Record<Tone, string> = {
  default: "border-border bg-muted text-stone-600 dark:text-stone-300",
  good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400",
  bad: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400",
  info: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

/** Badge status dengan warna semantik (bukan warna primary). */
export function StatusBadge({
  tone = "default",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}
