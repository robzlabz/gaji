import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireOrg, ORG_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const { org, allMemberships } = await requireOrg();
  const body = (await request.json().catch(() => ({}))) as { orgId?: string };
  const orgId = body.orgId;

  if (!orgId || !allMemberships.some((row) => row.membership.orgId === orgId)) {
    return NextResponse.json({ ok: false, error: "Organisasi tidak diikuti." }, { status: 400 });
  }

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });

  return NextResponse.json({ ok: true, from: org.id });
}
