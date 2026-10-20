"use client";

import { FormField, SelectInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EmployeeOption = { id: string; fullName: string; payType: string };
type Defaults = { title?: string; employeeId?: string | null; qty?: string; unit?: string;
  unitRate?: string; workDate?: string; description?: string | null };

export function TaskForm({ action, employees, defaults, taskId, cancelHref, submitLabel }: {
  action: (formData: FormData) => void | Promise<void>;
  employees: EmployeeOption[];
  defaults: Defaults;
  taskId?: string;
  cancelHref: string;
  submitLabel: string;
}) {
  return <form action={action} className="flex flex-col gap-3">
    {taskId ? <input type="hidden" name="taskId" value={taskId} /> : null}
    <FormField label="Judul tugas"><Input name="title" defaultValue={defaults.title} placeholder="Potong 20 pcs bahan kaos" required /></FormField>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Karyawan</legend>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
        <input type="radio" name="employeeId" value="" defaultChecked={!defaults.employeeId} className="accent-primary" />
        <span><span className="block font-medium">Belum ditentukan</span><span className="text-xs text-muted-foreground">Tugas belum ditugaskan ke karyawan tertentu</span></span>
      </label>
      {employees.map((employee) => <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
        <input type="radio" name="employeeId" value={employee.id} defaultChecked={defaults.employeeId === employee.id} className="accent-primary" />
        <span><span className="block font-medium">{employee.fullName}</span><span className="text-xs text-muted-foreground">{employee.payType === "per_task" ? "Per tugas" : "Karyawan"}</span></span>
      </label>)}
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Jumlah (qty)"><Input name="qty" inputMode="decimal" defaultValue={defaults.qty ?? "1"} /></FormField>
      <FormField label="Satuan"><Input name="unit" defaultValue={defaults.unit ?? "tugas"} /></FormField>
      <FormField label="Tarif per satuan (Rp)"><Input name="unitRate" inputMode="numeric" defaultValue={defaults.unitRate} placeholder="15000" required /></FormField>
      <FormField label="Tanggal kerja"><Input type="date" name="workDate" defaultValue={defaults.workDate} required /></FormField>
    </div>
    <FormField label="Deskripsi"><Input name="description" defaultValue={defaults.description ?? ""} placeholder="opsional" /></FormField>
    <div className="flex gap-2"><Button type="submit">{submitLabel}</Button><Button type="button" variant="outline" asChild><a href={cancelHref}>Batal</a></Button></div>
  </form>;
}

