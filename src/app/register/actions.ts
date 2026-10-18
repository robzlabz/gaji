"use server";

import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { memberships, organizations, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ORG_COOKIE, getSession } from "@/lib/session";

export type RegisterResult = { ok: true; orgId: string } | { ok: false; message: string };
export type CheckResult = { ok: true } | { ok: false; message: string };

const PHONE_RE = /^\d{8,15}$/;

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "perusahaan";
}

async function uniqueSlug(desired: string): Promise<string> {
  let slug = desired;
  for (let i = 2; i <= 50; i += 1) {
    const [taken] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (!taken) return slug;
    slug = `${desired}-${i}`;
  }
  return `${desired}-${Date.now().toString(36)}`;
}

/** Dipanggil sebelum signup: nomor HP tidak boleh sudah dipakai akun lain. */
export async function checkPhoneAvailable(phone: string): Promise<CheckResult> {
  if (!PHONE_RE.test(phone)) {
    return { ok: false, message: "Nomor HP tidak valid." };
  }
  const [taken] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.phoneNumber, phone))
    .limit(1);
  if (taken) {
    return {
      ok: false,
      message: "Nomor HP ini sudah terdaftar. Masuk lewat halaman masuk.",
    };
  }
  return { ok: true };
}

/**
 * Setelah akun dibuat (signUp.email), lengkapi profil owner:
 * nomor HP, organisasi baru, dan membership role `owner`.
 */
export async function provisionOwnerAccount(input: {
  phone: string;
  orgName: string;
}): Promise<RegisterResult> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, message: "Sesi tidak ditemukan. Coba daftar ulang." };
  }

  const phone = input.phone.trim();
  const orgName = input.orgName.trim();

  if (!PHONE_RE.test(phone)) {
    return { ok: false, message: "Nomor HP tidak valid." };
  }
  if (orgName.length < 2) {
    return { ok: false, message: "Nama perusahaan minimal 2 karakter." };
  }

  const [takenByOther] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.phoneNumber, phone), ne(user.id, session.user.id)))
    .limit(1);
  if (takenByOther) {
    return { ok: false, message: "Nomor HP ini sudah dipakai akun lain." };
  }

  try {
    await db
      .update(user)
      .set({ phoneNumber: phone, phoneNumberVerified: true, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));
  } catch (error) {
    // 23505 = unique_violation (user_phone_uniq): dua pendaftaran bersamaan.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "Nomor HP ini sudah dipakai akun lain." };
    }
    throw error;
  }

  const slug = await uniqueSlug(slugify(orgName));

  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: orgName, slug }).returning();
    await tx.insert(memberships).values({
      orgId: org.id,
      userId: session.user.id,
      role: "owner",
    });
    return org.id;
  });

  await audit({
    orgId,
    actorId: session.user.id,
    entity: "organization",
    entityId: orgId,
    action: "create",
    diff: { name: orgName, slug, via: "register" },
  });

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });

  return { ok: true, orgId };
}
