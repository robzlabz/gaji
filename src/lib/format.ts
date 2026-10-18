export const APP_NAME = "Gaji";

/**
 * Normalisasi nomor HP ke bentuk digit lengkap dengan kode negara (tanpa "+").
 * Contoh dengan kode 62: "0822-2222-222" / "+62 822 2222 222" / "62822222222" /
 * "822222222" semuanya menjadi "62822222222".
 *
 * Aturan: buang semua non-digit, buang kode negara bila user mengetiknya sendiri,
 * lalu buang trunk prefix "0" dan tambahkan kode negara sekali saja (idempoten).
 */
export function normalizePhone(raw: string, dialCode: string = "62"): string {
  const cc = dialCode.replace(/\D/g, "");
  if (!cc) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  // Buang trunk prefix "0" dan prefix internasional "00" lebih dulu, supaya
  // "0822…" dan "0062 822…" sama-sama bersih sebelum deteksi kode negara.
  digits = digits.replace(/^0+/, "");

  // Kode negara sudah diketik user (mis. "62 822…" / "+62 0822…").
  // Syarat sisa digit >= 6 agar nomor lokal yang kebetulan diawali angka yang
  // sama dengan kode negara tidak ikut terpotong; kalau sisa < 6 anggap nomor
  // sudah ber-kode negara supaya fungsi ini idempoten.
  if (digits.startsWith(cc)) {
    if (digits.length - cc.length >= 6) {
      digits = digits.slice(cc.length).replace(/^0+/, "");
    } else {
      return digits;
    }
  }

  return digits ? cc + digits : "";
}

export function isValidPhone(raw: string, dialCode: string = "62"): boolean {
  const cc = dialCode.replace(/\D/g, "");
  const normalized = normalizePhone(raw, cc);
  if (!cc || !normalized.startsWith(cc)) return false;
  // E.164: panjang total 8–15 digit, dan minimal 6 digit nomor nasional.
  return normalized.length <= 15 && normalized.length - cc.length >= 6;
}

/** Tampilan ramah: +62 812-3456-7890 */
export function formatPhoneDisplay(digits: string, dialCode: string = "62"): string {
  const cc = dialCode.replace(/\D/g, "");
  const national = digits.replace(/\D/g, "").startsWith(cc)
    ? digits.replace(/\D/g, "").slice(cc.length)
    : digits.replace(/\D/g, "");
  if (!national) return "";
  // Nomor Indonesia: 812-3456-7890 (3-4-4). Selain itu kelompokkan per 4 digit.
  const grouped =
    cc === "62" && national.length >= 8
      ? `${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`
      : national.replace(/(\d{4})(?=\d)/g, "$1-");
  return `+${cc} ${grouped}`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits ? "+" + digits : "";
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  return typeof value === "number" ? value : Number(value);
}

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function rupiah(value: string | number | null | undefined): string {
  return idr.format(Math.round(toNumber(value)));
}

export function rupiahShort(value: string | number | null | undefined): string {
  const n = Math.round(toNumber(value));
  const dec = (x: number) => x.toFixed(1).replace(".", ",");
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${dec(n / 1_000_000_000)} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp ${dec(n / 1_000_000)} jt`;
  if (Math.abs(n) >= 1_000) return `Rp ${Math.round(n / 1_000)} rb`;
  return `Rp ${n}`;
}

export function parseMoneyInput(raw: FormDataEntryValue | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const cleaned = String(raw).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Tanggal (YYYY-MM-DD) pada zona waktu tertentu */
export function localDateString(date: Date, timeZone = "Asia/Jakarta"): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function formatDateID(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTimeID(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

export function formatTimeID(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

export function minutesToHoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}j ${m}m`;
}

export function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const PAY_TYPE_LABEL: Record<string, string> = {
  hourly: "Per jam",
  daily: "Per hari",
  monthly: "Per bulan",
  per_task: "Per tugas",
};

export const PAY_TYPE_UNIT: Record<string, string> = {
  hourly: "jam",
  daily: "hari",
  monthly: "bulan",
  per_task: "tugas",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  employee: "Karyawan",
};

export const CONTRACT_KIND_LABEL: Record<string, string> = {
  pkwt: "PKWT (kontrak)",
  pkwtt: "PKWTT (tetap)",
  probation: "Percobaan",
  other: "Lainnya",
};
