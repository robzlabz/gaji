import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata = {
  title: "Gaji — Payroll & absensi tanpa drama spreadsheet",
  description:
    "Absensi pakai foto & lokasi, kasbon terkendali, slip gaji siap cetak. Payroll untuk UMKM dalam satu aplikasi.",
};

/** Tamu melihat landing page; pengguna yang sudah masuk langsung diarahkan ke dashboard. */
export default async function Home() {
  const session = await getSession();
  if (!session?.user) return <LandingPage />;

  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, session.user.id));

  if (rows.length === 0) redirect("/no-access");

  const isAdmin = rows.some((row) => row.role === "owner" || row.role === "admin");
  redirect(isAdmin ? "/admin" : "/employee");
}
