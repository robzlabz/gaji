import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LeaveFields, type LeaveFieldsDefaults } from "@/components/leave-fields";

export type LeaveFormDefaults = LeaveFieldsDefaults;

/**
 * Form cuti karyawan — dipakai halaman "Ajukan cuti" dan "Ubah cuti".
 * Isian (tanggal, jenis, upah, catatan) dipakai bersama halaman admin lewat `LeaveFields`.
 * Perubahan hanya boleh selama pengajuan masih `pending` (dijaga di server action).
 */
export function LeaveForm({
  action,
  leaveId,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  leaveId?: string;
  defaults?: LeaveFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {leaveId ? <input type="hidden" name="leaveId" value={leaveId} /> : null}

      <LeaveFields defaults={defaults} />

      <div className="flex flex-col gap-2">
        <Button type="submit" className="w-full">
          {submitLabel}
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href={cancelHref}>Batal</Link>
        </Button>
      </div>
    </form>
  );
}
