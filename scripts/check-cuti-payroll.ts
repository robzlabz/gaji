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
};

const perDay = rate / denominator;
const expectedIncrease = Math.round(leaveDates.length * perDay);

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
