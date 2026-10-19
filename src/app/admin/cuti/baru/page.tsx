import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createLeaveAction } from "../../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { LeaveFields } from "@/components/leave-fields";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeAdminPath } from "@/lib/contract-options";
import { localDateString } from "@/lib/format";

export const metadata = { title: "Catat cuti — Gaji" };

/**
 * Halaman tersendiri untuk mencatat cuti (bukan form di dalam daftar).
 * `?employeeId=` dipakai tombol "Catat cuti" dari tab cuti di detail karyawan,
 * `?backTo=` menentukan ke mana halaman kembali setelah sukses.
 */
export default async function NewAdminLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; employeeId?: string; backTo?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, employeeId, backTo } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const successTo = safeAdminPath(backTo, "/admin/cuti");

  // Error dikembalikan ke halaman ini, bukan ke daftar, supaya pesan muncul di form.
  const selfParams = new URLSearchParams();
  if (employeeId) selfParams.set("employeeId", employeeId);
  if (backTo) selfParams.set("backTo", backTo);
  const selfQuery = selfParams.toString();
  const selfUrl = `/admin/cuti/baru${selfQuery ? `?${selfQuery}` : ""}`;

  const staff = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(
      and(eq(employees.orgId, org.id), eq(employees.isActive, true), eq(employees.payType, "monthly")),
    )
    .orderBy(employees.fullName);

  return (
    <>
      <header>
        <Link href={successTo} className="text-xs text-muted-foreground hover:underline">
          ← Cuti
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Catat cuti</h1>
        <p className="text-sm text-muted-foreground">
          Untuk cuti yang sudah disepakati — tersimpan sebagai disetujui. Hanya karyawan bulanan
          yang bisa dicatat.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      {staff.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada karyawan bulanan</CardTitle>
            <CardDescription>
              Cuti hanya dipakai karyawan dengan tipe gaji bulanan. Ubah tipe penggajian karyawan
              dulu lewat detail karyawan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Tidak ada karyawan bulanan"
              hint="Tipe gaji lain sudah dibayar dari kehadiran atau tugas, jadi tidak memakai cuti."
            />
          </CardContent>
        </Card>
      ) : (
        <form action={createLeaveAction} className="flex flex-col gap-4">
          <input type="hidden" name="backTo" value={selfUrl} />
          <input type="hidden" name="successTo" value={successTo} />

          <Card>
            <CardHeader>
              <CardTitle>Detail cuti</CardTitle>
              <CardDescription>
                Hari kerja dihitung Senin–Sabtu. Minggu tidak menambah jumlah hari cuti.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Karyawan">
                <SelectInput name="employeeId" required defaultValue={employeeId ?? ""}>
                  <option value="">Pilih karyawan…</option>
                  {staff.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.fullName}
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <LeaveFields
                defaults={{ startDate: today, endDate: today, kind: "cuti", paid: true }}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">Simpan cuti</Button>
            <Button asChild variant="outline">
              <Link href={successTo}>Batal</Link>
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
