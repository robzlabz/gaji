import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { topUpSaldoAction } from "../../actions";
import { Flash } from "@/components/flash";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { localDateString } from "@/lib/format";

export const metadata = { title: "Tambah saldo — Gaji" };

export default async function NewSaldoPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);
  const staff = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
    .orderBy(employees.fullName);

  return (
    <>
      <header>
        <Link href="/admin/saldo" className="text-xs text-muted-foreground hover:underline">
          ← Semua saldo
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Tambah saldo</h1>
        <p className="text-sm text-muted-foreground">
          Kirim uang lebih dulu ke karyawan. Saldo dibuat otomatis saat top up pertama.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Kirim uang</CardTitle>
          <CardDescription>Tanpa saldo, karyawan dibayar tunai seperti biasa.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={topUpSaldoAction} className="flex max-w-xl flex-col gap-4">
            <input type="hidden" name="backTo" value="/admin/saldo/baru" />
            <FormField label="Karyawan">
              <SelectInput name="employeeId" required defaultValue="">
                <option value="">Pilih karyawan…</option>
                {staff.map((row) => (
                  <option key={row.id} value={row.id}>{row.fullName}</option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Nominal (Rp)">
              <Input name="amount" inputMode="numeric" placeholder="500000" required />
            </FormField>
            <FormField label="Tanggal kirim">
              <Input type="date" name="occurredAt" defaultValue={today} />
            </FormField>
            <FormField label="Catatan">
              <Input name="note" placeholder="opsional" />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Tambah saldo</Button>
              <Button asChild variant="outline"><Link href="/admin/saldo">Batal</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
