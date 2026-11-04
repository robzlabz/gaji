import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payPeriods } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { localDateString } from "@/lib/format";
import { isPayoutFormat, renderPayoutCsv } from "@/lib/payout";
import { loadPayoutBatch } from "@/lib/payout-server";

export const dynamic = "force-dynamic";

/**
 * Unduh berkas transfer payroll dalam format siap unggah bank.
 *
 * Contoh: `/admin/payroll/<id>/transfer?format=bca`. Format yang tersedia:
 * `generic`, `bca`, `mandiri`, `bni`, `bri`. Berkas selalu diakhiri baris kontrol
 * `TOTAL,<jumlah penerima>,<jumlah nominal>` supaya total bisa dicocokkan.
 * Respons menyertakan header `X-Payout-Rows` dan `X-Payout-Total` untuk pengecekan cepat.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { org } = await requireAdmin();
  const { id } = await params;

  const format = new URL(request.url).searchParams.get("format") ?? "generic";
  if (!isPayoutFormat(format)) {
    return new Response("Format berkas tidak dikenal", { status: 400 });
  }

  const [period] = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.id, id), eq(payPeriods.orgId, org.id)))
    .limit(1);

  if (!period) {
    return new Response("Periode tidak ditemukan", { status: 404 });
  }

  const batch = await loadPayoutBatch(org.id, period);
  const csv = renderPayoutCsv({
    format,
    batch,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    // Tanggal ekspor memakai zona waktu organisasi, bukan zona server.
    exportDate: localDateString(new Date(), org.timezone),
  });

  return new Response(csv.content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
      "Cache-Control": "no-store",
      "X-Payout-Rows": String(csv.rows.length),
      "X-Payout-Total": String(csv.total),
    },
  });
}
