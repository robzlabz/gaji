import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center text-center">
          <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-muted">
            <ShieldAlertIcon className="size-5 text-muted-foreground" />
          </span>
          <CardTitle>Akun belum terhubung ke perusahaan</CardTitle>
          <CardDescription>
            Akunmu belum terdaftar sebagai anggota perusahaan mana pun. Minta admin menambahkan
            nomor HP kamu sebagai karyawan.
          </CardDescription>
          <p className="text-sm text-muted-foreground">
            Jika akunmu baru dinonaktifkan sebagai karyawan, hubungi admin perusahaan untuk
            mengaktifkannya kembali.
          </p>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Kembali ke halaman masuk</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
