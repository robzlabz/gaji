/**
 * Cek keamanan tujuan redirect (`next` / `backTo`) tanpa database.
 *
 * Jalankan: npx tsx scripts/check-nav.ts
 *
 * Latar belakang: issue #65. `PinForm` dulu mengarahkan browser ke `next` bila
 * nilainya diawali "/". Pengecekan itu meloloskan URL relatif-protokol, yang
 * oleh browser dibaca sebagai domain lain — jadi tautan login bisa melempar
 * pengguna ke situs luar tepat setelah mereka memasukkan PIN (open redirect).
 *
 * Yang dibuktikan:
 * 1. Path internal yang wajar tetap lolos apa adanya.
 * 2. `//host` dan `/\host` ditolak (bentuk yang lolos cek `startsWith("/")`).
 * 3. Backslash di posisi mana pun ditolak.
 * 4. Karakter kontrol ditolak.
 * 5. Nilai kosong / tidak ada memakai fallback.
 */
import { safeInternalPath } from "../src/lib/nav";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`,
  );
}

const FALLBACK = "/admin";

/* 1. path internal yang sah ------------------------------------------------- */
check("path internal lolos", safeInternalPath("/admin/karyawan", FALLBACK), "/admin/karyawan");
check("root lolos", safeInternalPath("/", FALLBACK), "/");
check("dengan query string", safeInternalPath("/admin/cuti?ok=1&err=2", FALLBACK), "/admin/cuti?ok=1&err=2");
check("dengan hash", safeInternalPath("/admin#bagian", FALLBACK), "/admin#bagian");
check("path dinamis", safeInternalPath("/employee/slip/abc-123", FALLBACK), "/employee/slip/abc-123");
check("hanya satu slash di depan", safeInternalPath("/admin/", FALLBACK), "/admin/");

/* 2. URL relatif-protokol --------------------------------------------------- */
check("//domain luar ditolak", safeInternalPath("//evil.example", FALLBACK), FALLBACK);
check("//domain luar dengan path", safeInternalPath("//evil.example/login", FALLBACK), FALLBACK);
check("/\\domain luar ditolak", safeInternalPath("/\\evil.example", FALLBACK), FALLBACK);
check("/\\ dengan path", safeInternalPath("/\\/evil.example/x", FALLBACK), FALLBACK);

/* 3. skema eksplisit & path relatif ----------------------------------------- */
check("http:// absolut ditolak", safeInternalPath("http://evil.example", FALLBACK), FALLBACK);
check("https:// absolut ditolak", safeInternalPath("https://evil.example", FALLBACK), FALLBACK);
check("javascript: ditolak", safeInternalPath("javascript:alert(1)", FALLBACK), FALLBACK);
check("data: ditolak", safeInternalPath("data:text/html,<script>", FALLBACK), FALLBACK);
check("relatif tanpa slash ditolak", safeInternalPath("admin/karyawan", FALLBACK), FALLBACK);
check("titik-titik relatif ditolak", safeInternalPath("../admin", FALLBACK), FALLBACK);

/* 4. backslash & karakter kontrol ------------------------------------------ */
check("backslash di tengah ditolak", safeInternalPath("/admin\\..\\evil", FALLBACK), FALLBACK);
check("backslash di akhir ditolak", safeInternalPath("/admin\\", FALLBACK), FALLBACK);
check("newline ditolak", safeInternalPath("/admin\n/evil", FALLBACK), FALLBACK);
check("tab ditolak", safeInternalPath("/admin\tevil", FALLBACK), FALLBACK);
check("NUL ditolak", safeInternalPath("/admin\u0000evil", FALLBACK), FALLBACK);

/* 5. fallback --------------------------------------------------------------- */
check("undefined -> fallback", safeInternalPath(undefined, FALLBACK), FALLBACK);
check("null -> fallback", safeInternalPath(null, FALLBACK), FALLBACK);
check("string kosong -> fallback", safeInternalPath("", FALLBACK), FALLBACK);
check("fallback ikut dipakai untuk nilai berbahaya", safeInternalPath("//evil", "/login"), "/login");

if (failures > 0) {
  console.error(`\n${failures} cek gagal.`);
  process.exit(1);
}
console.log("\nSemua cek tujuan redirect lolos.");
