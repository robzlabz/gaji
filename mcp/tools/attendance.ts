/**
 * Tool MCP: absensi (clock in/out), anomali, dan kotak masuk persetujuan.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { minutesToHoursLabel } from "../../src/lib/format";
import {
  currentPeriod,
  minutesBetween,
  num,
  query,
  resolveEmployee,
  resolveOrg,
  resolvePeriod,
  round,
  todayIn,
  toolResult,
  type Org,
} from "../core";

const ORG_ARG = {
  org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
};

/* ------------------------------------------------------------------ */
/* Fungsi bersama (dipakai juga oleh gaji_overview)                    */
/* ------------------------------------------------------------------ */

export async function attendanceLive(org: Org) {
  const today = todayIn(org);

  const open = await query<{
    id: string;
    employee: string;
    work_date: string;
    clock_in_at: string;
    within_geofence: boolean | null;
    status: string;
  }>(
    `select t.id, e.full_name as employee, t.work_date, t.clock_in_at, t.within_geofence, t.status
       from time_entries t
       join employees e on e.id = t.employee_id
      where t.org_id = $1 and t.clock_out_at is null
      order by t.clock_in_at`,
    [org.id],
  );

  const doneToday = await query<{
    employee: string;
    clock_in_at: string;
    clock_out_at: string;
    break_minutes: number;
    overtime_minutes: number;
    status: string;
    within_geofence: boolean | null;
  }>(
    `select e.full_name as employee, t.clock_in_at, t.clock_out_at, t.break_minutes,
            t.overtime_minutes, t.status, t.within_geofence
       from time_entries t
       join employees e on e.id = t.employee_id
      where t.org_id = $1 and t.work_date = $2 and t.clock_out_at is not null
      order by t.clock_in_at`,
    [org.id, today],
  );

  const absent = await query<{ id: string; employee: string; pay_type: string }>(
    `select e.id, e.full_name as employee, e.pay_type
       from employees e
      where e.org_id = $1
        and e.is_active
        and e.pay_type in ('hourly', 'daily')
        and not exists (
          select 1 from time_entries t where t.employee_id = e.id and t.work_date = $2
        )
      order by e.full_name`,
    [org.id, today],
  );

  const openToday = open.filter((o) => o.work_date === today);
  const staleOpen = open.filter((o) => o.work_date < today);

  return {
    date: today,
    onDutyNow: openToday.map((o) => ({
      entryId: o.id,
      employee: o.employee,
      clockIn: o.clock_in_at,
      workedFor: minutesToHoursLabel(minutesBetween(o.clock_in_at, new Date())),
      withinGeofence: o.within_geofence,
      status: o.status,
    })),
    staleOpenEntries: staleOpen.map((o) => ({
      entryId: o.id,
      employee: o.employee,
      workDate: o.work_date,
      clockIn: o.clock_in_at,
      note: "Belum clock-out sampai hari ini — tidak akan dihitung di payroll.",
    })),
    finishedToday: doneToday.map((d) => ({
      employee: d.employee,
      clockIn: d.clock_in_at,
      clockOut: d.clock_out_at,
      worked: minutesToHoursLabel(
        Math.max(0, minutesBetween(d.clock_in_at, d.clock_out_at) - (d.break_minutes ?? 0)),
      ),
      overtimeMinutes: d.overtime_minutes,
      status: d.status,
      withinGeofence: d.within_geofence,
    })),
    notClockedInYet: absent.map((a) => ({ employee: a.employee, payType: a.pay_type })),
    counts: {
      onDutyNow: openToday.length,
      finishedToday: doneToday.length,
      staleOpen: staleOpen.length,
      notClockedInYet: absent.length,
    },
  };
}

export async function pendingApprovals(org: Org) {
  const [attendance, leaves, advances, tasks] = await Promise.all([
    query<{
      id: string;
      employee: string;
      work_date: string;
      clock_in_at: string;
      clock_out_at: string | null;
      within_geofence: boolean | null;
      created_at: string;
    }>(
      `select t.id, e.full_name as employee, t.work_date, t.clock_in_at, t.clock_out_at,
              t.within_geofence, t.created_at
         from time_entries t join employees e on e.id = t.employee_id
        where t.org_id = $1 and t.status = 'pending'
        order by t.work_date desc limit 50`,
      [org.id],
    ),
    query<{
      id: string;
      employee: string;
      kind: string;
      start_date: string;
      end_date: string;
      days: number;
      paid: boolean;
      note: string | null;
      created_at: string;
    }>(
      `select l.id, e.full_name as employee, l.kind, l.start_date, l.end_date, l.days, l.paid, l.note, l.created_at
         from leaves l join employees e on e.id = l.employee_id
        where l.org_id = $1 and l.status = 'pending'
        order by l.start_date limit 50`,
      [org.id],
    ),
    query<{
      id: string;
      employee: string;
      principal: number;
      balance: number;
      installment_amount: number | null;
      requested_at: string;
      note: string | null;
    }>(
      `select ca.id, e.full_name as employee, ca.principal::float8 as principal,
              ca.balance::float8 as balance, ca.installment_amount::float8 as installment_amount,
              ca.requested_at, ca.note
         from cash_advances ca join employees e on e.id = ca.employee_id
        where ca.org_id = $1 and ca.status = 'pending'
        order by ca.requested_at limit 50`,
      [org.id],
    ),
    query<{
      id: string;
      employee: string | null;
      title: string;
      qty: number;
      unit: string;
      unit_rate: number;
      work_date: string;
      status: string;
    }>(
      `select wt.id, e.full_name as employee, wt.title, wt.qty::float8 as qty, wt.unit,
              wt.unit_rate::float8 as unit_rate, wt.work_date, wt.status
         from work_tasks wt left join employees e on e.id = wt.employee_id
        where wt.org_id = $1 and wt.status = 'done'
        order by wt.work_date limit 50`,
      [org.id],
    ),
  ]);

  return {
    counts: {
      attendance: attendance.length,
      leaves: leaves.length,
      cashAdvances: advances.length,
      tasks: tasks.length,
      total: attendance.length + leaves.length + advances.length + tasks.length,
    },
    attendance: attendance.map((a) => ({
      id: a.id,
      employee: a.employee,
      workDate: a.work_date,
      clockIn: a.clock_in_at,
      clockOut: a.clock_out_at,
      withinGeofence: a.within_geofence,
      submittedAt: a.created_at,
    })),
    leaves: leaves.map((l) => ({
      id: l.id,
      employee: l.employee,
      kind: l.kind,
      startDate: l.start_date,
      endDate: l.end_date,
      days: l.days,
      paid: l.paid,
      note: l.note,
      requestedAt: l.created_at,
    })),
    cashAdvances: advances.map((c) => ({
      id: c.id,
      employee: c.employee,
      principal: num(c.principal),
      balance: num(c.balance),
      installment: c.installment_amount === null ? null : num(c.installment_amount),
      requestedAt: c.requested_at,
      note: c.note,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      employee: t.employee,
      title: t.title,
      qty: num(t.qty),
      unit: t.unit,
      unitRate: num(t.unit_rate),
      value: round(num(t.qty) * num(t.unit_rate)),
      workDate: t.work_date,
    })),
  };
}

/* ------------------------------------------------------------------ */

export function registerAttendanceTools(server: McpServer) {
  server.registerTool(
    "gaji_attendance_report",
    {
      title: "Rekap absensi per karyawan",
      description:
        "Rekap kehadiran dalam rentang tanggal (default: periode gaji berjalan): jumlah entri, jam kerja, lembur, entri belum clock-out, di luar geofence, dan yang belum di-approve. Plus daftar anomali.",
      inputSchema: {
        ...ORG_ARG,
        from: z.string().optional().describe("Tanggal awal YYYY-MM-DD (default awal periode berjalan)."),
        to: z.string().optional().describe("Tanggal akhir YYYY-MM-DD (default akhir periode berjalan)."),
        employee: z.string().optional().describe("Batasi ke satu karyawan (nama/kode/id)."),
        onlyWithEntries: z.boolean().optional().describe("Sembunyikan karyawan tanpa entri absensi."),
        includeEntries: z.boolean().optional().describe("Sertakan baris absensi mentah (default false)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, from, to, employee, onlyWithEntries, includeEntries }) => {
      const target = await resolveOrg(org);
      const period = currentPeriod(target);
      const start = from ?? period.start;
      const end = to ?? period.end;

      const emp = employee ? await resolveEmployee(target, employee) : null;

      const params: unknown[] = [target.id, start, end];
      let empFilter = "";
      if (emp) {
        params.push(emp.id);
        empFilter = `and e.id = $${params.length}`;
      }

      const rows = await query<{
        id: string;
        code: string | null;
        full_name: string;
        pay_type: string;
        entries: number;
        approved: number;
        pending: number;
        rejected: number;
        open_entries: number;
        outside_geofence: number;
        gross_minutes: number;
        break_minutes: number;
        overtime_minutes: number;
        last_work_date: string | null;
      }>(
        `select e.id, e.code, e.full_name, e.pay_type,
                count(t.id) as entries,
                count(t.id) filter (where t.status = 'approved') as approved,
                count(t.id) filter (where t.status = 'pending') as pending,
                count(t.id) filter (where t.status = 'rejected') as rejected,
                count(t.id) filter (where t.clock_out_at is null) as open_entries,
                count(t.id) filter (where t.within_geofence = false) as outside_geofence,
                coalesce(sum(extract(epoch from (t.clock_out_at - t.clock_in_at)) / 60), 0)::float8 as gross_minutes,
                coalesce(sum(t.break_minutes), 0)::int as break_minutes,
                coalesce(sum(t.overtime_minutes), 0)::int as overtime_minutes,
                max(t.work_date) as last_work_date
           from employees e
           left join time_entries t
             on t.employee_id = e.id and t.work_date between $2 and $3
          where e.org_id = $1 and e.is_active ${empFilter}
          group by e.id, e.code, e.full_name, e.pay_type
          order by e.full_name`,
        params,
      );

      const anomalies = await query<{
        id: string;
        employee: string;
        work_date: string;
        clock_in_at: string;
        clock_out_at: string | null;
        status: string;
        within_geofence: boolean | null;
        minutes: number | null;
      }>(
        `select t.id, e.full_name as employee, t.work_date, t.clock_in_at, t.clock_out_at, t.status,
                t.within_geofence,
                extract(epoch from (t.clock_out_at - t.clock_in_at)) / 60 as minutes
           from time_entries t join employees e on e.id = t.employee_id
          where t.org_id = $1 and t.work_date between $2 and $3
            and (t.clock_out_at is null or t.within_geofence = false or t.status <> 'approved')
          order by t.work_date desc, e.full_name
          limit 100`,
        [target.id, start, end],
      );

      const entries = includeEntries
        ? await query<{
            id: string;
            employee: string;
            work_date: string;
            clock_in_at: string;
            clock_out_at: string | null;
            break_minutes: number;
            overtime_minutes: number;
            status: string;
            within_geofence: boolean | null;
            source: string;
          }>(
            `select t.id, e.full_name as employee, t.work_date, t.clock_in_at, t.clock_out_at,
                    t.break_minutes, t.overtime_minutes, t.status, t.within_geofence, t.source
               from time_entries t join employees e on e.id = t.employee_id
              where t.org_id = $1 and t.work_date between $2 and $3 ${empFilter}
              order by t.work_date desc, t.clock_in_at desc
              limit 500`,
            emp ? [target.id, start, end, emp.id] : [target.id, start, end],
          )
        : [];

      const visible = (onlyWithEntries ? rows.filter((r) => Number(r.entries) > 0) : rows).map((r) => {
        const workedMinutes = Math.max(0, num(r.gross_minutes) - num(r.break_minutes));
        return {
          employeeId: r.id,
          employee: r.full_name,
          code: r.code,
          payType: r.pay_type,
          entries: Number(r.entries),
          approved: Number(r.approved),
          pending: Number(r.pending),
          rejected: Number(r.rejected),
          openEntries: Number(r.open_entries),
          outsideGeofence: Number(r.outside_geofence),
          workedHours: round(workedMinutes / 60, 2),
          overtimeHours: round(num(r.overtime_minutes) / 60, 2),
          lastWorkDate: r.last_work_date,
        };
      });

      const totals = visible.reduce(
        (acc, r) => ({
          entries: acc.entries + r.entries,
          workedHours: round(acc.workedHours + r.workedHours, 2),
          overtimeHours: round(acc.overtimeHours + r.overtimeHours, 2),
          openEntries: acc.openEntries + r.openEntries,
          pending: acc.pending + r.pending,
        }),
        { entries: 0, workedHours: 0, overtimeHours: 0, openEntries: 0, pending: 0 },
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        range: { from: start, to: end },
        totals,
        employees: visible,
        anomalies: anomalies.map((a) => ({
          entryId: a.id,
          employee: a.employee,
          workDate: a.work_date,
          clockIn: a.clock_in_at,
          clockOut: a.clock_out_at,
          status: a.status,
          withinGeofence: a.within_geofence,
          workedHours: a.minutes === null ? null : round(num(a.minutes) / 60, 2),
          issue: !a.clock_out_at
            ? "belum clock-out"
            : a.within_geofence === false
              ? "clock-in di luar geofence"
              : `status ${a.status}`,
        })),
        entries: entries.map((e) => ({
          id: e.id,
          employee: e.employee,
          workDate: e.work_date,
          clockIn: e.clock_in_at,
          clockOut: e.clock_out_at,
          breakMinutes: e.break_minutes,
          overtimeMinutes: e.overtime_minutes,
          status: e.status,
          withinGeofence: e.within_geofence,
          source: e.source,
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_attendance_live",
    {
      title: "Absensi hari ini (real-time)",
      description:
        "Siapa yang sedang bekerja sekarang, siapa sudah selesai, siapa belum clock-in hari ini, dan entri menggantung dari hari sebelumnya.",
      inputSchema: { ...ORG_ARG },
      annotations: { readOnlyHint: true },
    },
    async ({ org }) => {
      const target = await resolveOrg(org);
      const live = await attendanceLive(target);
      return toolResult({ org: { slug: target.slug, name: target.name }, ...live });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_pending_approvals",
    {
      title: "Kotak masuk persetujuan",
      description:
        "Semua yang menunggu keputusan admin: absensi pending, cuti pending, kasbon pending, dan tugas berstatus 'done' yang belum di-approve.",
      inputSchema: { ...ORG_ARG },
      annotations: { readOnlyHint: true },
    },
    async ({ org }) => {
      const target = await resolveOrg(org);
      const pending = await pendingApprovals(target);
      return toolResult({ org: { slug: target.slug, name: target.name }, ...pending });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_leaves",
    {
      title: "Daftar cuti / sakit / izin",
      description:
        "Pengajuan cuti pada rentang tanggal atau status tertentu, termasuk berapa hari dan apakah berbayar (hanya karyawan bulanan yang punya cuti).",
      inputSchema: {
        ...ORG_ARG,
        status: z.enum(["pending", "approved", "rejected", "void"]).optional(),
        from: z.string().optional().describe("Awal rentang YYYY-MM-DD (default awal periode berjalan)."),
        to: z.string().optional().describe("Akhir rentang YYYY-MM-DD (default akhir periode berjalan)."),
        employee: z.string().optional().describe("Batasi ke satu karyawan (nama/kode/id)."),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, status, from, to, employee, limit }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, {});
      const start = from ?? resolved.period.start;
      const end = to ?? resolved.period.end;

      const params: unknown[] = [target.id, start, end];
      const filters = [`l.org_id = $1`, `l.start_date <= $3`, `l.end_date >= $2`];

      if (status) {
        params.push(status);
        filters.push(`l.status = $${params.length}`);
      }
      if (employee) {
        const emp = await resolveEmployee(target, employee);
        params.push(emp.id);
        filters.push(`l.employee_id = $${params.length}`);
      }
      params.push(limit ?? 100);

      const rows = await query<{
        id: string;
        employee: string;
        kind: string;
        start_date: string;
        end_date: string;
        days: number;
        paid: boolean;
        status: string;
        note: string | null;
        reject_reason: string | null;
        approved_at: string | null;
      }>(
        `select l.id, e.full_name as employee, l.kind, l.start_date, l.end_date, l.days, l.paid,
                l.status, l.note, l.reject_reason, l.approved_at
           from leaves l join employees e on e.id = l.employee_id
          where ${filters.join(" and ")}
          order by l.start_date desc
          limit $${params.length}`,
        params,
      );

      const summary = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});

      return toolResult({
        org: { slug: target.slug, name: target.name },
        range: { from: start, to: end },
        byStatus: summary,
        count: rows.length,
        leaves: rows.map((l) => ({
          id: l.id,
          employee: l.employee,
          kind: l.kind,
          startDate: l.start_date,
          endDate: l.end_date,
          days: l.days,
          paid: l.paid,
          status: l.status,
          note: l.note,
          rejectReason: l.reject_reason,
          approvedAt: l.approved_at,
        })),
      });
    },
  );
}
