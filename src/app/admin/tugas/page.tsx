import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, workTasks } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decideTaskAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
import { taskStatusTone } from "@/lib/task";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TaskDeleteButton } from "./task-delete-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";

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
        description: workTasks.description,
        employeeId: workTasks.employeeId,
        employeeName: employees.fullName,
      })
      .from(workTasks)
      .leftJoin(employees, eq(workTasks.employeeId, employees.id))
      .where(eq(workTasks.orgId, org.id))
      .orderBy(desc(workTasks.workDate))
      .limit(100),
  ]);

  const requested = tasks.filter((task) => task.status === "requested");
  const pending = tasks.filter((task) => task.status === "done" || task.status === "open");

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tugas</h1>
        <p className="text-sm text-muted-foreground">
          Dipakai untuk karyawan bertipe per tugas. Hanya tugas approved yang masuk payroll.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <div><Button asChild><Link href="/admin/tugas/baru">+ Buat tugas</Link></Button></div>

      {requested.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Menunggu harga</CardTitle>
            <CardDescription>
              Pengajuan tugas dari karyawan. Isi tarif per satuan lalu setujui — hanya tugas
              approved yang masuk payroll.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {requested.map((task) => (
              <form
                key={task.id}
                action={decideTaskAction}
                className="flex flex-col gap-2 rounded-xl border px-3 py-2"
              >
                <input type="hidden" name="taskId" value={task.id} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.employeeName ?? "belum ada karyawan"} · {toNumber(task.qty)}{" "}
                    {task.unit} · {formatDateID(task.workDate)}
                  </p>
                  {task.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Harga per {task.unit} (Rp)
                    <Input
                      name="unitRate"
                      inputMode="numeric"
                      placeholder="15000"
                      className="w-32"
                    />
                  </label>
                  <Button type="submit" name="decision" value="approve" size="sm">
                    Setujui
                  </Button>
                  <Button
                    type="submit"
                    name="decision"
                    value="reject"
                    variant="destructive"
                    size="sm"
                  >
                    Tolak
                  </Button>
                </div>
              </form>
            ))}
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Perlu persetujuan</CardTitle>
            <CardDescription>
              Tugas yang sudah dikerjakan karyawan menunggu approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pending.map((task) => (
              <form
                key={task.id}
                action={decideTaskAction}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
              >
                <input type="hidden" name="taskId" value={task.id} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.employeeName ?? "belum ada karyawan"} · {toNumber(task.qty)} {task.unit} ×{" "}
                    {rupiah(toNumber(task.unitRate))} ={" "}
                    {rupiah(toNumber(task.qty) * toNumber(task.unitRate))} ·{" "}
                    {formatDateID(task.workDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={task.status === "done" ? "warn" : "default"}>
                    {statusLabel(task.status)}
                  </StatusBadge>
                  <Button type="submit" name="decision" value="approve" size="sm">
                    Setujui
                  </Button>
                  <Button type="submit" name="decision" value="reject" variant="destructive" size="sm">
                    Tolak
                  </Button>
                </div>
              </form>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Semua tugas</CardTitle>
          <CardDescription>{tasks.length} tugas terakhir</CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState title="Belum ada tugas" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tugas</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Nilai</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>
                      {task.employeeId ? (
                        <Link href={`/admin/karyawan/${task.employeeId}`} className="hover:underline">
                          {task.employeeName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {toNumber(task.qty)} {task.unit}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {toNumber(task.unitRate) > 0 ? (
                        rupiah(toNumber(task.qty) * toNumber(task.unitRate))
                      ) : (
                        <span className="text-muted-foreground">belum diisi</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(task.workDate)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={taskStatusTone(task.status)}>
                        {statusLabel(task.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm"><Link href={`/admin/tugas/${task.id}`}>Ubah</Link></Button>
                        <TaskDeleteButton taskId={task.id} taskTitle={task.title} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
