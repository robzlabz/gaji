/**
 * Transport Streamable HTTP (SHTTP) untuk server MCP "gaji".
 *
 * Kenapa HTTP, bukan stdio?
 * Client modern (ChatGPT connector, Claude, Cursor, nanobot) bisa menambahkan remote
 * MCP server cukup dengan URL + header. Jadi tidak perlu menjalankan proses lokal,
 * dan kunci akses bisa dicabut dari UI admin.
 *
 * Mode **stateless**: server + transport baru dibuat untuk setiap request, tanpa
 * session id. Cocok untuk server read-only seperti ini — tidak ada state yang perlu
 * dipertahankan antar request, jadi aman walau app dijalankan lebih dari satu replika.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readToken } from "./keys";
import { touchKey, verifyToken } from "./keys-store";
import { withOrgScope } from "./scope";
import { createGajiMcpServer } from "./server-factory";

function rpcError(status: number, code: number, message: string, headers?: Record<string, string>) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Tutup server/transport setelah response selesai dikirim (JSON langsung, SSE saat flush). */
async function closeWhenDone(response: Response, close: () => Promise<void>): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (!response.body || !type.includes("text/event-stream")) {
    await close().catch(() => undefined);
    return response;
  }

  const body = response.body.pipeThrough(
    new TransformStream({
      flush() {
        void close().catch(() => undefined);
      },
    }),
  );
  return new Response(body, { status: response.status, headers: response.headers });
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const token = readToken(request);
  const key = token ? await verifyToken(token) : null;

  if (!key) {
    return rpcError(
      401,
      -32001,
      "Unauthorized. Kirim header 'Authorization: Bearer <token>' atau parameter ?key=<token> dari halaman Pengaturan → MCP.",
    );
  }

  touchKey(key.keyId);

  if (request.method !== "POST") {
    // Stateless: tidak ada stream yang bisa di-subscribe (GET) atau sesi yang bisa dihapus (DELETE).
    return rpcError(405, -32000, "Method not allowed. Server MCP ini stateless — gunakan POST.", {
      allow: "POST",
    });
  }

  const server = createGajiMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  return withOrgScope(
    { orgId: key.orgId, orgSlug: key.orgSlug, keyId: key.keyId },
    async () => {
      const response = await transport.handleRequest(request);
      return closeWhenDone(response, async () => {
        await transport.close();
        await server.close();
      });
    },
  );
}
