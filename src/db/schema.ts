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
    payType: text("pay_type").notNull(),
    payRate: numeric("pay_rate", { precision: 14, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pay_rate_history_emp_idx").on(t.employeeId, t.effectiveFrom)],
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
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("time_entries_one_open")
      .on(t.employeeId)
      .where(sql`clock_out_at is null`),
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
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const employeesRelations = relations(employees, ({ one, many }) => ({
  org: one(organizations, { fields: [employees.orgId], references: [organizations.id] }),
  user: one(user, { fields: [employees.userId], references: [user.id] }),
  contracts: many(contracts),
  timeEntries: many(timeEntries),
}));

export const payslipRelations = relations(payslips, ({ one, many }) => ({
  employee: one(employees, { fields: [payslips.employeeId], references: [employees.id] }),
  period: one(payPeriods, { fields: [payslips.payPeriodId], references: [payPeriods.id] }),
  items: many(payslipItems),
}));

export type PayType = "hourly" | "daily" | "monthly" | "per_task";
export type Role = "owner" | "admin" | "employee";
