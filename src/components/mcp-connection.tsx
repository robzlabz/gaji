"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const MASK = "•".repeat(28);

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={`Salin ${label}`}
      title={`Salin ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard diblokir browser (mis. bukan https): biarkan user copy manual.
        }
      }}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
    </Button>
  );
}

function SecretField({
  value,
  masked,
  label,
  mono = true,
}: {
  value: string;
  masked: string;
  label: string;
  mono?: boolean;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code
        className={cn(
          "min-w-0 flex-1 truncate rounded-lg border bg-muted/60 px-2.5 py-1.5 text-sm",
          mono && "font-mono",
        )}
        title={label}
      >
        {shown ? value : masked}
      </code>
      <CopyButton value={value} label={label} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={shown ? `Sembunyikan ${label}` : `Tampilkan ${label}`}
        title={shown ? "Sembunyikan" : "Tampilkan"}
        onClick={() => setShown((prev) => !prev)}
      >
        {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </Button>
    </div>
  );
}

/**
 * Kartu koneksi MCP bergaya panel Easypanel: satu URL siap tempel, plus Server URL
 * dan header Authorization untuk client yang mendukung custom header.
 *
 * Token dikirim dari server (sudah didekripsi) hanya ke halaman admin yang login,
 * dan ditampilkan tertutup sampai user menekan tombol mata.
 */
export function McpConnectionPanel({
  serverUrl,
  token,
}: {
  serverUrl: string;
  token: string | null;
}) {
  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Belum ada kunci akses</CardTitle>
          <CardDescription>
            Buat kunci dulu supaya client MCP bisa membaca data organisasi ini.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const connectionUrl = `${serverUrl}?key=${token}`;
  const maskedConnectionUrl = `${serverUrl}?key=${MASK}`;
  const authorization = `Bearer ${token}`;
  const maskedAuthorization = `Bearer ${MASK}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hubungkan dengan MCP</CardTitle>
        <CardDescription>
          Hubungkan ChatGPT, Claude, Cursor, atau client Streamable HTTP lain ke organisasi ini.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-sm font-medium">Connection URL</h3>
            <p className="text-xs text-muted-foreground">
              Pakai ini kalau client hanya meminta satu URL server MCP.
            </p>
          </div>
          <SecretField value={connectionUrl} masked={maskedConnectionUrl} label="Connection URL" />
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium">Autentikasi Bearer</h3>
            <p className="text-xs text-muted-foreground">
              Pakai nilai ini kalau client mendukung custom header.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-medium">Server URL</h4>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/60 px-2.5 py-1.5 font-mono text-sm">
                {serverUrl}
              </code>
              <CopyButton value={serverUrl} label="Server URL" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-medium">Authorization header</h4>
            <SecretField
              value={authorization}
              masked={maskedAuthorization}
              label="Authorization header"
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Menyiapkan di client</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Buka pengaturan MCP / connector di client.</li>
            <li>Tambahkan remote server dengan transport Streamable HTTP.</li>
            <li>Tempel Connection URL, atau isi Server URL + header Authorization.</li>
            <li>Simpan, lalu minta client menampilkan daftar tool (mis. &quot;tool apa saja yang tersedia?&quot;).</li>
          </ol>
        </section>

        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            Connection URL berisi API key organisasi ini. Perlakukan seperti password: jangan
            dibagikan, dan cabut kuncinya di bawah kalau URL sempat terbuka.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
