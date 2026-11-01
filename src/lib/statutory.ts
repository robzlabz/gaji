/**
 * Perhitungan potongan wajib karyawan: PPh 21 (metode setahun) + iuran BPJS.
 *
 * **Modul murni**: tidak boleh mengimpor `server-only`, `@/db`, atau `next/*`.
 * Dipakai oleh `payroll.ts` (server), estimasi gaji karyawan, dan skrip
 * verifikasi `bun scripts/check-pajak.ts` tanpa akses database.
 *
 * Batas yang disepakati (issue #78):
 * - PPh 21 memakai metode **setahun**: upah periode ini disetahunkan (×12), dihitung
 *   sekali, lalu dibagi 12 untuk potongan bulanan. TER PP 58/2023 menyusul.
 * - Upah yang dipakai sebagai dasar = bruto slip periode ini (gaji pokok, lembur,
 *   tugas, ongkos). Tunjangan tetap vs tidak tetap belum dipisah.
 * - Semua iuran dihitung dari upah bruto, bukan dari upah setelah potongan.
 */

/* ------------------------------------------------------------------ */
/* PTKP                                                                */
/* ------------------------------------------------------------------ */

export type PtkpStatus = "TK/0" | "TK/1" | "TK/2" | "TK/3" | "K/0" | "K/1" | "K/2" | "K/3";

/** Status PTKP yang didukung, urut dari yang paling umum dipakai. */
export const PTKP_STATUSES: PtkpStatus[] = [
  "TK/0",
  "TK/1",
  "TK/2",
  "TK/3",
  "K/0",
  "K/1",
  "K/2",
  "K/3",
];

/** PTKP setahun (PMK 101/PMK.010/2016): TK/0 54 jt + 4,5 jt per tanggungan. */
export const PTKP_ANNUAL: Record<PtkpStatus, number> = {
  "TK/0": 54_000_000,
  "TK/1": 58_500_000,
  "TK/2": 63_000_000,
  "TK/3": 67_500_000,
  "K/0": 58_500_000,
  "K/1": 63_000_000,
  "K/2": 67_500_000,
  "K/3": 72_000_000,
};

export const PTKP_LABEL: Record<PtkpStatus, string> = {
  "TK/0": "TK/0 · lajang, 0 tanggungan",
  "TK/1": "TK/1 · lajang, 1 tanggungan",
  "TK/2": "TK/2 · lajang, 2 tanggungan",
  "TK/3": "TK/3 · lajang, 3 tanggungan",
  "K/0": "K/0 · kawin, 0 tanggungan",
  "K/1": "K/1 · kawin, 1 tanggungan",
  "K/2": "K/2 · kawin, 2 tanggungan",
  "K/3": "K/3 · kawin, 3 tanggungan",
};

export function isPtkpStatus(value: unknown): value is PtkpStatus {
  return typeof value === "string" && (PTKP_STATUSES as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* PPh 21 — tarif progresif UU HPP (Pasal 17)                           */
/* ------------------------------------------------------------------ */

/** Tarif PPh 21 orang pribadi; `upTo` = batas atas lapisan PKP setahun. */
const PPH21_BRACKETS: Array<{ upTo: number; rate: number }> = [
  { upTo: 60_000_000, rate: 0.05 },
  { upTo: 250_000_000, rate: 0.15 },
  { upTo: 500_000_000, rate: 0.25 },
  { upTo: 5_000_000_000, rate: 0.3 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.35 },
];

/** Biaya jabatan 5% dari penghasilan bruto, maksimal Rp6 juta setahun. */
const BIAYA_JABATAN_RATE = 0.05;
const BIAYA_JABATAN_CAP = 6_000_000;

/** PKP dibulatkan ke bawah ke ribuan penuh. */
const PKP_ROUNDING = 1_000;

/** Tanpa NPWP: tarif Pasal 17 dinaikkan 20% (UU HPP Pasal 21 ayat 5a). */
const NO_NPWP_SURCHARGE = 0.2;

/* ------------------------------------------------------------------ */
/* BPJS — tarif & batas upah organisasi                                */
/* ------------------------------------------------------------------ */

export type JkkRiskClass = "very_low" | "low" | "medium" | "high" | "very_high";

/** Kelas risiko JKK beserta tarif iuran perusahaan (PP 44/2015). */
export const JKK_RISK_CLASSES: Array<{ value: JkkRiskClass; label: string; pct: number }> = [
  { value: "very_low", label: "Sangat rendah (kantor/jasa) · 0,24%", pct: 0.24 },
  { value: "low", label: "Rendah · 0,54%", pct: 0.54 },
  { value: "medium", label: "Sedang · 0,89%", pct: 0.89 },
  { value: "high", label: "Tinggi · 1,27%", pct: 1.27 },
  { value: "very_high", label: "Sangat tinggi · 1,74%", pct: 1.74 },
];

export function isJkkRiskClass(value: unknown): value is JkkRiskClass {
  return typeof value === "string" && JKK_RISK_CLASSES.some((item) => item.value === value);
}

/**
 * Satu program iuran. Persentase disimpan dalam persen (1 = 1%), bukan pecahan,
 * supaya form pengaturan bisa memakai angka yang sama dengan yang dibaca admin.
 */
export type ContributionRate = {
  employeePct: number;
  employerPct: number;
  /** Batas upah bulanan sebagai dasar iuran; null = tanpa batas. */
  wageCap: number | null;
};

export type StatutorySettings = {
  kesehatan: ContributionRate;
  jht: ContributionRate;
  jp: ContributionRate;
  jkk: ContributionRate & { riskClass: JkkRiskClass };
  jkm: ContributionRate;
};

/**
 * Default sesuai aturan yang berlaku. Disimpan di kode supaya organisasi lama
 * (kolom `statutory_settings` masih null) tetap punya tarif yang masuk akal.
 *
 * Catatan tarif: Kesehatan 4%/1% dengan batas upah Rp12 jt; JHT 3,7%/2% tanpa batas;
 * JP 2%/1% dengan batas upah Rp10.547.400 (batas 2025, bisa diubah di pengaturan);
 * JKK 0,24% (kelas sangat rendah); JKM 0,3%.
 */
export const DEFAULT_STATUTORY_SETTINGS: StatutorySettings = {
  kesehatan: { employeePct: 1, employerPct: 4, wageCap: 12_000_000 },
  jht: { employeePct: 2, employerPct: 3.7, wageCap: null },
  jp: { employeePct: 1, employerPct: 2, wageCap: 10_547_400 },
  jkk: { riskClass: "very_low", employeePct: 0, employerPct: 0.24, wageCap: null },
  jkm: { employeePct: 0, employerPct: 0.3, wageCap: null },
};

function toNum(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pctValue(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  return Math.min(100, Math.max(0, toNum(value)));
}

function resolveRate(raw: unknown, fallback: ContributionRate): ContributionRate {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // `wageCap` yang diisi 0 / null / kosong berarti tanpa batas upah.
  const wageCap =
    "wageCap" in src ? (toNum(src.wageCap) > 0 ? Math.round(toNum(src.wageCap)) : null) : fallback.wageCap;

  return {
    employeePct: pctValue(src.employeePct, fallback.employeePct),
    employerPct: pctValue(src.employerPct, fallback.employerPct),
    wageCap,
  };
}

/**
 * Gabungkan JSON `organizations.statutory_settings` dengan default di kode.
 * Nilai yang hilang / tidak masuk akal diabaikan, jadi slip lama tidak pernah
 * dihitung dengan tarif NaN ketika admin hanya mengisi sebagian.
 */
export function resolveStatutorySettings(raw: unknown): StatutorySettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const jkkSrc = (src.jkk && typeof src.jkk === "object" ? src.jkk : {}) as Record<string, unknown>;
  const riskClass = isJkkRiskClass(jkkSrc.riskClass)
    ? jkkSrc.riskClass
    : DEFAULT_STATUTORY_SETTINGS.jkk.riskClass;
  const riskPct =
    JKK_RISK_CLASSES.find((item) => item.value === riskClass)?.pct ??
    DEFAULT_STATUTORY_SETTINGS.jkk.employerPct;

  return {
    kesehatan: resolveRate(src.kesehatan, DEFAULT_STATUTORY_SETTINGS.kesehatan),
    jht: resolveRate(src.jht, DEFAULT_STATUTORY_SETTINGS.jht),
    jp: resolveRate(src.jp, DEFAULT_STATUTORY_SETTINGS.jp),
    jkk: {
      ...resolveRate(jkkSrc, { employeePct: 0, employerPct: riskPct, wageCap: null }),
      riskClass,
    },
    jkm: resolveRate(src.jkm, DEFAULT_STATUTORY_SETTINGS.jkm),
  };
}

/* ------------------------------------------------------------------ */
/* NPWP                                                                */
/* ------------------------------------------------------------------ */

/** NPWP lama 15 digit, NPWP baru/verifikasi NIK 16 digit. */
export function normalizeNpwp(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function isValidNpwp(raw: string | null | undefined): boolean {
  const digits = normalizeNpwp(raw);
  return digits.length === 15 || digits.length === 16;
}

/* ------------------------------------------------------------------ */
/* Hasil perhitungan                                                   */
/* ------------------------------------------------------------------ */

export type BpjsProgram = "kesehatan" | "jht" | "jp" | "jkk" | "jkm";

export type StatutoryBpjsLine = {
  code: BpjsProgram;
  label: string;
  /** Upah yang menjadi dasar iuran (sudah dibatasi `wageCap`). */
  base: number;
  employeePct: number;
  employerPct: number;
  /** Iuran yang dipotong dari karyawan. */
  employee: number;
  /** Iuran yang ditanggung perusahaan (informasi, tidak mengurangi net). */
  employer: number;
};

export type Pph21BracketResult = {
  rate: number;
  taxable: number;
  tax: number;
};

export type Pph21Result = {
  computed: boolean;
  ptkpStatus: PtkpStatus | null;
  ptkpAnnual: number;
  /** Upah bruto setahun hasil setahunkan (upah periode × 12). */
  grossAnnual: number;
  biayaJabatan: number;
  /** JHT + JP yang dipotong dari karyawan, disetahunkan sebagai pengurang. */
  pengurangJhtJp: number;
  netAnnual: number;
  /** PKP setelah dibulatkan ke bawah ribuan. */
  pkp: number;
  brackets: Pph21BracketResult[];
  /** PPh 21 setahun sebelum/sesudah surcharge tanpa NPWP. */
  taxAnnual: number;
  taxMonthly: number;
  noNpwp: boolean;
  surchargePct: number;
};

export type StatutoryResult = {
  /** Ada potongan yang benar-benar dihitung. */
  applied: boolean;
  monthlyWage: number;
  bpjs: StatutoryBpjsLine[];
  employeeBpjsTotal: number;
  /** Total potongan karyawan = BPJS + PPh 21. */
  employeeTotal: number;
  /** Total iuran perusahaan. */
  employerTotal: number;
  pph21: Pph21Result;
  settings: StatutorySettings;
  warnings: string[];
};

/** Data karyawan yang menentukan potongan wajib. */
export type StatutoryEmployee = {
  ptkpStatus?: string | null;
  npwp?: string | null;
  bpjsKesehatan?: boolean | null;
  bpjsKetenagakerjaan?: boolean | null;
};

function percentOf(base: number, pct: number): number {
  return Math.round((base * pct) / 100);
}

function bpjsLine(
  code: BpjsProgram,
  label: string,
  wage: number,
  rate: ContributionRate,
): StatutoryBpjsLine {
  const base = rate.wageCap === null ? wage : Math.min(wage, rate.wageCap);
  return {
    code,
    label,
    base,
    employeePct: rate.employeePct,
    employerPct: rate.employerPct,
    employee: percentOf(base, rate.employeePct),
    employer: percentOf(base, rate.employerPct),
  };
}

function computePph21(params: {
  wage: number;
  ptkpStatus: PtkpStatus;
  hasNpwp: boolean;
  jhtJpMonthly: number;
}): Pph21Result {
  const ptkpAnnual = PTKP_ANNUAL[params.ptkpStatus];
  const grossAnnual = params.wage * 12;
  const biayaJabatan = Math.min(
    Math.round(grossAnnual * BIAYA_JABATAN_RATE),
    BIAYA_JABATAN_CAP,
  );
  const pengurangJhtJp = params.jhtJpMonthly * 12;
  const netAnnual = Math.max(0, grossAnnual - biayaJabatan - pengurangJhtJp);
  const pkp = Math.floor(Math.max(0, netAnnual - ptkpAnnual) / PKP_ROUNDING) * PKP_ROUNDING;

  const brackets: Pph21BracketResult[] = [];
  let remaining = pkp;
  let lower = 0;
  for (const bracket of PPH21_BRACKETS) {
    if (remaining <= 0) break;
    const width = bracket.upTo - lower;
    const taxable = Math.max(0, Math.min(remaining, width));
    if (taxable > 0) {
      brackets.push({ rate: bracket.rate, taxable, tax: Math.round(taxable * bracket.rate) });
    }
    remaining -= taxable;
    lower = bracket.upTo;
  }

  const taxBeforeSurcharge = brackets.reduce((sum, bracket) => sum + bracket.tax, 0);
  const surchargePct = params.hasNpwp ? 0 : NO_NPWP_SURCHARGE;
  const taxAnnual = Math.round(taxBeforeSurcharge * (1 + surchargePct));

  return {
    computed: true,
    ptkpStatus: params.ptkpStatus,
    ptkpAnnual,
    grossAnnual,
    biayaJabatan,
    pengurangJhtJp,
    netAnnual,
    pkp,
    brackets,
    taxAnnual,
    taxMonthly: Math.round(taxAnnual / 12),
    noNpwp: !params.hasNpwp,
    surchargePct,
  };
}

const EMPTY_PPH21: Pph21Result = {
  computed: false,
  ptkpStatus: null,
  ptkpAnnual: 0,
  grossAnnual: 0,
  biayaJabatan: 0,
  pengurangJhtJp: 0,
  netAnnual: 0,
  pkp: 0,
  brackets: [],
  taxAnnual: 0,
  taxMonthly: 0,
  noNpwp: false,
  surchargePct: 0,
};

/**
 * Hitung seluruh potongan wajib untuk satu slip.
 *
 * Default aman: karyawan yang belum punya PTKP/NPWP dan belum terdaftar BPJS
 * tidak dipotong apa pun, tetapi hasilnya membawa `warnings` supaya slip bisa
 * memberi tahu admin bahwa datanya belum lengkap.
 */
export function computeStatutory(input: {
  /** Upah bruto periode ini (nilai yang tampil sebagai bruto slip). */
  monthlyWage: number;
  employee?: StatutoryEmployee | null;
  settings?: unknown;
}): StatutoryResult {
  const settings = resolveStatutorySettings(input.settings);
  const employee = input.employee ?? {};
  const wage = Math.max(0, Math.round(toNum(input.monthlyWage)));
  const warnings: string[] = [];
  const bpjs: StatutoryBpjsLine[] = [];

  const ptkpStatus = isPtkpStatus(employee.ptkpStatus) ? employee.ptkpStatus : null;
  const npwpDigits = normalizeNpwp(employee.npwp);
  const hasNpwp = npwpDigits.length === 15 || npwpDigits.length === 16;
  const bpjsKesehatan = employee.bpjsKesehatan === true;
  const bpjsKetenagakerjaan = employee.bpjsKetenagakerjaan === true;

  if (wage <= 0) {
    return {
      applied: false,
      monthlyWage: wage,
      bpjs: [],
      employeeBpjsTotal: 0,
      employeeTotal: 0,
      employerTotal: 0,
      pph21: EMPTY_PPH21,
      settings,
      warnings: [],
    };
  }

  if (bpjsKesehatan) {
    bpjs.push(bpjsLine("kesehatan", "BPJS Kesehatan", wage, settings.kesehatan));
  }
  if (bpjsKetenagakerjaan) {
    bpjs.push(bpjsLine("jht", "JHT", wage, settings.jht));
    bpjs.push(bpjsLine("jp", "JP", wage, settings.jp));
    bpjs.push(bpjsLine("jkk", "JKK", wage, settings.jkk));
    bpjs.push(bpjsLine("jkm", "JKM", wage, settings.jkm));
  }

  const employeeBpjsTotal = bpjs.reduce((sum, line) => sum + line.employee, 0);
  const employerTotal = bpjs.reduce((sum, line) => sum + line.employer, 0);

  // JHT + JP karyawan adalah pengurang PPh 21; iuran perusahaan tidak.
  const jhtJpMonthly = bpjs
    .filter((line) => line.code === "jht" || line.code === "jp")
    .reduce((sum, line) => sum + line.employee, 0);

  const pph21 = ptkpStatus
    ? computePph21({ wage, ptkpStatus, hasNpwp, jhtJpMonthly })
    : EMPTY_PPH21;

  if (!ptkpStatus) {
    warnings.push(
      "PTKP karyawan belum diisi — PPh 21 tidak dihitung dan slip tidak memotong pajak.",
    );
  } else if (npwpDigits === "") {
    warnings.push(
      "NPWP karyawan belum diisi — PPh 21 dihitung dengan tarif tanpa NPWP (+20%).",
    );
  } else if (!hasNpwp) {
    warnings.push(
      "NPWP karyawan tidak valid (harus 15 atau 16 digit) — PPh 21 dihitung dengan tarif tanpa NPWP (+20%).",
    );
  }

  if (!bpjsKesehatan) {
    warnings.push("Karyawan belum terdaftar BPJS Kesehatan — iuran kesehatan tidak dihitung.");
  }
  if (!bpjsKetenagakerjaan) {
    warnings.push(
      "Karyawan belum terdaftar BPJS Ketenagakerjaan — JHT, JP, JKK, dan JKM tidak dihitung.",
    );
  }

  const employeeTotal = employeeBpjsTotal + pph21.taxMonthly;

  return {
    applied: bpjs.length > 0 || pph21.computed,
    monthlyWage: wage,
    bpjs,
    employeeBpjsTotal,
    employeeTotal,
    employerTotal,
    pph21,
    settings,
    warnings,
  };
}

/** "1%" / "3,7%" — dipakai label baris slip dan halaman pengaturan. */
export function formatPct(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  return `${String(rounded).replace(".", ",")}%`;
}
