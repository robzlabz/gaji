/**
 * Cek matematika THR (Permenaker 6/2016) dan pesangon (PP 35/2021) tanpa database.
 *
 * Jalankan: bun scripts/check-thr.ts   (atau: npm run check:thr)
 *
 * Angka harapan di bawah dihitung manual, bukan dari hasil fungsi — tujuannya supaya
 * kesalahan tabel/rumus benar-benar ketahuan.
 */
import {
  averageMonthlyWageFromPayments,
  computeThr,
  fullMonthsBetween,
  thrLatestPayDate,
} from "../src/lib/thr";
import {
  PESANGON_MAX_MONTHS,
  SERVICE_AWARD_MAX_MONTHS,
  computeSeverance,
  pesangonMonths,
  serviceAwardMonths,
} from "../src/lib/severance";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`,
  );
}

const THR = (joinedAt: string, referenceDate: string, monthlyWage: number) =>
  computeThr({ joinedAt, referenceDate, monthlyWage });

const SEV = (joinedAt: string, referenceDate: string, monthlyWage: number) =>
  computeSeverance({ joinedAt, referenceDate, monthlyWage });

/* -------------------------------------------------------------------------- */
/* 1. Masa kerja: dibulatkan ke bawah per bulan penuh                         */
/* -------------------------------------------------------------------------- */

check("masa kerja 2025-08-01 → 2026-10-01 = 14 bulan", fullMonthsBetween("2025-08-01", "2026-10-01"), 14);
check("masa kerja 2026-01-15 → 2026-09-14 = 7 bulan (belum penuh 8)", fullMonthsBetween("2026-01-15", "2026-09-14"), 7);
check("masuk 31 Jan → 28 Feb dihitung 1 bulan penuh", fullMonthsBetween("2026-01-31", "2026-02-28"), 1);
check("tanggal acuan sebelum masuk = 0 bulan", fullMonthsBetween("2026-10-01", "2026-09-01"), 0);

/* -------------------------------------------------------------------------- */
/* 2. THR — Permenaker 6/2016 Pasal 3 ayat (1)                                */
/* -------------------------------------------------------------------------- */

// 8 bulan, upah Rp 6.000.000 → 8/12 × 6.000.000 = 4.000.000
const thr8 = THR("2026-02-01", "2026-10-01", 6_000_000);
check("THR 8 bulan: 8/12 × Rp 6.000.000", thr8.amount, 4_000_000);
check("  · rincian bulan & rasio", [thr8.monthsWorked, thr8.ratio], [8, 8 / 12]);
check("  · berhak", thr8.eligible, true);

// 14 bulan, upah Rp 6.000.000 → 1× upah = 6.000.000 (bukan 14/12)
const thr14 = THR("2025-08-01", "2026-10-01", 6_000_000);
check("THR 14 bulan: 1× upah", thr14.amount, 6_000_000);

// 11 bulan, upah Rp 12.000.000 → 11/12 × 12.000.000 = 11.000.000
check("THR 11 bulan: 11/12 × Rp 12.000.000", THR("2026-01-01", "2026-12-01", 12_000_000).amount, 11_000_000);
// tepat 12 bulan → penuh 1×
check("THR 12 bulan: 1× upah", THR("2026-01-01", "2027-01-01", 12_000_000).amount, 12_000_000);
// masa kerja sangat panjang tetap 1× (tidak pernah lebih dari 1× upah)
check("THR 20 tahun tetap 1× upah", THR("2006-01-01", "2026-01-01", 7_000_000).amount, 7_000_000);

// belum 1 bulan → tidak berhak, ada alasan
const thrNew = THR("2026-10-20", "2026-11-01", 6_000_000);
check("belum 1 bulan: tidak berhak", [thrNew.eligible, thrNew.amount], [false, 0]);
check("  · ada alasan tertulis", typeof thrNew.reason === "string" && thrNew.reason.length > 0, true);

// masuk akhir bulan: 31 Jan → 28 Feb = 1 bulan → 1/12 × 3.600.000 = 300.000
check("THR 1 bulan (akhir bulan): 1/12 × Rp 3.600.000", THR("2026-01-31", "2026-02-28", 3_600_000).amount, 300_000);

/* -------------------------------------------------------------------------- */
/* 3. THR untuk pekerja harian/jam: rata-rata 12 bulan terakhir               */
/* -------------------------------------------------------------------------- */

// Masa kerja 3 bulan (Jul–Sep 2026), upah dibayar 3+4+5 juta → rata-rata 12/3 = 4 juta.
const average = averageMonthlyWageFromPayments({
  payments: [
    { date: "2026-07-31", amount: 3_000_000 },
    { date: "2026-08-31", amount: 4_000_000 },
    { date: "2026-09-30", amount: 5_000_000 },
    // di luar jendela 12 bulan → diabaikan
    { date: "2025-03-31", amount: 99_000_000 },
  ],
  joinedAt: "2026-07-01",
  referenceDate: "2026-10-01",
});
check("rata-rata upah 3 bulan = Rp 4.000.000", average.average, 4_000_000);
check("  · jumlah bulan pembagi", average.monthsCounted, 3);
check("  · total upah jendela (di luar jendela diabaikan)", average.total, 12_000_000);

const thrDaily = computeThr({
  joinedAt: "2026-07-01",
  referenceDate: "2026-10-01",
  monthlyWage: average.average,
  wageSource: "average-12m",
  monthsAveraged: average.monthsCounted,
});
check("THR harian 3 bulan → 3/12 × Rp 4.000.000", thrDaily.amount, 1_000_000);
check("  · dasar upah ditandai rata-rata", thrDaily.wageSource, "average-12m");

// Masa kerja 14 bulan: jendela dibatasi 12 bulan, pembagi 12.
const capped = averageMonthlyWageFromPayments({
  payments: [{ date: "2026-09-30", amount: 60_000_000 }],
  joinedAt: "2025-08-01",
  referenceDate: "2026-10-01",
});
check("jendela maksimum 12 bulan", capped.monthsCounted, 12);
check("  · rata-rata = 60 jt / 12", capped.average, 5_000_000);

/* -------------------------------------------------------------------------- */
/* 4. Pesangon — PP 35/2021 Pasal 40 ayat (2) & (3)                           */
/* -------------------------------------------------------------------------- */

// Tabel pesangon (bulan upah): <1th 1, 1–<2 2, …, 7–<8 8, ≥8 9.
check(
  "tabel pesangon per batas tahun",
  [11, 12, 23, 24, 35, 36, 47, 48, 59, 60, 71, 72, 83, 84, 95, 96, 500].map((m) => pesangonMonths(m)),
  [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9],
);
check("pesangon maksimum 9 bulan", pesangonMonths(1_200), PESANGON_MAX_MONTHS);

// Tabel penghargaan: <3th 0, 3–<6 2, 6–<9 3, 9–<12 4, 12–<15 5, 15–<18 6, 18–<21 7, 21–<24 8, ≥24 10.
check(
  "tabel penghargaan masa kerja per batas tahun",
  [35, 36, 71, 72, 107, 108, 143, 144, 179, 180, 215, 216, 251, 252, 287, 288, 600].map((m) =>
    serviceAwardMonths(m),
  ),
  [0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 10, 10],
);
check("penghargaan maksimum 10 bulan", serviceAwardMonths(1_200), SERVICE_AWARD_MAX_MONTHS);

// 8 bulan kerja, upah Rp 5.000.000 → pesangon 1× = 5.000.000, penghargaan 0,
// penggantian hak 15% × 5.000.000 = 750.000, total 5.750.000.
const sev8m = SEV("2026-02-01", "2026-10-01", 5_000_000);
check("pesangon 8 bulan: 1 + 0 bulan", [sev8m.pesangonMonths, sev8m.serviceAwardMonths], [1, 0]);
check("  · penggantian hak 15%", sev8m.replacementAmount, 750_000);
check("  · total", sev8m.total, 5_750_000);

// 4 tahun (48 bulan), upah Rp 10.000.000 → 5 + 2 = 7 bulan = 70.000.000,
// 15% = 10.500.000, total 80.500.000.
const sev4y = SEV("2022-10-01", "2026-10-01", 10_000_000);
check("pesangon 4 tahun: 5 + 2 bulan", [sev4y.pesangonMonths, sev4y.serviceAwardMonths], [5, 2]);
check("  · nilai pesangon & penghargaan", [sev4y.pesangonAmount, sev4y.serviceAwardAmount], [50_000_000, 20_000_000]);
check("  · penggantian hak 15% dari 70 jt", sev4y.replacementAmount, 10_500_000);
check("  · total", sev4y.total, 80_500_000);

// 10 tahun (120 bulan), upah Rp 10.000.000 → pesangon 9 (maks) + penghargaan 4 = 13 bulan
// = 130.000.000; 15% = 19.500.000; total 149.500.000.
const sev10y = SEV("2016-10-01", "2026-10-01", 10_000_000);
check("pesangon 10 tahun: 9 (maks) + 4 bulan", [sev10y.pesangonMonths, sev10y.serviceAwardMonths], [9, 4]);
check("  · total 149.500.000", sev10y.total, 149_500_000);

// 30 tahun (360 bulan), upah Rp 8.000.000 → pesangon 9 (maks) + penghargaan 10 (maks)
// = 19 bulan = 152.000.000; 15% = 22.800.000; total 174.800.000.
const sev30y = SEV("1996-10-01", "2026-10-01", 8_000_000);
check("pesangon 30 tahun: batas 9 & 10 bulan", [sev30y.pesangonMonths, sev30y.serviceAwardMonths], [9, 10]);
check("  · total 174.800.000", sev30y.total, 174_800_000);

// < 1 bulan → tidak berhak, ada alasan.
const sevNew = SEV("2026-10-20", "2026-11-01", 5_000_000);
check("pesangon < 1 bulan: tidak berhak", [sevNew.eligible, sevNew.total], [false, 0]);
check("  · ada alasan tertulis", typeof sevNew.reason === "string" && sevNew.reason.length > 0, true);

// Upah 0 (belum diisi) → tidak berhak, bukan angka 0 tanpa keterangan.
const noWage = SEV("2022-01-01", "2026-10-01", 0);
check("pesangon tanpa dasar upah: tidak berhak", [noWage.eligible, noWage.reason !== null], [false, true]);

/* -------------------------------------------------------------------------- */
/* 5. Batas waktu pembayaran THR                                              */
/* -------------------------------------------------------------------------- */

check("THR paling lambat H-7", thrLatestPayDate("2026-03-20"), "2026-03-13");

console.log(failures === 0 ? "\nSemua cek THR & pesangon lolos." : `\n${failures} cek gagal.`);
process.exit(failures === 0 ? 0 : 1);
