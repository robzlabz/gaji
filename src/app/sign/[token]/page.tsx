import type { Metadata } from "next";
import { effectiveSignatureStatus, isSignTokenShape, SIGN_TOKEN_TTL_DAYS } from "@/lib/esign";
import { findSignatureByToken } from "@/lib/esign-contract";
import {
  CONTRACT_KIND_LABEL,
  formatDateID,
  formatDateTimeZoned,
  PAY_TYPE_LABEL,
  rupiah,
  toNumber,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { signContractAction } from "./actions";

export const metadata: Metadata = { title: "Tanda tangan kontrak — Gaji" };

/**
 * Pesan gagal dipetakan dari kode di query (`?e=`) supaya isi pesan tidak bisa
 * dititipkan lewat tautan yang dibagikan orang lain.
 */
const SIGN_ERROR_MESSAGE: Record<string, string> = {
  invalid: "Tautan tidak valid.",
  missing: "Tautan tanda tangan tidak ditemukan.",
  used: "Kontrak ini sudah ditandatangani. Tautan hanya berlaku sekali.",
  revoked: "Tautan ini sudah dicabut oleh perusahaan.",
  expired: "Tautan sudah kedaluwarsa. Minta tautan baru ke perusahaan.",
  agree: "Centang pernyataan persetujuan dulu.",
  name: "Nama lengkap wajib diisi (3–120 huruf).",
};

/** Baris ringkasan kontrak di halaman publik: label kiri, nilai kanan. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t py-2 first:border-t-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium sm:text-right">{value}</dd>
    </div>
  );
}

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default async function SignContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;
  const err = e ? SIGN_ERROR_MESSAGE[e] ?? null : null;

  if (!isSignTokenShape(token)) {
    return (
      <Shell>
        <Notice
          title="Tautan tidak valid"
          description="Alamat ini bukan tautan tanda tangan kontrak. Minta ulang tautannya ke perusahaan."
        />
      </Shell>
    );
  }

  const ctx = await findSignatureByToken(token);
  if (!ctx) {
    return (
      <Shell>
        <Notice
          title="Tautan tidak ditemukan"
          description="Tautan ini tidak dikenali, mungkin sudah dihapus bersama kontraknya. Minta tautan baru ke perusahaan."
        />
      </Shell>
    );
  }

  const { signature, contract } = ctx;
  const status = effectiveSignatureStatus(signature, new Date());
  const period = `${formatDateID(contract.startDate)} – ${
    contract.endDate ? formatDateID(contract.endDate) : "tanpa batas"
  }`;

  const summary = (
    <dl className="flex flex-col">
      <SummaryRow label="Nomor kontrak" value={contract.contractNo ?? "—"} />
      <SummaryRow label="Jenis kontrak" value={CONTRACT_KIND_LABEL[contract.kind] ?? contract.kind} />
      <SummaryRow label="Periode" value={period} />
      <SummaryRow
        label="Upah"
        value={`${rupiah(toNumber(contract.payRate))} / ${PAY_TYPE_LABEL[contract.payType] ?? contract.payType}`}
      />
      <SummaryRow label="Karyawan" value={ctx.employeeName} />
      <SummaryRow label="Perusahaan" value={ctx.orgName} />
    </dl>
  );

  if (status === "signed") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Kontrak sudah ditandatangani</CardTitle>
            <CardDescription>
              Terima kasih, {signature.signerName}. Tautan ini tidak bisa dipakai lagi.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {summary}
            <Separator />
            <dl className="flex flex-col text-xs text-muted-foreground">
              <div className="flex justify-between gap-4 py-1">
                <dt>Waktu tanda tangan</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTimeZoned(signature.signedAt, ctx.orgTimezone)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-1">
                <dt>Kode bukti (SHA-256 ringkasan kontrak)</dt>
                <dd className="font-mono text-[11px] break-all text-foreground">
                  {signature.signatureHash ?? "—"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Simpan kode bukti di atas. Perusahaan bisa mencetak halaman bukti tanda tangan yang
              memuat nama, waktu, alamat IP, dan kode yang sama.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (status === "revoked") {
    return (
      <Shell>
        <Notice
          title="Tautan sudah dicabut"
          description="Perusahaan telah mencabut tautan tanda tangan ini. Hubungi perusahaan bila kontrak masih perlu ditandatangani."
        />
      </Shell>
    );
  }

  if (status === "expired") {
    return (
      <Shell>
        <Notice
          title="Tautan sudah kedaluwarsa"
          description={`Tautan tanda tangan hanya berlaku ${SIGN_TOKEN_TTL_DAYS} hari. Minta tautan baru ke perusahaan.`}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan kontrak</CardTitle>
          <CardDescription>
            Periksa isi kontrak di bawah sebelum menandatangani. Tautan ini hanya bisa dipakai
            sekali.
          </CardDescription>
        </CardHeader>
        <CardContent>{summary}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Isi tanda tangan</CardTitle>
          <CardDescription>
            Dengan menandatangani, Anda menyatakan sudah membaca dan menyetujui isi kontrak di atas.
            Bukti tanda tangan (nama, waktu, alamat IP, dan hash isi kontrak) disimpan untuk
            keperluan verifikasi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signContractAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />

            {err ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {err}
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Nama lengkap</span>
              <Input
                name="signerName"
                required
                minLength={3}
                maxLength={120}
                autoComplete="name"
                placeholder="Nama sesuai KTP"
                defaultValue=""
              />
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="agree" required className="mt-0.5 size-4 accent-primary" />
              <span className="text-muted-foreground">
                Saya sudah membaca ringkasan kontrak di atas dan menyetujui isinya.
              </span>
            </label>

            <Button type="submit" className="self-start">
              Tandatangani kontrak
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Tanda tangan ini adalah tanda tangan elektronik sederhana berupa bukti persetujuan (nama,
        waktu, IP, dan hash isi kontrak). Ini bukan tanda tangan elektronik tersertifikasi PSrE.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="mb-2 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            G
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Tanda tangan kontrak</h1>
          <p className="text-sm text-muted-foreground">Tidak perlu punya akun untuk menandatangani.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
