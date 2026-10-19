"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Tombol hapus dengan konfirmasi.
 * Tombol di dalam dialog memakai atribut `form` supaya tetap men-submit form
 * aslinya walau dialog dirender lewat portal (di luar DOM form).
 */
export function ConfirmDeleteButton({
  formId,
  title,
  description,
  confirmLabel = "Hapus",
  triggerLabel = "Hapus",
  size = "sm",
}: {
  formId: string;
  title: string;
  description: string;
  confirmLabel?: string;
  triggerLabel?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive"
      >
        <Trash2Icon className="size-3.5" />
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form={formId} variant="destructive">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
