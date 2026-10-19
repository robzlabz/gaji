"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { rupiah } from "@/lib/format";

export type AdvanceFormDefaults = {
  principal?: string | number | null;
  installmentAmount?: string | number | null;
  note?: string | null;
};

/** Ketik angka → tampil dengan pemisah ribuan (server tetap menerima angka bersih). */
function formatThousands(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function digitsOf(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

/**
 * Form pengajuan kasbon karyawan.
 * Checkbox "dicicil" menentukan cara bayar: tidak dicentang = bayar langsung
 * (potong penuh sekali gaji), dicentang = dipotong sebesar cicilan per periode.
 */
export function AdvanceForm({
  action,
  advanceId,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  advanceId?: string;
  defaults?: AdvanceFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  const [cicil, setCicil] = useState(Number(defaults.installmentAmount ?? 0) > 0);
  const [principal, setPrincipal] = useState(
    defaults.principal ? formatThousands(String(Math.round(Number(defaults.principal)))) : "",
  );
  const [installment, setInstallment] = useState(
    defaults.installmentAmount
      ? formatThousands(String(Math.round(Number(defaults.installmentAmount))))
      : "",
  );

  const principalNumber = digitsOf(principal);
  const installmentNumber = digitsOf(installment);
  const periodCount =
    principalNumber > 0 && installmentNumber > 0
      ? Math.ceil(principalNumber / installmentNumber)
      : 0;

  return (
    <form action={action} className="flex flex-col gap-4">
      {advanceId ? <input type="hidden" name="advanceId" value={advanceId} /> : null}

      <FormField label="Nominal kasbon (Rp)">
        <Input
          name="principal"
          inputMode="numeric"
          placeholder="500.000"
          value={principal}
          onChange={(event) => setPrincipal(formatThousands(event.target.value))}
          required
        />
      </FormField>

      <label className="flex items-start gap-2 rounded-xl border p-3">
        <input
          type="checkbox"
          name="cicil"
          value="1"
          checked={cicil}
          onChange={(event) => setCicil(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Dicicil per periode gaji</span>
          <span className="text-xs text-muted-foreground">
            {cicil
              ? "Kasbon dipotong sesuai nominal cicilan setiap periode sampai lunas."
              : principalNumber > 0
                ? `Tanpa cicilan = bayar langsung, ${rupiah(principalNumber)} dipotong penuh pada periode berikutnya.`
                : "Tanpa cicilan = bayar langsung, pokok dipotong penuh sekali gaji."}
          </span>
        </span>
      </label>

      {cicil ? (
        <FormField
          label="Cicilan per periode (Rp)"
          hint={
            periodCount > 0
              ? `Tidak boleh melebihi pokok · lunas dalam ${periodCount} periode`
              : "Tidak boleh melebihi nominal kasbon"
          }
        >
          <Input
            name="installmentAmount"
            inputMode="numeric"
            placeholder="250.000"
            value={installment}
            onChange={(event) => setInstallment(formatThousands(event.target.value))}
            required
          />
        </FormField>
      ) : null}

      <FormField label="Keterangan / catatan" hint="Opsional">
        <Input
          name="note"
          defaultValue={defaults.note ?? ""}
          placeholder="biaya sekolah anak"
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
