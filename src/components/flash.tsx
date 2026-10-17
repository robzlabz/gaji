import { CircleCheckIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Pesan hasil aksi (dari query string ?ok / ?err) memakai Alert shadcn. */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;

  if (err) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Gagal</AlertTitle>
        <AlertDescription>{err}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>Berhasil</AlertTitle>
      <AlertDescription>{ok}</AlertDescription>
    </Alert>
  );
}
