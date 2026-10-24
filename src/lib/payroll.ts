import { countWorkDays, workDatesBetween, type Period } from "./period";
import { toNumber, rupiah } from "./format";
import { accrualForEntry } from "./saldo";

export type PayLineKind = "regular" | "overtime" | "task" | "transport" | "kasbon" | "saldo" | "other";

/**
 * Jenis baris yang mengurangi uang yang diserahkan (bukan menambah bruto).
 * `saldo` = upah yang sudah dibayar di muka, `kasbon` = utang karyawan.
 */
export const DEDUCTION_LINE_KINDS = new Set<string>(["kasbon", "saldo", "deduction"]);

/** true bila baris slip adalah potongan (harus tampil dengan tanda minus). */
export function isDeductionLine(kind: string): boolean {
  return DEDUCTION_LINE_KINDS.has(kind);
}

export type PayLine = {
  kind: PayLineKind;
  label: string;
  qty: number;
  unit: string;
  unitRate: number;
  amount: number;
  sourceTable?: string;
  sourceId?: string;
  meta?: Record<string, unknown>;
};

export type PayslipComputation = {
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  warnings: string[];
};

export type TimeEntryInput = {
  id: string;
  workDate: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  breakMinutes: number;
  overtimeMinutes: number;
  /** Ongkos kedatangan yang tersimpan di baris absensi (0 = tanpa ongkos). */
  transportAmount?: string | number | null;
  /** Tarif per jam yang berlaku pada tanggal absensi (riwayat tarif), bila ada. */
  rateAt?: string | number | null;
};

export type TaskInput = {
  id: string;
  title: string;
  qty: string | number;
  unit: string;
  unitRate: string | number;
  workDate: string;
  /** Tugas disetujui terlambat: upahnya baru dibayar di periode berikutnya. */
  carriedOver?: boolean;
};

export type AdvanceInput = {
  id: string;
  balance: string | number;
  installmentAmount: string | number | null;
  /** Nominal hasil keputusan karyawan/admin untuk periode ini (menang atas cicilan). */
  amountOverride?: number | null;
  /** Kasbon ditunda ke periode berikutnya. */
  deferred?: boolean;
  /** Label baris slip, mis. "Kasbon 12 Sep · biaya sekolah". */
  label?: string;
};

export type LeaveInput = {
  id: string;
  kind: string;
  startDate: string;
  endDate: string;
  paid: boolean;
  status: string;
};

export type ComputeInput = {
  payType: string;
  payRate: string | number;
  period: Period;
  joinedAt?: string | null;
  /** Tanggal berhenti; batas akhir upah & prorata gaji bulanan bila diisi dan sebelum akhir periode. */
  endedAt?: string | null;
  /**
   * Status karyawan. Dipakai hanya untuk aturan `paysWholeRange`: karyawan nonaktif tanpa
   * `endedAt` mengikuti absensi, sedangkan karyawan aktif tetap dibayar penuh rentang kerja.
   * Default: aktif.
   */
  isActive?: boolean;
  timeEntries: TimeEntryInput[];
  tasks: TaskInput[];
  advances: AdvanceInput[];
  /** Cuti karyawan (hanya dipakai untuk pay_type monthly). */
  leaves?: LeaveInput[];
  overtimeMultiplier?: number;
  /**
   * Bagian bruto periode ini yang sudah dibayar lewat saldo prabayar.
   * Muncul sebagai baris potongan "Sudah dibayar via saldo", sehingga
   * `net` = uang tunai yang masih harus diserahkan (0 bila saldo menutup semua).
   */
  saldoCovered?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Menit kerja efektif (sudah dikurangi istirahat). */
export function workedMinutes(entry: TimeEntryInput): number {
  if (!entry.clockOutAt) return 0;
  const inAt = new Date(entry.clockInAt).getTime();
  const outAt = new Date(entry.clockOutAt).getTime();
  const raw = Math.max(0, Math.floor((outAt - inAt) / 60_000));
  return Math.max(0, raw - Math.max(0, entry.breakMinutes ?? 0));
}

export function computePayslip(input: ComputeInput): PayslipComputation {
  const rate = toNumber(input.payRate);
  const multiplier = input.overtimeMultiplier ?? 1;
  const lines: PayLine[] = [];
  const warnings: string[] = [];

  // Tanggal berhenti adalah batas akhir upah apa pun status karyawannya: absensi/tugas
  // setelahnya tidak dibayar, dan gaji bulanan diprorata sampai tanggal itu (cermin dari
  // prorata `joinedAt`). Status aktif hanya dipakai untuk aturan `paysWholeRange` di bawah.
  const stillEmployed = input.isActive !== false;
  const effectiveEnd =
    input.endedAt && input.endedAt < input.period.end ? input.endedAt : input.period.end;
  const timeEntries = input.timeEntries.filter((entry) => entry.workDate <= effectiveEnd);
  const tasks = input.tasks.filter((task) => task.workDate <= effectiveEnd);

  const open = timeEntries.filter((e) => !e.clockOutAt);
  if (open.length > 0) {
    warnings.push(`${open.length} absensi belum clock-out dan tidak dihitung.`);
  }

  if (input.payType === "hourly") {
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    let regularWage = 0;
    let overtimeWage = 0;
    const ratesUsed = new Set<number>();

    for (const entry of timeEntries) {
      const minutes = workedMinutes(entry);
      if (minutes <= 0) continue;
      // Tarif per kedatangan ("tarif saat kejadian") supaya absensi bulan lalu tidak
      // ikut naik ketika tarif karyawan diubah bulan ini.
      const entryRate = toNumber(entry.rateAt ?? rate);
      ratesUsed.add(entryRate);
      const acc = accrualForEntry({
        minutes,
        overtimeMinutes: entry.overtimeMinutes,
        rate: entryRate,
        transportAmount: 0,
        overtimeMultiplier: multiplier,
      });
      regularMinutes += acc.regularMinutes;
      overtimeMinutes += acc.overtimeMinutes;
      regularWage += acc.regularWage;
      overtimeWage += acc.overtimeWage;
    }

    if (regularMinutes > 0) {
      lines.push({
        kind: "regular",
        label: "Gaji pokok (per jam)",
        qty: round2(regularMinutes / 60),
        unit: "jam",
        unitRate: rate,
        amount: regularWage,
        meta: ratesUsed.size > 1 ? { mixedRates: [...ratesUsed] } : undefined,
      });
    }

    if (overtimeMinutes > 0) {
      lines.push({
        kind: "overtime",
        label: "Lembur (catatan manual)",
        qty: round2(overtimeMinutes / 60),
        unit: "jam",
        unitRate: Math.round(rate * multiplier),
        amount: overtimeWage,
      });
    }

    if (ratesUsed.size > 1) {
      warnings.push(
        "Tarif berubah di tengah periode — slip memakai tarif yang berlaku saat masing-masing absensi.",
      );
    }
  }

  if (input.payType === "daily") {
    const days = new Set(timeEntries.filter((e) => e.clockOutAt).map((e) => e.workDate)).size;
    if (days > 0) {
      lines.push({
        kind: "regular",
        label: "Gaji harian",
        qty: days,
        unit: "hari",
        unitRate: rate,
        amount: Math.round(days * rate),
      });
    }
  }

  if (input.payType === "monthly") {
    const effectiveStart =
      input.joinedAt && input.joinedAt > input.period.start ? input.joinedAt : input.period.start;
    // Denominator prorata selalu hari kerja periode penuh. Rentang kerja yang lebih pendek
    // (baru bergabung / sudah berhenti) hanya memotong pembilang — kalau denominator ikut
    // mengecil, karyawan yang bekerja sebagian periode malah dibayar 100% gaji bulanan.
    const denominator = Math.max(1, countWorkDays(input.period.start, input.period.end));
    const employedWorkDays = countWorkDays(effectiveStart, effectiveEnd);
    const attendedDates = new Set(
      timeEntries
        .filter((e) => e.clockOutAt && e.workDate >= effectiveStart)
        .map((e) => e.workDate),
    );
    const attended = attendedDates.size;

    // Cuti approved hanya menambah hari yang dibayar bila memang berbayar, dan hari
    // yang sudah ada absensinya tidak dihitung dua kali.
    const paidLeaveDates = new Set<string>();
    const unpaidLeaveDates = new Set<string>();
    for (const leave of input.leaves ?? []) {
      if (leave.status !== "approved") continue;
      const bucket = leave.paid ? paidLeaveDates : unpaidLeaveDates;
      for (const day of workDatesBetween(leave.startDate, leave.endDate)) {
        if (day < effectiveStart || day > effectiveEnd) continue;
        if (attendedDates.has(day)) continue;
        bucket.add(day);
      }
    }

    const paidLeaveDays = paidLeaveDates.size;
    const unpaidLeaveDays = unpaidLeaveDates.size;
    // Tanpa absensi sama sekali karyawan bulanan tetap dibayar untuk seluruh rentang
    // kerjanya (tidak wajib clock-in) — tapi hanya bila batas masa kerjanya diketahui:
    // masih aktif, atau sudah berhenti di `endedAt`. Karyawan nonaktif tanpa tanggal
    // berhenti tidak boleh menerima upah penuh; upahnya mengikuti absensi. `endedAt`
    // sendiri sudah memotong rentang lewat `effectiveEnd`, termasuk untuk karyawan yang
    // masih aktif. Rentang kerja yang tidak memuat satu hari kerja pun = tidak ada gaji.
    const paysWholeRange = stillEmployed || Boolean(input.endedAt);
    const numerator =
      employedWorkDays === 0
        ? 0
        : attended === 0
          ? paysWholeRange
            ? employedWorkDays
            : 0
          : Math.min(attended + paidLeaveDays, employedWorkDays);
    const amount = Math.round((numerator / denominator) * rate);

    const baseLabel =
      numerator === denominator
        ? "Gaji bulanan (penuh)"
        : `Gaji bulanan (prorata ${numerator}/${denominator} hari)`;

    if (numerator > 0) {
      lines.push({
        kind: "regular",
        label: paidLeaveDays > 0 ? `${baseLabel} · ${paidLeaveDays} hari cuti` : baseLabel,
        qty: round2(numerator),
        unit: "hari",
        unitRate: Math.round(rate / denominator),
        amount,
        meta: {
          workDays: denominator,
          employedWorkDays,
          attendedDays: attended,
          paidLeaveDays,
          unpaidLeaveDays,
        },
      });
    }

    // Prorata karena rentang kerja pendek (baru bergabung / sudah berhenti) bukan
    // "tidak hadir", jadi peringatan hanya muncul bila hari kerja dalam rentang kerja
    // itu sendiri masih ada yang tidak terpakai.
    if (attended > 0 && numerator < employedWorkDays) {
      warnings.push(
        paidLeaveDays > 0
          ? `Hadir ${attended} hari + cuti berbayar ${paidLeaveDays} hari dari ${employedWorkDays} hari kerja masa kerja — gaji diprorata otomatis.`
          : `Kehadiran ${numerator} dari ${employedWorkDays} hari kerja masa kerja — gaji diprorata otomatis.`,
      );
    }

    if (unpaidLeaveDays > 0) {
      warnings.push(
        `${unpaidLeaveDays} hari cuti tanpa upah tidak dihitung sebagai hari kerja.`,
      );
    }
  }

  // Ongkos kedatangan dihitung untuk semua tipe gaji: yang dibayar per kedatangan
  // adalah kehadirannya, bukan jam kerjanya. Nilainya tersimpan per baris absensi,
  // jadi tarif ongkos yang berubah tidak mengubah kedatangan yang sudah lewat.
  const transportEntries = timeEntries.filter(
    (entry) => entry.clockOutAt && Math.round(toNumber(entry.transportAmount)) > 0,
  );
  const transportTotal = transportEntries.reduce(
    (sum, entry) => sum + Math.round(toNumber(entry.transportAmount)),
    0,
  );

  if (transportTotal > 0) {
    lines.push({
      kind: "transport",
      label: `Ongkos kedatangan (${transportEntries.length}×)`,
      qty: transportEntries.length,
      unit: "kedatangan",
      unitRate: Math.round(transportTotal / transportEntries.length),
      amount: transportTotal,
      meta: {
        entries: transportEntries.map((entry) => ({
          id: entry.id,
          workDate: entry.workDate,
          amount: Math.round(toNumber(entry.transportAmount)),
        })),
      },
    });
  }

  // Tugas yang disetujui admin adalah upah tambahan untuk semua tipe gaji: karyawan
  // per tugas memakainya sebagai penghasilan utama, tipe lain sebagai pendapatan ekstra
  // di samping gaji pokok. Tugas yang telat disetujui dibayar di periode berikutnya
  // (ditandai `carriedOver`) supaya tidak ada upah yang hilang.
  for (const task of tasks) {
    const qty = toNumber(task.qty);
    const unitRate = toNumber(task.unitRate);
    const baseLabel = input.payType === "per_task" ? task.title : `Tugas: ${task.title}`;
    lines.push({
      kind: "task",
      label: task.carriedOver ? `${baseLabel} (dari periode sebelumnya)` : baseLabel,
      qty,
      unit: task.unit,
      unitRate,
      amount: Math.round(qty * unitRate),
      sourceTable: "work_tasks",
      sourceId: task.id,
      meta: task.carriedOver
        ? { workDate: task.workDate, carriedOver: true }
        : { workDate: task.workDate },
    });
  }

  let gross = 0;
  let deductions = 0;

  for (const line of lines) {
    gross += line.amount;
  }

  let deferredCount = 0;

  // Upah yang sudah dibayar di muka lewat saldo bukan "potongan" dalam arti utang,
  // tapi harus dikurangkan dari tunai yang diserahkan saat payroll difinalkan.
  const saldoCovered = Math.min(gross, Math.max(0, Math.round(toNumber(input.saldoCovered))));
  if (saldoCovered > 0) {
    lines.push({
      kind: "saldo",
      label: "Sudah dibayar via saldo (uang muka)",
      qty: 1,
      unit: "potongan",
      unitRate: saldoCovered,
      amount: saldoCovered,
    });
    deductions += saldoCovered;
  }

  // Tunai yang tersedia untuk potongan kasbon = upah yang belum dibayar lewat saldo.
  let cashLeft = Math.max(0, gross - saldoCovered);

  for (const advance of input.advances) {
    const balance = toNumber(advance.balance);
    if (balance <= 0) continue;

    if (advance.deferred) {
      deferredCount += 1;
      continue;
    }

    const override = toNumber(advance.amountOverride ?? 0);
    const installment = toNumber(advance.installmentAmount);
    const requested = override > 0 ? override : installment > 0 ? installment : balance;
    const wanted = Math.round(Math.min(requested, balance));
    if (wanted <= 0) continue;

    // Kasbon hanya bisa dipotong dari uang tunai yang benar-benar diserahkan.
    // Kalau upah periode ini sudah dibayar lewat saldo, tidak ada tunai untuk dipotong —
    // sisa kasbon tetap jadi utang dan dipotong pada periode berikutnya (bukan net minus).
    const amount = Math.min(wanted, cashLeft);
    if (amount <= 0) {
      warnings.push(
        `${advance.label ?? "Kasbon"} tidak dipotong: upah periode ini sudah dibayar lewat saldo, jadi tidak ada tunai untuk dipotong. Sisa kasbon tetap jadi utang.`,
      );
      continue;
    }
    if (amount < wanted) {
      warnings.push(
        `${advance.label ?? "Kasbon"} hanya dipotong ${rupiah(amount)} karena upah periode ini sudah dibayar lewat saldo — sisa ${rupiah(wanted - amount)} tetap jadi utang.`,
      );
    }
    cashLeft -= amount;

    lines.push({
      kind: "kasbon",
      label: advance.label ?? "Potongan kasbon",
      qty: 1,
      unit: "potongan",
      unitRate: amount,
      amount,
      sourceTable: "cash_advances",
      sourceId: advance.id,
    });
    deductions += amount;
  }

  if (deferredCount > 0) {
    warnings.push(
      `${deferredCount} kasbon ditunda ke periode berikutnya (tidak dipotong kali ini).`,
    );
  }

  const net = gross - deductions;
  if (net < 0) {
    warnings.push("Potongan melebihi pendapatan — net negatif, periksa nominal kasbon.");
  }

  return { lines, gross, deductions, net, warnings };
}
