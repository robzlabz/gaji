import "server-only";

import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, invoices, memberships, organizations, subscriptions } from "@/db/schema";
import {
  buildInvoiceNumber,
  type BillingCycle,
  employeeQuota,
  getPlan,
  type Plan,
  periodFor,
  type QuotaResult,
  resolvePayment,
} from "@/lib/plans";

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

/** Jumlah karyawan aktif = angka yang dipakai dashboard & kuota. */
export async function countActiveEmployees(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.isActive, true)));
  return Number(row?.total ?? 0);
}

/**
 * Jumlah "cabang" = organisasi yang dikelola akun owner yang sama, dihitung
 * termasuk organisasi ini sendiri. Satu akun owner bisa memegang beberapa
 * organisasi (mis. toko pusat + cabang), dan kuota Gratis/Dasar membatasi itu
 * lewat `branchLimit`. Organisasi tanpa baris membership owner tetap dihitung 1.
 */
export async function countBranches(orgId: string): Promise<number> {
  const [ownerRow] = await db
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));

  if (Number(ownerRow?.total ?? 0) === 0) return 1;

  const owners = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));

  const [row] = await db
    .select({ total: count() })
    .from(organizations)
    .where(
      inArray(
        organizations.id,
        db.select({ id: memberships.orgId }).from(memberships).where(inArray(memberships.userId, owners)),
      ),
    );
  return Math.max(1, Number(row?.total ?? 0));
}

/** Langganan `active` milik org, atau `null` bila belum pernah berlangganan. */
export async function getActiveSubscription(orgId: string): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  return row ?? null;
}

export async function listInvoices(orgId: string, limit = 24): Promise<InvoiceRow[]> {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.orgId, orgId))
    .orderBy(desc(invoices.issuedAt), desc(invoices.createdAt))
    .limit(limit);
}

export type BillingState = {
  /** Paket efektif: langganan aktif, atau paket Gratis bila belum ada baris. */
  plan: Plan;
  cycle: BillingCycle;
  status: SubscriptionStatusView;
  periodStart: string | null;
  periodEnd: string | null;
  /** Langganan ada tapi periodenya sudah lewat. */
  expired: boolean;
  hasSubscription: boolean;
  employeesUsed: number;
  branchesUsed: number;
  invoices: InvoiceRow[];
};

export type SubscriptionStatusView = "active" | "expired" | "cancelled" | "free";

/**
 * Semua angka yang dibutuhkan halaman /admin/langganan dalam satu tempat.
 * Organisasi tanpa baris langganan tetap dianggap paket Gratis (grandfather),
 * jadi org lama tidak pernah kehilangan akses karena migrasi ini.
 */
export async function loadBillingState(orgId: string, todayISO: string): Promise<BillingState> {
  const [subscription, employeesUsed, branchesUsed, invoiceRows] = await Promise.all([
    getActiveSubscription(orgId),
    countActiveEmployees(orgId),
    countBranches(orgId),
    listInvoices(orgId),
  ]);

  const plan = getPlan(subscription?.plan);
  const periodEnd = subscription?.currentPeriodEnd ?? null;
  const expired = periodEnd !== null && periodEnd < todayISO;

  return {
    plan,
    cycle: (subscription?.cycle as BillingCycle | undefined) ?? "monthly",
    status: subscription ? (expired ? "expired" : "active") : "free",
    periodStart: subscription?.currentPeriodStart ?? null,
    periodEnd,
    expired,
    hasSubscription: subscription !== null,
    employeesUsed,
    branchesUsed,
    invoices: invoiceRows,
  };
}

/**
 * Paket yang berlaku untuk keperluan kuota. Paket tetap dipakai walau periode
 * sudah lewat: data org lama tidak boleh terkunci hanya karena tagihan telat —
 * penambahan karyawan tetap dibatasi sesuai paket terakhir.
 */
export async function effectivePlan(orgId: string): Promise<Plan> {
  const subscription = await getActiveSubscription(orgId);
  return getPlan(subscription?.plan);
}

export class BillingError extends Error {}

/** Error kuota yang dilempar dari dalam transaksi; pesannya siap ditampilkan ke admin. */
export class QuotaExceededError extends Error {
  readonly quota: QuotaResult;

  constructor(quota: QuotaResult) {
    super(quota.message);
    this.quota = quota;
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Penjaga kuota karyawan **di dalam transaksi**.
 *
 * Baris organisasi dikunci (`FOR UPDATE`) lebih dulu, lalu jumlah karyawan aktif
 * dihitung ulang. Tanpa kunci ini dua request bersamaan bisa sama-sama lolos
 * pengecekan lalu menembus batas paket.
 */
export async function guardEmployeeQuota(tx: Tx, orgId: string, planId: string): Promise<QuotaResult> {
  await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for("update");

  const [row] = await tx
    .select({ total: count() })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.isActive, true)));

  const quota = employeeQuota(planId, Number(row?.total ?? 0));
  if (!quota.allowed) throw new QuotaExceededError(quota);
  return quota;
}

/** Jumlah organisasi yang dipegang user sebagai owner (= jumlah cabang). */
export async function countOwnedOrgs(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return Number(row?.total ?? 0);
}

/** Paket dari organisasi terlama milik owner — dasar kuota cabang saat menambah organisasi. */
export async function planForOwner(userId: string): Promise<Plan> {
  const [row] = await db
    .select({ plan: subscriptions.plan })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .leftJoin(
      subscriptions,
      and(eq(subscriptions.orgId, organizations.id), eq(subscriptions.status, "active")),
    )
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")))
    .orderBy(organizations.createdAt)
    .limit(1);
  return getPlan(row?.plan);
}


export type RecordPaymentInput = {
  orgId: string;
  actorId: string;
  planId: string;
  cycle: BillingCycle;
  method: "transfer" | "qris";
  /** Nominal manual; wajib untuk paket nego, diabaikan bila harga paket sudah pasti. */
  amount?: number | null;
  /** Tanggal hari ini (YYYY-MM-DD) menurut zona waktu org. */
  todayISO: string;
  note?: string | null;
};

export type RecordPaymentResult = {
  invoice: InvoiceRow;
  subscription: SubscriptionRow;
  periodStart: string;
  periodEnd: string;
  amount: number;
};

/**
 * Catat pembayaran manual (transfer/QRIS) lalu perpanjang periode.
 *
 * Satu panggilan menghasilkan tepat satu tagihan `paid` dan satu periode baru:
 * - bulanan → +1 bulan, tahunan → +12 bulan (harga tahunan = 10× bulanan);
 * - periode baru menumpuk dari sehari setelah periode aktif berakhir, jadi
 *   pembayaran awal tidak menghanguskan sisa hari yang sudah dibayar;
 * - ganti paket → baris langganan lama ditutup (`cancelled`) supaya riwayat paket
 *   tetap terbaca, bukan ditimpa.
 */
export async function recordManualPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const current = await getActiveSubscription(input.orgId);

  let resolved;
  try {
    resolved = resolvePayment({
      planId: input.planId,
      cycle: input.cycle,
      manualAmount: input.amount,
      currentPeriodEnd: current?.currentPeriodEnd ?? null,
      todayISO: input.todayISO,
    });
  } catch (error) {
    throw new BillingError(error instanceof Error ? error.message : "Pembayaran tidak valid.");
  }

  const plan = resolved.plan;
  const amount = resolved.amount;
  const period = { start: resolved.periodStart, end: resolved.periodEnd };
  const dueAt = resolved.dueAt;
  const monthStart = `${input.todayISO.slice(0, 7)}-01`;
  const monthEnd = periodFor(monthStart, "monthly").end;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.orgId, input.orgId), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1);

    const [seqRow] = await tx
      .select({ total: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, input.orgId),
          gte(invoices.issuedAt, monthStart),
          lte(invoices.issuedAt, monthEnd),
        ),
      );
    const baseSeq = Number(seqRow?.total ?? 0) + 1;

    // Nomor tagihan unik per org; tabrakan hanya mungkin saat dua admin mencatat
    // bersamaan, jadi cukup dicoba beberapa urutan berikutnya.
    let invoice: InvoiceRow | undefined;
    for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
      const rows = await tx
        .insert(invoices)
        .values({
          orgId: input.orgId,
          number: buildInvoiceNumber({
            orgId: input.orgId,
            issuedAt: input.todayISO,
            seq: baseSeq + attempt,
          }),
          plan: plan.id,
          cycle: input.cycle,
          amount: amount.toString(),
          issuedAt: input.todayISO,
          dueAt,
          status: "paid",
          method: input.method,
          paidAt: new Date(),
          periodStart: period.start,
          periodEnd: period.end,
          note: input.note ?? null,
          recordedBy: input.actorId,
        })
        .onConflictDoNothing({ target: invoices.number })
        .returning();
      invoice = rows[0];
    }

    if (!invoice) throw new BillingError("Gagal membuat nomor tagihan. Coba lagi.");

    let subscription: SubscriptionRow;
    if (existing && existing.plan === plan.id) {
      const rows = await tx
        .update(subscriptions)
        .set({
          cycle: input.cycle,
          status: "active",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          lastInvoiceId: invoice.id,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id))
        .returning();
      subscription = rows[0];
    } else if (existing) {
      await tx
        .update(subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(subscriptions.id, existing.id));
      const rows = await tx
        .insert(subscriptions)
        .values({
          orgId: input.orgId,
          plan: plan.id,
          cycle: input.cycle,
          status: "active",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          lastInvoiceId: invoice.id,
        })
        .returning();
      subscription = rows[0];
    } else {
      const rows = await tx
        .insert(subscriptions)
        .values({
          orgId: input.orgId,
          plan: plan.id,
          cycle: input.cycle,
          status: "active",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          lastInvoiceId: invoice.id,
        })
        .returning();
      subscription = rows[0];
    }

    await tx
      .update(invoices)
      .set({ subscriptionId: subscription.id })
      .where(eq(invoices.id, invoice.id));

    return {
      invoice: { ...invoice, subscriptionId: subscription.id },
      subscription,
      periodStart: period.start,
      periodEnd: period.end,
      amount,
    };
  });
}

/** Ringkasan nominal lunas — dipakai kartu total di halaman langganan. */
export function sumPaid(rows: Pick<InvoiceRow, "amount" | "status">[]): number {
  return rows
    .filter((row) => row.status === "paid")
    .reduce((total, row) => total + Number(row.amount), 0);
}
