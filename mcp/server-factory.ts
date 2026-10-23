/**
 * Pabrik server MCP "gaji".
 *
 * Dipakai dua entry point:
 * - `mcp/http.ts`  → transport Streamable HTTP di `/api/mcp` (cara utama, dipakai UI admin)
 * - `mcp/server.ts` → transport stdio (`npm run mcp`) untuk client lokal
 *
 * Server dibuat baru per request HTTP (mode stateless), jadi factory ini harus murah:
 * semua tool hanya mendaftarkan handler, tidak menyentuh database.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAttendanceTools } from "./tools/attendance";
import { registerContractTools } from "./tools/contracts";
import { registerOpsTools } from "./tools/ops";
import { registerOverviewTool } from "./tools/overview";
import { registerPayrollTools } from "./tools/payroll";
import { registerPeopleTools } from "./tools/people";

const INSTRUCTIONS_HEAD = `Server ini membaca data aplikasi payroll "Gaji" (read-only) supaya bisa dipakai untuk pemantauan.

API key yang dipakai sudah terikat ke satu organisasi, jadi parameter "org" boleh dikosongkan
dan permintaan ke organisasi lain akan ditolak.

Alur yang disarankan:
1. gaji_overview untuk kondisi hari ini: periode berjalan, kehadiran, yang menunggu approval, kontrak hampir habis, kasbon, total payroll.
2. Telusuri lebih dalam sesuai kebutuhan: gaji_attendance_report / gaji_attendance_live (absensi), gaji_pending_approvals (antrean approval), gaji_payroll_preview (simulasi payroll), gaji_payslips, gaji_kasbon + gaji_kasbon_txns (saldo & buku kasbon), gaji_leaves, gaji_tasks, gaji_contracts / gaji_contracts_expiring, gaji_org_settings (pengaturan + akses), gaji_employee_profile, gaji_audit_log.`;

const INSTRUCTIONS_QUERY_STEP = `3. gaji_query hanya untuk pertanyaan yang tidak tercakup tool lain (SELECT read-only).`;

const INSTRUCTIONS_TAIL = `Semua tool hanya membaca; tidak ada aksi yang mengubah data. Semua nominal dalam Rupiah, tanggal dalam zona waktu organisasi.`;

/**
 * Instruksi default untuk transport HTTP: `gaji_query` sengaja tidak disebut karena
 * tool itu tidak didaftarkan di sana. Server stdio lokal menambahkan langkahnya.
 */
export const INSTRUCTIONS = `${INSTRUCTIONS_HEAD}

${INSTRUCTIONS_TAIL}`;

function instructionsFor(rawQuery: boolean): string {
  const steps = rawQuery ? `${INSTRUCTIONS_HEAD}\n${INSTRUCTIONS_QUERY_STEP}` : INSTRUCTIONS_HEAD;
  return `${steps}\n\n${INSTRUCTIONS_TAIL}`;
}

export type GajiMcpServerOptions = {
  /** Daftarkan `gaji_query` (SQL bebas). Hanya untuk transport stdio lokal. */
  rawQuery?: boolean;
};

export function createGajiMcpServer(options: GajiMcpServerOptions = {}): McpServer {
  const rawQuery = options.rawQuery === true;
  const server = new McpServer(
    { name: "gaji", version: "1.0.0" },
    { instructions: instructionsFor(rawQuery) },
  );

  registerOverviewTool(server);
  registerPeopleTools(server);
  registerContractTools(server);
  registerAttendanceTools(server);
  registerPayrollTools(server);
  registerOpsTools(server, { rawQuery });

  return server;
}
