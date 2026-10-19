import Link from "next/link";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { PlusIcon } from "lucide-react";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { terminateContractAction } from "../actions";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";
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
import { CONTRACT_KIND_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/format";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; filter?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, filter } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const alertDate = new Date(`${today}T00:00:00Z`);
  alertDate.setUTCDate(alertDate.getUTCDate() + org.contractAlertDays);
  const alertLimit = alertDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: contracts.id,
      kind: contracts.kind,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
      payRate: contracts.payRate,
      payType: contracts.payType,
      note: contracts.note,
      employeeId: employees.id,
      employeeName: employees.fullName,
      renewedFromId: contracts.renewedFromId,
    })
    .from(contracts)
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .where(
      filter === "expiring"
        ? and(
            eq(contracts.orgId, org.id),
            eq(contracts.status, "active"),
            isNotNull(contracts.endDate),
            lte(contracts.endDate, alertLimit),
          )
        : filter === "ended"
          ? and(eq(contracts.orgId, org.id), sql`${contracts.status} in ('expired','renewed','terminated')`)
          : eq(contracts.orgId, org.id),
    )
    .orderBy(contracts.endDate, employees.fullName);

  const activeCount = rows.filter((row) => row.status === "active").length;
  const expiringCount = rows.filter(
    (row) => row.status === "active" && row.endDate && row.endDate <= alertLimit,
  ).length;

  const tabs = [
    { key: "", label: "Semua" },
    { key: "expiring", label: "Akan berakhir" },
    { key: "ended", label: "Sudah selesai" },
  ];
  const activeFilter = filter ?? "";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kontrak</h1>
          <p className="text-sm text-muted-foreground">
            Kelola masa berlaku kontrak dan perpanjangannya.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/kontrak/baru">
            <PlusIcon />
            Tambah kontrak
          </Link>
        </Button>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Kontrak aktif" value={activeCount} />
        <StatCard
          label="Akan berakhir"
          value={expiringCount}
          hint={`≤ ${org.contractAlertDays} hari`}
        />
        <StatCard label="Total kontrak" value={rows.length} hint="sesuai filter aktif" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key || "all"}
            asChild
            size="sm"
            variant={activeFilter === tab.key ? "secondary" : "outline"}
          >
            <Link href={tab.key ? `/admin/kontrak?filter=${tab.key}` : "/admin/kontrak"}>
              {tab.label}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar kontrak</CardTitle>
          <CardDescription>
            Baris kuning menandakan kontrak yang mendekati berakhir. Klik nama kontrak untuk mengubah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Belum ada kontrak"
              hint="Buat kontrak pertama lewat tombol Tambah kontrak."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Berakhir</TableHead>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const days = row.endDate
                    ? Math.ceil(
                        (new Date(`${row.endDate}T00:00:00Z`).getTime() -
                          new Date(`${today}T00:00:00Z`).getTime()) /
                          86_400_000,
                      )
                    : null;
                  const soon = row.status === "active" && days !== null && days <= org.contractAlertDays;

                  return (
                    <TableRow key={row.id} className={soon ? "bg-amber-50/60 dark:bg-amber-500/10" : undefined}>
                      <TableCell>
                        <Link
                          href={`/admin/kontrak/${row.id}`}
                          className="font-medium hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {CONTRACT_KIND_LABEL[row.kind] ?? row.kind}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDateID(row.startDate)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        <span className="flex flex-col items-start gap-1">
                          <span>{row.endDate ? formatDateID(row.endDate) : "—"}</span>
                          {soon && (
                            <StatusBadge tone={days !== null && days < 0 ? "bad" : "warn"}>
                              {days !== null && days < 0 ? "sudah lewat" : `${days} hari lagi`}
                            </StatusBadge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{rupiah(toNumber(row.payRate))}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            row.status === "active"
                              ? "good"
                              : row.status === "renewed"
                                ? "info"
                                : row.status === "terminated"
                                  ? "default"
                                  : "bad"
                          }
                        >
                          {statusLabel(row.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button asChild variant="link" size="sm" className="px-0">
                            <Link href={`/admin/kontrak/${row.id}`}>Ubah</Link>
                          </Button>
                          {row.status === "active" && (
                            <Button asChild variant="link" size="sm" className="px-0">
                              <Link href={`/admin/kontrak/baru?renew=${row.id}`}>Perpanjang</Link>
                            </Button>
                          )}
                          {row.status === "active" && (
                            <form action={terminateContractAction}>
                              <input type="hidden" name="contractId" value={row.id} />
                              <input type="hidden" name="backTo" value="/admin/kontrak" />
                              <Button type="submit" variant="destructive" size="xs">
                                Akhiri
                              </Button>
                            </form>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
