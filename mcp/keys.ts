/**
 * Token akses server MCP: pembuatan, hashing, dan enkripsi untuk ditampilkan ulang.
 *
 * Kenapa tidak menyimpan token apa adanya?
 * Connection URL di halaman admin harus bisa dibuka lagi kapan pun (seperti panel
 * Easypanel), tapi menyimpan token plaintext di database berarti satu dump DB =
 * akses penuh ke data payroll. Jadi:
 *   - token disimpan sebagai sha256 (`tokenHash`) untuk verifikasi cepat;
 *   - token disimpan terenkripsi AES-256-GCM (`tokenCipher`) hanya untuk display.
 *
 * Kunci enkripsi diturunkan dari BETTER_AUTH_SECRET (sudah wajib ada untuk login).
 * Kalau secret diganti, kunci lama tidak bisa ditampilkan lagi — tapi hash-nya tetap
 * valid, jadi client yang sudah terpasang tidak putus; cukup buat kunci baru untuk
 * menampilkan URL.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "gk_";

/** Token acak baru: `gk_` + 32 byte base64url (43 karakter). */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Sidik jari token untuk pencarian di DB (deterministik, aman disimpan). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Potongan awal token untuk ditampilkan (`gk_ab12cd34`). */
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 8);
}

function encryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET belum diset — tidak bisa mengenkripsi token MCP.");
  }
  return createHash("sha256").update(`gaji-mcp:${secret}`).digest();
}

/** `iv.tag.ciphertext` (base64url) — format sederhana yang aman untuk satu kolom teks. */
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(payload: string): string | null {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // Secret berubah atau data rusak: tampilkan sebagai "tidak bisa dibuka".
    return null;
  }
}

/** Ambil token dari header `Authorization: Bearer …` atau query `?key=…`. */
export function readToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("key") ?? url.searchParams.get("api_key");
  return fromQuery?.trim() || null;
}
