import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashAdvances } from "@/db/schema";
import { requireEmployee } from "@/lib/session";
import { updateAdvanceRequestAction } from "../../actions";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { AdvanceForm } from "@/components/employee/advance-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateID, rupiah, toNumber } from "@/lib/format";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Ubah pengajuan kasbon — Gaji" };

/** Halaman tersendiri untuk memperbaiki pengajuan kasbon yang belum diputuskan admin. */
export default async function EditEmployeeAdvancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org, employee } = await requireEmployee();
  const { id } = await params;
  const { ok, err } = await searchParams;

  const [row] = await db
    .select()
    .from(cashAdvances)
    .where(
      and(
        eq(cashAdvances.id, id),
        eq(cashAdvances.orgId, org.id),
        eq(cashAdvances.employeeId, employee.id),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const editable = row.status === "pending";

  return (
    <>
      <header>
        <Link href="/employee/kasbon" className="text-xs text-muted-foreground hover:underline">
          ← Kasbon
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Ubah pengajuan kasbon</h1>
        <p className="text-xs text-muted-foreground">
          {editable
            ? "Pengajuan masih menunggu, jadi masih bisa diperbaiki."
            : "Kasbon ini sudah diputuskan admin, jadi isinya terkunci."}
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate tabular-nums">
              {rupiah(toNumber(row.principal))}
            </span>
            <StatusBadge
              tone={
                row.status === "approved"
                  ? "good"
                  : row.status === "settled"
                    ? "info"
                    : row.status === "rejected"
                      ? "bad"
                      : "warn"
              }
            >
              {statusLabel(row.status)}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            Diajukan {formatDateID(row.requestedAt)} ·{" "}
            {row.installmentAmount
              ? `dicicil ${rupiah(toNumber(row.installmentAmount))} per periode`
              : "bayar langsung"}
          </CardDescription>
        </CardHeader>
      </Card>

      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Detail kasbon</CardTitle>
            <CardDescription>
              Mengubah nominal akan mengatur ulang sisa saldo — saldo baru dipakai setelah admin
              menyetujui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdvanceForm
              action={updateAdvanceRequestAction}
              advanceId={row.id}
              defaults={{
                principal: Math.round(toNumber(row.principal)),
                installmentAmount: row.installmentAmount
                  ? Math.round(toNumber(row.installmentAmount))
                  : null,
                note: row.note,
              }}
              submitLabel="Simpan perubahan"
              cancelHref="/employee/kasbon"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Tidak bisa diubah lagi</CardTitle>
            <CardDescription>
              Kasbon yang sudah disetujui atau ditolak admin tidak bisa diubah. Hubungi admin bila
              ada kekeliruan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/employee/kasbon">Kembali ke kasbon</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
