/**
 * Kelola API key MCP dari terminal (tanpa buka browser).
 *
 *   npm run mcp:key                                   # daftar semua kunci
 *   npm run mcp:key -- list --org gaji-demo
 *   npm run mcp:key -- create --org gaji-demo --name "Claude Desktop"
 *   npm run mcp:key -- revoke --id <uuid-kunci>
 *
 * `--org` menerima slug, nama, atau id organisasi. Tanpa `--org`, perintah
 * `create` memakai organisasi pertama yang ada di database.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { mcpApiKeys, organizations } from "../src/db/schema";
import { decryptToken } from "../mcp/keys";
import { createKey, revokeKey } from "../mcp/keys-store";

type Args = Record<string, string | undefined>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = "list", ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = "";
    }
  }
  return { command, args };
}

async function resolveOrgRef(ref?: string) {
  const orgs = await db.select().from(organizations);
  if (orgs.length === 0) throw new Error("Belum ada organisasi di database ini.");
  if (!ref) return orgs[0];

  const needle = ref.trim().toLowerCase();
  const found = orgs.find(
    (org) =>
      org.id === ref.trim() ||
      org.slug.toLowerCase() === needle ||
      org.name.toLowerCase() === needle,
  );
  if (!found) {
    throw new Error(`Org "${ref}" tidak ada. Pilihan: ${orgs.map((o) => o.slug).join(", ")}`);
  }
  return found;
}

function fmt(value: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(value);
}

async function list(orgRef?: string) {
  const orgs = orgRef ? [await resolveOrgRef(orgRef)] : await db.select().from(organizations);

  for (const org of orgs) {
    const rows = await db.select().from(mcpApiKeys).where(eq(mcpApiKeys.orgId, org.id));
    console.log(`\n${org.name} (${org.slug}) — ${rows.length} kunci`);
    if (rows.length === 0) {
      console.log("  (belum ada; buat dengan: npm run mcp:key -- create --org " + org.slug + ")");
      continue;
    }
    for (const row of rows) {
      const status = row.revokedAt ? "dicabut" : "aktif";
      console.log(`  ${row.tokenPrefix}…  ${row.name}  [${status}]`);
      console.log(`    id         : ${row.id}`);
      console.log(`    dibuat     : ${fmt(row.createdAt)}`);
      console.log(`    dipakai    : ${fmt(row.lastUsedAt)}`);
      if (!row.revokedAt) {
        const token = decryptToken(row.tokenCipher);
        console.log(`    token      : ${token ?? "(tidak bisa dibuka — BETTER_AUTH_SECRET berubah)"}`);
      }
    }
  }
}

async function create(args: Args) {
  const org = await resolveOrgRef(args.org);
  const { id, token } = await createKey({ orgId: org.id, name: args.name || "MCP" });
  console.log(`Kunci dibuat untuk ${org.name} (${org.slug})`);
  console.log(`  id    : ${id}`);
  console.log(`  token : ${token}`);
  console.log(`\nConnection URL:`);
  console.log(`  ${args.url ?? "http://localhost:3000"}/api/mcp?key=${token}`);
}

async function revoke(args: Args) {
  if (!args.id) throw new Error("Butuh --id <uuid-kunci> (lihat `npm run mcp:key`).");
  const rows = await db
    .select({ orgId: mcpApiKeys.orgId, name: mcpApiKeys.name })
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.id, args.id));

  if (rows.length === 0) throw new Error(`Kunci ${args.id} tidak ada.`);
  const revoked = await revokeKey(rows[0].orgId, args.id);
  console.log(revoked ? `Kunci "${rows[0].name}" dicabut.` : "Kunci sudah dicabut sebelumnya.");
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  try {
    if (command === "list") await list(args.org);
    else if (command === "create") await create(args);
    else if (command === "revoke") await revoke(args);
    else {
      console.error(`Perintah "${command}" tidak dikenal. Pakai: list | create | revoke`);
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end({ timeout: 3 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
