/**
 * Tool MCP: kasbon (saldo, rencana potong, buku transaksi), tugas, audit log,
 * dan query bebas read-only.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAdvanceDeduction } from "../../src/lib/kasbon";
import {
  num,
  query,
  resolveEmployee,
  resolveOrg,
  resolvePeriod,
  round,
  toolResult,
} from "../core";

const ORG_ARG = {
  org: z.string().optional().describe("Slug/nama/id organisasi. Kosongkan bila hanya ada satu tenant."),
};

export function registerOpsTools(server: McpServer) {
  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_kasbon",
    {
      title: "Kasbon berjalan",
      description:
        "Kasbon per karyawan: pokok, sisa saldo, cicilan, dan berapa yang akan dipotong pada periode ini (mengikuti keputusan potong/tunda di cash_advance_plans).",
      inputSchema: {
        ...ORG_ARG,
        status: z.enum(["pending", "approved", "rejected", "paid"]).optional().describe("Default: approved."),
        employee: z.string().optional().describe("Batasi ke satu karyawan."),
        periodStart: z.string().optional().describe("Awal periode untuk melihat rencana potong (YYYY-MM-DD)."),
        onlyOutstanding: z.boolean().optional().describe("Hanya yang saldonya masih > 0 (default true)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, status, employee, periodStart, onlyOutstanding }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, { periodStart });
      const emp = employee ? await resolveEmployee(target, employee) : null;

      const params: unknown[] = [target.id];
      const filters = ["ca.org_id = $1"];
      params.push(status ?? "approved");
      filters.push(`ca.status = $${params.length}`);
      if (emp) {
        params.push(emp.id);
        filters.push(`ca.employee_id = $${params.length}`);
      }
      if (onlyOutstanding !== false) filters.push("ca.balance > 0");

      const [advances, plans] = await Promise.all([
        query<{
          id: string;
          employee_id: string;
          employee: string;
          principal: number;
          balance: number;
          installment_amount: number | null;
          requested_at: string;
          status: string;
          note: string | null;
          paid_total: number;
        }>(
          `select ca.id, ca.employee_id, e.full_name as employee,
                  ca.principal::float8 as principal, ca.balance::float8 as balance,
                  ca.installment_amount::float8 as installment_amount, ca.requested_at, ca.status, ca.note,
                  coalesce((select sum(t.amount) from cash_advance_txns t
                             where t.cash_advance_id = ca.id and t.kind in ('repay', 'deduct', 'to_saldo')), 0)::float8 as paid_total
             from cash_advances ca join employees e on e.id = ca.employee_id
            where ${filters.join(" and ")}
            order by ca.requested_at`,
          params,
        ),
        query<{ cash_advance_id: string; decision: string; amount: string | null; note: string | null }>(
          `select cash_advance_id, decision, amount, note
             from cash_advance_plans where org_id = $1 and period_start = $2`,
          [target.id, resolved.period.start],
        ),
      ]);

      const planByAdvance = new Map(
        plans.map((p) => [
          p.cash_advance_id,
          { cashAdvanceId: p.cash_advance_id, decision: p.decision, amount: p.amount, note: p.note },
        ]),
      );

      const rows = advances.map((a) => {
        const plan = planByAdvance.get(a.id);
        const decision = resolveAdvanceDeduction(
          {
            id: a.id,
            balance: a.balance,
            installmentAmount: a.installment_amount,
            requestedAt: a.requested_at,
          },
          plan,
        );

        return {
          id: a.id,
          employeeId: a.employee_id,
          employee: a.employee,
          principal: num(a.principal),
          balance: num(a.balance),
          installment: a.installment_amount === null ? null : num(a.installment_amount),
          repaidSoFar: num(a.paid_total),
          requestedAt: a.requested_at,
          status: a.status,
          note: a.note,
          thisPeriod: {
            deduct: decision.amount,
            deferred: decision.deferred,
            source: decision.source,
            plannedBy: plan ? plan.decision : "default",
          },
        };
      });

      return toolResult({
        org: { slug: target.slug, name: target.name },
        period: { label: resolved.label, start: resolved.period.start, end: resolved.period.end },
        summary: {
          count: rows.length,
          outstandingTotal: round(rows.reduce((s, r) => s + r.balance, 0)),
          deductThisPeriod: round(rows.reduce((s, r) => s + r.thisPeriod.deduct, 0)),
          deferredCount: rows.filter((r) => r.thisPeriod.deferred).length,
        },
        advances: rows,
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_kasbon_txns",
    {
      title: "Buku kasbon (pinjam & potong)",
      description:
        "Riwayat transaksi kasbon: kapan uang diberikan (`disburse`) dan kapan dipotong lewat slip gaji (`repay`), termasuk slip mana yang memotong, serta sisa kasbon yang dipindah admin ke saldo karyawan (`to_saldo`). Dipakai untuk menjawab 'kasbon Rina sudah dipotong berapa kali / berapa total'.",
      inputSchema: {
        ...ORG_ARG,
        employee: z.string().optional().describe("Batasi ke satu karyawan (nama/kode/id)."),
        kind: z.enum(["disburse", "repay", "to_saldo", "all"]).optional().describe("Default: all."),
        since: z.string().optional().describe("Hanya transaksi sejak tanggal ini (YYYY-MM-DD)."),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, employee, kind, since, limit }) => {
      const target = await resolveOrg(org);
      const emp = employee ? await resolveEmployee(target, employee) : null;

      const params: unknown[] = [target.id];
      const filters = ["ca.org_id = $1"];
      if (emp) {
        params.push(emp.id);
        filters.push(`ca.employee_id = $${params.length}`);
      }
      if (kind && kind !== "all") {
        params.push(kind);
        filters.push(`t.kind = $${params.length}`);
      }
      if (since) {
        params.push(since);
        filters.push(`t.occurred_at >= $${params.length}::date`);
      }
      params.push(limit ?? 100);

      const rows = await query<{
        id: string;
        advance_id: string;
        employee: string;
        kind: string;
        amount: number;
        occurred_at: string;
        payslip_id: string | null;
        note: string | null;
        created_by: string | null;
        balance: number;
        principal: number;
      }>(
        `select t.id::text as id, ca.id as advance_id, e.full_name as employee, t.kind,
                t.amount::float8 as amount, t.occurred_at, t.payslip_id, t.note,
                u.name as created_by, ca.balance::float8 as balance, ca.principal::float8 as principal
           from cash_advance_txns t
           join cash_advances ca on ca.id = t.cash_advance_id
           join employees e on e.id = ca.employee_id
           left join "user" u on u.id = t.created_by
          where ${filters.join(" and ")}
          order by t.occurred_at desc, t.created_at desc
          limit $${params.length}`,
        params,
      );

      const txns = rows.map((t) => ({
        id: t.id,
        advanceId: t.advance_id,
        employee: t.employee,
        kind: t.kind,
        amount: num(t.amount),
        occurredAt: t.occurred_at,
        payslipId: t.payslip_id,
        viaPayslip: t.payslip_id !== null,
        note: t.note,
        createdBy: t.created_by,
      }));

      const disbursed = txns.filter((t) => t.kind === "disburse").reduce((s, t) => s + t.amount, 0);
      const repaid = txns.filter((t) => t.kind === "repay").reduce((s, t) => s + t.amount, 0);
      const movedToSaldo = txns.filter((t) => t.kind === "to_saldo").reduce((s, t) => s + t.amount, 0);

      const perAdvance = new Map<
        string,
        {
          advanceId: string;
          employee: string;
          principal: number;
          balance: number;
          disbursed: number;
          repaid: number;
          movedToSaldo: number;
          txns: number;
        }
      >();
      for (const row of rows) {
        const bucket = perAdvance.get(row.advance_id) ?? {
          advanceId: row.advance_id,
          employee: row.employee,
          principal: num(row.principal),
          balance: num(row.balance),
          disbursed: 0,
          repaid: 0,
          movedToSaldo: 0,
          txns: 0,
        };
        bucket.txns += 1;
        if (row.kind === "disburse") bucket.disbursed = round(bucket.disbursed + num(row.amount));
        if (row.kind === "repay") bucket.repaid = round(bucket.repaid + num(row.amount));
        if (row.kind === "to_saldo") bucket.movedToSaldo = round(bucket.movedToSaldo + num(row.amount));
        perAdvance.set(row.advance_id, bucket);
      }

      return toolResult({
        org: { slug: target.slug, name: target.name },
        employee: emp ? { id: emp.id, name: emp.fullName } : null,
        summary: {
          count: txns.length,
          disbursed: round(disbursed),
          repaid: round(repaid),
          movedToSaldo: round(movedToSaldo),
          repayViaPayslip: txns.filter((t) => t.kind === "repay" && t.viaPayslip).length,
        },
        perAdvance: [...perAdvance.values()],
        transactions: txns,
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_tasks",
    {
      title: "Rekap tugas (karyawan per tugas)",
      description:
        "Tugas borongan/per-tugas pada rentang tanggal: status open/done/approved/rejected, qty, dan nilai (qty × tarif).",
      inputSchema: {
        ...ORG_ARG,
        from: z.string().optional().describe("Awal rentang YYYY-MM-DD (default awal periode berjalan)."),
        to: z.string().optional().describe("Akhir rentang YYYY-MM-DD (default akhir periode berjalan)."),
        status: z.enum(["open", "done", "approved", "rejected"]).optional(),
        employee: z.string().optional().describe("Batasi ke satu karyawan."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, from, to, status, employee }) => {
      const target = await resolveOrg(org);
      const resolved = await resolvePeriod(target, {});
      const start = from ?? resolved.period.start;
      const end = to ?? resolved.period.end;

      const params: unknown[] = [target.id, start, end];
      const filters = ["wt.org_id = $1", "wt.work_date between $2 and $3"];
      if (status) {
        params.push(status);
        filters.push(`wt.status = $${params.length}`);
      }
      if (employee) {
        const emp = await resolveEmployee(target, employee);
        params.push(emp.id);
        filters.push(`wt.employee_id = $${params.length}`);
      }

      const rows = await query<{
        id: string;
        employee: string | null;
        title: string;
        qty: number;
        unit: string;
        unit_rate: number;
        status: string;
        work_date: string;
        done_at: string | null;
      }>(
        `select wt.id, e.full_name as employee, wt.title, wt.qty::float8 as qty, wt.unit,
                wt.unit_rate::float8 as unit_rate, wt.status, wt.work_date, wt.done_at
           from work_tasks wt left join employees e on e.id = wt.employee_id
          where ${filters.join(" and ")}
          order by wt.work_date desc, wt.title
          limit 500`,
        params,
      );

      const tasks = rows.map((t) => ({
        id: t.id,
        employee: t.employee,
        title: t.title,
        qty: num(t.qty),
        unit: t.unit,
        unitRate: num(t.unit_rate),
        value: round(num(t.qty) * num(t.unit_rate)),
        status: t.status,
        workDate: t.work_date,
        doneAt: t.done_at,
      }));

      const byStatus: Record<string, { count: number; value: number }> = {};
      for (const task of tasks) {
        const bucket = (byStatus[task.status] ??= { count: 0, value: 0 });
        bucket.count += 1;
        bucket.value = round(bucket.value + task.value);
      }

      return toolResult({
        org: { slug: target.slug, name: target.name },
        range: { from: start, to: end },
        byStatus,
        count: tasks.length,
        tasks,
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_audit_log",
    {
      title: "Audit log aktivitas",
      description:
        "Jejak perubahan data terakhir (siapa mengubah apa). Cocok untuk memantau aksi admin: approve absensi, ubah tarif, hapus data, dsb.",
      inputSchema: {
        ...ORG_ARG,
        limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
        entity: z.string().optional().describe("Filter entitas, mis. employees, time_entries, payslips."),
        action: z.string().optional().describe("Filter aksi, mis. create, update, delete, approve."),
        since: z.string().optional().describe("Hanya perubahan setelah tanggal ini (YYYY-MM-DD)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ org, limit, entity, action, since }) => {
      const target = await resolveOrg(org);

      const params: unknown[] = [target.id];
      const filters = ["a.org_id = $1"];
      if (entity) {
        params.push(entity);
        filters.push(`a.entity = $${params.length}`);
      }
      if (action) {
        params.push(action);
        filters.push(`a.action = $${params.length}`);
      }
      if (since) {
        params.push(since);
        filters.push(`a.created_at >= $${params.length}::date`);
      }
      params.push(limit ?? 50);

      const rows = await query<{
        id: string;
        actor: string | null;
        entity: string;
        entity_id: string | null;
        action: string;
        diff: unknown;
        created_at: string;
      }>(
        `select a.id::text as id, u.name as actor, a.entity, a.entity_id, a.action, a.diff, a.created_at
           from audit_logs a left join "user" u on u.id = a.actor_id
          where ${filters.join(" and ")}
          order by a.created_at desc
          limit $${params.length}`,
        params,
      );

      return toolResult({
        org: { slug: target.slug, name: target.name },
        count: rows.length,
        entries: rows.map((r) => ({
          id: r.id,
          at: r.created_at,
          actor: r.actor,
          entity: r.entity,
          entityId: r.entity_id,
          action: r.action,
          diff: r.diff,
        })),
      });
    },
  );

  /* ---------------------------------------------------------------- */
  server.registerTool(
    "gaji_query",
    {
      title: "Query SQL read-only (escape hatch)",
      description:
        "Jalankan satu SELECT/WITH bebas untuk pertanyaan yang tidak tercakup tool lain. Selalu dijalankan dalam transaksi read-only, maksimal 200 baris dikembalikan. Tabel utama: employees, time_entries, work_tasks, cash_advances, cash_advance_plans, cash_advance_txns, leaves, pay_periods, payslips, payslip_items, contracts, audit_logs. Hampir semua punya kolom org_id — filter dengan itu.",
      inputSchema: {
        sql: z.string().describe("Satu statement SELECT atau WITH (tanpa titik koma tambahan)."),
        params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
          .describe("Nilai untuk placeholder $1, $2, ..."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sql: statement, params }) => {
      const text = statement.trim().replace(/;+\s*$/, "");

      if (!/^(select|with)\b/i.test(text)) {
        throw new Error("Hanya SELECT atau WITH yang diizinkan di tool ini.");
      }
      if (text.includes(";")) {
        throw new Error("Kirim satu statement saja (tanpa titik koma di tengah).");
      }

      const rows = await query<Record<string, unknown>>(text, params ?? []);
      const MAX = 200;

      return toolResult({
        rowCount: rows.length,
        truncated: rows.length > MAX,
        rows: rows.slice(0, MAX),
      });
    },
  );
}
