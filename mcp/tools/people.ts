/**
 * Tool MCP: data karyawan, profil, dan kontrak.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays, formatDateID, PAY_TYPE_LABEL } from "../../src/lib/format";
import {
  num,
  query,
  resolveEmployee,
  resolveOrg,
  round,
  todayIn,
  toolResult,
} from "../core";

const ORG_ARG = {
  org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
};

export function registerPeopleTools(server: McpServer) {
  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_list_orgs",
    {
      title: "Daftar organisasi (tenant)",
      description:
        "Semua organisasi/perusahaan di database Gaji beserta jumlah karyawan aktif. Pakai untuk tahu slug org yang mau dipantau.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const orgs = await query<{
        id: string;
        name: string;
        slug: string;
        timezone: string;
        pay_period_start_day: number;
        active_employees: number;
        inactive_employees: number;
        monthly_payroll_net: number | null;
      }>(
        `select o.id, o.name, o.slug, o.timezone, o.pay_period_start_day,
                (select count(*) from employees e where e.org_id = o.id and e.is_active) as active_employees,
                (select count(*) from employees e where e.org_id = o.id and not e.is_active) as inactive_employees,
                (select coalesce(sum(ps.net), 0)::float8
                   from payslips ps where ps.org_id = o.id and ps.status = 'paid') as monthly_payroll_net
           from organizations o
          order by o.name`,
      );

      return toolResult({
        count: orgs.length,
        orgs: orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          timezone: o.timezone,
          payPeriodStartDay: o.pay_period_start_day,
          activeEmployees: Number(o.active_employees),
          inactiveEmployees: Number(o.inactive_employees),
          totalNetPaidAllTime: num(o.monthly_payroll_net),
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_list_employees",
    {
      title: "Daftar karyawan",
      description:
        "Cari/daftar karyawan sebuah org: tipe gaji, tarif, status aktif, saldo kasbon, dan apakah sudah punya akun login.",
      inputSchema: {
        ...ORG_ARG,
        q: z.string().optional().describe("Cari dari nama atau kode karyawan."),
        payType: z
          .enum(["hourly", "daily", "monthly", "per_task"])
          .optional()
          .describe("Filter tipe gaji."),
        includeInactive: z.boolean().optional().describe("Ikutkan karyawan non-aktif (default false)."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 100."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, q, payType, includeInactive, limit }) => {
      const target = await resolveOrg(org);
      const filters: string[] = ["e.org_id = $1"];
      const params: unknown[] = [target.id];

      if (!includeInactive) filters.push("e.is_active");
      if (payType) {
        params.push(payType);
        filters.push(`e.pay_type = $${params.length}`);
      }
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        filters.push(
          `(lower(e.full_name) like $${params.length} or lower(coalesce(e.code, '')) like $${params.length})`,
        );
      }
      params.push(limit ?? 100);

      const rows = await query<{
        id: string;
        code: string | null;
        full_name: string;
        pay_type: string;
        pay_rate: number;
        joined_at: string;
        ended_at: string | null;
        is_active: boolean;
        has_login: boolean;
        advance_balance: number;
        open_tasks: number;
      }>(
        `select e.id, e.code, e.full_name, e.pay_type, e.pay_rate::float8 as pay_rate,
                e.joined_at, e.ended_at, e.is_active,
                (e.user_id is not null) as has_login,
                (select coalesce(sum(ca.balance), 0)::float8
                   from cash_advances ca
                  where ca.employee_id = e.id and ca.status = 'approved') as advance_balance,
                (select count(*) from work_tasks wt
                  where wt.employee_id = e.id and wt.status in ('open', 'done')) as open_tasks
           from employees e
          where ${filters.join(" and ")}
          order by e.is_active desc, e.full_name
          limit $${params.length}`,
        params,
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        count: rows.length,
        employees: rows.map((r) => ({
          id: r.id,
          name: r.full_name,
          code: r.code,
          payType: r.pay_type,
          payTypeLabel: PAY_TYPE_LABEL[r.pay_type] ?? r.pay_type,
          payRate: num(r.pay_rate),
          joinedAt: r.joined_at,
          endedAt: r.ended_at,
          active: r.is_active,
          hasLogin: r.has_login,
          advanceBalance: num(r.advance_balance),
          openTasks: Number(r.open_tasks),
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_employee_profile",
    {
      title: "Profil lengkap satu karyawan",
      description:
        "Detail satu karyawan: tarif + riwayat tarif, kontrak, kasbon berjalan, absensi 30 hari terakhir, cuti, tugas, dan slip gaji terakhir.",
      inputSchema: {
        ...ORG_ARG,
        employee: z.string().describe("Nama, kode, atau id karyawan."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, employee }) => {
      const target = await resolveOrg(org);
      const emp = await resolveEmployee(target, employee);
      const today = todayIn(target);

      const [profile] = await query<{
        id: string;
        code: string | null;
        full_name: string;
        pay_type: string;
        pay_rate: number;
        joined_at: string;
        ended_at: string | null;
        is_active: boolean;
        phone: string | null;
        has_login: boolean;
      }>(
        `select e.id, e.code, e.full_name, e.pay_type, e.pay_rate::float8 as pay_rate,
                e.joined_at, e.ended_at, e.is_active, u.phone_number as phone,
                (e.user_id is not null) as has_login
           from employees e
           left join "user" u on u.id = e.user_id
          where e.id = $1`,
        [emp.id],
      );

      const rates = await query<{ pay_type: string; pay_rate: number; effective_from: string }>(
        `select pay_type, pay_rate::float8 as pay_rate, effective_from
           from pay_rate_history where employee_id = $1
          order by effective_from desc limit 6`,
        [emp.id],
      );

      const contracts = await query<{
        id: string;
        contract_no: string | null;
        kind: string;
        start_date: string;
        end_date: string | null;
        pay_type: string;
        pay_rate: number;
        status: string;
        days_left: number | null;
      }>(
        `select id, contract_no, kind, start_date, end_date, pay_type, pay_rate::float8 as pay_rate, status,
                case when end_date is null then null else (end_date - current_date) end as days_left
           from contracts where employee_id = $1
          order by start_date desc limit 10`,
        [emp.id],
      );

      const advances = await query<{
        id: string;
        principal: number;
        balance: number;
        installment_amount: number | null;
        requested_at: string;
        status: string;
        note: string | null;
      }>(
        `select id, principal::float8 as principal, balance::float8 as balance,
                installment_amount::float8 as installment_amount, requested_at, status, note
           from cash_advances where employee_id = $1
          order by requested_at desc limit 20`,
        [emp.id],
      );

      const since = addDays(today, -30);
      const [attendance] = await query<{
        entries: number;
        approved: number;
        pending: number;
        open_entries: number;
        outside_geofence: number;
        minutes: number;
        overtime_minutes: number;
      }>(
        `select count(*) as entries,
                count(*) filter (where status = 'approved') as approved,
                count(*) filter (where status = 'pending') as pending,
                count(*) filter (where clock_out_at is null) as open_entries,
                count(*) filter (where within_geofence = false) as outside_geofence,
                coalesce(sum(extract(epoch from (clock_out_at - clock_in_at)) / 60), 0)::float8 as minutes,
                coalesce(sum(overtime_minutes), 0) as overtime_minutes
           from time_entries
          where employee_id = $1 and work_date between $2 and $3`,
        [emp.id, since, today],
      );

      const recentEntries = await query<{
        work_date: string;
        clock_in_at: string;
        clock_out_at: string | null;
        break_minutes: number;
        overtime_minutes: number;
        status: string;
        within_geofence: boolean | null;
      }>(
        `select work_date, clock_in_at, clock_out_at, break_minutes, overtime_minutes, status, within_geofence
           from time_entries where employee_id = $1
          order by work_date desc, clock_in_at desc limit 7`,
        [emp.id],
      );

      const leaves = await query<{
        kind: string;
        start_date: string;
        end_date: string;
        days: number;
        paid: boolean;
        status: string;
        note: string | null;
      }>(
        `select kind, start_date, end_date, days, paid, status, note
           from leaves where employee_id = $1
          order by start_date desc limit 8`,
        [emp.id],
      );

      const tasks = await query<{ status: string; total: number; qty: number }>(
        `select status, count(*) as total, coalesce(sum(qty), 0)::float8 as qty
           from work_tasks where employee_id = $1 group by status`,
        [emp.id],
      );

      const payslips = await query<{
        id: string;
        period_start: string;
        period_end: string;
        gross: number;
        total_deductions: number;
        net: number;
        status: string;
      }>(
        `select ps.id, pp.period_start, pp.period_end, ps.gross::float8 as gross,
                ps.total_deductions::float8 as total_deductions, ps.net::float8 as net, ps.status
           from payslips ps
           join pay_periods pp on pp.id = ps.pay_period_id
          where ps.employee_id = $1
          order by pp.period_start desc limit 3`,
        [emp.id],
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        employee: {
          id: profile.id,
          name: profile.full_name,
          code: profile.code,
          phone: profile.phone,
          hasLogin: profile.has_login,
          payType: profile.pay_type,
          payTypeLabel: PAY_TYPE_LABEL[profile.pay_type] ?? profile.pay_type,
          payRate: num(profile.pay_rate),
          joinedAt: profile.joined_at,
          endedAt: profile.ended_at,
          active: profile.is_active,
        },
        payRateHistory: rates.map((r) => ({
          payType: r.pay_type,
          payRate: num(r.pay_rate),
          effectiveFrom: r.effective_from,
        })),
        contracts: contracts.map((c) => ({
          id: c.id,
          contractNo: c.contract_no,
          kind: c.kind,
          startDate: c.start_date,
          endDate: c.end_date,
          payType: c.pay_type,
          payRate: num(c.pay_rate),
          status: c.status,
          daysUntilEnd: c.days_left === null ? null : Number(c.days_left),
        })),
        cashAdvances: {
          outstanding: round(advances.filter((a) => a.status === "approved").reduce((s, a) => s + num(a.balance), 0)),
          rows: advances.map((a) => ({
            id: a.id,
            principal: num(a.principal),
            balance: num(a.balance),
            installment: a.installment_amount === null ? null : num(a.installment_amount),
            requestedAt: a.requested_at,
            status: a.status,
            note: a.note,
          })),
        },
        attendance: {
          window: `${formatDateID(since)} – ${formatDateID(today)}`,
          entries: Number(attendance?.entries ?? 0),
          approved: Number(attendance?.approved ?? 0),
          pending: Number(attendance?.pending ?? 0),
          openEntries: Number(attendance?.open_entries ?? 0),
          outsideGeofence: Number(attendance?.outside_geofence ?? 0),
          workedHours: round(num(attendance?.minutes) / 60, 2),
          overtimeHours: round(num(attendance?.overtime_minutes) / 60, 2),
          recent: recentEntries.map((e) => ({
            workDate: e.work_date,
            clockIn: e.clock_in_at,
            clockOut: e.clock_out_at,
            breakMinutes: e.break_minutes,
            overtimeMinutes: e.overtime_minutes,
            status: e.status,
            withinGeofence: e.within_geofence,
          })),
        },
        leaves: leaves.map((l) => ({
          kind: l.kind,
          startDate: l.start_date,
          endDate: l.end_date,
          days: l.days,
          paid: l.paid,
          status: l.status,
          note: l.note,
        })),
        tasks: tasks.map((t) => ({ status: t.status, count: Number(t.total), qty: num(t.qty) })),
        recentPayslips: payslips.map((p) => ({
          id: p.id,
          period: `${p.period_start} – ${p.period_end}`,
          gross: num(p.gross),
          deductions: num(p.total_deductions),
          net: num(p.net),
          status: p.status,
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_contracts_expiring",
    {
      title: "Kontrak akan berakhir",
      description:
        "Kontrak aktif yang berakhir dalam N hari (default: contractAlertDays org, biasanya 60) atau sudah lewat tapi statusnya masih aktif.",
      inputSchema: {
        ...ORG_ARG,
        days: z.number().int().min(0).max(365).optional().describe("Ambang hari, default dari pengaturan org."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, days }) => {
      const target = await resolveOrg(org);
      const horizon = days ?? target.contractAlertDays;

      const rows = await query<{
        id: string;
        employee_id: string;
        full_name: string;
        contract_no: string | null;
        kind: string;
        start_date: string;
        end_date: string | null;
        status: string;
        days_left: number | null;
      }>(
        `select c.id, c.employee_id, e.full_name, c.contract_no, c.kind, c.start_date, c.end_date, c.status,
                case when c.end_date is null then null else (c.end_date - current_date) end as days_left
           from contracts c
           join employees e on e.id = c.employee_id
          where c.org_id = $1
            and c.status = 'active'
            and c.end_date is not null
            and c.end_date <= (current_date + $2::int)
          order by c.end_date`,
        [target.id, horizon],
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        horizonDays: horizon,
        count: rows.length,
        contracts: rows.map((c) => ({
          id: c.id,
          employeeId: c.employee_id,
          employee: c.full_name,
          contractNo: c.contract_no,
          kind: c.kind,
          startDate: c.start_date,
          endDate: c.end_date,
          status: c.status,
          daysLeft: c.days_left === null ? null : Number(c.days_left),
          expired: c.days_left !== null && Number(c.days_left) < 0,
        })),
      });
    },
  );
}
