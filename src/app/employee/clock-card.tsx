"use client";

import { useState } from "react";
import { CameraIcon, MapPinIcon } from "lucide-react";
import { clockInAction, clockOutAction } from "@/app/employee/actions";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OpenEntry = {
  clockInAtISO: string;
  breakMinutes: number;
  overtimeMinutes: number;
  overtimeNote: string | null;
};

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
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function prepare(): Promise<void> {
    setBusy(true);
    setStatus("Mengambil lokasi…");
    const position = await getPosition();
    if (position) {
      setCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
      setStatus("Lokasi siap.");
    } else {
      setCoords(null);
      setStatus("Lokasi tidak tersedia — absensi tetap bisa disimpan.");
    }
    setBusy(false);
  }

  return (
    <form
      action={openEntry ? clockOutAction : clockInAction}
      className="flex flex-col gap-3"
      onSubmit={() => setBusy(true)}
    >
      <input type="hidden" name="lat" value={coords?.lat ?? ""} />
      <input type="hidden" name="lng" value={coords?.lng ?? ""} />
      <input type="hidden" name="accuracy" value={coords?.accuracy ?? ""} />
      <input type="hidden" name="photo" value={photo} />

      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          Foto &amp; lokasi opsional. Kalau diizinkan, lokasi diambil sekali saat tombol ditekan.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <label className="cursor-pointer">
              <CameraIcon />
              {photo ? "Ganti foto" : "Ambil foto"}
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
                    setPhoto(await fileToDataUrl(file));
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

          {coords && (
            <span className="text-xs text-muted-foreground">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} (±{Math.round(coords.accuracy)}m)
            </span>
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
