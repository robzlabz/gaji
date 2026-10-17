import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createEmployeeAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CheckField, FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAY_TYPE_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Karyawan</h1>
        <p className="text-sm text-muted-foreground">{rows.length} karyawan terdaftar</p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Tambah karyawan</CardTitle>
          <CardDescription>
            Buat data karyawan sekaligus akun login (nomor HP + PIN 6 digit).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createEmployeeAction} className="grid gap-3 md:grid-cols-3">
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
            <FormField label="Nomor HP" hint="Dipakai untuk login">
              <Input name="phone" inputMode="tel" placeholder="08123456789" />
            </FormField>

            <FormField label="PIN awal" hint="6 digit angka">
              <Input name="pin" inputMode="numeric" maxLength={6} placeholder="123456" />
            </FormField>

            <div className="flex items-end pb-1">
              <CheckField name="createLogin" label="Buat akun login" defaultChecked />
            </div>

            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Simpan karyawan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar karyawan</CardTitle>
          <CardDescription>Klik nama untuk mengubah data, tarif, dan kontrak.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada karyawan"
              hint="Tambahkan karyawan pertama lewat form di atas."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Tipe gaji</TableHead>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Masuk</TableHead>
                  <TableHead>Akun</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/admin/karyawan/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.fullName}
                      </Link>
                      {row.code && (
                        <span className="ml-2 text-xs text-muted-foreground">{row.code}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PAY_TYPE_LABEL[row.payType] ?? row.payType}
                    </TableCell>
                    <TableCell className="tabular-nums">{rupiah(toNumber(row.payRate))}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDateID(row.joinedAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={row.userId ? "good" : "default"}>
                        {row.userId ? "aktif" : "tanpa akun"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={row.isActive ? "good" : "bad"}>
                        {row.isActive ? "aktif" : "nonaktif"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
