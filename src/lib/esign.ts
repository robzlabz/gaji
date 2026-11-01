/**
 * Tanda tangan elektronik sederhana untuk kontrak kerja.
 *
 * Modul ini **murni**: tanpa `server-only`, tanpa `@/db`, tanpa `next/*`, supaya
 * logika hash/kedaluwarsa bisa diuji langsung oleh `scripts/check-esign.ts`.
 * Pembuatan baris database ada di `@/db/schema` + server action masing-masing halaman.
 *
 * Batas yang disengaja: ini bukti persetujuan (nama, waktu, IP, user agent, hash
 * isi kontrak), **bukan** tanda tangan digital tersertifikasi PSrE.
 */
import { createHash, randomBytes } from "node:crypto";

/** Umur tautan tanda tangan. Setelah lewat, token tidak bisa dipakai lagi. */
export const SIGN_TOKEN_TTL_DAYS = 14;

/** Awalan token supaya tautan/kolom database gampang dikenali saat inspeksi. */
const SIGN_TOKEN_PREFIX = "sgn_";

export type SignatureStatus = "sent" | "signed" | "expired" | "revoked";

export const SIGNATURE_STATUS_LABEL: Record<SignatureStatus, string> = {
  sent: "menunggu tanda tangan",
  signed: "ditandatangani",
  expired: "kedaluwarsa",
  revoked: "dicabut",
};

const MS_PER_DAY = 86_400_000;

/** Token acak 24 byte (192 bit) dalam base64url — tidak bisa ditebak. */
export function createSignToken(): string {
  return `${SIGN_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/**
 * Validasi bentuk token **sebelum** menyentuh database.
 * Tautan yang tidak berbentuk seperti token buatan aplikasi langsung ditolak,
 * jadi tidak ada query untuk teks sembarangan.
 */
export function isSignTokenShape(value: string): boolean {
  return /^sgn_[A-Za-z0-9_-]{24,}$/.test(value);
}

/** Batas waktu token dibuat dari `now` + TTL hari. */
export function signatureExpiry(now: Date = new Date(), days: number = SIGN_TOKEN_TTL_DAYS): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

export function isSignatureExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Status yang benar-benar berlaku saat ini.
 * `sent` yang sudah lewat tenggat ditampilkan sebagai `expired` walau kolom
 * database masih `sent` (tidak perlu job yang menulis ulang status).
 */
export function effectiveSignatureStatus(
  row: { status: string; expiresAt: Date },
  now: Date = new Date(),
): SignatureStatus {
  if (row.status === "signed") return "signed";
  if (row.status === "revoked") return "revoked";
  if (row.status === "expired") return "expired";
  return isSignatureExpired(row.expiresAt, now) ? "expired" : "sent";
}

/** Isi kontrak yang dibekukan oleh hash saat ditandatangani. */
export type ContractSummary = {
  contractNo: string | null;
  kind: string;
  startDate: string;
  endDate: string | null;
  payType: string;
  payRate: string | number;
  employeeName: string;
  orgName: string;
};

/**
 * Rapikan satu nilai supaya tidak ada baris baru/spasi berlebih yang bisa
 * "menyusupkan" field palsu ke dalam teks kanonik.
 */
function oneLine(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Upah dinormalkan ke 2 desimal supaya "5000000" dan "5000000.00" sama persis. */
export function normalizePayRate(value: string | number | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

/**
 * Teks kanonik ringkasan kontrak: urutan field **eksplisit** (bukan urutan objek),
 * satu field per baris dengan kunci tetap. Nomor kontrak bertipe teks bebas,
 * jadi kunci `nomor=` didahulukan dan isinya dirapikan agar tidak bisa memalsukan
 * baris `tarif=`.
 */
export function canonicalContractSummary(summary: ContractSummary): string {
  return [
    "gaji-esign:v1",
    `nomor=${oneLine(summary.contractNo)}`,
    `jenis=${oneLine(summary.kind)}`,
    `mulai=${oneLine(summary.startDate)}`,
    `akhir=${oneLine(summary.endDate)}`,
    `upah=${oneLine(summary.payType)}`,
    `tarif=${normalizePayRate(summary.payRate)}`,
    `karyawan=${oneLine(summary.employeeName)}`,
    `organisasi=${oneLine(summary.orgName)}`,
  ].join("\n");
}

/**
 * SHA-256 atas ringkasan kontrak. Deterministik: isi yang sama selalu menghasilkan
 * hash yang sama, dan perubahan upah/periode/pihak mengubah hash.
 */
export function hashContractSummary(summary: ContractSummary): string {
  return createHash("sha256").update(canonicalContractSummary(summary), "utf8").digest("hex");
}

/** Hash kontrak saat ini dibandingkan dengan hash yang dibekukan saat tanda tangan. */
export function contractChangedSinceSignature(
  storedHash: string | null | undefined,
  current: ContractSummary,
): boolean {
  if (!storedHash) return false;
  return storedHash !== hashContractSummary(current);
}
