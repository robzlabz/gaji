import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import {
  revokeSignatureLinkAction,
  sendSignatureLinkAction,
  terminateContractAction,
  updateContractAction,
} from "../../actions";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { FormField, SelectInput } from "@/components/form-field";
import { statusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CONTRACT_KIND_OPTIONS, PAY_TYPE_OPTIONS } from "@/lib/contract-options";
import {
  contractChangedSinceSignature,
  effectiveSignatureStatus,
  SIGNATURE_STATUS_LABEL,
  type SignatureStatus,
} from "@/lib/esign";
import { findSignatureForContract, summaryOf } from "@/lib/esign-contract";
import {
  CONTRACT_KIND_LABEL,
  PAY_TYPE_LABEL,
  formatDateID,
  formatDateTimeZoned,
  localDateString,
  rupiah,
  toNumber,
} from "@/lib/format";

const SIGNATURE_TONE: Record<SignatureStatus, "good" | "warn" | "bad" | "info"> = {
  signed: "good",
  sent: "info",
  expired: "warn",
  revoked: "bad",
};

/** Halaman tersendiri untuk mengubah satu kontrak (bukan modal, bukan form di daftar). */
export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [row] = await db
    .select({
      id: contracts.id,
      kind: contracts.kind,
      contractNo: contracts.contractNo,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      payType: contracts.payType,
      payRate: contracts.payRate,
      note: contracts.note,
      status: contracts.status,
      renewedFromId: contracts.renewedFromId,
      createdAt: contracts.createdAt,
      employeeId: employees.id,
      employeeName: employees.fullName,
      employeeActive: employees.isActive,
    })
    .from(contracts)
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .where(and(eq(contracts.id, id), eq(contracts.orgId, org.id)))
    .limit(1);

  if (!row) notFound();

  const signature = await findSignatureForContract(org.id, row.id);
  const signatureState = signature ? effectiveSignatureStatus(signature, new Date()) : null;
  // Hash hanya ada setelah ditandatangani; perubahan sesudahnya = peringatan.
  const contractChanged =
    signatureState === "signed" &&
    contractChangedSinceSignature(signature?.signatureHash, summaryOf(row, row.employeeName, org.name));

  const headerStore = await headers();
  const host = headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? "http";
  const signUrl =
    signature && signatureState === "sent" && host
      ? `${protocol}://${host}/sign/${signature.token}`
      : null;

  const today = localDateString(new Date(), org.timezone);
  const selfUrl = `/admin/kontrak/${row.id}`;
  const isActive = row.status === "active";

  return (
    <>
      <header>
        <Link href="/admin/kontrak" className="text-xs text-muted-foreground hover:underline">
          ← Kontrak
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Ubah kontrak</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/admin/karyawan/${row.employeeId}?tab=kontrak`} className="hover:underline">
            {row.employeeName}
          </Link>{" "}
          · {CONTRACT_KIND_LABEL[row.kind] ?? row.kind} · {PAY_TYPE_LABEL[row.payType] ?? row.payType}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      {contractChanged ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-300">
          <strong className="font-semibold">Kontrak berubah setelah ditandatangani.</strong> Isi
          kontrak saat ini tidak sama dengan isi yang disetujui penanda tangan (hash berbeda). Buat
          kontrak baru atau minta tanda tangan ulang.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan</CardTitle>
          <CardDescription>
            {formatDateID(row.startDate)} – {row.endDate ? formatDateID(row.endDate) : "tanpa batas"} ·{" "}
            {rupiah(toNumber(row.payRate))}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge tone={isActive ? "good" : row.status === "expired" ? "bad" : "default"}>
            {statusLabel(row.status)}
          </StatusBadge>
          <span className="text-muted-foreground">
            Nomor: {row.contractNo ?? "—"}
          </span>
          <span className="text-muted-foreground">
            Dibuat: {formatDateID(row.createdAt.toISOString().slice(0, 10))}
          </span>
          {row.renewedFromId ? (
            <Link
              href={`/admin/kontrak/${row.renewedFromId}`}
              className="text-muted-foreground hover:underline"
            >
              Perpanjangan dari kontrak sebelumnya
            </Link>
          ) : null}
          {!row.employeeActive ? <StatusBadge tone="warn">karyawan nonaktif</StatusBadge> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tanda tangan elektronik</CardTitle>
          <CardDescription>
            Tautan publik untuk ditandatangani karyawan tanpa akun. Bukti yang disimpan: nama,
            waktu, alamat IP, user agent, dan hash isi kontrak.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {signature && signatureState ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={SIGNATURE_TONE[signatureState]}>
                  {SIGNATURE_STATUS_LABEL[signatureState]}
                </StatusBadge>
                {signatureState === "signed" ? (
                  <span className="text-muted-foreground">
                    {signature.signerName} ·{" "}
                    {formatDateTimeZoned(signature.signedAt, org.timezone)}
                  </span>
                ) : signatureState === "sent" ? (
                  <span className="text-muted-foreground">
                    berlaku sampai {formatDateTimeZoned(signature.expiresAt, org.timezone)}
                  </span>
                ) : signatureState === "revoked" ? (
                  <span className="text-muted-foreground">
                    dicabut {formatDateTimeZoned(signature.revokedAt, org.timezone)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    lewat tenggat {formatDateTimeZoned(signature.expiresAt, org.timezone)}
                  </span>
                )}
              </div>

              {signUrl ? (
                <FormField
                  label="Tautan tanda tangan"
                  hint="Kirim ke karyawan. Sekali pakai, berlaku 14 hari sejak dibuat."
                >
                  <Input readOnly value={signUrl} className="font-mono text-xs" />
                </FormField>
              ) : null}

              {signatureState === "signed" ? (
                <p className="text-xs text-muted-foreground">
                  Hash saat ditandatangani:{" "}
                  <span className="font-mono break-all">{signature.signatureHash}</span>
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {signatureState === "signed" ? (
                  <Button asChild variant="outline">
                    <Link href={`/admin/kontrak/${row.id}/bukti`}>Lihat bukti tanda tangan</Link>
                  </Button>
                ) : (
                  <>
                    <form action={sendSignatureLinkAction}>
                      <input type="hidden" name="contractId" value={row.id} />
                      <input type="hidden" name="backTo" value={selfUrl} />
                      <Button type="submit" variant={signatureState === "sent" ? "outline" : "default"}>
                        {signatureState === "sent" ? "Tautkan ulang" : "Kirim tautan tanda tangan"}
                      </Button>
                    </form>
                    {signatureState === "sent" ? (
                      <form action={revokeSignatureLinkAction}>
                        <input type="hidden" name="contractId" value={row.id} />
                        <input type="hidden" name="backTo" value={selfUrl} />
                        <Button type="submit" variant="outline">
                          Cabut tautan
                        </Button>
                      </form>
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                Kontrak ini belum punya tanda tangan. Buat tautan, kirim ke karyawan, lalu simpan
                buktinya.
              </p>
              <form action={sendSignatureLinkAction}>
                <input type="hidden" name="contractId" value={row.id} />
                <input type="hidden" name="backTo" value={selfUrl} />
                <Button type="submit">Kirim tautan tanda tangan</Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <form action={updateContractAction} className="flex flex-col gap-5">
        <input type="hidden" name="contractId" value={row.id} />
        <input type="hidden" name="backTo" value={selfUrl} />

        <Card>
          <CardHeader>
            <CardTitle>Data kontrak</CardTitle>
            <CardDescription>
              Karyawan tidak bisa diganti — akhiri kontrak ini lalu buat kontrak baru bila perlu.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Karyawan">
              <div className="flex h-8 items-center rounded-lg border border-input bg-muted/40 px-2 text-sm">
                {row.employeeName}
              </div>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Jenis kontrak">
                <SelectInput name="kind" defaultValue={row.kind}>
                  {CONTRACT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Nomor kontrak" hint="Opsional">
                <Input name="contractNo" defaultValue={row.contractNo ?? ""} placeholder="001/PKWT/I/2026" />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Mulai">
                <Input type="date" name="startDate" defaultValue={row.startDate} required />
              </FormField>
              <FormField label="Berakhir" hint="Kosongkan untuk PKWTT">
                <Input type="date" name="endDate" defaultValue={row.endDate ?? ""} />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tipe gaji">
                <SelectInput name="payType" defaultValue={row.payType}>
                  {PAY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Tarif (Rp)">
                <Input
                  name="payRate"
                  inputMode="numeric"
                  defaultValue={Math.round(toNumber(row.payRate))}
                />
              </FormField>
            </div>

            <FormField label="Catatan" hint="Opsional">
              <Textarea name="note" rows={3} defaultValue={row.note ?? ""} />
            </FormField>

            <p className="text-xs text-muted-foreground">
              {!isActive
                ? "Kontrak ini sudah tidak aktif, jadi perubahan tarif tidak mengubah tarif karyawan."
                : row.startDate <= today
                  ? "Kontrak ini sudah berlaku, jadi perubahan tipe gaji/tarif langsung mengubah tarif karyawan dan tercatat di riwayat tarif."
                  : "Kontrak ini belum berjalan. Perubahan tarif baru dipakai saat tanggal mulainya tiba."}
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Simpan perubahan</Button>
          <Button asChild variant="outline">
            <Link href="/admin/kontrak">Batal</Link>
          </Button>
          {isActive ? (
            <Button asChild variant="outline">
              <Link href={`/admin/kontrak/baru?renew=${row.id}`}>Perpanjang</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {isActive ? (
        <Card>
          <CardHeader>
            <CardTitle>Akhiri kontrak</CardTitle>
            <CardDescription>
              Status berubah menjadi “{statusLabel("terminated")}” dan tidak bisa dikembalikan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <form action={terminateContractAction}>
              <input type="hidden" name="contractId" value={row.id} />
              <input type="hidden" name="backTo" value={selfUrl} />
              <Button type="submit" variant="destructive">
                Akhiri kontrak
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
