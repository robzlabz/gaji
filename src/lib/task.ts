/**
 * Aturan status tugas.
 *
 * Dua jalur pembuatan tugas:
 * - admin membuat tugas lengkap dengan tarif (`open`) — karyawan mengerjakan lalu menandai selesai;
 * - karyawan mengajukan tugas sendiri (`requested`) — harga dan persetujuan diisi admin.
 *
 * Hanya tugas `approved` yang masuk payroll, jadi pengajuan karyawan tidak pernah
 * menghasilkan uang sebelum admin mengisi harganya. Tugas yang disetujui dibayar
 * sebagai penghasilan tambahan untuk semua tipe gaji (bukan hanya `per_task`).
 * Bila persetujuannya baru terjadi setelah payroll periode tugas itu difinalkan,
 * upahnya ikut dibayar di periode berikutnya sebagai tugas bawaan.
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

/**
 * Karyawan hanya boleh mengubah pengajuan tugasnya sendiri (`requested`).
 *
 * Tugas buatan admin (`open`/`done`) tidak boleh diubah karyawan: qty, satuan, dan
 * tanggalnya ditetapkan admin bersama tarifnya, jadi mengubah salah satunya bisa
 * membuat upah tidak sesuai tarif yang disetujui.
 */
export function isTaskEditable(status: string): boolean {
  return status === "requested";
}

/** Tugas yang sudah dikirim karyawan tapi harganya belum diisi admin. */
export function isTaskAwaitingPrice(status: string, unitRate: string | number): boolean {
  return status === "requested" || (status !== "rejected" && Number(unitRate) <= 0);
}
