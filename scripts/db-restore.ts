/**
 * Memulihkan backup yang dibuat `scripts/db-backup.ts` ke database kosong.
 *
 * Pemakaian:
 *   DATABASE_URL=postgres://... bun scripts/db-restore.ts .backup/2026-11-01
 *
 * Skrip menolak menulis ke database yang sudah berisi tabel kecuali diberi
 * `--force`, supaya tidak menimpa database produksi secara tidak sengaja.
 *
 * Setelah selesai, setiap tabel dihitung ulang jumlah baris dan hash isinya
 * (md5 dari baris yang diurutkan) lalu dibandingkan dengan manifest. Perbedaan
 * apa pun membuat proses keluar dengan kode 1 — backup yang tidak terverifikasi
 * tidak boleh dianggap backup.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[restore] DATABASE_URL belum di-set");
  process.exit(1);
}

const dir = process.argv[2];
const force = process.argv.includes("--force");
if (!dir) {
  console.error("[restore] pakai: bun scripts/db-restore.ts <direktori-backup> [--force]");
  process.exit(1);
}

type Manifest = {
  createdAt: string;
  serverVersion: string;
  tables: { name: string; rows: number; hash: string; file: string }[];
  sequences: { name: string; lastValue: string | null; isCalled: boolean }[];
};

type Schema = { statements: string[]; foreignKeys: string[] };

const sql = postgres(url, { max: 1, onnotice: () => {} });

// Hash isi tabel memakai cast `::text`, yang untuk timestamptz bergantung pada
// zona waktu sesi. Backup dan restore wajib memakai zona yang sama.
await sql`set timezone = 'UTC'`;
await sql`set datestyle = 'ISO, MDY'`;

function qualified(table: string): string {
  return `public."${table.replace(/"/g, '""')}"`;
}

async function main() {
  const manifest: Manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  const schema: Schema = JSON.parse(await readFile(path.join(dir, "schema.json"), "utf8"));

  const [{ count: existing }] = await sql<{ count: string }[]>`
    select count(*)::text as count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  `;
  if (Number(existing) > 0 && !force) {
    console.error(
      `[restore] database tujuan sudah punya ${existing} tabel. Jalankan dengan --force bila memang ingin menimpa.`,
    );
    process.exit(2);
  }

  console.log(`[restore] memulihkan backup ${manifest.createdAt} (${manifest.tables.length} tabel)`);

  for (const statement of schema.statements) {
    await sql.unsafe(statement);
  }
  console.log(`[restore] skema: ${schema.statements.length} statement`);

  let loaded = 0;
  for (const table of manifest.tables) {
    const raw = await readFile(path.join(dir, table.file), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    const rows = lines.map((line) => JSON.parse(line));

    // Kolom generated tidak boleh ditulis; kolom identity ditulis dengan
    // OVERRIDING SYSTEM VALUE supaya id asli tetap sama.
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${table.name} and is_generated = 'NEVER'
      order by ordinal_position
    `;
    const list = columns.map((c) => `"${c.column_name.replace(/"/g, '""')}"`).join(", ");

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      // JSON dikirim sebagai literal dollar-quoted, bukan parameter: driver
      // meng-encode parameter string sebagai JSON lagi sehingga
      // json_populate_recordset menerima skalar, bukan array.
      const text = JSON.stringify(chunk);
      let tag = `$j${Math.random().toString(36).slice(2, 12)}$`;
      while (text.includes(tag)) tag = `$j${Math.random().toString(36).slice(2, 12)}$`;
      await sql.unsafe(
        `insert into ${qualified(table.name)} (${list}) overriding system value ` +
          `select ${list} from json_populate_recordset(null::${qualified(table.name)}, ${tag}${text}${tag}::json)`,
      );
    }
    loaded += rows.length;
  }
  console.log(`[restore] data: ${loaded} baris dimuat`);

  // Foreign key dipasang setelah data, jadi urutan tabel tidak jadi masalah.
  for (const statement of schema.foreignKeys) {
    await sql.unsafe(statement);
  }
  if (schema.foreignKeys.length > 0) {
    console.log(`[restore] foreign key: ${schema.foreignKeys.length} constraint`);
  }

  for (const seq of manifest.sequences) {
    if (seq.lastValue === null) continue;
    await sql.unsafe(`select setval('public."${seq.name}"', $1, $2)`, [seq.lastValue, seq.isCalled]);
  }

  // Verifikasi: jumlah baris dan hash isi harus identik dengan saat backup.
  const problems: string[] = [];
  for (const table of manifest.tables) {
    const [{ count, hash }] = await sql<{ count: string; hash: string }[]>`
      select count(*)::text as count,
             coalesce(md5(string_agg(x::text, E'\n' order by x::text)), '') as hash
      from ${sql.unsafe(qualified(table.name))} x
    `;
    if (Number(count) !== table.rows) {
      problems.push(`${table.name}: ${count} baris, seharusnya ${table.rows}`);
    } else if (hash !== table.hash) {
      problems.push(`${table.name}: jumlah baris sama tetapi isi berbeda (hash tidak cocok)`);
    }
  }

  if (problems.length > 0) {
    console.error("[restore] GAGAL verifikasi:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `[restore] terverifikasi: ${manifest.tables.length} tabel, ${loaded} baris, hash cocok semua`,
  );
  console.log(`[restore] sumber backup: ${manifest.createdAt} · ${manifest.serverVersion.split(",")[0]}`);

  await sql.end();
}

await main();
