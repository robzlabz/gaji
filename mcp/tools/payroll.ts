/**
 * Tool MCP: periode gaji, slip gaji, dan simulasi payroll.
 *
 * Simulasi memakai fungsi yang sama dengan aplikasi (`computePayslip` +
 * `resolveAdvanceDeduction`), jadi angka yang dilaporkan MCP identik dengan
 * halaman Payroll — bukan rumus tandingan.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toNumber } from "../../src/lib/format";
import { advanceLabel, isAdvanceEligible, resolveAdvanceDeduction } from "../../src/lib/kasbon";
import { computePayslip } from "../../src/lib/payroll";
import type { Period } from "../../src/lib/period";
import {
  num,
  query,
  resolveEmployee,
  resolveOrg,
  resolvePeriod,
  round,
  toolResult,
  type Org,
} from "../core";

const ORG_ARG = {
  org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
};

const PERIOD_ARG = {
  periodId: z.string().optional().describe("Id baris pay_periods (kalau sudah tahu)."),
  periodStart: z.string().optional().describe("Tanggal mulai periode YYYY-MM-DD."),
  date: z.string().optional().describe("Tanggal apa pun di dalam periode yang dimaksud."),
};

/* ------------------------------------------------------------------ */
/* Simulasi payroll (dipakai juga oleh gaji_overview)                  */
/* ------------------------------------------------------------------ */

export type PreviewRow = {
  employeeId: string;
  employee: string;
  payType: string;
  gross: number;
  deductions: number;
  net: number;
  advanceDeduction: number;
  advanceDeferred: number;
  warnings: string[];
  lines: Array<{ kind: string; label: string; qty: number; unit: string; amount: number }>;
};

export async function payrollPreview(
  org: Org,
  period: Period,
): Promise<{
  rows: PreviewRow[];
  totals: { employees: number; gross: number; deductions: number; net: number };
  notCounted: { pendingAttendance: number; pendingTasks: number; openAttendance: number };
}> {
  const staff = await query<{
    id: string;
    full_name: string;
    pay_type: string;
    pay_rate: string;
    joined_at: string;
  }>(
    `select id, full_name, pay_type, pay_rate, joined_at
       from employees where org_id = $1 and is_active order by full_name`,
    [org.id],
  );

  const employeeIds = staff.map((s) => s.id);
  if (employeeIds.length === 0) {
    return {
      rows: [],
      totals: { employees: 0, gross: 0, deductions: 0, net: 0 },
      notCounted: { pendingAttendance: 0, pendingTasks: 0, openAttendance: 0 },
    };
  }

  const [entries, tasks, advances, leaves, plans, pending] = await Promise.all([
    query<{
      id: string;
      employee_id: string;
      work_date: string;
      clock_in_at: string;
      clock_out_at: string | null;
      break_minutes: number;
      overtime_minutes: number;
    }>(
      `select id, employee_id, work_date, clock_in_at, clock_out_at, break_minutes, overtime_minutes
         from time_entries
        where org_id = $1 and status = 'approved' and work_date between $2 and $3`,
      [org.id, period.start, period.end],
    ),
    query<{
      id: string;
      employee_id: string | null;
      title: string;
      qty: string;
      unit: string;
      unit_rate: string;
      work_date: string;
    }>(
      `select id, employee_id, title, qty, unit, unit_rate, work_date
         from work_tasks
        where org_id = $1 and status = 'approved' and work_date between $2 and $3`,
      [org.id, period.start, period.end],
    ),
    query<{
      id: string;
      employee_id: string;
      balance: string;
      installment_amount: string | null;
      requested_at: string;
      note: string | null;
    }>(
      `select id, employee_id, balance, installment_amount, requested_at, note
         from cash_advances
        where org_id = $1 and status = 'approved' and balance > 0`,
      [org.id],
    ),
    query<{
      id: string;
      employee_id: string;
      kind: string;
      start_date: string;
      end_date: string;
      paid: boolean;
      status: string;
    }>(
      `select id, employee_id, kind, start_date, end_date, paid, status
         from leaves
        where org_id = $1 and status = 'approved' and start_date <= $3 and end_date >= $2`,
      [org.id, period.start, period.end],
    ),
    query<{ cash_advance_id: string; decision: string; amount: string | null }>(
      `select cash_advance_id, decision, amount
         from cash_advance_plans where org_id = $1 and period_start = $2`,
      [org.id, period.start],
    ),
    query<{ pending_entries: number; open_entries: number; pending_tasks: number }>(
      `select
         (select count(*) from time_entries
           where org_id = $1 and status = 'pending' and work_date between $2 and $3)::int as pending_entries,
         (select count(*) from time_entries
           where org_id = $1 and clock_out_at is null and work_date <= $3)::int as open_entries,
         (select count(*) from work_tasks
           where org_id = $1 and status in ('open', 'done') and work_date between $2 and $3)::int as pending_tasks`,
      [org.id, period.start, period.end],
    ),
  ]);

  const planByAdvance = new Map(
    plans.map((p) => [
      p.cash_advance_id,
      { cashAdvanceId: p.cash_advance_id, decision: p.decision, amount: p.amount },
    ]),
  );

  const rows: PreviewRow[] = staff.map((employee) => {
    const own = advances.filter(
      (a) =>
        a.employee_id === employee.id &&
        toNumber(a.balance) > 0 &&
        isAdvanceEligible(
          { id: a.id, balance: a.balance, installmentAmount: a.installment_amount, requestedAt: a.requested_at },
          period.end,
        ),
    );

    const resolved = own.map((advance, index) => ({
      advance,
      resolution: resolveAdvanceDeduction(
        {
          id: advance.id,
          balance: advance.balance,
          installmentAmount: advance.installment_amount,
          requestedAt: advance.requested_at,
          note: advance.note,
        },
        planByAdvance.get(advance.id),
      ),
      label: advanceLabel(
        {
          id: advance.id,
          balance: advance.balance,
          installmentAmount: advance.installment_amount,
          requestedAt: advance.requested_at,
          note: advance.note,
        },
        index,
        own.length,
      ),
    }));

    const computation = computePayslip({
      payType: employee.pay_type,
      payRate: employee.pay_rate,
      period,
      joinedAt: employee.joined_at,
      overtimeMultiplier: org.overtimeMultiplier,
      timeEntries: entries
        .filter((e) => e.employee_id === employee.id)
        .map((e) => ({
          id: e.id,
          workDate: e.work_date,
          clockInAt: e.clock_in_at,
          clockOutAt: e.clock_out_at,
          breakMinutes: e.break_minutes,
          overtimeMinutes: e.overtime_minutes,
        })),
      tasks: tasks
        .filter((t) => t.employee_id === employee.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          qty: t.qty,
          unit: t.unit,
          unitRate: t.unit_rate,
          workDate: t.work_date,
        })),
      advances: resolved.map((item) => ({
        id: item.advance.id,
        balance: item.advance.balance,
        installmentAmount: item.advance.installment_amount,
        amountOverride: item.resolution.source === "plan-amount" ? item.resolution.amount : null,
        deferred: item.resolution.deferred,
        label: item.label,
      })),
      leaves: leaves
        .filter((l) => l.employee_id === employee.id)
        .map((l) => ({
          id: l.id,
          kind: l.kind,
          startDate: l.start_date,
          endDate: l.end_date,
          paid: l.paid,
          status: l.status,
        })),
    });

    return {
      employeeId: employee.id,
      employee: employee.full_name,
      payType: employee.pay_type,
      gross: round(computation.gross),
      deductions: round(computation.deductions),
      net: round(computation.net),
      advanceDeduction: resolved
        .filter((item) => !item.resolution.deferred)
        .reduce((sum, item) => sum + item.resolution.amount, 0),
      advanceDeferred: resolved
        .filter((item) => item.resolution.deferred)
        .reduce((sum, item) => sum + toNumber(item.advance.balance), 0),
      warnings: computation.warnings,
      lines: computation.lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        qty: line.qty,
        unit: line.unit,
        amount: round(line.amount),
      })),
    };
  });

  return {
    rows: rows.sort((a, b) => b.net - a.net),
    totals: {
      employees: rows.length,
      gross: round(rows.reduce((s, r) => s + r.gross, 0)),
      deductions: round(rows.reduce((s, r) => s + r.deductions, 0)),
      net: round(rows.reduce((s, r) => s + r.net, 0)),
    },
    notCounted: {
      pendingAttendance: Number(pending[0]?.pending_entries ?? 0),
      openAttendance: Number(pending[0]?.open_entries ?? 0),
      pendingTasks: Number(pending[0]?.pending_tasks ?? 0),
    },
  };
}

/* ------------------------------------------------------------------ */

export function registerPayrollTools(server: McpServer) {
  server.registerTool(
    "gaji_pay_periods",
    {
      title: "Daftar periode gaji + total slip",
      description:
        "Periode gaji terakhir beserta status (draft/approved/paid), jumlah slip, dan total gross/deduction/net. Berguna untuk melihat periode mana yang belum dibayar.",
      inputSchema: {
        ...ORG_ARG,
        limit: z.number().int().min(1).max(36).optional().describe("Default 6 periode terakhir."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, limit }) => {
      const target = await resolveOrg(org);
      const current = await resolvePeriod(target, {});

      const rows = await query<{
        id: string;
        period_start: string;
        period_end: string;
        pay_date: string | null;
        status: string;
        payslips: number;
        paid_slips: number;
        gross: number;
        deductions: number;
        net: number;
      }>(
        `select pp.id, pp.period_start, pp.period_end, pp.pay_date, pp.status,
                count(ps.id)::int as payslips,
                count(ps.id) filter (where ps.status = 'paid')::int as paid_slips,
                coalesce(sum(ps.gross), 0)::float8 as gross,
                coalesce(sum(ps.total_deductions), 0)::float8 as deductions,
                coalesce(sum(ps.net), 0)::float8 as net
           from pay_periods pp
           left join payslips ps on ps.pay_period_id = pp.id
          where pp.org_id = $1
          group by pp.id, pp.period_start, pp.period_end, pp.pay_date, pp.status
          order by pp.period_start desc
          limit $2`,
        [target.id, limit ?? 6],
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        currentPeriod: {
          label: current.label,
          start: current.period.start,
          end: current.period.end,
          hasPayPeriodRow: current.id !== null,
          status: current.status,
        },
        periods: rows.map((r) => ({
          id: r.id,
          start: r.period_start,
          end: r.period_end,
          payDate: r.pay_date,
          status: r.status,
          payslips: r.payslips,
          paidSlips: r.paid_slips,
          gross: num(r.gross),
          deductions: num(r.deductions),
          net: num(r.net),
          isCurrent: r.period_start === current.period.start,
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_payslips",
    {
      title: "Slip gaji satu periode",
      description:
        "Daftar slip gaji pada sebuah periode (default periode berjalan) dengan gross, potongan, net, dan status bayar. Bila `employee` diisi, tampilkan rincian item slip karyawan itu.",
      inputSchema: {
        ...ORG_ARG,
        ...PERIOD_ARG,
        employee: z.string().optional().describe("Nama/kode/id karyawan untuk rincian item slip."),
        includeItems: z.boolean().optional().describe("Sertakan rincian item untuk semua slip (default false)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, periodId, periodStart, date, employee, includeItems }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, { periodId, periodStart, date });

      const emp = employee ? await resolveEmployee(target, employee) : null;

      const params: unknown[] = [target.id, resolved.period.start];
      let empFilter = "";
      if (emp) {
        params.push(emp.id);
        empFilter = `and ps.employee_id = $${params.length}`;
      }

      const rows = await query<{
        id: string;
        employee_id: string;
        employee: string;
        pay_type: string;
        pay_rate: number;
        gross: number;
        total_deductions: number;
        net: number;
        status: string;
        paid_at: string | null;
      }>(
        `select ps.id, ps.employee_id, e.full_name as employee, ps.pay_type,
                ps.pay_rate::float8 as pay_rate, ps.gross::float8 as gross,
                ps.total_deductions::float8 as total_deductions, ps.net::float8 as net,
                ps.status, ps.paid_at
           from payslips ps
           join employees e on e.id = ps.employee_id
          where ps.org_id = $1 and ps.pay_period_id = (
                  select id from pay_periods where org_id = $1 and period_start = $2
                ) ${empFilter}
          order by e.full_name`,
        params,
      );

      const items =
        includeItems || emp
          ? await query<{
              payslip_id: string;
              kind: string;
              label: string;
              qty: number;
              unit: string;
              unit_rate: number;
              amount: number;
            }>(
              `select pi.payslip_id, pi.kind, pi.label, pi.qty::float8 as qty, pi.unit,
                      pi.unit_rate::float8 as unit_rate, pi.amount::float8 as amount
                 from payslip_items pi
                where pi.payslip_id in (
                  select ps.id from payslips ps
                   where ps.org_id = $1 and ps.pay_period_id = (
                     select id from pay_periods where org_id = $1 and period_start = $2
                   ) ${emp ? "and ps.employee_id = $3" : ""}
                )
                order by pi.payslip_id, pi.kind, pi.label`,
              emp ? [target.id, resolved.period.start, emp.id] : [target.id, resolved.period.start],
            )
          : [];

      const itemsBySlip = new Map<string, typeof items>();
      for (const item of items) {
        const list = itemsBySlip.get(item.payslip_id) ?? [];
        list.push(item);
        itemsBySlip.set(item.payslip_id, list);
      }

      return toolResult({
        org: { slug: target.slug, name: target.name },
        period: {
          label: resolved.label,
          start: resolved.period.start,
          end: resolved.period.end,
          status: resolved.status,
          payDate: resolved.payDate,
          payPeriodId: resolved.id,
          note: resolved.id ? undefined : "Periode ini belum pernah dihitung, jadi belum ada slip tersimpan.",
        },
        count: rows.length,
        totals: {
          gross: round(rows.reduce((s, r) => s + num(r.gross), 0)),
          deductions: round(rows.reduce((s, r) => s + num(r.total_deductions), 0)),
          net: round(rows.reduce((s, r) => s + num(r.net), 0)),
        },
        payslips: rows.map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          employee: r.employee,
          payType: r.pay_type,
          payRate: num(r.pay_rate),
          gross: num(r.gross),
          deductions: num(r.total_deductions),
          net: num(r.net),
          status: r.status,
          paidAt: r.paid_at,
          items: (itemsBySlip.get(r.id) ?? []).map((i) => ({
            kind: i.kind,
            label: i.label,
            qty: num(i.qty),
            unit: i.unit,
            unitRate: num(i.unit_rate),
            amount: num(i.amount),
          })),
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_payroll_preview",
    {
      title: "Simulasi payroll periode",
      description:
        "Hitung ulang payroll dari data approved saat ini (belum menyimpan apa pun): gross, potongan kasbon, net per karyawan, plus berapa absensi/tugas yang belum di-approve sehingga belum ikut dihitung.",
      inputSchema: {
        ...ORG_ARG,
        ...PERIOD_ARG,
        includeLines: z.boolean().optional().describe("Sertakan rincian baris per karyawan (default false)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, periodId, periodStart, date, includeLines }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, { periodId, periodStart, date });
      const preview = await payrollPreview(target, resolved.period);

      // Bandingkan dengan slip yang sudah tersimpan (kalau periode ini pernah dihitung).
      // Selisih = data berubah setelah hitung terakhir, jadi draft perlu "Hitung ulang".
      let stored: {
        payslips: number;
        gross: number;
        deductions: number;
        net: number;
        statuses: Record<string, number>;
        drift: Array<{ employee: string; storedNet: number; previewNet: number; delta: number }>;
      } | null = null;

      if (resolved.id) {
        const slips = await query<{
          employee_id: string;
          employee: string;
          gross: number;
          total_deductions: number;
          net: number;
          status: string;
        }>(
          `select ps.employee_id, e.full_name as employee, ps.gross::float8 as gross,
                  ps.total_deductions::float8 as total_deductions, ps.net::float8 as net, ps.status
             from payslips ps join employees e on e.id = ps.employee_id
            where ps.pay_period_id = $1`,
          [resolved.id],
        );

        if (slips.length > 0) {
          const previewNet = new Map(preview.rows.map((r) => [r.employeeId, r.net]));
          const drift = slips
            .map((s) => ({
              employee: s.employee,
              storedNet: num(s.net),
              previewNet: previewNet.get(s.employee_id) ?? 0,
              delta: round((previewNet.get(s.employee_id) ?? 0) - num(s.net)),
            }))
            .filter((d) => d.delta !== 0);

          stored = {
            payslips: slips.length,
            gross: round(slips.reduce((s, x) => s + num(x.gross), 0)),
            deductions: round(slips.reduce((s, x) => s + num(x.total_deductions), 0)),
            net: round(slips.reduce((s, x) => s + num(x.net), 0)),
            statuses: slips.reduce<Record<string, number>>((acc, s) => {
              acc[s.status] = (acc[s.status] ?? 0) + 1;
              return acc;
            }, {}),
            drift,
          };
        }
      }

      return toolResult({
        org: { slug: target.slug, name: target.name },
        period: {
          label: resolved.label,
          start: resolved.period.start,
          end: resolved.period.end,
          savedStatus: resolved.status,
          payPeriodId: resolved.id,
        },
        totals: preview.totals,
        storedDraft: stored
          ? {
              ...stored,
              needsRecalculate: stored.drift.length > 0,
              note:
                stored.drift.length > 0
                  ? "Slip tersimpan beda dengan perhitungan terbaru — jalankan \"Hitung ulang\" di halaman payroll sebelum approve."
                  : "Slip tersimpan sudah sama dengan perhitungan terbaru.",
            }
          : null,
        notCountedYet: {
          pendingAttendance: preview.notCounted.pendingAttendance,
          openAttendance: preview.notCounted.openAttendance,
          pendingTasks: preview.notCounted.pendingTasks,
          note: "Data ini belum dihitung karena statusnya belum approved / belum clock-out.",
        },
        employees: preview.rows.map((row) => ({
          employeeId: row.employeeId,
          employee: row.employee,
          payType: row.payType,
          gross: row.gross,
          deductions: row.deductions,
          net: row.net,
          advanceDeduction: row.advanceDeduction,
          advanceDeferred: row.advanceDeferred,
          warnings: row.warnings,
          ...(includeLines ? { lines: row.lines } : {}),
        })),
      });
    },
  );
}
