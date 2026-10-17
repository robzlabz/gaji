import { requireAdmin } from "@/lib/session";
import { updateOrgSettingsAction } from "../actions";
import { Flash } from "@/components/flash";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, user } = await requireAdmin();
  const { ok, err } = await searchParams;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">
          {org.name} · zona waktu {org.timezone} · mata uang {org.currency}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Periode gaji &amp; kebijakan</CardTitle>
          <CardDescription>Berlaku untuk seluruh karyawan perusahaan ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateOrgSettingsAction} className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Tanggal mulai periode gaji"
              hint="Contoh: 26 → periode 26 Jan s/d 25 Feb. Default 1 = bulan kalender."
            >
              <Input
                name="payPeriodStartDay"
                type="number"
                min={1}
                max={31}
                defaultValue={org.payPeriodStartDay}
              />
            </FormField>
            <FormField
              label="Notifikasi kontrak berakhir (hari sebelum)"
              hint="Dipakai untuk daftar & badge peringatan."
            >
              <Input
                name="contractAlertDays"
                type="number"
                min={0}
                max={365}
                defaultValue={org.contractAlertDays}
              />
            </FormField>
            <FormField label="Hari kerja efektif per bulan" hint="Acuan prorata gaji bulanan.">
              <Input
                name="workingDaysPerMonth"
                type="number"
                min={1}
                max={31}
                defaultValue={org.workingDaysPerMonth}
              />
            </FormField>
            <FormField label="Pengali lembur" hint="Lembur tetap butuh catatan manual dari admin.">
              <Input
                name="overtimeMultiplier"
                type="number"
                step="0.1"
                min={1}
                max={5}
                defaultValue={Number(org.overtimeMultiplier)}
              />
            </FormField>
            <div className="sm:col-span-2">
              <Button type="submit">Simpan pengaturan</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Akun saya</CardTitle>
          <CardDescription>Identitas yang dipakai untuk masuk.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">
            {user.phoneNumber ?? "-"} · {user.email}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
