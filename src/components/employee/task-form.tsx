import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { TASK_UNIT_OPTIONS } from "@/lib/task";

export type TaskFormDefaults = {
  title?: string;
  qty?: string | number;
  unit?: string;
  workDate?: string;
  description?: string | null;
};

/**
 * Form tugas karyawan — dipakai halaman "Ajukan tugas" dan "Ubah tugas".
 * Harga tidak ada di form ini: tarif diisi admin saat approval.
 */
export function TaskForm({
  action,
  taskId,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  taskId?: string;
  defaults?: TaskFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {taskId ? <input type="hidden" name="taskId" value={taskId} /> : null}

      <FormField label="Judul tugas">
        <Input
          name="title"
          defaultValue={defaults.title}
          placeholder="Potong 20 pcs bahan kaos"
          required
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Jumlah">
          <Input
            name="qty"
            inputMode="decimal"
            defaultValue={defaults.qty ?? "1"}
            required
          />
        </FormField>
        <FormField label="Satuan" hint="Boleh ketik sendiri">
          <Input
            name="unit"
            defaultValue={defaults.unit ?? "tugas"}
            list="task-unit-options"
            autoComplete="off"
          />
        </FormField>
        <datalist id="task-unit-options">
          {TASK_UNIT_OPTIONS.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>
      </div>

      <FormField label="Tanggal kerja">
        <Input type="date" name="workDate" defaultValue={defaults.workDate} required />
      </FormField>

      <FormField label="Keterangan" hint="Opsional — detail pekerjaan atau lokasi">
        <Textarea
          name="description"
          rows={3}
          defaultValue={defaults.description ?? ""}
          placeholder="Contoh: kaos seri A, 20 pcs, selesai sebelum jam 5"
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
