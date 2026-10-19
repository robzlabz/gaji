import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaves } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decideLeaveAction, deleteLeaveAction, updateLeaveAction } from "../../actions";
import { Flash } from "@/components/flash";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { LeaveFields } from "@/components/leave-fields";
import { StatusBadge } from "@/components/status-badge";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { safeAdminPath } from "@/lib/contract-options";
import { formatDateID } from "@/lib/format";
import { leaveKindLabel, leavePaidLabel, leaveStatusTone } from "@/lib/leave";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Ubah cuti — Gaji" };

/**
 * Halaman tersendiri untuk mengubah satu cuti (bukan modal, bukan form di daftar).
 * Menyimpan perubahan, menghapus, dan — bila masih menunggu — memutuskan pengajuan.
 */
export default async function AdminLeaveDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string; backTo?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err, backTo } = await searchParams;

  const [row] = await db
    .select({
      id: leaves.id,
      kind: leaves.kind,
      startDate: leaves.startDate,
      endDate: leaves.endDate,
      days: leaves.days,
      paid: leaves.paid,
      status: leaves.status,
      note: leaves.note,
      rejectReason: leaves.rejectReason,
      employeeId: employees.id,
      employeeName: employees.fullName,
      employeePayType: employees.payType,
    })
    .from(leaves)
    .innerJoin(employees, eq(leaves.employeeId, employees.id))
    .where(and(eq(leaves.id, id), eq(leaves.orgId, org.id)))
    .limit(1);

  if (!row) notFound();

  const successTo = safeAdminPath(backTo, "/admin/cuti");
  const selfUrl = `/admin/cuti/${row.id}`;
  const isPending = row.status === "pending";
  const deleteFormId = `delete-leave-${row.id}`;

  return (
    <>
      <header>
        <Link href={successTo} className="text-xs text-muted-foreground hover:underline">
          ← Cuti
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Ubah cuti</h1>
        <p className="text-sm text-muted-foreground">
          {row.employeeName} · {leaveKindLabel(row.kind)} {row.days} hari ·{" "}
          {leavePaidLabel(row.paid)}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {formatDateID(row.startDate)} – {formatDateID(row.endDate)}
            </span>
            <StatusBadge tone={leaveStatusTone(row.status)}>
              {statusLabel(row.status)}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            {row.status === "approved"
              ? "Sudah disetujui — harinya ikut dihitung saat payroll bulanan dihitung ulang."
              : row.status === "pending"
                ? "Masih menunggu keputusan. Perubahan tersimpan tanpa mengubah status."
                : "Pengajuan ditolak. Perubahan tersimpan tanpa mengubah status."}
            {row.rejectReason ? ` Alasan ditolak: ${row.rejectReason}` : ""}
          </CardDescription>
        </CardHeader>
      </Card>

      {isPending ? (
        <Card>
          <CardHeader>
            <CardTitle>Keputusan pengajuan</CardTitle>
            <CardDescription>
              Setujui bila cuti ini berbayar — harinya tetap dibayar saat payroll dihitung.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <form action={decideLeaveAction}>
              <input type="hidden" name="leaveId" value={row.id} />
              <input type="hidden" name="decision" value="approved" />
              <input type="hidden" name="backTo" value={successTo} />
              <Button type="submit" size="sm">
                Setujui
              </Button>
            </form>
            <form action={decideLeaveAction} className="flex flex-1 items-end gap-2">
              <input type="hidden" name="leaveId" value={row.id} />
              <input type="hidden" name="decision" value="rejected" />
              <input type="hidden" name="backTo" value={successTo} />
              <FormField label="Alasan tolak" className="min-w-40 flex-1">
                <Input name="rejectReason" placeholder="opsional" />
              </FormField>
              <Button type="submit" size="sm" variant="outline">
                Tolak
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <form action={updateLeaveAction} className="flex flex-col gap-4">
        <input type="hidden" name="leaveId" value={row.id} />
        <input type="hidden" name="backTo" value={selfUrl} />
        <input type="hidden" name="successTo" value={successTo} />

        <Card>
          <CardHeader>
            <CardTitle>Detail cuti</CardTitle>
            <CardDescription>
              Jumlah hari dihitung ulang otomatis saat disimpan (Senin–Sabtu).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Karyawan" hint="Karyawan tidak bisa dipindah dari halaman ini">
              <div className="flex h-8 items-center rounded-lg border border-input bg-muted/40 px-2 text-sm">
                {row.employeeName}
              </div>
            </FormField>

            <LeaveFields
              defaults={{
                startDate: row.startDate,
                endDate: row.endDate,
                kind: row.kind,
                paid: row.paid,
                note: row.note,
              }}
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Simpan perubahan</Button>
          <Button asChild variant="outline">
            <Link href={successTo}>Batal</Link>
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Hapus cuti</CardTitle>
          <CardDescription>
            Cuti yang dihapus hilang dari riwayat dan tidak lagi dihitung di payroll. Hitung ulang
            draft payroll bila cuti ini sudah masuk hitungan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id={deleteFormId} action={deleteLeaveAction}>
            <input type="hidden" name="leaveId" value={row.id} />
            <input type="hidden" name="backTo" value={successTo} />
            <ConfirmDeleteButton
              formId={deleteFormId}
              triggerLabel="Hapus cuti"
              confirmLabel="Ya, hapus"
              title="Hapus cuti ini?"
              description={`Cuti ${leaveKindLabel(row.kind)} ${row.days} hari milik ${row.employeeName} (${formatDateID(row.startDate)} – ${formatDateID(row.endDate)}) akan dihapus permanen.`}
            />
          </form>
        </CardContent>
      </Card>
    </>
  );
}
