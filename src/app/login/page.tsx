import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Masuk — Gaji" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; tab?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/");

  const { next, tab } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            G
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Masuk ke Gaji</h1>
          <p className="text-sm text-muted-foreground">Gunakan nomor HP dan PIN 6 digit kamu.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Masuk sebagai</CardTitle>
            <CardDescription>
              Pilih Karyawan atau Owner. Akun karyawan dibuat oleh admin perusahaan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={next} initialMode={tab === "owner" ? "owner" : "employee"} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
