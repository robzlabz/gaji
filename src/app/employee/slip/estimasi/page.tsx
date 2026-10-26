import Link from "next/link";
import { requireEmployee } from "@/lib/session";
import { estimatePay } from "@/lib/estimate";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PAY_TYPE_LABEL, localDateString, rupiah, toNumber } from "@/lib/format";
import { periodContaining, periodLabel } from "@/lib/period";
import type { PayslipComputation } from "@/lib/payroll";
import { isDeductionLine } from "@/lib/payroll";

export const metadata = { title: "Estimasi gaji — Gaji" };

function LineList({ computation }: { computation: PayslipComputation }) {
  return (
    <ul className="flex flex-col divide-y">
      {computation.lines.map((line, index) => (
        <li
          key={`${line.kind}-${line.sourceId ?? index}`}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span className={isDeductionLine(line.kind) ? "text-destructive" : undefined}>
            {line.label}
            <span className="ml-1 text-xs text-muted-foreground">
              {line.qty} {line.unit}
            </span>
          </span>
          <span
            className={
              isDeductionLine(line.kind)
                ? "font-medium tabular-nums text-destructive"
                : "font-medium tabular-nums"
            }
          >
            {isDeductionLine(line.kind) ? "−" : ""}
            {rupiah(line.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Estimasi gaji berjalan untuk periode yang sedang berjalan.
 *
 * Slip resmi baru ada setelah payroll difinalkan, jadi karyawan diberi dua angka:
 * "aman" (hanya data yang sudah disetujui admin) dan "kalau semua disetujui"
 * (absensi/tugas yang masih menunggu ikut dihitung). Rumusnya sama dengan payroll.
 */
export default async function EmployeeEstimatePage() {
  const { org, employee } = await requireEmployee();

  const today = localDateString(new Date(), org.timezone);
  const period = periodContaining(today, org.payPeriodStartDay);

  const estimate = await estimatePay({
    orgId: org.id,
    employee: {
      id: employee.id,
      payType: employee.payType,
      payRate: employee.payRate,
      joinedAt: employee.joinedAt,
      endedAt: employee.endedAt,
      isActive: employee.isActive,
    },
    period,
    overtimeMultiplier: toNumber(org.overtimeMultiplier),
  });

  const { approved, potential, counts } = estimate;
  const extraGross = Math.max(0, potential.gross - approved.gross);
  const hasLines = approved.lines.length > 0;
  // Tugas dibayar sebagai upah tambahan untuk semua tipe gaji, jadi yang menunggu
  // bisa berasal dari absensi maupun tugas.
  const pendingParts = [
    counts.entriesPending > 0 ? `${counts.entriesPending} absensi` : null,
    counts.tasksWaiting > 0 ? `${counts.tasksWaiting} tugas` : null,
  ].filter((part): part is string => part !== null);
  const hasTasks = counts.tasksApproved + counts.tasksWaiting + counts.tasksUnpriced > 0;

  return (
    <>
      <header>
        <Link href="/employee/slip" className="text-xs text-muted-foreground hover:underline">
          ← Slip gaji
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Estimasi gaji</h1>
        <p className="text-xs text-muted-foreground">
          Periode {periodLabel(period)} · {PAY_TYPE_LABEL[employee.payType] ?? employee.payType}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Estimasi bersih"
          value={rupiah(approved.net)}
          hint="hanya data yang sudah disetujui"
        />
        <StatCard
          label="Kalau semua disetujui"
          value={rupiah(potential.net)}
          hint={extraGross > 0 ? `+ ${rupiah(extraGross)} masih menunggu` : "tidak ada yang menunggu"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rincian sudah disetujui</CardTitle>
          <CardDescription>
            Bruto {rupiah(approved.gross)} · potongan {rupiah(approved.deductions)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {hasLines ? (
            <>
              <LineList computation={approved} />
              <Separator />
              <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                <span>Estimasi diterima</span>
                <span className="tabular-nums">{rupiah(approved.net)}</span>
              </div>
            </>
          ) : (
            <EmptyState
              title="Belum ada data yang dihitung"
              hint="Absensi atau tugas yang sudah disetujui admin akan muncul di sini."
            />
          )}
        </CardContent>
      </Card>

      {extraGross > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Masih menunggu persetujuan</CardTitle>
            <CardDescription>
              Kalau semua disetujui: bruto {rupiah(potential.gross)} · potongan{" "}
              {rupiah(potential.deductions)} · bersih {rupiah(potential.net)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <LineList computation={potential} />
            <p className="text-xs text-muted-foreground">
              Selisih {rupiah(extraGross)} berasal dari {pendingParts.join(" dan ")} yang belum
              diputuskan admin.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Status data periode ini</CardTitle>
          <CardDescription>
            {counts.entriesApproved} absensi disetujui · {counts.entriesPending} menunggu
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
          {hasTasks ? (
            <p>
              {counts.tasksApproved} tugas disetujui · {counts.tasksWaiting} menunggu — tugas yang
              disetujui dibayar sebagai tambahan gaji.
            </p>
          ) : null}
          {counts.tasksUnpriced > 0 ? (
            <p>
              {counts.tasksUnpriced} pengajuan tugas belum diisi harga oleh admin, jadi belum
              menambah estimasi.
            </p>
          ) : null}
          {approved.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {approved.warnings.map((warning) => (
                <li key={warning} className="text-amber-700 dark:text-amber-400">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            Angka ini perkiraan berjalan. Slip final muncul di halaman Slip gaji setelah admin
            memfinalkan periode — nilainya bisa berbeda bila ada data yang ditolak admin.
          </p>
        </CardContent>
      </Card>

      <Button asChild variant="outline" className="w-full">
        <Link href="/employee/slip">Lihat slip final</Link>
      </Button>
    </>
  );
}
