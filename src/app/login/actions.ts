"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, memberships, user } from "@/db/schema";
import { getSession, isAdminRole } from "@/lib/session";
import { ROLE_LABEL, isValidPhone, normalizePhone } from "@/lib/format";

/** Jenis akun yang dipakai untuk menentukan tujuan setelah PIN benar. */
export type AccountKind = "owner" | "employee";

export type LoginAccount =
  | {
      ok: true;
      /** Nomor ternormalisasi `<kode negara><nomor>` — dipakai lagi di langkah PIN. */
      phone: string;
      kind: AccountKind;
      /** Label yang ditampilkan di langkah PIN: "Owner", "Admin", atau "Karyawan". */
      label: string;
      name: string;
    }
  | { ok: false; message: string };

/** Pesan seragam untuk nomor yang tidak punya akun — jangan bocorkan detail lain. */
const NOT_REGISTERED =
  "Nomor HP ini tidak memiliki akun atau belum terdaftar. Pastikan nomornya benar, atau minta admin perusahaan mendaftarkanmu.";

/** Pesan seragam untuk akun tanpa akses aktif — status karyawan tidak ikut terbaca. */
const NO_ACCESS =
  "Nomor HP ini belum terhubung ke perusahaan mana pun. Minta admin menambahkanmu sebagai karyawan.";

/**
 * Langkah 1 halaman masuk: cek apakah nomor HP punya akun, tanpa meminta PIN.
 *
 * Nomor yang tidak terdaftar berhenti di sini dengan pesan "tidak memiliki akun
 * atau belum terdaftar". Nomor yang terdaftar mengembalikan label role (Owner /
 * Admin / Karyawan) supaya halaman PIN bisa menampilkan badge yang sesuai.
 */
export async function findLoginAccount(rawPhone: string, dialCode = "62"): Promise<LoginAccount> {
  const phone = normalizePhone(rawPhone, dialCode);
  if (!isValidPhone(phone, dialCode)) {
    return { ok: false, message: "Nomor HP tidak valid. Contoh: 08123456789" };
  }

  const [account] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.phoneNumber, phone))
    .limit(1);

  if (!account) return { ok: false, message: NOT_REGISTERED };

  const roleRows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, account.id));

  const [activeEmployee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.userId, account.id), eq(employees.isActive, true)))
    .limit(1);

  const adminRole = roleRows.find((row) => isAdminRole(row.role))?.role;

  // Karyawan nonaktif tidak dihitung punya akses. Pesannya disamakan dengan akun
  // tanpa akses supaya status kepegawaian tidak bisa ditebak dari halaman masuk.
  if (!adminRole && !activeEmployee) {
    return { ok: false, message: NO_ACCESS };
  }

  // Owner/admin menang atas data karyawan: owner yang ikut absen tetap masuk dashboard admin.
  const role = adminRole ?? "employee";

  return {
    ok: true,
    phone,
    kind: isAdminRole(role) ? "owner" : "employee",
    label: ROLE_LABEL[role] ?? "Karyawan",
    name: account.name,
  };
}

export type LoginGate = { ok: true; href: string } | { ok: false; message: string };

/**
 * Setelah PIN benar, tentukan dashboard tujuan dari role akun yang sebenarnya.
 *
 * Dulu tujuan ditentukan tab Karyawan/Owner yang dipilih user; sekarang nomor HP
 * sudah menentukan role-nya sendiri, jadi tidak ada lagi kemungkinan salah tab.
 */
export async function resolveLoginGate(): Promise<LoginGate> {
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

  return { ok: true, href: rows.some((row) => isAdminRole(row.role)) ? "/admin" : "/employee" };
}
