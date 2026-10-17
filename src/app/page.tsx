import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function Home() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, session.user.id));

  if (rows.length === 0) redirect("/no-access");

  const isAdmin = rows.some((row) => row.role === "owner" || row.role === "admin");
  redirect(isAdmin ? "/admin" : "/employee");
}
