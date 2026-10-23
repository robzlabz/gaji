import "server-only";

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cashAdvanceTxns,
  cashAdvances,
  employees,
  payRateHistory,
  timeEntries,
  wageFloats,
  wageFloatTxns,
} from "@/db/schema";
import { toNumber } from "@/lib/format";
import { requireOrgEmployee } from "@/lib/org-employee";
import { workedMinutes } from "@/lib/payroll";
import {
  accrualForEntry,
  balanceBefore,
  coverageForPeriod,
  periodLedgerSummary,
  rateAtDate,
  type RateHistoryRow,
} from "@/lib/saldo";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Koneksi: pool utama atau transaksi yang sedang berjalan. */
type Conn = Tx | typeof db;

/**
 * Ambil (atau buat) baris saldo milik karyawan.
 *
 * Baris saldo sengaja tidak wajib ada untuk semua karyawan: hanya karyawan yang
 * dibayar dengan sistem saldo (uang muka) yang punya baris di sini. Baris dibuat
 * otomatis pada top up pertama.
 */
export async function ensureFloat(
  conn: Conn,
  input: { orgId: string; employeeId: string; forUpdate?: boolean },
) {
  // Id dari form tidak boleh membuat baris saldo untuk karyawan organisasi lain.
  const employee = await requireOrgEmployee(conn, input.orgId, input.employeeId);
  if (!employee) return null;

  const where = and(
    eq(wageFloats.orgId, input.orgId),
    eq(wageFloats.employeeId, input.employeeId),
  );

  const [existing] = await conn
    .select()
    .from(wageFloats)
    .where(where)
    .limit(1)
    .for(input.forUpdate ? "update" : "key share");

  if (existing) return existing;

  const [created] = await conn
    .insert(wageFloats)
    .values({ orgId: input.orgId, employeeId: input.employeeId, balance: "0" })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [row] = await conn
    .select()
    .from(wageFloats)
    .where(where)
    .limit(1);
  return row;
}

async function bumpBalance(conn: Conn, orgId: string, floatId: string, delta: number) {
  if (delta === 0) return;
  await conn
    .update(wageFloats)
    .set({
      balance: sql`${wageFloats.balance} + ${delta}`,
      updatedAt: new Date(),
    })
    .where(and(eq(wageFloats.id, floatId), eq(wageFloats.orgId, orgId)));
}

/** Riwayat tarif karyawan (upah + ongkos) untuk menentukan \"tarif saat kejadian\". */
export async function loadRateHistory(
  conn: Conn,
  employeeId: string,
): Promise<RateHistoryRow[]> {
  const rows = await conn
    .select({
      kind: payRateHistory.kind,
      payRate: payRateHistory.payRate,
      effectiveFrom: payRateHistory.effectiveFrom,
    })
    .from(payRateHistory)
    .where(eq(payRateHistory.employeeId, employeeId));
  return rows;
}

export type AccrueResult =
  | { ok: true; amount: number; created: boolean; skipped?: string }
  | { ok: false; message: string };

/**
 * Catat accrual saldo untuk satu absensi yang **sudah di-approve**.
 *
 * Idempotent: satu absensi hanya punya satu baris accrual (unique index
 * `wage_float_txns_accrual_uniq`). Kalau absensi diedit (istirahat/lembur/ongkos),
 * accrual lama dikoreksi dengan selisihnya, bukan ditambah baris baru.
 *
 * Karyawan tanpa baris saldo tidak diapa-apakan: mereka dibayar tunai seperti biasa.
 */
export async function accrueForEntry(
  conn: Conn,
  input: { orgId: string; entryId: string; userId?: string | null; allowCreate?: boolean },
): Promise<AccrueResult> {
  const [entry] = await conn
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, input.entryId), eq(timeEntries.orgId, input.orgId), isNull(timeEntries.deletedAt)))
    .limit(1);

  if (!entry) return { ok: false, message: "Absensi tidak ditemukan." };
  if (entry.status !== "approved") {
    return { ok: false, message: "Hanya absensi approved yang memotong saldo." };
  }

  const [existingFloat] = await conn
    .select()
    .from(wageFloats)
    .where(and(eq(wageFloats.orgId, input.orgId), eq(wageFloats.employeeId, entry.employeeId)))
    .limit(1);

  if (!existingFloat && !input.allowCreate) {
    // Karyawan tanpa saldo: tidak ada yang perlu dipotong.
    return { ok: true, amount: 0, created: false, skipped: "tanpa-saldo" };
  }

  const floatRow = existingFloat ?? (await ensureFloat(conn, { orgId: input.orgId, employeeId: entry.employeeId, forUpdate: true }));
  if (!floatRow) return { ok: false, message: "Saldo karyawan gagal dibuat." };

  const [employee] = await conn
    .select()
    .from(employees)
    .where(and(eq(employees.id, entry.employeeId), eq(employees.orgId, input.orgId)))
    .limit(1);
  if (!employee) return { ok: false, message: "Karyawan tidak ditemukan." };

  const history = await loadRateHistory(conn, entry.employeeId);
  const rate = rateAtDate(history, entry.workDate, "wage", employee.payRate);
  const minutes = workedMinutes({
    id: entry.id,
    workDate: entry.workDate,
    clockInAt: entry.clockInAt,
    clockOutAt: entry.clockOutAt,
    breakMinutes: entry.breakMinutes,
    overtimeMinutes: entry.overtimeMinutes,
  });

  const breakdown = accrualForEntry({
    minutes,
    overtimeMinutes: entry.overtimeMinutes,
    rate,
    transportAmount: toNumber(entry.transportAmount),
  });

  const [existingTxn] = await conn
    .select()
    .from(wageFloatTxns)
    .where(
      and(
        eq(wageFloatTxns.orgId, input.orgId),
        eq(wageFloatTxns.sourceTable, "time_entries"),
        eq(wageFloatTxns.sourceId, entry.id),
        eq(wageFloatTxns.kind, "accrual"),
      ),
    )
    .limit(1);

  if (breakdown.total <= 0) {
    // Tidak ada nilai kerja (mis. jam 0 dan tanpa ongkos) → bersihkan accrual lama.
    if (existingTxn) {
      await conn.delete(wageFloatTxns).where(
        and(eq(wageFloatTxns.id, existingTxn.id), eq(wageFloatTxns.orgId, input.orgId)),
      );
      await bumpBalance(conn, input.orgId, floatRow.id, Math.abs(toNumber(existingTxn.amount)));
    }
    return { ok: true, amount: 0, created: false, skipped: "nol" };
  }

  if (existingTxn) {
    const delta = breakdown.total - Math.abs(toNumber(existingTxn.amount));
    await conn
      .update(wageFloatTxns)
      .set({
        amount: (-breakdown.total).toString(),
        wageAmount: breakdown.wageAmount.toString(),
        transportAmount: breakdown.transportAmount.toString(),
        minutes,
        rateUsed: rate.toString(),
      })
      .where(and(eq(wageFloatTxns.id, existingTxn.id), eq(wageFloatTxns.orgId, input.orgId)));
    await bumpBalance(conn, input.orgId, floatRow.id, -delta);
    return { ok: true, amount: breakdown.total, created: false };
  }

  await conn.insert(wageFloatTxns).values({
    orgId: input.orgId,
    floatId: floatRow.id,
    kind: "accrual",
    amount: (-breakdown.total).toString(),
    wageAmount: breakdown.wageAmount.toString(),
    transportAmount: breakdown.transportAmount.toString(),
    minutes,
    rateUsed: rate.toString(),
    occurredAt: entry.workDate,
    sourceTable: "time_entries",
    sourceId: entry.id,
    note: `Upah ${Math.floor(minutes / 60)}j ${minutes % 60}m${breakdown.transportAmount > 0 ? " + ongkos" : ""}`,
    createdBy: input.userId ?? null,
  });
  await bumpBalance(conn, input.orgId, floatRow.id, -breakdown.total);

  return { ok: true, amount: breakdown.total, created: true };
}

/** Hapus accrual satu absensi (dipakai saat absensi ditolak / dibatalkan / dihapus). */
export async function reverseAccrual(conn: Conn, orgId: string, entryId: string): Promise<number> {
  const txnFilter = and(
    eq(wageFloatTxns.orgId, orgId),
    eq(wageFloatTxns.sourceTable, "time_entries"),
    eq(wageFloatTxns.sourceId, entryId),
    eq(wageFloatTxns.kind, "accrual"),
  );

  const [txn] = await conn
    .select()
    .from(wageFloatTxns)
    .where(txnFilter)
    .limit(1);

  if (!txn) return 0;

  await conn.delete(wageFloatTxns).where(
    and(eq(wageFloatTxns.id, txn.id), eq(wageFloatTxns.orgId, orgId)),
  );
  await bumpBalance(conn, orgId, txn.floatId, Math.abs(toNumber(txn.amount)));
  return Math.abs(toNumber(txn.amount));
}

/** Owner mengirim uang ke karyawan. */
export async function topUpSaldo(
  conn: Conn,
  input: {
    orgId: string;
    employeeId: string;
    amount: number;
    occurredAt: string;
    note?: string | null;
    userId?: string | null;
  },
) {
  const floatRow = await ensureFloat(conn, {
    orgId: input.orgId,
    employeeId: input.employeeId,
    forUpdate: true,
  });
  if (!floatRow) throw new Error("Saldo karyawan gagal dibuat.");

  await conn.insert(wageFloatTxns).values({
    orgId: input.orgId,
    floatId: floatRow.id,
    kind: "topup",
    amount: input.amount.toString(),
    occurredAt: input.occurredAt,
    note: input.note ?? "Top up saldo",
    createdBy: input.userId ?? null,
  });
  await bumpBalance(conn, input.orgId, floatRow.id, input.amount);
  return floatRow;
}

/** Koreksi manual admin (boleh minus). */
export async function adjustSaldo(
  conn: Conn,
  input: {
    orgId: string;
    employeeId: string;
    amount: number;
    occurredAt: string;
    note?: string | null;
    userId?: string | null;
  },
) {
  const floatRow = await ensureFloat(conn, {
    orgId: input.orgId,
    employeeId: input.employeeId,
    forUpdate: true,
  });
  if (!floatRow) throw new Error("Saldo karyawan gagal dibuat.");

  await conn.insert(wageFloatTxns).values({
    orgId: input.orgId,
    floatId: floatRow.id,
    kind: "adjust",
    amount: input.amount.toString(),
    occurredAt: input.occurredAt,
    note: input.note ?? "Koreksi saldo",
    createdBy: input.userId ?? null,
  });
  await bumpBalance(conn, input.orgId, floatRow.id, input.amount);
  return floatRow;
}

/** Kesalahan aturan bisnis pemindahan kasbon ke saldo. */
export class SaldoTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaldoTransferError";
  }
}

/**
 * Pindahkan sisa kasbon karyawan ke saldo prabayar.
 *
 * Kasbon = karyawan **utang** ke owner dan dipotong dari slip; saldo = uang owner yang
 * sudah di muka dan dipotong per kehadiran. Pemindahan ini membuat utang kasbon dibayar
 * lewat kehadiran, bukan potongan slip. `balance` kasbon berkurang dan `status` menjadi
 * `settled` saat sisanya habis.
 */
export async function transferAdvanceToSaldo(
  conn: Conn,
  input: {
    orgId: string;
    advanceId: string;
    amount: number;
    occurredAt: string;
    userId?: string | null;
  },
) {
  const [advance] = await conn
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, input.advanceId), eq(cashAdvances.orgId, input.orgId)))
    .limit(1)
    .for("update");

  if (!advance) throw new SaldoTransferError("Kasbon tidak ditemukan.");
  if (advance.status !== "approved") {
    throw new SaldoTransferError("Hanya kasbon approved yang bisa dipindah.");
  }

  const balance = Math.round(toNumber(advance.balance));
  const amount = Math.round(input.amount);
  if (balance <= 0) throw new SaldoTransferError("Kasbon ini sudah lunas.");
  if (amount <= 0) throw new SaldoTransferError("Nominal harus lebih dari 0.");
  if (amount > balance) throw new SaldoTransferError("Nominal melebihi sisa kasbon.");

  await conn.insert(cashAdvanceTxns).values({
    cashAdvanceId: advance.id,
    kind: "to_saldo",
    amount: amount.toString(),
    occurredAt: input.occurredAt,
    note: "Dipindah ke saldo",
    createdBy: input.userId ?? null,
  });

  await conn
    .update(cashAdvances)
    .set({
      balance: sql`greatest(${cashAdvances.balance} - ${amount}, 0)`,
      status: sql`case when ${cashAdvances.balance} - ${amount} <= 0 then 'settled' else ${cashAdvances.status} end`,
    })
    .where(eq(cashAdvances.id, advance.id));

  const floatRow = await ensureFloat(conn, {
    orgId: input.orgId,
    employeeId: advance.employeeId,
    forUpdate: true,
  });
  if (!floatRow) throw new SaldoTransferError("Saldo karyawan gagal dibuat.");

  await conn.insert(wageFloatTxns).values({
    orgId: input.orgId,
    floatId: floatRow.id,
    kind: "kasbon",
    amount: amount.toString(),
    occurredAt: input.occurredAt,
    sourceTable: "cash_advances",
    sourceId: advance.id,
    note: "Pindahan dari kasbon",
    createdBy: input.userId ?? null,
  });
  await bumpBalance(conn, input.orgId, floatRow.id, amount);

  return { employeeId: advance.employeeId, amount, balanceAfter: balance - amount };
}

/**
 * Pelunasan tunai saat payroll difinalkan untuk saldo yang sudah minus.
 * Tanpa ini saldo akan tetap minus selamanya walau slip sudah membayar kekurangannya.
 */
export async function settleShortfall(
  conn: Conn,
  input: {
    orgId: string;
    employeeId: string;
    payslipId: string;
    amount: number;
    occurredAt: string;
    userId?: string | null;
  },
) {
  if (input.amount <= 0) return;
  const floatRow = await ensureFloat(conn, {
    orgId: input.orgId,
    employeeId: input.employeeId,
    forUpdate: true,
  });
  if (!floatRow) return;

  await conn.insert(wageFloatTxns).values({
    orgId: input.orgId,
    floatId: floatRow.id,
    kind: "settle",
    amount: input.amount.toString(),
    occurredAt: input.occurredAt,
    payslipId: input.payslipId,
    note: "Pelunasan tunai kekurangan saldo di slip gaji",
    createdBy: input.userId ?? null,
  });
  await bumpBalance(conn, input.orgId, floatRow.id, input.amount);
}

/** Batalkan pelunasan tunai milik slip periode yang dihitung ulang/dihapus. */
export async function revertSettlements(conn: Conn, orgId: string, payslipIds: string[]) {
  if (payslipIds.length === 0) return;
  const rows = await conn
    .select()
    .from(wageFloatTxns)
    .where(and(eq(wageFloatTxns.orgId, orgId), eq(wageFloatTxns.kind, "settle")));

  for (const row of rows) {
    if (!row.payslipId || !payslipIds.includes(row.payslipId)) continue;
    await conn.delete(wageFloatTxns).where(
      and(eq(wageFloatTxns.id, row.id), eq(wageFloatTxns.orgId, orgId)),
    );
    await bumpBalance(conn, orgId, row.floatId, -Math.abs(toNumber(row.amount)));
  }
}

export type SaldoPeriodInfo = {
  floatId: string | null;
  balanceNow: number;
  balanceStart: number;
  fundingInPeriod: number;
  accrualTotal: number;
  covered: number;
  shortfall: number;
};

/**
 * Hitung bagian upah periode ini yang sudah ditutup saldo.
 *
 * Semua angka diambil dari ledger (bukan dari cache `balance`) supaya menghitung
 * ulang periode lama tetap konsisten walaupun sudah ada top up setelahnya.
 */
export async function saldoForPeriod(
  conn: Conn,
  input: { orgId: string; employeeId: string; period: { start: string; end: string } },
): Promise<SaldoPeriodInfo> {
  const [floatRow] = await conn
    .select()
    .from(wageFloats)
    .where(and(eq(wageFloats.orgId, input.orgId), eq(wageFloats.employeeId, input.employeeId)))
    .limit(1);

  if (!floatRow) {
    return {
      floatId: null,
      balanceNow: 0,
      balanceStart: 0,
      fundingInPeriod: 0,
      accrualTotal: 0,
      covered: 0,
      shortfall: 0,
    };
  }

  const txns = await conn
    .select({
      kind: wageFloatTxns.kind,
      amount: wageFloatTxns.amount,
      occurredAt: wageFloatTxns.occurredAt,
    })
    .from(wageFloatTxns)
    .where(and(eq(wageFloatTxns.orgId, input.orgId), eq(wageFloatTxns.floatId, floatRow.id)));

  const balanceStart = balanceBefore(txns, input.period.start);
  const { accrualTotal, fundingInPeriod } = periodLedgerSummary(txns, input.period);
  const coverage = coverageForPeriod({ accrualTotal, balanceStart, fundingInPeriod });

  return {
    floatId: floatRow.id,
    balanceNow: toNumber(floatRow.balance),
    balanceStart,
    fundingInPeriod,
    accrualTotal,
    covered: coverage.covered,
    shortfall: coverage.shortfall,
  };
}

export type SaldoOverviewRow = {
  employeeId: string;
  employeeName: string;
  payType: string;
  payRate: string;
  transportRate: string;
  isActive: boolean;
  floatId: string | null;
  balance: number;
  lastTxnAt: string | null;
};

/** Daftar saldo semua karyawan aktif (untuk /admin/saldo). */
export async function listSaldoOverview(orgId: string): Promise<SaldoOverviewRow[]> {
  const staff = await db
    .select({
      employeeId: employees.id,
      employeeName: employees.fullName,
      payType: employees.payType,
      payRate: employees.payRate,
      transportRate: employees.transportRate,
      isActive: employees.isActive,
    })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .orderBy(employees.fullName);

  const floats = await db
    .select()
    .from(wageFloats)
    .where(eq(wageFloats.orgId, orgId));

  const floatByEmployee = new Map(floats.map((row) => [row.employeeId, row]));

  const lastTxns = await db
    .select({
      floatId: wageFloatTxns.floatId,
      occurredAt: wageFloatTxns.occurredAt,
    })
    .from(wageFloatTxns)
    .where(eq(wageFloatTxns.orgId, orgId))
    .orderBy(desc(wageFloatTxns.occurredAt));

  const lastByFloat = new Map<string, string>();
  for (const txn of lastTxns) {
    if (!lastByFloat.has(txn.floatId)) lastByFloat.set(txn.floatId, txn.occurredAt);
  }

  return staff.map((row) => {
    const floatRow = floatByEmployee.get(row.employeeId);
    return {
      ...row,
      floatId: floatRow?.id ?? null,
      balance: toNumber(floatRow?.balance),
      lastTxnAt: floatRow ? (lastByFloat.get(floatRow.id) ?? null) : null,
    };
  });
}

/** Riwayat saldo satu karyawan (terbaru di atas). */
export async function loadSaldoHistory(orgId: string, employeeId: string, limit = 60) {
  const [floatRow] = await db
    .select()
    .from(wageFloats)
    .where(and(eq(wageFloats.orgId, orgId), eq(wageFloats.employeeId, employeeId)))
    .limit(1);

  if (!floatRow) {
    return { float: null, balance: 0, txns: [] as Array<typeof wageFloatTxns.$inferSelect> };
  }

  const txns = await db
    .select()
    .from(wageFloatTxns)
    .where(and(eq(wageFloatTxns.orgId, orgId), eq(wageFloatTxns.floatId, floatRow.id)))
    .orderBy(desc(wageFloatTxns.occurredAt), desc(wageFloatTxns.createdAt))
    .limit(limit);

  return { float: floatRow, balance: toNumber(floatRow.balance), txns };
}

/** Rata-rata accrual per hari kerja — dipakai untuk estimasi \"saldo cukup N hari\". */
export async function averageDailyAccrual(
  conn: Conn,
  input: { orgId: string; employeeId: string; since: string },
): Promise<number> {
  const [floatRow] = await conn
    .select({ id: wageFloats.id })
    .from(wageFloats)
    .where(and(eq(wageFloats.orgId, input.orgId), eq(wageFloats.employeeId, input.employeeId)))
    .limit(1);
  if (!floatRow) return 0;

  const rows = await conn
    .select({
      amount: wageFloatTxns.amount,
      occurredAt: wageFloatTxns.occurredAt,
    })
    .from(wageFloatTxns)
    .where(
      and(
        eq(wageFloatTxns.orgId, input.orgId),
        eq(wageFloatTxns.floatId, floatRow.id),
        eq(wageFloatTxns.kind, "accrual"),
        gte(wageFloatTxns.occurredAt, input.since),
        lte(wageFloatTxns.occurredAt, new Date().toISOString().slice(0, 10)),
      ),
    );

  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + Math.abs(toNumber(row.amount)), 0);
  return Math.round(total / rows.length);
}
