import Link from "next/link";
import { requireEmployee } from "@/lib/session";
import { requestLeaveAction } from "../../actions";
import { Flash } from "@/components/flash";
import { LeaveForm } from "@/components/employee/leave-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PAY_TYPE_LABEL, localDateString } from "@/lib/format";

export const metadata = { title: "Ajukan cuti — Gaji" };

/** Halaman tersendiri untuk mengajukan cuti (bukan form di dalam daftar). */
export default async function NewEmployeeLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  if (employee.payType !== "monthly") {
    return (
      <>
        <header>
          <Link href="/employee/cuti" className="text-xs text-muted-foreground hover:underline">
            ← Cuti
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Ajukan cuti</h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Cuti tidak berlaku untuk tipe gajimu</CardTitle>
            <CardDescription>
              Cuti hanya dipakai karyawan bulanan. Gaji{" "}
              {PAY_TYPE_LABEL[employee.payType] ?? employee.payType} sudah otomatis mengikuti
              kehadiran atau tugas yang kamu kerjakan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/employee/cuti">Kembali</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <header>
        <Link href="/employee/cuti" className="text-xs text-muted-foreground hover:underline">
          ← Cuti
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ajukan cuti</h1>
        <p className="text-xs text-muted-foreground">
          Admin akan meninjau pengajuanmu. Selama masih menunggu, pengajuan bisa diubah.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Detail cuti</CardTitle>
          <CardDescription>
            Hari kerja dihitung Senin–Sabtu. Minggu tidak menambah jumlah hari cuti.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeaveForm
            action={requestLeaveAction}
            defaults={{ startDate: today, endDate: today, kind: "cuti", paid: true }}
            submitLabel="Kirim pengajuan"
            cancelHref="/employee/cuti"
          />
        </CardContent>
      </Card>
    </>
  );
}
