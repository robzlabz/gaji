"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveLoginGate } from "../actions";

const PIN_LENGTH = 6;

/**
 * Langkah 2: PIN 6 digit di kotak terpisah (satu kotak per digit).
 *
 * Nomor HP sudah divalidasi di langkah 1, jadi form ini hanya mengurus PIN:
 * auto-pindah fokus, backspace mundur satu kotak, dan tempel 6 digit sekaligus.
 */
export function PinForm({ phone, next }: { phone: string; next?: string }) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(PIN_LENGTH).fill(""));
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const wasLoading = useRef(false);

  const code = digits.join("");
  const complete = code.length === PIN_LENGTH;

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  // Kotak dinonaktifkan selama verifikasi, jadi fokus tidak bisa dipindah saat itu.
  // Begitu proses selesai (PIN salah / sesi ditolak), kembalikan fokus ke kotak pertama.
  useEffect(() => {
    if (wasLoading.current && !loading) inputs.current[0]?.focus();
    wasLoading.current = loading;
  }, [loading]);

  function focusAt(index: number) {
    const target = inputs.current[Math.min(Math.max(index, 0), PIN_LENGTH - 1)];
    target?.focus();
    target?.select();
  }

  function clear() {
    setDigits(Array<string>(PIN_LENGTH).fill(""));
  }

  function setDigit(index: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    setError(null);

    if (!clean) {
      setDigits((prev) => prev.map((digit, i) => (i === index ? "" : digit)));
      return;
    }

    // Tempel "123456" di satu kotak → sebar ke kotak berikutnya.
    setDigits((prev) => {
      const spread = [...prev];
      for (let i = 0; i < clean.length && index + i < PIN_LENGTH; i += 1) {
        spread[index + i] = clean[i];
      }
      return spread;
    });
    focusAt(index + clean.length);
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index]) {
      event.preventDefault();
      setDigits((prev) => prev.map((digit, i) => (i === index - 1 ? "" : digit)));
      focusAt(index - 1);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      setDigits((prev) => prev.map((digit, i) => (i === index ? "" : digit)));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
      return;
    }
    if (event.key === "Enter" && complete) {
      event.preventDefault();
      void submit();
    }
  }

  function onPaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    setDigit(index, pasted);
  }

  async function submit() {
    if (loading) return;
    if (!complete) {
      setError("PIN harus 6 digit angka.");
      return;
    }

    setError(null);
    setLoading(true);

    const { error: signInError } = await authClient.signIn.phoneNumber({
      phoneNumber: phone,
      password: code,
    });

    if (signInError) {
      setLoading(false);
      clear();
      // Jangan samakan gangguan server dengan PIN salah — dulu pesan "PIN salah"
      // muncul juga saat API auth sedang error.
      setError(
        signInError.status === 429
          ? "Terlalu banyak percobaan. Coba lagi dalam 1 menit."
          : !signInError.status || signInError.status >= 500
            ? "Server sedang bermasalah. Coba lagi sebentar lagi."
            : "PIN salah. Periksa lagi 6 digit PIN kamu.",
      );
      return;
    }

    // PIN benar: tujuan ditentukan role akun yang sebenarnya (tanpa tab manual).
    const gate = await resolveLoginGate();
    if (!gate.ok) {
      await authClient.signOut();
      setLoading(false);
      clear();
      setError(gate.message);
      return;
    }

    window.location.href = next && next.startsWith("/") ? next : gate.href;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">PIN (6 digit)</span>
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            aria-pressed={reveal}
            aria-label={reveal ? "Sembunyikan PIN" : "Tampilkan PIN"}
            className="inline-flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {reveal ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            {reveal ? "Sembunyikan" : "Tampilkan"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onPaste={(event) => onPaste(index, event)}
              onFocus={(event) => event.currentTarget.select()}
              type={reveal ? "text" : "password"}
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              aria-label={`Digit PIN ke-${index + 1}`}
              aria-invalid={Boolean(error)}
              maxLength={1}
              disabled={loading}
              className={cn(
                "h-12 w-full min-w-0 rounded-lg border border-input bg-transparent text-center text-lg font-semibold tabular-nums transition-colors",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-60",
                digit && "border-foreground/40",
                error && "border-destructive/60",
              )}
            />
          ))}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        disabled={loading || !complete}
      >
        {loading ? "Memverifikasi…" : "Verifikasi"}
      </Button>
    </form>
  );
}
