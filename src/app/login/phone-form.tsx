"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/phone-input";
import { isValidPhone, normalizePhone } from "@/lib/format";
import { findLoginAccount } from "./actions";

/**
 * Langkah 1: hanya nomor HP. PIN tidak diminta di sini.
 *
 * Nomor yang tidak punya akun langsung ditolak dengan pesan "tidak memiliki akun
 * atau belum terdaftar"; nomor yang terdaftar dibawa ke halaman PIN tersendiri.
 */
export function PhoneForm({ next }: { next?: string }) {
  const router = useRouter();
  const [dial, setDial] = useState("62");
  const [country, setCountry] = useState("ID");
  const [phone, setPhone] = useState("");
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

    setLoading(true);
    const account = await findLoginAccount(normalized, dial);
    if (!account.ok) {
      setLoading(false);
      setError(account.message);
      return;
    }

    const params = new URLSearchParams({ phone: account.phone, c: country });
    if (next) params.set("next", next);
    // Sengaja tanpa `setLoading(false)`: tombol tetap "Memeriksa…" sampai halaman PIN tampil.
    router.push(`/login/pin?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Nomor HP</span>
        <PhoneInput
          name="phone"
          defaultDial="ID"
          autoFocus
          onChange={({ country: nextCountry, dial: nextDial, phone: nextPhone }) => {
            setCountry(nextCountry);
            setDial(nextDial);
            setPhone(nextPhone);
          }}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Memeriksa nomor…" : "Lanjut"}
        {loading ? null : <ArrowRightIcon />}
      </Button>
    </form>
  );
}
