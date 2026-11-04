/**
 * Verifikasi matematika langganan tanpa database.
 *
 * Jalankan: bun scripts/check-billing.ts   (atau: npm run check:billing)
 *
 * Yang dibuktikan:
 * 1. Harga tahunan = 10× harga bulanan (dua bulan gratis) untuk Dasar & Lengkap.
 * 2. Paket Gratis: 5 karyawan aktif & 1 cabang; karyawan ke-6 ditolak dengan pesan
 *    yang menyebut paket + batasnya (bukan lemparan error mentah).
 * 3. Organisasi tanpa baris langganan = paket Gratis (`getPlan(undefined)`).
 * 4. Perpanjangan periode: bulanan +1 bulan, tahunan +12 bulan, tanggal akhir
 *    inklusif dan tidak menabrak akhir bulan (31 Jan + 1 bulan).
 * 5. Pembayaran saat periode masih berjalan menumpuk dari sehari setelah periode
 *    aktif berakhir (sisa hari tidak hangus).
 * 6. Paket Konsultan = nego (harga null) dan tanpa batas karyawan/cabang.
 */
import {
  annualPrice,
  ANNUAL_BILLED_MONTHS,
  branchQuota,
  buildInvoiceNumber,
  CYCLE_LABEL,
  cycleMonths,
  employeeQuota,
  getPlan,
  nextPeriodStart,
  periodFor,
  PLANS,
  planPrice,
  resolvePayment,
} from "../src/lib/plans";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`);
}

function checkTrue(name: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "✓" : "✗"} ${name}${condition ? "" : ` — ${detail}`}`);
}

/* 1. Harga tahunan = 10× bulanan ------------------------------------------- */
check("harga bulanan Dasar", planPrice("dasar", "monthly"), 50_000);
check("harga tahunan Dasar", planPrice("dasar", "annual"), 500_000);
check("harga bulanan Lengkap", planPrice("lengkap", "monthly"), 100_000);
check("harga tahunan Lengkap", planPrice("lengkap", "annual"), 1_000_000);
check(
  "tahunan = 10× bulanan (Dasar)",
  planPrice("dasar", "annual"),
  (planPrice("dasar", "monthly") ?? 0) * ANNUAL_BILLED_MONTHS,
);
check(
  "tahunan = 10× bulanan (Lengkap)",
  planPrice("lengkap", "annual"),
  (planPrice("lengkap", "monthly") ?? 0) * ANNUAL_BILLED_MONTHS,
);
check("annualPrice(50.000)", annualPrice(50_000), 500_000);
check("hemat 2 bulan pada tahunan", 12 * 100_000 - (planPrice("lengkap", "annual") ?? 0), 200_000);
check("paket Gratis tetap Rp 0", planPrice("gratis", "annual"), 0);
check("label siklus", [CYCLE_LABEL.monthly, CYCLE_LABEL.annual], ["Bulanan", "Tahunan"]);

/* 2. Kuota Gratis ---------------------------------------------------------- */
const freeFour = employeeQuota("gratis", 4);
checkTrue("Gratis: karyawan ke-5 masih boleh", freeFour.allowed, freeFour.message);
check("Gratis: sisa kuota saat 4 terpakai", freeFour.remaining, 1);

const freeFull = employeeQuota("gratis", 5);
check("Gratis: karyawan ke-6 ditolak", freeFull.allowed, false);
check("Gratis: sisa kuota saat penuh", freeFull.remaining, 0);
check("Gratis: batas karyawan", freeFull.limit, 5);
checkTrue(
  "pesan penolakan menyebut paket & batas",
  freeFull.message.includes("Gratis") && freeFull.message.includes("5"),
  freeFull.message,
);
checkTrue(
  "pesan penolakan menyarankan naik paket",
  freeFull.message.includes("Dasar"),
  freeFull.message,
);

check("Gratis: cabang ke-2 ditolak", branchQuota("gratis", 1).allowed, false);
check("Gratis: cabang pertama boleh", branchQuota("gratis", 0).allowed, true);

/* 3. Organisasi tanpa langganan = Gratis ---------------------------------- */
check("getPlan(null) → gratis", getPlan(null).id, "gratis");
check("getPlan(undefined) → gratis", getPlan(undefined).id, "gratis");
check("getPlan('tidak-ada') → gratis", getPlan("tidak-ada").id, "gratis");
check("kuota org lama (tanpa baris) dihitung Gratis", employeeQuota(getPlan(undefined).id, 5).allowed, false);

/* 4. Perpanjangan periode ------------------------------------------------- */
check("cycleMonths bulanan", cycleMonths("monthly"), 1);
check("cycleMonths tahunan", cycleMonths("annual"), 12);
check("periode bulanan 1–31 Okt", periodFor("2026-10-01", "monthly"), {
  start: "2026-10-01",
  end: "2026-10-31",
});
check("periode tahunan 1 Jan–31 Des", periodFor("2026-01-01", "annual"), {
  start: "2026-01-01",
  end: "2026-12-31",
});
check("tahun kabisat: 1 Feb 2028 + 1 bulan", periodFor("2028-02-01", "monthly").end, "2028-02-29");
check("akhir bulan aman: 31 Jan → 27 Feb (berikutnya mulai 28 Feb)", periodFor("2026-01-31", "monthly").end, "2026-02-27");
check("tahunan dari 15 Nov", periodFor("2026-11-15", "annual"), {
  start: "2026-11-15",
  end: "2027-11-14",
});

/* 5. Pembayaran menumpuk, tidak menghanguskan sisa periode ---------------- */
check(
  "periode masih aktif → mulai sehari setelah berakhir",
  nextPeriodStart("2026-12-31", "2026-11-01"),
  "2027-01-01",
);
check("periode sudah lewat → mulai hari ini", nextPeriodStart("2026-10-31", "2026-11-01"), "2026-11-01");
check("tanpa langganan → mulai hari ini", nextPeriodStart(null, "2026-11-01"), "2026-11-01");

const stackedStart = nextPeriodStart("2026-11-30", "2026-11-01");
check(
  "tahunan menumpuk: 1 Des 2026 s/d 30 Nov 2027",
  periodFor(stackedStart, "annual"),
  { start: "2026-12-01", end: "2027-11-30" },
);

/* 6. Konsultan & paket berbayar lain ------------------------------------- */
check("Konsultan = nego (tanpa harga)", planPrice("konsultan", "monthly"), null);
check("Konsultan tahunan = nego", planPrice("konsultan", "annual"), null);
check("Konsultan tanpa batas karyawan", employeeQuota("konsultan", 999).limit, null);
check("Konsultan tanpa batas cabang", branchQuota("konsultan", 99).allowed, true);
check("Dasar: karyawan ke-16 ditolak", employeeQuota("dasar", 15).allowed, false);
check("Dasar: karyawan ke-15 boleh", employeeQuota("dasar", 14).allowed, true);
check("Lengkap: karyawan ke-51 ditolak", employeeQuota("lengkap", 50).allowed, false);
check("Lengkap: cabang tanpa batas", branchQuota("lengkap", 10).limit, null);
check("katalog berisi 4 paket", Object.keys(PLANS).length, 4);

/* Nomor tagihan ---------------------------------------------------------- */
check(
  "nomor tagihan",
  buildInvoiceNumber({ orgId: "1a2b3c4d-0000-0000-0000-000000000000", issuedAt: "2026-11-01", seq: 1 }),
  "INV-202611-1A2B3C4D-001",
);

/* 7. Satu pembayaran = satu nominal + satu periode ------------------------ */
const annualDasar = resolvePayment({ planId: "dasar", cycle: "annual", todayISO: "2026-11-01" });
check("bayar tahunan Dasar → tagihan Rp 500.000", annualDasar.amount, 500_000);
check("bayar tahunan Dasar → periode 12 bulan", [annualDasar.periodStart, annualDasar.periodEnd], [
  "2026-11-01",
  "2027-10-31",
]);
check("jatuh tempo = awal periode", annualDasar.dueAt, annualDasar.periodStart);

const annualFull = resolvePayment({ planId: "lengkap", cycle: "annual", todayISO: "2026-11-01" });
check("bayar tahunan Lengkap → tagihan Rp 1.000.000", annualFull.amount, 1_000_000);

const monthlyFull = resolvePayment({ planId: "lengkap", cycle: "monthly", todayISO: "2026-11-01" });
check("bayar bulanan Lengkap → Rp 100.000", monthlyFull.amount, 100_000);
check("bayar bulanan → periode 1 bulan", [monthlyFull.periodStart, monthlyFull.periodEnd], [
  "2026-11-01",
  "2026-11-30",
]);

check(
  "nominal manual tidak bisa menurunkan harga paket tetap",
  resolvePayment({ planId: "dasar", cycle: "annual", manualAmount: 10_000, todayISO: "2026-11-01" }).amount,
  500_000,
);

const stacked = resolvePayment({
  planId: "lengkap",
  cycle: "annual",
  currentPeriodEnd: "2026-12-31",
  todayISO: "2026-11-15",
});
check("perpanjangan menumpuk dari periode aktif", [stacked.periodStart, stacked.periodEnd], [
  "2027-01-01",
  "2027-12-31",
]);

let negoRejected = false;
try {
  resolvePayment({ planId: "konsultan", cycle: "annual", todayISO: "2026-11-01" });
} catch {
  negoRejected = true;
}
checkTrue("paket nego tanpa nominal ditolak", negoRejected);
check(
  "paket nego memakai nominal manual",
  resolvePayment({ planId: "konsultan", cycle: "annual", manualAmount: 2_400_000, todayISO: "2026-11-01" })
    .amount,
  2_400_000,
);

console.log(failures === 0 ? "\nSemua cek langganan lulus." : `\n${failures} cek GAGAL.`);
process.exit(failures === 0 ? 0 : 1);
