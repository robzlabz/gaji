/**
 * Cek penulisan sel CSV tanpa database.
 *
 * Jalankan: npx tsx scripts/check-csv.ts
 *
 * Yang dibuktikan:
 * 1. Teks biasa dan sel kosong ditulis apa adanya.
 * 2. Angka bertipe number ditulis apa adanya, termasuk yang negatif.
 * 3. Teks berawalan karakter pemicu formula diberi awalan apostrof.
 * 4. Teks berisi koma atau kutip tetap di-quote dan kutipnya digandakan.
 */
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/csv";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  let ok = true;
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    ok = false;
    failures += 1;
  }
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`);
}

/* 1. teks biasa ------------------------------------------------------------ */
check("teks biasa", csvCell("Budi"), "Budi");
check("sel kosong", csvCell(null), "");
check("sel undefined", csvCell(undefined), "");
check("teks kosong", csvCell(""), "");

/* 2. angka ---------------------------------------------------------------- */
check("angka bulat", csvCell(25_000), "25000");
check("angka negatif", csvCell(-25_000), "-25000");
check("angka nol", csvCell(0), "0");

/* 3. awalan pemicu formula ------------------------------------------------ */
check("teks berawalan =", csvCell("=1+1"), "'=1+1");
check("teks berawalan -", csvCell("-10"), "'-10");
check("teks berawalan @", csvCell("@SUM(A1)"), "'@SUM(A1)");
check("teks berawalan +", csvCell("+62 812"), "'+62 812");
check("teks berawalan tab", csvCell("\tBudi"), "'\tBudi");
check("teks berawalan carriage return", csvCell("\rBudi"), "\"'\rBudi\"");

/* 4. quoting -------------------------------------------------------------- */
check("teks berisi koma", csvCell("Budi, S.T."), '"Budi, S.T."');
check("teks berisi kutip", csvCell('Budi "Bud"'), '"Budi ""Bud"""');
check("pemicu formula + koma", csvCell("=1,2"), "\"'=1,2\"");
check("teks berisi baris baru", csvCell("baris 1\nbaris 2"), '"baris 1\nbaris 2"');

console.log(
  failures === 0
    ? "\nSemua cek CSV lolos."
    : `\n${failures} cek gagal.`,
);
process.exit(failures === 0 ? 0 : 1);
