import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workTasks } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { markTaskDoneAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, btnPrimary } from "@/components/ui";
import { formatDateID, rupiah, toNumber } from "@/lib/utils";

export default async function EmployeeTasks({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { employee } = await requireEmployee();
  const { ok, err } = await searchParams;

  const rows = await db
    .select()
    .from(workTasks)
    .where(and(eq(workTasks.employeeId, employee.id)))
    .orderBy(desc(workTasks.workDate))
    .limit(60);

  const open = rows.filter((row) => row.status === "open");
  const waiting = rows.filter((row) => row.status === "done");
  const done = rows.filter((row) => row.status === "approved" || row.status === "rejected");

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold text-stone-900">Tugas saya</h1>
        <p className="text-xs text-muted">Tandai selesai setelah pekerjaan rampung. Admin yang menyetujui.</p>
      </header>

      <Flash ok={ok} err={err} />

      <Card title="Belum selesai" subtitle={`${open.length} tugas`}>
        {open.length === 0 ? (
          <EmptyState title="Tidak ada tugas aktif" />
        ) : (
          <ul className="space-y-2">
            {open.map((task) => (
              <li key={task.id} className="rounded-xl border border-line p-3">
                <p className="text-sm font-medium text-stone-900">{task.title}</p>
                <p className="text-xs text-muted">
                  {toNumber(task.qty)} {task.unit} × {rupiah(toNumber(task.unitRate))} ={" "}
                  {rupiah(toNumber(task.qty) * toNumber(task.unitRate))} · {formatDateID(task.workDate)}
                </p>
                <form action={markTaskDoneAction} className="mt-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <button type="submit" className={`${btnPrimary} px-3 py-1.5 text-xs`}>
                    Tandai selesai
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {waiting.length > 0 && (
        <Card title="Menunggu approval">
          <ul className="space-y-2">
            {waiting.map((task) => (
              <li key={task.id} className="flex items-center justify-between text-sm">
                <span className="text-stone-800">{task.title}</span>
                <Badge tone="warn">menunggu</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Selesai">
        {done.length === 0 ? (
          <EmptyState title="Belum ada tugas selesai" />
        ) : (
          <ul className="divide-y divide-line">
            {done.map((task) => (
              <li key={task.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-stone-700">{task.title}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-xs text-muted">
                    {rupiah(toNumber(task.qty) * toNumber(task.unitRate))}
                  </span>
                  <Badge tone={task.status === "approved" ? "good" : "bad"}>{task.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
