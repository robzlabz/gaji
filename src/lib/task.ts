/**
 * Aturan status tugas.
 *
 * Dua jalur pembuatan tugas:
 * - admin membuat tugas lengkap dengan tarif (`open`) — karyawan mengerjakan lalu menandai selesai;
 * - karyawan mengajukan tugas sendiri (`requested`) — harga dan persetujuan diisi admin.
 *
 * Hanya tugas `approved` yang masuk payroll, jadi pengajuan karyawan tidak pernah
 * menghasilkan uang sebelum admin mengisi harganya.
 */

import type { Tone } from "@/components/status-badge";

/** Satuan yang sering dipakai; tetap boleh diisi bebas. */
export const TASK_UNIT_OPTIONS = ["tugas", "pcs", "kg", "meter", "jam", "hari", "paket"] as const;

export function taskStatusTone(status: string): Tone {
  switch (status) {
    case "approved":
      return "good";
    case "rejected":
      return "bad";
    case "done":
      return "warn";
    case "requested":
      return "info";
    default:
      return "default";
  }
}

/** Karyawan hanya boleh mengubah tugas yang belum diputuskan admin. */
export function isTaskEditable(status: string): boolean {
  return status === "requested" || status === "open";
}

/** Tugas yang sudah dikirim karyawan tapi harganya belum diisi admin. */
export function isTaskAwaitingPrice(status: string, unitRate: string | number): boolean {
  return status === "requested" || (status !== "rejected" && Number(unitRate) <= 0);
}
