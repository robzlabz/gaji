/**
 * Cek matematika saldo prabayar + ongkos kedatangan tanpa database.
 *
 * Jalankan: npx tsx scripts/check-saldo.ts
 *
 * Kasus acuan (persis seperti yang diminta owner):
 * karyawan per jam Rp 10.000, tiap kedatangan dapat ongkos Rp 10.000, owner kirim
 * uang lebih dulu (saldo), tiap kehadiran approved memotong saldo.
 *
 * Yang dibuktikan:
 * 1. Accrual satu kedatangan = upah jam + ongkos, dibulatkan per kedatangan.
 * 2. Lembur memakai pengali dan tidak dobel dengan jam reguler.
 * 3. Slip memakai angka accrual yang sama (tidak ada selisih saldo vs slip).
 * 4. Saldo kurang → slip tetap membayar sisanya tunai (shortfall).
 * 5. Saldo lebih → sisa saldo tidak hangus, hanya sebagian yang dipakai.
 * 6. `settle` (pelunasan tunai) tidak menambah dana periode baru.
 * 7. Tarif saat kejadian: tarif lama tetap dipakai untuk absensi lama.
 */
import { accrualForEntry, coverageForPeriod, periodLedgerSummary, rateAtDate } from "../src/lib/saldo";
import { computePayslip, type TimeEntryInput } from "../src/lib/payroll";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`);
}

const period = { start: "2026-10-26", end: "2026-11-25" };

/* 1. accrual satu kedatangan ------------------------------------------------ */
const fiveHours = accrualForEntry({ minutes: 300, rate: 10_000, transportAmount: 10_000 });
check("5 jam × Rp 10.000 + ongkos Rp 10.000", fiveHours.total, 60_000);
check("  · upah terpisah dari ongkos", [fiveHours.wageAmount, fiveHours.transportAmount], [50_000, 10_000]);

const noTransport = accrualForEntry({ minutes: 300, rate: 10_000 });
check("tanpa ongkos", noTransport.total, 50_000);

const partial = accrualForEntry({ minutes: 90, rate: 10_000, transportAmount: 10_000 });
check("1,5 jam dibulatkan per kedatangan", partial.total, 25_000);

/* 2. lembur ---------------------------------------------------------------- */
const overtime = accrualForEntry({
  minutes: 300,
  overtimeMinutes: 60,
  rate: 10_000,
  overtimeMultiplier: 1.5,
});
check("lembur 1 jam ×1,5 tidak dobel", [overtime.regularMinutes, overtime.overtimeMinutes], [240, 60]);
check("  · nilai lembur", overtime.wageAmount, 40_000 + 15_000);

/* 3. slip memakai angka yang sama ----------------------------------------- */
function entry(workDate: string, transportAmount: number): TimeEntryInput {
  return {
    id: `te-${workDate}`,
    workDate,
    clockInAt: `${workDate}T08:00:00+07:00`,
    clockOutAt: `${workDate}T13:00:00+07:00`,
    breakMinutes: 0,
    overtimeMinutes: 0,
    transportAmount,
    rateAt: 10_000,
  };
}

const entries = [entry("2026-10-27", 10_000), entry("2026-10-28", 10_000)];
const accrualTotal = entries.reduce(
  (sum, item) =>
    sum +
    accrualForEntry({
      minutes: 300,
      rate: 10_000,
      transportAmount: Number(item.transportAmount ?? 0),
    }).total,
  0,
);
check("2 kedatangan = Rp 120.000", accrualTotal, 120_000);

const slip = computePayslip({
  payType: "hourly",
  payRate: 10_000,
  period,
  timeEntries: entries,
  tasks: [],
  advances: [],
  saldoCovered: 120_000,
});
check("slip: bruto = upah + ongkos", slip.gross, 120_000);
check("slip: sudah dibayar saldo", slip.net, 0);

/* 4. saldo kurang → shortfall --------------------------------------------- */
const short = coverageForPeriod({ accrualTotal: 120_000, balanceStart: 50_000, fundingInPeriod: 0 });
check("saldo kurang: covered/shortfall", [short.covered, short.shortfall], [50_000, 70_000]);

const shortSlip = computePayslip({
  payType: "hourly",
  payRate: 10_000,
  period,
  timeEntries: entries,
  tasks: [],
  advances: [],
  saldoCovered: short.covered,
});
check("slip: sisa dibayar tunai", shortSlip.net, 70_000);

/* 5. saldo lebih ---------------------------------------------------------- */
const surplus = coverageForPeriod({ accrualTotal: 120_000, balanceStart: 500_000, fundingInPeriod: 0 });
check("saldo lebih: hanya sebagian dipakai", [surplus.covered, surplus.shortfall], [120_000, 0]);

/* 6. settle tidak menambah dana periode ----------------------------------- */
const ledger = [
  { kind: "topup", amount: "200000", occurredAt: "2026-10-20" },
  { kind: "accrual", amount: "-120000", occurredAt: "2026-10-27" },
  { kind: "settle", amount: "70000", occurredAt: "2026-11-25" },
];
const summary = periodLedgerSummary(ledger, period);
check("ringkasan periode: accrual & funding", [summary.accrualTotal, summary.fundingInPeriod], [120_000, 0]);

const recomputed = coverageForPeriod({
  accrualTotal: summary.accrualTotal,
  balanceStart: 200_000,
  fundingInPeriod: summary.fundingInPeriod,
});
check("hitung ulang slip stabil setelah settle", [recomputed.covered, recomputed.shortfall], [120_000, 0]);

/* 6b. pindahan kasbon menambah dana periode ------------------------------- */
const kasbonSummary = periodLedgerSummary(
  [{ kind: "kasbon", amount: "150000", occurredAt: "2026-10-28" }],
  period,
);
check("pindahan kasbon dihitung sebagai dana", kasbonSummary.fundingInPeriod, 150_000);

/* 7. tarif saat kejadian -------------------------------------------------- */
const history = [
  { kind: "wage", payRate: "10000", effectiveFrom: "2026-01-01" },
  { kind: "wage", payRate: "12000", effectiveFrom: "2026-11-01" },
  { kind: "transport", payRate: "10000", effectiveFrom: "2026-01-01" },
];
check("tarif Oktober", rateAtDate(history, "2026-10-27", "wage", 99_999), 10_000);
check("tarif November", rateAtDate(history, "2026-11-02", "wage", 99_999), 12_000);
check("ongkos tidak ikut tarif upah", rateAtDate(history, "2026-11-02", "transport", 0), 10_000);

/* slip dua tarif dalam satu periode -------------------------------------- */
const mixed = computePayslip({
  payType: "hourly",
  payRate: 12_000,
  period,
  timeEntries: [
    entry("2026-10-27", 0),
    { ...entry("2026-11-02", 0), rateAt: 12_000 },
  ],
  tasks: [],
  advances: [],
});
check("slip dua tarif: 5j×10.000 + 5j×12.000", mixed.gross, 110_000);
check("  · peringatan tarif campuran muncul", mixed.warnings.length > 0, true);

/* 8. kasbon tidak boleh bikin net minus --------------------------------- */
// Upah sudah dibayar penuh lewat saldo → tidak ada tunai untuk memotong kasbon.
const fullSaldoKasbon = computePayslip({
  payType: "hourly",
  payRate: 10_000,
  period,
  timeEntries: entries,
  tasks: [],
  advances: [{ id: "adv-1", balance: "250000", installmentAmount: "250000" }],
  saldoCovered: 120_000,
});
check("kasbon tidak dipotong saat upah dibayar penuh via saldo", fullSaldoKasbon.net, 0);
check("  · kasbon tidak muncul sebagai baris", fullSaldoKasbon.lines.some((l) => l.kind === "kasbon"), false);
check("  · ada peringatan sisa utang", fullSaldoKasbon.warnings.some((w) => w.includes("tetap jadi utang")), true);

// Sebagian upah tunai → kasbon dipotong sebatas tunai yang ada.
const partialSaldoKasbon = computePayslip({
  payType: "hourly",
  payRate: 10_000,
  period,
  timeEntries: entries,
  tasks: [],
  advances: [{ id: "adv-2", balance: "250000", installmentAmount: "250000" }],
  saldoCovered: 100_000,
});
const kasbonLine = partialSaldoKasbon.lines.find((l) => l.kind === "kasbon");
check("kasbon dipotong sebatas tunai", kasbonLine?.amount, 20_000);
check("  · net tidak minus", partialSaldoKasbon.net, 0);

console.log(
  failures === 0
    ? "\nSemua cek saldo lolos."
    : `\n${failures} cek gagal.`,
);
process.exit(failures === 0 ? 0 : 1);
