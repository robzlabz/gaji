/**
 * Endpoint MCP remote: `<APP_URL>/api/mcp` (Streamable HTTP, stateless, read-only).
 *
 * Autentikasi: `Authorization: Bearer gk_…` atau `?key=gk_…`.
 * Kunci dibuat & dicabut dari /admin/mcp.
 */
import { handleMcpRequest } from "../../../../mcp/http";

// Butuh Node (postgres.js + node:crypto), dan tidak boleh di-cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
