/**
 * Smoke test: menyalakan server MCP lewat stdio lalu memanggil beberapa tool,
 * supaya kelihatan tool benar-benar jalan (bukan cuma terdaftar).
 *
 * Jalankan: npx tsx mcp/smoke.ts [org-slug]
 */
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const orgSlug = process.argv[2];
const root = path.resolve(__dirname, "..");

type ToolReply = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

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

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "gaji_list_orgs", args: {} },
    { name: "gaji_overview", args: orgArg },
    { name: "gaji_list_employees", args: { ...orgArg, limit: 5 } },
    { name: "gaji_attendance_live", args: orgArg },
    { name: "gaji_pending_approvals", args: orgArg },
    { name: "gaji_attendance_report", args: { ...orgArg, onlyWithEntries: true } },
    { name: "gaji_pay_periods", args: orgArg },
    { name: "gaji_payroll_preview", args: orgArg },
    { name: "gaji_kasbon", args: orgArg },
    { name: "gaji_leaves", args: orgArg },
    { name: "gaji_tasks", args: orgArg },
    { name: "gaji_contracts_expiring", args: orgArg },
    { name: "gaji_audit_log", args: { ...orgArg, limit: 3 } },
    { name: "gaji_query", args: { sql: "select count(*)::int as employees from employees" } },
  ];

  let failures = 0;
  let total = 0;

  /** Panggil satu tool, cetak hasilnya, kembalikan JSON-nya (null bila gagal). */
  async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
    total += 1;
    const started = Date.now();
    try {
      const reply = (await client.callTool({ name, arguments: args })) as ToolReply;
      const text = reply.content?.find((c) => c.type === "text")?.text ?? "";
      const ms = Date.now() - started;

      if (reply.isError) {
        failures += 1;
        console.log(`\n=== ${name} (${ms}ms) GAGAL ===\n${text.slice(0, 600)}`);
        return null;
      }

      let parsed: unknown = null;
      let pretty = text;
      try {
        parsed = JSON.parse(text);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {
        /* biarkan teks apa adanya */
      }
      const body = pretty.length > 1400 ? `${pretty.slice(0, 1400)}\n… (dipotong)` : pretty;
      console.log(`\n=== ${name} (${ms}ms) ===\n${body}`);
      return parsed;
    } catch (error) {
      failures += 1;
      console.log(`\n=== ${name} ERROR ===\n${String(error)}`);
      return null;
    }
  }

  for (const call of calls) {
    await run(call.name, call.args);
  }

  // Dua tool butuh nama karyawan: ambil dari hasil gaji_list_employees.
  const listed = (await run("gaji_list_employees", { ...orgArg, limit: 1 })) as {
    employees?: Array<{ name?: string; fullName?: string }>;
  } | null;
  const firstEmployee = listed?.employees?.[0];
  const employeeName = firstEmployee?.name ?? firstEmployee?.fullName;

  if (employeeName) {
    await run("gaji_employee_profile", { ...orgArg, employee: employeeName });
    await run("gaji_payslips", { ...orgArg, employee: employeeName });
  } else {
    console.log("\n(!) tidak ada karyawan untuk menguji gaji_employee_profile / gaji_payslips");
  }

  await client.close();
  console.log(`\n=== selesai: ${total - failures}/${total} tool sukses ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
