"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { btnPrimary, inputClass } from "@/components/ui";
import { normalizePhone } from "@/lib/utils";

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
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-700">Nomor HP</span>
        <input
          className={inputClass}
          inputMode="tel"
          autoComplete="tel"
          placeholder="08123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-700">PIN (6 digit)</span>
        <input
          className={`${inputClass} tracking-[0.4em]`}
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
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" className={`${btnPrimary} w-full`} disabled={loading}>
        {loading ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
