import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createEmployeeAction } from "../../actions";
import { Flash } from "@/components/flash";
import { PhoneInput } from "@/components/phone-input";
import { CheckField, FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { localDateString } from "@/lib/format";
import { PTKP_LABEL, PTKP_STATUSES } from "@/lib/statutory";

export const metadata = { title: "Tambah karyawan — Gaji" };

/** Halaman tersendiri untuk menambah karyawan (bukan modal, bukan form di daftar). */
export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;
  const today = localDateString(new Date(), org.timezone);

  return (
    <>
      <header>
        <Link href="/admin/karyawan" className="text-xs text-muted-foreground hover:underline">
          ← Karyawan
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Tambah karyawan</h1>
        <p className="text-sm text-muted-foreground">
          Isi data karyawan dan (opsional) akun login nomor HP + PIN 6 digit.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <form action={createEmployeeAction} className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Data karyawan</CardTitle>
            <CardDescription>Nama, tipe penggajian, dan tarif dasar.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Nama lengkap">
              <Input name="fullName" required placeholder="Budi Santoso" />
            </FormField>
            <FormField label="NIK / kode" hint="Opsional, unik per perusahaan">
              <Input name="code" placeholder="EMP-001" />
            </FormField>
            <FormField label="Tanggal masuk">
              <Input type="date" name="joinedAt" defaultValue={today} required />
            </FormField>
            <FormField label="Tipe penggajian">
              <SelectInput name="payType" defaultValue="hourly">
                <option value="hourly">Per jam</option>
                <option value="daily">Per hari</option>
                <option value="monthly">Per bulan</option>
                <option value="per_task">Per tugas</option>
              </SelectInput>
            </FormField>
            <FormField label="Tarif (Rp)" hint="per jam / hari / bulan / unit tugas">
              <Input name="payRate" inputMode="numeric" placeholder="25000" required />
            </FormField>
            <FormField
              label="Ongkos kedatangan (Rp)"
              hint="Opsional. Diisi karyawan saat clock in (mis. 10000 untuk yang datang dari jauh). Kosongkan bila tidak ada."
            >
              <Input name="transportRate" inputMode="numeric" placeholder="0" />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pajak &amp; BPJS</CardTitle>
            <CardDescription>
              Opsional. Selama PTKP kosong dan BPJS tidak dicentang, slip karyawan ini tidak
              memotong PPh 21 maupun iuran — slip akan memberi peringatan supaya datanya dilengkapi.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              label="Status PTKP"
              hint="Menentukan PTKP setahun untuk PPh 21. Kosong = PPh 21 tidak dihitung."
            >
              <SelectInput name="ptkpStatus" defaultValue="">
                <option value="">Belum diisi (tidak dipotong)</option>
                {PTKP_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PTKP_LABEL[status]}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField
              label="NPWP"
              hint="15 atau 16 digit. Kosong = PPh 21 dihitung dengan tarif tanpa NPWP (+20%)."
            >
              <Input name="npwp" inputMode="numeric" placeholder="01.234.567.8-901.000" />
            </FormField>
            <CheckField name="bpjsKesehatan" label="Peserta BPJS Kesehatan" />
            <CheckField
              name="bpjsKetenagakerjaan"
              label="Peserta BPJS Ketenagakerjaan (JHT, JP, JKK, JKM)"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Akun login</CardTitle>
            <CardDescription>
              Karyawan masuk ke dashboard karyawan memakai nomor HP dan PIN 6 digit.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Nomor HP</span>
              <PhoneInput name="phone" dialName="phoneDial" defaultDial="ID" placeholder="8123456789" />
            </div>
            <FormField label="PIN awal" hint="6 digit angka">
              <Input name="pin" inputMode="numeric" maxLength={6} placeholder="123456" />
            </FormField>
            <CheckField name="createLogin" label="Buat akun login" defaultChecked />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Simpan karyawan</Button>
          <Button asChild variant="outline">
            <Link href="/admin/karyawan">Batal</Link>
          </Button>
        </div>
      </form>
    </>
  );
}
