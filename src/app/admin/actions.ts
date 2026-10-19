"use server";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  cashAdvanceTxns,
  cashAdvances,
  contracts,
  employees,
  leaves,
  memberships,
  organizations,
  payPeriods,
  payRateHistory,
  payslipItems,
  payslips,
  timeEntries,
  workTasks,
} from "@/db/schema";
import { AccountError, createCredentialUser, setPin } from "@/lib/accounts";
import { PlanError, resolvePlanPeriod, saveAdvancePlan } from "@/lib/kasbon-server";
import { leaveWorkDays, normalizeLeaveKind } from "@/lib/leave";
import { audit } from "@/lib/audit";
import { previewPayroll, type PayrollRow } from "@/lib/payroll-run";
import { ORG_COOKIE, requireAdmin } from "@/lib/session";
import {
  isValidPhone,
  parseMoneyInput,
  toNumber,
  localDateString,
  formatDateID,
} from "@/lib/format";
import { findCountry } from "@/lib/countries";

/** Zona waktu yang boleh dipilih; menentukan batas tanggal absensi & periode gaji. */
const TIMEZONE_OPTIONS = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];

function str(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStr(fd: FormData, key: string): string | null {
  const value = str(fd, key);
  return value === "" ? null : value;
}

/** Angka opsional: kosong atau bukan angka dianggap tidak diisi. */
function optionalNumber(fd: FormData, key: string): number | null {
  const value = str(fd, key).replace(",", ".");
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function flash(path: string, params: Record<string, string>): never {
  // Path boleh sudah membawa query (mis. `?tab=kasbon`), jadi flash ditambahkan dengan aman.
  const url = new URL(path, "http://flash.local");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}${url.hash}`);
}

function fail(path: string, message: string): never {
  flash(path, { err: message });
}

function ok(path: string, message: string): never {
  flash(path, { ok: message });
}

/**
 * Path tujuan dari form hanya boleh halaman admin internal.
 * Mencegah `backTo` diarahkan ke luar aplikasi lewat query string.
 */
function adminPath(fd: FormData, key: string, fallback: string): string {
  const value = str(fd, key);
  return value === "/admin" || value.startsWith("/admin/") ? value : fallback;
}

/* ----------------------------- organisasi ----------------------------- */

export async function switchOrgAction(formData: FormData) {
  const { allMemberships } = await requireAdmin();
  const orgId = str(formData, "orgId");
  if (!allMemberships.some((row) => row.membership.orgId === orgId)) return;

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/admin");
}

export async function updateOrgSettingsAction(formData: FormData) {
  const { org, user } = await requireAdmin();

  const startDay = Math.min(31, Math.max(1, Number(str(formData, "payPeriodStartDay")) || 1));
  const alertDays = Math.max(0, Number(str(formData, "contractAlertDays")) || 60);
  const workingDays = Math.min(31, Math.max(1, Number(str(formData, "workingDaysPerMonth")) || 22));
  const multiplier = Math.max(1, Number(str(formData, "overtimeMultiplier")) || 1);
  const timezone = str(formData, "timezone");
  const timezoneSafe = TIMEZONE_OPTIONS.some((option) => option === timezone) ? timezone : org.timezone;
  const geofenceLat = optionalNumber(formData, "geofenceLat");
  const geofenceLng = optionalNumber(formData, "geofenceLng");
  const geofenceRadius = optionalNumber(formData, "geofenceRadiusM");

  await db
    .update(organizations)
    .set({
      payPeriodStartDay: startDay,
      contractAlertDays: alertDays,
      workingDaysPerMonth: workingDays,
      overtimeMultiplier: multiplier.toFixed(2),
      timezone: timezoneSafe,
      geofenceLat,
      geofenceLng,
      geofenceRadiusM: geofenceRadius === null ? null : Math.round(geofenceRadius),
    })
    .where(eq(organizations.id, org.id));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "organizations",
    entityId: org.id,
    action: "update_settings",
    diff: { startDay, alertDays, workingDays, multiplier, timezone: timezoneSafe, geofenceLat, geofenceLng, geofenceRadius },
  });

  revalidatePath("/admin/pengaturan");
  ok("/admin/pengaturan", "Pengaturan disimpan.");
}

/* ------------------------------ karyawan ------------------------------ */

export async function createEmployeeAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const backTo = "/admin/karyawan/baru";

  const fullName = str(formData, "fullName");
  const phone = str(formData, "phone");
  const phoneDial = findCountry(str(formData, "phoneDial") || "ID").dial;
  const pin = str(formData, "pin");
  const code = optionalStr(formData, "code");
  const payType = str(formData, "payType");
  const payRate = parseMoneyInput(formData.get("payRate"));
  const joinedAt = str(formData, "joinedAt") || new Date().toISOString().slice(0, 10);
  const createLogin = str(formData, "createLogin") === "on";

  if (!fullName) fail(backTo, "Nama karyawan wajib diisi.");
  if (!["hourly", "daily", "monthly", "per_task"].includes(payType))
    fail(backTo, "Tipe penggajian tidak valid.");
  if (payRate <= 0) fail(backTo, "Tarif harus lebih dari 0.");

  let userId: string | null = null;

  try {
    if (createLogin) {
      if (!isValidPhone(phone, phoneDial))
        fail(backTo, "Nomor HP tidak valid untuk login.");
      const created = await createCredentialUser({ name: fullName, phone, pin, dial: phoneDial });
      userId = created.userId;
    }
  } catch (error) {
    if (error instanceof AccountError) fail(backTo, error.message);
    throw error;
  }

  const [employee] = await db
    .insert(employees)
    .values({
      orgId: org.id,
      userId,
      code,
      fullName,
      payType,
      payRate: payRate.toString(),
      joinedAt,
    })
    .returning();

  if (userId) {
    await db
      .insert(memberships)
      .values({ orgId: org.id, userId, role: "employee" })
      .onConflictDoNothing();
  }

  await db.insert(payRateHistory).values({
    employeeId: employee.id,
    payType,
    payRate: payRate.toString(),
    effectiveFrom: joinedAt,
    createdBy: user.id,
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "employees",
    entityId: employee.id,
    action: "create",
    diff: { fullName, payType, payRate },
  });

  revalidatePath("/admin/karyawan");
  // Langsung ke halaman detail karyawan baru supaya bisa lanjut isi kontrak/akun.
  ok(`/admin/karyawan/${employee.id}`, `${fullName} ditambahkan.`);
}

export async function updateEmployeeAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = str(formData, "backTo") || `/admin/karyawan/${employeeId}`;

  const [current] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!current) fail("/admin/karyawan", "Karyawan tidak ditemukan.");

  const fullName = str(formData, "fullName") || current.fullName;
  const code = optionalStr(formData, "code");
  const payType = str(formData, "payType") || current.payType;
  const payRate = parseMoneyInput(formData.get("payRate")) || toNumber(current.payRate);
  const isActive = str(formData, "isActive") === "on";
  const endedAt = optionalStr(formData, "endedAt");

  await db
    .update(employees)
    .set({ fullName, code, payType, payRate: payRate.toString(), isActive, endedAt })
    .where(eq(employees.id, employeeId));

  const rateChanged =
    payType !== current.payType || payRate !== toNumber(current.payRate);

  if (rateChanged) {
    await db.insert(payRateHistory).values({
      employeeId,
      payType,
      payRate: payRate.toString(),
      effectiveFrom: new Date().toISOString().slice(0, 10),
      createdBy: user.id,
    });
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "employees",
    entityId: employeeId,
    action: "update",
    diff: { payType, payRate, rateChanged },
  });

  revalidatePath(`/admin/karyawan/${employeeId}`);
  ok(backTo, "Data karyawan diperbarui.");
}

export async function resetPinAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const pin = str(formData, "pin");
  const backTo = str(formData, "backTo") || `/admin/karyawan/${employeeId}`;

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee?.userId) fail(backTo, "Karyawan ini tidak punya akun login.");

  try {
    await setPin(employee.userId, pin);
  } catch (error) {
    if (error instanceof AccountError) fail(backTo, error.message);
    throw error;
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "employees",
    entityId: employeeId,
    action: "reset_pin",
  });

  ok(backTo, "PIN berhasil diganti.");
}

/* ------------------------------- kontrak ------------------------------ */

export async function createContractAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = adminPath(formData, "backTo", "/admin/kontrak/baru");
  // Sukses kembali ke daftar kontrak (atau halaman asal), error tetap di form.
  const successTo = adminPath(formData, "successTo", "/admin/kontrak");

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) fail(backTo, "Karyawan tidak ditemukan.");

  const kind = str(formData, "kind") || "pkwt";
  const startDate = str(formData, "startDate");
  const endDate = optionalStr(formData, "endDate");
  const payType = str(formData, "payType") || employee.payType;
  const payRate = parseMoneyInput(formData.get("payRate")) || toNumber(employee.payRate);
  const renewedFromId = optionalStr(formData, "renewedFromId");

  if (!startDate) fail(backTo, "Tanggal mulai kontrak wajib diisi.");
  if (kind !== "pkwtt" && !endDate) fail(backTo, "Kontrak PKWT wajib punya tanggal berakhir.");
  if (endDate && endDate <= startDate) fail(backTo, "Tanggal berakhir harus setelah tanggal mulai.");

  // Cegah dua kontrak aktif yang periodenya bertumpuk untuk karyawan yang sama.
  if (!renewedFromId) {
    const active = await db
      .select({ startDate: contracts.startDate, endDate: contracts.endDate })
      .from(contracts)
      .where(and(eq(contracts.employeeId, employeeId), eq(contracts.status, "active")));

    const newEnd = endDate ?? "9999-12-31";
    const overlap = active.find(
      (row) => row.startDate <= newEnd && startDate <= (row.endDate ?? "9999-12-31"),
    );

    if (overlap) {
      fail(
        backTo,
        `Karyawan masih punya kontrak aktif (${formatDateID(overlap.startDate)} s/d ${overlap.endDate ? formatDateID(overlap.endDate) : "tanpa batas"}). Pakai Perpanjang atau akhiri kontrak lama dulu.`,
      );
    }
  }

  const [contract] = await db
    .insert(contracts)
    .values({
      orgId: org.id,
      employeeId,
      kind,
      startDate,
      endDate,
      payType,
      payRate: payRate.toString(),
      contractNo: optionalStr(formData, "contractNo"),
      note: optionalStr(formData, "note"),
      renewedFromId,
    })
    .returning();

  if (renewedFromId) {
    await db
      .update(contracts)
      .set({ status: "renewed" })
      .where(and(eq(contracts.id, renewedFromId), eq(contracts.orgId, org.id)));
  }

  // Kontrak yang sudah berlaku langsung menyetir tarif karyawan (payroll membaca employees.pay_rate).
  const today = localDateString(new Date(), org.timezone);
  if (startDate <= today && (employee.payType !== payType || toNumber(employee.payRate) !== payRate)) {
    await db
      .update(employees)
      .set({ payType, payRate: payRate.toString() })
      .where(eq(employees.id, employeeId));

    await db.insert(payRateHistory).values({
      employeeId,
      payType,
      payRate: payRate.toString(),
      effectiveFrom: startDate,
      createdBy: user.id,
    });
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "contracts",
    entityId: contract.id,
    action: renewedFromId ? "renew" : "create",
    diff: { employeeId, kind, startDate, endDate, payRate },
  });

  revalidatePath("/admin/kontrak");
  revalidatePath(`/admin/kontrak/${contract.id}`);
  revalidatePath(`/admin/karyawan/${employeeId}`);
  ok(successTo, "Kontrak disimpan.");
}

export async function updateContractAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const contractId = str(formData, "contractId");
  const backTo = adminPath(formData, "backTo", `/admin/kontrak/${contractId}`);

  const [current] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, org.id)))
    .limit(1);

  if (!current) fail("/admin/kontrak", "Kontrak tidak ditemukan.");

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, current.employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) fail("/admin/kontrak", "Karyawan kontrak ini tidak ditemukan.");

  const kind = str(formData, "kind") || current.kind;
  const startDate = str(formData, "startDate") || current.startDate;
  const endDate = optionalStr(formData, "endDate");
  const payType = str(formData, "payType") || current.payType;
  const payRate = parseMoneyInput(formData.get("payRate")) || toNumber(current.payRate);
  const contractNo = optionalStr(formData, "contractNo");
  const note = optionalStr(formData, "note");

  if (!["pkwt", "probation", "pkwtt", "other"].includes(kind))
    fail(backTo, "Jenis kontrak tidak valid.");
  if (!["hourly", "daily", "monthly", "per_task"].includes(payType))
    fail(backTo, "Tipe gaji tidak valid.");
  if (kind !== "pkwtt" && !endDate)
    fail(backTo, "Kontrak selain PKWTT wajib punya tanggal berakhir.");
  if (endDate && endDate <= startDate) fail(backTo, "Tanggal berakhir harus setelah tanggal mulai.");
  if (payRate <= 0) fail(backTo, "Tarif harus lebih dari 0.");

  // Kontrak aktif tidak boleh bertumpuk dengan kontrak aktif lain milik karyawan yang sama.
  if (current.status === "active") {
    const others = await db
      .select({ id: contracts.id, startDate: contracts.startDate, endDate: contracts.endDate })
      .from(contracts)
      .where(
        and(
          eq(contracts.orgId, org.id),
          eq(contracts.employeeId, current.employeeId),
          eq(contracts.status, "active"),
        ),
      );

    const newEnd = endDate ?? "9999-12-31";
    const overlap = others.find(
      (row) =>
        row.id !== contractId && row.startDate <= newEnd && startDate <= (row.endDate ?? "9999-12-31"),
    );

    if (overlap) {
      fail(
        backTo,
        `Periode bertumpuk dengan kontrak aktif lain (${formatDateID(overlap.startDate)} s/d ${overlap.endDate ? formatDateID(overlap.endDate) : "tanpa batas"}).`,
      );
    }
  }

  await db
    .update(contracts)
    .set({ kind, contractNo, startDate, endDate, payType, payRate: payRate.toString(), note })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, org.id)));

  // Kontrak aktif yang sudah berlaku menyetir tarif karyawan (payroll membaca employees.pay_rate).
  const today = localDateString(new Date(), org.timezone);
  const drivesRate = current.status === "active" && startDate <= today;
  if (drivesRate && (employee.payType !== payType || toNumber(employee.payRate) !== payRate)) {
    await db
      .update(employees)
      .set({ payType, payRate: payRate.toString() })
      .where(eq(employees.id, employee.id));

    await db.insert(payRateHistory).values({
      employeeId: employee.id,
      payType,
      payRate: payRate.toString(),
      effectiveFrom: startDate,
      createdBy: user.id,
    });
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "contracts",
    entityId: contractId,
    action: "update",
    diff: { kind, startDate, endDate, payType, payRate },
  });

  revalidatePath("/admin/kontrak");
  revalidatePath(`/admin/kontrak/${contractId}`);
  revalidatePath(`/admin/karyawan/${current.employeeId}`);
  ok(backTo, "Kontrak diperbarui.");
}

export async function terminateContractAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const contractId = str(formData, "contractId");
  const backTo = adminPath(formData, "backTo", "/admin/kontrak");

  await db
    .update(contracts)
    .set({ status: "terminated" })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, org.id)));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "contracts",
    entityId: contractId,
    action: "terminate",
  });

  revalidatePath("/admin/kontrak");
  ok(backTo, "Kontrak diakhiri.");
}

/* ------------------------------ absensi ------------------------------- */

export async function decideTimeEntryAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const entryId = str(formData, "entryId");
  const decision = str(formData, "decision");
  const reason = optionalStr(formData, "reason");
  const breakMinutes = Number(str(formData, "breakMinutes"));
  const overtimeMinutes = Number(str(formData, "overtimeMinutes"));

  if (!["approve", "reject"].includes(decision)) fail("/admin/absensi", "Aksi tidak dikenal.");

  await db
    .update(timeEntries)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      approvedBy: user.id,
      approvedAt: new Date(),
      rejectReason: decision === "reject" ? reason : null,
      ...(Number.isFinite(breakMinutes) && breakMinutes >= 0 ? { breakMinutes } : {}),
      ...(Number.isFinite(overtimeMinutes) && overtimeMinutes >= 0 ? { overtimeMinutes } : {}),
    })
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id)));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "time_entries",
    entityId: entryId,
    action: decision,
    diff: { breakMinutes, overtimeMinutes, reason },
  });

  revalidatePath("/admin/absensi");
  ok("/admin/absensi", decision === "approve" ? "Absensi disetujui." : "Absensi ditolak.");
}

/* -------------------------------- tugas ------------------------------- */

export async function createTaskAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const title = str(formData, "title");
  const employeeId = optionalStr(formData, "employeeId");
  const qty = Number(str(formData, "qty")) || 1;
  const unit = str(formData, "unit") || "tugas";
  const unitRate = parseMoneyInput(formData.get("unitRate"));
  const workDate = str(formData, "workDate") || new Date().toISOString().slice(0, 10);

  if (!title) fail("/admin/tugas", "Judul tugas wajib diisi.");
  if (unitRate <= 0) fail("/admin/tugas", "Tarif per unit harus lebih dari 0.");

  const [task] = await db
    .insert(workTasks)
    .values({
      orgId: org.id,
      employeeId,
      title,
      description: optionalStr(formData, "description"),
      qty: qty.toString(),
      unit,
      unitRate: unitRate.toString(),
      workDate,
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "work_tasks",
    entityId: task.id,
    action: "create",
    diff: { title, qty, unitRate },
  });

  revalidatePath("/admin/tugas");
  ok("/admin/tugas", "Tugas dibuat.");
}

export async function decideTaskAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const taskId = str(formData, "taskId");
  const decision = str(formData, "decision");

  await db
    .update(workTasks)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      approvedBy: user.id,
      approvedAt: new Date(),
    })
    .where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id)));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "work_tasks",
    entityId: taskId,
    action: decision,
  });

  revalidatePath("/admin/tugas");
  ok("/admin/tugas", decision === "approve" ? "Tugas disetujui." : "Tugas ditolak.");
}

/* -------------------------------- kasbon ------------------------------ */

export async function createAdvanceAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const principal = parseMoneyInput(formData.get("principal"));
  const installment = parseMoneyInput(formData.get("installmentAmount"));
  const requestedAt = str(formData, "requestedAt") || new Date().toISOString().slice(0, 10);
  const backTo = str(formData, "backTo") || "/admin/kasbon";

  if (!employeeId) fail(backTo, "Pilih karyawan.");
  if (principal <= 0) fail(backTo, "Nominal kasbon harus lebih dari 0.");
  if (installment > principal) fail(backTo, "Cicilan tidak boleh melebihi pokok kasbon.");

  const [advance] = await db
    .insert(cashAdvances)
    .values({
      orgId: org.id,
      employeeId,
      principal: principal.toString(),
      balance: principal.toString(),
      installmentAmount: installment > 0 ? installment.toString() : null,
      requestedAt,
      status: "pending",
      note: optionalStr(formData, "note"),
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "cash_advances",
    entityId: advance.id,
    action: "create",
    diff: { employeeId, principal },
  });

  revalidatePath("/admin/kasbon");
  ok(backTo, "Pengajuan kasbon dibuat.");
}

export async function decideAdvanceAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const advanceId = str(formData, "advanceId");
  const decision = str(formData, "decision");

  const [advance] = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, advanceId), eq(cashAdvances.orgId, org.id)))
    .limit(1);

  if (!advance) fail("/admin/kasbon", "Kasbon tidak ditemukan.");

  if (decision === "approve") {
    await db.transaction(async (tx) => {
      await tx
        .update(cashAdvances)
        .set({ status: "approved", approvedBy: user.id, approvedAt: new Date() })
        .where(eq(cashAdvances.id, advanceId));

      await tx.insert(cashAdvanceTxns).values({
        cashAdvanceId: advanceId,
        kind: "disburse",
        amount: advance.principal,
        occurredAt: advance.requestedAt,
        note: "Pencairan kasbon",
        createdBy: user.id,
      });
    });
  } else {
    await db
      .update(cashAdvances)
      .set({ status: "rejected", approvedBy: user.id, approvedAt: new Date() })
      .where(eq(cashAdvances.id, advanceId));
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "cash_advances",
    entityId: advanceId,
    action: decision,
  });

  revalidatePath("/admin/kasbon");
  ok("/admin/kasbon", decision === "approve" ? "Kasbon disetujui." : "Kasbon ditolak.");
}

/* -------------------------------- payroll ----------------------------- */

/**
 * Simpan keputusan potong/tunda kasbon untuk satu periode gaji.
 * `decision`: "deduct" (potong sekarang, `amount` opsional), "defer" (tunda ke periode
 * berikutnya), atau "auto" (hapus keputusan, kembali ke cicilan/penuh otomatis).
 */
export async function setAdvancePlanAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const advanceId = str(formData, "advanceId");
  const decision = str(formData, "decision") || "deduct";
  const amount = parseMoneyInput(formData.get("amount"));
  const backTo = str(formData, "backTo") || "/admin/kasbon";

  const [advance] = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, advanceId), eq(cashAdvances.orgId, org.id)))
    .limit(1);

  if (!advance) fail(backTo, "Kasbon tidak ditemukan.");
  if (advance.status !== "approved") fail(backTo, "Hanya kasbon approved yang bisa diatur.");

  const target = await resolvePlanPeriod(org, str(formData, "periodStart"));
  if (!target.ok) fail(backTo, target.message);

  try {
    await saveAdvancePlan({
      orgId: org.id,
      advanceId,
      period: target.period,
      decision,
      amount,
      note: optionalStr(formData, "note"),
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof PlanError) fail(backTo, error.message);
    throw error;
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "cash_advance_plans",
    entityId: advanceId,
    action: `plan_${decision}`,
    diff: { periodStart: target.period.start, amount },
  });

  revalidatePath("/admin/kasbon");
  revalidatePath(`/admin/karyawan/${advance.employeeId}`);
  ok(backTo, "Rencana potong kasbon disimpan. Jalankan \"Hitung ulang\" pada draft payroll agar slip ikut berubah.");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Tulis slip + item + ledger kasbon untuk satu periode dari hasil preview. */
async function writePayrollSlips(
  tx: Tx,
  input: {
    orgId: string;
    periodId: string;
    periodEnd: string;
    userId: string;
    rows: PayrollRow[];
  },
) {
  for (const row of input.rows) {
    const [slip] = await tx
      .insert(payslips)
      .values({
        orgId: input.orgId,
        payPeriodId: input.periodId,
        employeeId: row.employee.id,
        payType: row.employee.payType,
        payRate: row.employee.payRate,
        gross: row.computation.gross.toString(),
        totalDeductions: row.computation.deductions.toString(),
        net: row.computation.net.toString(),
        status: "draft",
      })
      .returning();

    if (row.computation.lines.length > 0) {
      await tx.insert(payslipItems).values(
        row.computation.lines.map((line) => ({
          payslipId: slip.id,
          kind: line.kind,
          label: line.label,
          qty: line.qty.toString(),
          unit: line.unit,
          unitRate: line.unitRate.toString(),
          amount: line.amount.toString(),
          sourceTable: line.sourceTable ?? null,
          sourceId: line.sourceId ?? null,
          meta: line.meta ?? null,
        })),
      );
    }

    // Catat pemotongan kasbon ke ledger + kurangi saldo
    for (const line of row.computation.lines.filter((l) => l.kind === "kasbon")) {
      if (!line.sourceId) continue;
      await tx.insert(cashAdvanceTxns).values({
        cashAdvanceId: line.sourceId,
        kind: "repay",
        amount: line.amount.toString(),
        payslipId: slip.id,
        occurredAt: input.periodEnd,
        note: `Potongan slip gaji · ${line.label}`,
        createdBy: input.userId,
      });

      await tx
        .update(cashAdvances)
        .set({
          balance: sql`greatest(${cashAdvances.balance} - ${line.amount}, 0)`,
          status: sql`case when ${cashAdvances.balance} - ${line.amount} <= 0 then 'settled' else ${cashAdvances.status} end`,
        })
        .where(eq(cashAdvances.id, line.sourceId));
    }
  }
}

/** Kembalikan saldo kasbon yang sempat dipotong oleh slip periode ini. */
async function revertPayrollSettlements(tx: Tx, periodId: string) {
  const slips = await tx
    .select({ id: payslips.id })
    .from(payslips)
    .where(eq(payslips.payPeriodId, periodId));

  const slipIds = slips.map((slip) => slip.id);
  if (slipIds.length === 0) return;

  const repayments = await tx
    .select()
    .from(cashAdvanceTxns)
    .where(eq(cashAdvanceTxns.kind, "repay"));

  for (const repayment of repayments) {
    if (!repayment.payslipId || !slipIds.includes(repayment.payslipId)) continue;
    await tx
      .update(cashAdvances)
      .set({
        balance: sql`${cashAdvances.balance} + ${repayment.amount}`,
        status: "approved",
      })
      .where(eq(cashAdvances.id, repayment.cashAdvanceId));
    await tx.delete(cashAdvanceTxns).where(eq(cashAdvanceTxns.id, repayment.id));
  }
}

/* -------------------------------- cuti -------------------------------- */

/** Tanggal `YYYY-MM-DD` yang benar-benar ada (menolak 2026-02-31). */
function dateField(fd: FormData, key: string): string | null {
  const value = str(fd, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * Admin mencatat cuti langsung (langsung disetujui). Dipakai dari halaman Cuti
 * maupun tab Cuti di detail karyawan; `backTo` menentukan arah redirect.
 */
export async function createLeaveAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const backTo = adminPath(formData, "backTo", "/admin/cuti");
  const employeeId = str(formData, "employeeId");

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)))
    .limit(1);

  if (!employee) fail(backTo, "Karyawan tidak ditemukan.");
  if (employee.payType !== "monthly") {
    fail(backTo, "Cuti hanya berlaku untuk karyawan bulanan.");
  }

  const startDate = dateField(formData, "startDate");
  const endDate = dateField(formData, "endDate") ?? startDate;
  if (!startDate) fail(backTo, "Tanggal mulai cuti tidak valid.");
  if (!endDate || endDate < startDate) {
    fail(backTo, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  const days = leaveWorkDays(startDate, endDate);
  if (days === 0) fail(backTo, "Rentang itu tidak memuat hari kerja (Senin–Sabtu).");

  const [overlap] = await db
    .select({ id: leaves.id })
    .from(leaves)
    .where(
      and(
        eq(leaves.employeeId, employee.id),
        inArray(leaves.status, ["pending", "approved"]),
        lte(leaves.startDate, endDate),
        gte(leaves.endDate, startDate),
      ),
    )
    .limit(1);

  if (overlap) fail(backTo, "Sudah ada cuti pending/disetujui di rentang tanggal itu.");

  const [row] = await db
    .insert(leaves)
    .values({
      orgId: org.id,
      employeeId: employee.id,
      kind: normalizeLeaveKind(str(formData, "kind")),
      startDate,
      endDate,
      days,
      paid: str(formData, "paid") !== "0",
      status: "approved",
      note: str(formData, "note") || null,
      requestedBy: user.id,
      approvedBy: user.id,
      approvedAt: new Date(),
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "leaves",
    entityId: row.id,
    action: "create",
    diff: { employeeId: employee.id, startDate, endDate, days, paid: row.paid },
  });

  revalidatePath("/admin/cuti");
  revalidatePath(`/admin/karyawan/${employee.id}`);
  revalidatePath("/employee/cuti");
  ok(backTo, `Cuti ${days} hari dicatat untuk ${employee.fullName}.`);
}

/** Setujui / tolak pengajuan cuti karyawan. */
export async function decideLeaveAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const backTo = adminPath(formData, "backTo", "/admin/cuti");
  const leaveId = str(formData, "leaveId");
  const decision = str(formData, "decision");

  if (decision !== "approved" && decision !== "rejected") {
    fail(backTo, "Keputusan cuti tidak dikenal.");
  }

  const [row] = await db
    .select({ leave: leaves, payType: employees.payType, fullName: employees.fullName })
    .from(leaves)
    .innerJoin(employees, eq(leaves.employeeId, employees.id))
    .where(and(eq(leaves.id, leaveId), eq(leaves.orgId, org.id)))
    .limit(1);

  if (!row) fail(backTo, "Pengajuan cuti tidak ditemukan.");
  if (row.leave.status !== "pending") {
    fail(backTo, "Pengajuan ini sudah diputuskan sebelumnya.");
  }
  if (decision === "approved" && row.payType !== "monthly") {
    fail(backTo, "Cuti hanya bisa disetujui untuk karyawan bulanan.");
  }

  await db
    .update(leaves)
    .set({
      status: decision,
      approvedBy: user.id,
      approvedAt: new Date(),
      rejectReason: decision === "rejected" ? str(formData, "rejectReason") || null : null,
    })
    .where(eq(leaves.id, row.leave.id));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "leaves",
    entityId: row.leave.id,
    action: decision,
    diff: { startDate: row.leave.startDate, endDate: row.leave.endDate },
  });

  revalidatePath("/admin/cuti");
  revalidatePath(`/admin/karyawan/${row.leave.employeeId}`);
  revalidatePath("/employee/cuti");
  ok(
    backTo,
    decision === "approved"
      ? `Cuti ${row.fullName} disetujui dan akan dihitung di payroll bulanan.`
      : `Pengajuan cuti ${row.fullName} ditolak.`,
  );
}

export async function createPayrollRunAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const rawPeriod = str(formData, "period");
  const [periodStart, periodEnd] = rawPeriod.includes("|")
    ? rawPeriod.split("|")
    : [str(formData, "periodStart"), str(formData, "periodEnd")];
  const payDate = optionalStr(formData, "payDate");

  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    fail("/admin/payroll", "Rentang periode tidak valid.");
  }

  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(and(eq(payPeriods.orgId, org.id), eq(payPeriods.periodStart, periodStart)))
    .limit(1);

  if (existing) fail("/admin/payroll", "Periode ini sudah pernah dihitung.");

  const preview = await previewPayroll(
    org.id,
    { start: periodStart, end: periodEnd },
    { overtimeMultiplier: toNumber(org.overtimeMultiplier) },
  );

  const payable = preview.rows.filter((row) => row.computation.lines.length > 0);
  if (payable.length === 0) {
    fail("/admin/payroll", "Tidak ada data absensi/tugas approved pada periode ini.");
  }

  const periodId = await db.transaction(async (tx) => {
    const [period] = await tx
      .insert(payPeriods)
      .values({
        orgId: org.id,
        periodStart,
        periodEnd,
        payDate,
        status: "draft",
        createdBy: user.id,
      })
      .returning();

    await writePayrollSlips(tx, {
      orgId: org.id,
      periodId: period.id,
      periodEnd,
      userId: user.id,
      rows: payable,
    });

    return period.id;
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "pay_periods",
    entityId: periodId,
    action: "create",
    diff: { periodStart, periodEnd, employees: payable.length },
  });

  revalidatePath("/admin/payroll");
  redirect(`/admin/payroll/${periodId}`);
}

/**
 * Hitung ulang draft payroll: dipakai setelah karyawan/admin mengubah rencana potong kasbon.
 * Saldo kasbon yang sempat terpotong dikembalikan dulu, lalu slip & item dibuat ulang
 * dari data approved + rencana terbaru.
 */
export async function recalculatePayrollDraftAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const periodId = str(formData, "periodId");

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, periodId), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) fail("/admin/payroll", "Periode tidak ditemukan.");
  if (period.status !== "draft")
    fail(`/admin/payroll/${periodId}`, "Hanya draft yang bisa dihitung ulang.");

  const preview = await previewPayroll(
    org.id,
    { start: period.periodStart, end: period.periodEnd },
    { overtimeMultiplier: toNumber(org.overtimeMultiplier) },
  );
  const payable = preview.rows.filter((row) => row.computation.lines.length > 0);

  await db.transaction(async (tx) => {
    await revertPayrollSettlements(tx, periodId);
    await tx.delete(payslips).where(eq(payslips.payPeriodId, periodId));

    await writePayrollSlips(tx, {
      orgId: org.id,
      periodId,
      periodEnd: period.periodEnd,
      userId: user.id,
      rows: payable,
    });
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "pay_periods",
    entityId: periodId,
    action: "recalculate",
    diff: { employees: payable.length },
  });

  revalidatePath(`/admin/payroll/${periodId}`);
  ok(`/admin/payroll/${periodId}`, "Draft payroll dihitung ulang.");
}

export async function updatePayPeriodStatusAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const periodId = str(formData, "periodId");
  const nextStatus = str(formData, "status");

  if (!["approved", "paid", "void"].includes(nextStatus)) {
    fail(`/admin/payroll/${periodId}`, "Status tidak dikenal.");
  }

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, periodId), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) fail("/admin/payroll", "Periode tidak ditemukan.");

  await db.transaction(async (tx) => {
    await tx
      .update(payPeriods)
      .set({
        status: nextStatus,
        approvedBy: nextStatus === "approved" ? user.id : period.approvedBy,
        approvedAt: nextStatus === "approved" ? new Date() : period.approvedAt,
      })
      .where(eq(payPeriods.id, periodId));

    if (nextStatus === "approved") {
      await tx
        .update(payslips)
        .set({ status: "final" })
        .where(and(eq(payslips.payPeriodId, periodId), eq(payslips.status, "draft")));
    }

    if (nextStatus === "paid") {
      await tx
        .update(payslips)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(payslips.payPeriodId, periodId));
    }

    if (nextStatus === "void") {
      await tx
        .update(payslips)
        .set({ status: "void" })
        .where(eq(payslips.payPeriodId, periodId));
    }
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "pay_periods",
    entityId: periodId,
    action: nextStatus,
  });

  revalidatePath(`/admin/payroll/${periodId}`);
  ok(`/admin/payroll/${periodId}`, `Status periode: ${nextStatus}.`);
}

export async function deletePayrollDraftAction(formData: FormData) {
  const { org } = await requireAdmin();
  const periodId = str(formData, "periodId");

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, periodId), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) fail("/admin/payroll", "Periode tidak ditemukan.");
  if (period.status !== "draft") fail(`/admin/payroll/${periodId}`, "Hanya draft yang bisa dihapus.");

  await db.transaction(async (tx) => {
    await revertPayrollSettlements(tx, periodId);
    await tx.delete(payPeriods).where(eq(payPeriods.id, periodId));
  });

  revalidatePath("/admin/payroll");
  ok("/admin/payroll", "Draft payroll dihapus.");
}
