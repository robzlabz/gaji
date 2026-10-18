import Link from "next/link";
import { eq } from "drizzle-orm";
import { PlusIcon } from "lucide-react";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAY_TYPE_LABEL, formatDateID, rupiah, toNumber } from "@/lib/format";

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

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Karyawan</h1>
          <p className="text-sm text-muted-foreground">{rows.length} karyawan terdaftar</p>
        </div>
        <Button asChild>
          <Link href="/admin/karyawan/baru">
            <PlusIcon />
            Tambah karyawan
          </Link>
        </Button>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle>Daftar karyawan</CardTitle>
          <CardDescription>
            Klik nama untuk membuka detail: akun login, kasbon, kontrak, absensi, dan slip gaji.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada karyawan"
              hint={
                <>
                  Tambahkan karyawan pertama lewat tombol{" "}
                  <Link href="/admin/karyawan/baru" className="font-medium text-foreground underline">
                    Tambah karyawan
                  </Link>
                  .
                </>
              }
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
