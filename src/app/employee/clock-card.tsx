"use client";

import { useState } from "react";
import { CameraIcon, CheckIcon, MapPinIcon } from "lucide-react";
import { clockInAction, clockOutAction, saveCaptureAction } from "@/app/employee/actions";
import { LiveDuration } from "@/components/live-duration";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OpenEntry = {
  clockInAtISO: string;
  breakMinutes: number;
  overtimeMinutes: number;
  overtimeNote: string | null;
  /** Foto/lokasi clock-out yang sudah tersimpan di server (hasil auto-save). */
  outPhotoSaved: boolean;
  outLat: number | null;
  outLng: number | null;
};

type Coords = { lat: number; lng: number; accuracy: number | null };

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 720;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}

export function ClockCard({ openEntry }: { openEntry: OpenEntry | null }) {
  const [photo, setPhoto] = useState<string>("");
  const [photoSaved, setPhotoSaved] = useState<boolean>(openEntry?.outPhotoSaved ?? false);
  const [coords, setCoords] = useState<Coords | null>(
    openEntry?.outLat != null && openEntry?.outLng != null
      ? { lat: openEntry.outLat, lng: openEntry.outLng, accuracy: null }
      : null,
  );
  const [coordsSaved, setCoordsSaved] = useState<boolean>(
    openEntry?.outLat != null && openEntry?.outLng != null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Jam langsung jalan begitu tombol clock in ditekan, tanpa menunggu round-trip server.
  const [optimisticStart, setOptimisticStart] = useState<string | null>(null);

  const startedAt = openEntry?.clockInAtISO ?? optimisticStart;

  /** Sudah clock in → foto/lokasi langsung ditulis ke sesi yang terbuka. */
  async function autoSave(payload: { photo?: string; lat?: number; lng?: number }): Promise<void> {
    const result = await saveCaptureAction(payload);
    if (payload.photo) setPhotoSaved(result.ok);
    if (payload.lat !== undefined) setCoordsSaved(result.ok);
    setStatus(result.message);
  }

  async function prepare(): Promise<void> {
    setBusy(true);
    setStatus("Mengambil lokasi…");
    try {
      const position = await getPosition();
      if (!position) {
        if (coordsSaved) {
          setStatus("Lokasi baru tidak didapat — lokasi yang sudah tersimpan tetap dipakai.");
        } else {
          setCoords(null);
          setStatus("Lokasi tidak tersedia — absensi tetap bisa disimpan.");
        }
        return;
      }

      const next: Coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      setCoords(next);

      if (openEntry) {
        await autoSave({ lat: next.lat, lng: next.lng });
      } else {
        setStatus("Lokasi siap — ikut tersimpan saat kamu tekan Clock in.");
      }
    } catch {
      setStatus("Gagal menyimpan lokasi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      action={openEntry ? clockOutAction : clockInAction}
      className="flex flex-col gap-3"
      onSubmit={() => {
        setBusy(true);
        if (!openEntry) setOptimisticStart(new Date().toISOString());
      }}
    >
      <input type="hidden" name="lat" value={coords?.lat ?? ""} />
      <input type="hidden" name="lng" value={coords?.lng ?? ""} />
      <input type="hidden" name="accuracy" value={coords?.accuracy ?? ""} />
      <input type="hidden" name="photo" value={photo} />

      {startedAt && (
        <div className="rounded-xl border bg-muted/40 px-3 py-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {openEntry ? "Durasi sesi berjalan" : "Menyimpan clock in…"}
          </p>
          <LiveDuration since={startedAt} className="text-2xl font-semibold tabular-nums" />
        </div>
      )}

      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          Foto &amp; lokasi opsional.{" "}
          {openEntry
            ? "Sesi sudah berjalan — foto dan lokasi langsung tersimpan otomatis."
            : "Kalau diizinkan, lokasi diambil sekali saat tombol ditekan."}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <label className="cursor-pointer">
              <CameraIcon />
              {photo || photoSaved ? "Ganti foto" : "Ambil foto"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  try {
                    const dataUrl = await fileToDataUrl(file);
                    setPhoto(dataUrl);
                    if (openEntry) {
                      await autoSave({ photo: dataUrl });
                    } else {
                      setStatus("Foto siap — ikut tersimpan saat kamu tekan Clock in.");
                    }
                  } catch {
                    setStatus("Gagal memproses foto.");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={prepare} disabled={busy}>
            <MapPinIcon />
            {coords ? "Perbarui lokasi" : "Ambil lokasi"}
          </Button>

          {photoSaved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="size-3.5" />
              Foto tersimpan
            </span>
          )}

          {coords ? (
            <span className="text-xs text-muted-foreground">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              {coords.accuracy != null ? ` (±${Math.round(coords.accuracy)}m)` : ""}
              {coordsSaved ? " · tersimpan" : ""}
            </span>
          ) : (
            coordsSaved && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="size-3.5" />
                Lokasi tersimpan
              </span>
            )
          )}
        </div>

        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt="Pratinjau foto absensi"
            className="mt-2 h-28 w-28 rounded-lg border object-cover"
          />
        )}
      </div>

      {openEntry && (
        <div className="grid gap-2 sm:grid-cols-3">
          <FormField label="Istirahat (menit)">
            <Input name="breakMinutes" defaultValue={openEntry.breakMinutes} inputMode="numeric" />
          </FormField>
          <FormField label="Lembur (menit)">
            <Input
              name="overtimeMinutes"
              defaultValue={openEntry.overtimeMinutes}
              inputMode="numeric"
            />
          </FormField>
          <FormField label="Catatan lembur">
            <Input
              name="overtimeNote"
              defaultValue={openEntry.overtimeNote ?? ""}
              placeholder="opsional"
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </FormField>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? "Menyimpan…" : openEntry ? "Clock out" : "Clock in"}
      </Button>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </form>
  );
}
