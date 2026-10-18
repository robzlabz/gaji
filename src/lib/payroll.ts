import { countWorkDays, type Period } from "./period";
import { toNumber } from "./format";

export type PayLineKind = "regular" | "overtime" | "task" | "kasbon" | "other";

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
};

export type TaskInput = {
  id: string;
  title: string;
  qty: string | number;
  unit: string;
  unitRate: string | number;
  workDate: string;
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

export type ComputeInput = {
  payType: string;
  payRate: string | number;
  period: Period;
  joinedAt?: string | null;
  timeEntries: TimeEntryInput[];
  tasks: TaskInput[];
  advances: AdvanceInput[];
  overtimeMultiplier?: number;
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

  const open = input.timeEntries.filter((e) => !e.clockOutAt);
  if (open.length > 0) {
    warnings.push(`${open.length} absensi belum clock-out dan tidak dihitung.`);
  }

  if (input.payType === "hourly") {
    let regularMinutes = 0;
    let overtimeMinutes = 0;

    for (const entry of input.timeEntries) {
      const minutes = workedMinutes(entry);
      if (minutes <= 0) continue;
      const overtime = Math.min(minutes, Math.max(0, entry.overtimeMinutes ?? 0));
      regularMinutes += minutes - overtime;
      overtimeMinutes += overtime;
    }

    if (regularMinutes > 0) {
      const hours = round2(regularMinutes / 60);
      lines.push({
        kind: "regular",
        label: "Gaji pokok (per jam)",
        qty: hours,
        unit: "jam",
        unitRate: rate,
        amount: Math.round((regularMinutes / 60) * rate),
      });
    }

    if (overtimeMinutes > 0) {
      const overtimeRate = Math.round(rate * multiplier);
      lines.push({
        kind: "overtime",
        label: "Lembur (catatan manual)",
        qty: round2(overtimeMinutes / 60),
        unit: "jam",
        unitRate: overtimeRate,
        amount: Math.round((overtimeMinutes / 60) * overtimeRate),
      });
    }
  }

  if (input.payType === "daily") {
    const days = new Set(input.timeEntries.filter((e) => e.clockOutAt).map((e) => e.workDate)).size;
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
    const denominator = Math.max(1, countWorkDays(effectiveStart, input.period.end));
    const attended = new Set(
      input.timeEntries
        .filter((e) => e.clockOutAt && e.workDate >= effectiveStart)
        .map((e) => e.workDate),
    ).size;

    const numerator = attended === 0 ? denominator : Math.min(attended, denominator);
    const amount = Math.round((numerator / denominator) * rate);

    lines.push({
      kind: "regular",
      label:
        attended === 0
          ? "Gaji bulanan"
          : numerator === denominator
            ? "Gaji bulanan (penuh)"
            : `Gaji bulanan (prorata ${numerator}/${denominator} hari)`,
      qty: round2(numerator),
      unit: "hari",
      unitRate: Math.round(rate / denominator),
      amount,
    });

    if (attended > 0 && numerator < denominator) {
      warnings.push(
        `Kehadiran ${numerator} dari ${denominator} hari kerja — gaji diprorata otomatis.`,
      );
    }
  }

  if (input.payType === "per_task") {
    for (const task of input.tasks) {
      const qty = toNumber(task.qty);
      const unitRate = toNumber(task.unitRate);
      lines.push({
        kind: "task",
        label: task.title,
        qty,
        unit: task.unit,
        unitRate,
        amount: Math.round(qty * unitRate),
        sourceTable: "work_tasks",
        sourceId: task.id,
        meta: { workDate: task.workDate },
      });
    }
  }

  let gross = 0;
  let deductions = 0;

  for (const line of lines) {
    gross += line.amount;
  }

  let deferredCount = 0;

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
    const amount = Math.round(Math.min(requested, balance));
    if (amount <= 0) continue;

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
