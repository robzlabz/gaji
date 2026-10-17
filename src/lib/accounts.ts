import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { normalizePhone } from "@/lib/format";

export class AccountError extends Error {}

/**
 * Membuat user dengan kredensial nomor HP + PIN 6 digit.
 * PIN disimpan sebagai password Better Auth (scrypt), bukan plaintext.
 */
export async function createCredentialUser(input: {
  name: string;
  phone: string;
  pin: string;
  email?: string | null;
}): Promise<{ userId: string; phone: string }> {
  const phone = normalizePhone(input.phone);
  if (!/^62\d{8,15}$/.test(phone)) throw new AccountError("Nomor HP tidak valid.");
  if (!/^\d{6}$/.test(input.pin)) throw new AccountError("PIN harus 6 digit angka.");

  const email = input.email?.trim() || `${phone}@pin.gaji.local`;

  try {
    const result = await auth.api.signUpEmail({
      body: { email, password: input.pin, name: input.name },
    });
    if (!result?.user?.id) throw new AccountError("Gagal membuat akun.");

    await db
      .update(user)
      .set({ phoneNumber: phone, phoneNumberVerified: true, updatedAt: new Date() })
      .where(eq(user.id, result.user.id));

    return { userId: result.user.id, phone };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|unique|duplicate/i.test(message)) {
      throw new AccountError("Nomor HP atau email sudah terdaftar.");
    }
    throw new AccountError(message);
  }
}

/** Ganti PIN karyawan. */
export async function setPin(userId: string, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new AccountError("PIN harus 6 digit angka.");
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(pin);
  const updated = await db
    .update(account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .returning({ id: account.id });

  if (updated.length === 0) throw new AccountError("Akun kredensial tidak ditemukan.");
}
