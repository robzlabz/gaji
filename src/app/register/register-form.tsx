"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/phone-input";
import { isValidPhone, normalizePhone } from "@/lib/format";
import { checkPhoneAvailable, provisionOwnerAccount } from "./actions";

/** Email internal: login tetap pakai nomor HP, email hanya identitas unik akun. */
function internalEmail(phone: string): string {
  return `${phone}@gaji.local`;
}

export function RegisterForm() {
  const [dial, setDial] = useState("62");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizePhone(phone, dial);
    if (!isValidPhone(normalized, dial)) {
      setError("Nomor HP tidak valid. Contoh: 08123456789");
      return;
    }
    if (name.trim().length < 2) {
      setError("Nama lengkap minimal 2 karakter.");
      return;
    }
    if (orgName.trim().length < 2) {
      setError("Nama perusahaan minimal 2 karakter.");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError("PIN harus 6 digit angka.");
      return;
    }
    if (pin !== pin2) {
      setError("PIN dan ulangi PIN tidak sama.");
      return;
    }

    setLoading(true);

    const available = await checkPhoneAvailable(normalized);
    if (!available.ok) {
      setLoading(false);
      setError(available.message);
      return;
    }

    const { error: signUpError } = await authClient.signUp.email({
      email: internalEmail(normalized),
      password: pin,
      name: name.trim(),
    });

    if (signUpError) {
      setLoading(false);
      setError(
        signUpError.code === "USER_ALREADY_EXISTS"
          ? "Nomor HP ini sudah terdaftar. Masuk lewat halaman masuk."
          : !signUpError.status || signUpError.status >= 500
            ? "Server sedang bermasalah. Coba lagi sebentar lagi."
            : (signUpError.message ?? "Pendaftaran gagal. Coba lagi."),
      );
      return;
    }

    const provisioned = await provisionOwnerAccount({ phone: normalized, orgName: orgName.trim() });
    if (!provisioned.ok) {
      // Jangan tinggalkan sesi setengah jadi: akun tanpa perusahaan.
      await authClient.signOut();
      setLoading(false);
      setError(provisioned.message);
      return;
    }

    window.location.href = "/admin";
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Nama lengkap</span>
        <Input
          autoComplete="name"
          placeholder="Nama kamu"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Nama perusahaan</span>
        <Input
          placeholder="Contoh: Kopi Senja"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
        />
      </label>

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

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">PIN (6 digit)</span>
          <Input
            className="tracking-[0.3em]"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            maxLength={6}
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Ulangi PIN</span>
          <Input
            className="tracking-[0.3em]"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            maxLength={6}
            placeholder="••••••"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
        </label>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Mendaftarkan…" : "Daftar sebagai owner"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Sudah punya akun?{" "}
        <Link href="/login?tab=owner" className="font-medium text-foreground underline-offset-4 hover:underline">
          Masuk di sini
        </Link>
      </p>
    </form>
  );
}
