/**
 * Periode gaji bisa diatur tanggal berapa sampai berapa.
 * Contoh: pay_period_start_day = 26 → periode 26 Jan s/d 25 Feb.
 */

export type Period = { start: string; end: string };

function iso(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

function clampDay(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(day, lastDay);
}

/**
 * Awal periode untuk bulan `monthIndex` (0–11) menurut tanggal mulai asli.
 * `monthIndex` boleh di luar 0–11 (dinormalkan oleh Date.UTC).
 * Contoh: startDay = 31 pada Februari → 28/29, tetapi Maret tetap tanggal 31.
 */
export function periodStartFor(year: number, monthIndex: number, startDay: number): string {
  return iso(year, monthIndex, clampDay(year, monthIndex, startDay));
}

/** Periode yang memuat `anchor` (YYYY-MM-DD) berdasarkan tanggal mulai. */
export function periodContaining(anchor: string, startDay: number): Period {
  const [y, m] = anchor.split("-").map(Number);
  const monthIndex = m - 1;
  const startThisMonth = periodStartFor(y, monthIndex, startDay);

  // Selalu hitung dari tanggal mulai asli, bukan dari tanggal yang sudah di-clamp.
  const start =
    anchor >= startThisMonth ? startThisMonth : periodStartFor(y, monthIndex - 1, startDay);

  return { start, end: dayBefore(shiftPeriod(start, 1, startDay).start) };
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Dua periode beririsan (inklusif) — dipakai untuk mencegah hari dibayar dua kali. */
export function periodsOverlap(a: Period, b: Period): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/**
 * Periode transisi setelah periode terakhir yang sudah dihitung.
 * Mulai sehari setelah `lastEnd` dan berakhir di akhir periode yang memuat hari itu
 * menurut `startDay` terbaru. Dipakai saat tanggal mulai periode diubah.
 */
export function transitionPeriod(lastEnd: string, startDay: number): Period {
  const start = dayAfter(lastEnd);
  // Awal tetap sehari setelah periode terakhir; hanya akhirnya yang ikut periode baru.
  return { start, end: periodContaining(start, startDay).end };
}

/**
 * Geser awal periode sebanyak `months`.
 * `start` harus berupa awal periode untuk `startDay` (tanggal mulai asli dari
 * pengaturan organisasi); `startDay` dipakai ulang setiap bulan sehingga tanggal
 * tidak bergeser setelah bulan pendek (mis. Februari).
 */
export function shiftPeriod(start: string, months: number, startDay: number): Period {
  const [y, m] = start.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const tStart = periodStartFor(ty, tm, startDay);
  const nextMonth = new Date(Date.UTC(ty, tm + 1, 1));
  const nextStart = periodStartFor(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), startDay);
  return { start: tStart, end: dayBefore(nextStart) };
}

/** Daftar periode terakhir (untuk dropdown), terbaru di depan. */
export function recentPeriods(anchor: string, startDay: number, count = 6): Period[] {
  const current = periodContaining(anchor, startDay);
  const out: Period[] = [current];
  for (let i = 1; i < count; i += 1) {
    out.push(shiftPeriod(current.start, -i, startDay));
  }
  return out;
}

/** Daftar tanggal hari kerja (Senin–Sabtu) dalam rentang inklusif. */
export function workDatesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  if (!start || !end || end < start) return out;

  let cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(stop.getTime())) return out;

  while (cursor <= stop) {
    if (cursor.getUTCDay() !== 0) out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

/** Jumlah hari kerja (Senin–Sabtu) dalam periode — fallback prorata. */
export function countWorkDays(start: string, end: string): number {
  return workDatesBetween(start, end).length;
}

export function isDateInPeriod(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

export function periodLabel(period: Period): string {
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(`${s}T00:00:00`),
    );
  return `${fmt(period.start)} – ${fmt(period.end)}`;
}
