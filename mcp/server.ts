#!/usr/bin/env node
/**
 * MCP server "gaji" — jembatan fitur aplikasi payroll ke AI (read-only).
 *
 * Jalankan:  npx tsx mcp/server.ts          (stdio, untuk client MCP)
 *            npx tsx mcp/smoke.ts           (uji cepat tanpa client)
 *
 * Env:
 *   GAJI_DATABASE_URL  (opsional) menunjuk DB lain, mis. produksi.
 *   DATABASE_URL       dipakai bila GAJI_DATABASE_URL kosong (otomatis dari .env).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sql } from "./core";
import { registerAttendanceTools } from "./tools/attendance";
import { registerOpsTools } from "./tools/ops";
import { registerOverviewTool } from "./tools/overview";
import { registerPayrollTools } from "./tools/payroll";
import { registerPeopleTools } from "./tools/people";

// stdout adalah kanal JSON-RPC: jangan pernah menulis log biasa ke sana.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

const INSTRUCTIONS = `Server ini membaca data aplikasi payroll "Gaji" (read-only) supaya bisa dipakai untuk pemantauan.

Alur yang disarankan:
1. gaji_list_orgs bila belum tahu slug org (kalau hanya ada satu tenant, parameter org boleh dikosongkan).
2. gaji_overview untuk kondisi hari ini: periode berjalan, kehadiran, yang menunggu approval, kontrak hampir habis, kasbon, total payroll.
3. Telusuri lebih dalam sesuai kebutuhan: gaji_attendance_report / gaji_attendance_live (absensi), gaji_pending_approvals (antrean approval), gaji_payroll_preview (simulasi payroll), gaji_payslips, gaji_kasbon, gaji_leaves, gaji_tasks, gaji_contracts_expiring, gaji_employee_profile, gaji_audit_log.
4. gaji_query hanya untuk pertanyaan yang tidak tercakup tool lain (SELECT read-only).

Semua tool hanya membaca; tidak ada aksi yang mengubah data. Semua nominal dalam Rupiah, tanggal dalam zona waktu organisasi.`;

const server = new McpServer(
  { name: "gaji", version: "1.0.0" },
  { instructions: INSTRUCTIONS },
);

registerOverviewTool(server);
registerPeopleTools(server);
registerAttendanceTools(server);
registerPayrollTools(server);
registerOpsTools(server);

const transport = new StdioServerTransport();

server
  .connect(transport)
  .then(() => console.error("[gaji-mcp] siap (stdio, read-only)"))
  .catch((error) => {
    console.error("[gaji-mcp] gagal start:", error);
    process.exit(1);
  });

async function shutdown(signal: string) {
  console.error(`[gaji-mcp] ${signal} — menutup koneksi`);
  try {
    await sql.end({ timeout: 3 });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
