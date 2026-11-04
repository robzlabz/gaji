/**
 * Cek lembur otomatis (PP 35/2021) tanpa database.
 *
 * Jalankan: npm run check:lembur   (atau: bun scripts/check-lembur.ts)
 *
 * Yang dibuktikan:
 * 1. 9 jam kerja efektif dengan jam normal 7 → 2 jam lembur = 1 jam ×1,5 + 1 jam ×2.
 * 2. Lembur di bawah 1 jam tetap proporsional (30 menit ×1,5).
 * 3. Karyawan harian dan bulanan mendapat upah lembur (menutup #55).
 * 4. `overtime_minutes` manual menang atas hitungan otomatis (lebih kecil maupun lebih besar).
 * 5. Slip memuat dua baris lembur terpisah dengan tarif masing-masing, bukan satu baris gabungan.
 * 6. Jam lembur tidak dibayar dua kali (menit reguler berkurang sebanyak menit lembur) dan
 *    angka accrual saldo sama dengan angka slip.
 * 7. Lembur di hari libur tidak dihitung otomatis (belum didukung) dan memunculkan peringatan;
 *    lembur manual di hari libur tetap dibayar.
 * 8. Karyawan per tugas tidak punya tarif sejam → tidak ada baris lembur.
 */
import {
  isWorkingDay,
  normalMinutesPerDay,
  overtimeSettingsFromOrg,
  splitOvertimeMinutes,
} from "../src/lib/overtime";
import { computePayslip, type TimeEntryInput } from "../src/lib/payroll";
import { workDatesBetween } from "../src/lib/period";
import { accrualForEntry } from "../src/lib/saldo";

const settings = overtimeSettingsFromOrg({
  normalHoursPerDay: "7.00",
  workingDaysPerWeek: 6,
  workingDaysPerMonth: 22,
  overtimeFirstMultiplier: "1.50",
  overtimeNextMultiplier: "2.00",
});

const perHour = 30_000;
const dailyRate = 175_000;
/** Upah sejam karyawan harian = tarif harian ÷ jam normal per hari. */
const dailyHourly = dailyRate / settings.normalHoursPerDay;
const monthlyRate = 6_000_000;
/** Upah sejam karyawan bulanan = gaji bulanan ÷ (hari kerja efektif × jam normal per hari). */
const monthlyHourly = monthlyRate / (settings.workingDaysPerMonth * settings.normalHoursPerDay);

const period = { start: "2026-10-01", end: "2026-10-31" };

/** Absensi masuk 08:00 dan pulang `hours` jam kemudian (mendukung jam pecahan). */
function entry(
  workDate: string,
  hours: number,
  overrides: Partial<TimeEntryInput> = {},
): TimeEntryInput {
  const clockInAt = `${workDate}T08:00:00+07:00`;
  const clockOutAt = new Date(
    new Date(clockInAt).getTime() + hours * 3_600_000,
  ).toISOString();
  return {
    id: `te-${workDate}-${hours}`,
    workDate,
    clockInAt,
    clockOutAt,
    breakMinutes: 0,
    overtimeMinutes: 0,
    ...overrides,
  };
}

const PAYROLL_BASE = {
  period,
  joinedAt: "2026-01-01",
  tasks: [],
  advances: [],
  overtime: settings,
};

/* ------------------------------------------------------------------ */
/* Kasus                                                               */
/* ------------------------------------------------------------------ */

// Senin 5 Okt 2026 (hari kerja) — 9 jam efektif, normal 7 jam.
const nineHours = "2026-10-05";
// Selasa 6 Okt 2026 — 7 jam 30 menit efektif.
const sevenHalfHours = "2026-10-06";
// Minggu 4 Okt 2026 — hari libur mingguan.
const sunday = "2026-10-04";

const cases = {
  sembilanjamPerJam: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(nineHours, 9)],
  }),
  tujuhSetengahJamPerJam: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(sevenHalfHours, 7.5)],
  }),
  manualLebihKecil: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(nineHours, 9, { overtimeMinutes: 30 })],
  }),
  manualLebihBesar: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(nineHours, 7, { overtimeMinutes: 120 })],
  }),
  harianSembilanJam: computePayslip({
    ...PAYROLL_BASE,
    payType: "daily",
    payRate: dailyRate,
    timeEntries: [entry(nineHours, 9)],
  }),
  bulananSembilanJam: computePayslip({
    ...PAYROLL_BASE,
    payType: "monthly",
    payRate: monthlyRate,
    // Hadir penuh semua hari kerja, satu hari bekerja 9 jam (2 jam lembur).
    timeEntries: workDatesBetween(period.start, period.end).map((day) =>
      entry(day, day === nineHours ? 9 : 7),
    ),
  }),
  hariLiburTanpaManual: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(sunday, 9)],
  }),
  hariLiburManual: computePayslip({
    ...PAYROLL_BASE,
    payType: "hourly",
    payRate: perHour,
    timeEntries: [entry(sunday, 9, { overtimeMinutes: 120 })],
  }),
  perTugas: computePayslip({
    ...PAYROLL_BASE,
    payType: "per_task",
    payRate: 20_000,
    timeEntries: [entry(nineHours, 9)],
  }),
};

const overtimeLines = (kind: string) => cases.sembilanjamPerJam.lines.filter((l) => l.kind === kind);
const lines = overtimeLines("overtime");

const expectedFirst = Math.round((60 / 60) * perHour * settings.firstHourMultiplier); // 45.000
const expectedNext = Math.round((60 / 60) * perHour * settings.nextHourMultiplier); // 60.000
const expectedHalfHour = Math.round((30 / 60) * perHour * settings.firstHourMultiplier); // 22.500
const expectedDailyFirst = Math.round((60 / 60) * dailyHourly * settings.firstHourMultiplier);
const expectedDailyNext = Math.round((60 / 60) * dailyHourly * settings.nextHourMultiplier);
const expectedMonthlyFirst = Math.round(
  (60 / 60) * monthlyHourly * settings.firstHourMultiplier,
);
const expectedMonthlyNext = Math.round((60 / 60) * monthlyHourly * settings.nextHourMultiplier);

const slipAccrual = accrualForEntry({
  minutes: 540,
  overtime: { firstMinutes: 60, nextMinutes: 60 },
  rate: perHour,
  firstHourMultiplier: settings.firstHourMultiplier,
  nextHourMultiplier: settings.nextHourMultiplier,
});

const split9 = splitOvertimeMinutes({
  workedMinutes: 540,
  normalMinutesPerDay: normalMinutesPerDay(settings),
});

const checks: Array<{ label: string; ok: boolean; detail: string }> = [
  {
    label: "9 jam efektif, normal 7 jam → 2 jam lembur (1 jam pertama + 1 jam berikutnya)",
    ok: split9.totalMinutes === 120 && split9.firstMinutes === 60 && split9.nextMinutes === 60,
    detail: `total ${split9.totalMinutes} menit = ${split9.firstMinutes} + ${split9.nextMinutes} (sumber: ${split9.source})`,
  },
  {
    label: "slip memuat DUA baris lembur dengan tarif berbeda",
    ok:
      lines.length === 2 &&
      lines[0].label === "Lembur jam pertama (×1,5)" &&
      lines[1].label === "Lembur jam berikutnya (×2)" &&
      lines[0].unitRate === Math.round(perHour * 1.5) &&
      lines[1].unitRate === Math.round(perHour * 2),
    detail: lines
      .map((l) => `${l.label} · ${l.qty} jam × ${l.unitRate} = ${l.amount}`)
      .join(" | "),
  },
  {
    label: "upah lembur = 1 jam ×1,5 + 1 jam ×2",
    ok: lines[0]?.amount === expectedFirst && lines[1]?.amount === expectedNext,
    detail: `${lines[0]?.amount} + ${lines[1]?.amount} (harus ${expectedFirst} + ${expectedNext})`,
  },
  {
    label: "jam reguler tidak dobel: 9 jam − 2 jam lembur = 7 jam",
    ok:
      cases.sembilanjamPerJam.lines[0]?.kind === "regular" &&
      cases.sembilanjamPerJam.lines[0]?.qty === 7 &&
      cases.sembilanjamPerJam.lines[0]?.amount === 7 * perHour,
    detail: `reguler ${cases.sembilanjamPerJam.lines[0]?.qty} jam = ${cases.sembilanjamPerJam.lines[0]?.amount}, bruto ${cases.sembilanjamPerJam.gross}`,
  },
  {
    label: "bruto = reguler + lembur (tidak ada upah yang hilang / dobel)",
    ok: cases.sembilanjamPerJam.gross === 7 * perHour + expectedFirst + expectedNext,
    detail: `bruto ${cases.sembilanjamPerJam.gross}`,
  },
  {
    label: "angka accrual saldo sama dengan angka slip (satu absensi)",
    ok: slipAccrual.total === cases.sembilanjamPerJam.gross,
    detail: `accrual ${slipAccrual.total} vs slip ${cases.sembilanjamPerJam.gross}`,
  },
  {
    label: "lembur 30 menit tetap proporsional (×1,5)",
    ok:
      cases.tujuhSetengahJamPerJam.lines.filter((l) => l.kind === "overtime").length === 1 &&
      cases.tujuhSetengahJamPerJam.lines.find((l) => l.kind === "overtime")?.amount ===
        expectedHalfHour,
    detail: `${cases.tujuhSetengahJamPerJam.lines
      .filter((l) => l.kind === "overtime")
      .map((l) => `${l.qty} jam = ${l.amount}`)
      .join(", ")} (harus ${expectedHalfHour})`,
  },
  {
    label: "overtime_minutes manual lebih kecil menang atas hitungan otomatis",
    ok:
      cases.manualLebihKecil.lines.filter((l) => l.kind === "overtime").length === 1 &&
      cases.manualLebihKecil.lines.find((l) => l.kind === "overtime")?.amount ===
        expectedHalfHour,
    detail: `lembur manual 30 menit → ${cases.manualLebihKecil.lines.find((l) => l.kind === "overtime")?.amount} (otomatis akan 105.000)`,
  },
  {
    label: "overtime_minutes manual lebih besar juga menang (120 menit)",
    ok:
      cases.manualLebihBesar.lines.filter((l) => l.kind === "overtime").length === 2 &&
      cases.manualLebihBesar.lines
        .filter((l) => l.kind === "overtime")
        .reduce((sum, l) => sum + l.amount, 0) ===
        expectedFirst + expectedNext,
    detail: cases.manualLebihBesar.lines
      .filter((l) => l.kind === "overtime")
      .map((l) => `${l.qty} jam = ${l.amount}`)
      .join(", "),
  },
  {
    label: "karyawan HARIAN dapat upah lembur (#55)",
    ok:
      cases.harianSembilanJam.lines.filter((l) => l.kind === "overtime").length === 2 &&
      cases.harianSembilanJam.lines
        .filter((l) => l.kind === "overtime")
        .reduce((sum, l) => sum + l.amount, 0) ===
        expectedDailyFirst + expectedDailyNext &&
      cases.harianSembilanJam.gross === dailyRate + expectedDailyFirst + expectedDailyNext,
    detail: `tarif sejam ${Math.round(dailyHourly)} · lembur ${expectedDailyFirst} + ${expectedDailyNext} · bruto ${cases.harianSembilanJam.gross}`,
  },
  {
    label: "karyawan BULANAN dapat upah lembur (#55)",
    ok:
      cases.bulananSembilanJam.lines.filter((l) => l.kind === "overtime").length === 2 &&
      cases.bulananSembilanJam.lines
        .filter((l) => l.kind === "overtime")
        .reduce((sum, l) => sum + l.amount, 0) ===
        expectedMonthlyFirst + expectedMonthlyNext &&
      cases.bulananSembilanJam.gross === monthlyRate + expectedMonthlyFirst + expectedMonthlyNext,
    detail: `tarif sejam ${monthlyHourly.toFixed(2)} · lembur ${expectedMonthlyFirst} + ${expectedMonthlyNext} · bruto ${cases.bulananSembilanJam.gross}`,
  },
  {
    label: "lembur hari libur (Minggu) tidak dihitung otomatis + ada peringatan",
    ok:
      cases.hariLiburTanpaManual.lines.filter((l) => l.kind === "overtime").length === 0 &&
      cases.hariLiburTanpaManual.warnings.some((w) => w.includes("hari libur")),
    detail: `baris lembur ${cases.hariLiburTanpaManual.lines.filter((l) => l.kind === "overtime").length}, peringatan: ${cases.hariLiburTanpaManual.warnings.join(" | ")}`,
  },
  {
    label: "lembur manual di hari libur tetap dibayar (tangga hari kerja)",
    ok:
      cases.hariLiburManual.lines.filter((l) => l.kind === "overtime").length === 2 &&
      isWorkingDay(sunday, settings.workingDaysPerWeek) === false,
    detail: cases.hariLiburManual.lines
      .filter((l) => l.kind === "overtime")
      .map((l) => `${l.qty} jam = ${l.amount}`)
      .join(", "),
  },
  {
    label: "karyawan per tugas tidak punya tarif sejam → tanpa baris lembur + peringatan",
    ok:
      cases.perTugas.lines.filter((l) => l.kind === "overtime").length === 0 &&
      cases.perTugas.warnings.some((w) => w.includes("per tugas")),
    detail: `baris ${cases.perTugas.lines.length}, peringatan: ${cases.perTugas.warnings.join(" | ")}`,
  },
  {
    label: "tarif sejam mengikuti pengaturan, bukan angka hardcode (bulanan 26 hari × 8 jam)",
    ok: (() => {
      const other = overtimeSettingsFromOrg({
        normalHoursPerDay: "8.00",
        workingDaysPerWeek: 5,
        workingDaysPerMonth: 26,
        overtimeFirstMultiplier: "1.50",
        overtimeNextMultiplier: "2.00",
      });
      const viaOther = computePayslip({
        ...PAYROLL_BASE,
        overtime: other,
        payType: "monthly",
        payRate: monthlyRate,
        timeEntries: [entry(nineHours, 9)],
      });
      const hourly = monthlyRate / (26 * 8);
      // Jam normal 8 → 9 jam kerja = 1 jam lembur (hanya tangga pertama).
      const expected = Math.round(1 * hourly * 1.5);
      const got = viaOther.lines
        .filter((l) => l.kind === "overtime")
        .reduce((sum, l) => sum + l.amount, 0);
      return got === expected && viaOther.lines.filter((l) => l.kind === "overtime").length === 1;
    })(),
    detail: `gaji 6.000.000 ÷ (26 × 8) = ${(monthlyRate / 208).toFixed(2)}/jam → lembur 1 jam = ${Math.round((monthlyRate / 208) * 1.5)}`,
  },
];

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? "✓" : "✗"} ${check.label}\n    ${check.detail}`);
}

console.log(
  `\npengaturan: ${settings.normalHoursPerDay} jam/hari · ${settings.workingDaysPerWeek} hari/minggu · ${settings.workingDaysPerMonth} hari/bulan · ×${settings.firstHourMultiplier} lalu ×${settings.nextHourMultiplier}`,
);

if (failed > 0) {
  console.error(`\n${failed} cek gagal`);
  process.exit(1);
}
console.log("semua cek lembur lulus");
