"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cashAdvances, timeEntries, workTasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireEmployee } from "@/lib/session";
import { localDateString, parseMoneyInput } from "@/lib/utils";

function fail(path: string, message: string): never {
  redirect(`${path}?err=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
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
    diff: { lat, lng, withinGeofence, hasPhoto: Boolean(photo) },
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
      outLat: lat,
      outLng: lng,
      outPhoto: typeof photo === "string" && photo.startsWith("data:image") ? photo : null,
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

export async function requestAdvanceAction(formData: FormData) {
  const { org, employee } = await requireEmployee();
  const principal = parseMoneyInput(formData.get("principal"));
  const note = formData.get("note");

  if (principal <= 0) fail("/employee/kasbon", "Nominal kasbon harus lebih dari 0.");
  if (principal > 50_000_000) fail("/employee/kasbon", "Nominal terlalu besar, hubungi admin.");

  const [advance] = await db
    .insert(cashAdvances)
    .values({
      orgId: org.id,
      employeeId: employee.id,
      principal: principal.toString(),
      balance: principal.toString(),
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
    diff: { principal },
  });

  revalidatePath("/employee/kasbon");
  ok("/employee/kasbon", "Pengajuan kasbon dikirim ke admin.");
}
