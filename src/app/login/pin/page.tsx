import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { getSession } from "@/lib/session";
import { findCountry } from "@/lib/countries";
import { formatPhoneDisplay } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findLoginAccount } from "../actions";
import { LoginSteps } from "../login-steps";
import { PinForm } from "./pin-form";

export const metadata = { title: "Masuk — PIN" };

/**
 * Langkah 2 halaman masuk: PIN saja, di halaman tersendiri.
 *
 * Nomor HP dibawa lewat query (`phone`, `c` = kode negara) lalu dicek ulang di
 * server: label Owner/Karyawan diambil dari data akun, bukan dari pilihan user.
 */
export default async function LoginPinPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; c?: string; next?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/");

  const { phone, c, next } = await searchParams;
  if (!phone) redirect("/login");

  const country = findCountry(c ?? "ID");
  const account = await findLoginAccount(phone, country.dial);
  // Nomor hilang / tidak dikenal → kembali ke langkah 1.
  if (!account.ok) redirect("/login");

  const RoleIcon = account.kind === "owner" ? ShieldCheckIcon : UserRoundIcon;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            G
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Masuk ke Gaji</h1>
          <p className="text-sm text-muted-foreground">
            Nomor HP dikenali. Sekarang masukkan PIN kamu.
          </p>
        </div>

        <LoginSteps active={2} />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <RoleIcon />
                {account.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{account.name}</span>
            </div>
            <CardTitle>Masukkan PIN</CardTitle>
            <CardDescription className="font-mono">
              {formatPhoneDisplay(account.phone, country.dial)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PinForm phone={account.phone} next={next} />
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Bukan nomor kamu?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Ganti nomor HP
          </Link>
        </p>
      </div>
    </main>
  );
}
