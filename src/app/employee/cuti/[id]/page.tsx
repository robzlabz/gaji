import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { leaves } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { cancelLeaveAction, updateLeaveAction } from "../../actions";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { LeaveForm } from "@/components/employee/leave-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID } from "@/lib/format";
import { leaveKindLabel, leaveStatusTone } from "@/lib/leave";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Ubah cuti — Gaji" };

/** Halaman tersendiri untuk mengubah cuti yang masih menunggu persetujuan. */
export default async function EditEmployeeLeavePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [row] = await db
    .select()
    .from(leaves)
    .where(
      and(eq(leaves.id, id), eq(leaves.orgId, org.id), eq(leaves.employeeId, employee.id)),
    )
    .limit(1);

  if (!row) notFound();

  const editable = row.status === "pending";

  return (
    <>
      <header>
        <Link href="/employee/cuti" className="text-xs text-muted-foreground hover:underline">
          ← Cuti
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ubah cuti</h1>
        <p className="text-xs text-muted-foreground">
          {editable
            ? "Pengajuan masih menunggu, jadi masih bisa diperbaiki."
            : "Pengajuan ini sudah diputuskan admin, jadi isinya terkunci."}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {leaveKindLabel(row.kind)} · {row.days} hari
            </span>
            <StatusBadge tone={leaveStatusTone(row.status)}>
              {statusLabel(row.status)}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            {formatDateID(row.startDate)} – {formatDateID(row.endDate)} ·{" "}
            {row.paid ? "berbayar" : "tanpa upah"}
          </CardDescription>
        </CardHeader>
      </Card>

      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Detail cuti</CardTitle>
            <CardDescription>Jumlah hari dihitung ulang otomatis saat disimpan.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LeaveForm
              action={updateLeaveAction}
              leaveId={row.id}
              defaults={{
                startDate: row.startDate,
                endDate: row.endDate,
                kind: row.kind,
                paid: row.paid,
                note: row.note,
              }}
              submitLabel="Simpan perubahan"
              cancelHref="/employee/cuti"
            />
            <form action={cancelLeaveAction}>
              <input type="hidden" name="leaveId" value={row.id} />
              <Button type="submit" variant="ghost" className="w-full">
                Batalkan pengajuan
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Tidak bisa diubah lagi</CardTitle>
            <CardDescription>
              Cuti yang sudah disetujui atau ditolak admin tidak bisa diubah. Hubungi admin bila ada
              kekeliruan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/employee/cuti">Kembali ke cuti</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
