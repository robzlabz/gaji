/**
 * Bantuan penulisan CSV.
 *
 * Angka ditulis apa adanya (termasuk nilai negatif). Teks yang diawali
 * karakter pemicu formula diberi awalan apostrof agar spreadsheet
 * membacanya sebagai teks, lalu di-quote mengikuti aturan CSV yang sama
 * dengan sel lain.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (typeof value === "number") return String(value);

  let text = value === null || value === undefined ? "" : value;
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;

  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
