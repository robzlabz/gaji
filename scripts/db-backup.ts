/**
 * Backup logis database Gaji tanpa `pg_dump`.
 *
 * Kenapa ada: server produksi tidak selalu menyediakan binary Postgres, dan
 * sebelum migrasi dijalankan kita butuh salinan yang bisa dipulihkan. Skrip ini
 * membaca katalog Postgres lalu menulis:
 *
 *   <outDir>/manifest.json      daftar tabel, jumlah baris, hash isi, versi server
 *   <outDir>/schema.json        statement DDL: enum, sequence, tabel, index, constraint
 *   <outDir>/data/<tabel>.ndjson satu baris JSON per baris tabel
 *
 * Pemakaian:
 *   DATABASE_URL=postgres://... bun scripts/db-backup.ts .backup/2026-11-01
 *
 * Urutan pemulihan (lihat scripts/db-restore.ts) sengaja dipisah:
 *   1. enum, sequence, tabel (tanpa foreign key), primary/unique/check, index
 *   2. data
 *   3. foreign key — supaya urutan tabel saat memuat data tidak jadi masalah
 *   4. setval sequence
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[backup] DATABASE_URL belum di-set");
  process.exit(1);
}

const outDir = process.argv[2] ?? `.backup/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
const sql = postgres(url, { max: 1, onnotice: () => {} });

// Hash isi tabel memakai cast `::text`, yang untuk timestamptz bergantung pada
// zona waktu sesi. Backup dan restore wajib memakai zona yang sama, kalau tidak
// verifikasi akan gagal walau datanya benar.
await sql`set timezone = 'UTC'`;
await sql`set datestyle = 'ISO, MDY'`;

/** Postgres membatasi identifier 63 byte; kutip agar aman untuk nama apa pun. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function qualified(table: string): string {
  return `public.${ident(table)}`;
}

type ColumnRow = {
  table_name: string;
  column_name: string;
  type: string;
  not_null: boolean;
  default_expr: string | null;
  identity: string;
  generated: string;
};

type ConstraintRow = {
  table_name: string;
  constraint_name: string;
  type: string;
  definition: string;
};

async function main() {
  await mkdir(path.join(outDir, "data"), { recursive: true });

  const [{ version }] = await sql<{ version: string }[]>`select version()`;

  const enums = await sql<{ name: string; labels: string }[]>`
    select t.typname as name,
           string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname
  `;

  const sequenceNames = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
    order by c.relname
  `;

  // `is_called` hanya bisa dibaca dari relasi sequence-nya, bukan dari pg_sequences.
  const sequences: { name: string; last_value: string | null; is_called: boolean }[] = [];
  for (const seq of sequenceNames) {
    const [row] = await sql.unsafe<{ last_value: string | null; is_called: boolean }[]>(
      `select last_value::text as last_value, is_called from public.${ident(seq.name)}`,
    );
    if (row) {
      sequences.push({ name: seq.name, last_value: row.last_value, is_called: row.is_called });
    }
  }

  const tables = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `;

  if (tables.length === 0) {
    console.error("[backup] tidak ada tabel di schema public — periksa DATABASE_URL");
    process.exit(2);
  }

  const columns = await sql<ColumnRow[]>`
    select c.relname as table_name,
           a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as not_null,
           pg_get_expr(d.adbin, d.adrelid) as default_expr,
           a.attidentity as identity,
           a.attgenerated as generated
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum
  `;

  const constraints = await sql<ConstraintRow[]>`
    select c.relname as table_name,
           con.conname as constraint_name,
           con.contype as type,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and con.contype in ('p', 'u', 'c', 'f')
    order by c.relname, con.contype, con.conname
  `;

  // Index yang tidak lahir dari constraint (constraint sudah membawa index-nya sendiri).
  const indexes = await sql<{ table_name: string; index_name: string; definition: string }[]>`
    select t.relname as table_name,
           i.relname as index_name,
           pg_get_indexdef(x.indexrelid) as definition
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_constraint con
        where con.conindid = x.indexrelid and con.contype in ('p', 'u', 'x')
      )
    order by t.relname, i.relname
  `;

  const pre: string[] = [];
  const post: string[] = [];
  const fks: string[] = [];

  for (const e of enums) {
    pre.push(`do $$ begin
  create type public.${ident(e.name)} as enum (${e.labels});
exception when duplicate_object then null;
end $$`);
  }

  for (const s of sequences) {
    pre.push(`create sequence if not exists public.${ident(s.name)}`);
  }

  for (const t of tables) {
    const cols = columns.filter((c) => c.table_name === t.name);
    const body = cols.map((c) => {
      let def = `  ${ident(c.column_name)} ${c.type}`;
      if (c.generated === "s" && c.default_expr) {
        // Kolom generated selalu: dipulihkan sebagai biasa + dihitung ulang, jadi
        // nilainya tidak ikut dimuat.
        def += ` generated always as (${c.default_expr}) stored`;
        return def;
      }
      if (c.identity === "a") def += " generated always as identity";
      else if (c.identity === "d") def += " generated by default as identity";
      if (!c.identity && c.default_expr) def += ` default ${c.default_expr}`;
      if (c.not_null) def += " not null";
      return def;
    });
    pre.push(`create table if not exists ${qualified(t.name)} (\n${body.join(",\n")}\n)`);
  }

  for (const c of constraints) {
    if (c.type === "f") {
      // Foreign key dipasang setelah data dimuat.
      fks.push(
        `alter table ${qualified(c.table_name)} add constraint ${ident(c.constraint_name)} ${c.definition}`,
      );
      continue;
    }
    post.push(
      `alter table ${qualified(c.table_name)} add constraint ${ident(c.constraint_name)} ${c.definition}`,
    );
  }

  for (const i of indexes) {
    post.push(i.definition);
  }

  const manifestTables: {
    name: string;
    rows: number;
    hash: string;
    file: string;
    hasGenerated: boolean;
  }[] = [];

  for (const t of tables) {
    const cols = columns.filter((c) => c.table_name === t.name);
    const hasGenerated = cols.some((c) => c.generated === "s");

    // Hash dihitung di server supaya tidak bergantung pada serialisasi JS.
    const [{ count, hash }] = await sql<{ count: string; hash: string }[]>`
      select count(*)::text as count,
             coalesce(md5(string_agg(x::text, E'\n' order by x::text)), '') as hash
      from ${sql.unsafe(qualified(t.name))} x
    `;

    const rows = await sql.unsafe(`select row_to_json(x)::text as line from ${qualified(t.name)} x`);
    const file = `data/${t.name}.ndjson`;
    await writeFile(path.join(outDir, file), `${rows.map((r) => r.line).join("\n")}\n`, "utf8");

    manifestTables.push({
      name: t.name,
      rows: Number(count),
      hash,
      file,
      hasGenerated,
    });

    console.log(`[backup] ${t.name}: ${count} baris`);
  }

  const manifest = {
    app: "gaji",
    createdAt: new Date().toISOString(),
    serverVersion: version,
    tables: manifestTables,
    sequences: sequences.map((s) => ({
      name: s.name,
      lastValue: s.last_value === null ? null : s.last_value,
      isCalled: s.is_called,
    })),
  };

  const schema = { statements: [...pre, ...post], foreignKeys: fks, generatedColumns: "lihat manifest.tables[].hasGenerated" };

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "schema.json"), `${JSON.stringify(schema, null, 2)}\n`, "utf8");

  const totalRows = manifestTables.reduce((sum, t) => sum + t.rows, 0);
  const fingerprint = createHash("sha256")
    .update(manifestTables.map((t) => `${t.name}:${t.rows}:${t.hash}`).join("|"))
    .digest("hex")
    .slice(0, 16);

  console.log(
    `[backup] selesai: ${manifestTables.length} tabel, ${totalRows} baris, sidik jari ${fingerprint} → ${outDir}`,
  );

  await sql.end();
}

await main();
