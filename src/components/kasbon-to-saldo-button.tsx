"use client";

import { useState } from "react";
import { WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function rupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

/**
 * Tombol "Ke saldo" dengan konfirmasi.
 * Memindahkan sebagian/seluruh sisa kasbon ke saldo karyawan: kasbon berkurang,
 * saldo bertambah, lalu pelunasan berjalan lewat potongan kehadiran.
 */
export function KasbonToSaldoButton({
  advanceId,
  employeeName,
  balance,
  action,
}: {
  advanceId: string;
  employeeName: string;
  balance: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const total = Math.round(balance);
  const [amount, setAmount] = useState(String(total));

  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > total;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <WalletIcon className="size-3.5" />
        Ke saldo
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <form action={action} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Pindahkan kasbon ke saldo?</DialogTitle>
              <DialogDescription>
                Kasbon {employeeName} akan dikurangi dan saldonya ditambah, sehingga kasbon
                dibayar lewat potongan kehadiran, bukan potongan slip gaji.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="advanceId" value={advanceId} />
            <Input
              name="amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
              aria-label="Nominal yang dipindah"
            />

            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                Sisa kasbon {rupiah(total)} → {rupiah(Math.max(0, total - value))}
              </p>
              <p className="font-medium">Saldo +{rupiah(value)}</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={invalid}>
                Pindahkan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
