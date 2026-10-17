import { requireAdmin } from "@/lib/session";
import { updateOrgSettingsAction } from "../actions";
import { Flash } from "@/components/flash";
import { Card, Field, btnPrimary, inputClass } from "@/components/ui";

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
        <h1 className="text-xl font-semibold text-stone-900">Pengaturan</h1>
        <p className="text-sm text-muted">
          {org.name} · zona waktu {org.timezone} · mata uang {org.currency}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card title="Periode gaji & kebijakan" subtitle="Berlaku untuk seluruh karyawan perusahaan ini.">
        <form action={updateOrgSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Tanggal mulai periode gaji"
            hint="Contoh: 26 → periode 26 Jan s/d 25 Feb. Default 1 = bulan kalender."
          >
            <input
              name="payPeriodStartDay"
              type="number"
              min={1}
              max={31}
              className={inputClass}
              defaultValue={org.payPeriodStartDay}
            />
          </Field>
          <Field label="Notifikasi kontrak berakhir (hari sebelum)" hint="Dipakai untuk daftar & badge peringatan.">
            <input
              name="contractAlertDays"
              type="number"
              min={0}
              max={365}
              className={inputClass}
              defaultValue={org.contractAlertDays}
            />
          </Field>
          <Field label="Hari kerja efektif per bulan" hint="Acuan prorata gaji bulanan.">
            <input
              name="workingDaysPerMonth"
              type="number"
              min={1}
              max={31}
              className={inputClass}
              defaultValue={org.workingDaysPerMonth}
            />
          </Field>
          <Field label="Pengali lembur" hint="Lembur tetap butuh catatan manual dari admin.">
            <input
              name="overtimeMultiplier"
              type="number"
              step="0.1"
              min={1}
              max={5}
              className={inputClass}
              defaultValue={Number(org.overtimeMultiplier)}
            />
          </Field>
          <div className="sm:col-span-2">
            <button type="submit" className={btnPrimary}>
              Simpan pengaturan
            </button>
          </div>
        </form>
      </Card>

      <Card title="Akun saya">
        <p className="text-sm text-stone-700">{user.name}</p>
        <p className="text-xs text-muted">
          {user.phoneNumber ?? "-"} · {user.email}
        </p>
      </Card>
    </>
  );
}
