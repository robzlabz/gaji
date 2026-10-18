"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { COUNTRIES, DEFAULT_COUNTRY, findCountry, type Country } from "@/lib/countries";
import { formatPhoneDisplay, isValidPhone, normalizePhone } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PhoneInputProps = {
  /** name untuk input nomor (nilai mentah, dinormalisasi di server). */
  name?: string;
  /** name untuk input hidden berisi kode negara terpilih (ISO alpha-2). */
  dialName?: string;
  defaultDial?: string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Dipanggil setiap kali nomor / kode negara berubah. */
  onChange?: (value: { country: string; dial: string; phone: string }) => void;
  /** Tampilkan pratinjau hasil sanitasi di bawah input. */
  showPreview?: boolean;
  className?: string;
};

/**
 * Input nomor HP dengan dropdown kode negara (default Indonesia +62).
 * Nilai yang dikirim ke server selalu dinormalisasi ke `<kode negara><nomor>`
 * tanpa "+" dan tanpa 0 di depan — sama dengan yang disimpan Better Auth.
 */
export function PhoneInput({
  name = "phone",
  dialName = "phoneDial",
  defaultDial = DEFAULT_COUNTRY.code,
  defaultValue = "",
  placeholder = "812 3456 7890",
  autoFocus = false,
  onChange,
  showPreview = true,
  className,
}: PhoneInputProps) {
  const [dial, setDial] = useState(() => findCountry(defaultDial).code);
  const [phone, setPhone] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const country = findCountry(dial);
  const normalized = normalizePhone(phone, country.dial);
  const valid = isValidPhone(phone, country.dial);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dial.startsWith(q),
    );
  }, [query]);

  useEffect(() => {
    // `country`: ISO alpha-2 ("ID"), `dial`: kode panggil ("62"),
    // `phone`: nomor lengkap tanpa "+" ("628222222222").
    onChange?.({ country: country.code, dial: country.dial, phone: normalized });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country.code, country.dial, normalized]);

  // Tutup popover saat klik di luar atau tekan Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Fokus ke kolom pencarian & reset posisi setiap popover dibuka.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const id = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function pick(next: Country) {
    setDial(next.code);
    setOpen(false);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const next = filtered[highlight] ?? filtered[0];
      if (next) pick(next);
    }
  }

  return (
    <div ref={wrapperRef} className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Kode negara: ${country.name} +${country.dial}`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-input px-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <span aria-hidden className="text-base leading-none">
            {country.flag}
          </span>
          <span className="tabular-nums">+{country.dial}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>

        <Input
          name={name}
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="flex-1"
        />

        <input type="hidden" name={dialName} value={country.code} />

        {open ? (
          <div className="absolute top-full left-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
            <div className="flex items-center gap-2 border-b px-2.5 py-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Cari negara atau kode…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Negara tidak ditemukan.
                </p>
              ) : (
                filtered.map((c, index) => {
                  const active = c.code === country.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-idx={index}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(c)}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                        index === highlight && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span aria-hidden className="text-base leading-none">
                        {c.flag}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">+{c.dial}</span>
                      {active ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      {showPreview ? (
        <span
          className={cn(
            "text-xs",
            phone && !valid ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {phone
            ? valid
              ? `Akan dipakai: ${formatPhoneDisplay(normalized, country.dial)}`
              : "Nomor belum valid — periksa jumlah digit."
            : `Format bebas: 0812…, 812…, atau +${country.dial} 812…`}
        </span>
      ) : null}
    </div>
  );
}
