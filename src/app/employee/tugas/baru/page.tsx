import Link from "next/link";
import { requireEmployee } from "@/lib/session";
import { submitTaskAction } from "../../actions";
import { Flash } from "@/components/flash";
import { TaskForm } from "@/components/employee/task-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { localDateString } from "@/lib/format";

export const metadata = { title: "Ajukan tugas — Gaji" };

/** Halaman tersendiri untuk mengajukan tugas (bukan form di dalam daftar). */
export default async function NewEmployeeTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireEmployee();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  return (
    <>
      <header>
        <Link href="/employee/tugas" className="text-xs text-muted-foreground hover:underline">
          ← Tugas saya
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ajukan tugas</h1>
        <p className="text-xs text-muted-foreground">
          Harga dan persetujuan diisi admin. Tugas yang disetujui masuk slip gaji periode ini.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Detail tugas</CardTitle>
          <CardDescription>
            Tulis apa yang kamu kerjakan dan jumlahnya — admin yang menentukan tarifnya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaskForm
            action={submitTaskAction}
            defaults={{ workDate: today, unit: "tugas", qty: "1" }}
            submitLabel="Kirim pengajuan"
            cancelHref="/employee/tugas"
          />
        </CardContent>
      </Card>
    </>
  );
}
