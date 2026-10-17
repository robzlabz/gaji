# Gaji — Payroll & Absensi

Aplikasi penggajian multi-tenant: karyawan, kontrak, absensi (clock in/out PWA), tugas, kasbon, dan slip gaji.

- Stack: Next.js 15 (App Router) + Postgres + Drizzle ORM + Better Auth + Tailwind v4
- Login karyawan: nomor HP + PIN 6 digit
- Dua dashboard: `/admin` (owner/admin) dan `/employee` (karyawan)

## Jalankan

```bash
# dari root repo
docker compose up -d

cd web
npm install
npm run db:push     # sinkron schema (pakai --force bila non-interaktif)
npm run db:seed     # data demo 2 tenant
npm run dev
```

Buka http://localhost:3000.

## Akun demo

| Peran | HP | PIN | Catatan |
|---|---|---|---|
| Owner | 0811111111 | 111111 | akses Kopi Senja & Bakery Pagi |
| Budi | 0822222222 | 222222 | per jam |
| Sari | 0833333333 | 333333 | per hari |
| Andi | 0844444444 | 444444 | per bulan |
| Rina | 0855555555 | 555555 | per tugas |
| Tono | 0866666666 | 666666 | tenant Bakery Pagi |

## Skrip

| Skrip | Fungsi |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | build produksi + lint |
| `npm run db:push` | dorong schema Drizzle ke Postgres |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | reset tenant demo + isi data contoh |

## Struktur singkat

```
src/
  app/
    admin/          dashboard owner/admin (ringkasan, karyawan, kontrak, absensi, tugas, kasbon, payroll, pengaturan)
    employee/       dashboard karyawan (clock in/out, riwayat, tugas, kasbon, slip)
    api/auth/       handler Better Auth
    api/switch-org/ ganti tenant aktif
    login/          login HP + PIN
  db/               schema Drizzle, koneksi, seed
  lib/              auth, session/tenant, payroll (kalkulasi), period, utils, audit
  components/       UI primitif
```

## Catatan desain

- `payslip_items` menyimpan snapshot (qty, tarif, jumlah) — perubahan tarif tidak mengubah slip lama.
- Satu sesi absensi terbuka per karyawan (partial unique index `time_entries_one_open`).
- Jam clock-in selalu dari server, bukan jam device.
- Semua query difilter `org_id`, bukan hanya `employee_id`.
- Kontrak yang sudah berjalan menyetir `employees.pay_rate` + dicatat di `pay_rate_history`.
