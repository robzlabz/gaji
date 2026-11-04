/**
 * Lembur otomatis (PP 35/2021) — modul **murni**.
 *
 * Tanpa `server-only`, tanpa `@/db`, tanpa `next/*`: semua fungsi di sini bisa dipakai
 * halaman server, payroll, ledger saldo, maupun skrip `scripts/check-lembur.ts`.
 *
 * Aturan PP 35/2021 pasal 31 (pekerja pada hari kerja):
 * - jam pertama lembur dibayar 1,5 × upah sejam;
 * - setiap jam berikutnya dibayar 2 × upah sejam.
 *
 * Asumsi yang dipakai (dan batasannya):
 * - **Hari kerja** ditentukan dari `workingDaysPerWeek`: 6 = Senin–Sabtu (bawaan aplikasi
 *   ini), 5 = Senin–Jumat, 7 = setiap hari. Sisa hari dihitung sebagai hari libur/istirahat
 *   mingguan, urut dari Minggu ke belakang.
 * - **Lembur hari libur / hari besar belum ditangani.** Tarif hari libur (2×/3×/4× menurut
 *   PP 35/2021) tidak dimodelkan: kelebihan jam di hari libur **tidak** dihitung otomatis,
 *   jadi admin harus mengisi `overtime_minutes` manual bila memang ada lembur di hari libur.
 *   Lembur manual di hari libur tetap dibayar dengan tangga hari kerja (1,5× lalu 2×).
 * - **Jam kerja normal per hari** sudah bersih dari istirahat: menit kerja yang dipakai
 *   adalah menit efektif (`workedMinutes` = selisih clock-in/out − istirahat).
 * - **Tarif sejam** dihitung dari pengaturan, tidak ada angka hardcode:
 *   per jam = tarif per jam; per hari = tarif harian ÷ jam normal per hari;
 *   per bulan = gaji bulanan ÷ (hari kerja efektif per bulan × jam normal per hari).
 * - Karyawan **per tugas** tidak punya dasar tarif sejam, jadi lemburnya tidak dihitung.
 */

/** Pengaturan lembur satu organisasi. Semua nilai sudah berupa angka. */
export type OvertimeSettings = {
  /** Jam kerja normal per hari (mis. 7 atau 7,5). */
  normalHoursPerDay: number;
  /** Hari kerja per minggu: 5 = Senin–Jumat, 6 = Senin–Sabtu, 7 = setiap hari. */
  workingDaysPerWeek: number;
  /** Hari kerja efektif per bulan — denominator gaji bulanan jadi tarif sejam. */
  workingDaysPerMonth: number;
  /** Pengali jam lembur pertama (PP 35/2021: 1,5). */
  firstHourMultiplier: number;
  /** Pengali jam lembur berikutnya (PP 35/2021: 2). */
  nextHourMultiplier: number;
};

/**
 * Bawaan: 7 jam/hari, 6 hari kerja/minggu (Senin–Sabtu seperti `period.ts`),
 * 22 hari kerja/bulan, 1,5× lalu 2×.
 */
export const DEFAULT_OVERTIME_SETTINGS: OvertimeSettings = {
  normalHoursPerDay: 7,
  workingDaysPerWeek: 6,
  workingDaysPerMonth: 22,
  firstHourMultiplier: 1.5,
  nextHourMultiplier: 2,
};

const MINUTES_PER_DAY = 24 * 60;

function num(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalisasi pengaturan (boleh angka dari kolom `numeric` Postgres yang datang sebagai
 * string, boleh kosong). Nilai di luar akal dipotong ke rentang yang masuk akal supaya
 * tarif sejam tidak pernah nol / tak hingga.
 */
export function normalizeOvertimeSettings(
  value?: Partial<OvertimeSettings> | null,
): OvertimeSettings {
  const raw = value ?? {};
  return {
    normalHoursPerDay: clamp(num(raw.normalHoursPerDay, DEFAULT_OVERTIME_SETTINGS.normalHoursPerDay), 0.5, 24),
    workingDaysPerWeek: clamp(
      Math.round(num(raw.workingDaysPerWeek, DEFAULT_OVERTIME_SETTINGS.workingDaysPerWeek)),
      1,
      7,
    ),
    workingDaysPerMonth: clamp(
      Math.round(num(raw.workingDaysPerMonth, DEFAULT_OVERTIME_SETTINGS.workingDaysPerMonth)),
      1,
      31,
    ),
    firstHourMultiplier: clamp(
      num(raw.firstHourMultiplier, DEFAULT_OVERTIME_SETTINGS.firstHourMultiplier),
      1,
      10,
    ),
    nextHourMultiplier: clamp(
      num(raw.nextHourMultiplier, DEFAULT_OVERTIME_SETTINGS.nextHourMultiplier),
      1,
      10,
    ),
  };
}

/** Baris `organizations` (nama kolom kamelCase dari Drizzle) → pengaturan lembur. */
export function overtimeSettingsFromOrg(
  org:
    | {
        normalHoursPerDay?: string | number | null;
        workingDaysPerWeek?: number | null;
        workingDaysPerMonth?: number | null;
        overtimeFirstMultiplier?: string | number | null;
        overtimeNextMultiplier?: string | number | null;
      }
    | null
    | undefined,
): OvertimeSettings {
  return normalizeOvertimeSettings({
    normalHoursPerDay: num(org?.normalHoursPerDay, DEFAULT_OVERTIME_SETTINGS.normalHoursPerDay),
    workingDaysPerWeek: num(
      org?.workingDaysPerWeek,
      DEFAULT_OVERTIME_SETTINGS.workingDaysPerWeek,
    ),
    workingDaysPerMonth: num(
      org?.workingDaysPerMonth,
      DEFAULT_OVERTIME_SETTINGS.workingDaysPerMonth,
    ),
    firstHourMultiplier: num(
      org?.overtimeFirstMultiplier,
      DEFAULT_OVERTIME_SETTINGS.firstHourMultiplier,
    ),
    nextHourMultiplier: num(
      org?.overtimeNextMultiplier,
      DEFAULT_OVERTIME_SETTINGS.nextHourMultiplier,
    ),
  });
}

/** Jam kerja normal per hari dalam menit (minimal 1 menit). */
export function normalMinutesPerDay(settings: OvertimeSettings): number {
  return Math.max(1, Math.round(normalizeOvertimeSettings(settings).normalHoursPerDay * 60));
}

/**
 * Apakah tanggal `YYYY-MM-DD` termasuk hari kerja menurut `workingDaysPerWeek`.
 * Hari libur dihitung mundur dari Minggu (7 hari → tidak ada libur, 6 → Minggu,
 * 5 → Sabtu+Minggu, 4 → Jumat+Sabtu+Minggu, dst).
 */
export function isWorkingDay(workDate: string, workingDaysPerWeek: number): boolean {
  const parsed = new Date(`${workDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return true;
  const weekday = parsed.getUTCDay(); // 0 = Minggu
  const daysPerWeek = clamp(Math.round(num(workingDaysPerWeek, 6)), 1, 7);
  const restDays = 7 - daysPerWeek;
  if (restDays <= 0) return true;
  if (weekday === 0) return false;
  return 7 - weekday >= restDays;
}

export type OvertimeSplit = {
  /** Total menit lembur yang diakui. */
  totalMinutes: number;
  /** Menit pada jam lembur pertama (maksimal 60). */
  firstMinutes: number;
  /** Menit setelah jam pertama. */
  nextMinutes: number;
  /** `manual` = angka `time_entries.overtime_minutes` menang; `auto` = hasil selisih jam. */
  source: "manual" | "auto" | "none";
};

/**
 * Pecah menit lembur jadi jam pertama + jam berikutnya.
 *
 * `manualMinutes` (yaitu `time_entries.overtime_minutes` yang diisi admin/karyawan) **menang**
 * atas perhitungan otomatis: begitu ada angka manual > 0, angka itulah yang dipakai.
 * Tanpa angka manual, lembur = menit kerja efektif − jam kerja normal per hari.
 */
export function splitOvertimeMinutes(input: {
  /** Menit kerja efektif (sudah dikurangi istirahat). */
  workedMinutes: number;
  /** Angka manual dari `time_entries.overtime_minutes`; 0/kosong = hitung otomatis. */
  manualMinutes?: number | null;
  /** Jam kerja normal per hari dalam menit; bawaan 7 jam. */
  normalMinutesPerDay?: number;
}): OvertimeSplit {
  const worked = Math.max(0, Math.floor(num(input.workedMinutes, 0)));
  const normal = Math.max(1, Math.floor(num(input.normalMinutesPerDay, 7 * 60)));
  const manual = Math.floor(num(input.manualMinutes, 0));

  let totalMinutes: number;
  let source: OvertimeSplit["source"];
  if (manual > 0) {
    totalMinutes = Math.min(manual, MINUTES_PER_DAY);
    source = "manual";
  } else {
    totalMinutes = Math.max(0, worked - normal);
    source = totalMinutes > 0 ? "auto" : "none";
  }

  const firstMinutes = Math.min(totalMinutes, 60);
  return {
    totalMinutes,
    firstMinutes,
    nextMinutes: totalMinutes - firstMinutes,
    source,
  };
}

/**
 * Tarif sejam untuk lembur menurut tipe upah. `null` = tipe ini tidak punya dasar tarif
 * sejam (karyawan per tugas) sehingga lemburnya tidak bisa dihitung otomatis.
 */
export function overtimeHourlyRate(input: {
  payType: string;
  /** Tarif upah karyawan sesuai `payType` (per jam / per hari / per bulan). */
  payRate: number;
  settings: OvertimeSettings;
}): number | null {
  const settings = normalizeOvertimeSettings(input.settings);
  const rate = num(input.payRate, 0);
  if (rate <= 0) return null;

  switch (input.payType) {
    case "hourly":
      return rate;
    case "daily":
      return rate / (normalMinutesPerDay(settings) / 60);
    case "monthly":
      return rate / (settings.workingDaysPerMonth * settings.normalHoursPerDay);
    default:
      return null;
  }
}

export type OvertimeWage = OvertimeSplit & {
  /** Tarif sejam yang dipakai (hasil konversi dari tipe upah). */
  hourlyRate: number;
  /** Pengali yang berlaku untuk tiap bagian. */
  firstMultiplier: number;
  nextMultiplier: number;
  /** Upah lembur tiap bagian, dibulatkan per absensi seperti accrual saldo. */
  firstWage: number;
  nextWage: number;
  totalWage: number;
  /** Absensi ini jatuh di hari kerja? (hari libur hanya dibayar bila manual). */
  workingDay: boolean;
};

/**
 * Upah lembur satu absensi.
 *
 * `null` bila tidak ada lembur yang bisa dibayar: absensi belum clock-out, tipe upah
 * tidak punya tarif sejam, atau kelebihan jamnya nol.
 *
 * Catatan hari libur: kelebihan jam di hari libur **tidak** dihitung otomatis (tarif hari
 * libur PP 35/2021 belum dimodelkan), tetapi angka manual tetap dibayar dengan tangga
 * hari kerja supaya lembur yang sudah dicatat admin tidak hilang.
 */
export function overtimeForEntry(input: {
  payType: string;
  /** Tarif upah pada tanggal absensi (tarif saat kejadian). */
  payRate: number;
  workDate: string;
  workedMinutes: number;
  manualMinutes?: number | null;
  hasClockOut?: boolean;
  settings: OvertimeSettings;
}): OvertimeWage | null {
  if (input.hasClockOut === false) return null;

  const settings = normalizeOvertimeSettings(input.settings);
  const hourlyRate = overtimeHourlyRate({
    payType: input.payType,
    payRate: input.payRate,
    settings,
  });
  if (hourlyRate === null) return null;

  const workingDay = isWorkingDay(input.workDate, settings.workingDaysPerWeek);
  const manual = Math.floor(num(input.manualMinutes, 0));
  if (!workingDay && manual <= 0) return null;

  const split = splitOvertimeMinutes({
    workedMinutes: input.workedMinutes,
    manualMinutes: manual,
    normalMinutesPerDay: normalMinutesPerDay(settings),
  });
  if (split.totalMinutes <= 0) return null;

  const firstWage = Math.round((split.firstMinutes / 60) * hourlyRate * settings.firstHourMultiplier);
  const nextWage = Math.round((split.nextMinutes / 60) * hourlyRate * settings.nextHourMultiplier);

  return {
    ...split,
    hourlyRate,
    firstMultiplier: settings.firstHourMultiplier,
    nextMultiplier: settings.nextHourMultiplier,
    firstWage,
    nextWage,
    totalWage: firstWage + nextWage,
    workingDay,
  };
}

/** Pengali dengan koma desimal Indonesia ("1,5", "2", "1,75"). */
export function formatMultiplier(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/**
 * Label baris slip lembur, dipakai payroll dan tampilan supaya angkanya seragam.
 * Contoh: "Lembur jam pertama (×1,5)" dan "Lembur jam berikutnya (×2)".
 */
export function overtimeLineLabels(settings: OvertimeSettings): { first: string; next: string } {
  const normalized = normalizeOvertimeSettings(settings);
  return {
    first: `Lembur jam pertama (×${formatMultiplier(normalized.firstHourMultiplier)})`,
    next: `Lembur jam berikutnya (×${formatMultiplier(normalized.nextHourMultiplier)})`,
  };
}
