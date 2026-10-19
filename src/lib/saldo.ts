/**
 * Saldo prabayar (uang muka) + ongkos per kedatangan.
 *
 * Kasus nyata yang jadi acuan modul ini: karyawan per jam Rp 10.000, tiap kedatangan
 * dapat ongkos Rp 10.000. Owner mengirim uang lebih dulu ke karyawan (saldo), lalu
 * setiap kehadiran yang di-approve **memotong** saldo itu. Slip gaji bulanan tetap
 * dibuat, tapi isinya jadi "upah + ongkos − yang sudah dibayar via saldo".
 *
 * Aturan angka di sini sengaja murni (tanpa DB) supaya bisa dites dengan `tsx`, dan
 * dipakai **bersama** oleh ledger saldo (`saldo-server.ts`) dan slip (`payroll.ts`).
 * Kalau keduanya menghitung sendiri-sendiri, angka saldo dan slip bisa berbeda.
 */

/** Ambang peringatan saldo tipis. Hard-coded sesuai permintaan owner. */
export const SALDO_WARN_THRESHOLD = 200_000;

export type RateHistoryRow = {
  kind: string;
  payRate: string | number;
  effectiveFrom: string;
};

function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tarif yang berlaku pada satu tanggal (\"tarif saat kejadian\").
 *
 * Ambil baris riwayat terbaru dengan `effectiveFrom <= tanggal`. Kalau tidak ada
 * (mis. absensi sebelum riwayat dibuat), pakai `fallback` = tarif karyawan sekarang.
 */
export function rateAtDate(
  rows: RateHistoryRow[],
  date: string,
  kind: "wage" | "transport" = "wage",
  fallback: string | number | null = 0,
): number {
  let best: { effectiveFrom: string; value: number } | null = null;
  for (const row of rows) {
    if (row.kind !== kind) continue;
    if (row.effectiveFrom > date) continue;
    if (!best || row.effectiveFrom >= best.effectiveFrom) {
      best = { effectiveFrom: row.effectiveFrom, value: toNum(row.payRate) };
    }
  }
  return best ? best.value : toNum(fallback);
}

export type AccrualEntryInput = {
  /** Menit kerja efektif (sudah dikurangi istirahat). */
  minutes: number;
  /** Bagian dari menit kerja yang dihitung lembur (catatan manual). */
  overtimeMinutes?: number;
  /** Tarif per jam yang berlaku pada tanggal absensi. */
  rate: number;
  /** Ongkos kedatangan yang tersimpan di baris absensi. */
  transportAmount?: number;
  /** Pengali lembur dari pengaturan org (default 1). */
  overtimeMultiplier?: number;
};

export type AccrualBreakdown = {
  /** Menit kerja reguler (menit total − lembur). */
  regularMinutes: number;
  overtimeMinutes: number;
  /** Upah reguler & lembur, masing-masing dibulatkan per kedatangan. */
  regularWage: number;
  overtimeWage: number;
  /** Upah = reguler + lembur. */
  wageAmount: number;
  /** Ongkos kedatangan (0 kalau tidak ada). */
  transportAmount: number;
  /** Total yang memotong saldo = upah + ongkos. */
  total: number;
};

/**
 * Nilai satu kedatangan yang di-approve.
 *
 * Pembulatan dilakukan **per kedatangan**, bukan per periode seperti versi lama,
 * karena angka inilah yang benar-benar memotong saldo tiap hari. Slip memakai
 * penjumlahan angka yang sama supaya saldo dan slip tidak pernah selisih.
 */
export function accrualForEntry(input: AccrualEntryInput): AccrualBreakdown {
  const minutes = Math.max(0, Math.floor(toNum(input.minutes)));
  const overtime = Math.min(minutes, Math.max(0, Math.floor(toNum(input.overtimeMinutes))));
  const regularMinutes = minutes - overtime;
  const rate = Math.max(0, toNum(input.rate));
  const multiplier = input.overtimeMultiplier && input.overtimeMultiplier > 0 ? input.overtimeMultiplier : 1;
  const transportAmount = Math.max(0, Math.round(toNum(input.transportAmount)));

  const regularWage = Math.round((regularMinutes / 60) * rate);
  const overtimeWage = Math.round((overtime / 60) * rate * multiplier);
  const wageAmount = regularWage + overtimeWage;

  return {
    regularMinutes,
    overtimeMinutes: overtime,
    regularWage,
    overtimeWage,
    wageAmount,
    transportAmount,
    total: wageAmount + transportAmount,
  };
}

/**
 * Berapa bagian upah periode ini yang sudah dibayar lewat saldo.
 *
 * - `accrualTotal` = total accrual (upah + ongkos) yang tercatat di ledger untuk periode ini.
 * - `balanceStart` = saldo sebelum periode dimulai (dari ledger, bukan dari cache).
 * - `fundingInPeriod` = top up/koreksi/pelunasan yang terjadi di dalam periode.
 *
 * Yang bisa ditutup saldo hanya sebesar uang yang benar-benar tersedia. Sisanya
 * (`shortfall`) = kekurangan bayar yang harus diserahkan tunai saat payroll difinalkan,
 * dan dicatat sebagai txn `settle` supaya saldo kembali ke 0.
 */
export function coverageForPeriod(input: {
  accrualTotal: number;
  balanceStart: number;
  fundingInPeriod: number;
}): { available: number; covered: number; shortfall: number } {
  const accrualTotal = Math.max(0, Math.round(toNum(input.accrualTotal)));
  const available = Math.max(0, Math.round(toNum(input.balanceStart) + toNum(input.fundingInPeriod)));
  const covered = Math.min(accrualTotal, available);
  return { available, covered, shortfall: accrualTotal - covered };
}

/** Saldo di bawah ambang → tampilkan peringatan. Saldo minus tetap dianggap tipis. */
export function isSaldoLow(balance: number): boolean {
  return toNum(balance) < SALDO_WARN_THRESHOLD;
}

/** Label status saldo untuk badge di UI. */
export function saldoTone(balance: number): "bad" | "warn" | "good" {
  const n = toNum(balance);
  if (n < 0) return "bad";
  if (n < SALDO_WARN_THRESHOLD) return "warn";
  return "good";
}

/** Kalimat singkat untuk kartu saldo. */
export function saldoMessage(balance: number): string {
  const n = Math.round(toNum(balance));
  if (n < 0) {
    return `Saldo minus ${formatRupiahPlain(Math.abs(n))} — owner masih kurang bayar sebesar itu.`;
  }
  if (n < SALDO_WARN_THRESHOLD) {
    return `Saldo tinggal ${formatRupiahPlain(n)} (di bawah ${formatRupiahPlain(SALDO_WARN_THRESHOLD)}). Segera top up.`;
  }
  return `Saldo ${formatRupiahPlain(n)}.`;
}

function formatRupiahPlain(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export type SaldoTxnLike = {
  kind: string;
  amount: string | number;
  occurredAt: string;
};

/** Saldo sebelum tanggal tertentu (dipakai untuk saldo awal periode). */
export function balanceBefore(txns: SaldoTxnLike[], date: string): number {
  return txns
    .filter((txn) => txn.occurredAt < date)
    .reduce((sum, txn) => sum + toNum(txn.amount), 0);
}

/**
 * Ringkasan ledger untuk satu periode.
 *
 * `fundingInPeriod` sengaja **tidak** memasukkan `accrual` (itu pemakaian saldo, bukan
 * penambahan dana) dan juga **tidak** memasukkan `settle` (pelunasan tunai adalah
 * pembayaran utang periode yang sudah lewat, bukan dana baru untuk periode ini).
 * Kalau `settle` ikut dihitung, menghitung ulang slip akan menggelembungkan
 * `covered` dan menghapus kekurangan bayar dari slip.
 */
export function periodLedgerSummary(txns: SaldoTxnLike[], period: { start: string; end: string }) {
  let accrualTotal = 0;
  let fundingInPeriod = 0;
  for (const txn of txns) {
    if (txn.occurredAt < period.start || txn.occurredAt > period.end) continue;
    if (txn.kind === "accrual") accrualTotal += Math.abs(toNum(txn.amount));
    else if (txn.kind === "topup" || txn.kind === "adjust") fundingInPeriod += toNum(txn.amount);
  }
  return { accrualTotal, fundingInPeriod };
}

/** Estimasi berapa hari kerja lagi saldo bertahan, dari rata-rata upah harian. */
export function daysLeftFromSaldo(balance: number, averageDailyAccrual: number): number | null {
  const avg = toNum(averageDailyAccrual);
  if (avg <= 0) return null;
  const n = toNum(balance);
  if (n <= 0) return 0;
  return Math.floor(n / avg);
}

/** Jenis transaksi saldo yang dikenal ledger. */
export const SALDO_KINDS = ["topup", "accrual", "adjust", "settle"] as const;
export type SaldoKind = (typeof SALDO_KINDS)[number];

/** Label bahasa Indonesia untuk jenis transaksi saldo. */
export function saldoKindLabel(kind: string): string {
  switch (kind) {
    case "topup":
      return "Top up dari owner";
    case "accrual":
      return "Potong upah harian";
    case "adjust":
      return "Koreksi manual";
    case "settle":
      return "Pelunasan tunai di slip";
    default:
      return kind;
  }
}

/** Tone badge untuk satu baris ledger: uang masuk = hijau, potong upah = netral. */
export function saldoKindTone(kind: string): "good" | "warn" | "info" {
  switch (kind) {
    case "topup":
      return "good";
    case "settle":
      return "info";
    case "adjust":
      return "warn";
    default:
      return "info";
  }
}
