/**
 * Tool MCP: satu panggilan untuk melihat kondisi org hari ini.
 * Dipakai sebagai "dashboard" pertama sebelum AI menelusuri tool lain.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAY_TYPE_LABEL } from "../../src/lib/format";
import { attendanceLive, pendingApprovals } from "./attendance";
import { payrollPreview } from "./payroll";
import { num, query, resolveOrg, resolvePeriod, round, todayIn, toolResult } from "../core";

export function registerOverviewTool(server: McpServer) {
  server.registerTool(
    "gaji_overview",
    {
      title: "Ringkasan kondisi org (dashboard)",
      description:
        "Snapshot satu panggilan: periode gaji berjalan, headcount per tipe gaji, absensi hari ini, yang menunggu persetujuan, kontrak hampir habis, kasbon berjalan, dan total payroll berjalan. Plus daftar alert yang perlu perhatian.",
      inputSchema: {
        org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
        includePayrollPreview: z
          .boolean()
          .optional()
          .describe("Hitung total payroll periode berjalan (default true, sedikit lebih berat)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, includePayrollPreview }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, {});
      const today = todayIn(target);

      const [headcount, live, pending, expiring, kasbon] = await Promise.all([
        query<{ pay_type: string; active: number; inactive: number }>(
          `select pay_type,
                  count(*) filter (where is_active)::int as active,
                  count(*) filter (where not is_active)::int as inactive
             from employees where org_id = $1
            group by pay_type order by pay_type`,
          [target.id],
        ),
        attendanceLive(target),
        pendingApprovals(target),
        query<{ count: number }>(
          `select count(*)::int as count from contracts
            where org_id = $1 and status = 'active' and end_date is not null
              and end_date <= (current_date + $2::int)`,
          [target.id, target.contractAlertDays],
        ),
        query<{ count: number; total: number }>(
          `select count(*)::int as count, coalesce(sum(balance), 0)::float8 as total
             from cash_advances where org_id = $1 and status = 'approved' and balance > 0`,
          [target.id],
        ),
      ]);

      const preview =
        includePayrollPreview === false ? null : await payrollPreview(target, resolved.period);

      const headcountRows = headcount.map((h) => ({
        payType: h.pay_type,
        label: PAY_TYPE_LABEL[h.pay_type] ?? h.pay_type,
        active: Number(h.active),
        inactive: Number(h.inactive),
      }));
      const activeTotal = headcountRows.reduce((s, h) => s + h.active, 0);

      const alerts: string[] = [];
      if (live.counts.notClockedInYet > 0) {
        alerts.push(
          `${live.counts.notClockedInYet} karyawan (per jam/hari) belum clock-in hari ini: ${live.notClockedInYet
            .map((a) => a.employee)
            .join(", ")}.`,
        );
      }
      if (live.counts.staleOpen > 0) {
        alerts.push(
          `${live.counts.staleOpen} entri absensi belum clock-out dari hari sebelumnya — tidak akan dihitung di payroll.`,
        );
      }
      if (pending.counts.total > 0) {
        alerts.push(
          `${pending.counts.total} pengajuan menunggu persetujuan (absensi ${pending.counts.attendance}, cuti ${pending.counts.leaves}, kasbon ${pending.counts.cashAdvances}, tugas ${pending.counts.tasks}).`,
        );
      }
      if (Number(expiring[0]?.count ?? 0) > 0) {
        alerts.push(
          `${expiring[0].count} kontrak berakhir dalam ${target.contractAlertDays} hari.`,
        );
      }
      if (resolved.id === null) {
        alerts.push(
          `Periode ${resolved.label} belum dibuat di aplikasi — payroll periode ini belum pernah dihitung/disimpan.`,
        );
      } else if (resolved.status === "draft") {
        alerts.push(`Periode ${resolved.label} masih draft (belum di-approve).`);
      }
      if (preview && preview.notCounted.pendingAttendance > 0) {
        alerts.push(
          `${preview.notCounted.pendingAttendance} absensi periode ini belum di-approve, jadi belum masuk perhitungan payroll.`,
        );
      }

      return toolResult({
        org: {
          slug: target.slug,
          name: target.name,
          timezone: target.timezone,
          payPeriodStartDay: target.payPeriodStartDay,
          overtimeMultiplier: target.overtimeMultiplier,
        },
        today,
        period: {
          label: resolved.label,
          start: resolved.period.start,
          end: resolved.period.end,
          status: resolved.status,
          saved: resolved.id !== null,
        },
        headcount: { activeTotal, byPayType: headcountRows },
        attendanceToday: {
          date: live.date,
          onDutyNow: live.counts.onDutyNow,
          finishedToday: live.counts.finishedToday,
          notClockedInYet: live.counts.notClockedInYet,
          staleOpen: live.counts.staleOpen,
        },
        pendingApprovals: pending.counts,
        contractsExpiring: Number(expiring[0]?.count ?? 0),
        cashAdvances: {
          activeCount: Number(kasbon[0]?.count ?? 0),
          outstandingTotal: round(num(kasbon[0]?.total)),
        },
        payrollThisPeriod: preview
          ? {
              ...preview.totals,
              notCountedYet: preview.notCounted,
            }
          : null,
        alerts,
      });
    },
  );
}
