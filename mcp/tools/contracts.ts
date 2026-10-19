/**
 * Tool MCP: kontrak kerja — seluruh riwayat, bukan hanya yang hampir berakhir.
 *
 * `gaji_contracts_expiring` menjawab "kontrak siapa yang mau habis", tool ini
 * menjawab "kontraknya apa saja": jenis, periode, tarif yang tertulis di kontrak,
 * status (active/renewed/terminated), dan rantai perpanjangannya.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONTRACT_KIND_LABEL, PAY_TYPE_LABEL, addDays } from "../../src/lib/format";
import { num, query, resolveEmployee, resolveOrg, todayIn, toolResult } from "../core";

const ORG_ARG = {
  org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
};

type ContractRow = {
  id: string;
  employee_id: string;
  employee: string;
  code: string | null;
  contract_no: string | null;
  kind: string;
  start_date: string;
  end_date: string | null;
  pay_type: string;
  pay_rate: number;
  status: string;
  renewed_from_id: string | null;
  document_path: string | null;
  note: string | null;
  created_at: string;
};

export function registerContractTools(server: McpServer) {
  server.registerTool(
    "gaji_contracts",
    {
      title: "Daftar kontrak kerja",
      description:
        "Semua kontrak sebuah org: karyawan, nomor, jenis (PKWT/PKWTT/percobaan), periode, tarif di kontrak, status (active/renewed/terminated), sisa hari sampai berakhir, dan apakah dokumennya terlampir. Pakai `employee` untuk riwayat kontrak satu orang (termasuk perpanjangan).",
      inputSchema: {
        ...ORG_ARG,
        employee: z.string().optional().describe("Batasi ke satu karyawan (nama/kode/id)."),
        status: z
          .enum(["active", "renewed", "terminated", "all"])
          .optional()
          .describe("Filter status kontrak. Default: all."),
        kind: z
          .enum(["pkwt", "pkwtt", "probation", "other"])
          .optional()
          .describe("Filter jenis kontrak."),
        expiringWithinDays: z
          .number()
          .int()
          .min(0)
          .max(730)
          .optional()
          .describe("Hanya kontrak aktif yang berakhir dalam N hari ke depan (termasuk yang sudah lewat)."),
        limit: z.number().int().min(1).max(500).optional().describe("Default 200."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, employee, status, kind, expiringWithinDays, limit }) => {
      const target = await resolveOrg(org);
      const today = todayIn(target);
      const emp = employee ? await resolveEmployee(target, employee) : null;

      const params: unknown[] = [target.id];
      const filters = ["c.org_id = $1"];

      if (status && status !== "all") {
        params.push(status);
        filters.push(`c.status = $${params.length}`);
      }
      if (kind) {
        params.push(kind);
        filters.push(`c.kind = $${params.length}`);
      }
      if (emp) {
        params.push(emp.id);
        filters.push(`c.employee_id = $${params.length}`);
      }
      if (expiringWithinDays !== undefined) {
        // Kontrak tanpa tanggal berakhir (PKWTT) tidak pernah "habis".
        params.push(addDays(today, expiringWithinDays));
        filters.push(`c.end_date is not null and c.end_date <= $${params.length}`);
        filters.push("c.status = 'active'");
      }
      params.push(limit ?? 200);

      const rows = await query<ContractRow>(
        `select c.id, c.employee_id, e.full_name as employee, e.code, c.contract_no, c.kind,
                c.start_date, c.end_date, c.pay_type, c.pay_rate::float8 as pay_rate, c.status,
                c.renewed_from_id, c.document_path, c.note, c.created_at
           from contracts c join employees e on e.id = c.employee_id
          where ${filters.join(" and ")}
          order by c.start_date desc, e.full_name
          limit $${params.length}`,
        params,
      );

      const contracts = rows.map((r) => {
        const daysToEnd = r.end_date
          ? Math.round(
              (Date.parse(`${r.end_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
            )
          : null;
        return {
          id: r.id,
          employeeId: r.employee_id,
          employee: r.employee,
          code: r.code,
          contractNo: r.contract_no,
          kind: r.kind,
          kindLabel: CONTRACT_KIND_LABEL[r.kind] ?? r.kind,
          startDate: r.start_date,
          endDate: r.end_date,
          daysToEnd,
          openEnded: r.end_date === null,
          expired: daysToEnd !== null && daysToEnd < 0,
          payType: r.pay_type,
          payTypeLabel: PAY_TYPE_LABEL[r.pay_type] ?? r.pay_type,
          payRate: num(r.pay_rate),
          status: r.status,
          renewedFromId: r.renewed_from_id,
          hasDocument: r.document_path !== null,
          note: r.note,
          createdAt: r.created_at,
        };
      });

      const active = contracts.filter((c) => c.status === "active");
      const expiringSoon = active
        .filter((c) => c.daysToEnd !== null && c.daysToEnd <= target.contractAlertDays)
        .sort((a, b) => (a.daysToEnd ?? 0) - (b.daysToEnd ?? 0));

      return toolResult({
        org: { slug: target.slug, name: target.name, contractAlertDays: target.contractAlertDays },
        today,
        summary: {
          total: contracts.length,
          active: active.length,
          renewed: contracts.filter((c) => c.status === "renewed").length,
          terminated: contracts.filter((c) => c.status === "terminated").length,
          openEnded: contracts.filter((c) => c.openEnded).length,
          activeWithoutEndDate: active.filter((c) => c.openEnded).length,
          expiredButStillActive: active.filter((c) => c.expired).length,
          expiringSoon: expiringSoon.length,
        },
        expiringSoon: expiringSoon.map((c) => ({
          employee: c.employee,
          contractNo: c.contractNo,
          endDate: c.endDate,
          daysToEnd: c.daysToEnd,
        })),
        contracts,
      });
    },
  );
}
