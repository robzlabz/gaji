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
cp .env.example .env.local  # lalu sesuaikan DATABASE_URL jika perlu
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
| `npm run mcp` | server MCP stdio read-only untuk AI (lihat `mcp/README.md`) |
| `npm run mcp:smoke` | uji server MCP lewat stdio: panggil semua tool, cetak hasil |
| `npm run mcp:smoke:http` | uji endpoint `/api/mcp` (Streamable HTTP) |
| `npm run mcp:key` | kelola API key MCP dari terminal (list / create / revoke) |

## MCP untuk AI (pemantauan)

Aplikasi ini melayani server [MCP](https://modelcontextprotocol.io) read-only berisi 19 tool —
ringkasan harian, absensi real-time, antrean approval, simulasi payroll, kasbon, kontrak hampir
habis, sampai audit log — supaya data Gaji bisa ditanya langsung lewat AI.

Endpoint-nya **Streamable HTTP** di `/api/mcp`, dan kuncinya dikelola dari halaman **MCP** di
dashboard admin (`/admin/mcp`): Connection URL, Server URL, header Authorization, plus tombol
buat/cabut kunci. Setiap kunci hanya bisa membaca satu organisasi.

```bash
npm run dev                        # lalu buka /admin/mcp dan salin Connection URL
npm run mcp:smoke:http -- --port 3000   # bukti jalan lewat HTTP
```

Semua query tool dibungkus transaksi `read only` + `statement_timeout` 20s, jadi tidak mungkin
mengubah data. Detail transport, auth, dan cara pasang di client: [`mcp/README.md`](mcp/README.md).

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

## Deployment

Produksi jalan di **Easypanel** (`http://43.156.18.75:3000`), project `client`:

| Komponen | Nama | Keterangan |
|---|---|---|
| App | `client/gaji` | build dari repo ini (`Dockerfile`, port 3000) |
| Database | `client/gaji-db` | Postgres 16, database & user `gaji` |
| Domain | https://gaji.timbolu.com | Traefik + Let's Encrypt |

### Env yang di-set di Easypanel

```
NODE_ENV=production
DATABASE_URL=postgres://gaji:<password>@client_gaji-db:5432/gaji
BETTER_AUTH_SECRET=<32+ karakter acak>
BETTER_AUTH_URL=https://gaji.timbolu.com
```

### Alur deploy

1. Push ke `main` → Easypanel auto-deploy (webhook GitHub App) **dan** workflow `.github/workflows/deployment.yml`.
   > Saat ini auto-deploy Easypanel yang aktif karena GitHub Actions akun ini terkunci masalah billing.
   > Kalau Actions sudah jalan, pilih salah satu: matikan `autoDeploy` di service `gaji`, atau hapus workflow-nya.
2. Image dibangun dari `Dockerfile` (multi-stage, `output: "standalone"`).
3. Saat container start: `node scripts/migrate.mjs` menjalankan migrasi Drizzle di `drizzle/` (dicatat di tabel `app_migrations`), lalu `node server.js`.

### Ubah schema

```bash
npm run db:generate    # bikin SQL migrasi baru di drizzle/
git add drizzle && git commit -m "chore(db): migrasi ..." && git push
```

Migrasi otomatis jalan saat deploy berikutnya — tidak perlu akses langsung ke database produksi.

### Deploy manual

```bash
curl -X POST "http://43.156.18.75:3000/api/deploy/<service-token>"
```

Service token ada di Easypanel → project `client` → service `gaji` → Deployments.
Workflow GitHub Actions memakai repo secret `EASYPANEL_DEPLOY_WEBHOOK` untuk URL di atas.

