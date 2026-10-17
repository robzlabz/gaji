"use client";

import { btnPrimary } from "@/components/ui";

export function PrintButton({ label = "Cetak / simpan PDF" }: { label?: string }) {
  return (
    <button type="button" className={btnPrimary} onClick={() => window.print()}>
      {label}
    </button>
  );
}
