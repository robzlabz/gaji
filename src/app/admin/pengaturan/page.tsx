import { requireAdmin } from "@/lib/session";
import { updateOrgSettingsAction } from "../actions";
import { Flash } from "@/components/flash";
import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JKK_RISK_CLASSES, resolveStatutorySettings } from "@/lib/statutory";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, user } = await requireAdmin();
  const { ok, err } = await searchParams;
  // Tarif yang berlaku sekarang: JSON organisasi digabung dengan default di kode.
  const statutory = resolveStatutorySettings(org.statutorySettings);

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
          <form action={updateOrgSettingsAction} className="flex flex-col gap-4">
            <FormField
              label="Tanggal mulai periode gaji"
              hint="Contoh: 26 → periode 26 Jan s/d 25 Feb. Default 1 = bulan kalender. Mengubah tanggal mulai tidak mengubah periode yang sudah dihitung. Setelah diubah, halaman Payroll menawarkan satu periode transisi agar tidak ada hari yang dibayar dua kali."
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
            <FormField
              label="Zona waktu"
              hint="Menentukan tanggal absensi & batas periode gaji."
            >
              <SelectInput name="timezone" defaultValue={org.timezone}>
                {["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <div className="border-t pt-3">
              <p className="text-sm font-medium">Lokasi absensi (opsional)</p>
              <p className="text-xs text-muted-foreground">
                Isi koordinat kantor agar clock in di luar radius ditandai “luar area”. Kosongkan
                untuk mematikan pengecekan.
              </p>
            </div>
            <FormField label="Latitude kantor" hint="Contoh: -6.2088">
              <Input
                name="geofenceLat"
                type="number"
                step="any"
                inputMode="decimal"
                defaultValue={org.geofenceLat ?? ""}
              />
            </FormField>
            <FormField label="Longitude kantor" hint="Contoh: 106.8456">
              <Input
                name="geofenceLng"
                type="number"
                step="any"
                inputMode="decimal"
                defaultValue={org.geofenceLng ?? ""}
              />
            </FormField>
            <FormField label="Radius (meter)" hint="Jarak maksimal dari titik kantor.">
              <Input
                name="geofenceRadiusM"
                type="number"
                min={10}
                max={20000}
                defaultValue={org.geofenceRadiusM ?? ""}
              />
            </FormField>
            <div className="border-t pt-3">
              <p className="text-sm font-medium">PPh 21 &amp; BPJS</p>
              <p className="text-xs text-muted-foreground">
                Tarif iuran yang dipakai saat payroll dihitung. Tarif PPh 21 mengikuti UU HPP
                (5/15/25/30/35%) dengan biaya jabatan 5% maksimal Rp6 jt setahun, jadi yang bisa
                diatur di sini hanya tarif &amp; batas upah iuran BPJS. Nilai yang sudah terpakai
                tersimpan di slip, jadi mengubah tarif tidak mengubah slip lama.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="BPJS Kesehatan — karyawan (%)" hint="Default 1%.">
                <Input
                  name="bpjsKesehatanEmployeePct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.kesehatan.employeePct}
                />
              </FormField>
              <FormField label="BPJS Kesehatan — perusahaan (%)" hint="Default 4%.">
                <Input
                  name="bpjsKesehatanEmployerPct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.kesehatan.employerPct}
                />
              </FormField>
              <FormField
                label="BPJS Kesehatan — batas upah (Rp)"
                hint="Dasar iuran dibatasi angka ini. Kosong = tanpa batas."
              >
                <Input
                  name="bpjsKesehatanWageCap"
                  type="number"
                  min={0}
                  defaultValue={statutory.kesehatan.wageCap ?? ""}
                />
              </FormField>
              <div className="hidden sm:block" />
              <FormField label="JHT — karyawan (%)" hint="Default 2%.">
                <Input
                  name="bpjsJhtEmployeePct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.jht.employeePct}
                />
              </FormField>
              <FormField label="JHT — perusahaan (%)" hint="Default 3,7%.">
                <Input
                  name="bpjsJhtEmployerPct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.jht.employerPct}
                />
              </FormField>
              <FormField label="JP — karyawan (%)" hint="Default 1%.">
                <Input
                  name="bpjsJpEmployeePct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.jp.employeePct}
                />
              </FormField>
              <FormField label="JP — perusahaan (%)" hint="Default 2%.">
                <Input
                  name="bpjsJpEmployerPct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.jp.employerPct}
                />
              </FormField>
              <FormField
                label="JP — batas upah (Rp)"
                hint="Batas upah JP di atas tidak ada iurannya. Kosong = tanpa batas."
              >
                <Input
                  name="bpjsJpWageCap"
                  type="number"
                  min={0}
                  defaultValue={statutory.jp.wageCap ?? ""}
                />
              </FormField>
              <FormField
                label="JKK — kelas risiko"
                hint="Iuran ditanggung perusahaan; menentukan tarif JKK otomatis."
              >
                <SelectInput name="bpjsJkkRiskClass" defaultValue={statutory.jkk.riskClass}>
                  {JKK_RISK_CLASSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="JKM — perusahaan (%)" hint="Default 0,3%.">
                <Input
                  name="bpjsJkmEmployerPct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={statutory.jkm.employerPct}
                />
              </FormField>
            </div>
            <div>
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
