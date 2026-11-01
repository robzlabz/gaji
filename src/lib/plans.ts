/**
 * Katalog paket langganan + matematika harga, periode, dan kuota.
 *
 * Modul ini **murni**: tanpa `server-only`, tanpa `@/db`, tanpa `next/*`.
 * Alasannya: harga tahunan & aturan kuota dipakai tiga tempat sekaligus —
 * halaman admin, server action, dan script verifikasi `scripts/check-billing.ts` —
 * sehingga harus bisa dijalankan tanpa koneksi database.
 */

export const PLAN_IDS = ["gratis", "dasar", "lengkap", "konsultan"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_CYCLES = ["monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "expired", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_METHODS = ["transfer", "qris"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Tagihan tahunan = 10× harga bulanan, jadi pelanggan tahunan dapat 2 bulan gratis
 * (lihat docs/business-case.md §5). Periode yang diberikan tetap 12 bulan.
 */
export const ANNUAL_BILLED_MONTHS = 10;
export const ANNUAL_PERIOD_MONTHS = 12;
export const MONTHLY_PERIOD_MONTHS = 1;

export const DEFAULT_PLAN_ID: PlanId = "gratis";
/** Organisasi tanpa baris langganan diperlakukan sebagai paket ini. */
export const FALLBACK_PLAN_ID: PlanId = "gratis";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Harga per bulan (Rp). `null` = nego, nominal diisi manual saat mencatat pembayaran. */
  monthlyPrice: number | null;
  /** Batas karyawan aktif. `null` = tanpa batas. */
  employeeLimit: number | null;
  /** Batas cabang/organisasi dalam satu akun. `null` = tanpa batas. */
  branchLimit: number | null;
  features: readonly string[];
  /** Paket yang direkomendasikan di halaman langganan. */
  highlight?: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  gratis: {
    id: "gratis",
    name: "Gratis",
    tagline: "Coba semua fitur dasar tanpa biaya.",
    monthlyPrice: 0,
    employeeLimit: 5,
    branchLimit: 1,
    features: ["Maksimal 5 karyawan aktif", "1 cabang", "Absensi, cuti, payroll bulanan"],
  },
  dasar: {
    id: "dasar",
    name: "Dasar",
    tagline: "Untuk usaha satu cabang yang mulai tumbuh.",
    monthlyPrice: 50_000,
    employeeLimit: 15,
    branchLimit: 1,
    features: ["Maksimal 15 karyawan aktif", "1 cabang", "Semua fitur Gratis"],
  },
  lengkap: {
    id: "lengkap",
    name: "Lengkap",
    tagline: "Untuk usaha dengan banyak karyawan dan cabang.",
    monthlyPrice: 100_000,
    employeeLimit: 50,
    branchLimit: null,
    features: [
      "Maksimal 50 karyawan aktif",
      "Multi-cabang",
      "Semua fitur Dasar + ekspor & MCP",
    ],
    highlight: true,
  },
  konsultan: {
    id: "konsultan",
    name: "Konsultan",
    tagline: "Untuk konsultan payroll yang mengelola banyak klien.",
    monthlyPrice: null,
    employeeLimit: null,
    branchLimit: null,
    features: ["Karyawan & cabang tanpa batas", "Harga nego", "Pendampingan onboarding"],
  },
};

export const PLAN_LIST: readonly Plan[] = PLAN_IDS.map((id) => PLANS[id]);

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Paket tak dikenal / organisasi tanpa langganan → paket Gratis. */
export function getPlan(planId: string | null | undefined): Plan {
  return isPlanId(planId) ? PLANS[planId] : PLANS[FALLBACK_PLAN_ID];
}

export function planLabel(planId: string | null | undefined): string {
  return getPlan(planId).name;
}

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: "Bulanan",
  annual: "Tahunan",
};

/** Harga tahunan dari harga bulanan: 10× (dua bulan gratis). `null` tetap `null` (nego). */
export function annualPrice(monthlyPrice: number | null): number | null {
  return monthlyPrice === null ? null : monthlyPrice * ANNUAL_BILLED_MONTHS;
}

/** Harga satu paket untuk satu siklus. `null` = nego (nominal diisi manual). */
export function planPrice(planId: string, cycle: BillingCycle): number | null {
  const plan = getPlan(planId);
  return cycle === "annual" ? annualPrice(plan.monthlyPrice) : plan.monthlyPrice;
}

/** Jumlah bulan periode yang diberikan untuk satu siklus tagihan. */
export function cycleMonths(cycle: BillingCycle): number {
  return cycle === "annual" ? ANNUAL_PERIOD_MONTHS : MONTHLY_PERIOD_MONTHS;
}

/* ------------------------------------------------------------------ */
/* Tanggal (YYYY-MM-DD, aritmetika UTC supaya bebas zona waktu)         */
/* ------------------------------------------------------------------ */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseISO(iso: string): Date {
  if (!DATE_ONLY.test(iso)) throw new Error(`Tanggal tidak valid: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISO(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

/** Tambah bulan dengan pengaman akhir bulan: 31 Jan + 1 bulan = 28/29 Feb. */
export function addMonthsISO(iso: string, months: number): string {
  const date = parseISO(iso);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoOf(target);
}

/**
 * Periode berbayar untuk satu siklus.
 * `end` inklusif: mulai 1 Nov + 1 bulan → 30 Nov (bukan 1 Des), sama seperti
 * cara membaca "periode 1–30 November". Untuk tanggal yang tidak ada di bulan
 * berikutnya (31 Jan + 1 bulan) periode berakhir 27 Feb dan periode berikutnya
 * mulai 28 Feb, jadi tidak ada hari yang hilang atau dibayar dua kali.
 */
export function periodFor(startISO: string, cycle: BillingCycle): { start: string; end: string } {
  const nextStart = addMonthsISO(startISO, cycleMonths(cycle));
  return { start: startISO, end: addDaysISO(nextStart, -1) };
}

/**
 * Awal periode baru saat pembayaran dicatat.
 * Periode yang masih berjalan **tidak dihanguskan**: pembayaran menumpuk dari
 * sehari setelah periode aktif berakhir.
 */
export function nextPeriodStart(currentEnd: string | null | undefined, todayISO: string): string {
  if (currentEnd && currentEnd >= todayISO) return addDaysISO(currentEnd, 1);
  return todayISO;
}

/* ------------------------------------------------------------------ */
/* Kuota                                                              */
/* ------------------------------------------------------------------ */

export type QuotaKind = "employee" | "branch";

export const QUOTA_LABEL: Record<QuotaKind, string> = {
  employee: "karyawan aktif",
  branch: "cabang",
};

export type QuotaResult = {
  allowed: boolean;
  kind: QuotaKind;
  planId: PlanId;
  planName: string;
  /** `null` = tanpa batas. */
  limit: number | null;
  used: number;
  remaining: number | null;
  /** Pesan siap tampil; menyebut paket dan batasnya saat ditolak. */
  message: string;
};

function limitFor(plan: Plan, kind: QuotaKind): number | null {
  return kind === "employee" ? plan.employeeLimit : plan.branchLimit;
}

/** Paket termurah yang menaikkan batas untuk jenis kuota ini (untuk saran upgrade). */
function upgradeSuggestion(plan: Plan, kind: QuotaKind): Plan | null {
  const current = limitFor(plan, kind);
  const order: PlanId[] = ["gratis", "dasar", "lengkap", "konsultan"];
  const startIndex = order.indexOf(plan.id);
  for (const id of order.slice(startIndex + 1)) {
    const candidate = PLANS[id];
    const limit = limitFor(candidate, kind);
    if (limit === null || current === null || limit > current) return candidate;
  }
  return null;
}

/**
 * Cek kuota. `used` = jumlah yang **sudah terpakai sekarang** (belum termasuk
 * yang akan ditambahkan), jadi `used + 1 > limit` berarti penambahan ditolak.
 */
export function checkQuota(kind: QuotaKind, planId: string | null | undefined, used: number): QuotaResult {
  const plan = getPlan(planId);
  const limit = limitFor(plan, kind);
  const allowed = limit === null || used + 1 <= limit;
  const upgrade = allowed ? null : upgradeSuggestion(plan, kind);
  const unit = QUOTA_LABEL[kind];

  let message: string;
  if (allowed) {
    message =
      limit === null
        ? `Paket ${plan.name}: ${unit} tanpa batas.`
        : `Paket ${plan.name}: ${used} dari ${limit} ${unit}.`;
  } else {
    message =
      `Paket ${plan.name} dibatasi ${limit} ${unit} — sekarang sudah ${used}. ` +
      (kind === "employee" ? "Nonaktifkan karyawan lain" : "Hapus cabang lain") +
      (upgrade ? ` atau naik ke paket ${upgrade.name}.` : ".");
  }

  return {
    allowed,
    kind,
    planId: plan.id,
    planName: plan.name,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    message,
  };
}

export function employeeQuota(planId: string | null | undefined, used: number): QuotaResult {
  return checkQuota("employee", planId, used);
}

export function branchQuota(planId: string | null | undefined, used: number): QuotaResult {
  return checkQuota("branch", planId, used);
}

/* ------------------------------------------------------------------ */
/* Pembayaran                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedPayment = {
  plan: Plan;
  cycle: BillingCycle;
  /** Nominal yang ditagih. */
  amount: number;
  periodStart: string;
  periodEnd: string;
  /** Jatuh tempo = awal periode (bayar di muka). */
  dueAt: string;
};

/**
 * Keputusan satu pembayaran manual: nominal + periode yang didapat.
 *
 * Dipisah dari DB supaya `scripts/check-billing.ts` bisa membuktikan aturannya:
 * harga paket tetap tidak bisa ditawar lewat form (nominal manual diabaikan),
 * sedangkan paket nego wajib diisi. Periode menumpuk dari `currentPeriodEnd`.
 */
export function resolvePayment(input: {
  planId: string;
  cycle: BillingCycle;
  manualAmount?: number | null;
  currentPeriodEnd?: string | null;
  todayISO: string;
}): ResolvedPayment {
  const plan = getPlan(input.planId);
  const listPrice = planPrice(plan.id, input.cycle);
  const amount = listPrice ?? Math.round(input.manualAmount ?? 0);

  if (listPrice === null && amount <= 0) {
    throw new Error("Paket Konsultan harganya nego: isi nominal tagihan lebih dari 0.");
  }

  const periodStart = nextPeriodStart(input.currentPeriodEnd ?? null, input.todayISO);
  const period = periodFor(periodStart, input.cycle);

  return {
    plan,
    cycle: input.cycle,
    amount,
    periodStart: period.start,
    periodEnd: period.end,
    dueAt: period.start,
  };
}

/* ------------------------------------------------------------------ */
/* Nomor tagihan                                                      */
/* ------------------------------------------------------------------ */

/**
 * Nomor tagihan yang mudah dibaca: `INV-202611-1A2B3C4D-001`
 * (bulan terbit, potongan id organisasi, urutan tagihan bulan itu).
 */
export function buildInvoiceNumber(input: {
  orgId: string;
  issuedAt: string;
  seq: number;
}): string {
  const month = input.issuedAt.slice(0, 7).replace("-", "");
  const orgPart = input.orgId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `INV-${month}-${orgPart}-${String(input.seq).padStart(3, "0")}`;
}
