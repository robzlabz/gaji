import { RotateCcwIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateID, rupiah, toNumber } from "@/lib/format";
import { periodLabel, type Period } from "@/lib/period";
import type { AdvanceResolution } from "@/lib/kasbon";

export type KasbonPlanItem = {
  advance: {
    id: string;
    principal: string;
    balance: string;
    installmentAmount: string | null;
    requestedAt: string;
    note: string | null;
    employeeName?: string;
  };
  resolution: AdvanceResolution;
  /** Keputusan yang sudah tersimpan (null = ikut aturan default). */
  planDecision: "deduct" | "defer" | null;
  planAmount: number | null;
};

/**
 * Daftar kasbon aktif + kontrol untuk menentukan nasibnya di periode gaji ini:
 * dipotong sekarang (penuh / sebagian) atau ditunda ke periode berikutnya.
 * Dipakai halaman karyawan maupun admin — aksinya dioper dari halaman masing-masing.
 */
export function KasbonPlanList({
  items,
  period,
  nextPeriod,
  action,
  showEmployee = false,
  emptyHint = "Tidak ada kasbon aktif yang bisa diatur untuk periode ini.",
}: {
  items: KasbonPlanItem[];
  period: Period;
  nextPeriod: Period;
  action: (formData: FormData) => Promise<void>;
  showEmployee?: boolean;
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const { advance, resolution, planDecision, planAmount } = item;
        const balance = Math.round(toNumber(advance.balance));
        const installment = Math.round(toNumber(advance.installmentAmount));
        const suggested = planAmount && planAmount > 0 ? planAmount : resolution.amount;
        const deferred = resolution.deferred;

        return (
          <li
            key={advance.id}
            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {showEmployee && advance.employeeName ? `${advance.employeeName} · ` : ""}
                Kasbon {formatDateID(advance.requestedAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                pokok {rupiah(toNumber(advance.principal))} · sisa{" "}
                <span className="font-medium text-foreground">{rupiah(balance)}</span>
                {installment > 0 ? ` · cicilan ${rupiah(installment)}` : " · tanpa cicilan"}
                {advance.note ? ` · ${advance.note}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {deferred ? (
                  <StatusBadge tone="warn">
                    ditunda ke {periodLabel(nextPeriod)}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="good">
                    dipotong {rupiah(resolution.amount)} periode ini
                  </StatusBadge>
                )}
                {planDecision === null ? (
                  <span className="text-xs text-muted-foreground">(aturan otomatis)</span>
                ) : null}
              </div>
            </div>

            <form action={action} className="flex shrink-0 flex-wrap items-end gap-2">
              <input type="hidden" name="advanceId" value={advance.id} />
              <input type="hidden" name="periodStart" value={period.start} />

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Potong periode ini (Rp)</span>
                <Input
                  name="amount"
                  inputMode="numeric"
                  defaultValue={suggested > 0 ? suggested : ""}
                  placeholder={installment > 0 ? installment.toString() : balance.toString()}
                  className="w-32"
                />
              </label>

              <Button type="submit" name="decision" value="deduct" size="sm">
                Potong
              </Button>
              <Button
                type="submit"
                name="decision"
                value="defer"
                variant="outline"
                size="sm"
                title={`Tunda ke ${periodLabel(nextPeriod)}`}
              >
                Tunda
              </Button>
              {planDecision ? (
                <Button
                  type="submit"
                  name="decision"
                  value="auto"
                  variant="ghost"
                  size="sm"
                  title="Hapus keputusan, kembali ke aturan otomatis"
                >
                  <RotateCcwIcon className="size-3.5" />
                </Button>
              ) : null}
            </form>
          </li>
        );
      })}
    </ul>
  );
}
