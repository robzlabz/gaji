"use client";

import { useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizePhone } from "@/lib/format";

export function LoginForm({ next }: { next?: string }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizePhone(phone);
    if (!/^62\d{8,15}$/.test(normalized)) {
      setError("Nomor HP tidak valid. Contoh: 08123456789");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError("PIN harus 6 digit angka.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await authClient.signIn.phoneNumber({
      phoneNumber: normalized,
      password: pin,
    });

    if (signInError) {
      setLoading(false);
      setError(
        signInError.status === 429
          ? "Terlalu banyak percobaan. Coba lagi dalam 1 menit."
          : "Nomor HP atau PIN salah.",
      );
      return;
    }

    window.location.href = next && next.startsWith("/") ? next : "/";
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Nomor HP</span>
        <Input
          inputMode="tel"
          autoComplete="tel"
          placeholder="08123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">PIN (6 digit)</span>
        <Input
          className="tracking-[0.4em]"
          inputMode="numeric"
          type="password"
          autoComplete="current-password"
          maxLength={6}
          placeholder="••••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
      </label>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Memproses…" : "Masuk"}
      </Button>
    </form>
  );
}
