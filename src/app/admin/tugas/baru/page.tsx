import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createTaskAction } from "../../actions";
import { TaskForm } from "../task-form";
import { Flash } from "@/components/flash";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { localDateString } from "@/lib/format";

export const metadata = { title: "Buat tugas — Gaji" };
export default async function NewAdminTaskPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const staff = await db.select({ id: employees.id, fullName: employees.fullName, payType: employees.payType })
    .from(employees).where(and(eq(employees.orgId, org.id), eq(employees.isActive, true))).orderBy(employees.fullName);
  return <>
    <header><Link href="/admin/tugas" className="text-xs text-muted-foreground hover:underline">← Tugas</Link><h1 className="text-2xl font-semibold tracking-tight">Buat tugas</h1><p className="text-sm text-muted-foreground">Tentukan karyawan, jumlah, satuan, dan tarif per satuan.</p></header>
    <Flash ok={ok} err={err} />
    <Card><CardHeader><CardTitle>Detail tugas</CardTitle><CardDescription>Isi informasi tugas yang akan dicatat.</CardDescription></CardHeader><CardContent>
      <TaskForm action={createTaskAction} employees={staff} defaults={{ workDate: localDateString(new Date(), org.timezone), qty: "1", unit: "tugas" }} cancelHref="/admin/tugas" submitLabel="Simpan tugas" />
    </CardContent></Card>
  </>;
}
