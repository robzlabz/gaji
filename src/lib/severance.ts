/**
 * Pesangon — PP No. 35 Tahun 2021 (Peraturan Pemerintah tentang Perjanjian Kerja Waktu
 * Tertentu, Alih Daya, Waktu Kerja dan Waktu Istirahat, dan Pemutusan Hubungan Kerja).
 *
 * Modul ini **murni**: tanpa `server-only`, tanpa `@/db`, tanpa `next/*`, supaya bisa
 * diuji lewat `bun scripts/check-thr.ts` dan dipakai bersama oleh pratinjau halaman admin
 * maupun penulisan slip (angka pratinjau = angka slip).
 *
 * Dasar hukum yang diterapkan (Pasal 40 ayat (2), (3), dan (4)):
 * - **Uang pesangon** = kelipatan upah sebulan menurut tabel masa kerja, **maksimum 9 bulan**
 *   (`PESANGON_TABLE`, Pasal 40 ayat (2)).
 * - **Uang penghargaan masa kerja** = kelipatan upah sebulan menurut tabel masa kerja,
 *   **maksimum 10 bulan** (`SERVICE_AWARD_TABLE`, Pasal 40 ayat (3)).
 * - **Uang penggantian hak** = **15%** dari (uang pesangon + uang penghargaan masa kerja)
 *   (`REPLACEMENT_RIGHTS_RATE`, Pasal 40 ayat (4)).
 *
 * Catatan lingkup: modul ini memakai tabel penuh Pasal 40 — pengali menurut alasan PHK
 * (Pasal 41–57, mis. penggantian hak 0,5× pesangon pada PHK karena efisiensi) **tidak**
 * diterapkan di sini. Ini juga bukan modul PHK: status karyawan tidak diubah otomatis.
 * Pajak atas pesangon mengikuti modul PPh 21, bukan dihitung ulang di sini.
 */
import { daysBetweenIso, fullMonthsBetween } from "./thr";

/** Batas atas uang pesangon: 9 bulan upah (PP 35/2021 Pasal 40 ayat (2)). */
export const PESANGON_MAX_MONTHS = 9;

/** Batas atas uang penghargaan masa kerja: 10 bulan upah (PP 35/2021 Pasal 40 ayat (3)). */
export const SERVICE_AWARD_MAX_MONTHS = 10;

/** Uang penggantian hak: 15% dari pesangon + penghargaan (PP 35/2021 Pasal 40 ayat (4)). */
export const REPLACEMENT_RIGHTS_RATE = 0.15;

/** Batas masa kerja minimal agar berhak mendapat pesangon. */
export const SEVERANCE_MIN_MONTHS = 1;

type Tier = {
  /** Batas atas masa kerja (bulan, eksklusif); `null` = tanpa batas atas. */
  belowMonths: number | null;
  /** Kelipatan upah sebulan. */
  months: number;
  /** Label tabel untuk ditampilkan di UI. */
  label: string;
};

/**
 * Tabel uang pesangon — PP No. 35 Tahun 2021, **Pasal 40 ayat (2)**:
 *
 * | Masa kerja                              | Uang pesangon |
 * |-----------------------------------------|---------------|
 * | < 1 tahun                               | 1 bulan upah  |
 * | ≥ 1 tahun dan < 2 tahun                 | 2 bulan upah  |
 * | ≥ 2 tahun dan < 3 tahun                 | 3 bulan upah  |
 * | ≥ 3 tahun dan < 4 tahun                 | 4 bulan upah  |
 * | ≥ 4 tahun dan < 5 tahun                 | 5 bulan upah  |
 * | ≥ 5 tahun dan < 6 tahun                 | 6 bulan upah  |
 * | ≥ 6 tahun dan < 7 tahun                 | 7 bulan upah  |
 * | ≥ 7 tahun dan < 8 tahun                 | 8 bulan upah  |
 * | ≥ 8 tahun                              | 9 bulan upah  |
 *
 * Maksimum 9 bulan upah ditegakkan di `pesangonMonths`.
 */
export const PESANGON_TABLE: readonly Tier[] = [
  { belowMonths: 12, months: 1, label: "< 1 tahun" },
  { belowMonths: 24, months: 2, label: "≥ 1 dan < 2 tahun" },
  { belowMonths: 36, months: 3, label: "≥ 2 dan < 3 tahun" },
  { belowMonths: 48, months: 4, label: "≥ 3 dan < 4 tahun" },
  { belowMonths: 60, months: 5, label: "≥ 4 dan < 5 tahun" },
  { belowMonths: 72, months: 6, label: "≥ 5 dan < 6 tahun" },
  { belowMonths: 84, months: 7, label: "≥ 6 dan < 7 tahun" },
  { belowMonths: 96, months: 8, label: "≥ 7 dan < 8 tahun" },
  { belowMonths: null, months: 9, label: "≥ 8 tahun" },
];

/**
 * Tabel uang penghargaan masa kerja — PP No. 35 Tahun 2021, **Pasal 40 ayat (3)**:
 *
 * | Masa kerja                              | Uang penghargaan masa kerja |
 * |-----------------------------------------|-----------------------------|
 * | < 3 tahun                               | 0 bulan upah                |
 * | ≥ 3 tahun dan < 6 tahun                 | 2 bulan upah                |
 * | ≥ 6 tahun dan < 9 tahun                 | 3 bulan upah                |
 * | ≥ 9 tahun dan < 12 tahun                | 4 bulan upah                |
 * | ≥ 12 tahun dan < 15 tahun               | 5 bulan upah                |
 * | ≥ 15 tahun dan < 18 tahun               | 6 bulan upah                |
 * | ≥ 18 tahun dan < 21 tahun               | 7 bulan upah                |
 * | ≥ 21 tahun dan < 24 tahun               | 8 bulan upah                |
 * | ≥ 24 tahun                             | 10 bulan upah               |
 *
 * Maksimum 10 bulan upah ditegakkan di `serviceAwardMonths`.
 */
export const SERVICE_AWARD_TABLE: readonly Tier[] = [
  { belowMonths: 36, months: 0, label: "< 3 tahun" },
  { belowMonths: 72, months: 2, label: "≥ 3 dan < 6 tahun" },
  { belowMonths: 108, months: 3, label: "≥ 6 dan < 9 tahun" },
  { belowMonths: 144, months: 4, label: "≥ 9 dan < 12 tahun" },
  { belowMonths: 180, months: 5, label: "≥ 12 dan < 15 tahun" },
  { belowMonths: 216, months: 6, label: "≥ 15 dan < 18 tahun" },
  { belowMonths: 252, months: 7, label: "≥ 18 dan < 21 tahun" },
  { belowMonths: 288, months: 8, label: "≥ 21 dan < 24 tahun" },
  { belowMonths: null, months: 10, label: "≥ 24 tahun" },
];

function tierFor(table: readonly Tier[], monthsWorked: number): Tier {
  const months = Math.max(0, Math.floor(monthsWorked));
  for (const tier of table) {
    if (tier.belowMonths === null || months < tier.belowMonths) return tier;
  }
  return table[table.length - 1];
}

/** Kelipatan uang pesangon (bulan upah) menurut PP 35/2021 Pasal 40 ayat (2). */
export function pesangonMonths(monthsWorked: number): number {
  return Math.min(PESANGON_MAX_MONTHS, tierFor(PESANGON_TABLE, monthsWorked).months);
}

/** Kelipatan uang penghargaan masa kerja (bulan upah) menurut PP 35/2021 Pasal 40 ayat (3). */
export function serviceAwardMonths(monthsWorked: number): number {
  return Math.min(SERVICE_AWARD_MAX_MONTHS, tierFor(SERVICE_AWARD_TABLE, monthsWorked).months);
}

/** Label baris tabel pesangon yang terpakai, mis. "≥ 4 dan < 5 tahun". */
export function pesangonTierLabel(monthsWorked: number): string {
  return tierFor(PESANGON_TABLE, monthsWorked).label;
}

/** Label baris tabel penghargaan masa kerja yang terpakai. */
export function serviceAwardTierLabel(monthsWorked: number): string {
  return tierFor(SERVICE_AWARD_TABLE, monthsWorked).label;
}

export type SeveranceResult = {
  eligible: boolean;
  /** Alasan bila tidak berhak (untuk ditampilkan di UI). */
  reason: string | null;
  monthsWorked: number;
  daysWorked: number;
  /** Upah sebulan yang dipakai sebagai dasar (rupiah). */
  monthlyWage: number;
  pesangonMonths: number;
  pesangonAmount: number;
  serviceAwardMonths: number;
  serviceAwardAmount: number;
  /** Tarif uang penggantian hak (0,15). */
  replacementRate: number;
  replacementAmount: number;
  /** Total = pesangon + penghargaan + penggantian hak. */
  total: number;
  explanation: string;
};

/**
 * Hitung pesangon satu karyawan untuk tanggal acuan.
 *
 * Masa kerja dihitung dari `joinedAt` sampai `referenceDate` dan dibulatkan ke bawah per
 * bulan penuh — sama dengan aturan masa kerja THR, jadi satu sumber kebenaran
 * (`fullMonthsBetween` di `thr.ts`). Karyawan dengan masa kerja < 1 bulan penuh belum
 * berhak (ditampilkan alasannya).
 */
export function computeSeverance(input: {
  joinedAt: string;
  referenceDate: string;
  monthlyWage: number;
}): SeveranceResult {
  const monthsWorked = fullMonthsBetween(input.joinedAt, input.referenceDate);
  const daysWorked = Math.max(0, daysBetweenIso(input.joinedAt, input.referenceDate));
  const monthlyWage = Math.max(0, Math.round(Number(input.monthlyWage) || 0));

  const base = {
    monthsWorked,
    daysWorked,
    monthlyWage,
    replacementRate: REPLACEMENT_RIGHTS_RATE,
  };

  if (monthsWorked < SEVERANCE_MIN_MONTHS) {
    return {
      ...base,
      eligible: false,
      reason: `Masa kerja baru ${daysWorked} hari — belum 1 bulan penuh, jadi belum ada pesangon.`,
      pesangonMonths: 0,
      pesangonAmount: 0,
      serviceAwardMonths: 0,
      serviceAwardAmount: 0,
      replacementAmount: 0,
      total: 0,
      explanation: `Belum ada pesangon: masa kerja ${daysWorked} hari dari ${input.joinedAt}.`,
    };
  }

  if (monthlyWage <= 0) {
    return {
      ...base,
      eligible: false,
      reason: "Upah belum diisi (tarif 0 atau belum ada upah dibayar 12 bulan terakhir).",
      pesangonMonths: 0,
      pesangonAmount: 0,
      serviceAwardMonths: 0,
      serviceAwardAmount: 0,
      replacementAmount: 0,
      total: 0,
      explanation: "Belum ada pesangon: dasar upah bulanan belum ada.",
    };
  }

  const pesangon = pesangonMonths(monthsWorked);
  const award = serviceAwardMonths(monthsWorked);
  const pesangonAmount = Math.round(pesangon * monthlyWage);
  const serviceAwardAmount = Math.round(award * monthlyWage);
  // Uang penggantian hak = 15% × (pesangon + penghargaan) — PP 35/2021 Pasal 40 ayat (4).
  const replacementAmount = Math.round(
    REPLACEMENT_RIGHTS_RATE * (pesangonAmount + serviceAwardAmount),
  );

  return {
    ...base,
    eligible: true,
    reason: null,
    pesangonMonths: pesangon,
    pesangonAmount,
    serviceAwardMonths: award,
    serviceAwardAmount,
    replacementAmount,
    total: pesangonAmount + serviceAwardAmount + replacementAmount,
    explanation: `Masa kerja ${monthsWorked} bulan → pesangon ${pesangon} bulan + penghargaan ${award} bulan + penggantian hak 15%.`,
  };
}
