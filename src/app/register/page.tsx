import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Daftar owner — Gaji" };

export default async function RegisterPage() {
  const session = await getSession();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            G
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Daftarkan perusahaan</h1>
          <p className="text-sm text-muted-foreground">
            Akun owner pertama. Karyawan nanti kamu tambahkan dari dashboard admin.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Akun owner</CardTitle>
            <CardDescription>Masuk berikutnya pakai nomor HP dan PIN ini.</CardDescription>
          </CardHeader>
          <CardContent>
            <RegisterForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
