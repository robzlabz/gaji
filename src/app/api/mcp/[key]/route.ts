/**
 * Endpoint MCP remote berbasis path: `<APP_URL>/api/mcp/<KEY>` (Streamable HTTP,
 * stateless, read-only).
 *
 * Satu URL lengkap tanpa header — cukup ditempel ke client yang hanya meminta
 * Server URL (mis. connector ChatGPT/Claude). Bentuk lama (`/api/mcp` + header
 * `Authorization: Bearer` atau `?key=`) tetap dilayani oleh route di sebelah.
 *
 * Kunci dibuat & dicabut dari /admin/mcp.
 */
import { handleMcpRequest } from "../../../../../mcp/http";

// Butuh Node (postgres.js + node:crypto), dan tidak boleh di-cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next.js 15: params adalah Promise.
type RouteContext = { params: Promise<{ key: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { key } = await context.params;
  return handleMcpRequest(request, key);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { key } = await context.params;
  return handleMcpRequest(request, key);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { key } = await context.params;
  return handleMcpRequest(request, key);
}
