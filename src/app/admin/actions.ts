"use server";

import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
  session,
  timeEntries,
  workTasks,
} from "@/db/schema";
import { AccountError, createCredentialUser, setPin } from "@/lib/accounts";
import { PlanError, resolvePlanPeriod, saveAdvancePlan } from "@/lib/kasbon-server";
import {
  accrueForEntry,
  adjustSaldo,
  reverseAccrual,
  revertSettlements,
  SaldoTransferError,
  settleShortfall,
  topUpSaldo,
  transferAdvanceToSaldo,
} from "@/lib/saldo-server";
import { leaveWorkDays, normalizeLeaveKind } from "@/lib/leave";
import { audit } from "@/lib/audit";
import { requireOrgEmployee } from "@/lib/org-employee";
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

/** Format tanggal tunggal YYYY-MM-DD; nilai custom dari form wajib lolos ini. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
  const transportRate = Math.max(0, parseMoneyInput(formData.get("transportRate")));
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
      transportRate: transportRate.toString(),
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
    kind: "wage",
    payType,
    payRate: payRate.toString(),
    effectiveFrom: joinedAt,
    createdBy: user.id,
  });

  if (transportRate > 0) {
    await db.insert(payRateHistory).values({
      employeeId: employee.id,
      kind: "transport",
      payType,
      payRate: transportRate.toString(),
      effectiveFrom: joinedAt,
      createdBy: user.id,
    });
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "employees",
    entityId: employee.id,
    action: "create",
    diff: { fullName, payType, payRate, transportRate },
  });

  revalidatePath("/admin/karyawan");
  // Langsung ke halaman detail karyawan baru supaya bisa lanjut isi kontrak/akun.
  ok(`/admin/karyawan/${employee.id}`, `${fullName} ditambahkan.`);
}

export async function updateEmployeeAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = str(formData, "backTo") || `/admin/karyawan/${employeeId}`;

  const current = await requireOrgEmployee(db, org.id, employeeId);

  if (!current) fail("/admin/karyawan", "Karyawan tidak ditemukan.");

  const fullName = str(formData, "fullName") || current.fullName;
  const code = optionalStr(formData, "code");
  const payType = str(formData, "payType") || current.payType;
  const payRate = parseMoneyInput(formData.get("payRate")) || toNumber(current.payRate);
  const hasTransportField = formData.get("transportRate") !== null;
  const transportRate = hasTransportField
    ? Math.max(0, parseMoneyInput(formData.get("transportRate")))
    : toNumber(current.transportRate);
  const isActive = str(formData, "isActive") === "on";
  // Berhenti tanpa mengisi tanggal: isi otomatis hari ini (zona waktu organisasi)
  // supaya payroll tahu batas akhir upah. Tanggal berhenti yang sudah ada tidak ditimpa.
  const endedAt =
    optionalStr(formData, "endedAt") ??
    (!isActive ? current.endedAt ?? localDateString(new Date(), org.timezone) : null);


  const rateChanged =
    payType !== current.payType || payRate !== toNumber(current.payRate);
  // Tarif ongkos juga punya riwayat: kenaikan tarif tidak boleh mengubah
  // kedatangan yang sudah lewat (nilai per absensi sudah tersimpan).
  const transportChanged = transportRate !== toNumber(current.transportRate);

  const justDeactivated = current.isActive && !isActive;
  const targetUserId = current.userId;

  await db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({
        fullName,
        code,
        payType,
        payRate: payRate.toString(),
        transportRate: transportRate.toString(),
        isActive,
        endedAt,
      })
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)));

    if (rateChanged) {
      await tx.insert(payRateHistory).values({
        employeeId,
        kind: "wage",
        payType,
        payRate: payRate.toString(),
        effectiveFrom: new Date().toISOString().slice(0, 10),
        createdBy: user.id,
      });
    }

    if (transportChanged) {
      await tx.insert(payRateHistory).values({
        employeeId,
        kind: "transport",
        payType,
        payRate: transportRate.toString(),
        effectiveFrom: new Date().toISOString().slice(0, 10),
        createdBy: user.id,
      });
    }

    // Menonaktifkan karyawan berarti mencabut akses loginnya, kecuali user itu
    // masih punya membership admin/owner di organisasi mana pun, atau masih
    // karyawan aktif di organisasi lain (baris employees lain dengan isActive=true).
    // Penghapusan sesi ikut transaksi ini supaya status nonaktif dan pencabutan
    // token tidak terpisah.
    if (justDeactivated && targetUserId) {
      const [adminMembership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, targetUserId),
            inArray(memberships.role, ["owner", "admin"]),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        const [otherActiveEmployee] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(
            and(
              eq(employees.userId, targetUserId),
              eq(employees.isActive, true),
              ne(employees.id, employeeId),
            ),
          )
          .limit(1);

        if (!otherActiveEmployee) {
          await tx.delete(session).where(eq(session.userId, targetUserId));
        }
      }
    }
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "employees",
    entityId: employeeId,
    action: "update",
    diff: { payType, payRate, rateChanged, transportRate, transportChanged },
  });

  revalidatePath(`/admin/karyawan/${employeeId}`);
  ok(backTo, "Data karyawan diperbarui.");
}

export async function resetPinAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const pin = str(formData, "pin");
  const backTo = str(formData, "backTo") || `/admin/karyawan/${employeeId}`;

  const employee = await requireOrgEmployee(db, org.id, employeeId);

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

  const employee = await requireOrgEmployee(db, org.id, employeeId);

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
      .where(and(eq(contracts.orgId, org.id), eq(contracts.employeeId, employeeId), eq(contracts.status, "active")));

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
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, org.id)));

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

  const employee = await requireOrgEmployee(db, org.id, current.employeeId);

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
      .where(and(eq(employees.id, employee.id), eq(employees.orgId, org.id)));

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
  const hasTransport = formData.get("transportAmount") !== null;
  const transportAmount = Math.max(0, parseMoneyInput(formData.get("transportAmount")));

  if (!["approve", "reject"].includes(decision)) fail("/admin/absensi", "Aksi tidak dikenal.");

  let found = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(timeEntries)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectReason: decision === "reject" ? reason : null,
        ...(Number.isFinite(breakMinutes) && breakMinutes >= 0 ? { breakMinutes } : {}),
        ...(Number.isFinite(overtimeMinutes) && overtimeMinutes >= 0 ? { overtimeMinutes } : {}),
        ...(hasTransport ? { transportAmount: transportAmount.toString() } : {}),
      })
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id), isNull(timeEntries.deletedAt)))
      .returning({ id: timeEntries.id });

    // Tidak ada baris yang cocok = absensi tidak ada / bukan milik org ini.
    // Jangan sentuh saldo sama sekali.
    if (!updated) return;
    found = true;

    // Saldo dipotong di titik ini: hanya absensi yang sudah disetujui yang boleh
    // mengurangi uang muka. Menolak absensi berarti accrual-nya dibatalkan.
    if (decision === "approve") {
      const result = await accrueForEntry(tx, { orgId: org.id, entryId, userId: user.id });
      if (!result.ok) throw new Error(result.message);
    } else {
      await reverseAccrual(tx, org.id, entryId);
    }
  });

  if (!found) fail("/admin/absensi", "Absensi tidak ditemukan.");

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "time_entries",
    entityId: entryId,
    action: decision,
    diff: { breakMinutes, overtimeMinutes, reason, transportAmount: hasTransport ? transportAmount : null },
  });

  revalidatePath("/admin/absensi");
  revalidatePath("/admin/saldo");
  revalidatePath("/employee");
  revalidatePath("/employee/saldo");
  ok("/admin/absensi", decision === "approve" ? "Absensi disetujui." : "Absensi ditolak.");
}

/**
 * Koreksi ongkos kedatangan oleh admin.
 *
 * Ongkos diisi karyawan sendiri saat clock in, jadi admin harus bisa mengoreksinya —
 * terutama sebelum absensi di-approve. Kalau absensi sudah approved, accrual saldo
 * ikut dihitung ulang (bukan ditambah baris baru).
 */
export async function setTransportAmountAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const entryId = str(formData, "entryId");
  const backTo = str(formData, "backTo") || "/admin/absensi";
  const amount = Math.max(0, parseMoneyInput(formData.get("transportAmount")));

  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id), isNull(timeEntries.deletedAt)))
    .limit(1);

  if (!entry) fail(backTo, "Absensi tidak ditemukan.");

  await db.transaction(async (tx) => {
    await tx
      .update(timeEntries)
      .set({ transportAmount: amount.toString() })
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id)));

    if (entry.status === "approved") {
      const result = await accrueForEntry(tx, { orgId: org.id, entryId, userId: user.id });
      if (!result.ok) throw new Error(result.message);
    }
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "time_entries",
    entityId: entryId,
    action: "set_transport",
    diff: { from: toNumber(entry.transportAmount), to: amount },
  });

  revalidatePath("/admin/absensi");
  revalidatePath("/admin/saldo");
  ok(backTo, "Ongkos kedatangan disimpan.");
}

/** Koreksi jam clock in/out oleh admin (nilai input mengikuti zona waktu organisasi). */
export async function editTimeEntryAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const entryId = str(formData, "entryId");
  const backTo = adminPath(formData, "backTo", "/admin/absensi");
  const clockInValue = str(formData, "clockInAt");
  const clockOutValue = str(formData, "clockOutAt");
  const parseLocalDateTime = (value: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (
      wallTime.getUTCFullYear() !== year || wallTime.getUTCMonth() !== month - 1 ||
      wallTime.getUTCDate() !== day || wallTime.getUTCHours() !== hour ||
      wallTime.getUTCMinutes() !== minute
    ) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: org.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(wallTime);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute),
    );
    return new Date(2 * wallTime.getTime() - representedAsUtc);
  };
  const clockInAt = parseLocalDateTime(clockInValue);
  const clockOutAt = clockOutValue ? parseLocalDateTime(clockOutValue) : null;
  if (!clockInAt || (clockOutValue && !clockOutAt)) fail(backTo, "Format jam absensi tidak valid.");
  if (clockOutAt && clockOutAt <= clockInAt) fail(backTo, "Jam clock out harus setelah clock in.");

  const [entry] = await db.select().from(timeEntries).where(and(
    eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id), isNull(timeEntries.deletedAt),
  )).limit(1);
  if (!entry) fail(backTo, "Absensi tidak ditemukan.");

  const workDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: org.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(clockInAt);
  await db.transaction(async (tx) => {
    await tx.update(timeEntries).set({ clockInAt, clockOutAt, workDate })
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id)));
    if (entry.status === "approved") {
      const result = await accrueForEntry(tx, { orgId: org.id, entryId, userId: user.id });
      if (!result.ok) throw new Error(result.message);
    }
  });
  await audit({ orgId: org.id, actorId: user.id, entity: "time_entries", entityId: entryId,
    action: "edit_time", diff: { clockInAt: { from: entry.clockInAt, to: clockInAt },
      clockOutAt: { from: entry.clockOutAt, to: clockOutAt }, workDate: { from: entry.workDate, to: workDate } } });
  revalidatePath("/admin/absensi");
  revalidatePath("/admin/payroll");
  revalidatePath("/employee");
  revalidatePath("/employee/absensi");
  ok(backTo, "Jam absensi diperbarui.");
}

/** Tandai absensi terhapus dan pulihkan saldo bila sebelumnya sudah approved. */
export async function deleteTimeEntryAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const entryId = str(formData, "entryId");
  const backTo = adminPath(formData, "backTo", "/admin/absensi");
  const [entry] = await db.select().from(timeEntries).where(and(
    eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id), isNull(timeEntries.deletedAt),
  )).limit(1);
  if (!entry) fail(backTo, "Absensi tidak ditemukan.");

  await db.transaction(async (tx) => {
    if (entry.status === "approved") await reverseAccrual(tx, org.id, entryId);
    await tx.update(timeEntries).set({ deletedAt: new Date() })
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, org.id)));
  });
  await audit({ orgId: org.id, actorId: user.id, entity: "time_entries", entityId: entryId,
    action: "soft_delete", diff: { workDate: entry.workDate, status: entry.status } });
  revalidatePath("/admin/absensi");
  revalidatePath("/admin/payroll");
  revalidatePath("/admin/saldo");
  revalidatePath("/employee");
  revalidatePath("/employee/absensi");
  ok(backTo, "Absensi dihapus.");
}

/* -------------------------------- saldo ------------------------------- */

/** Owner mengirim uang ke karyawan (menambah saldo). */
export async function topUpSaldoAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = str(formData, "backTo") || "/admin/saldo";
  const amount = parseMoneyInput(formData.get("amount"));
  const occurredAt = str(formData, "occurredAt") || localDateString(new Date(), org.timezone);

  if (!employeeId) fail(backTo, "Pilih karyawan.");
  if (!(await requireOrgEmployee(db, org.id, employeeId))) fail(backTo, "Karyawan tidak ditemukan.");
  if (amount <= 0) fail(backTo, "Nominal top up harus lebih dari 0.");

  await db.transaction(async (tx) => {
    await topUpSaldo(tx, {
      orgId: org.id,
      employeeId,
      amount,
      occurredAt,
      note: optionalStr(formData, "note"),
      userId: user.id,
    });
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "wage_floats",
    entityId: employeeId,
    action: "topup",
    diff: { amount, occurredAt },
  });

  revalidatePath("/admin/saldo");
  revalidatePath(`/admin/karyawan/${employeeId}`);
  revalidatePath("/employee");
  revalidatePath("/employee/saldo");
  ok(backTo, "Saldo ditambahkan.");
}

/** Koreksi manual saldo (boleh minus) — mis. uang dikirim tunai tanpa catatan. */
export async function adjustSaldoAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = str(formData, "backTo") || "/admin/saldo";
  const direction = str(formData, "direction") === "out" ? -1 : 1;
  const nominal = Math.abs(parseMoneyInput(formData.get("amount")));
  const occurredAt = str(formData, "occurredAt") || localDateString(new Date(), org.timezone);

  if (!employeeId) fail(backTo, "Pilih karyawan.");
  if (!(await requireOrgEmployee(db, org.id, employeeId))) fail(backTo, "Karyawan tidak ditemukan.");
  if (nominal <= 0) fail(backTo, "Nominal koreksi harus lebih dari 0.");

  const amount = direction * nominal;

  await db.transaction(async (tx) => {
    await adjustSaldo(tx, {
      orgId: org.id,
      employeeId,
      amount,
      occurredAt,
      note: optionalStr(formData, "note"),
      userId: user.id,
    });
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "wage_floats",
    entityId: employeeId,
    action: "adjust",
    diff: { amount, occurredAt },
  });

  revalidatePath("/admin/saldo");
  revalidatePath(`/admin/karyawan/${employeeId}`);
  revalidatePath("/employee/saldo");
  ok(backTo, "Saldo dikoreksi.");
}

/**
 * Hitung ulang accrual semua absensi approved milik satu karyawan.
 * Dipakai setelah top up pertama: absensi yang sudah di-approve sebelum saldo dibuat
 * belum memotong apa pun.
 */
export async function resyncSaldoAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const employeeId = str(formData, "employeeId");
  const backTo = str(formData, "backTo") || "/admin/saldo";

  if (!(await requireOrgEmployee(db, org.id, employeeId))) fail(backTo, "Karyawan tidak ditemukan.");

  const entries = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, org.id), eq(timeEntries.employeeId, employeeId), eq(timeEntries.status, "approved"), isNull(timeEntries.deletedAt)));

  let total = 0;
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const result = await accrueForEntry(tx, { orgId: org.id, entryId: entry.id, userId: user.id });
      if (result.ok) total += result.amount;
    }
  });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "wage_floats",
    entityId: employeeId,
    action: "resync",
    diff: { entries: entries.length, total },
  });

  revalidatePath("/admin/saldo");
  ok(backTo, `Saldo disinkronkan dari ${entries.length} absensi approved.`);
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
  if (employeeId && !(await requireOrgEmployee(db, org.id, employeeId))) {
    fail("/admin/tugas", "Karyawan tidak ditemukan.");
  }

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

export async function updateTaskAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const taskId = str(formData, "taskId");
  const title = str(formData, "title");
  const employeeId = optionalStr(formData, "employeeId");
  const qty = Number(str(formData, "qty")) || 1;
  const unit = str(formData, "unit") || "tugas";
  const unitRate = parseMoneyInput(formData.get("unitRate"));
  const workDate = str(formData, "workDate");
  const description = optionalStr(formData, "description");

  if (!title) fail(`/admin/tugas/${taskId}`, "Judul tugas wajib diisi.");
  if (unitRate <= 0) fail(`/admin/tugas/${taskId}`, "Tarif per unit harus lebih dari 0.");
  if (!workDate) fail(`/admin/tugas/${taskId}`, "Tanggal kerja wajib diisi.");
  if (employeeId) {
    const employee = await requireOrgEmployee(db, org.id, employeeId);
    if (!employee) fail(`/admin/tugas/${taskId}`, "Karyawan tidak ditemukan.");
  }
  const [task] = await db.select({ id: workTasks.id, title: workTasks.title }).from(workTasks)
    .where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id))).limit(1);
  if (!task) fail("/admin/tugas", "Tugas tidak ditemukan.");

  await db.update(workTasks).set({ employeeId, title, description, qty: qty.toString(), unit,
    unitRate: unitRate.toString(), workDate }).where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id)));
  await audit({ orgId: org.id, actorId: user.id, entity: "work_tasks", entityId: taskId,
    action: "update", diff: { title, qty, unitRate } });
  revalidatePath("/admin/tugas");
  revalidatePath(`/admin/tugas/${taskId}`);
  ok("/admin/tugas", "Tugas diperbarui.");
}

export async function deleteTaskAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const taskId = str(formData, "taskId");
  const [task] = await db.select({ id: workTasks.id, title: workTasks.title }).from(workTasks)
    .where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id))).limit(1);
  if (!task) fail("/admin/tugas", "Tugas tidak ditemukan.");
  await db.delete(workTasks).where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id)));
  await audit({ orgId: org.id, actorId: user.id, entity: "work_tasks", entityId: taskId,
    action: "delete", diff: { title: task.title } });
  revalidatePath("/admin/tugas");
  revalidatePath("/employee/tugas");
  ok("/admin/tugas", "Tugas dihapus.");
}

export async function decideTaskAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const taskId = str(formData, "taskId");
  const decision = str(formData, "decision");
  // Pengajuan karyawan datang tanpa harga: admin mengisi tarifnya di form yang sama.
  const unitRate = parseMoneyInput(formData.get("unitRate"));

  const [task] = await db
    .select({ id: workTasks.id, unitRate: workTasks.unitRate })
    .from(workTasks)
    .where(and(eq(workTasks.id, taskId), eq(workTasks.orgId, org.id)))
    .limit(1);

  if (!task) fail("/admin/tugas", "Tugas tidak ditemukan.");

  const finalRate = unitRate > 0 ? unitRate : toNumber(task.unitRate);
  if (decision === "approve" && finalRate <= 0) {
    fail("/admin/tugas", "Isi harga tugas dulu sebelum disetujui.");
  }

  await db
    .update(workTasks)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      ...(unitRate > 0 ? { unitRate: unitRate.toString() } : {}),
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
    diff: { unitRate: finalRate },
  });

  revalidatePath("/admin/tugas");
  revalidatePath("/employee/tugas");
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
  if (!(await requireOrgEmployee(db, org.id, employeeId))) fail(backTo, "Karyawan tidak ditemukan.");
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

  if (decision !== "approve" && decision !== "reject") fail("/admin/kasbon", "Keputusan tidak valid.");

  const [advance] = await db
    .select()
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, advanceId), eq(cashAdvances.orgId, org.id)))
    .limit(1);

  if (!advance) fail("/admin/kasbon", "Kasbon tidak ditemukan.");
  if (advance.status !== "pending") fail("/admin/kasbon", "Kasbon sudah diputuskan.");

  // Kondisi status dijaga di dalam transaksi supaya submit ganda / dua admin tidak
  // mencairkan kasbon dua kali.
  let decided = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cashAdvances)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        approvedBy: user.id,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(cashAdvances.id, advanceId),
          eq(cashAdvances.orgId, org.id),
          eq(cashAdvances.status, "pending"),
        ),
      )
      .returning({ id: cashAdvances.id });

    // Tidak ada baris yang cocok = sudah diputuskan admin lain; jangan cairkan uangnya.
    if (!updated) return;
    decided = true;

    if (decision === "approve") {
      await tx.insert(cashAdvanceTxns).values({
        cashAdvanceId: advanceId,
        kind: "disburse",
        amount: advance.principal,
        occurredAt: advance.requestedAt,
        note: "Pencairan kasbon",
        createdBy: user.id,
      });
    }
  });

  if (!decided) fail("/admin/kasbon", "Kasbon sudah diputuskan.");

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

/**
 * Pindahkan sisa kasbon (sebagian/seluruhnya) ke saldo karyawan.
 * Saldo karyawan bertambah, sisa kasbon berkurang; pelunasan berikutnya lewat
 * potongan kehadiran, bukan potongan slip.
 */
export async function transferAdvanceToSaldoAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const advanceId = str(formData, "advanceId");
  const amount = parseMoneyInput(formData.get("amount"));
  const backTo = "/admin/kasbon";

  let employeeId: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await db.transaction(async (tx) =>
      transferAdvanceToSaldo(tx, {
        orgId: org.id,
        advanceId,
        amount,
        occurredAt: localDateString(new Date(), org.timezone),
        userId: user.id,
      }),
    );
    employeeId = result.employeeId;
  } catch (error) {
    if (error instanceof SaldoTransferError) errorMessage = error.message;
    else throw error;
  }

  if (!employeeId) fail(backTo, errorMessage ?? "Kasbon tidak ditemukan.");

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "cash_advances",
    entityId: advanceId,
    action: "to_saldo",
    diff: { amount, employeeId },
  });

  revalidatePath("/admin/kasbon");
  revalidatePath("/admin/saldo");
  revalidatePath(`/admin/saldo/${employeeId}`);
  revalidatePath(`/admin/karyawan/${employeeId}`);
  revalidatePath("/employee");
  revalidatePath("/employee/saldo");
  revalidatePath("/employee/kasbon");
  ok(backTo, "Kasbon dipindah ke saldo.");
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
        saldoCovered: row.saldo.covered.toString(),
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
        .where(and(eq(cashAdvances.id, line.sourceId), eq(cashAdvances.orgId, input.orgId)));
    }

    // Saldo prabayar: kalau saldo tidak cukup menutup upah periode ini, kekurangannya
    // diserahkan tunai bersama slip dan dicatat sebagai pelunasan supaya saldo
    // kembali ke 0 (tanpa ini saldo akan minus selamanya).
    if (row.saldo.active && row.saldo.shortfall > 0) {
      await settleShortfall(tx, {
        orgId: input.orgId,
        employeeId: row.employee.id,
        payslipId: slip.id,
        amount: row.saldo.shortfall,
        occurredAt: input.periodEnd,
        userId: input.userId,
      });
    }
  }
}

/** Kembalikan saldo kasbon yang sempat dipotong oleh slip periode ini. */
async function revertPayrollSettlements(tx: Tx, orgId: string, periodId: string) {
  const slips = await tx
    .select({ id: payslips.id })
    .from(payslips)
    .where(and(eq(payslips.payPeriodId, periodId), eq(payslips.orgId, orgId)));

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
      .where(and(eq(cashAdvances.id, repayment.cashAdvanceId), eq(cashAdvances.orgId, orgId)));
    await tx.delete(cashAdvanceTxns).where(eq(cashAdvanceTxns.id, repayment.id));
  }

  // Pelunasan tunai kekurangan saldo ikut dibatalkan: slip akan dihitung ulang.
  await revertSettlements(tx, orgId, slipIds);
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
 * Rentang cuti yang bertumpuk dengan cuti pending/disetujui milik karyawan yang sama.
 * `exceptId` dipakai saat mengubah cuti supaya barisnya sendiri tidak dianggap bentrok.
 */
async function findLeaveOverlap(
  orgId: string,
  employeeId: string,
  startDate: string,
  endDate: string,
  exceptId?: string,
): Promise<{ id: string; startDate: string; endDate: string } | undefined> {
  const rows = await db
    .select({ id: leaves.id, startDate: leaves.startDate, endDate: leaves.endDate })
    .from(leaves)
    .where(
      and(
        eq(leaves.orgId, orgId),
        eq(leaves.employeeId, employeeId),
        inArray(leaves.status, ["pending", "approved"]),
        lte(leaves.startDate, endDate),
        gte(leaves.endDate, startDate),
      ),
    );

  return rows.find((row) => row.id !== exceptId);
}

function overlapMessage(row: { startDate: string; endDate: string }): string {
  return `Sudah ada cuti pending/disetujui di ${formatDateID(row.startDate)} – ${formatDateID(row.endDate)}.`;
}

/**
 * Admin mencatat cuti langsung (langsung disetujui).
 * `backTo` = halaman form (tujuan error), `successTo` = daftar/tab asal (tujuan sukses).
 */
export async function createLeaveAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const backTo = adminPath(formData, "backTo", "/admin/cuti/baru");
  const successTo = adminPath(formData, "successTo", "/admin/cuti");
  const employeeId = str(formData, "employeeId");

  const employee = await requireOrgEmployee(db, org.id, employeeId);

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

  const overlap = await findLeaveOverlap(org.id, employee.id, startDate, endDate);
  if (overlap) fail(backTo, overlapMessage(overlap));

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
  ok(successTo, `Cuti ${days} hari dicatat untuk ${employee.fullName}.`);
}

/** Admin mengubah cuti yang sudah ada: tanggal, jenis, upah, dan catatan. */
export async function updateLeaveAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const leaveId = str(formData, "leaveId");
  const backTo = adminPath(formData, "backTo", `/admin/cuti/${leaveId}`);
  const successTo = adminPath(formData, "successTo", "/admin/cuti");

  const [row] = await db
    .select({ leave: leaves, payType: employees.payType, fullName: employees.fullName })
    .from(leaves)
    .innerJoin(employees, eq(leaves.employeeId, employees.id))
    .where(and(eq(leaves.id, leaveId), eq(leaves.orgId, org.id)))
    .limit(1);

  if (!row) fail("/admin/cuti", "Cuti tidak ditemukan.");
  if (row.payType !== "monthly") {
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

  const overlap = await findLeaveOverlap(org.id, row.leave.employeeId, startDate, endDate, row.leave.id);
  if (overlap) fail(backTo, overlapMessage(overlap));

  const kind = normalizeLeaveKind(str(formData, "kind"));
  const paid = str(formData, "paid") !== "0";
  const note = str(formData, "note") || null;

  await db
    .update(leaves)
    .set({ kind, startDate, endDate, days, paid, note })
    .where(eq(leaves.id, row.leave.id));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "leaves",
    entityId: row.leave.id,
    action: "updated",
    diff: {
      before: {
        kind: row.leave.kind,
        startDate: row.leave.startDate,
        endDate: row.leave.endDate,
        days: row.leave.days,
        paid: row.leave.paid,
        note: row.leave.note,
      },
      after: { kind, startDate, endDate, days, paid, note },
    },
  });

  revalidatePath("/admin/cuti");
  revalidatePath(`/admin/cuti/${row.leave.id}`);
  revalidatePath(`/admin/karyawan/${row.leave.employeeId}`);
  revalidatePath("/employee/cuti");
  ok(successTo, `Cuti ${row.fullName} diperbarui (${days} hari).`);
}

/** Admin menghapus cuti. Cuti yang sudah disetujui ikut hilang dari hitungan payroll. */
export async function deleteLeaveAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const leaveId = str(formData, "leaveId");
  const backTo = adminPath(formData, "backTo", "/admin/cuti");

  const [row] = await db
    .select({ leave: leaves, fullName: employees.fullName })
    .from(leaves)
    .innerJoin(employees, eq(leaves.employeeId, employees.id))
    .where(and(eq(leaves.id, leaveId), eq(leaves.orgId, org.id)))
    .limit(1);

  if (!row) fail("/admin/cuti", "Cuti tidak ditemukan.");

  await db.delete(leaves).where(eq(leaves.id, row.leave.id));

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "leaves",
    entityId: row.leave.id,
    action: "deleted",
    diff: {
      employeeId: row.leave.employeeId,
      kind: row.leave.kind,
      startDate: row.leave.startDate,
      endDate: row.leave.endDate,
      days: row.leave.days,
      paid: row.leave.paid,
      status: row.leave.status,
    },
  });

  revalidatePath("/admin/cuti");
  revalidatePath(`/admin/karyawan/${row.leave.employeeId}`);
  revalidatePath("/employee/cuti");
  ok(backTo, `Cuti ${row.fullName} dihapus.`);
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

  if (
    !periodStart ||
    !periodEnd ||
    periodEnd < periodStart ||
    !DATE_ONLY.test(periodStart) ||
    !DATE_ONLY.test(periodEnd)
  ) {
    fail("/admin/payroll", "Rentang periode tidak valid.");
  }

  // Indeks unik (org_id, period_start): baris void pun tetap menempati tanggal mulai ini.
  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(and(eq(payPeriods.orgId, org.id), eq(payPeriods.periodStart, periodStart)))
    .limit(1);

  if (existing) fail("/admin/payroll", "Periode ini sudah pernah dihitung.");

  // Rentang yang beririsan walau tanggal mulainya beda (mis. setelah tanggal mulai periode diubah).
  const [overlapping] = await db
    .select({ periodStart: payPeriods.periodStart, periodEnd: payPeriods.periodEnd })
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.orgId, org.id),
        ne(payPeriods.status, "void"),
        lte(payPeriods.periodStart, periodEnd),
        gte(payPeriods.periodEnd, periodStart),
      ),
    )
    .limit(1);

  if (overlapping) {
    fail(
      "/admin/payroll",
      `Periode ${formatDateID(periodStart)}–${formatDateID(periodEnd)} beririsan dengan periode ${formatDateID(overlapping.periodStart)}–${formatDateID(overlapping.periodEnd)} yang sudah dihitung. Pilih periode yang tidak beririsan.`,
    );
  }

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

  const payable = await db.transaction(async (tx) => {
    await revertPayrollSettlements(tx, org.id, periodId);

    // Re-read kasbon after restoring this draft's repayments. Fully paid advances
    // must be eligible for the replacement preview before their balances are cut again.
    const preview = await previewPayroll(
      org.id,
      { start: period.periodStart, end: period.periodEnd },
      { overtimeMultiplier: toNumber(org.overtimeMultiplier) },
      tx,
    );
    const rows = preview.rows.filter((row) => row.computation.lines.length > 0);

    await tx.delete(payslips).where(eq(payslips.payPeriodId, periodId));

    await writePayrollSlips(tx, {
      orgId: org.id,
      periodId,
      periodEnd: period.periodEnd,
      userId: user.id,
      rows,
    });

    return rows;
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
    await revertPayrollSettlements(tx, org.id, periodId);
    await tx.delete(payPeriods).where(eq(payPeriods.id, periodId));
  });

  revalidatePath("/admin/payroll");
  ok("/admin/payroll", "Draft payroll dihapus.");
}
