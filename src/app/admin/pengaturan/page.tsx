import { requireAdmin } from "@/lib/session";
import { toNumber } from "@/lib/format";
import { updateOrgSettingsAction } from "../actions";
import { Flash } from "@/components/flash";
import { FormField, SelectInput } from "@/components/form-field";
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
            <FormField
              label="Hari kerja efektif per bulan"
              hint="Acuan prorata gaji bulanan, sekaligus pembagi gaji bulanan menjadi upah sejam untuk lembur."
            >
              <Input
                name="workingDaysPerMonth"
                type="number"
                min={1}
                max={31}
                defaultValue={org.workingDaysPerMonth}
              />
            </FormField>
            <div className="border-t pt-3">
              <p className="text-sm font-medium">Lembur otomatis (PP 35/2021)</p>
              <p className="text-xs text-muted-foreground">
                Lembur dihitung dari selisih jam clock-in/clock-out setelah dikurangi istirahat:
                jam pertama 1,5× upah sejam, jam berikutnya 2×. Upah sejam diturunkan dari tipe
                gaji — per jam memakai tarifnya, per hari tarif harian ÷ jam normal per hari, per
                bulan gaji bulanan ÷ (hari kerja efektif × jam normal per hari). Angka lembur
                manual pada absensi tetap menang atas hitungan otomatis.
              </p>
            </div>
            <FormField
              label="Jam kerja normal per hari"
              hint="Contoh: 7 atau 7,5. Kelebihan menit di atas angka ini yang dihitung lembur."
            >
              <Input
                name="normalHoursPerDay"
                type="number"
                step="0.5"
                min={1}
                max={24}
                defaultValue={toNumber(org.normalHoursPerDay)}
              />
            </FormField>
            <FormField
              label="Hari kerja per minggu"
              hint="6 = Senin–Sabtu, 5 = Senin–Jumat, 7 = setiap hari. Sisa hari dianggap hari libur (lembur hari libur belum dihitung otomatis)."
            >
              <Input
                name="workingDaysPerWeek"
                type="number"
                min={1}
                max={7}
                defaultValue={org.workingDaysPerWeek}
              />
            </FormField>
            <FormField label="Pengali lembur jam pertama" hint="Bawaan 1,5× sesuai PP 35/2021.">
              <Input
                name="overtimeFirstMultiplier"
                type="number"
                step="0.1"
                min={1}
                max={10}
                defaultValue={toNumber(org.overtimeFirstMultiplier)}
              />
            </FormField>
            <FormField
              label="Pengali lembur jam berikutnya"
              hint="Bawaan 2× sesuai PP 35/2021."
            >
              <Input
                name="overtimeNextMultiplier"
                type="number"
                step="0.1"
                min={1}
                max={10}
                defaultValue={toNumber(org.overtimeNextMultiplier)}
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
