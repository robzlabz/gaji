/**
 * Cek penyusunan berkas transfer tanpa database.
 *
 * Jalankan: bun scripts/check-payout.ts  (atau: npm run check:payout)
 *
 * Yang dibuktikan:
 * 1. Semua slip approved punya rekening valid  → semua masuk baris transfer,
 *    total baris kontrol = jumlah net, dan file bank hanya memuat bank itu.
 * 2. Sebagian karyawan tanpa rekening / rekening tidak valid → muncul di daftar
 *    gagal dengan alasan, tidak masuk berkas, total kontrol tetap cocok.
 * 3. Slip draft & void tidak ikut; nominal nol/negatif ditolak sebagai gagal.
 * 4. Unduh ulang (input sama) menghasilkan berkas identik — tidak menggandakan baris.
 * 5. Nama file memuat periode dan tanggal ekspor.
 * 6. Format CSV: generik + BCA + Mandiri, dengan baris kontrol terakhir.
 */
import assert from "node:assert/strict";
import {
  buildPayoutBatch,
  controlRow,
  maskAccountNumber,
  normalizeAccountNumber,
  renderPayoutCsv,
  rowsForFormat,
  validateBankAccount,
  type PayoutSlipInput,
} from "../src/lib/payout";

let failures = 0;

function check(name: string, fn: () => void) {
  let ok = true;
  let detail = "";
  try {
    fn();
  } catch (error) {
    ok = false;
    failures += 1;
    detail = ` — ${error instanceof Error ? error.message : String(error)}`;
  }
  console.log(`${ok ? "✓" : "✗"} ${name}${detail}`);
}

/** Parse CSV sederhana (cukup untuk berkas yang kita tulis sendiri). */
function parseCsv(content: string): string[][] {
  const body = content.replace(/^\uFEFF/, "").replace(/\r\n$/, "");
  return body
    .split("\r\n")
    .map((line) => line.split(","));
}

const PERIOD = { start: "2026-10-01", end: "2026-10-31", label: "2026-10-01 s/d 2026-10-31" };
const EXPORT_DATE = "2026-11-01";

function slip(overrides: Partial<PayoutSlipInput> & { slipId: string }): PayoutSlipInput {
  return {
    employeeId: `emp-${overrides.slipId}`,
    employeeName: "Karyawan",
    net: 1_000_000,
    status: "final",
    bankCode: "BCA",
    bankAccountNumber: "1234567890",
    bankAccountName: "Karyawan",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Kasus 1 — semua lengkap                                             */
/* ------------------------------------------------------------------ */

const lengkap = buildPayoutBatch({
  slips: [
    slip({
      slipId: "s1",
      employeeName: "Budi Santoso",
      employeeCode: "EMP-001",
      net: "4500000.00",
      bankAccountNumber: "1234567890",
      bankAccountName: "Budi Santoso",
    }),
    slip({
      slipId: "s2",
      employeeName: "Ani Wijaya",
      employeeCode: "EMP-002",
      net: "3250000.00",
      bankCode: "MANDIRI",
      bankAccountNumber: "137-00-1234567-8",
      bankAccountName: "Ani Wijaya",
    }),
    slip({
      slipId: "s3",
      employeeName: "Citra Dewi",
      net: "1750000.00",
      status: "paid",
      bankCode: "BCA",
      bankAccountNumber: "0987654321",
      bankAccountName: "Citra Dewi",
    }),
  ],
  periodLabel: PERIOD.label,
});

check("kasus 1: semua slip approved masuk baris transfer", () => {
  assert.equal(lengkap.rows.length, 3);
  assert.equal(lengkap.failures.length, 0);
  assert.equal(lengkap.skipped.length, 0);
});

check("kasus 1: total batch = jumlah net slip", () => {
  assert.equal(lengkap.total, 4_500_000 + 3_250_000 + 1_750_000);
  assert.deepEqual(controlRow(lengkap.rows), ["TOTAL", "3 penerima", "9500000"]);
});

check("kasus 1: nomor rekening dinormalisasi (strip dibuang)", () => {
  const ani = lengkap.rows.find((row) => row.slipId === "s2");
  assert.ok(ani);
  assert.equal(ani.accountNumber, "1370012345678");
});

check("kasus 1: baris diurutkan per nama penerima", () => {
  assert.deepEqual(
    lengkap.rows.map((row) => row.employeeName),
    ["Ani Wijaya", "Budi Santoso", "Citra Dewi"],
  );
  assert.deepEqual(
    lengkap.rows.map((row) => row.no),
    [1, 2, 3],
  );
});

check("kasus 1: berkas BCA hanya memuat rekening BCA, total kontrol per file", () => {
  const bca = renderPayoutCsv({
    format: "bca",
    batch: lengkap,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  assert.equal(bca.rows.length, 2);
  assert.equal(bca.total, 4_500_000 + 1_750_000);
  assert.deepEqual(bca.rows.map((row) => row.no), [1, 2]);

  const lines = parseCsv(bca.content);
  assert.deepEqual(lines[0], [
    "No",
    "Rekening Penerima",
    "Nama Penerima",
    "Jumlah Transfer",
    "Berita Transfer",
  ]);
  assert.deepEqual(lines.at(-1), ["TOTAL", "2 penerima", "6250000"]);
  assert.equal(lines.length, 1 + 2 + 1);
});

check("kasus 1: berkas Mandiri memuat 1 penerima", () => {
  const mandiri = renderPayoutCsv({
    format: "mandiri",
    batch: lengkap,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const lines = parseCsv(mandiri.content);
  assert.equal(mandiri.rows.length, 1);
  assert.deepEqual(lines.at(-1), ["TOTAL", "1 penerima", "3250000"]);
});

check("kasus 1: berkas generik memuat semua bank + kolom bank", () => {
  const generik = renderPayoutCsv({
    format: "generic",
    batch: lengkap,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const lines = parseCsv(generik.content);
  assert.equal(lines[0]?.length, 7, "header generik 7 kolom");
  assert.deepEqual(lines[0]?.slice(0, 3), ["No", "Nama Penerima", "Bank"]);
  assert.equal(lines[1]?.length, 7, "baris data generik 7 kolom");
  assert.equal(lines[1]?.[2], "Mandiri");
  assert.deepEqual(lines.at(-1), ["TOTAL", "3 penerima", "9500000"]);
  assert.equal(generik.rows.length, 3);
  assert.equal(generik.total, 9_500_000);
});

check("kasus 1: nama file memuat periode dan tanggal ekspor", () => {
  const bca = renderPayoutCsv({
    format: "bca",
    batch: lengkap,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  assert.equal(bca.filename, `transfer-gaji_bca_${PERIOD.start}_${PERIOD.end}_${EXPORT_DATE}.csv`);
  assert.ok(bca.filename.includes(PERIOD.start));
  assert.ok(bca.filename.includes(PERIOD.end));
  assert.ok(bca.filename.includes(EXPORT_DATE));
});

check("kasus 1: unduh ulang identik (idempoten), duplikat slip tidak menggandakan", () => {
  const ulang = renderPayoutCsv({
    format: "bca",
    batch: buildPayoutBatch({
      slips: [
        slip({ slipId: "s1", employeeName: "Budi Santoso", net: "4500000.00", bankAccountNumber: "1234567890", bankAccountName: "Budi Santoso" }),
        slip({ slipId: "s3", employeeName: "Citra Dewi", net: "1750000.00", status: "paid", bankAccountNumber: "0987654321", bankAccountName: "Citra Dewi" }),
      ],
      periodLabel: PERIOD.label,
    }),
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const sekali = renderPayoutCsv({
    format: "bca",
    batch: lengkap,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  assert.equal(ulang.content, sekali.content);

  const dobel = buildPayoutBatch({
    slips: [
      slip({ slipId: "s1", employeeName: "Budi Santoso" }),
      slip({ slipId: "s1", employeeName: "Budi Santoso" }),
    ],
    periodLabel: PERIOD.label,
  });
  assert.equal(dobel.rows.length, 1);
  assert.equal(dobel.skipped.length, 1);
  assert.match(dobel.skipped[0].reason, /duplikat/i);
});

/* ------------------------------------------------------------------ */
/* Kasus 2 — sebagian tanpa rekening                                   */
/* ------------------------------------------------------------------ */

const tanpaRekening = buildPayoutBatch({
  slips: [
    slip({ slipId: "a1", employeeName: "Dedi Kurnia", net: 2_000_000 }),
    slip({
      slipId: "a2",
      employeeName: "Eka Putri",
      net: 2_500_000,
      bankCode: null,
      bankAccountNumber: null,
      bankAccountName: null,
    }),
    slip({
      slipId: "a3",
      employeeName: "Fajar Nugroho",
      net: 1_500_000,
      bankAccountNumber: "12ab56",
      bankAccountName: "Fajar Nugroho",
    }),
    slip({
      slipId: "a4",
      employeeName: "Gita Lestari",
      net: 1_750_000,
      bankAccountNumber: "4567",
      bankAccountName: "Gita Lestari",
    }),
    slip({
      slipId: "a5",
      employeeName: "Hadi Pratama",
      net: 1_250_000,
      bankAccountName: "",
    }),
  ],
  periodLabel: PERIOD.label,
});

check("kasus 2: hanya karyawan dengan rekening valid yang masuk berkas", () => {
  assert.equal(tanpaRekening.rows.length, 1);
  assert.equal(tanpaRekening.rows[0].employeeName, "Dedi Kurnia");
  assert.equal(tanpaRekening.total, 2_000_000);
});

check("kasus 2: yang gagal masuk daftar gagal dengan alasan, tidak ikut baris", () => {
  assert.equal(tanpaRekening.failures.length, 4);
  const byName = new Map(tanpaRekening.failures.map((row) => [row.employeeName, row.reason]));
  for (const name of ["Eka Putri", "Fajar Nugroho", "Gita Lestari", "Hadi Pratama"]) {
    assert.ok(byName.has(name), `${name} harus ada di daftar gagal`);
    assert.match(byName.get(name) ?? "", /rekening/i);
  }
  assert.match(byName.get("Fajar Nugroho") ?? "", /angka/i);
  assert.match(byName.get("Gita Lestari") ?? "", /6–20 digit/);
  assert.ok(
    tanpaRekening.rows.every((row) => !["Eka Putri", "Fajar Nugroho", "Gita Lestari", "Hadi Pratama"].includes(row.employeeName)),
  );
});

check("kasus 2: baris kontrol = hanya penerima yang benar-benar ditransfer", () => {
  const generik = renderPayoutCsv({
    format: "generic",
    batch: tanpaRekening,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const lines = parseCsv(generik.content);
  assert.deepEqual(lines.at(-1)?.slice(0, 3), ["TOTAL", "1 penerima", "2000000"]);
  assert.equal(lines.length, 1 + 1 + 1);
});

/* ------------------------------------------------------------------ */
/* Kasus 3 — nominal nol / negatif, status draft & void                */
/* ------------------------------------------------------------------ */

const nominalAneh = buildPayoutBatch({
  slips: [
    slip({ slipId: "n1", employeeName: "Indra Nol", net: "0.00" }),
    slip({ slipId: "n2", employeeName: "Joko Minus", net: "-250000.00" }),
    slip({ slipId: "n3", employeeName: "Kiki Draft", net: 3_000_000, status: "draft" }),
    slip({ slipId: "n4", employeeName: "Lusi Void", net: 4_000_000, status: "void" }),
    slip({ slipId: "n5", employeeName: "Mira Valid", net: 2_100_000 }),
  ],
  periodLabel: PERIOD.label,
});

check("kasus 3: nominal 0 dan negatif ditolak sebagai gagal, tidak masuk berkas", () => {
  assert.equal(nominalAneh.rows.length, 1);
  assert.equal(nominalAneh.rows[0].employeeName, "Mira Valid");
  assert.equal(nominalAneh.total, 2_100_000);
  const gagal = nominalAneh.failures.map((row) => row.employeeName).sort();
  assert.deepEqual(gagal, ["Indra Nol", "Joko Minus"]);
  assert.match(
    nominalAneh.failures.find((row) => row.employeeName === "Joko Minus")?.reason ?? "",
    /tidak ada uang|nominal/i,
  );
});

check("kasus 3: slip draft dan void tidak ikut berkas", () => {
  const generik = renderPayoutCsv({
    format: "generic",
    batch: nominalAneh,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const lines = parseCsv(generik.content);
  assert.deepEqual(lines.at(-1)?.slice(0, 3), ["TOTAL", "1 penerima", "2100000"]);
  assert.ok(!generik.content.includes("Kiki Draft"));
  assert.ok(!generik.content.includes("Lusi Void"));
  assert.equal(nominalAneh.skipped.length, 2);
});

check("kasus 3: berkas bank tanpa penerima tetap punya baris kontrol nol", () => {
  const bca = renderPayoutCsv({
    format: "bca",
    batch: nominalAneh,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  const lines = parseCsv(bca.content);
  // Mira Valid bank-nya BCA (default slip) → 1 baris.
  assert.equal(bca.rows.length, 1);
  assert.deepEqual(lines.at(-1), ["TOTAL", "1 penerima", "2100000"]);

  const mandiri = renderPayoutCsv({
    format: "mandiri",
    batch: nominalAneh,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    exportDate: EXPORT_DATE,
  });
  assert.equal(mandiri.rows.length, 0);
  assert.deepEqual(parseCsv(mandiri.content).at(-1), ["TOTAL", "0 penerima", "0"]);
});

/* ------------------------------------------------------------------ */
/* Validasi & masking                                                  */
/* ------------------------------------------------------------------ */

check("validasi rekening: menolak yang tidak valid, menerima yang wajar", () => {
  assert.equal(validateBankAccount({ bankCode: "BCA", accountNumber: "123456", accountName: "Budi" }).ok, true);
  assert.equal(validateBankAccount({ bankCode: "bca", accountNumber: " 123 456 ", accountName: "Budi Santoso" }).ok, true);
  const kurang = validateBankAccount({ bankCode: "BCA", accountNumber: "12345", accountName: "Budi" });
  assert.equal(kurang.ok, false);
  const kepanjangan = validateBankAccount({
    bankCode: "BCA",
    accountNumber: "123456789012345678901",
    accountName: "Budi",
  });
  assert.equal(kepanjangan.ok, false);
  const huruf = validateBankAccount({ bankCode: "BCA", accountNumber: "12345a", accountName: "Budi" });
  assert.equal(huruf.ok, false);
  const namaAngka = validateBankAccount({ bankCode: "BCA", accountNumber: "1234567", accountName: "12345" });
  assert.equal(namaAngka.ok, false);
  const bankAsing = validateBankAccount({ bankCode: "ZZZ", accountNumber: "1234567", accountName: "Budi" });
  assert.equal(bankAsing.ok, false);
});

check("masking: hanya 4 digit terakhir tampil", () => {
  assert.equal(maskAccountNumber("1234567890"), "******7890");
  assert.equal(maskAccountNumber("123456"), "****3456");
  assert.equal(maskAccountNumber("1234"), "****");
  assert.equal(maskAccountNumber(null), "");
});

check("normalisasi: strip/titik/spasi dibuang, digit utuh", () => {
  assert.equal(normalizeAccountNumber("137-00-1234567-8"), "1370012345678");
  assert.equal(normalizeAccountNumber(" 123.456.7890 "), "1234567890");
});

check("rowsForFormat: penomoran ulang per berkas", () => {
  const bca = rowsForFormat(lengkap, "bca");
  assert.deepEqual(bca.map((row) => row.no), [1, 2]);
  assert.equal(rowsForFormat(lengkap, "generic").length, 3);
});

/* ------------------------------------------------------------------ */

console.log("\nContoh berkas BCA (kasus 1):");
const contoh = renderPayoutCsv({
  format: "bca",
  batch: lengkap,
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  exportDate: EXPORT_DATE,
});
console.log(`# ${contoh.filename}`);
console.log(contoh.content.replace(/^\uFEFF/, "").trimEnd());

console.log(
  failures === 0 ? "\nSemua cek payout lolos." : `\n${failures} cek payout gagal.`,
);
process.exit(failures === 0 ? 0 : 1);
