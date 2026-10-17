import Link from "next/link";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { contracts, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { createContractAction, terminateContractAction } from "../actions";
import { Flash } from "@/components/flash";
import { Badge, Card, EmptyState, Field, Stat, Table, Td, btnDanger, btnPrimary, inputClass } from "@/components/ui";
import { CONTRACT_KIND_LABEL, formatDateID, localDateString, rupiah, toNumber } from "@/lib/utils";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; renew?: string; filter?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err, renew, filter } = await searchParams;

  const today = localDateString(new Date(), org.timezone);
  const alertDate = new Date(`${today}T00:00:00Z`);
  alertDate.setUTCDate(alertDate.getUTCDate() + org.contractAlertDays);
  const alertLimit = alertDate.toISOString().slice(0, 10);

  const base = db
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

  const rows = await base;
  const renewing = renew ? rows.find((row) => row.id === renew) : undefined;

  const staff = await db
    .select({ id: employees.id, fullName: employees.fullName, payType: employees.payType, payRate: employees.payRate })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), eq(employees.isActive, true)))
    .orderBy(employees.fullName);

  const activeCount = rows.filter((row) => row.status === "active").length;
  const expiringCount = rows.filter(
    (row) => row.status === "active" && row.endDate && row.endDate <= alertLimit,
  ).length;

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-stone-900">Kontrak</h1>
        <p className="text-sm text-muted">Kelola masa berlaku kontrak dan perpanjangannya.</p>
      </header>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Kontrak aktif" value={activeCount} />
        <Stat
          label="Akan berakhir"
          value={expiringCount}
          hint={`≤ ${org.contractAlertDays} hari`}
          tone={expiringCount > 0 ? "warn" : "default"}
        />
        <Stat label="Total kontrak" value={rows.length} />
      </div>

      <div className="flex gap-2 text-xs">
        {[
          { key: "", label: "Semua" },
          { key: "expiring", label: "Akan berakhir" },
          { key: "ended", label: "Sudah selesai" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.key ? `/admin/kontrak?filter=${tab.key}` : "/admin/kontrak"}
            className={
              (filter ?? "") === tab.key
                ? "rounded-full bg-brand px-3 py-1.5 font-semibold text-white"
                : "rounded-full border border-line bg-white px-3 py-1.5 text-stone-600"
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {renewing && (
        <Card
          title={`Perpanjang kontrak — ${renewing.employeeName}`}
          subtitle={`Kontrak lama berakhir ${renewing.endDate ? formatDateID(renewing.endDate) : "tanpa batas"}. Kontrak baru akan menggantikannya.`}
        >
          <form action={createContractAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="employeeId" value={renewing.employeeId} />
            <input type="hidden" name="renewedFromId" value={renewing.id} />
            <input type="hidden" name="backTo" value="/admin/kontrak" />
            <Field label="Jenis kontrak">
              <select name="kind" className={inputClass} defaultValue="pkwt">
                <option value="pkwt">PKWT</option>
                <option value="probation">Percobaan</option>
                <option value="pkwtt">PKWTT</option>
                <option value="other">Lainnya</option>
              </select>
            </Field>
            <Field label="Mulai">
              <input
                type="date"
                name="startDate"
                className={inputClass}
                defaultValue={renewing.endDate ?? today}
                required
              />
            </Field>
            <Field label="Berakhir">
              <input type="date" name="endDate" className={inputClass} />
            </Field>
            <Field label="Tipe gaji">
              <select name="payType" className={inputClass} defaultValue={renewing.payType}>
                <option value="hourly">Per jam</option>
                <option value="daily">Per hari</option>
                <option value="monthly">Per bulan</option>
                <option value="per_task">Per tugas</option>
              </select>
            </Field>
            <Field label="Tarif">
              <input
                name="payRate"
                className={inputClass}
                inputMode="numeric"
                defaultValue={Math.round(toNumber(renewing.payRate))}
              />
            </Field>
            <div className="flex items-end">
              <button type="submit" className={`${btnPrimary} w-full`}>
                Simpan perpanjangan
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Daftar kontrak">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada kontrak" hint="Tambahkan kontrak dari halaman detail karyawan." />
        ) : (
          <Table head={["Karyawan", "Jenis", "Mulai", "Berakhir", "Tarif", "Status", ""]}>
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
                <tr key={row.id} className={soon ? "bg-amber-50/50" : undefined}>
                  <Td>
                    <Link href={`/admin/karyawan/${row.employeeId}`} className="font-medium text-stone-900">
                      {row.employeeName}
                    </Link>
                  </Td>
                  <Td className="text-stone-600">{CONTRACT_KIND_LABEL[row.kind] ?? row.kind}</Td>
                  <Td className="tabular-nums text-stone-600">{formatDateID(row.startDate)}</Td>
                  <Td className="tabular-nums text-stone-600">
                    {row.endDate ? formatDateID(row.endDate) : "—"}
                    {soon && (
                      <span className="ml-2 text-xs text-amber-700">
                        {days !== null && days < 0 ? "sudah lewat" : `${days} hari lagi`}
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{rupiah(toNumber(row.payRate))}</Td>
                  <Td>
                    <Badge
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
                      {row.status}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {row.status === "active" && (
                        <Link href={`/admin/kontrak?renew=${row.id}`} className="text-xs font-medium text-brand">
                          Perpanjang
                        </Link>
                      )}
                      {row.status === "active" && (
                        <form action={terminateContractAction}>
                          <input type="hidden" name="contractId" value={row.id} />
                          <input type="hidden" name="backTo" value="/admin/kontrak" />
                          <button type="submit" className={`${btnDanger} px-2 py-1 text-xs`}>
                            Akhiri
                          </button>
                        </form>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="Tambah kontrak baru" subtitle="Untuk karyawan yang belum punya kontrak di sistem.">
        <form action={createContractAction} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="backTo" value="/admin/kontrak" />
          <Field label="Karyawan">
            <select name="employeeId" className={inputClass} required>
              <option value="">Pilih karyawan…</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jenis kontrak">
            <select name="kind" className={inputClass} defaultValue="pkwt">
              <option value="pkwt">PKWT</option>
              <option value="probation">Percobaan</option>
              <option value="pkwtt">PKWTT</option>
              <option value="other">Lainnya</option>
            </select>
          </Field>
          <Field label="Nomor kontrak">
            <input name="contractNo" className={inputClass} placeholder="001/PKWT/I/2026" />
          </Field>
          <Field label="Mulai">
            <input type="date" name="startDate" className={inputClass} defaultValue={today} required />
          </Field>
          <Field label="Berakhir">
            <input type="date" name="endDate" className={inputClass} />
          </Field>
          <Field label="Tarif">
            <input name="payRate" className={inputClass} inputMode="numeric" placeholder="25000" />
          </Field>
          <div className="sm:col-span-3">
            <button type="submit" className={btnPrimary}>
              Simpan kontrak
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
