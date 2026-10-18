"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, memberships } from "@/db/schema";
import { getSession, isAdminRole } from "@/lib/session";

/** Tab yang dipilih di halaman masuk. */
export type LoginMode = "employee" | "owner";

export type LoginGate =
  | { ok: true; href: string }
  | { ok: false; message: string };

/**
 * Setelah kredensial valid, tentukan apakah role akun cocok dengan tab yang dipilih.
 *
 * Login-nya tetap satu pintu (HP + PIN), tapi tab menentukan ekspektasi role:
 * tab Karyawan hanya untuk akun staff, tab Owner hanya untuk owner/admin.
 * Dipanggil dari klien agar pesan salah-tab bisa ditampilkan sebelum redirect.
 */
export async function resolveLoginGate(mode: LoginMode): Promise<LoginGate> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, message: "Sesi tidak ditemukan. Coba masuk lagi." };
  }

  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, session.user.id));

  if (rows.length === 0) {
    return {
      ok: false,
      message: "Nomor HP ini belum terhubung ke perusahaan mana pun. Minta admin menambahkanmu.",
    };
  }

  const adminRows = rows.filter((row) => isAdminRole(row.role));
  const staffRows = rows.filter((row) => !isAdminRole(row.role));

  if (mode === "owner") {
    if (adminRows.length === 0) {
      return {
        ok: false,
        message: "Nomor HP ini terdaftar sebagai karyawan. Masuk lewat tab Karyawan.",
      };
    }
    return { ok: true, href: "/admin" };
  }

  // Owner yang juga punya data karyawan (mis. ikut absen) tetap boleh masuk tab ini.
  const [employeeRow] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.userId, session.user.id))
    .limit(1);

  if (staffRows.length === 0 && !employeeRow) {
    return {
      ok: false,
      message: "Nomor HP ini terdaftar sebagai owner/admin. Masuk lewat tab Owner.",
    };
  }

  return { ok: true, href: "/employee" };
}
