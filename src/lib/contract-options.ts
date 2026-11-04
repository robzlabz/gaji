import type { PayType } from "@/db/schema";

/** Pilihan jenis & tipe gaji kontrak — dipakai halaman daftar, tambah, dan ubah kontrak. */
export const CONTRACT_KIND_OPTIONS = [
  { value: "pkwt", label: "PKWT (kontrak)" },
  { value: "probation", label: "Percobaan" },
  { value: "pkwtt", label: "PKWTT (tetap)" },
  { value: "other", label: "Lainnya" },
] as const;

export const PAY_TYPE_OPTIONS = [
  { value: "hourly", label: "Per jam" },
  { value: "daily", label: "Per hari" },
  { value: "monthly", label: "Per bulan" },
  { value: "per_task", label: "Per tugas" },
] as const;

/** Guard tipe gaji: nilai form hanya sah kalau ada di PAY_TYPE_OPTIONS. */
export function isPayType(value: string): value is PayType {
  return PAY_TYPE_OPTIONS.some((option) => option.value === value);
}

/** Jenis kontrak yang wajib punya tanggal berakhir (semua kecuali PKWTT). */
export function requiresEndDate(kind: string): boolean {
  return kind !== "pkwtt";
}

/** Path admin internal saja; nilai lain diganti fallback. */
export function safeAdminPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value === "/admin" || value.startsWith("/admin/") ? value : fallback;
}
