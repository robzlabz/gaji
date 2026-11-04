/**
 * THR (Tunjangan Hari Raya) — Permenaker No. 6 Tahun 2016 tentang THR Keagamaan.
 *
 * Modul ini **murni**: tanpa `server-only`, tanpa `@/db`, tanpa `next/*`, supaya bisa
 * diuji langsung lewat `bun scripts/check-thr.ts` dan dipakai bersama oleh pratinjau
 * halaman admin maupun penulisan slip (angka pratinjau = angka slip).
 *
 * Dasar hukum yang diterapkan:
 * - Pasal 2 ayat (1): pekerja yang sudah bekerja **1 bulan secara terus-menerus** berhak
 *   atas THR keagamaan. Kurang dari 1 bulan penuh = belum berhak (ditampilkan alasannya).
 * - Pasal 3 ayat (1) huruf a: masa kerja **12 bulan atau lebih** = **1× upah sebulan**.
 * - Pasal 3 ayat (1) huruf b: masa kerja **1–11 bulan** = **(masa kerja / 12) × upah sebulan**.
 * - Pasal 3 ayat (2): upah sebulan = upah pokok + tunjangan tetap. Untuk pekerja yang
 *   dibayar harian/jam/satuan hasil, upah sebulan = **rata-rata upah 12 bulan terakhir**
 *   (`averageMonthlyWageFromPayments` di bawah).
 * - Pasal 5 ayat (1): THR wajib dibayar paling lambat **7 hari sebelum** hari raya.
 */

/** Upah bulanan penuh = 12 bulan masa kerja (Permenaker 6/2016 Pasal 3 ayat (1) huruf a). */
export const THR_FULL_MONTHS = 12;

/** Sebulan penuh masa kerja minimal untuk berhak THR (Pasal 2 ayat (1)). */
export const THR_MIN_MONTHS = 1;

export type ThrWageSource = "monthly" | "average-12m";

export type PaymentRow = {
  /** Tanggal pembayaran/kejadian upah (YYYY-MM-DD). */
  date: string;
  /** Nominal upah (tanpa ongkos/transport) yang sudah dibayar. */
  amount: number;
};

export type ThrResult = {
  /** Berhak THR atau tidak. */
  eligible: boolean;
  /** Alasan bila tidak berhak (untuk ditampilkan di UI). */
  reason: string | null;
  /** Masa kerja penuh (bulan), dibulatkan ke bawah. */
  monthsWorked: number;
  /** Masa kerja dalam hari kalender (informatif). */
  daysWorked: number;
  /** Rasio upah: 1 untuk ≥12 bulan, monthsWorked/12 untuk 1–11 bulan. */
  ratio: number;
  /** Upah sebulan yang dipakai sebagai dasar (sudah dibulatkan). */
  monthlyWage: number;
  /** Nilai THR (rupiah, dibulatkan). */
  amount: number;
  /** Dasar upah: upah bulanan langsung atau rata-rata 12 bulan terakhir. */
  wageSource: ThrWageSource;
  /** Jumlah bulan yang ikut dirata-rata (0 = upah bulanan langsung). */
  monthsAveraged: number;
  /** Penjelasan satu kalimat siap tampil. */
  explanation: string;
};

type IsoParts = { y: number; m: number; d: number };

function parseIso(date: string | null | undefined): IsoParts | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function isoFrom(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m, d));
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Geser tanggal ISO sebanyak `months` (hari di-clamp ke akhir bulan tujuan). */
export function addMonthsIso(date: string, months: number): string {
  const parts = parseIso(date);
  if (!parts) return date;
  const target = new Date(Date.UTC(parts.y, parts.m + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  return isoFrom(y, m, Math.min(parts.d, lastDayOfMonth(y, m)));
}

/** Selisih hari kalender (boleh negatif bila `end` sebelum `start`). */
export function daysBetweenIso(start: string, end: string): number {
  const a = parseIso(start);
  const b = parseIso(end);
  if (!a || !b) return 0;
  const diff = Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d);
  return Math.round(diff / 86_400_000);
}

/**
 * Masa kerja dalam **bulan penuh** (dibulatkan ke bawah), dari `joinedAt` sampai
 * `referenceDate`. Contoh: masuk 2026-01-15, acuan 2026-09-14 → 7 bulan (belum penuh
 * 8 bulan). Masuk 2026-01-31, acuan 2026-02-28 → tetap 1 bulan (akhir bulan dianggap
 * penuh, sama seperti hitungan penggajian pada umumnya).
 */
export function fullMonthsBetween(joinedAt: string, referenceDate: string): number {
  const a = parseIso(joinedAt);
  const b = parseIso(referenceDate);
  if (!a || !b) return 0;

  let months = (b.y - a.y) * 12 + (b.m - a.m);
  const dayBoundary = Math.min(a.d, lastDayOfMonth(b.y, b.m));
  if (b.d < dayBoundary) months -= 1;
  return Math.max(0, months);
}

/**
 * Rata-rata upah bulanan dari pembayaran yang sudah terjadi — dipakai untuk pekerja
 * harian/jam/satuan hasil (Permenaker 6/2016 Pasal 3 ayat (2)).
 *
 * Jendela = `min(12 bulan, masa kerja)` terakhir sebelum tanggal acuan; pembagi =
 * jumlah bulan dalam jendela (minimal 1). Pembayaran di luar jendela diabaikan.
 */
export function averageMonthlyWageFromPayments(input: {
  payments: PaymentRow[];
  joinedAt: string;
  referenceDate: string;
}): { average: number; monthsCounted: number; total: number; windowStart: string } {
  const monthsWorked = fullMonthsBetween(input.joinedAt, input.referenceDate);
  const windowMonths = Math.min(THR_FULL_MONTHS, Math.max(1, monthsWorked));
  const windowStart = addMonthsIso(input.referenceDate, -windowMonths);

  let total = 0;
  for (const payment of input.payments) {
    if (payment.date < windowStart || payment.date > input.referenceDate) continue;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
  }

  return {
    average: Math.round(total / windowMonths),
    monthsCounted: windowMonths,
    total: Math.round(total),
    windowStart,
  };
}

/**
 * Hitung THR satu karyawan.
 *
 * `monthlyWage` untuk karyawan bulanan = `employees.pay_rate`; untuk harian/jam/satuan
 * hasil = hasil `averageMonthlyWageFromPayments`.
 */
export function computeThr(input: {
  joinedAt: string;
  referenceDate: string;
  monthlyWage: number;
  wageSource?: ThrWageSource;
  monthsAveraged?: number;
}): ThrResult {
  const wageSource: ThrWageSource = input.wageSource ?? "monthly";
  const monthsAveraged = wageSource === "average-12m" ? Math.max(0, input.monthsAveraged ?? 0) : 0;
  const monthsWorked = fullMonthsBetween(input.joinedAt, input.referenceDate);
  const daysWorked = Math.max(0, daysBetweenIso(input.joinedAt, input.referenceDate));
  const monthlyWage = Math.max(0, Math.round(Number(input.monthlyWage) || 0));

  const base = { monthsWorked, daysWorked, monthlyWage, wageSource, monthsAveraged };

  if (monthsWorked < THR_MIN_MONTHS) {
    return {
      ...base,
      eligible: false,
      reason: `Masa kerja baru ${daysWorked} hari — belum 1 bulan penuh, jadi belum berhak THR (Permenaker 6/2016 Pasal 2).`,
      ratio: 0,
      amount: 0,
      explanation: `Belum berhak THR: masa kerja ${daysWorked} hari dari ${input.joinedAt}.`,
    };
  }

  if (monthlyWage <= 0) {
    return {
      ...base,
      eligible: false,
      reason: "Upah belum diisi (tarif 0 atau belum ada upah dibayar 12 bulan terakhir).",
      ratio: 0,
      amount: 0,
      explanation: "Belum berhak THR: dasar upah bulanan belum ada.",
    };
  }

  const ratio = monthsWorked >= THR_FULL_MONTHS ? 1 : monthsWorked / THR_FULL_MONTHS;
  const amount = Math.round(ratio * monthlyWage);

  const explanation =
    monthsWorked >= THR_FULL_MONTHS
      ? `Masa kerja ${monthsWorked} bulan ≥ 12 bulan → 1× upah sebulan.`
      : `Masa kerja ${monthsWorked} bulan → ${monthsWorked}/12 × upah sebulan.`;

  return {
    ...base,
    eligible: true,
    reason: null,
    ratio,
    amount,
    explanation,
  };
}

/** Label bahasa Indonesia untuk dasar upah yang dipakai. */
export function thrWageSourceLabel(source: ThrWageSource, monthsAveraged = 0): string {
  return source === "monthly"
    ? "Upah bulanan"
    : `Rata-rata ${monthsAveraged} bulan terakhir`;
}

/** Batas akhir pembayaran THR: 7 hari sebelum hari raya (Permenaker 6/2016 Pasal 5). */
export function thrLatestPayDate(holidayDate: string): string {
  return shiftDays(holidayDate, -7);
}

/** Geser tanggal ISO sebanyak `days` hari kalender. */
export function shiftDays(date: string, days: number): string {
  const parts = parseIso(date);
  if (!parts) return date;
  const d = new Date(Date.UTC(parts.y, parts.m, parts.d + days));
  return d.toISOString().slice(0, 10);
}
