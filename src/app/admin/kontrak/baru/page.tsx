import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createContractAction } from "../../actions";
import { Flash } from "@/components/flash";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTRACT_KIND_OPTIONS, PAY_TYPE_OPTIONS, safeAdminPath } from "@/lib/contract-options";
import { CONTRACT_KIND_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";

export const metadata = { title: "Tambah kontrak — Gaji" };

/**
 * Halaman tersendiri untuk membuat kontrak baru (bukan modal, bukan form di daftar).
 * Dipakai juga untuk perpanjangan lewat `?renew=<id>`: data kontrak lama dipakai
 * sebagai nilai awal, dan kontrak lama otomatis berstatus "diperbarui" saat disimpan.
 */
export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    err?: string;
    employeeId?: string;
    renew?: string;
    backTo?: string;
  }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, employeeId, renew, backTo } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  // Setelah sukses: kembali ke halaman asal (mis. tab kontrak di detail karyawan).
  const successTo = safeAdminPath(backTo, "/admin/kontrak");

  // Error dikembalikan ke halaman ini, bukan ke daftar, supaya pesan muncul di form.
  const selfParams = new URLSearchParams();
  if (renew) selfParams.set("renew", renew);
  if (employeeId) selfParams.set("employeeId", employeeId);
  if (backTo) selfParams.set("backTo", backTo);
  const selfQuery = selfParams.toString();
  const selfUrl = `/admin/kontrak/baru${selfQuery ? `?${selfQuery}` : ""}`;

  const renewing = renew
    ? (
        await db
          .select({
            id: contracts.id,
            kind: contracts.kind,
            startDate: contracts.startDate,
            endDate: contracts.endDate,
            payType: contracts.payType,
            payRate: contracts.payRate,
            employeeId: employees.id,
            employeeName: employees.fullName,
          })
          .from(contracts)
          .innerJoin(employees, eq(contracts.employeeId, employees.id))
          .where(and(eq(contracts.id, renew), eq(contracts.orgId, org.id)))
          .limit(1)
      )[0]
    : undefined;

  const staff = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
    .orderBy(employees.fullName);

  // Karyawan yang sudah punya kontrak aktif tidak boleh ditambah kontrak baru —
  // pakai Perpanjang supaya riwayat kontraknya tersambung.
  const activeContracts = await db
    .select({ id: contracts.id, employeeId: contracts.employeeId })
    .from(contracts)
    .where(and(eq(contracts.orgId, org.id), eq(contracts.status, "active")));

  const activeByEmployee = new Map(activeContracts.map((row) => [row.employeeId, row.id]));
  const available = staff.filter((row) => !activeByEmployee.has(row.id));

  // Karyawan yang diminta lewat tautan tapi sudah punya kontrak aktif.
  const blocked =
    !renewing && employeeId && activeByEmployee.has(employeeId)
      ? staff.find((row) => row.id === employeeId)
      : undefined;

  const preselected = employeeId && available.some((row) => row.id === employeeId) ? employeeId : "";

  const backHref = successTo;

  return (
    <>
      <header>
        <Link href={backHref} className="text-xs text-muted-foreground hover:underline">
          ← Kontrak
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {renewing ? "Perpanjang kontrak" : "Tambah kontrak"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {renewing
            ? `Kontrak baru untuk ${renewing.employeeName} akan menggantikan kontrak sebelumnya.`
            : "Satu kontrak untuk satu karyawan yang belum punya kontrak aktif."}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      {renewing ? (
        <Card>
          <CardHeader>
            <CardTitle>Kontrak sebelumnya</CardTitle>
            <CardDescription>
              {CONTRACT_KIND_LABEL[renewing.kind] ?? renewing.kind} ·{" "}
              {formatDateID(renewing.startDate)} –{" "}
              {renewing.endDate ? formatDateID(renewing.endDate) : "tanpa batas"} ·{" "}
              {rupiah(toNumber(renewing.payRate))}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {blocked ? (
        <Card>
          <CardHeader>
            <CardTitle>{blocked.fullName} masih punya kontrak aktif</CardTitle>
            <CardDescription>
              Tambah kontrak hanya untuk karyawan tanpa kontrak aktif. Untuk melanjutkan masa kerja,
              pakai Perpanjang — kontrak lama otomatis ditandai diperbarui.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/admin/kontrak/baru?renew=${activeByEmployee.get(blocked.id)}&backTo=${encodeURIComponent(successTo)}`}>
                Perpanjang kontrak
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/karyawan/${blocked.id}?tab=kontrak`}>Lihat karyawan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {renewing || (!blocked && available.length > 0) ? (
        <form action={createContractAction} className="flex flex-col gap-5">
          <input type="hidden" name="backTo" value={selfUrl} />
          <input type="hidden" name="successTo" value={successTo} />
          {renewing ? (
            <>
              <input type="hidden" name="employeeId" value={renewing.employeeId} />
              <input type="hidden" name="renewedFromId" value={renewing.id} />
            </>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Isi kontrak</CardTitle>
              <CardDescription>
                Jenis, masa berlaku, dan tarif. Kontrak yang mulai berlaku langsung mengatur tarif
                karyawan.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Karyawan">
                {renewing ? (
                  <div className="flex h-8 items-center rounded-lg border border-input bg-muted/40 px-2 text-sm">
                    {renewing.employeeName}
                  </div>
                ) : (
                  <SelectInput name="employeeId" required defaultValue={preselected}>
                    <option value="">Pilih karyawan…</option>
                    {available.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.fullName}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </FormField>

              <FormField label="Jenis kontrak">
                <SelectInput name="kind" defaultValue={renewing?.kind ?? "pkwt"}>
                  {CONTRACT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField label="Nomor kontrak" hint="Opsional">
                <Input name="contractNo" placeholder="001/PKWT/I/2026" />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Mulai">
                  <Input
                    type="date"
                    name="startDate"
                    defaultValue={renewing?.endDate ?? today}
                    required
                  />
                </FormField>
                <FormField label="Berakhir" hint="Kosongkan untuk PKWTT">
                  <Input type="date" name="endDate" />
                </FormField>
              </div>

              <FormField label="Tipe gaji" hint={renewing ? undefined : "Ikuti karyawan = tarif karyawan saat ini"}>
                <SelectInput name="payType" defaultValue={renewing?.payType ?? ""}>
                  {renewing ? null : <option value="">Ikuti karyawan</option>}
                  {PAY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField label="Tarif (Rp)" hint={renewing ? undefined : "Kosongkan untuk memakai tarif karyawan saat ini"}>
                <Input
                  name="payRate"
                  inputMode="numeric"
                  placeholder="25000"
                  defaultValue={renewing ? Math.round(toNumber(renewing.payRate)) : undefined}
                />
              </FormField>

              <FormField label="Catatan" hint="Opsional">
                <Textarea name="note" rows={3} placeholder="Keterangan tambahan kontrak…" />
              </FormField>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit">{renewing ? "Simpan perpanjangan" : "Simpan kontrak"}</Button>
            <Button asChild variant="outline">
              <Link href={backHref}>Batal</Link>
            </Button>
          </div>
        </form>
      ) : null}

      {!renewing && !blocked && available.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Tidak ada karyawan yang bisa dibuatkan kontrak</CardTitle>
            <CardDescription>
              Semua karyawan aktif sudah punya kontrak aktif. Untuk melanjutkan masa kerja, pakai
              Perpanjang pada kontrak yang berakhir — kontrak lama otomatis ditandai diperbarui.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/admin/kontrak">Ke daftar kontrak</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/karyawan/baru">Tambah karyawan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
