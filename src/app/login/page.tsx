import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Masuk — Gaji" };

/** Akun demo hasil `npm run db:seed` — hanya ditampilkan di luar produksi. */
const DEMO_ACCOUNTS = [
  { role: "Owner", phone: "08111111111", pin: "111111" },
  { role: "Karyawan (harian)", phone: "08333333333", pin: "333333" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; tab?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/");

  const { next, tab } = await searchParams;
  const isDev = process.env.NODE_ENV !== "production";

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

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Belum punya perusahaan?{" "}
          <Link
            href="/register"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Daftar sebagai owner
          </Link>
        </p>

        {isDev ? (
          <Card className="mt-4 border-dashed">
            <CardHeader>
              <CardTitle className="text-sm">Akun demo</CardTitle>
              <CardDescription className="text-xs">
                Nomor HP lengkap 11 digit (dimulai 08). Hasil <code>npm run db:seed</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
              {DEMO_ACCOUNTS.map((account) => (
                <div key={account.phone} className="flex items-center justify-between gap-3">
                  <span>{account.role}</span>
                  <span className="font-mono text-foreground">
                    {account.phone} / {account.pin}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
