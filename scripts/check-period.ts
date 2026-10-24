/**
 * Cek logika periode gaji untuk semua tanggal mulai 1..31 tanpa perlu database.
 *
 * Jalankan: npx tsx scripts/check-period.ts
 *
 * Yang dibuktikan (setiap tanggal 2025-01-01..2028-12-31, startDay 1..31):
 * 1. periodContaining(date) selalu memuat `date`.
 * 2. periodContaining(date).start = awal periode bulan tanggal itu atau bulan sebelumnya
 *    (tidak pernah hasil geser yang drift).
 * 3. Periode berurutan bersambung: next.start = dayAfter(prev.end).
 * 4. recentPeriods sama dengan shiftPeriod(current.start, -i, startDay) dan bersambung.
 * 5. shiftPeriod(p.start, 1, startDay) = periode yang memuat dayAfter(p.end).
 * 6. Tanggal mulai asli dipakai ulang setelah bulan pendek (Februari), termasuk kabisat 2028.
 */
import {
  isDateInPeriod,
  periodContaining,
  periodStartFor,
  recentPeriods,
  shiftPeriod,
  type Period,
} from "../src/lib/period";

const FIRST = "2025-01-01";
const LAST = "2028-12-31";
const RECENT_COUNT = 6;
const MAX_DETAIL = 5;

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Stat = { total: number; failed: number };
const stats = new Map<string, Stat>();
const samples: string[] = [];

function check(startDay: number, label: string, ok: boolean, detail: string): void {
  const stat = stats.get(label) ?? { total: 0, failed: 0 };
  stat.total += 1;
  if (!ok) {
    stat.failed += 1;
    if (samples.length < MAX_DETAIL) samples.push(`[startDay ${startDay}] ${label}: ${detail}`);
  }
  stats.set(label, stat);
}

const fmt = (p: Period) => `${p.start}..${p.end}`;

for (let startDay = 1; startDay <= 31; startDay += 1) {
  let prev: Period | null = null;

  for (let cursor = FIRST; cursor <= LAST; cursor = dayAfter(cursor)) {
    const period = periodContaining(cursor, startDay);

    check(
      startDay,
      "periodContaining memuat tanggal",
      isDateInPeriod(cursor, period),
      `${cursor} tidak ada di ${fmt(period)}`,
    );
    check(
      startDay,
      "periodContaining(period.start) = period",
      periodContaining(period.start, startDay).start === period.start &&
        periodContaining(period.start, startDay).end === period.end,
      `${period.start} → ${fmt(periodContaining(period.start, startDay))}`,
    );

    // Awal periode harus terpaut ke awal bulan tanggal itu atau bulan sebelumnya,
    // bukan hasil geser dari periode sebelumnya (rawan drift di bulan pendek).
    const [cursorYear, cursorMonth] = cursor.split("-").map(Number);
    const startThisMonth = periodStartFor(cursorYear, cursorMonth - 1, startDay);
    const startPrevMonth = periodStartFor(cursorYear, cursorMonth - 2, startDay);
    check(
      startDay,
      "periodContaining.start = awal bulan ini atau bulan sebelumnya",
      period.start === startThisMonth || period.start === startPrevMonth,
      `${cursor} → ${period.start}, bukan ${startThisMonth} / ${startPrevMonth}`,
    );

    if (prev && period.start !== prev.start) {
      check(
        startDay,
        "periode berurutan bersambung",
        period.start === dayAfter(prev.end),
        `${fmt(prev)} lalu ${fmt(period)}`,
      );
      check(
        startDay,
        "shiftPeriod(prev.start, 1, startDay) = periode berikutnya",
        shiftPeriod(prev.start, 1, startDay).start === period.start,
        `${prev.start} → ${shiftPeriod(prev.start, 1, startDay).start}, harusnya ${period.start}`,
      );
      check(
        startDay,
        "shiftPeriod(p.start, 1, startDay) = periodContaining(dayAfter(p.end))",
        shiftPeriod(prev.start, 1, startDay).end ===
          periodContaining(dayAfter(prev.end), startDay).end &&
          shiftPeriod(prev.start, 1, startDay).start ===
            periodContaining(dayAfter(prev.end), startDay).start,
        `${fmt(shiftPeriod(prev.start, 1, startDay))} vs ${fmt(periodContaining(dayAfter(prev.end), startDay))}`,
      );

      // recentPeriods cukup dicek satu kali per periode.
      const recent = recentPeriods(period.start, startDay, RECENT_COUNT);
      check(
        startDay,
        "recentPeriods[0] = periode saat ini",
        recent[0].start === period.start && recent[0].end === period.end,
        `${fmt(recent[0])} vs ${fmt(period)}`,
      );
      for (let i = 1; i < RECENT_COUNT; i += 1) {
        const expected = shiftPeriod(period.start, -i, startDay);
        check(
          startDay,
          "recentPeriods[i] = shiftPeriod(current.start, -i, startDay)",
          recent[i].start === expected.start && recent[i].end === expected.end,
          `i=${i}: ${fmt(recent[i])} vs ${fmt(expected)}`,
        );
        check(
          startDay,
          "recentPeriods bersambung",
          dayAfter(recent[i].end) === recent[i - 1].start,
          `i=${i}: ${fmt(recent[i])} lalu ${fmt(recent[i - 1])}`,
        );
      }
    }

    prev = period;
  }

  // Tanggal mulai asli harus dipakai ulang setelah Februari (tahun pendek).
  const feb = periodStartFor(2026, 1, startDay);
  const nextAfterFeb = shiftPeriod(feb, 1, startDay).start;
  check(
    startDay,
    "tanggal mulai asli dipakai setelah bulan pendek",
    nextAfterFeb === periodStartFor(2026, 2, startDay),
    `Feb ${feb} → ${nextAfterFeb}, harusnya ${periodStartFor(2026, 2, startDay)}`,
  );

  // Februari 2028 kabisat: tanggal mulai 30/31 menempel ke 29, tapi Maret kembali ke 30/31.
  if (startDay > 29) {
    check(
      startDay,
      "kabisat: mulai Februari 2028 dibatasi ke 29",
      periodStartFor(2028, 1, startDay) === "2028-02-29" &&
        periodStartFor(2028, 2, startDay) === `2028-03-${startDay}`,
      `Feb ${periodStartFor(2028, 1, startDay)} / Mar ${periodStartFor(2028, 2, startDay)}`,
    );
  }
}

// Contoh eksplisit tahun kabisat: startDay 31 → 29 Feb 2028.
check(
  31,
  "periodStartFor(2028, 1, 31) = 2028-02-29",
  periodStartFor(2028, 1, 31) === "2028-02-29",
  periodStartFor(2028, 1, 31),
);
check(
  31,
  "periodContaining(2028-02-29, 31).start = 2028-02-29",
  periodContaining("2028-02-29", 31).start === "2028-02-29",
  periodContaining("2028-02-29", 31).start,
);

let failed = 0;
for (const [label, stat] of stats) {
  const ok = stat.failed === 0;
  if (!ok) failed += stat.failed;
  console.log(`${ok ? "✓" : "✗"} ${label} (${stat.total} cek, ${stat.failed} gagal)`);
}

if (samples.length > 0) {
  console.log("\ncontoh kegagalan:");
  for (const sample of samples) console.log(`  - ${sample}`);
}

console.log(`\nrentang ${FIRST}..${LAST} · startDay 1..31`);

if (failed > 0) {
  console.error(`\n${failed} cek gagal`);
  process.exit(1);
}
console.log("semua cek lulus");