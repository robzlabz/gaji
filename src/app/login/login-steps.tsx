import { cn } from "@/lib/utils";

/**
 * Penunjuk langkah masuk: nomor HP dulu, PIN di halaman berikutnya.
 * Bukan komponen klien — hanya menandai langkah aktif.
 */
export function LoginSteps({ active }: { active: 1 | 2 }) {
  const steps = [
    { step: 1 as const, label: "Nomor HP" },
    { step: 2 as const, label: "PIN" },
  ];

  return (
    <ol className="mb-4 flex items-center justify-center gap-2 text-xs">
      {steps.map((item, index) => {
        const done = item.step < active;
        const current = item.step === active;
        return (
          <li key={item.step} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden className="h-px w-6 bg-border" />
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
                current && "bg-primary/10 font-medium text-foreground",
                done && "text-foreground/70",
                !current && !done && "text-muted-foreground",
              )}
              aria-current={current ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
                  current
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {item.step}
              </span>
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
