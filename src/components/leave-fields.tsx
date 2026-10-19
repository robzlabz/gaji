import type { ComponentType } from "react";
import { CalendarOffIcon, CheckIcon, FileTextIcon, StethoscopeIcon, WalletMinimalIcon, WalletIcon } from "lucide-react";
import { FormField } from "@/components/form-field";
import { InfoTip } from "@/components/info-tip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LEAVE_KIND_OPTIONS, LEAVE_PAID_HELP, LEAVE_PAID_OPTIONS } from "@/lib/leave";

const KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  cuti: CalendarOffIcon,
  sakit: StethoscopeIcon,
  izin: FileTextIcon,
};

const PAID_ICON: Record<string, ComponentType<{ className?: string }>> = {
  "1": WalletIcon,
  "0": WalletMinimalIcon,
};

/**
 * Satu kartu pilihan berbentuk radio.
 * Input radio-nya `sr-only` tapi tetap fokusabel, jadi klik kartu = pilih,
 * dan navigasi keyboard (arrow key) tetap jalan seperti radio biasa.
 */
function ChoiceCard({
  name,
  value,
  defaultChecked,
  icon: Icon,
  label,
  hint,
  compactHint = false,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  /** Sembunyikan hint di layar sempit supaya tiga kartu tetap muat sebaris. */
  compactHint?: boolean;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="flex h-full flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted/50 peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/25 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
        <span className="flex items-center gap-1.5 pr-4 text-sm font-medium">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </span>
        {hint ? (
          <span
            className={cn("text-xs text-muted-foreground", compactHint && "hidden sm:block")}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <CheckIcon className="pointer-events-none absolute top-2 right-2 size-3.5 text-primary opacity-0 peer-checked:opacity-100" />
    </label>
  );
}

export type LeaveFieldsDefaults = {
  startDate?: string;
  endDate?: string;
  kind?: string;
  paid?: boolean;
  note?: string | null;
};

/**
 * Isian cuti yang dipakai bersama halaman admin (catat/ubah) dan halaman karyawan (ajukan/ubah).
 * Jenis & upah memakai kartu pilihan (radio), bukan dropdown, supaya sekali klik.
 */
export function LeaveFields({ defaults = {} }: { defaults?: LeaveFieldsDefaults }) {
  const kind = defaults.kind ?? "cuti";
  const paid = defaults.paid === false ? "0" : "1";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Tanggal mulai">
          <Input type="date" name="startDate" defaultValue={defaults.startDate} required />
        </FormField>
        <FormField label="Tanggal selesai" hint="Isi sama bila hanya satu hari">
          <Input type="date" name="endDate" defaultValue={defaults.endDate ?? defaults.startDate} />
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Jenis cuti</legend>
        <div className="grid grid-cols-3 gap-2">
          {LEAVE_KIND_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              name="kind"
              value={option.value}
              defaultChecked={option.value === kind}
              icon={KIND_ICON[option.value] ?? CalendarOffIcon}
              label={option.label}
              hint={option.hint}
              compactHint
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Upah
          <InfoTip label="Penjelasan upah cuti berbayar dan tanpa upah">{LEAVE_PAID_HELP}</InfoTip>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEAVE_PAID_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              name="paid"
              value={option.value}
              defaultChecked={option.value === paid}
              icon={PAID_ICON[option.value] ?? WalletIcon}
              label={option.label}
              hint={option.hint}
            />
          ))}
        </div>
      </fieldset>

      <FormField label="Catatan" hint="Opsional — alasan atau detail cuti">
        <Textarea
          name="note"
          rows={3}
          defaultValue={defaults.note ?? ""}
          placeholder="acara keluarga di luar kota"
        />
      </FormField>
    </>
  );
}
