import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createEmployeeAction } from "../actions";
import { Flash } from "@/components/flash";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Table,
  Td,
  btnPrimary,
  inputClass,
} from "@/components/ui";
import { PAY_TYPE_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/utils";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;

  const rows = await db
    .select()
    .from(employees)
    .where(eq(employees.orgId, org.id))
    .orderBy(employees.isActive, employees.fullName);

  const today = localDateString(new Date(), org.timezone);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Karyawan</h1>
          <p className="text-sm text-muted">{rows.length} karyawan terdaftar</p>
        </div>
      </header>

      <Flash ok={ok} err={err} />

      <Card title="Tambah karyawan" subtitle="Buat data karyawan sekaligus akun login (nomor HP + PIN).">
        <form action={createEmployeeAction} className="grid gap-3 md:grid-cols-3">
          <Field label="Nama lengkap">
            <input name="fullName" className={inputClass} required placeholder="Budi Santoso" />
          </Field>
          <Field label="NIK / kode" hint="Opsional, unik per perusahaan">
            <input name="code" className={inputClass} placeholder="EMP-001" />
          </Field>
          <Field label="Tanggal masuk">
            <input type="date" name="joinedAt" className={inputClass} defaultValue={today} required />
          </Field>

          <Field label="Tipe penggajian">
            <select name="payType" className={inputClass} defaultValue="hourly">
              <option value="hourly">Per jam</option>
              <option value="daily">Per hari</option>
              <option value="monthly">Per bulan</option>
              <option value="per_task">Per tugas</option>
            </select>
          </Field>
          <Field label="Tarif (Rp)" hint="per jam / hari / bulan / unit tugas">
            <input name="payRate" className={inputClass} inputMode="numeric" placeholder="25000" required />
          </Field>
          <Field label="Nomor HP" hint="Dipakai untuk login">
            <input name="phone" className={inputClass} inputMode="tel" placeholder="08123456789" />
          </Field>

          <Field label="PIN awal" hint="6 digit angka">
            <input
              name="pin"
              className={inputClass}
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
            />
          </Field>

          <label className="flex items-end gap-2 pb-2 text-sm text-stone-700">
            <input type="checkbox" name="createLogin" defaultChecked className="h-4 w-4" />
            Buat akun login
          </label>

          <div className="flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>
              Simpan karyawan
            </button>
          </div>
        </form>
      </Card>

      <Card title="Daftar karyawan">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada karyawan" hint="Tambahkan karyawan pertama lewat form di atas." />
        ) : (
          <Table head={["Nama", "Tipe gaji", "Tarif", "Masuk", "Akun", "Status"]}>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-stone-50/60">
                <Td>
                  <Link href={`/admin/karyawan/${row.id}`} className="font-medium text-stone-900">
                    {row.fullName}
                  </Link>
                  {row.code && <span className="ml-2 text-xs text-muted">{row.code}</span>}
                </Td>
                <Td className="text-stone-600">{PAY_TYPE_LABEL[row.payType] ?? row.payType}</Td>
                <Td className="tabular-nums text-stone-700">{rupiah(toNumber(row.payRate))}</Td>
                <Td className="tabular-nums text-stone-600">{formatDateID(row.joinedAt)}</Td>
                <Td>
                  {row.userId ? <Badge tone="good">aktif</Badge> : <Badge tone="default">tanpa akun</Badge>}
                </Td>
                <Td>
                  {row.isActive ? <Badge tone="brand">aktif</Badge> : <Badge tone="bad">nonaktif</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
