import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label + kontrol + hint untuk form server action.
 * Memakai elemen <label> asli supaya klik label tetap fokus ke kontrolnya
 * tanpa perlu mengelola id/aria tambahan.
 */
export function FormField({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Select native dengan gaya yang sama seperti Input shadcn. */
export function SelectInput({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

/** Baris checkbox + teks, dipakai untuk flag seperti "buat akun login". */
export function CheckField({
  name,
  label,
  defaultChecked,
  className,
}: {
  name: string;
  label: ReactNode;
  defaultChecked?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      <span className="text-muted-foreground">{label}</span>
    </label>
  );
}
