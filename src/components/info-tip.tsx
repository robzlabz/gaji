"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Ikon (i) kecil dengan tooltip penjelasan.
 * Muncul saat hover maupun fokus keyboard, jadi tetap bisa dibaca tanpa mouse.
 */
export function InfoTip({
  label,
  children,
  className,
}: {
  /** Label aksesibel untuk pembaca layar (isi tooltip tidak selalu terbaca). */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={
              "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none " +
              (className ?? "")
            }
          >
            <InfoIcon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-left leading-relaxed">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
