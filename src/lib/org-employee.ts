import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Koneksi: pool utama atau transaksi yang sedang berjalan. */
type Conn = Tx | typeof db;

/**
 * Ambil karyawan hanya bila memang milik organisasi aktif.
 *
 * Semua id yang datang dari form harus lewat sini sebelum dipakai untuk menulis:
 * id milik organisasi lain diperlakukan sama dengan id yang tidak ada.
 */
export async function requireOrgEmployee(
  conn: Conn,
  orgId: string,
  employeeId: string,
) {
  if (!employeeId) return null;

  const [employee] = await conn
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)))
    .limit(1);

  return employee ?? null;
}
