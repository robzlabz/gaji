/**
 * Smoke test: menyalakan server MCP lewat stdio lalu memanggil SEMUA tool,
 * supaya kelihatan tool benar-benar jalan (bukan cuma terdaftar).
 *
 * Tool yang butuh karyawan memakai nama karyawan pertama dari gaji_list_employees,
 * jadi tidak ada tool yang dilewati.
 *
 * Jalankan: npx tsx mcp/smoke.ts [org-slug]
 */
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const orgSlug = process.argv[2];
const root = path.resolve(__dirname, "..");

type ToolReply = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(reply: ToolReply): string {
  return reply.content?.find((c) => c.type === "text")?.text ?? "";
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "mcp/server.ts"],
    cwd: root,
    env: { ...process.env } as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client({ name: "gaji-mcp-smoke", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`\n=== ${tools.length} tool terdaftar ===`);
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description?.split(".")[0]}`);
  }

  const orgArg = orgSlug ? { org: orgSlug } : {};

  // Cari satu karyawan supaya tool yang butuh karyawan ikut teruji.
  let employeeArg: Record<string, unknown> = {};
  const seedReply = (await client.callTool({
    name: "gaji_list_employees",
    arguments: { ...orgArg, limit: 1 },
  })) as ToolReply;
  try {
    const parsed = JSON.parse(textOf(seedReply)) as { employees?: Array<{ name: string }> };
    const first = parsed.employees?.[0];
    if (first) employeeArg = { employee: first.name };
  } catch {
    /* kalau gagal, tool yang butuh karyawan akan dilaporkan gagal di bawah */
  }
  console.log(`\n=== karyawan uji: ${(employeeArg.employee as string) ?? "(tidak ada)"} ===`);

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "gaji_list_orgs", args: {} },
    { name: "gaji_org_settings", args: orgArg },
    { name: "gaji_overview", args: orgArg },
    { name: "gaji_list_employees", args: { ...orgArg, limit: 5 } },
    { name: "gaji_employee_profile", args: { ...orgArg, ...employeeArg } },
    { name: "gaji_contracts", args: orgArg },
    { name: "gaji_contracts_expiring", args: orgArg },
    { name: "gaji_attendance_live", args: orgArg },
    { name: "gaji_attendance_report", args: { ...orgArg, onlyWithEntries: true } },
    { name: "gaji_pending_approvals", args: orgArg },
    { name: "gaji_leaves", args: orgArg },
    { name: "gaji_pay_periods", args: orgArg },
    { name: "gaji_payslips", args: { ...orgArg, ...employeeArg } },
    { name: "gaji_payroll_preview", args: orgArg },
    { name: "gaji_kasbon", args: orgArg },
    { name: "gaji_kasbon_txns", args: orgArg },
    { name: "gaji_tasks", args: orgArg },
    { name: "gaji_audit_log", args: { ...orgArg, limit: 3 } },
    { name: "gaji_query", args: { sql: "select count(*)::int as employees from employees" } },
  ];

  let failures = 0;

  for (const call of calls) {
    const started = Date.now();
    try {
      const reply = (await client.callTool({ name: call.name, arguments: call.args })) as ToolReply;
      const text = textOf(reply);
      const ms = Date.now() - started;

      if (reply.isError) {
        failures += 1;
        console.log(`\n=== ${call.name} (${ms}ms) GAGAL ===\n${text.slice(0, 600)}`);
        continue;
      }

      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* biarkan teks apa adanya */
      }
      const body = pretty.length > 1400 ? `${pretty.slice(0, 1400)}\n… (dipotong)` : pretty;
      console.log(`\n=== ${call.name} (${ms}ms) ===\n${body}`);
    } catch (error) {
      failures += 1;
      console.log(`\n=== ${call.name} ERROR ===\n${String(error)}`);
    }
  }

  await client.close();
  console.log(`\n=== selesai: ${calls.length - failures}/${calls.length} tool sukses ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
