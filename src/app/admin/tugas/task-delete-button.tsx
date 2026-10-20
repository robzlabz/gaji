"use client";

import { deleteTaskAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function TaskDeleteButton({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
  return <Dialog>
    <DialogTrigger asChild><Button type="button" variant="destructive" size="sm">Hapus</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Hapus tugas?</DialogTitle><DialogDescription>Tugas “{taskTitle}” akan dihapus dan tidak lagi tampil di daftar atau payroll.</DialogDescription></DialogHeader>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
        <form action={deleteTaskAction}><input type="hidden" name="taskId" value={taskId} /><Button type="submit" variant="destructive">Ya, hapus tugas</Button></form>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
