import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, SelectInput } from "@/components/form-field";
import { LEAVE_KIND_OPTIONS } from "@/lib/leave";

export type LeaveFormDefaults = {
  startDate?: string;
  endDate?: string;
  kind?: string;
  paid?: boolean;
  note?: string | null;
};

/**
 * Form cuti karyawan — dipakai halaman "Ajukan cuti" dan "Ubah cuti".
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

      <FormField label="Tanggal mulai">
        <Input type="date" name="startDate" defaultValue={defaults.startDate} required />
      </FormField>

      <FormField label="Tanggal selesai" hint="Isi sama bila hanya satu hari">
        <Input type="date" name="endDate" defaultValue={defaults.endDate ?? defaults.startDate} />
      </FormField>

      <FormField label="Jenis">
        <SelectInput name="kind" defaultValue={defaults.kind ?? "cuti"}>
          {LEAVE_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectInput>
      </FormField>

      <FormField label="Upah" hint="Tanpa upah = gaji bulan ini diprorata turun">
        <SelectInput name="paid" defaultValue={defaults.paid === false ? "0" : "1"}>
          <option value="1">Berbayar (gaji tetap)</option>
          <option value="0">Tanpa upah</option>
        </SelectInput>
      </FormField>

      <FormField label="Catatan" hint="Opsional">
        <Input
          name="note"
          defaultValue={defaults.note ?? ""}
          placeholder="acara keluarga di luar kota"
        />
      </FormField>

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
