import { headers } from "next/headers";
import { formatDateTimeID } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { listKeys } from "../../../../mcp/keys-store";
import { Flash } from "@/components/flash";
import { EmptyState } from "@/components/empty-state";
import { McpConnectionPanel } from "@/components/mcp-connection";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createMcpKeyAction, revokeMcpKeyAction } from "./actions";

/** URL publik aplikasi ini, dipakai untuk menyusun connection URL MCP. */
async function appBaseUrl(): Promise<string> {
  const header = await headers();
  const host = header.get("x-forwarded-host") ?? header.get("host");
  if (host) {
    const proto =
      header.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export default async function McpPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { org } = await requireAdmin();
  const { ok, err } = await searchParams;

  const keys = await listKeys(org.id);
  const active = keys.filter((key) => !key.revokedAt);
  const primary = active.find((key) => key.token) ?? null;

  const serverUrl = `${await appBaseUrl()}/api/mcp`;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="text-sm text-muted-foreground">
          {org.name} · akses AI read-only ke data organisasi ini lewat Model Context Protocol.
        </p>
      </header>

      <Flash ok={ok} err={err} />

      <McpConnectionPanel serverUrl={serverUrl} token={primary?.token ?? null} />

      <Card>
        <CardHeader>
          <CardTitle>Kunci akses</CardTitle>
          <CardDescription>
            Setiap kunci hanya bisa membaca data {org.name}. Cabut kunci yang tidak dipakai lagi —
            client-nya langsung ditolak pada request berikutnya.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={createMcpKeyAction} className="flex flex-col gap-2 sm:flex-row">
            <Input
              name="name"
              placeholder="Nama kunci (mis. Claude Desktop)"
              maxLength={60}
              className="sm:max-w-xs"
            />
            <Button type="submit">Buat kunci baru</Button>
          </form>

          {keys.length === 0 ? (
            <EmptyState
              title="Belum ada kunci"
              hint="Buat kunci baru untuk mendapatkan connection URL."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead className="hidden sm:table-cell">Potongan kunci</TableHead>
                    <TableHead className="hidden md:table-cell">Dibuat</TableHead>
                    <TableHead>Terakhir dipakai</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {key.tokenPrefix}…
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                        {formatDateTimeID(key.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {key.lastUsedAt ? (
                          <time dateTime={key.lastUsedAt.toISOString()}>
                            {formatDateTimeID(key.lastUsedAt)}
                          </time>
                        ) : (
                          "belum pernah"
                        )}
                      </TableCell>
                      <TableCell>
                        {key.revokedAt ? (
                          <StatusBadge tone="bad">Dicabut</StatusBadge>
                        ) : (
                          <StatusBadge tone="good">Aktif</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {key.revokedAt ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <form action={revokeMcpKeyAction}>
                            <input type="hidden" name="keyId" value={key.id} />
                            <Button type="submit" variant="outline" size="sm">
                              Cabut
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Token disimpan terenkripsi (AES-256-GCM, kunci turunan BETTER_AUTH_SECRET) dan hanya
            bisa dibuka oleh admin organisasi ini. Semua tool bersifat read-only. Catatan: tool
            <code className="mx-1 font-mono">gaji_query</code>
            (SELECT bebas) adalah jalan pintas yang bisa membaca seluruh database — cabut kunci
            kalau akses seluas itu tidak diinginkan.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
