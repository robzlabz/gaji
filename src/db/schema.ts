import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Better Auth core tables (phone + PIN = credential password)          */
/* ------------------------------------------------------------------ */

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    phoneNumber: text("phone_number"),
    phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_email_uniq").on(t.email),
    uniqueIndex("user_phone_uniq").on(t.phoneNumber),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("session_token_uniq").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ------------------------------------------------------------------ */
/* Tenant                                                              */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  currency: text("currency").notNull().default("IDR"),
  /** Tanggal mulai periode gaji (1..31). Akhir periode = sehari sebelum tanggal ini bulan berikutnya. */
  payPeriodStartDay: smallint("pay_period_start_day").notNull().default(1),
  /** Jumlah hari kerja efektif per bulan untuk prorata gaji bulanan. */
  workingDaysPerMonth: smallint("working_days_per_month").notNull().default(22),
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 })
    .notNull()
    .default("1.00"),
  /** Ambang notifikasi kontrak akan berakhir (hari). */
  contractAlertDays: smallint("contract_alert_days").notNull().default(60),
  geofenceLat: doublePrecision("geofence_lat"),
  geofenceLng: doublePrecision("geofence_lng"),
  geofenceRadiusM: integer("geofence_radius_m"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uniq").on(t.orgId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Karyawan                                                            */
/* ------------------------------------------------------------------ */

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    code: text("code"),
    fullName: text("full_name").notNull(),
    payType: text("pay_type").notNull(),
    payRate: numeric("pay_rate", { precision: 14, scale: 2 }).notNull(),
    /**
     * Ongkos/transport default per kedatangan (clock in). 0 = tidak ada ongkos.
     * Nilai ini hanya dipakai untuk *prefill* form clock in; angka yang benar-benar
     * dibayar disimpan per absensi di `time_entries.transport_amount` supaya tarif
     * yang berubah tidak mengubah kedatangan yang sudah lewat.
     */
    transportRate: numeric("transport_rate", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    joinedAt: date("joined_at").notNull(),
    endedAt: date("ended_at"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employees_org_code_uniq").on(t.orgId, t.code),
    uniqueIndex("employees_org_user_uniq")
      .on(t.orgId, t.userId)
      .where(sql`user_id is not null`),
    index("employees_org_idx").on(t.orgId, t.isActive),
  ],
);

export const payRateHistory = pgTable(
  "pay_rate_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** "wage" = tarif upah, "transport" = tarif ongkos per kedatangan. */
    kind: text("kind").notNull().default("wage"),
    payType: text("pay_type").notNull(),
    payRate: numeric("pay_rate", { precision: 14, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pay_rate_history_emp_idx").on(t.employeeId, t.kind, t.effectiveFrom),
  ],
);

/* ------------------------------------------------------------------ */
/* Kontrak                                                             */
/* ------------------------------------------------------------------ */

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    contractNo: text("contract_no"),
    kind: text("kind").notNull().default("pkwt"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    payType: text("pay_type").notNull(),
    payRate: numeric("pay_rate", { precision: 14, scale: 2 }).notNull(),
    documentPath: text("document_path"),
    status: text("status").notNull().default("active"),
    renewedFromId: uuid("renewed_from_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_org_end_idx").on(t.orgId, t.endDate),
    index("contracts_employee_idx").on(t.employeeId, t.startDate),
  ],
);

/* ------------------------------------------------------------------ */
/* Absensi (dipakai untuk hourly & daily)                              */
/* ------------------------------------------------------------------ */

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    breakMinutes: integer("break_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    overtimeNote: text("overtime_note"),
    /**
     * Ongkos kedatangan untuk absensi ini. Diisi karyawan saat clock in (prefill dari
     * `employees.transport_rate`), boleh 0, dan boleh dikoreksi admin sampai di-approve.
     * Disimpan per baris = per kedatangan, jadi clock in dua kali sehari = dua ongkos.
     */
    transportAmount: numeric("transport_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    inLat: doublePrecision("in_lat"),
    inLng: doublePrecision("in_lng"),
    inAccuracyM: real("in_accuracy_m"),
    inPhoto: text("in_photo"),
    outLat: doublePrecision("out_lat"),
    outLng: doublePrecision("out_lng"),
    outPhoto: text("out_photo"),
    withinGeofence: boolean("within_geofence"),
    source: text("source").notNull().default("pwa"),
    status: text("status").notNull().default("pending"),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("time_entries_one_open")
      .on(t.employeeId)
      .where(sql`clock_out_at is null and deleted_at is null`),
    index("time_entries_org_date_idx").on(t.orgId, t.workDate),
    index("time_entries_emp_date_idx").on(t.employeeId, t.workDate),
  ],
);

/* ------------------------------------------------------------------ */
/* Tugas (pay_type = per_task)                                         */
/* ------------------------------------------------------------------ */

export const workTasks = pgTable(
  "work_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    qty: numeric("qty", { precision: 12, scale: 2 }).notNull().default("1"),
    unit: text("unit").notNull().default("tugas"),
    unitRate: numeric("unit_rate", { precision: 14, scale: 2 }).notNull(),
    status: text("status").notNull().default("open"),
    workDate: date("work_date").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("work_tasks_org_date_idx").on(t.orgId, t.workDate),
    index("work_tasks_emp_idx").on(t.employeeId, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Kasbon                                                              */
/* ------------------------------------------------------------------ */

export const cashAdvances = pgTable(
  "cash_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    principal: numeric("principal", { precision: 14, scale: 2 }).notNull(),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
    installmentAmount: numeric("installment_amount", { precision: 14, scale: 2 }),
    requestedAt: date("requested_at").notNull(),
    status: text("status").notNull().default("pending"),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cash_advances_emp_idx").on(t.orgId, t.employeeId, t.status)],
);

export const cashAdvanceTxns = pgTable(
  "cash_advance_txns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cashAdvanceId: uuid("cash_advance_id")
      .notNull()
      .references(() => cashAdvances.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    payslipId: uuid("payslip_id"),
    occurredAt: date("occurred_at").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cash_advance_txns_adv_idx").on(t.cashAdvanceId, t.occurredAt)],
);

/**
 * Rencana pemotongan kasbon per periode gaji.
 * Satu baris = satu keputusan karyawan/admin untuk satu kasbon pada satu periode:
 * `deduct` (potong periode ini, opsional sebagian) atau `defer` (tunda ke periode berikutnya).
 * Tanpa baris = ikut aturan default (cicilan, atau penuh bila cicilan kosong).
 */
export const cashAdvancePlans = pgTable(
  "cash_advance_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cashAdvanceId: uuid("cash_advance_id")
      .notNull()
      .references(() => cashAdvances.id, { onDelete: "cascade" }),
    /** Tanggal mulai periode gaji yang menjadi target keputusan ini. */
    periodStart: date("period_start").notNull(),
    /** "deduct" | "defer" */
    decision: text("decision").notNull(),
    /** Nominal potong untuk periode ini; null = pakai cicilan / sisa penuh. */
    amount: numeric("amount", { precision: 14, scale: 2 }),
    note: text("note"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cash_advance_plans_uniq").on(t.cashAdvanceId, t.periodStart),
    index("cash_advance_plans_period_idx").on(t.orgId, t.periodStart),
  ],
);

/* ------------------------------------------------------------------ */
/* Saldo prabayar (upah dibayar di muka, dipotong per kehadiran)        */
/* ------------------------------------------------------------------ */

/**
 * Saldo gaji karyawan ("uang muka" dari owner).
 *
 * Bedanya dengan kasbon: kasbon = karyawan **utang** ke owner dan dipotong dari slip.
 * Saldo = owner sudah **mengirim uang lebih dulu**; setiap kehadiran yang di-approve
 * memotong saldo ini, sehingga slip bulanan tinggal menampilkan "sudah dibayar via saldo".
 *
 * `balance` = cache dari `sum(wage_float_txns.amount)` milik float ini, ditulis di
 * transaksi yang sama. Boleh minus: minus berarti karyawan sudah bekerja melebihi uang
 * yang diterima, jadi owner masih kurang bayar.
 */
export const wageFloats = pgTable(
  "wage_floats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wage_floats_emp_uniq").on(t.employeeId)],
);

/**
 * Ledger saldo — append-only, `amount` bertanda:
 * - `topup`   (+): owner kirim uang ke karyawan
 * - `accrual` (−): upah harian (jam + ongkos) memotong saldo, sumber = time_entries
 * - `adjust`  (±): koreksi manual admin
 * - `settle`  (+): pelunasan tunai saat payroll difinalkan ketika saldo sudah minus
 * - `kasbon`  (+): sisa kasbon yang dipindahkan admin ke saldo
 *
 * `rate_used` & `minutes` menyimpan kondisi **saat kejadian**, jadi kenaikan tarif
 * bulan depan tidak mengubah nilai accrual yang sudah tercatat.
 */
export const wageFloatTxns = pgTable(
  "wage_float_txns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    floatId: uuid("float_id")
      .notNull()
      .references(() => wageFloats.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Rincian accrual: upah (tanpa ongkos), ongkos, dan menit kerja saat kejadian. */
    wageAmount: numeric("wage_amount", { precision: 14, scale: 2 }),
    transportAmount: numeric("transport_amount", { precision: 14, scale: 2 }),
    minutes: integer("minutes"),
    rateUsed: numeric("rate_used", { precision: 14, scale: 2 }),
    occurredAt: date("occurred_at").notNull(),
    sourceTable: text("source_table"),
    sourceId: uuid("source_id"),
    payslipId: uuid("payslip_id").references(() => payslips.id, { onDelete: "set null" }),
    note: text("note"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wage_float_txns_accrual_uniq")
      .on(t.sourceTable, t.sourceId)
      .where(sql`kind = 'accrual'`),
    index("wage_float_txns_float_idx").on(t.floatId, t.occurredAt),
    index("wage_float_txns_org_date_idx").on(t.orgId, t.occurredAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Cuti (hanya karyawan bulanan)                                       */
/* ------------------------------------------------------------------ */

/**
 * Pengajuan cuti. Hanya berlaku untuk karyawan `pay_type = monthly`: tipe lain
 * sudah dibayar berdasarkan kehadiran/tugas sehingga cuti tidak punya arti.
 * Cuti berbayar yang approved dihitung sebagai hari kerja saat prorata gaji bulanan.
 */
export const leaves = pgTable(
  "leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** "cuti" | "sakit" | "izin" */
    kind: text("kind").notNull().default("cuti"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Hari kerja (Senin–Sabtu) pada rentang tanggal, dihitung saat pengajuan. */
    days: integer("days").notNull(),
    /** Berbayar = dihitung sebagai hari kerja di payroll; tanpa upah = prorata turun. */
    paid: boolean("paid").notNull().default(true),
    /** "pending" | "approved" | "rejected" | "void" (dibatalkan karyawan) */
    status: text("status").notNull().default("pending"),
    note: text("note"),
    requestedBy: uuid("requested_by").references(() => user.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leaves_org_date_idx").on(t.orgId, t.startDate),
    index("leaves_emp_date_idx").on(t.employeeId, t.startDate),
  ],
);

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export const payPeriods = pgTable(
  "pay_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date"),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pay_periods_org_start_uniq").on(t.orgId, t.periodStart)],
);

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    payPeriodId: uuid("pay_period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    payType: text("pay_type").notNull(),
    payRate: numeric("pay_rate", { precision: 14, scale: 2 }).notNull(),
    gross: numeric("gross", { precision: 14, scale: 2 }).notNull().default("0"),
    totalDeductions: numeric("total_deductions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /** Bagian bruto yang sudah dibayar lewat saldo prabayar (snapshot saat payroll dihitung). */
    saldoCovered: numeric("saldo_covered", { precision: 14, scale: 2 }).notNull().default("0"),
    net: numeric("net", { precision: 14, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("draft"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payslips_period_emp_uniq").on(t.payPeriodId, t.employeeId),
    index("payslips_emp_idx").on(t.employeeId),
  ],
);

export const payslipItems = pgTable(
  "payslip_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    unitRate: numeric("unit_rate", { precision: 14, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    sourceTable: text("source_table"),
    sourceId: uuid("source_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payslip_items_slip_idx").on(t.payslipId)],
);

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => user.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    diff: jsonb("diff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* MCP (Streamable HTTP)                                               */
/* ------------------------------------------------------------------ */

/**
 * Kunci akses server MCP. Satu kunci = satu tenant: semua tool MCP yang dipanggil
 * dengan kunci ini hanya bisa membaca org pemiliknya.
 *
 * Token asli tidak disimpan sebagai plaintext:
 * - `tokenHash` (sha256) dipakai untuk mencocokkan Bearer token saat request masuk;
 * - `tokenCipher` (AES-256-GCM, kunci turunan BETTER_AUTH_SECRET) hanya untuk
 *   menampilkan kembali connection URL di halaman admin.
 */
export const mcpApiKeys = pgTable(
  "mcp_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Admin yang membuat kunci. */
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull().default("MCP"),
    /** Potongan awal token untuk ditampilkan tanpa membuka kuncinya. */
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCipher: text("token_cipher").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_api_keys_hash_uniq").on(t.tokenHash),
    index("mcp_api_keys_org_idx").on(t.orgId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const employeesRelations = relations(employees, ({ one, many }) => ({
  org: one(organizations, { fields: [employees.orgId], references: [organizations.id] }),
  user: one(user, { fields: [employees.userId], references: [user.id] }),
  contracts: many(contracts),
  timeEntries: many(timeEntries),
  leaves: many(leaves),
}));

export const payslipRelations = relations(payslips, ({ one, many }) => ({
  employee: one(employees, { fields: [payslips.employeeId], references: [employees.id] }),
  period: one(payPeriods, { fields: [payslips.payPeriodId], references: [payPeriods.id] }),
  items: many(payslipItems),
}));

export type PayType = "hourly" | "daily" | "monthly" | "per_task";
export type LeaveKind = "cuti" | "sakit" | "izin";
export type LeaveStatus = "pending" | "approved" | "rejected" | "void";
export type Role = "owner" | "admin" | "employee";
export type WageFloatTxnKind = "topup" | "accrual" | "adjust" | "settle" | "kasbon";
export type RateHistoryKind = "wage" | "transport";
