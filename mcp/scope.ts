/**
 * Batas tenant untuk request MCP.
 *
 * Server MCP sekarang dilayani lewat HTTP (`/api/mcp`) dan setiap request membawa
 * satu API key milik satu organisasi. Supaya tool yang sudah ada tidak perlu diubah
 * satu per satu, scope disimpan di AsyncLocalStorage: `listOrgs()` hanya
 * mengembalikan org pemilik kunci, sehingga `resolveOrg()` otomatis menolak
 * permintaan ke tenant lain.
 *
 * Kalau scope kosong (server stdio lama / `npm run mcp`), semua tenant terlihat
 * seperti sebelumnya.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type OrgScope = {
  orgId: string;
  orgSlug: string;
  /** id baris mcp_api_keys yang dipakai — untuk audit & last_used_at. */
  keyId: string;
};

const storage = new AsyncLocalStorage<OrgScope>();

export function withOrgScope<T>(scope: OrgScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentOrgScope(): OrgScope | null {
  return storage.getStore() ?? null;
}
