#!/usr/bin/env node
/**
 * Entry point stdio server MCP "gaji".
 *
 * Cara utama sekarang lewat HTTP: jalankan aplikasi (`npm run dev` / produksi) lalu
 * pakai connection URL dari halaman /admin/mcp. Entry stdio ini tetap ada untuk client
 * yang hanya bisa menjalankan proses lokal (mis. Claude Desktop versi lama).
 *
 * Jalankan:  npx tsx mcp/server.ts
 * Uji HTTP:  npm run mcp:smoke -- --url http://localhost:3001/api/mcp --key gk_…
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sql } from "./core";
import { createGajiMcpServer } from "./server-factory";

// stdout adalah kanal JSON-RPC: jangan pernah menulis log biasa ke sana.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

// stdio lokal tidak memakai API key/tenant scope, jadi `gaji_query` boleh didaftarkan.
const server = createGajiMcpServer({ rawQuery: true });

server
  .connect(new StdioServerTransport())
  .then(() => console.error("[gaji-mcp] siap (stdio, read-only)"))
  .catch((error) => {
    console.error("[gaji-mcp] gagal start:", error);
    process.exit(1);
  });

async function shutdown(signal: string) {
  console.error(`[gaji-mcp] ${signal} — menutup koneksi`);
  try {
    await sql.end({ timeout: 3 });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
