"use client";

import { useEffect, useState } from "react";
import { formatDurationClock } from "@/lib/format";

/**
 * Jam berjalan (update per detik) untuk sesi absensi yang sedang terbuka.
 *
 * Sengaja jadi komponen sendiri: state per detik hanya me-render ulang span ini,
 * bukan seluruh halaman absen. Nilai awal `null` supaya markup server dan klien
 * sama (tidak ada hydration mismatch) — detik pertama diisi setelah mount.
 */
export function LiveDuration({
  since,
  className,
  placeholder = "--:--:--",
}: {
  since: string;
  className?: string;
  placeholder?: string;
}) {
  const startMs = new Date(since).getTime();
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (Number.isNaN(startMs)) return;
    setElapsedMs(Date.now() - startMs);
    const timer = setInterval(() => setElapsedMs(Date.now() - startMs), 1000);
    return () => clearInterval(timer);
  }, [startMs]);

  const ready = elapsedMs !== null && !Number.isNaN(startMs);

  return (
    <span className={className} suppressHydrationWarning>
      {ready ? formatDurationClock(elapsedMs) : placeholder}
    </span>
  );
}
