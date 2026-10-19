/**
 * Smoke test transport Streamable HTTP: menyambung ke `<app>/api/mcp` seperti client
 * MCP sungguhan (ChatGPT/Claude/Cursor), lalu memanggil tool lewat HTTP.
 *
 * Jalankan (server harus hidup):
 *   npm run mcp:smoke:http -- --port 3001        # kunci dibuat otomatis dari DB
 *   npm run mcp:smoke:http -- --port 3001 --key gk_…
 *
 * Tanpa --key, script membuat kunci baru sendiri lewat DB (butuh DATABASE_URL) supaya
 * bisa dipakai sebagai cek cepat setelah deploy lokal.
 *
 * Yang diuji:
 * 1. token salah → 401 (server menolak sebelum menyentuh data);
 * 2. handshake initialize + tools/list lewat HTTP;
 * 3. beberapa tool call nyata;
 * 4. API key hanya melihat organisasinya sendiri.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Args = Record<string, string | undefined>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = "";
    }
  }
  return args;
}

function textOf(reply: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  return reply.content?.find((part) => part.type === "text")?.text ?? "";
}

function preview(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port ?? process.env.MCP_PORT ?? "3000";
  const url = args.url ?? process.env.MCP_URL ?? `http://localhost:${port}/api/mcp`;
  let token = args.key ?? process.env.MCP_KEY;
  let temporary: { keyId: string; orgId: string } | null = null;

  if (!token) {
    // Bikin kunci sementara langsung di DB (hanya untuk uji lokal).
    const { createKey } = await import("./keys-store");
    const { db } = await import("../src/db");
    const { organizations } = await import("../src/db/schema");
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) throw new Error("Belum ada organisasi di database ini.");
    const created = await createKey({ orgId: org.id, name: "smoke-http" });
    token = created.token;
    temporary = { keyId: created.id, orgId: org.id };
    console.log(`(kunci sementara dibuat untuk ${org.slug}: ${token.slice(0, 11)}…)`);
  }

  const endpoint = new URL(url);
  let failures = 0;

  // 1. Token salah harus ditolak.
  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer gk_salah" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const rejected = unauthorized.status === 401;
  console.log(`${rejected ? "OK  " : "FAIL"} token salah ditolak (status ${unauthorized.status})`);
  if (!rejected) failures++;

  // 2. Sambung seperti client MCP biasa.
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "gaji-mcp-smoke-http", version: "1.0.0" });
  await client.connect(transport);
  console.log("OK   handshake initialize lewat HTTP");

  const { tools } = await client.listTools();
  console.log(`OK   tools/list → ${tools.length} tool`);

  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "gaji_list_orgs", arguments: {} },
    { name: "gaji_overview", arguments: {} },
    { name: "gaji_attendance_live", arguments: {} },
    { name: "gaji_pending_approvals", arguments: {} },
    { name: "gaji_query", arguments: { sql: "select count(*)::int as employees from employees" } },
  ];

  for (const call of calls) {
    try {
      const reply = await client.callTool(call);
      const text = textOf(reply as { content?: Array<{ type: string; text?: string }> });
      const isError = (reply as { isError?: boolean }).isError === true;
      console.log(`${isError ? "FAIL" : "OK  "} ${call.name} → ${preview(text)}`);
      if (isError) failures++;
    } catch (error) {
      failures++;
      console.log(`FAIL ${call.name} → ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Scope tenant: kunci hanya boleh melihat satu organisasi.
  const orgsReply = await client.callTool({ name: "gaji_list_orgs", arguments: {} });
  const orgsText = textOf(orgsReply as { content?: Array<{ type: string; text?: string }> });
  let orgCount = -1;
  try {
    const parsed = JSON.parse(orgsText) as { orgs?: unknown[] } | unknown[];
    orgCount = Array.isArray(parsed) ? parsed.length : (parsed.orgs?.length ?? -1);
  } catch {
    // biarkan -1 → dianggap gagal di bawah
  }
  const scoped = orgCount === 1;
  console.log(`${scoped ? "OK  " : "FAIL"} kunci hanya melihat ${orgCount} organisasi`);
  if (!scoped) failures++;

  await client.close();

  // 4. Kunci yang dicabut harus langsung ditolak.
  if (temporary) {
    const { revokeKey } = await import("./keys-store");
    await revokeKey(temporary.orgId, temporary.keyId);
    const afterRevoke = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    const revokedOk = afterRevoke.status === 401;
    console.log(`${revokedOk ? "OK  " : "FAIL"} kunci dicabut langsung ditolak (status ${afterRevoke.status})`);
    if (!revokedOk) failures++;
  }

  console.log(
    failures === 0
      ? `\nSelesai: semua pemeriksaan HTTP lulus (${calls.length + 3 + (temporary ? 1 : 0)} cek).`
      : `\nSelesai dengan ${failures} kegagalan.`,
  );
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
