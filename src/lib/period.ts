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

/** Periode yang memuat `anchor` (YYYY-MM-DD) berdasarkan tanggal mulai. */
export function periodContaining(anchor: string, startDay: number): Period {
  const [y, m, d] = anchor.split("-").map(Number);
  const monthIndex = m - 1;
  const startDayThisMonth = clampDay(y, monthIndex, startDay);

  let start: string;
  if (d >= startDayThisMonth) {
    start = iso(y, monthIndex, startDayThisMonth);
  } else {
    const prev = new Date(Date.UTC(y, monthIndex - 1, 1));
    const py = prev.getUTCFullYear();
    const pm = prev.getUTCMonth();
    start = iso(py, pm, clampDay(py, pm, startDay));
  }

  return { start, end: dayBefore(shiftPeriod(start, 1).start) };
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Geser awal periode sebanyak `months`. */
export function shiftPeriod(start: string, months: number): Period {
  const [y, m, d] = start.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const tStart = iso(ty, tm, clampDay(ty, tm, d));
  const nextMonth = new Date(Date.UTC(ty, tm + 1, 1));
  const ny = nextMonth.getUTCFullYear();
  const nm = nextMonth.getUTCMonth();
  const nextStart = iso(ny, nm, clampDay(ny, nm, d));
  return { start: tStart, end: dayBefore(nextStart) };
}

/** Daftar periode terakhir (untuk dropdown), terbaru di depan. */
export function recentPeriods(anchor: string, startDay: number, count = 6): Period[] {
  const current = periodContaining(anchor, startDay);
  const out: Period[] = [current];
  for (let i = 1; i < count; i += 1) {
    out.push(shiftPeriod(current.start, -i));
  }
  return out;
}

/** Jumlah hari kerja (Senin–Sabtu) dalam periode — fallback prorata. */
export function countWorkDays(start: string, end: string): number {
  let cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  let count = 0;
  while (cursor <= stop) {
    const dow = cursor.getUTCDay();
    if (dow !== 0) count += 1;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return count;
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
