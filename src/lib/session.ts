import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { employees, memberships, organizations } from "@/db/schema";
import { auth } from "@/lib/auth";

export const ORG_COOKIE = "gaji_org";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
};

export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    phoneNumber: (session.user as { phoneNumber?: string | null }).phoneNumber ?? null,
  };
}

export type MembershipRow = typeof memberships.$inferSelect;
export type OrgRow = typeof organizations.$inferSelect;

export type OrgContext = {
  user: SessionUser;
  org: OrgRow;
  membership: MembershipRow;
  allMemberships: Array<{ membership: MembershipRow; org: OrgRow }>;
};

/** Konteks tenant aktif: membership + organisasi. Cookie hanya boleh memilih org yang memang diikuti. */
export async function requireOrg(): Promise<OrgContext> {
  const user = await requireSession();

  const rows = await db
    .select({ membership: memberships, org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, user.id))
    // Urutan wajib deterministik: tanpa ini org aktif bisa berganti-ganti antar request
    // ketika user punya lebih dari satu membership dan cookie belum diset.
    .orderBy(memberships.createdAt, organizations.id);

  if (rows.length === 0) redirect("/no-access");

  const cookieStore = await cookies();
  const wanted = cookieStore.get(ORG_COOKIE)?.value;
  const active = rows.find((row) => row.membership.orgId === wanted) ?? rows[0];

  return {
    user,
    org: active.org,
    membership: active.membership,
    allMemberships: rows,
  };
}

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Guard dashboard admin (/admin/*). Karyawan murni dilempar ke /employee. */
export async function requireAdmin(): Promise<OrgContext> {
  const ctx = await requireOrg();
  if (!isAdminRole(ctx.membership.role)) redirect("/employee");
  return ctx;
}

export type EmployeeContext = OrgContext & {
  employee: typeof employees.$inferSelect;
};

/** Guard dashboard karyawan (/employee/*). */
export async function requireEmployee(): Promise<EmployeeContext> {
  const ctx = await requireOrg();

  const [employee] = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.orgId, ctx.org.id),
        eq(employees.userId, ctx.user.id),
        // Karyawan nonaktif diperlakukan sama seperti tidak punya baris karyawan:
        // akses dashboard karyawan ikut dicabut, bukan hanya disembunyikan di UI.
        eq(employees.isActive, true),
      ),
    )
    .limit(1);

  if (!employee) {
    if (isAdminRole(ctx.membership.role)) redirect("/admin");
    redirect("/no-access");
  }

  return { ...ctx, employee };
}
