"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Pesan hasil server action (`?ok=` / `?err=`) ditampilkan sebagai toast Sonner.
 * Setelah tampil, query string dibersihkan lewat router.replace supaya toast tidak
 * muncul lagi saat halaman di-refresh atau tombol back ditekan.
 */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  const router = useRouter();
  const shown = useRef(false);

  useEffect(() => {
    if (!ok && !err) return;
    if (shown.current) return;
    shown.current = true;

    if (err) {
      toast.error("Gagal", { description: err, duration: 8000 });
    } else {
      toast.success("Berhasil", { description: ok, duration: 4000 });
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("ok");
    url.searchParams.delete("err");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [ok, err, router]);

  return null;
}
