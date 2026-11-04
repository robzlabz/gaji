/**
 * Validasi tujuan redirect yang berasal dari query string (`next`, `backTo`).
 *
 * Nilai ini dikendalikan pengguna, jadi tidak boleh langsung dipakai sebagai
 * `window.location.href` atau `redirect()`. Awalan `/` saja tidak cukup:
 *
 * - `//evil.com`  → browser membacanya sebagai URL relatif-protokol ke domain lain.
 * - `/\evil.com`  → backslash dinormalisasi menjadi `/`, hasilnya sama.
 * - `\/evil.com`  → sama, diawali backslash.
 * - `/%0A/evil`   → karakter kontrol bisa memotong nilai di sebagian parser.
 *
 * Karena itu fungsi ini menolak semua bentuk di atas dan hanya meloloskan path
 * internal yang benar-benar diawali satu `/`.
 */
export function safeInternalPath(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  // `//host` dan `/\host` adalah domain lain bagi browser.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Backslash di posisi mana pun berisiko dinormalisasi menjadi `/`.
  if (value.includes("\\")) return fallback;
  // Karakter kontrol (termasuk newline) bisa memotong nilai di sebagian parser.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
