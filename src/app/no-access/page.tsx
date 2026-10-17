import Link from "next/link";
import { btnGhost } from "@/components/ui";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-stone-900">Akun belum terhubung ke perusahaan</h1>
        <p className="mt-2 text-sm text-muted">
          Akunmu belum terdaftar sebagai anggota perusahaan mana pun. Minta admin menambahkan nomor
          HP kamu sebagai karyawan.
        </p>
        <Link href="/login" className={`${btnGhost} mt-6`}>
          Kembali ke halaman masuk
        </Link>
      </div>
    </main>
  );
}
