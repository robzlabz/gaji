import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, workTasks } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { updateTaskAction } from "../../actions";
import { TaskForm } from "../task-form";
import { Flash } from "@/components/flash";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Ubah tugas — Gaji" };
export default async function EditAdminTaskPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const [{ id }, { ok, err }] = await Promise.all([params, searchParams]);
  const [task, staff] = await Promise.all([
    db.select().from(workTasks).where(and(eq(workTasks.id, id), eq(workTasks.orgId, org.id))).limit(1).then((rows) => rows[0]),
    db.select({ id: employees.id, fullName: employees.fullName, payType: employees.payType }).from(employees)
      .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true))).orderBy(employees.fullName),
  ]);
  if (!task) notFound();
  return <>
    <header><Link href="/admin/tugas" className="text-xs text-muted-foreground hover:underline">← Tugas</Link><h1 className="text-2xl font-semibold tracking-tight">Ubah tugas</h1><p className="text-sm text-muted-foreground">Perbarui detail tugas.</p></header>
    <Flash ok={ok} err={err} />
    <Card><CardHeader><CardTitle>Detail tugas</CardTitle><CardDescription>Perubahan akan langsung disimpan.</CardDescription></CardHeader><CardContent>
      <TaskForm action={updateTaskAction} employees={staff} taskId={task.id} cancelHref="/admin/tugas" submitLabel="Simpan perubahan"
        defaults={{ title: task.title, employeeId: task.employeeId, qty: task.qty, unit: task.unit, unitRate: task.unitRate, workDate: task.workDate, description: task.description }} />
    </CardContent></Card>
  </>;
}
