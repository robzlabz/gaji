/**
 * Guard konsistensi journal migrasi Drizzle — tanpa database.
 *
 * Jalankan: npx tsx scripts/check-migrasi.ts
 *
 * Latar belakang (issue #91): enam PR terbuka sama-sama membuat migrasi bernomor
 * `0004_*` dan masing-masing menulis `"idx": 4` di `drizzle/meta/_journal.json`
 * serta menimpa `drizzle/meta/0004_snapshot.json`. Merge dua di antaranya membuat
 * journal tidak lagi cocok dengan berkas SQL, dan `drizzle-kit generate` berikutnya
 * memuntahkan migrasi destruktif. Kerusakan itu baru terlihat saat deploy, bukan
 * saat review — jadi pemeriksaannya harus otomatis dan murah.
 *
 * Yang diperiksa:
 * 1. Setiap berkas `drizzle/*.sql` punya entri journal dengan `tag` yang sama.
 * 2. Setiap entri journal punya berkas SQL-nya.
 * 3. `idx` di journal unik dan berurutan mulai 0.
 * 4. Nomor pada `tag` sama dengan `idx` (mis. `0004_*` wajib `idx: 4`).
 * 5. Setiap entri journal punya `drizzle/meta/000N_snapshot.json`.
 * 6. Tidak ada snapshot yatim tanpa entri journal.
 * 7. Tidak ada dua berkas SQL dengan nomor awalan sama (kasus #91).
 *
 * Keluar dengan kode 1 bila ada satu saja pelanggaran, supaya bisa dipakai di CI.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRIZZLE_DIR = "drizzle";
const META_DIR = join(DRIZZLE_DIR, "meta");
const JOURNAL_PATH = join(META_DIR, "_journal.json");

type JournalEntry = {
  idx: number;
  version?: string;
  when?: number;
  tag: string;
  breakpoints?: boolean;
};

type Journal = {
  version?: string;
  dialect?: string;
  entries?: JournalEntry[];
};

let failures = 0;
let passes = 0;

function ok(message: string) {
  passes += 1;
  console.log(`✓ ${message}`);
}

function fail(message: string) {
  failures += 1;
  console.log(`✗ ${message}`);
}

/** Nomor awalan pada nama berkas, mis. `0004_pajak.sql` -> 4. */
function numericPrefix(name: string): number | null {
  const match = /^(\d{4})_/.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

function snapshotName(idx: number): string {
  return `${String(idx).padStart(4, "0")}_snapshot.json`;
}

function main() {
  if (!existsSync(JOURNAL_PATH)) {
    console.log(`✗ ${JOURNAL_PATH} tidak ditemukan.`);
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
  const entries = journal.entries ?? [];

  if (!Array.isArray(journal.entries)) {
    console.log("✗ `_journal.json` tidak punya array `entries`.");
    process.exit(1);
  }

  // 1. Berkas SQL di drizzle/ (bukan di meta/).
  const sqlFiles = readdirSync(DRIZZLE_DIR, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".sql"))
    .map((item) => item.name)
    .sort();

  const tags = new Set(entries.map((entry) => entry.tag));

  // 2. Setiap berkas SQL punya entri journal.
  const unregistered: string[] = [];
  for (const file of sqlFiles) {
    const tag = file.replace(/\.sql$/, "");
    if (!tags.has(tag)) unregistered.push(file);
  }
  if (unregistered.length === 0) {
    ok(`${sqlFiles.length} berkas SQL semuanya terdaftar di journal`);
  } else {
    fail(
      `${unregistered.length} berkas SQL belum terdaftar di journal: ${unregistered.join(", ")} ` +
        "(jalankan `npm run db:generate` atau tambahkan entri manual)",
    );
  }

  // 3. Setiap entri journal punya berkas SQL-nya.
  const missingSql: string[] = [];
  for (const entry of entries) {
    if (!sqlFiles.includes(`${entry.tag}.sql`)) missingSql.push(entry.tag);
  }
  if (missingSql.length === 0) {
    ok("setiap entri journal punya berkas SQL");
  } else {
    fail(`entri journal tanpa berkas SQL: ${missingSql.join(", ")}`);
  }

  // 4. idx unik, berurutan mulai 0.
  const idxList = entries.map((entry) => entry.idx);
  const uniqueIdx = new Set(idxList);
  if (uniqueIdx.size !== idxList.length) {
    const sorted = [...idxList].sort((a, b) => a - b);
    const dupes = sorted.filter((value, index) => index > 0 && sorted[index - 1] === value);
    fail(`ada \`idx\` ganda di journal: ${[...new Set(dupes)].join(", ")} — dua migrasi berebut slot yang sama (#91)`);
  } else {
    ok(`semua \`idx\` unik (${idxList.length} entri)`);
  }

  const sortedIdx = [...uniqueIdx].sort((a, b) => a - b);
  const contiguous = sortedIdx.every((value, index) => value === index);
  if (contiguous) {
    ok("`idx` berurutan mulai 0 tanpa lompatan");
  } else {
    const missing: number[] = [];
    for (let i = 0; i <= sortedIdx[sortedIdx.length - 1]; i += 1) {
      if (!uniqueIdx.has(i)) missing.push(i);
    }
    fail(`\`idx\` tidak berurutan — nomor hilang: ${missing.join(", ")}`);
  }

  // 5. Nomor pada tag sama dengan idx.
  const tagMismatch: string[] = [];
  for (const entry of entries) {
    const prefix = numericPrefix(entry.tag);
    if (prefix === null) {
      tagMismatch.push(`${entry.tag} (nama tidak berawalan 4 digit)`);
    } else if (prefix !== entry.idx) {
      tagMismatch.push(`${entry.tag} punya idx ${entry.idx}, seharusnya ${prefix}`);
    }
  }
  if (tagMismatch.length === 0) {
    ok("nomor pada `tag` cocok dengan `idx`");
  } else {
    fail(`tag tidak cocok dengan idx: ${tagMismatch.join("; ")}`);
  }

  // 6. Snapshot untuk setiap entri journal.
  const missingSnapshot: string[] = [];
  for (const entry of entries) {
    const file = snapshotName(entry.idx);
    if (!existsSync(join(META_DIR, file))) missingSnapshot.push(file);
  }
  if (missingSnapshot.length === 0) {
    ok("setiap entri journal punya snapshot");
  } else {
    fail(
      `snapshot hilang: ${missingSnapshot.join(", ")} — ` +
        "`drizzle-kit generate` berikutnya akan salah menghitung diff (F11)",
    );
  }

  // 7. Snapshot yatim (ada berkas, tidak ada entri journal).
  const snapshotFiles = readdirSync(META_DIR)
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  const orphanSnapshot: string[] = [];
  for (const file of snapshotFiles) {
    const idx = Number.parseInt(file.slice(0, 4), 10);
    if (!uniqueIdx.has(idx)) orphanSnapshot.push(file);
  }
  if (orphanSnapshot.length === 0) {
    ok("tidak ada snapshot yatim");
  } else {
    fail(`snapshot tanpa entri journal: ${orphanSnapshot.join(", ")}`);
  }

  // 8. Dua berkas SQL dengan nomor sama — inti masalah #91.
  const byPrefix = new Map<number, string[]>();
  for (const file of sqlFiles) {
    const prefix = numericPrefix(file);
    if (prefix === null) continue;
    const list = byPrefix.get(prefix) ?? [];
    list.push(file);
    byPrefix.set(prefix, list);
  }
  const collisions = [...byPrefix.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length === 0) {
    ok("tidak ada nomor migrasi yang dipakai dua kali");
  } else {
    for (const [prefix, list] of collisions) {
      fail(
        `nomor migrasi ${String(prefix).padStart(4, "0")} dipakai ${list.length} berkas: ` +
          `${list.join(", ")} — runner menjalankan keduanya, tetapi snapshot hanya satu (#91)`,
      );
    }
  }

  console.log("");
  if (failures === 0) {
    console.log(`Semua cek migrasi lolos (${passes} lulus).`);
  } else {
    console.log(`${failures} cek migrasi gagal.`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();