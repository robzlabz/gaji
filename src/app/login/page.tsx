import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Masuk — Gaji" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/");

  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-xl font-bold text-white">
            G
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Masuk ke Gaji</h1>
          <p className="mt-1 text-sm text-muted">Gunakan nomor HP dan PIN 6 digit kamu.</p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-6">
          <LoginForm next={next} />
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Akun dibuat oleh admin perusahaan. Hubungi admin kalau PIN terlupa.
        </p>
      </div>
    </main>
  );
}
