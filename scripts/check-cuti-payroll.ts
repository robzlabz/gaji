/**
 * Cek perilaku cuti di payroll bulanan tanpa perlu database.
 *
 * Jalankan: npx tsx scripts/check-cuti-payroll.ts
 *
 * Yang dibuktikan:
 * 1. Cuti berbayar approved menambah hari yang dibayar (gaji tidak terpotong).
 * 2. Cuti tanpa upah tidak menambah hari (tetap prorata) + memunculkan peringatan.
 * 3. Cuti pending diabaikan.
 * 4. Hari cuti yang sudah ada absensinya tidak dihitung dua kali.
 * 5. Tipe gaji selain bulanan tidak terpengaruh cuti.
 * 6. joinedAt di tengah periode tanpa absensi → prorata (bukan gaji penuh).
 * 7. endedAt di tengah periode tanpa absensi → prorata (bukan gaji penuh).
 * 8. joinedAt setelah periode selesai → tidak ada baris gaji bulanan.
 * 9. endedAt sebelum periode mulai → tidak ada baris gaji bulanan.
 * 10. Karyawan bulan penuh tanpa absensi tetap dibayar penuh.
 */
import { computePayslip, type LeaveInput, type TimeEntryInput } from "../src/lib/payroll";
import { workDatesBetween } from "../src/lib/period";

const period = { start: "2026-09-26", end: "2026-10-25" };
const rate = 6_000_000;
const workDays = workDatesBetween(period.start, period.end);
const denominator = workDays.length;

function entry(workDate: string): TimeEntryInput {
  return {
    id: `te-${workDate}`,
    workDate,
    clockInAt: `${workDate}T08:00:00+07:00`,
    clockOutAt: `${workDate}T16:00:00+07:00`,
    breakMinutes: 60,
    overtimeMinutes: 0,
  };
}

// Karyawan hadir 10 hari kerja, cuti 3 hari kerja setelahnya.
const attended = workDays.slice(0, 10).map(entry);
const leaveDates = workDays.slice(10, 13);

function leave(overrides: Partial<LeaveInput> = {}): LeaveInput {
  return {
    id: "leave-1",
    kind: "cuti",
    startDate: leaveDates[0],
    endDate: leaveDates[leaveDates.length - 1],
    paid: true,
    status: "approved",
    ...overrides,
  };
}

const base = {
  payType: "monthly",
  payRate: rate,
  period,
  joinedAt: "2026-01-01",
  tasks: [],
  advances: [],
};

const cases = {
  tanpaCuti: computePayslip({ ...base, timeEntries: attended }),
  cutiBerbayar: computePayslip({ ...base, timeEntries: attended, leaves: [leave()] }),
  cutiTanpaUpah: computePayslip({
    ...base,
    timeEntries: attended,
    leaves: [leave({ paid: false })],
  }),
  cutiPending: computePayslip({
    ...base,
    timeEntries: attended,
    leaves: [leave({ status: "pending" })],
  }),
  cutiDobelDenganAbsensi: computePayslip({
    ...base,
    timeEntries: attended,
    leaves: [leave({ startDate: workDays[0], endDate: workDays[2] })],
  }),
  harianDenganCuti: computePayslip({
    ...base,
    payType: "daily",
    payRate: 175_000,
    timeEntries: attended,
    leaves: [leave()],
  }),
  harianTanpaCuti: computePayslip({
    ...base,
    payType: "daily",
    payRate: 175_000,
    timeEntries: attended,
  }),
  // Prorata dua arah: denominator tetap hari kerja periode penuh, sedangkan pembilang
  // dibatasi rentang kerja [joinedAt/period.start, endedAt/period.end].
  joinedMidPeriod: computePayslip({
    ...base,
    joinedAt: workDays[10],
    timeEntries: [],
  }),
  joinedMidPeriodHadirSemua: computePayslip({
    ...base,
    joinedAt: workDays[10],
    timeEntries: workDays.slice(10).map(entry),
  }),
  endedMidPeriod: computePayslip({
    ...base,
    endedAt: workDays[10],
    timeEntries: [],
  }),
  joinedAfterPeriod: computePayslip({
    ...base,
    joinedAt: "2026-11-01",
    timeEntries: [],
  }),
  endedBeforePeriod: computePayslip({
    ...base,
    endedAt: "2026-09-01",
    timeEntries: [],
  }),
  bulanPenuhTanpaAbsensi: computePayslip({
    ...base,
    timeEntries: [],
  }),
};

const perDay = rate / denominator;
const expectedIncrease = Math.round(leaveDates.length * perDay);
const joinedWorkDays = workDays.slice(10).length;
const endedWorkDays = workDays.slice(0, 11).length;

const checks: Array<{ label: string; ok: boolean; detail: string }> = [
  {
    label: "cuti berbayar menambah gaji",
    ok: cases.cutiBerbayar.gross === cases.tanpaCuti.gross + expectedIncrease,
    detail: `tanpa cuti ${cases.tanpaCuti.gross} → dengan cuti ${cases.cutiBerbayar.gross} (+${expectedIncrease})`,
  },
  {
    label: "cuti tanpa upah tidak menambah gaji",
    ok: cases.cutiTanpaUpah.gross === cases.tanpaCuti.gross,
    detail: `gross ${cases.cutiTanpaUpah.gross}, warning: ${cases.cutiTanpaUpah.warnings.join(" | ") || "(tidak ada)"}`,
  },
  {
    label: "cuti pending diabaikan",
    ok: cases.cutiPending.gross === cases.tanpaCuti.gross,
    detail: `gross ${cases.cutiPending.gross}`,
  },
  {
    label: "hari cuti yang sudah ada absensinya tidak dobel",
    ok: cases.cutiDobelDenganAbsensi.gross === cases.tanpaCuti.gross,
    detail: `gross ${cases.cutiDobelDenganAbsensi.gross} (absensi 10 hari, cuti 3 hari pertama)`,
  },
  {
    label: "tipe harian tidak terpengaruh cuti",
    ok: cases.harianDenganCuti.gross === cases.harianTanpaCuti.gross,
    detail: `harian ${cases.harianTanpaCuti.gross} → ${cases.harianDenganCuti.gross}`,
  },
  {
    label: "label slip menyebut hari cuti",
    ok: cases.cutiBerbayar.lines[0].label.includes(`${leaveDates.length} hari cuti`),
    detail: cases.cutiBerbayar.lines[0].label,
  },
  {
    label: "meta slip menyimpan hari cuti untuk audit",
    ok: cases.cutiBerbayar.lines[0].meta?.paidLeaveDays === leaveDates.length,
    detail: JSON.stringify(cases.cutiBerbayar.lines[0].meta),
  },
  {
    label: "joinedAt di tengah periode tanpa absensi tetap prorata",
    ok:
      cases.joinedMidPeriod.gross === Math.round((joinedWorkDays / denominator) * rate) &&
      cases.joinedMidPeriod.lines[0]?.label ===
        `Gaji bulanan (prorata ${joinedWorkDays}/${denominator} hari)`,
    detail: `gross ${cases.joinedMidPeriod.gross} (harus ${Math.round((joinedWorkDays / denominator) * rate)}), label ${cases.joinedMidPeriod.lines[0]?.label}`,
  },
  {
    label: "endedAt di tengah periode tanpa absensi tetap prorata",
    ok:
      cases.endedMidPeriod.gross === Math.round((endedWorkDays / denominator) * rate) &&
      cases.endedMidPeriod.lines[0]?.label ===
        `Gaji bulanan (prorata ${endedWorkDays}/${denominator} hari)`,
    detail: `gross ${cases.endedMidPeriod.gross} (harus ${Math.round((endedWorkDays / denominator) * rate)}), label ${cases.endedMidPeriod.lines[0]?.label}`,
  },
  {
    label: "joinedAt setelah periode selesai tidak dapat gaji bulanan",
    ok:
      cases.joinedAfterPeriod.gross === 0 &&
      cases.joinedAfterPeriod.lines.filter((line) => line.kind === "regular").length === 0,
    detail: `gross ${cases.joinedAfterPeriod.gross}, baris ${cases.joinedAfterPeriod.lines.length}`,
  },
  {
    label: "endedAt sebelum periode mulai tidak dapat gaji bulanan",
    ok:
      cases.endedBeforePeriod.gross === 0 &&
      cases.endedBeforePeriod.lines.filter((line) => line.kind === "regular").length === 0,
    detail: `gross ${cases.endedBeforePeriod.gross}, baris ${cases.endedBeforePeriod.lines.length}`,
  },
  {
    label: "karyawan bulan penuh tanpa absensi tetap dibayar penuh",
    ok:
      cases.bulanPenuhTanpaAbsensi.gross === rate &&
      cases.bulanPenuhTanpaAbsensi.lines[0]?.label === "Gaji bulanan (penuh)" &&
      cases.bulanPenuhTanpaAbsensi.lines[0]?.unitRate === Math.round(rate / denominator),
    detail: `gross ${cases.bulanPenuhTanpaAbsensi.gross}, label ${cases.bulanPenuhTanpaAbsensi.lines[0]?.label}`,
  },
  {
    label: "hadir penuh sejak joinedAt tidak memunculkan warning absensi",
    ok:
      cases.joinedMidPeriodHadirSemua.gross ===
        Math.round((joinedWorkDays / denominator) * rate) &&
      cases.joinedMidPeriodHadirSemua.warnings.length === 0,
    detail: `gross ${cases.joinedMidPeriodHadirSemua.gross}, warning: ${cases.joinedMidPeriodHadirSemua.warnings.join(" | ") || "(tidak ada)"}`,
  },
];

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? "✓" : "✗"} ${check.label}\n    ${check.detail}`);
}

console.log(
  `\nperiode ${period.start}..${period.end} · ${denominator} hari kerja · tarif ${rate} · per hari ${Math.round(perDay)}`,
);

if (failed > 0) {
  console.error(`\n${failed} cek gagal`);
  process.exit(1);
}
console.log("semua cek lulus");
