import Link from "next/link";
import { requireEmployee } from "@/lib/session";
import { requestAdvanceAction } from "../../actions";
import { Flash } from "@/components/flash";
import { AdvanceForm } from "@/components/employee/advance-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Ajukan kasbon — Gaji" };

/** Halaman tersendiri untuk mengajukan kasbon, termasuk pilihan dicicil atau bayar langsung. */
export default async function NewEmployeeAdvancePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireEmployee();
  const { ok, err } = await searchParams;

  return (
    <>
      <header>
        <Link href="/employee/kasbon" className="text-xs text-muted-foreground hover:underline">
          ← Kasbon
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ajukan kasbon</h1>
        <p className="text-xs text-muted-foreground">
          Admin akan meninjau pengajuanmu. Selama masih menunggu, pengajuan bisa diubah.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Detail kasbon</CardTitle>
          <CardDescription>
            Pilih dicicil beberapa periode, atau bayar langsung sekali potong gaji.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdvanceForm
            action={requestAdvanceAction}
            submitLabel="Kirim pengajuan"
            cancelHref="/employee/kasbon"
          />
        </CardContent>
      </Card>
    </>
  );
}
