import { workDatesBetween } from "./period";

/** Jenis cuti yang didukung MVP. Disimpan sebagai teks di `leaves.kind`. */
export const LEAVE_KIND_LABEL: Record<string, string> = {
  cuti: "Cuti",
  sakit: "Sakit",
  izin: "Izin",
};

export const LEAVE_KIND_OPTIONS = [
  { value: "cuti", label: "Cuti", hint: "Tahunan / pribadi" },
  { value: "sakit", label: "Sakit", hint: "Sakit & pemulihan" },
  { value: "izin", label: "Izin", hint: "Urusan mendadak" },
];

/** Pilihan upah cuti. Nilai "1"/"0" supaya cocok dengan radio button di form. */
export const LEAVE_PAID_OPTIONS = [
  { value: "1", label: "Berbayar", hint: "Gaji tetap — hari cuti tetap dibayar." },
  { value: "0", label: "Tanpa upah", hint: "Gaji bulan ini diprorata turun." },
];

/**
 * Penjelasan lengkap untuk ikon (i) di bagian upah.
 * Dipakai tooltip supaya admin paham efeknya ke payroll sebelum menyimpan.
 */
export const LEAVE_PAID_HELP =
  "Berbayar (gaji tetap): hari cuti dihitung sebagai hari kerja, jadi gaji bulanan tidak berkurang. " +
  "Tanpa upah: hari cuti tidak dihitung, gaji bulan ini diprorata turun sebesar hari kerja yang hilang. " +
  "Cuti yang masih menunggu tidak memengaruhi payroll sampai disetujui.";

/** Nilai `kind` yang diterima server action; selain ini jatuh ke "cuti". */
export function normalizeLeaveKind(raw: string): string {
  return LEAVE_KIND_OPTIONS.some((option) => option.value === raw) ? raw : "cuti";
}

export function leaveKindLabel(kind: string): string {
  return LEAVE_KIND_LABEL[kind] ?? kind;
}

export type LeaveTone = "default" | "good" | "warn" | "bad";

/** Warna badge status cuti (cocok dengan prop `tone` StatusBadge). */
export function leaveStatusTone(status: string): LeaveTone {
  if (status === "approved") return "good";
  if (status === "pending") return "warn";
  if (status === "rejected") return "bad";
  return "default";
}

/** Jumlah hari kerja (Senin–Sabtu) pada rentang cuti. */
export function leaveWorkDays(start: string, end: string): number {
  return workDatesBetween(start, end).length;
}

/** Rentang tanggal bertumpuk (inklusif). */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export type LeaveRange = {
  startDate: string;
  endDate: string;
  paid: boolean;
  status: string;
};

/**
 * Tanggal cuti approved yang jatuh di dalam satu periode, dipisah berbayar / tanpa upah.
 * Dipakai payroll bulanan: hari berbayar menambah hari kerja yang dibayar.
 */
export function leaveDatesInPeriod(
  leaves: LeaveRange[],
  periodStart: string,
  periodEnd: string,
): { paid: Set<string>; unpaid: Set<string> } {
  const paid = new Set<string>();
  const unpaid = new Set<string>();

  for (const leave of leaves) {
    if (leave.status !== "approved") continue;
    if (!rangesOverlap(leave.startDate, leave.endDate, periodStart, periodEnd)) continue;

    const bucket = leave.paid ? paid : unpaid;
    for (const day of workDatesBetween(leave.startDate, leave.endDate)) {
      if (day < periodStart || day > periodEnd) continue;
      bucket.add(day);
    }
  }

  return { paid, unpaid };
}

/** Rentang tampilan: satu hari cukup satu tanggal, selain itu "mulai – selesai". */
export function leaveRangeLabel(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
}

/** Label upah singkat untuk daftar & ringkasan. */
export function leavePaidLabel(paid: boolean): string {
  return paid ? "berbayar" : "tanpa upah";
}
