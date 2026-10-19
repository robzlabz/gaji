# Gaji MCP — pemantauan payroll untuk AI

Server [MCP](https://modelcontextprotocol.io) read-only yang membuka data aplikasi Gaji ke AI
(ChatGPT connector, Claude, Cursor, nanobot, dsb), supaya pertanyaan seperti *"siapa yang belum
clock-in hari ini?"* atau *"periode ini payroll-nya berapa?"* bisa dijawab langsung dari data asli.

Ada dua cara memakainya:

| Transport | Kapan dipakai |
| --- | --- |
| **Streamable HTTP** (default) — endpoint `/api/mcp` di aplikasi Next.js | Client remote yang cukup diberi URL + header. Kunci akses dibuat/dicabut dari halaman **Pengaturan → MCP** (`/admin/mcp`). |
| stdio — `npm run mcp` | Client lokal yang hanya bisa menjalankan proses (mis. Claude Desktop lama). Tanpa API key, membaca semua tenant. |

## Kenapa baca DB, bukan HTTP API?

Aplikasi ini tidak punya REST API — semua mutasi lewat Next server action. Untuk pemantauan,
cara paling jujur adalah membaca tabel yang sama dengan yang dipakai UI, jadi angka yang
dilaporkan AI identik dengan dashboard. Pengamanannya:

- setiap query tool dijalankan di dalam transaksi `read only`, jadi MCP ini tidak bisa mengubah data;
- `statement_timeout` 20 detik dan pool maksimal 3 koneksi (`application_name = gaji-mcp`);
- `gaji_query` hanya menerima `SELECT`/`WITH` — kata kunci tulis (`insert`, `update`, `delete`,
  `drop`, `alter`, `create`, `grant`, `truncate`) ditolak sebelum dikirim ke Postgres;
- setiap request HTTP wajib membawa API key yang **terikat ke satu organisasi** (lihat di bawah).

## Streamable HTTP (cara utama)

### Endpoint

```
POST <APP_URL>/api/mcp          # JSON-RPC MCP (initialize, tools/list, tools/call, …)
GET  <APP_URL>/api/mcp          # 405 — server stateless, tidak ada stream untuk di-subscribe
DELETE <APP_URL>/api/mcp        # 405 — tidak ada sesi yang perlu dihapus
```

Mode **stateless**: server + transport baru dibuat untuk setiap request, tanpa session id, dan
`enableJsonResponse: true` (balasan JSON, bukan SSE). Cocok untuk server read-only dan aman kalau
app dijalankan lebih dari satu replika.

### Autentikasi

Dua bentuk, isinya sama:

```http
Authorization: Bearer gk_…
```

```
<APP_URL>/api/mcp?key=gk_…
```

Tanpa token valid → `401` dengan body JSON-RPC `-32001` (server tidak menyentuh database).
Kunci yang sudah dicabut langsung ditolak pada request berikutnya.

### Mengelola kunci

Lewat UI: **/admin/mcp** (menu **MCP** di sidebar admin) — menampilkan Connection URL, Server URL,
header Authorization, langkah pemasangan di client, dan daftar kunci (buat / cabut / lihat kapan
terakhir dipakai).

Lewat terminal:

```bash
cd web
npm run mcp:key                                         # daftar kunci semua org
npm run mcp:key -- create --org kopi-senja --name "Claude Desktop"
npm run mcp:key -- revoke --id <uuid-kunci>
```

Penyimpanan token di tabel `mcp_api_keys`:

| Kolom | Isi |
| --- | --- |
| `token_hash` | sha256 token — dipakai untuk mencocokkan Bearer token (tidak bisa dibalik) |
| `token_cipher` | token terenkripsi AES-256-GCM (kunci turunan `BETTER_AUTH_SECRET`) — hanya untuk menampilkan ulang URL di UI |
| `token_prefix` | potongan awal (`gk_ab12cd34`) untuk ditampilkan di daftar |
| `last_used_at` | diisi otomatis setiap ada request yang memakai kunci itu |
| `revoked_at` | diisi saat kunci dicabut; baris tidak dihapus supaya jejaknya tetap ada |

Karena `token_cipher` bergantung pada `BETTER_AUTH_SECRET`, mengganti secret membuat kunci lama
tidak bisa ditampilkan lagi (hash-nya tetap valid, jadi client yang sudah terpasang tetap jalan).
Solusinya: buat kunci baru.

### Batas tenant

API key terikat ke satu organisasi. Semua tool yang memakai `resolveOrg()` hanya melihat org
pemilik kunci, dan `gaji_list_orgs` hanya mengembalikan satu org. Permintaan eksplisit ke org lain
ditolak dengan pesan yang jelas.

Pengecualian: `gaji_query` (SELECT bebas) tetap bisa membaca seluruh database — itu memang jalan
pintas untuk pertanyaan yang tidak tercakup tool lain. Kalau akses seluas itu tidak diinginkan,
jangan pakai tool tersebut atau arahkan MCP ke user Postgres yang hanya punya hak `SELECT` pada
view yang sudah difilter per org.

### Pasang di client

ChatGPT / Claude / Cursor (remote MCP): tempel **Connection URL** dari `/admin/mcp`, atau isi
Server URL `<APP_URL>/api/mcp` + header `Authorization: Bearer gk_…`.

nanobot (`~/.nanobot/config.json`, bagian `mcp_servers`) memakai bentuk yang sama:

```json
{
  "mcp_servers": {
    "gaji": {
      "url": "https://gaji.timbolu.com/api/mcp",
      "headers": { "Authorization": "Bearer gk_…" }
    }
  }
}
```

## stdio (opsional)

```bash
cd web
npm run mcp                        # server stdio untuk client MCP
npm run mcp:smoke                  # uji: panggil semua tool lewat stdio
npm run mcp:smoke -- kopi-senja    # opsional: pilih tenant
```

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gaji": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/Users/robbyn/Documents/projects/gaji/web",
      "env": { "GAJI_DATABASE_URL": "postgres://gaji:gaji@localhost:5434/gaji" }
    }
  }
}
```

Env:

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | dipakai otomatis dari `.env` / `.env.local` |
| `GAJI_DATABASE_URL` | menimpa `DATABASE_URL` — mis. untuk memantau DB produksi tanpa mengubah env app |

## Daftar tool (19)

| Tool | Isi |
| --- | --- |
| `gaji_list_orgs` | daftar tenant + jumlah karyawan aktif (untuk tahu slug org) |
| `gaji_org_settings` | pengaturan tenant (zona waktu, awal periode, hari kerja/bulan, pengali lembur, alert kontrak, geofence) + akses: member per role dan karyawan yang belum punya akun login |
| `gaji_overview` | snapshot dashboard: periode berjalan, headcount per tipe gaji, absensi hari ini, antrean approval, kontrak hampir habis, kasbon, total payroll |
| `gaji_list_employees` | cari/daftar karyawan: tipe gaji, tarif, status, saldo kasbon, sudah punya akun login atau belum |
| `gaji_employee_profile` | satu karyawan lengkap: riwayat tarif, kontrak, kasbon, absensi 30 hari, cuti, tugas, slip terakhir |
| `gaji_contracts` | semua kontrak: jenis (PKWT/PKWTT/percobaan), periode, tarif di kontrak, status (active/renewed/terminated), sisa hari, rantai perpanjangan |
| `gaji_contracts_expiring` | kontrak aktif yang berakhir dalam N hari (default `contract_alert_days` org) atau sudah lewat |
| `gaji_attendance_report` | rekap absensi per karyawan dalam rentang tanggal (default periode berjalan): entri, jam kerja, lembur, belum clock-out, di luar geofence |
| `gaji_attendance_live` | real-time: siapa sedang bekerja, siapa selesai, siapa belum clock-in, entri menggantung dari hari sebelumnya |
| `gaji_pending_approvals` | kotak masuk approval: absensi pending, cuti pending, kasbon pending, tugas `done` yang belum di-approve |
| `gaji_leaves` | pengajuan cuti/sakit/izin + jumlah hari + berbayar atau tidak |
| `gaji_pay_periods` | periode gaji terakhir: status, jumlah slip, total gross/potongan/net |
| `gaji_payslips` | slip satu periode; bila `employee` diisi, tampilkan rincian item slip |
| `gaji_payroll_preview` | simulasi payroll periode dari data approved (tidak menyimpan apa pun) + sisa data yang belum di-approve |
| `gaji_kasbon` | kasbon berjalan: pokok, sisa, cicilan, dan potongan periode ini (mengikuti `cash_advance_plans`) |
| `gaji_kasbon_txns` | buku kasbon: kapan dicairkan (`disburse`) dan kapan dipotong slip (`repay`), plus slip mana yang memotong |
| `gaji_tasks` | tugas borongan: status, qty, nilai (qty × tarif) |
| `gaji_audit_log` | jejak perubahan terakhir: siapa mengubah apa (approve absensi, ubah tarif, hapus data, …) |
| `gaji_query` | SELECT bebas untuk pertanyaan yang tidak tercakup tool lain |

Semua nominal dalam Rupiah, tanggal mengikuti zona waktu organisasi (`organizations.timezone`),
dan periode gaji mengikuti `pay_period_start_day` masing-masing org.

## Uji

```bash
cd web
npm run mcp:smoke:http -- --port 3001        # HTTP: 401 untuk token salah, initialize, tools/list, 5 tool call, cek scope tenant
npm run mcp:smoke:http -- --port 3001 --key gk_…
npm run mcp:smoke                            # stdio: panggil semua tool
```

`mcp:smoke:http` tanpa `--key` membuat kunci sementara sendiri lewat DB, jadi cukup jalankan
setelah `npm run dev`. Terakhir dijalankan: **8/8 cek lulus** (`--port 3010`, 2026-10-19) dan
stdio **19/19 tool** sukses.

## Batasan

- Ini jembatan baca saja. Aksi (approve absensi, jalankan payroll, catat kasbon) tetap lewat UI;
  menambah aksi tulis butuh keputusan desain tersendiri (auth, audit, idempotensi).
- MCP butuh akses langsung ke Postgres. Untuk produksi, arahkan `GAJI_DATABASE_URL` ke read
  replica / user Postgres yang hanya punya hak `SELECT`.
- Belum ada rate limit per kunci; kalau endpoint dibuka ke internet publik, tambahkan di depan
  (reverse proxy) atau batasi jumlah kunci aktif.
