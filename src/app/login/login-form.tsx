"use client";

import { useState } from "react";
import { CircleAlertIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/phone-input";
import { isValidPhone, normalizePhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resolveLoginGate, type LoginMode } from "./actions";

const MODES: Array<{
  value: LoginMode;
  label: string;
  hint: string;
  icon: typeof UserRoundIcon;
}> = [
  {
    value: "employee",
    label: "Karyawan",
    hint: "Absen, lihat tugas, kasbon, dan slip gaji.",
    icon: UserRoundIcon,
  },
  {
    value: "owner",
    label: "Owner",
    hint: "Kelola karyawan, kontrak, absensi, dan payroll.",
    icon: ShieldCheckIcon,
  },
];

export function LoginForm({ next, initialMode = "employee" }: { next?: string; initialMode?: LoginMode }) {
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [dial, setDial] = useState("62");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const active = MODES.find((item) => item.value === mode) ?? MODES[0];

  function switchMode(value: LoginMode) {
    if (loading || value === mode) return;
    setMode(value);
    setError(null);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Sanitasi terakhir di klien; server tetap memvalidasi ulang.
    // Menerima 0822…, 822…, 62 822…, +62 822… → 62822…
    const normalized = normalizePhone(phone, dial);
    if (!isValidPhone(normalized, dial)) {
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

    // Kredensial benar, tapi tab menentukan role yang diharapkan.
    // Salah tab → sesi dibatalkan supaya tidak setengah masuk.
    const gate = await resolveLoginGate(mode);
    if (!gate.ok) {
      await authClient.signOut();
      setLoading(false);
      setPin("");
      setError(gate.message);
      return;
    }

    window.location.href = next && next.startsWith("/") ? next : gate.href;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label="Masuk sebagai"
          className="flex gap-1 rounded-lg bg-muted p-[3px]"
        >
          {MODES.map((item) => {
            const Icon = item.icon;
            const selected = item.value === mode;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={selected}
                disabled={loading}
                onClick={() => switchMode(item.value)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                  selected
                    ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-foreground/15"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{active.hint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Nomor HP</span>
        <PhoneInput
          name="phone"
          defaultDial="ID"
          onChange={({ dial: nextDial, phone: nextPhone }) => {
            setDial(nextDial);
            setPhone(nextPhone);
          }}
        />
      </div>

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
        {loading ? "Memproses…" : `Masuk sebagai ${active.label.toLowerCase()}`}
      </Button>
    </form>
  );
}
