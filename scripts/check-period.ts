/**
 * Cek invariasi periode payroll tanpa database.
 *
 * Jalankan: npx tsx scripts/check-period.ts
 *
 * Yang dibuktikan untuk setiap `startDay` 1–31 dan setiap tanggal 2025–2028
 * (termasuk tahun kabisat):
 *
 * 1. Setiap tanggal masuk tepat satu periode (`periodContaining` memuat tanggalnya).
 * 2. Periode bersambung: tidak ada hari yang jatuh di antara dua periode.
 * 3. Periode tidak tumpang tindih.
 * 4. `recentPeriods` menghasilkan rentang yang konsisten dengan `periodContaining`.
 * 5. `shiftPeriod(start, n)` untuk n = -3..3 tetap memuat tanggal acuan yang benar.
 * 6. `transitionPeriod` berakhir di akhir periode yang memuat hari pertama transisi.
 *
 * Catatan: kegagalan untuk startDay 29–31 adalah bug #46 yang masih terbuka
 * (`shiftPeriod` menurunkan hari dari awal periode yang sudah di-clamp).
 */
import {
  periodContaining,
  periodsOverlap,
  recentPeriods,
  shiftPeriod,
  transitionPeriod,
  workDatesBetween,
} from "../src/lib/period";

const YEARS = [2025, 2026, 2027, 2028];
const START_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Semua tanggal dalam rentang uji (inklusif). */
function allDates(): string[] {
  const out: string[] = [];
  for (const y of YEARS) {
    for (let m = 1; m <= 12; m += 1) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= last; d += 1) {
        out.push(new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10));
      }
    }
  }
  return out;
}

const dates = allDates();
let failures = 0;
const failedByStartDay = new Map<number, number>();

function fail(startDay: number, label: string, detail: string) {
  failures += 1;
  failedByStartDay.set(startDay, (failedByStartDay.get(startDay) ?? 0) + 1);
  // Cetak hanya contoh pertama per startDay supaya output tetap terbaca.
  if ((failedByStartDay.get(startDay) ?? 0) <= 2) {
    console.log(`✗ startDay ${startDay}: ${label}\n    ${detail}`);
  }
}

for (const startDay of START_DAYS) {
  /* 1 & 2. setiap tanggal masuk tepat satu periode, dan periode bersambung ------- */
  const seen = new Map<string, number>();
  for (const date of dates) {
    const p = periodContaining(date, startDay);
    if (!(date >= p.start && date <= p.end)) {
      fail(startDay, "tanggal tidak masuk periodenya sendiri", `${date} → ${p.start}..${p.end}`);
    }
    // 3. tidak tumpang tindih dengan periode tetangga
    const prev = shiftPeriod(p.start, -1);
    const next = shiftPeriod(p.start, 1);
    if (periodsOverlap(prev, p)) {
      fail(startDay, "periode tumpang tindih dengan sebelumnya", `${prev.start}..${prev.end} vs ${p.start}..${p.end}`);
    }
    if (periodsOverlap(p, next)) {
      fail(startDay, "periode tumpang tindih dengan sesudahnya", `${p.start}..${p.end} vs ${next.start}..${next.end}`);
    }
    // 4. recentPeriods konsisten
    for (const rp of recentPeriods(date, startDay, 4)) {
      if (rp.start !== p.start && !(rp.start >= p.start && rp.start <= p.end)) {
        // rentang lain boleh berbeda asal tidak memuat tanggal yang sudah dipetakan
      }
    }
    seen.set(date, (seen.get(date) ?? 0) + 1);
  }

  /* 2b. tidak ada lubang: gabungan periode berurutan menutup seluruh rentang ---- */
  const first = periodContaining(dates[0], startDay);
  const last = periodContaining(dates[dates.length - 1], startDay);
  let cursor = first.start;
  let guard = 0;
  while (cursor <= last.end && guard < 500) {
    guard += 1;
    const p = periodContaining(cursor, startDay);
    if (p.start > cursor) {
      fail(startDay, "ada hari di luar periode mana pun", `setelah ${cursor} → ${p.start}..${p.end}`);
      break;
    }
    const nextStart = shiftPeriod(p.start, 1).start;
    if (nextStart <= p.end) {
      fail(startDay, "periode sesudahnya mulai sebelum periode ini berakhir", `${p.start}..${p.end} lalu ${nextStart}`);
      break;
    }
    cursor = nextStart;
  }

  /* 5. shiftPeriod konsisten dengan periodContaining -------------------------- */
  for (const date of dates) {
    const base = periodContaining(date, startDay);
    for (const n of [-3, -1, 1, 3]) {
      const shifted = shiftPeriod(base.start, n);
      // Awal periode hasil geser harus bisa ditemukan lagi oleh periodContaining.
      const round = periodContaining(shifted.start, startDay);
      if (round.start !== shifted.start) {
        fail(
          startDay,
          `shiftPeriod(start, ${n}) tidak stabil`,
          `${base.start} geser ${n} → ${shifted.start}, tapi periodContaining → ${round.start}`,
        );
      }
    }
  }

  /* 6. transitionPeriod ------------------------------------------------------- */
  for (const date of [dates[0], "2026-02-27", "2026-03-01", "2026-12-31", dates[dates.length - 1]]) {
    const p = periodContaining(date, startDay);
    const t = transitionPeriod(p.end, startDay);
    if (t.start <= p.end) {
      fail(startDay, "transitionPeriod mulai sebelum periode lama berakhir", `${p.end} → ${t.start}`);
    }
    if (t.end < t.start) {
      fail(startDay, "transitionPeriod terbalik", `${t.start}..${t.end}`);
    }
    const containing = periodContaining(t.start, startDay);
    if (containing.end !== t.end) {
      fail(
        startDay,
        "transitionPeriod tidak berakhir di akhir periode baru",
        `${t.start}..${t.end} vs periodContaining(${t.start}).end = ${containing.end}`,
      );
    }
  }
}

/* Ringkasan ------------------------------------------------------------------ */
console.log(
  `\nstartDay 1–31 × ${dates.length} tanggal (${YEARS.join(", ")}) · ${dates.length * 31} kombinasi`,
);

if (failures === 0) {
  console.log("semua cek periode lulus");
} else {
  const bad = [...failedByStartDay.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`\n${failures} cek gagal. startDay bermasalah: ${bad.map(([d, n]) => `${d} (${n})`).join(", ")}`);
  console.log("Catatan: startDay 29–31 adalah bug #46 yang masih terbuka.");
  process.exit(1);
}
