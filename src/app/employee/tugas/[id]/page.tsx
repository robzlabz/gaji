import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workTasks } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { updateTaskAction } from "../../actions";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { TaskForm } from "@/components/employee/task-form";
import { statusLabel } from "@/lib/labels";
import { isTaskEditable, taskStatusTone } from "@/lib/task";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID, rupiah, toNumber } from "@/lib/format";

export const metadata = { title: "Ubah tugas — Gaji" };

/** Halaman tersendiri untuk mengubah tugas yang belum diputuskan admin. */
export default async function EditEmployeeTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [task] = await db
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.id, id),
        eq(workTasks.orgId, org.id),
        eq(workTasks.employeeId, employee.id),
      ),
    )
    .limit(1);

  if (!task) notFound();

  const editable = isTaskEditable(task.status);

  return (
    <>
      <header>
        <Link href="/employee/tugas" className="text-xs text-muted-foreground hover:underline">
          ← Tugas saya
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ubah tugas</h1>
        <p className="text-xs text-muted-foreground">
          {editable
            ? "Perubahan hanya bisa dilakukan sebelum admin memutuskan."
            : "Tugas ini sudah diputuskan admin, jadi isinya terkunci."}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{task.title}</span>
            <StatusBadge tone={taskStatusTone(task.status)}>
              {statusLabel(task.status)}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            {formatDateID(task.workDate)} · {toNumber(task.qty)} {task.unit} ·{" "}
            {toNumber(task.unitRate) > 0
              ? `${rupiah(toNumber(task.unitRate))} / ${task.unit}`
              : "harga belum diisi admin"}
          </CardDescription>
        </CardHeader>
      </Card>

      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Detail tugas</CardTitle>
            <CardDescription>Perbaiki isinya bila ada yang salah tulis.</CardDescription>
          </CardHeader>
          <CardContent>
            <TaskForm
              action={updateTaskAction}
              taskId={task.id}
              defaults={{
                title: task.title,
                qty: toNumber(task.qty),
                unit: task.unit,
                workDate: task.workDate,
                description: task.description,
              }}
              submitLabel="Simpan perubahan"
              cancelHref="/employee/tugas"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Tidak bisa diubah lagi</CardTitle>
            <CardDescription>
              Tugas yang sudah disetujui atau ditolak admin tidak bisa diubah. Hubungi admin bila
              ada kekeliruan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/employee/tugas">Kembali ke tugas saya</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
