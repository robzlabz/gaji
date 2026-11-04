"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contractSignatures } from "@/db/schema";
import { audit } from "@/lib/audit";
import { effectiveSignatureStatus, hashContractSummary, isSignTokenShape } from "@/lib/esign";
import { findSignatureByToken, summaryOf } from "@/lib/esign-contract";

/**
 * Kode alasan gagal, bukan teks bebas: pesan di halaman publik dipetakan dari
 * kode ini (lihat `SIGN_ERROR_MESSAGE`), jadi tautan `?e=` tidak bisa dipakai
 * untuk menampilkan kalimat buatan pengirim tautan.
 */
export type SignErrorCode = "invalid" | "missing" | "used" | "revoked" | "expired" | "agree" | "name";

function back(token: string, code: SignErrorCode): never {
  redirect(`/sign/${encodeURIComponent(token)}?e=${code}`);
}

/**
 * IP penanda tangan dari header proxy. Di balik reverse proxy, IP asli ada di
 * entri pertama `x-forwarded-for`; `x-real-ip` dipakai bila proxy hanya mengisi itu.
 */
function clientIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 64) : null;
}

/**
 * Aksi tanda tangan dari tautan publik. Tidak butuh login: keabsahan datang dari
 * token + validasi ulang status/kedaluwarsa, bukan dari sesi.
 *
 * Urutan penting: semua validasi dilakukan **sebelum** menulis, lalu update
 * memakai syarat `status = 'sent'` supaya token benar-benar sekali pakai walau
 * dua permintaan datang bersamaan.
 */
export async function signContractAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const signerName = String(formData.get("signerName") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const agreed = formData.get("agree") === "on";

  if (!isSignTokenShape(token)) back(token, "invalid");

  const ctx = await findSignatureByToken(token);
  if (!ctx) back(token, "missing");

  const now = new Date();
  const status = effectiveSignatureStatus(ctx.signature, now);

  if (status === "signed") back(token, "used");
  if (status === "revoked") back(token, "revoked");
  if (status === "expired") back(token, "expired");

  if (!agreed) back(token, "agree");
  if (signerName.length < 3 || signerName.length > 120) back(token, "name");

  const requestHeaders = await headers();
  const signatureHash = hashContractSummary(summaryOf(ctx.contract, ctx.employeeName, ctx.orgName));

  const updated = await db
    .update(contractSignatures)
    .set({
      status: "signed",
      signedAt: now,
      signerName,
      signerIp: clientIp(requestHeaders),
      signerUserAgent: requestHeaders.get("user-agent")?.slice(0, 400) ?? null,
      signatureHash,
    })
    // Syarat status ikut di WHERE: permintaan kedua tidak mengubah apa pun.
    .where(and(eq(contractSignatures.id, ctx.signature.id), eq(contractSignatures.status, "sent")))
    .returning({ id: contractSignatures.id });

  if (updated.length === 0) back(token, "used");

  await audit({
    orgId: ctx.signature.orgId,
    actorId: null,
    entity: "contract_signatures",
    entityId: ctx.signature.id,
    action: "sign",
    diff: { contractId: ctx.contract.id, signerName, hash: signatureHash },
  });

  redirect(`/sign/${encodeURIComponent(token)}`);
}
