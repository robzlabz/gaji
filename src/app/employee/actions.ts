"use server";

import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cashAdvances, leaves, timeEntries, workTasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { PlanError, resolvePlanPeriod, saveAdvancePlan } from "@/lib/kasbon-server";
import { leaveWorkDays, normalizeLeaveKind } from "@/lib/leave";
import { isTaskEditable } from "@/lib/task";
import { requireEmployee } from "@/lib/session";
import { localDateString, parseMoneyInput, toNumber } from "@/lib/format";

function fail(path: string, message: string): never {
  redirect(`${path}?err=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
}

function str(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberField(fd: FormData, key: string): number | null {
  const raw = fd.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function clockInAction(formData: FormData) {
  const { org, employee } = await requireEmployee();

  const [open] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeId, employee.id), isNull(timeEntries.clockOutAt)))
    .limit(1);

  if (open) fail("/employee", "Kamu masih clock in. Clock out dulu sebelum mulai sesi baru.");

  const lat = numberField(formData, "lat");
  const lng = numberField(formData, "lng");
  const accuracy = numberField(formData, "accuracy");
  const photo = formData.get("photo");
  // Ongkos kedatangan boleh diisi karyawan sendiri (mis. beda ongkos kalau naik motor
  // vs ojek). Kalau field tidak dikirim, pakai tarif default karyawan.
  const rawTransport = formData.get("transportAmount");
  const transportAmount = Math.max(
    0,
    Math.round(
      typeof rawTransport === "string" && rawTransport.trim() !== ""
        ? parseMoneyInput(rawTransport)
        : toNumber(employee.transportRate),
    ),
  );

  let withinGeofence: boolean | null = null;
  if (
    lat !== null &&
    lng !== null &&
    org.geofenceLat !== null &&
    org.geofenceLng !== null &&
    org.geofenceRadiusM
  ) {
    withinGeofence =
      distanceMeters(lat, lng, org.geofenceLat, org.geofenceLng) <= org.geofenceRadiusM;
  }

  const now = new Date();
  const [entry] = await db
    .insert(timeEntries)
    .values({
      orgId: org.id,
      employeeId: employee.id,
      workDate: localDateString(now, org.timezone),
      clockInAt: now,
      inLat: lat,
      inLng: lng,
      inAccuracyM: accuracy,
      inPhoto: typeof photo === "string" && photo.startsWith("data:image") ? photo : null,
      withinGeofence,
      transportAmount: transportAmount.toString(),
      source: "pwa",
      status: "pending",
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "time_entries",
    entityId: entry.id,
    action: "clock_in",
    diff: { lat, lng, withinGeofence, hasPhoto: Boolean(photo), transportAmount },
  });

  revalidatePath("/employee");
  ok("/employee", "Clock in tercatat.");
}

export async function clockOutAction(formData: FormData) {
  const { org, employee } = await requireEmployee();

  const [open] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeId, employee.id), isNull(timeEntries.clockOutAt)))
    .limit(1);

  if (!open) fail("/employee", "Tidak ada sesi terbuka. Clock in dulu.");

  const breakMinutes = numberField(formData, "breakMinutes");
  const overtimeMinutes = numberField(formData, "overtimeMinutes");
  const overtimeNote = formData.get("overtimeNote");
  const lat = numberField(formData, "lat");
  const lng = numberField(formData, "lng");
  const photo = formData.get("photo");
  const outPhoto =
    typeof photo === "string" && photo.startsWith("data:image") ? photo : null;

  await db
    .update(timeEntries)
    .set({
      clockOutAt: new Date(),
      breakMinutes: breakMinutes !== null && breakMinutes >= 0 ? Math.round(breakMinutes) : open.breakMinutes,
      overtimeMinutes:
        overtimeMinutes !== null && overtimeMinutes >= 0
          ? Math.round(overtimeMinutes)
          : open.overtimeMinutes,
      overtimeNote:
        typeof overtimeNote === "string" && overtimeNote.trim() !== ""
          ? overtimeNote.trim()
          : open.overtimeNote,
      // Foto/lokasi yang sudah tersimpan otomatis tidak boleh terhapus hanya karena
      // form clock-out dikirim tanpa lampiran baru (mis. halaman sudah di-refresh).
      outLat: lat ?? open.outLat,
      outLng: lng ?? open.outLng,
      outPhoto: outPhoto ?? open.outPhoto,
    })
    .where(eq(timeEntries.id, open.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "time_entries",
    entityId: open.id,
    action: "clock_out",
    diff: { breakMinutes, overtimeMinutes },
  });

  revalidatePath("/employee");
  ok("/employee", "Clock out tercatat. Menunggu approval admin.");
}

/**
 * Auto-save foto/lokasi ke sesi absensi yang sedang terbuka.
 *
 * Karyawan yang sudah clock in tidak perlu menekan tombol apa pun lagi: begitu foto
 * diunggah atau lokasi didapat, nilainya langsung ditulis ke baris time_entries.
 * Kalau belum clock in, foto/lokasi tetap di memori komponen dan baru tersimpan
 * saat clock in ditekan (lihat clockInAction).
 */
export async function saveCaptureAction(input: {
  photo?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: boolean; message: string }> {
  const { org, employee } = await requireEmployee();

  const [open] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeId, employee.id), isNull(timeEntries.clockOutAt)))
    .limit(1);

  if (!open) {
    return { ok: false, message: "Belum clock in — foto & lokasi tersimpan saat kamu clock in." };
  }

  const photo =
    typeof input.photo === "string" && input.photo.startsWith("data:image") ? input.photo : null;
  const lat = typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : null;
  const lng = typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : null;

  if (!photo && (lat === null || lng === null)) {
    return { ok: false, message: "Tidak ada foto atau lokasi yang bisa disimpan." };
  }

  await db
    .update(timeEntries)
    .set({
      outPhoto: photo ?? open.outPhoto,
      outLat: lat ?? open.outLat,
      outLng: lng ?? open.outLng,
    })
    .where(eq(timeEntries.id, open.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "time_entries",
    entityId: open.id,
    action: "capture",
    diff: { hasPhoto: Boolean(photo), lat, lng },
  });

  const saved = [photo ? "Foto" : null, lat !== null && lng !== null ? "Lokasi" : null]
    .filter(Boolean)
    .join(" & ");

  return { ok: true, message: `${saved} tersimpan otomatis.` };
}

export async function markTaskDoneAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const taskId = formData.get("taskId");

  if (typeof taskId !== "string") fail("/employee/tugas", "Tugas tidak valid.");

  await db
    .update(workTasks)
    .set({ status: "done", doneAt: new Date() })
    .where(
      and(
        eq(workTasks.id, taskId),
        eq(workTasks.orgId, org.id),
        eq(workTasks.employeeId, employee.id),
        eq(workTasks.status, "open"),
      ),
    );

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "work_tasks",
    entityId: taskId,
    action: "done",
  });

  revalidatePath("/employee/tugas");
  ok("/employee/tugas", "Tugas ditandai selesai, menunggu approval.");
}

const TASK_LIST = "/employee/tugas";

/**
 * Karyawan mengajukan tugas sendiri. Harga sengaja dikosongkan (0) dan statusnya
 * `requested`: admin yang mengisi tarif sekaligus menyetujuinya, jadi pengajuan
 * tidak pernah langsung masuk payroll.
 */
export async function submitTaskAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const formPath = `${TASK_LIST}/baru`;

  const title = str(formData, "title");
  if (!title) fail(formPath, "Judul tugas wajib diisi.");

  const qty = numberField(formData, "qty");
  if (qty === null || qty <= 0) fail(formPath, "Jumlah harus lebih dari 0.");

  const workDate = dateField(formData, "workDate") ?? localDateString(new Date(), org.timezone);

  const [task] = await db
    .insert(workTasks)
    .values({
      orgId: org.id,
      employeeId: employee.id,
      title,
      description: str(formData, "description") || null,
      qty: qty.toString(),
      unit: str(formData, "unit") || "tugas",
      // Harga diisi admin saat approval.
      unitRate: "0",
      workDate,
      status: "requested",
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "work_tasks",
    entityId: task.id,
    action: "request",
    diff: { title, qty, workDate },
  });

  revalidatePath(TASK_LIST);
  revalidatePath("/admin/tugas");
  ok(TASK_LIST, "Pengajuan tugas terkirim. Admin akan mengisi harga dan menyetujuinya.");
}

/** Karyawan memperbaiki tugas yang belum diputuskan admin. */
export async function updateTaskAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const taskId = str(formData, "taskId");
  const editPath = `${TASK_LIST}/${taskId}`;

  const [task] = await db
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.id, taskId),
        eq(workTasks.orgId, org.id),
        eq(workTasks.employeeId, employee.id),
      ),
    )
    .limit(1);

  if (!task) fail(TASK_LIST, "Tugas tidak ditemukan.");
  if (!isTaskEditable(task.status)) {
    fail(TASK_LIST, "Tugas yang sudah diputuskan admin tidak bisa diubah.");
  }

  const title = str(formData, "title");
  if (!title) fail(editPath, "Judul tugas wajib diisi.");

  const qty = numberField(formData, "qty");
  if (qty === null || qty <= 0) fail(editPath, "Jumlah harus lebih dari 0.");

  const workDate = dateField(formData, "workDate") ?? task.workDate;

  await db
    .update(workTasks)
    .set({
      title,
      description: str(formData, "description") || null,
      qty: qty.toString(),
      unit: str(formData, "unit") || "tugas",
      workDate,
    })
    .where(eq(workTasks.id, task.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "work_tasks",
    entityId: task.id,
    action: "update",
    diff: { title, qty, workDate },
  });

  revalidatePath(TASK_LIST);
  revalidatePath("/admin/tugas");
  ok(TASK_LIST, "Tugas diperbarui.");
}

const ADVANCE_LIST = "/employee/kasbon";

/**
 * Baca pilihan cara bayar dari form kasbon.
 * Checkbox "cicil" dicentang = dicicil per periode, tidak dicentang = bayar langsung (potong penuh).
 */
function advanceInstallment(formData: FormData, principal: number): number {
  const cicil = formData.get("cicil") !== null;
  if (!cicil) return 0;
  const amount = parseMoneyInput(formData.get("installmentAmount"));
  if (amount <= 0) {
    fail(`${ADVANCE_LIST}/baru`, "Isi nominal cicilan per periode, atau pilih bayar langsung.");
  }
  if (amount > principal) {
    fail(`${ADVANCE_LIST}/baru`, "Cicilan tidak boleh melebihi pokok kasbon.");
  }
  return amount;
}

export async function requestAdvanceAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const principal = parseMoneyInput(formData.get("principal"));
  const note = formData.get("note");

  if (principal <= 0) fail(`${ADVANCE_LIST}/baru`, "Nominal kasbon harus lebih dari 0.");
  if (principal > 50_000_000) {
    fail(`${ADVANCE_LIST}/baru`, "Nominal terlalu besar, hubungi admin.");
  }

  const installment = advanceInstallment(formData, principal);

  const [advance] = await db
    .insert(cashAdvances)
    .values({
      orgId: org.id,
      employeeId: employee.id,
      principal: principal.toString(),
      balance: principal.toString(),
      installmentAmount: installment > 0 ? installment.toString() : null,
      requestedAt: localDateString(new Date(), org.timezone),
      status: "pending",
      note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "cash_advances",
    entityId: advance.id,
    action: "request",
    diff: { principal, installment },
  });

  revalidatePath(ADVANCE_LIST);
  revalidatePath("/admin/kasbon");
  ok(
    ADVANCE_LIST,
    installment > 0
      ? `Pengajuan kasbon dikirim — dicicil ${installment.toLocaleString("id-ID")} per periode.`
      : "Pengajuan kasbon dikirim — dibayar langsung (potong penuh sekali).",
  );
}

/** Karyawan memperbaiki pengajuannya sendiri selama admin belum memutuskan. */
export async function updateAdvanceRequestAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const advanceId = str(formData, "advanceId");

  const [advance] = await db
    .select()
    .from(cashAdvances)
    .where(
      and(
        eq(cashAdvances.id, advanceId),
        eq(cashAdvances.orgId, org.id),
        eq(cashAdvances.employeeId, employee.id),
      ),
    )
    .limit(1);

  if (!advance) fail(ADVANCE_LIST, "Kasbon tidak ditemukan.");
  if (advance.status !== "pending") {
    fail(`${ADVANCE_LIST}/${advance.id}`, "Kasbon yang sudah diputuskan admin tidak bisa diubah.");
  }

  const principal = parseMoneyInput(formData.get("principal"));
  if (principal <= 0) fail(`${ADVANCE_LIST}/${advance.id}`, "Nominal kasbon harus lebih dari 0.");
  if (principal > 50_000_000) {
    fail(`${ADVANCE_LIST}/${advance.id}`, "Nominal terlalu besar, hubungi admin.");
  }

  const installment = advanceInstallment(formData, principal);

  await db
    .update(cashAdvances)
    .set({
      principal: principal.toString(),
      balance: principal.toString(),
      installmentAmount: installment > 0 ? installment.toString() : null,
      note: str(formData, "note") || null,
    })
    .where(eq(cashAdvances.id, advance.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "cash_advances",
    entityId: advance.id,
    action: "update_request",
    diff: { principal, installment },
  });

  revalidatePath(ADVANCE_LIST);
  revalidatePath("/admin/kasbon");
  ok(ADVANCE_LIST, "Pengajuan kasbon diperbarui.");
}

/**
 * Karyawan memilih kasbon mana yang dipotong dari gaji periode ini,
 * atau menundanya ke periode berikutnya.
 */
export async function setMyAdvancePlanAction(formData: FormData) {
  const { org, employee, user } = await requireEmployee();
  const advanceId = str(formData, "advanceId");
  const decision = str(formData, "decision") || "deduct";
  const amount = parseMoneyInput(formData.get("amount"));

  const [advance] = await db
    .select({ id: cashAdvances.id, employeeId: cashAdvances.employeeId })
    .from(cashAdvances)
    .where(and(eq(cashAdvances.id, advanceId), eq(cashAdvances.orgId, org.id)))
    .limit(1);

  if (!advance || advance.employeeId !== employee.id) {
    fail("/employee/kasbon", "Kasbon tidak ditemukan.");
  }

  const target = await resolvePlanPeriod(org, str(formData, "periodStart"));
  if (!target.ok) fail("/employee/kasbon", target.message);

  try {
    await saveAdvancePlan({
      orgId: org.id,
      advanceId,
      period: target.period,
      decision,
      amount,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof PlanError) fail("/employee/kasbon", error.message);
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

  revalidatePath("/employee/kasbon");
  revalidatePath("/admin/kasbon");
  ok(
    "/employee/kasbon",
    decision === "defer"
      ? "Kasbon ditunda ke periode gaji berikutnya."
      : "Kasbon akan dipotong pada periode ini.",
  );
}

/* ------------------------------- cuti -------------------------------- */

/** Tanggal `YYYY-MM-DD` yang benar-benar ada (menolak 2026-02-31). */
function dateField(fd: FormData, key: string): string | null {
  const value = str(fd, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

const LEAVE_LIST = "/employee/cuti";

/**
 * Validasi isi form cuti (dipakai pengajuan baru & perubahan).
 * `ignoreId` = pengajuan yang sedang diubah, supaya tidak dianggap bentrok dengan dirinya sendiri.
 */
async function validateLeave(
  formData: FormData,
  employeeId: string,
  ignoreId: string | null,
  errorTo: string,
) {
  const startDate = dateField(formData, "startDate");
  const endDate = dateField(formData, "endDate") ?? startDate;
  if (!startDate) fail(errorTo, "Tanggal mulai cuti tidak valid.");
  if (!endDate || endDate < startDate) {
    fail(errorTo, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  const days = leaveWorkDays(startDate, endDate);
  if (days === 0) fail(errorTo, "Rentang itu tidak memuat hari kerja (Senin–Sabtu).");

  const [overlap] = await db
    .select({ id: leaves.id })
    .from(leaves)
    .where(
      and(
        eq(leaves.employeeId, employeeId),
        inArray(leaves.status, ["pending", "approved"]),
        lte(leaves.startDate, endDate),
        gte(leaves.endDate, startDate),
        ignoreId ? ne(leaves.id, ignoreId) : undefined,
      ),
    )
    .limit(1);

  if (overlap) fail(errorTo, "Sudah ada pengajuan cuti di rentang tanggal itu.");

  return { startDate, endDate, days };
}

export async function requestLeaveAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const path = LEAVE_LIST;
  const formPath = `${LEAVE_LIST}/baru`;

  // Cuti hanya masuk akal untuk gaji bulanan: tipe lain dibayar dari kehadiran/tugas.
  if (employee.payType !== "monthly") {
    fail(path, "Cuti hanya berlaku untuk karyawan bulanan.");
  }

  const { startDate, endDate, days } = await validateLeave(
    formData,
    employee.id,
    null,
    formPath,
  );

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
      status: "pending",
      note: str(formData, "note") || null,
      requestedBy: employee.userId,
    })
    .returning();

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "leaves",
    entityId: row.id,
    action: "request",
    diff: { startDate, endDate, days, paid: row.paid },
  });

  revalidatePath(LEAVE_LIST);
  revalidatePath("/admin/cuti");
  ok(path, `Pengajuan cuti ${days} hari terkirim, menunggu persetujuan admin.`);
}

/** Karyawan mengubah pengajuan cutinya selama masih menunggu persetujuan. */
export async function updateLeaveAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const leaveId = str(formData, "leaveId");
  const editPath = `${LEAVE_LIST}/${leaveId}`;

  const [row] = await db
    .select()
    .from(leaves)
    .where(
      and(
        eq(leaves.id, leaveId),
        eq(leaves.orgId, org.id),
        eq(leaves.employeeId, employee.id),
      ),
    )
    .limit(1);

  if (!row) fail(LEAVE_LIST, "Pengajuan cuti tidak ditemukan.");
  if (row.status !== "pending") {
    fail(LEAVE_LIST, "Cuti yang sudah diputuskan admin tidak bisa diubah.");
  }

  const { startDate, endDate, days } = await validateLeave(
    formData,
    employee.id,
    row.id,
    editPath,
  );

  await db
    .update(leaves)
    .set({
      kind: normalizeLeaveKind(str(formData, "kind")),
      startDate,
      endDate,
      days,
      paid: str(formData, "paid") !== "0",
      note: str(formData, "note") || null,
    })
    .where(eq(leaves.id, row.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "leaves",
    entityId: row.id,
    action: "update",
    diff: { startDate, endDate, days },
  });

  revalidatePath(LEAVE_LIST);
  revalidatePath("/admin/cuti");
  ok(LEAVE_LIST, "Pengajuan cuti diperbarui.");
}

export async function cancelLeaveAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const leaveId = str(formData, "leaveId");

  const [row] = await db
    .select()
    .from(leaves)
    .where(
      and(
        eq(leaves.id, leaveId),
        eq(leaves.employeeId, employee.id),
        eq(leaves.orgId, org.id),
      ),
    )
    .limit(1);

  if (!row) fail("/employee/cuti", "Pengajuan cuti tidak ditemukan.");
  if (row.status !== "pending") {
    fail("/employee/cuti", "Hanya pengajuan yang masih menunggu yang bisa dibatalkan.");
  }

  await db
    .update(leaves)
    .set({ status: "void", rejectReason: "Dibatalkan karyawan" })
    .where(eq(leaves.id, row.id));

  await audit({
    orgId: org.id,
    actorId: employee.userId,
    entity: "leaves",
    entityId: row.id,
    action: "cancel",
    diff: { startDate: row.startDate, endDate: row.endDate },
  });

  revalidatePath("/employee/cuti");
  revalidatePath("/admin/cuti");
  ok("/employee/cuti", "Pengajuan cuti dibatalkan.");
}
