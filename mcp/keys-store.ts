/**
 * Penyimpanan API key MCP (tabel `mcp_api_keys`).
 *
 * Dipakai dua sisi:
 * - route handler `/api/mcp` (verifikasi Bearer token tiap request);
 * - halaman /admin/mcp + script `npm run mcp:key` (buat, tampilkan, cabut).
 *
 * Query di sini memakai koneksi drizzle aplikasi (bukan koneksi read-only milik
 * tool MCP), karena memang perlu menulis metadata key dan `last_used_at`.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { mcpApiKeys, organizations } from "../src/db/schema";
import { decryptToken, encryptToken, generateToken, hashToken, tokenPrefix } from "./keys";

export type VerifiedKey = {
  keyId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
};

export type KeyRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  token: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** Cocokkan Bearer token ke kunci aktif. Null = tidak dikenal atau sudah dicabut. */
export async function verifyToken(token: string): Promise<VerifiedKey | null> {
  const [row] = await db
    .select({
      keyId: mcpApiKeys.id,
      orgId: mcpApiKeys.orgId,
      orgSlug: organizations.slug,
      orgName: organizations.name,
    })
    .from(mcpApiKeys)
    .innerJoin(organizations, eq(mcpApiKeys.orgId, organizations.id))
    .where(and(eq(mcpApiKeys.tokenHash, hashToken(token)), isNull(mcpApiKeys.revokedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * Catat pemakaian terakhir. Sengaja tidak di-await di jalur request supaya
 * kegagalan menulis metadata tidak menggagalkan panggilan tool.
 */
export function touchKey(keyId: string): void {
  void db
    .update(mcpApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpApiKeys.id, keyId))
    .catch(() => undefined);
}

/** Daftar kunci satu org; token dibuka (decrypt) supaya URL bisa ditampilkan lagi. */
export async function listKeys(orgId: string): Promise<KeyRow[]> {
  const rows = await db
    .select()
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.orgId, orgId))
    .orderBy(desc(mcpApiKeys.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    token: row.revokedAt ? null : decryptToken(row.tokenCipher),
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }));
}

/** Buat kunci baru dan kembalikan token aslinya (hanya dipakai untuk ditampilkan). */
export async function createKey(input: {
  orgId: string;
  createdBy?: string | null;
  name?: string;
}): Promise<{ id: string; token: string }> {
  const token = generateToken();
  const [row] = await db
    .insert(mcpApiKeys)
    .values({
      orgId: input.orgId,
      createdBy: input.createdBy ?? null,
      name: input.name?.trim() || "MCP",
      tokenPrefix: tokenPrefix(token),
      tokenHash: hashToken(token),
      tokenCipher: encryptToken(token),
    })
    .returning({ id: mcpApiKeys.id });

  return { id: row.id, token };
}

/** Cabut kunci (bukan hapus) supaya jejaknya masih ada di audit. */
export async function revokeKey(orgId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .update(mcpApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpApiKeys.orgId, orgId), eq(mcpApiKeys.id, keyId), isNull(mcpApiKeys.revokedAt)))
    .returning({ id: mcpApiKeys.id });

  return rows.length > 0;
}
