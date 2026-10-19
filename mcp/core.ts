/**
 * Inti server MCP "gaji": koneksi Postgres read-only + helper tenant/periode.
 *
 * Kenapa query langsung ke DB, bukan lewat HTTP API?
 * Aplikasi ini tidak punya REST API — semua mutasi lewat Next server action.
 * Untuk pemantauan (read-only) cara paling jujur adalah membaca tabel yang sama
 * dengan yang dipakai UI, jadi angka yang dilaporkan AI identik dengan dashboard.
 *
 * Semua query dijalankan di dalam transaksi `read only`, sehingga MCP ini tidak
 * mungkin mengubah data walaupun suatu saat ada tool baru yang salah tulis SQL.
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";
import { addDays, localDateString } from "../src/lib/format";
import { periodContaining, shiftPeriod, type Period } from "../src/lib/period";

/* ------------------------------------------------------------------ */
/* Env                                                                 */
/* ------------------------------------------------------------------ */

function loadEnv() {
  if (process.env.GAJI_DATABASE_URL || process.env.DATABASE_URL) return;
  // Dijalankan dari mana pun: cari .env di root aplikasi web (folder induk mcp/).
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  const root = path.resolve(here, "..");
  loadDotenv({ path: [path.join(root, ".env"), path.join(root, ".env.local")], quiet: true });
}

loadEnv();

const connectionString = process.env.GAJI_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL / GAJI_DATABASE_URL belum diset. Isi GAJI_DATABASE_URL untuk menunjuk DB lain (mis. produksi).",
  );
}

export const sql = postgres(connectionString, {
  max: 3,
  idle_timeout: 10,
  // Kolom `date` (work_date, period_start, …) dikembalikan apa adanya sebagai
  // "YYYY-MM-DD". Default postgres.js mengubahnya jadi Date tengah malam UTC,
  // yang bikin AI ragu apakah tanggalnya bergeser satu hari.
  types: {
    date: {
      to: 1082,
      from: [1082],
      serialize: (value: unknown) => String(value),
      parse: (value: string) => value,
    },
  },
  // Read-only MCP: jangan pernah menahan koneksi lama dan jangan biarkan satu
  // query menggantung sampai menutup pool.
  connection: { application_name: "gaji-mcp", statement_timeout: 20000 },
});

/** Jalankan satu SELECT di transaksi read-only. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await sql.begin("read only", async (tx) => {
    return tx.unsafe(text, params as never[]);
  });
  return rows as unknown as T[];
}

/** Satu baris pertama, atau null. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Tenant                                                             */
/* ------------------------------------------------------------------ */

export type Org = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  payPeriodStartDay: number;
  workingDaysPerMonth: number;
  overtimeMultiplier: number;
  contractAlertDays: number;
};

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  pay_period_start_day: number;
  working_days_per_month: number;
  overtime_multiplier: string | number;
  contract_alert_days: number;
};

function toOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    payPeriodStartDay: row.pay_period_start_day,
    workingDaysPerMonth: row.working_days_per_month,
    overtimeMultiplier: Number(row.overtime_multiplier),
    contractAlertDays: row.contract_alert_days,
  };
}

const ORG_COLUMNS = `id, name, slug, timezone, pay_period_start_day, working_days_per_month,
  overtime_multiplier, contract_alert_days`;

export async function listOrgs(): Promise<Org[]> {
  const rows = await query<OrgRow>(`select ${ORG_COLUMNS} from organizations order by name`);
  return rows.map(toOrg);
}

/**
 * Tentukan organisasi aktif dari argumen `org` (id, slug, atau nama).
 * Tanpa argumen: kalau hanya ada satu tenant, pakai itu; kalau lebih, minta dipilih
 * supaya AI tidak mencampur data dua perusahaan.
 */
export async function resolveOrg(ref?: string | null): Promise<Org> {
  const orgs = await listOrgs();

  if (orgs.length === 0) throw new Error("Belum ada organisasi di database ini.");
  if (!ref) {
    if (orgs.length === 1) return orgs[0];
    throw new Error(
      `Ada ${orgs.length} organisasi (${orgs.map((o) => o.slug).join(", ")}). Sebutkan parameter "org" (slug/nama/id).`,
    );
  }

  const needle = ref.trim().toLowerCase();
  const found = orgs.find(
    (o) => o.id === ref.trim() || o.slug.toLowerCase() === needle || o.name.toLowerCase() === needle,
  );
  if (found) return found;

  // Pencarian longgar: potongan nama ("kopi" → Kopi Senja).
  const partial = orgs.filter(
    (o) => o.slug.toLowerCase().includes(needle) || o.name.toLowerCase().includes(needle),
  );
  if (partial.length === 1) return partial[0];

  throw new Error(
    `Organisasi "${ref}" tidak ditemukan. Pilihan: ${orgs.map((o) => `${o.slug} (${o.name})`).join(", ")}.`,
  );
}

/* ------------------------------------------------------------------ */
/* Tanggal & periode                                                  */
/* ------------------------------------------------------------------ */

/** Tanggal "hari ini" menurut zona waktu organisasi (YYYY-MM-DD). */
export function todayIn(org: Org): string {
  return localDateString(new Date(), org.timezone);
}

export function currentPeriod(org: Org, date?: string): Period {
  return periodContaining(date ?? todayIn(org), org.payPeriodStartDay);
}

function endOfPeriodStarting(start: string): string {
  // Awal periode berikutnya dikurangi satu hari.
  return addDays(shiftPeriod(start, 1).start, -1);
}

export type ResolvedPeriod = {
  period: Period;
  /** Baris pay_periods kalau periode ini sudah pernah dibuat/dihitung. */
  id: string | null;
  status: string | null;
  payDate: string | null;
  isCurrent: boolean;
  label: string;
};

function label(period: Period): string {
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(`${s}T00:00:00`),
    );
  return `${fmt(period.start)} – ${fmt(period.end)}`;
}

/**
 * Periode yang dimaksud tool, dari salah satu argumen:
 * - `periodId`  : id baris pay_periods
 * - `periodStart`: tanggal mulai periode (YYYY-MM-DD)
 * - `date`      : tanggal di dalam periode
 * - kosong      : periode berjalan
 */
export async function resolvePeriod(
  org: Org,
  args: { periodId?: string | null; periodStart?: string | null; date?: string | null } = {},
): Promise<ResolvedPeriod> {
  const current = currentPeriod(org);

  if (args.periodId) {
    const row = await queryOne<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      pay_date: string | null;
    }>(
      `select id, period_start, period_end, status, pay_date
         from pay_periods where org_id = $1 and id = $2`,
      [org.id, args.periodId],
    );
    if (!row) throw new Error(`Pay period ${args.periodId} tidak ada di org ${org.slug}.`);
    const period = { start: row.period_start, end: row.period_end };
    return {
      period,
      id: row.id,
      status: row.status,
      payDate: row.pay_date,
      isCurrent: period.start === current.start,
      label: label(period),
    };
  }

  let period: Period;
  if (args.periodStart) {
    period = { start: args.periodStart, end: endOfPeriodStarting(args.periodStart) };
  } else if (args.date) {
    period = currentPeriod(org, args.date);
  } else {
    period = current;
  }

  const row = await queryOne<{ id: string; status: string; pay_date: string | null }>(
    `select id, status, pay_date from pay_periods where org_id = $1 and period_start = $2`,
    [org.id, period.start],
  );

  return {
    period,
    id: row?.id ?? null,
    status: row?.status ?? null,
    payDate: row?.pay_date ?? null,
    isCurrent: period.start === current.start,
    label: label(period),
  };
}

/* ------------------------------------------------------------------ */
/* Karyawan                                                           */
/* ------------------------------------------------------------------ */

/** Cari karyawan dari id, kode, atau potongan nama. Wajib unik dalam satu org. */
export async function resolveEmployee(
  org: Org,
  ref: string,
): Promise<{ id: string; fullName: string; code: string | null; payType: string }> {
  const rows = await query<{ id: string; full_name: string; code: string | null; pay_type: string }>(
    `select id, full_name, code, pay_type from employees where org_id = $1`,
    [org.id],
  );

  const needle = ref.trim().toLowerCase();
  const exact = rows.filter(
    (r) =>
      r.id === ref.trim() ||
      (r.code ?? "").toLowerCase() === needle ||
      r.full_name.toLowerCase() === needle,
  );
  const pool = exact.length ? exact : rows.filter((r) => r.full_name.toLowerCase().includes(needle));

  if (pool.length === 0) throw new Error(`Karyawan "${ref}" tidak ada di org ${org.slug}.`);
  if (pool.length > 1) {
    throw new Error(
      `"${ref}" cocok dengan ${pool.length} karyawan: ${pool.map((r) => r.full_name).join(", ")}. Pakai id atau nama lengkap.`,
    );
  }

  const found = pool[0];
  return { id: found.id, fullName: found.full_name, code: found.code, payType: found.pay_type };
}

/* ------------------------------------------------------------------ */
/* Util                                                               */
/* ------------------------------------------------------------------ */

export function round(n: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** Angka dari kolom numeric (postgres.js mengembalikan string). */
export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Bungkus payload JSON jadi hasil tool MCP. */
export function toolResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export function minutesBetween(from: Date | string, to: Date | string | null): number {
  if (!to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60_000));
}
