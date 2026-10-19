"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { createKey, revokeKey } from "../../../../mcp/keys-store";

function flash(params: { ok?: string; err?: string }): never {
  const url = new URL("/admin/mcp", "http://flash.local");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  redirect(`${url.pathname}${url.search}`);
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Buat API key MCP baru untuk org aktif. Token asli hanya ditampilkan di halaman
 * (dienkripsi di DB), jadi aman untuk dibuka ulang kapan pun.
 */
export async function createMcpKeyAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const name = str(formData, "name") || "MCP";

  const { id } = await createKey({ orgId: org.id, createdBy: user.id, name });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "mcp_api_key",
    entityId: id,
    action: "create",
    diff: { name },
  });

  revalidatePath("/admin/mcp");
  flash({ ok: `Kunci "${name}" dibuat. Salin connection URL-nya sekarang.` });
}

/** Cabut kunci: client yang memakainya langsung ditolak (401) pada request berikutnya. */
export async function revokeMcpKeyAction(formData: FormData) {
  const { org, user } = await requireAdmin();
  const keyId = str(formData, "keyId");
  if (!keyId) flash({ err: "Kunci tidak ditemukan." });

  const revoked = await revokeKey(org.id, keyId);
  if (!revoked) flash({ err: "Kunci sudah dicabut atau bukan milik organisasi ini." });

  await audit({
    orgId: org.id,
    actorId: user.id,
    entity: "mcp_api_key",
    entityId: keyId,
    action: "revoke",
  });

  revalidatePath("/admin/mcp");
  flash({ ok: "Kunci dicabut. Client yang memakainya tidak bisa membaca data lagi." });
}
