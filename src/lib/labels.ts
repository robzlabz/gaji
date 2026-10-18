/** Label status berbahasa Indonesia untuk nilai status di database (disimpan dalam bahasa Inggris). */
const STATUS_LABEL: Record<string, string> = {
  active: "aktif",
  renewed: "diperbarui",
  terminated: "diakhiri",
  expired: "kedaluwarsa",
  pending: "menunggu",
  approved: "disetujui",
  rejected: "ditolak",
  open: "terbuka",
  done: "selesai",
  draft: "draf",
  final: "final",
  paid: "dibayar",
  settled: "lunas",
  void: "dibatalkan",
};

/** Ubah status mentah jadi label tampilan; nilai tak dikenal dikembalikan apa adanya. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
