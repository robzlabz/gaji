import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, workTasks } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createTaskAction, decideTaskAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Table, Td, btnDanger, btnPrimary, inputClass } from "@/components/ui";
import { formatDateID, localDateString, rupiah, toNumber } from "@/lib/utils";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  const [staff, tasks] = await Promise.all([
    db
      .select({ id: employees.id, fullName: employees.fullName, payType: employees.payType })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
      .orderBy(employees.fullName),
    db
      .select({
        id: workTasks.id,
        title: workTasks.title,
        qty: workTasks.qty,
        unit: workTasks.unit,
        unitRate: workTasks.unitRate,
        status: workTasks.status,
        workDate: workTasks.workDate,
        employeeId: workTasks.employeeId,
        employeeName: employees.fullName,
      })
      .from(workTasks)
      .leftJoin(employees, eq(workTasks.employeeId, employees.id))
      .where(eq(workTasks.orgId, org.id))
      .orderBy(desc(workTasks.workDate))
      .limit(100),
  ]);

  const pending = tasks.filter((task) => task.status === "done" || task.status === "open");

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-stone-900">Tugas</h1>
        <p className="text-sm text-muted">
          Dipakai untuk karyawan bertipe <strong>per tugas</strong>. Hanya tugas approved masuk payroll.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card title="Buat tugas">
        <form action={createTaskAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Judul tugas" className="sm:col-span-2">
            <input name="title" className={inputClass} placeholder="Potong 20 pcs bahan kaos" required />
          </Field>
          <Field label="Karyawan" hint="Kosongkan bila belum ditentukan">
            <select name="employeeId" className={inputClass} defaultValue="">
              <option value="">— belum ditentukan —</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jumlah (qty)">
            <input name="qty" className={inputClass} inputMode="decimal" defaultValue="1" />
          </Field>
          <Field label="Satuan">
            <input name="unit" className={inputClass} defaultValue="tugas" />
          </Field>
          <Field label="Tarif per satuan (Rp)">
            <input name="unitRate" className={inputClass} inputMode="numeric" placeholder="15000" required />
          </Field>
          <Field label="Tanggal kerja">
            <input type="date" name="workDate" className={inputClass} defaultValue={today} />
          </Field>
          <Field label="Deskripsi" className="sm:col-span-2">
            <input name="description" className={inputClass} placeholder="opsional" />
          </Field>
          <div className="flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>
              Simpan tugas
            </button>
          </div>
        </form>
      </Card>

      {pending.length > 0 && (
        <Card title="Perlu persetujuan" subtitle="Tugas yang sudah dikerjakan karyawan menunggu approval.">
          <div className="space-y-2">
            {pending.map((task) => (
              <form
                key={task.id}
                action={decideTaskAction}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2"
              >
                <input type="hidden" name="taskId" value={task.id} />
                <div>
                  <p className="text-sm font-medium text-stone-900">{task.title}</p>
                  <p className="text-xs text-muted">
                    {task.employeeName ?? "belum ada karyawan"} · {toNumber(task.qty)} {task.unit} ×{" "}
                    {rupiah(toNumber(task.unitRate))} ={" "}
                    {rupiah(toNumber(task.qty) * toNumber(task.unitRate))} · {formatDateID(task.workDate)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge tone={task.status === "done" ? "warn" : "default"}>{task.status}</Badge>
                  <button type="submit" name="decision" value="approve" className={`${btnPrimary} h-8 px-3 text-xs`}>
                    Setujui
                  </button>
                  <button type="submit" name="decision" value="reject" className={`${btnDanger} h-8 px-3 text-xs`}>
                    Tolak
                  </button>
                </div>
              </form>
            ))}
          </div>
        </Card>
      )}

      <Card title="Semua tugas">
        {tasks.length === 0 ? (
          <EmptyState title="Belum ada tugas" />
        ) : (
          <Table head={["Tugas", "Karyawan", "Qty", "Nilai", "Tanggal", "Status"]}>
            {tasks.map((task) => (
              <tr key={task.id}>
                <Td className="font-medium text-stone-900">{task.title}</Td>
                <Td>
                  {task.employeeId ? (
                    <Link href={`/admin/karyawan/${task.employeeId}`} className="text-brand">
                      {task.employeeName}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td className="tabular-nums text-stone-600">
                  {toNumber(task.qty)} {task.unit}
                </Td>
                <Td className="tabular-nums">{rupiah(toNumber(task.qty) * toNumber(task.unitRate))}</Td>
                <Td className="tabular-nums text-stone-600">{formatDateID(task.workDate)}</Td>
                <Td>
                  <Badge
                    tone={
                      task.status === "approved"
                        ? "good"
                        : task.status === "rejected"
                          ? "bad"
                          : task.status === "done"
                            ? "warn"
                            : "default"
                    }
                  >
                    {task.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
