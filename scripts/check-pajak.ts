/**
 * Cek perhitungan PPh 21 (metode setahun) & iuran BPJS tanpa perlu database.
 *
 * Jalankan: bun scripts/check-pajak.ts   (atau: npm run check:pajak)
 *
 * Setiap angka harapan di bawah diturunkan manual dari aturan yang berlaku, bukan
 * dari output fungsi — jadi skrip ini benar-benar menguji rumus, bukan menyalinnya.
 * Tarif default: Kesehatan 4%/1% batas upah 12 jt; JHT 3,7%/2%; JP 2%/1% batas upah
 * 10.547.400; JKK 0,24% (kelas sangat rendah); JKM 0,3%. Biaya jabatan 5% maks 6 jt
 * setahun; PKP dibulatkan ke bawah ribuan; tarif progresif 5/15/25/30/35%.
 *
 * Yang dibuktikan:
 * 1. PTKP TK/0 + NPWP + BPJS lengkap, upah 5 jt.
 * 2. PTKP K/2 (PTKP 67,5 jt), upah 8 jt.
 * 3. Upah 20 jt → masuk lapisan tarif 15% (sekaligus bukti batas upah Kesehatan/JP).
 * 4. Tanpa NPWP → tarif +20% dibanding kasus yang sama dengan NPWP.
 * 5. Tanpa data pajak/BPJS sama sekali → tidak ada potongan + peringatan eksplisit.
 * 6. Slip: net = bruto − saldo − kasbon − potongan wajib, dan iuran perusahaan
 *    tidak mengubah net.
 */
import { computePayslip } from "../src/lib/payroll";
import {
  computeStatutory,
  PTKP_ANNUAL,
  resolveStatutorySettings,
  type StatutoryEmployee,
} from "../src/lib/statutory";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(
      `✗ ${name} — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`✓ ${name}`);
  }
}

function rp(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

const BPJS_LENGKAP: StatutoryEmployee = {
  ptkpStatus: "TK/0",
  npwp: "012345678901234",
  bpjsKesehatan: true,
  bpjsKetenagakerjaan: true,
};

/* ------------------------------------------------------------------ */
/* Kasus & angka harapan (manual)                                      */
/* ------------------------------------------------------------------ */

// 1) TK/0, upah 5.000.000, NPWP, BPJS lengkap.
//    BPJS karyawan: Kesehatan 5 jt × 1% = 50.000; JHT 5 jt × 2% = 100.000;
//    JP 5 jt × 1% = 50.000 → 200.000.
//    Setahun: bruto 60.000.000; biaya jabatan 5% = 3.000.000; pengurang JHT+JP
//    150.000 × 12 = 1.800.000 → net 55.200.000; PTKP 54.000.000 → PKP 1.200.000.
//    PPh 21 = 5% × 1.200.000 = 60.000/tahun → 5.000/bulan.
const kasus1 = computeStatutory({ monthlyWage: 5_000_000, employee: BPJS_LENGKAP });

// 2) K/2 (PTKP 67.500.000), upah 8.000.000, NPWP, BPJS lengkap.
//    BPJS karyawan: 80.000 + 160.000 + 80.000 = 320.000.
//    Setahun: 96.000.000 − biaya jabatan 4.800.000 − pengurang (240.000 × 12 =
//    2.880.000) = 88.320.000; PKP 88.320.000 − 67.500.000 = 20.820.000.
//    PPh 21 = 5% × 20.820.000 = 1.041.000/tahun → 86.750/bulan.
const kasus2 = computeStatutory({
  monthlyWage: 8_000_000,
  employee: { ...BPJS_LENGKAP, ptkpStatus: "K/2" },
});

// 3) TK/0, upah 20.000.000 → lapisan kedua (15%).
//    BPJS karyawan: Kesehatan 12 jt × 1% = 120.000 (batas upah 12 jt);
//    JHT 20 jt × 2% = 400.000; JP 10.547.400 × 1% = 105.474 → 625.474.
//    Setahun: 240.000.000 − biaya jabatan 6.000.000 (batas maks) − pengurang
//    (505.474 × 12 = 6.065.688) = 227.934.312; PKP dibulatkan ke bawah =
//    173.934.000 (227.934.312 − 54.000.000 = 173.934.312).
//    PPh 21 = 5% × 60.000.000 + 15% × 113.934.000 = 3.000.000 + 17.090.100
//    = 20.090.100/tahun → 1.674.175/bulan.
const kasus3 = computeStatutory({ monthlyWage: 20_000_000, employee: BPJS_LENGKAP });

// 4) K/1, upah 10.000.000, BPJS lengkap, TANPA NPWP.
//    BPJS karyawan: 100.000 + 200.000 + 100.000 = 400.000.
//    Setahun: 120.000.000 − biaya jabatan 6.000.000 − pengurang (300.000 × 12 =
//    3.600.000) = 110.400.000; PKP 110.400.000 − 63.000.000 = 47.400.000.
//    PPh 21 = 5% × 47.400.000 = 2.370.000 × 120% (tanpa NPWP) = 2.844.000/tahun
//    → 237.000/bulan. Dengan NPWP nilainya 2.370.000 → 197.500/bulan.
const kasus4 = computeStatutory({
  monthlyWage: 10_000_000,
  employee: { ptkpStatus: "K/1", bpjsKesehatan: true, bpjsKetenagakerjaan: true },
});
const kasus4Npwp = computeStatutory({
  monthlyWage: 10_000_000,
  employee: {
    ptkpStatus: "K/1",
    npwp: "012345678901234",
    bpjsKesehatan: true,
    bpjsKetenagakerjaan: true,
  },
});

// 5) Karyawan baru: PTKP, NPWP, dan BPJS belum diisi → default aman.
const kasus5 = computeStatutory({ monthlyWage: 6_000_000, employee: {} });

const kasus = [
  { nama: "TK/0 · NPWP · BPJS lengkap · 5 jt", hasil: kasus1 },
  { nama: "K/2 · NPWP · BPJS lengkap · 8 jt", hasil: kasus2 },
  { nama: "TK/0 · NPWP · BPJS lengkap · 20 jt", hasil: kasus3 },
  { nama: "K/1 · tanpa NPWP · BPJS lengkap · 10 jt", hasil: kasus4 },
  { nama: "tanpa data pajak/BPJS · 6 jt", hasil: kasus5 },
];

console.log("\nTabel kasus PPh 21 & BPJS");
console.log("-".repeat(94));
console.log(
  `${"Kasus".padEnd(42)}${"PPh 21".padStart(14)}${"BPJS kary.".padStart(14)}${"Iuran persh.".padStart(16)}`,
);
console.log("-".repeat(94));
for (const item of kasus) {
  console.log(
    `${item.nama.padEnd(42)}${rp(item.hasil.pph21.taxMonthly).padStart(14)}${rp(
      item.hasil.employeeBpjsTotal,
    ).padStart(14)}${rp(item.hasil.employerTotal).padStart(16)}`,
  );
}
console.log("-".repeat(94));
console.log();

/* ------------------------------------------------------------------ */
/* 1. PTKP TK/0                                                        */
/* ------------------------------------------------------------------ */

check("1 · BPJS karyawan (kesehatan 50.000 + JHT 100.000 + JP 50.000)", kasus1.employeeBpjsTotal, 200_000);
check("1 · PPh 21/bulan", kasus1.pph21.taxMonthly, 5_000);
check("1 · PPh 21/tahun", kasus1.pph21.taxAnnual, 60_000);
check("1 · PKP setahun", kasus1.pph21.pkp, 1_200_000);
check("1 · biaya jabatan (5%)", kasus1.pph21.biayaJabatan, 3_000_000);
check("1 · total potongan karyawan (BPJS + PPh 21)", kasus1.employeeTotal, 205_000);
check("1 · iuran perusahaan (4%+3,7%+2%+0,24%+0,3% dari 5 jt)", kasus1.employerTotal, 512_000);
check("1 · JKK perusahaan 0,24%", kasus1.bpjs.find((l) => l.code === "jkk")?.employer, 12_000);
check("1 · JKM perusahaan 0,3%", kasus1.bpjs.find((l) => l.code === "jkm")?.employer, 15_000);
check("1 · tidak ada peringatan", kasus1.warnings, []);

/* ------------------------------------------------------------------ */
/* 2. PTKP K/2                                                         */
/* ------------------------------------------------------------------ */

check("2 · PTKP K/2 setahun", PTKP_ANNUAL["K/2"], 67_500_000);
check("2 · BPJS karyawan", kasus2.employeeBpjsTotal, 320_000);
check("2 · PKP setahun (88.320.000 − 67.500.000)", kasus2.pph21.pkp, 20_820_000);
check("2 · PPh 21/bulan", kasus2.pph21.taxMonthly, 86_750);
check("2 · total potongan karyawan", kasus2.employeeTotal, 406_750);

/* ------------------------------------------------------------------ */
/* 3. Lapisan tarif 15%                                                */
/* ------------------------------------------------------------------ */

check("3 · BPJS karyawan (kesehatan kena batas 12 jt, JP kena batas)", kasus3.employeeBpjsTotal, 625_474);
check("3 · dasar JP dibatasi 10.547.400", kasus3.bpjs.find((l) => l.code === "jp")?.base, 10_547_400);
check("3 · dasar Kesehatan dibatasi 12.000.000", kasus3.bpjs.find((l) => l.code === "kesehatan")?.base, 12_000_000);
check("3 · biaya jabatan kena batas 6 jt", kasus3.pph21.biayaJabatan, 6_000_000);
check("3 · PKP dibulatkan ke bawah ribuan", kasus3.pph21.pkp, 173_934_000);
check("3 · dua lapisan tarif terpakai", kasus3.pph21.brackets.map((b) => b.rate), [0.05, 0.15]);
check("3 · PPh 21/tahun (3.000.000 + 17.090.100)", kasus3.pph21.taxAnnual, 20_090_100);
check("3 · PPh 21/bulan", kasus3.pph21.taxMonthly, 1_674_175);
check("3 · total iuran perusahaan", kasus3.employerTotal, 1_538_948);

/* ------------------------------------------------------------------ */
/* 4. Tanpa NPWP (+20%)                                                */
/* ------------------------------------------------------------------ */

check("4 · PKP sama dengan kasus ber-NPWP", kasus4.pph21.pkp, kasus4Npwp.pph21.pkp);
check("4 · PPh 21 dengan NPWP", kasus4Npwp.pph21.taxMonthly, 197_500);
check("4 · PPh 21 tanpa NPWP (5% × 47.400.000 × 120% ÷ 12)", kasus4.pph21.taxMonthly, 237_000);
check("4 · surcharge 20% ditandai", kasus4.pph21.noNpwp, true);
check("4 · ada peringatan NPWP kosong", kasus4.warnings.some((w) => w.includes("NPWP")), true);
check("4 · BPJS tetap dipotong walau tanpa NPWP", kasus4.employeeBpjsTotal, 400_000);

/* ------------------------------------------------------------------ */
/* 5. Default aman                                                     */
/* ------------------------------------------------------------------ */

check("5 · tidak ada potongan PPh 21", kasus5.pph21.taxMonthly, 0);
check("5 · tidak ada potongan BPJS", kasus5.employeeBpjsTotal, 0);
check("5 · tidak ada iuran perusahaan", kasus5.employerTotal, 0);
check("5 · total potongan nol", kasus5.employeeTotal, 0);
check("5 · peringatan PTKP muncul", kasus5.warnings.some((w) => w.includes("PTKP")), true);
check(
  "5 · peringatan BPJS muncul",
  kasus5.warnings.some((w) => w.includes("BPJS Kesehatan")) &&
    kasus5.warnings.some((w) => w.includes("BPJS Ketenagakerjaan")),
  true,
);
check("5 · tiga peringatan data belum lengkap", kasus5.warnings.length, 3);

/* ------------------------------------------------------------------ */
/* 6. Integrasi slip: net, kasbon, iuran perusahaan                    */
/* ------------------------------------------------------------------ */

const period = { start: "2026-10-01", end: "2026-10-31" };
const slip = computePayslip({
  payType: "monthly",
  payRate: 5_000_000,
  period,
  joinedAt: "2026-01-01",
  timeEntries: [],
  tasks: [],
  advances: [{ id: "adv-1", balance: 500_000, installmentAmount: 200_000 }],
  statutory: BPJS_LENGKAP,
});

const pph21Line = slip.lines.find((line) => line.kind === "pph21");
const bpjsLines = slip.lines.filter((line) => line.kind === "bpjs");
const kasbonLine = slip.lines.find((line) => line.kind === "kasbon");

check("6 · bruto gaji bulanan penuh", slip.gross, 5_000_000);
check("6 · tiga baris BPJS (kesehatan, JHT, JP)", bpjsLines.length, 3);
check("6 · baris PPh 21", pph21Line?.amount, 5_000);
check("6 · total potongan = BPJS 200.000 + PPh 21 5.000 + kasbon 200.000", slip.deductions, 405_000);
check("6 · net = 5.000.000 − 405.000", slip.net, 4_595_000);
check(
  "6 · kasbon dipotong setelah potongan wajib (sisa tunai cukup)",
  kasbonLine?.amount,
  200_000,
);
check("6 · snapshot statutory ikut pada hasil hitung", slip.statutory?.pph21.taxMonthly, 5_000);
check("6 · iuran perusahaan tetap dihitung terpisah", slip.statutory?.employerTotal, 512_000);
check("6 · net tidak dipengaruhi iuran perusahaan", slip.net, 4_595_000);

// Saldo prabayar menutup hampir semua upah: kasbon tidak boleh membuat net minus.
const slipSaldo = computePayslip({
  payType: "monthly",
  payRate: 5_000_000,
  period,
  joinedAt: "2026-01-01",
  timeEntries: [],
  tasks: [],
  advances: [{ id: "adv-1", balance: 500_000, installmentAmount: 500_000 }],
  saldoCovered: 5_000_000,
  statutory: BPJS_LENGKAP,
});

check("6 · saldo menutup bruto → kasbon ditunda, bukan net minus", slipSaldo.net, -205_000);
check(
  "6 · net minus karena potongan wajib tetap diberi peringatan",
  slipSaldo.warnings.some((w) => w.includes("net negatif")),
  true,
);

/* ------------------------------------------------------------------ */
/* 7. Tarif dari pengaturan organisasi                                 */
/* ------------------------------------------------------------------ */

const custom = resolveStatutorySettings({
  jp: { wageCap: null },
  jkk: { riskClass: "high" },
});
const kasus7 = computeStatutory({
  monthlyWage: 20_000_000,
  employee: BPJS_LENGKAP,
  settings: { jp: { wageCap: null }, jkk: { riskClass: "high" } },
});

check("7 · batas upah JP bisa dimatikan", custom.jp.wageCap, null);
check("7 · JP tanpa batas = 20 jt × 1%", kasus7.bpjs.find((l) => l.code === "jp")?.employee, 200_000);
check("7 · kelas risiko JKK tinggi = 1,27%", kasus7.bpjs.find((l) => l.code === "jkk")?.employer, 254_000);
check(
  "7 · tarif yang dipakai tersimpan di hasil (snapshot)",
  kasus7.settings.jkk.riskClass,
  "high",
);

/* ------------------------------------------------------------------ */

console.log();
if (failures > 0) {
  console.error(`GAGAL: ${failures} pemeriksaan tidak sesuai.`);
  process.exit(1);
}
console.log("LULUS: semua pemeriksaan PPh 21 & BPJS sesuai hitungan manual.");
