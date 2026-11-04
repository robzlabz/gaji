import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { PrintButton } from "@/components/print-button";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { contractChangedSinceSignature, hashContractSummary } from "@/lib/esign";
import { findSignedSignature, summaryOf } from "@/lib/esign-contract";
import {
  CONTRACT_KIND_LABEL,
  formatDateID,
  formatDateTimeZoned,
  PAY_TYPE_LABEL,
  rupiah,
  toNumber,
} from "@/lib/format";

export const metadata = { title: "Bukti tanda tangan kontrak — Gaji" };

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-t py-2 first:border-t-0 sm:flex-row sm:justify-between sm:gap-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono text-[11px] break-all" : "font-medium"} sm:text-right`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Halaman bukti tanda tangan, bisa dicetak.
 *
 * Isi yang dibekukan saat tanda tangan dibandingkan dengan isi kontrak sekarang:
 * kalau berbeda, halaman ini menampilkan peringatan bahwa kontrak berubah setelah
 * ditandatangani, bukan menyembunyikannya.
 */
export default async function ContractSignatureProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;

  const [contract] = await db
    .select({
      id: contracts.id,
      contractNo: contracts.contractNo,
      kind: contracts.kind,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      payType: contracts.payType,
      payRate: contracts.payRate,
      status: contracts.status,
      employeeName: employees.fullName,
    })
    .from(contracts)
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .where(and(eq(contracts.id, id), eq(contracts.orgId, org.id)))
    .limit(1);

  if (!contract) notFound();

  const signature = await findSignedSignature(org.id, contract.id);
  if (!signature) notFound();

  const summary = summaryOf(contract, contract.employeeName, org.name);
  const currentHash = hashContractSummary(summary);
  const changed = contractChangedSinceSignature(signature.signatureHash, summary);
  const period = `${formatDateID(contract.startDate)} – ${
    contract.endDate ? formatDateID(contract.endDate) : "tanpa batas"
  }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="px-0">
          <Link href={`/admin/kontrak/${contract.id}`}>← Kembali ke kontrak</Link>
        </Button>
        <PrintButton label="Cetak bukti" />
      </div>

      {changed ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-300">
          <strong className="font-semibold">Kontrak berubah setelah ditandatangani.</strong> Hash isi
          kontrak sekarang berbeda dari hash yang dibekukan saat tanda tangan, jadi isi yang
          ditampilkan di bawah bukan lagi isi yang disetujui penanda tangan.
        </div>
      ) : null}

      <Card className="mx-auto w-full max-w-[210mm] print:max-w-none print:ring-0">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">{org.name}</CardTitle>
              <CardDescription>Bukti tanda tangan elektronik kontrak kerja</CardDescription>
            </div>
            <div className="text-right">
              <CardDescription>Ditandatangani</CardDescription>
              <p className="text-sm font-semibold">
                {formatDateTimeZoned(signature.signedAt, org.timezone)}
              </p>
              <StatusBadge tone={changed ? "warn" : "good"}>
                {changed ? "isi berubah" : "hash cocok"}
              </StatusBadge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Isi kontrak yang disetujui</h2>
            <dl className="flex flex-col">
              <Row label="Nomor kontrak" value={contract.contractNo ?? "—"} />
              <Row label="Jenis kontrak" value={CONTRACT_KIND_LABEL[contract.kind] ?? contract.kind} />
              <Row label="Periode" value={period} />
              <Row
                label="Upah"
                value={`${rupiah(toNumber(contract.payRate))} / ${PAY_TYPE_LABEL[contract.payType] ?? contract.payType}`}
              />
              <Row label="Karyawan" value={contract.employeeName} />
              <Row label="Perusahaan" value={org.name} />
            </dl>
          </section>

          <Separator />

          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Bukti tanda tangan</h2>
            <dl className="flex flex-col">
              <Row label="Nama penanda tangan" value={signature.signerName ?? "—"} />
              <Row
                label="Waktu tanda tangan"
                value={formatDateTimeZoned(signature.signedAt, org.timezone)}
              />
              <Row label="Alamat IP" value={signature.signerIp ?? "tidak tercatat"} />
              <Row label="Perangkat / user agent" value={signature.signerUserAgent ?? "tidak tercatat"} />
              <Row label="Hash saat ditandatangani (SHA-256)" value={signature.signatureHash ?? "—"} mono />
              <Row
                label="Hash isi kontrak sekarang (SHA-256)"
                value={currentHash}
                mono
              />
              <Row
                label="Hasil verifikasi"
                value={
                  changed
                    ? "TIDAK COCOK — kontrak diedit setelah ditandatangani"
                    : "COCOK — isi kontrak sama dengan yang disetujui"
                }
              />
            </dl>
          </section>

          <Separator />

          <section className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p>
              <strong className="font-semibold text-foreground">Bukan tanda tangan tersertifikasi.</strong>{" "}
              Tanda tangan ini adalah tanda tangan elektronik sederhana: bukti persetujuan berisi nama,
              waktu, alamat IP, user agent, dan hash isi kontrak. Ini <em>bukan</em> tanda tangan
              elektronik tersertifikasi yang diterbitkan Penyelenggara Sertifikasi Elektronik (PSrE),
              sehingga tidak memiliki kekuatan pembuktian yang sama dengan sertifikat digital.
            </p>
            <p>
              Hash dihitung dari ringkasan kontrak (nomor, jenis, periode, tipe upah, tarif, nama
              karyawan, dan nama perusahaan). Bila salah satu dari isi itu diubah setelah tanda
              tangan, hash tidak lagi cocok dan halaman ini menampilkan peringatan.
            </p>
            <p>
              Tautan tanda tangan diterbitkan lewat halaman admin dan hanya berlaku sekali. Dicetak{" "}
              {formatDateTimeZoned(new Date(), org.timezone)}.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
