/**
 * Berkas transfer payroll.
 *
 * Modul ini **murni**: tanpa `server-only`, tanpa akses database, tanpa API Next.
 * Semua masukan berupa data biasa, sehingga bisa diuji lewat `scripts/check-payout.ts`
 * dan dipakai baik oleh server action maupun halaman admin.
 *
 * Alurnya: slip periode → saring status → validasi rekening → baris transfer →
 * CSV per bank (selalu diakhiri baris kontrol `TOTAL,<jumlah penerima>,<jumlah nominal>`).
 */
import { csvCell } from "./csv";

/* ------------------------------------------------------------------ */
/* Bank                                                                */
/* ------------------------------------------------------------------ */

export const BANK_OPTIONS = [
  { code: "BCA", label: "BCA" },
  { code: "MANDIRI", label: "Mandiri" },
  { code: "BNI", label: "BNI" },
  { code: "BRI", label: "BRI" },
  { code: "BTN", label: "BTN" },
  { code: "CIMB", label: "CIMB Niaga" },
  { code: "PERMATA", label: "Permata" },
  { code: "LAINNYA", label: "Bank lain" },
] as const;

export type BankCode = (typeof BANK_OPTIONS)[number]["code"];

const BANK_LABEL = new Map<string, string>(BANK_OPTIONS.map((bank) => [bank.code, bank.label]));

export function bankLabel(code: string | null | undefined): string {
  if (!code) return "";
  return BANK_LABEL.get(code.trim().toUpperCase()) ?? code.trim();
}

/* ------------------------------------------------------------------ */
/* Validasi rekening                                                   */
/* ------------------------------------------------------------------ */

/** Nomor rekening: hanya digit, 6–20 digit (panjang rekening bank di Indonesia). */
export const ACCOUNT_NUMBER_MIN = 6;
export const ACCOUNT_NUMBER_MAX = 20;

/** Nama pemilik rekening: 2–70 karakter, huruf (boleh spasi, titik, apostrof, strip). */
const ACCOUNT_NAME_PATTERN = /^[\p{L}][\p{L} .'\-]*$/u;
const ACCOUNT_NAME_MIN = 2;
const ACCOUNT_NAME_MAX = 70;

/**
 * Buang pemisah yang biasa diketik orang (spasi, titik, strip) tanpa mengubah digit.
 * Contoh: "123-456 7890" → "1234567890".
 */
export function normalizeAccountNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[\s.\-]/g, "");
}

export type BankAccount = {
  bankCode: string;
  bankLabel: string;
  accountNumber: string;
  accountName: string;
};

export type BankAccountInput = {
  bankCode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
};

export type BankAccountCheck =
  | ({ ok: true } & BankAccount)
  | { ok: false; reason: string };

/**
 * Validasi satu rekening. Dipakai form karyawan dan penyusunan berkas transfer,
 * jadi aturannya hanya ada di satu tempat.
 */
export function validateBankAccount(input: BankAccountInput): BankAccountCheck {
  const code = (input.bankCode ?? "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "Kode bank belum dipilih." };
  if (!BANK_LABEL.has(code)) return { ok: false, reason: `Kode bank "${code}" tidak dikenal.` };

  const accountNumber = normalizeAccountNumber(input.accountNumber);
  if (!accountNumber) return { ok: false, reason: "Nomor rekening belum diisi." };
  if (!/^\d+$/.test(accountNumber))
    return { ok: false, reason: "Nomor rekening hanya boleh berisi angka." };
  if (
    accountNumber.length < ACCOUNT_NUMBER_MIN ||
    accountNumber.length > ACCOUNT_NUMBER_MAX
  ) {
    return {
      ok: false,
      reason: `Nomor rekening harus ${ACCOUNT_NUMBER_MIN}–${ACCOUNT_NUMBER_MAX} digit (saat ini ${accountNumber.length}).`,
    };
  }

  const accountName = (input.accountName ?? "").replace(/\s+/g, " ").trim();
  if (!accountName) return { ok: false, reason: "Nama pemilik rekening belum diisi." };
  if (accountName.length < ACCOUNT_NAME_MIN || accountName.length > ACCOUNT_NAME_MAX)
    return {
      ok: false,
      reason: `Nama pemilik rekening harus ${ACCOUNT_NAME_MIN}–${ACCOUNT_NAME_MAX} karakter.`,
    };
  if (!ACCOUNT_NAME_PATTERN.test(accountName))
    return {
      ok: false,
      reason: "Nama pemilik rekening hanya boleh huruf, spasi, titik, apostrof, atau strip.",
    };

  return {
    ok: true,
    bankCode: code,
    bankLabel: bankLabel(code),
    accountNumber,
    accountName,
  };
}

/**
 * Nomor rekening untuk ditampilkan di layar: hanya 4 digit terakhir yang terbuka.
 * Contoh: "1234567890" → "******7890" (jumlah tanda bintang sama dengan digit
 * tersembunyi, minimal 4) sehingga admin tetap bisa mencocokkan tanpa memamerkan
 * nomor penuh.
 */
export function maskAccountNumber(raw: string | null | undefined): string {
  const digits = normalizeAccountNumber(raw);
  if (!digits) return "";
  if (digits.length <= 4) return "*".repeat(Math.max(4, digits.length));
  const hidden = Math.max(4, digits.length - 4);
  return "*".repeat(hidden) + digits.slice(-4);
}

/* ------------------------------------------------------------------ */
/* Baris transfer                                                      */
/* ------------------------------------------------------------------ */

/**
 * Status slip yang boleh masuk berkas transfer.
 *
 * Di aplikasi ini slip lahir `draft`, lalu menjadi `final` saat periode difinalkan
 * (status periode `approved`), `paid` setelah periode dibayar, dan `void` bila
 * dibatalkan. Jadi "approved" pada spesifikasi = slip yang sudah difinalkan:
 * `final`, `paid`, atau `approved` (nilai lama/import). `draft` dan `void` tidak pernah
 * ikut, dan unduhan ulang tetap menghasilkan baris yang sama (idempoten).
 */
export const PAYOUT_ELIGIBLE_STATUSES = ["approved", "final", "paid"] as const;

export function isPayoutEligible(status: string | null | undefined): boolean {
  if (!status) return false;
  return (PAYOUT_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export type PayoutSlipInput = {
  slipId: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string | null;
  /** Nominal bersih yang dibayarkan (kolom `payslips.net`). */
  net: number | string | null;
  status: string;
  bankCode?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  /** Sudah ditandai ditransfer sebelumnya (hanya informasi, tetap boleh diunduh ulang). */
  transferredAt?: Date | string | null;
};

export type PayoutRow = {
  no: number;
  slipId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  bankCode: string;
  bankLabel: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  remark: string;
  transferredAt: Date | string | null;
};

export type PayoutFailure = {
  slipId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  /** Alasan dalam bahasa Indonesia, siap ditampilkan di halaman admin. */
  reason: string;
};

export type PayoutSkipped = {
  slipId: string;
  employeeName: string;
  status: string;
  reason: string;
};

export type PayoutBatch = {
  periodLabel: string;
  rows: PayoutRow[];
  /** Slip approved yang tidak bisa ditransfer (rekening tidak valid / nominal tidak masuk akal). */
  failures: PayoutFailure[];
  /** Slip yang tidak ikut karena statusnya atau karena duplikat. */
  skipped: PayoutSkipped[];
  /** Jumlah nominal seluruh baris transfer; inilah angka pada baris kontrol. */
  total: number;
};

export type BuildPayoutBatchInput = {
  slips: PayoutSlipInput[];
  periodLabel: string;
  /** Awalan berita transfer; default "Gaji". */
  remarkPrefix?: string;
};

/** Berita transfer dibatasi 50 karakter agar diterima semua bank. */
export const REMARK_MAX_LENGTH = 50;

export function buildRemark(periodLabel: string, prefix = "Gaji"): string {
  const text = `${prefix} ${periodLabel}`.replace(/\s+/g, " ").trim();
  return text.length <= REMARK_MAX_LENGTH ? text : text.slice(0, REMARK_MAX_LENGTH);
}

function toAmount(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/**
 * Susun baris transfer dari slip satu periode.
 *
 * Aturan yang dijamin fungsi ini:
 * - hanya status `PAYOUT_ELIGIBLE_STATUSES` yang dipertimbangkan;
 * - satu slip = paling banyak satu baris (duplikat dibuang, bukan digabung);
 * - nominal ≤ 0 tidak ditransfer (masuk `failures`, bukan berkas);
 * - rekening tidak lengkap/tidak valid masuk `failures` beserta alasannya;
 * - baris diurutkan per nama sehingga unduhan berulang identik.
 */
export function buildPayoutBatch({
  slips,
  periodLabel,
  remarkPrefix = "Gaji",
}: BuildPayoutBatchInput): PayoutBatch {
  const remark = buildRemark(periodLabel, remarkPrefix);
  const rows: PayoutRow[] = [];
  const failures: PayoutFailure[] = [];
  const skipped: PayoutSkipped[] = [];
  const seen = new Set<string>();

  for (const slip of slips) {
    if (!isPayoutEligible(slip.status)) {
      skipped.push({
        slipId: slip.slipId,
        employeeName: slip.employeeName,
        status: slip.status,
        reason: `Status slip ${slip.status} tidak ikut transfer.`,
      });
      continue;
    }

    if (seen.has(slip.slipId)) {
      skipped.push({
        slipId: slip.slipId,
        employeeName: slip.employeeName,
        status: slip.status,
        reason: "Slip duplikat, hanya satu baris dibuat.",
      });
      continue;
    }
    seen.add(slip.slipId);

    const amount = toAmount(slip.net);
    const base = {
      slipId: slip.slipId,
      employeeId: slip.employeeId,
      employeeName: slip.employeeName,
      amount: Number.isFinite(amount) ? amount : 0,
    };

    if (!Number.isFinite(amount)) {
      failures.push({ ...base, reason: "Nominal net tidak bisa dibaca." });
      continue;
    }
    if (amount <= 0) {
      failures.push({
        ...base,
        reason: `Nominal net ${amount} — tidak ada uang yang perlu ditransfer.`,
      });
      continue;
    }

    if (!slip.bankCode && !slip.bankAccountNumber && !slip.bankAccountName) {
      failures.push({
        ...base,
        reason: "Rekening belum diisi — lengkapi bank, nomor, dan nama pemilik rekening.",
      });
      continue;
    }

    const account = validateBankAccount({
      bankCode: slip.bankCode,
      accountNumber: slip.bankAccountNumber,
      accountName: slip.bankAccountName,
    });

    if (!account.ok) {
      failures.push({ ...base, reason: `Rekening tidak valid — ${account.reason}` });
      continue;
    }

    rows.push({
      no: 0,
      slipId: slip.slipId,
      employeeId: slip.employeeId,
      employeeCode: slip.employeeCode ?? "",
      employeeName: slip.employeeName.trim(),
      bankCode: account.bankCode,
      bankLabel: account.bankLabel,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      amount,
      remark,
      transferredAt: slip.transferredAt ?? null,
    });
  }

  rows.sort(
    (a, b) => a.employeeName.localeCompare(b.employeeName, "id") || a.slipId.localeCompare(b.slipId),
  );
  rows.forEach((row, index) => {
    row.no = index + 1;
  });

  return {
    periodLabel,
    rows,
    failures,
    skipped,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export const PAYOUT_FORMATS = ["generic", "bca", "mandiri", "bni", "bri"] as const;
export type PayoutFormat = (typeof PAYOUT_FORMATS)[number];

type PayoutFormatSpec = {
  label: string;
  /** Kode bank pemilik format; null = format generik (semua bank). */
  bankCode: string | null;
  tag: string;
  headers: string[];
  row: (row: PayoutRow) => (string | number)[];
};

const FORMAT_SPECS: Record<PayoutFormat, PayoutFormatSpec> = {
  generic: {
    label: "Generik (semua bank)",
    bankCode: null,
    tag: "generik",
    headers: [
      "No",
      "Nama Penerima",
      "Bank",
      "Nomor Rekening",
      "Nama Rekening",
      "Jumlah Transfer",
      "Berita Transfer",
    ],
    row: (row) => [
      row.no,
      row.employeeName,
      row.bankLabel,
      row.accountNumber,
      row.accountName,
      row.amount,
      row.remark,
    ],
  },
  bca: {
    label: "BCA (KlikBCA Bisnis)",
    bankCode: "BCA",
    tag: "bca",
    headers: ["No", "Rekening Penerima", "Nama Penerima", "Jumlah Transfer", "Berita Transfer"],
    row: (row) => [row.no, row.accountNumber, row.accountName, row.amount, row.remark],
  },
  mandiri: {
    label: "Mandiri (Mandiri Cash Management)",
    bankCode: "MANDIRI",
    tag: "mandiri",
    headers: ["No", "Nomor Rekening", "Nama Penerima", "Jumlah Transfer", "Berita Transfer"],
    row: (row) => [row.no, row.accountNumber, row.accountName, row.amount, row.remark],
  },
  bni: {
    label: "BNI (BNI Direct)",
    bankCode: "BNI",
    tag: "bni",
    headers: ["No", "Nomor Rekening", "Nama Penerima", "Jumlah Transfer", "Berita Transfer"],
    row: (row) => [row.no, row.accountNumber, row.accountName, row.amount, row.remark],
  },
  bri: {
    label: "BRI (BRIMO/BRInets)",
    bankCode: "BRI",
    tag: "bri",
    headers: ["No", "Nomor Rekening", "Nama Penerima", "Jumlah Transfer", "Berita Transfer"],
    row: (row) => [row.no, row.accountNumber, row.accountName, row.amount, row.remark],
  },
};

export const PAYOUT_FORMAT_CHOICES = PAYOUT_FORMATS.map((format) => ({
  value: format,
  label: FORMAT_SPECS[format].label,
}));

export function isPayoutFormat(value: string | null | undefined): value is PayoutFormat {
  return !!value && (PAYOUT_FORMATS as readonly string[]).includes(value);
}

/** Baris yang masuk ke satu format: format bank hanya memuat rekening bank itu. */
export function rowsForFormat(batch: PayoutBatch, format: PayoutFormat): PayoutRow[] {
  const spec = FORMAT_SPECS[format];
  const rows = spec.bankCode
    ? batch.rows.filter((row) => row.bankCode === spec.bankCode)
    : batch.rows;
  return rows.map((row, index) => ({ ...row, no: index + 1 }));
}

/** Satu baris kontrol, selalu tiga sel: `TOTAL`, jumlah penerima, jumlah nominal. */
export function controlRow(rows: PayoutRow[]): string[] {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return ["TOTAL", `${rows.length} penerima`, String(total)];
}

function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map((cell) => csvCell(cell)).join(",");
}

export type RenderPayoutCsvInput = {
  format: PayoutFormat;
  batch: PayoutBatch;
  periodStart: string;
  periodEnd: string;
  /** Tanggal ekspor (YYYY-MM-DD), bagian dari nama file. */
  exportDate: string;
};

export type RenderedPayoutCsv = {
  format: PayoutFormat;
  formatLabel: string;
  /** Hanya rekening yang cocok dengan format (format generik = semua). */
  rows: PayoutRow[];
  total: number;
  filename: string;
  content: string;
};

/**
 * Render berkas CSV siap unduh. Baris terakhir selalu baris kontrol
 * `TOTAL,<jumlah penerima>,<jumlah nominal>` sehingga total bisa dicek tanpa
 * menjumlah ulang secara manual.
 */
export function renderPayoutCsv({
  format,
  batch,
  periodStart,
  periodEnd,
  exportDate,
}: RenderPayoutCsvInput): RenderedPayoutCsv {
  const spec = FORMAT_SPECS[format];
  const rows = rowsForFormat(batch, format);

  const lines = [
    csvLine(spec.headers),
    ...rows.map((row) => csvLine(spec.row(row))),
    csvLine(controlRow(rows)),
  ];

  const content = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const filename = `transfer-gaji_${spec.tag}_${periodStart}_${periodEnd}_${exportDate}.csv`;

  return {
    format,
    formatLabel: spec.label,
    rows,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    filename,
    content,
  };
}

/** Ringkasan untuk kartu di halaman admin. */
export function summarizeBatch(batch: PayoutBatch) {
  return {
    rowCount: batch.rows.length,
    failedCount: batch.failures.length,
    skippedCount: batch.skipped.length,
    total: batch.total,
    transferredCount: batch.rows.filter(
      (row) => row.transferredAt !== null && row.transferredAt !== undefined,
    ).length,
  };
}
