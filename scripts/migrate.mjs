/**
 * Menjalankan migrasi SQL Drizzle sebelum aplikasi start.
 * Dipanggil dari Dockerfile: `node scripts/migrate.mjs && node server.js`.
 *
 * File migrasi dihasilkan oleh `npm run db:generate` (drizzle-kit generate)
 * dan di-commit ke folder `drizzle/`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL belum di-set");
  process.exit(1);
}

const dir = path.join(process.cwd(), "drizzle");
const sql = postgres(url, { max: 1, onnotice: () => {} });

let applied = 0;
try {
  await sql`
    create table if not exists app_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.warn(`[migrate] folder ${dir} tidak ada, tidak ada migrasi yang dijalankan`);
  }

  for (const file of files) {
    const [done] = await sql`select 1 from app_migrations where name = ${file}`;
    if (done) continue;

    const content = await readFile(path.join(dir, file), "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`insert into app_migrations (name) values (${file})`;
    });

    applied += 1;
    console.log(`[migrate] applied ${file} (${statements.length} statements)`);
  }

  console.log(`[migrate] selesai, ${applied} migrasi baru`);
} catch (error) {
  console.error("[migrate] gagal:", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
