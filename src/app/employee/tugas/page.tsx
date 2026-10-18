import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workTasks } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { markTaskDoneAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID, rupiah, toNumber } from "@/lib/format";

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
        <h1 className="text-lg font-semibold tracking-tight">Tugas saya</h1>
        <p className="text-xs text-muted-foreground">
          Tandai selesai setelah pekerjaan rampung. Admin yang menyetujui.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Belum selesai</CardTitle>
          <CardDescription>{open.length} tugas</CardDescription>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <EmptyState title="Tidak ada tugas aktif" />
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((task) => (
                <li key={task.id} className="rounded-xl border p-3">
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {toNumber(task.qty)} {task.unit} × {rupiah(toNumber(task.unitRate))} ={" "}
                    {rupiah(toNumber(task.qty) * toNumber(task.unitRate))} ·{" "}
                    {formatDateID(task.workDate)}
                  </p>
                  <form action={markTaskDoneAction} className="mt-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <Button type="submit" size="sm">
                      Tandai selesai
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {waiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Menunggu approval</CardTitle>
            <CardDescription>{waiting.length} tugas sudah ditandai selesai</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {waiting.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{task.title}</span>
                  <StatusBadge tone="warn">menunggu</StatusBadge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Selesai</CardTitle>
          <CardDescription>{done.length} tugas sudah diputuskan admin</CardDescription>
        </CardHeader>
        <CardContent>
          {done.length === 0 ? (
            <EmptyState title="Belum ada tugas selesai" />
          ) : (
            <ul className="flex flex-col divide-y">
              {done.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {rupiah(toNumber(task.qty) * toNumber(task.unitRate))}
                    </span>
                    <StatusBadge tone={task.status === "approved" ? "good" : "bad"}>
                      {statusLabel(task.status)}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
