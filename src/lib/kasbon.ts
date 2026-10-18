/**
 * Aturan pemotongan kasbon per periode gaji.
 *
 * Karyawan bisa punya banyak kasbon sekaligus. Untuk setiap periode dia boleh:
 * - memotong kasbon tertentu di periode ini (penuh / sebagian / sesuai cicilan), atau
 * - menunda kasbon itu ke periode berikutnya.
 *
 * Keputusan disimpan di tabel `cash_advance_plans` dengan kunci (kasbon, periode).
 * Kalau tidak ada keputusan, dipakai aturan default: potong cicilan, atau sisa penuh
 * bila cicilan tidak diset — supaya kasbon lama tidak menggantung tanpa disadari.
 */

export type AdvanceDecision = "deduct" | "defer";

export type AdvanceLike = {
  id: string;
  balance: string | number;
  installmentAmount: string | number | null;
  requestedAt?: string | null;
  note?: string | null;
};

export type AdvancePlanLike = {
  cashAdvanceId: string;
  decision: string;
  amount: string | number | null;
};

export type AdvanceResolution = {
  /** Nominal yang dipotong pada periode ini (0 = tidak dipotong). */
  amount: number;
  /** true bila karyawan/admin menunda kasbon ini ke periode berikutnya. */
  deferred: boolean;
  /** Dari mana nominalnya berasal — dipakai untuk label & audit. */
  source: "plan-amount" | "installment" | "balance" | "deferred" | "settled";
};

function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Kasbon hanya boleh dipotong pada periode yang berakhir setelah kasbon dicairkan.
 * Tanpa aturan ini, kasbon yang disetujui bulan ini bisa "mengurangi" slip periode lalu
 * ketika admin menghitung ulang periode lampau.
 */
export function isAdvanceEligible(advance: AdvanceLike, periodEnd: string): boolean {
  if (!advance.requestedAt) return true;
  return advance.requestedAt <= periodEnd;
}

/** Hitung potongan satu kasbon untuk satu periode. */
export function resolveAdvanceDeduction(
  advance: AdvanceLike,
  plan: AdvancePlanLike | undefined,
): AdvanceResolution {
  const balance = Math.max(0, Math.round(toNum(advance.balance)));

  if (plan?.decision === "defer") {
    return { amount: 0, deferred: true, source: "deferred" };
  }
  if (balance <= 0) {
    return { amount: 0, deferred: false, source: "settled" };
  }

  const planned = plan?.decision === "deduct" ? Math.round(toNum(plan.amount)) : 0;
  if (planned > 0) {
    return { amount: Math.min(planned, balance), deferred: false, source: "plan-amount" };
  }

  const installment = Math.round(toNum(advance.installmentAmount));
  if (installment > 0) {
    return { amount: Math.min(installment, balance), deferred: false, source: "installment" };
  }

  return { amount: balance, deferred: false, source: "balance" };
}

/** Label baris slip supaya karyawan tahu kasbon mana yang dipotong. */
export function advanceLabel(advance: AdvanceLike, index: number, total: number): string {
  const parts: string[] = [];
  if (advance.requestedAt) {
    const formatted = new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    }).format(new Date(`${advance.requestedAt}T00:00:00`));
    parts.push(`Kasbon ${formatted}`);
  } else {
    parts.push(`Kasbon ${index + 1}`);
  }
  if (advance.note) parts.push(advance.note);
  if (total > 1) parts.push(`(${index + 1}/${total})`);
  return parts.join(" · ");
}

/** Ringkasan rencana untuk ditampilkan di UI (tanpa query DB). */
export function summarizePlans(
  advances: Array<{ advance: AdvanceLike; plan?: AdvancePlanLike }>,
): { deductTotal: number; deferredCount: number; deferredTotal: number } {
  let deductTotal = 0;
  let deferredCount = 0;
  let deferredTotal = 0;
  for (const item of advances) {
    const resolved = resolveAdvanceDeduction(item.advance, item.plan);
    if (resolved.deferred) {
      deferredCount += 1;
      deferredTotal += Math.max(0, Math.round(toNum(item.advance.balance)));
      continue;
    }
    deductTotal += resolved.amount;
  }
  return { deductTotal, deferredCount, deferredTotal };
}
