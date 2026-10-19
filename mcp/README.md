# Gaji MCP — pemantauan payroll untuk AI

Server [MCP](https://modelcontextprotocol.io) read-only yang membuka data aplikasi Gaji ke AI
(Claude Desktop, Cursor, nanobot, dsb), supaya pertanyaan seperti *"siapa yang belum clock-in
hari ini?"* atau *"periode ini payroll-nya berapa?"* bisa dijawab langsung dari data asli.

## Kenapa baca DB, bukan HTTP API?

Aplikasi ini tidak punya REST API — semua mutasi lewat Next server action. Untuk pemantauan,
cara paling jujur adalah membaca tabel yang sama dengan yang dipakai UI, jadi angka yang
dilaporkan AI identik dengan dashboard. Pengamanannya:

- setiap query dijalankan di dalam transaksi `read only`, jadi MCP ini tidak bisa mengubah data;
- `statement_timeout` 20 detik dan pool maksimal 3 koneksi (`application_name = gaji-mcp`);
- `gaji_query` hanya menerima `SELECT`/`WITH` — kata kunci tulis (`insert`, `update`, `delete`,
  `drop`, `alter`, `create`, `grant`, `truncate`) ditolak sebelum dikirim ke Postgres.

## Menjalankan

```bash
cd web
npm run mcp          # server stdio untuk client MCP
npm run mcp:smoke    # uji cepat: nyalakan server, panggil 14 tool, cetak hasilnya
npm run mcp:smoke -- kopi-senja   # opsional: pilih tenant
```

Env:

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | dipakai otomatis dari `.env` / `.env.local` |
| `GAJI_DATABASE_URL` | menimpa `DATABASE_URL` — mis. untuk memantau DB produksi tanpa mengubah env app |

Kalau hanya ada satu tenant, parameter `org` di semua tool boleh dikosongkan.

## Daftar tool (16)

| Tool | Isi |
| --- | --- |
| `gaji_list_orgs` | daftar tenant + jumlah karyawan aktif (untuk tahu slug org) |
| `gaji_overview` | snapshot dashboard: periode berjalan, headcount per tipe gaji, absensi hari ini, antrean approval, kontrak hampir habis, kasbon, total payroll |
| `gaji_list_employees` | cari/daftar karyawan: tipe gaji, tarif, status, saldo kasbon, sudah punya akun login atau belum |
| `gaji_employee_profile` | satu karyawan lengkap: riwayat tarif, kontrak, kasbon, absensi 30 hari, cuti, tugas, slip terakhir |
| `gaji_contracts_expiring` | kontrak aktif yang berakhir dalam N hari (default `contract_alert_days` org) atau sudah lewat |
| `gaji_attendance_report` | rekap absensi per karyawan dalam rentang tanggal (default periode berjalan): entri, jam kerja, lembur, belum clock-out, di luar geofence |
| `gaji_attendance_live` | real-time: siapa sedang bekerja, siapa selesai, siapa belum clock-in, entri menggantung dari hari sebelumnya |
| `gaji_pending_approvals` | kotak masuk approval: absensi pending, cuti pending, kasbon pending, tugas `done` yang belum di-approve |
| `gaji_leaves` | pengajuan cuti/sakit/izin + jumlah hari + berbayar atau tidak |
| `gaji_pay_periods` | periode gaji terakhir: status, jumlah slip, total gross/potongan/net |
| `gaji_payslips` | slip satu periode; bila `employee` diisi, tampilkan rincian item slip |
| `gaji_payroll_preview` | simulasi payroll periode dari data approved (tidak menyimpan apa pun) + sisa data yang belum di-approve |
| `gaji_kasbon` | kasbon berjalan: pokok, sisa, cicilan, dan potongan periode ini (mengikuti `cash_advance_plans`) |
| `gaji_tasks` | tugas borongan: status, qty, nilai (qty × tarif) |
| `gaji_audit_log` | jejak perubahan terakhir: siapa mengubah apa (approve absensi, ubah tarif, hapus data, …) |
| `gaji_query` | SELECT bebas untuk pertanyaan yang tidak tercakup tool lain |

Semua nominal dalam Rupiah, tanggal mengikuti zona waktu organisasi (`organizations.timezone`),
dan periode gaji mengikuti `pay_period_start_day` masing-masing org.

## Pasang di client MCP

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

nanobot (`~/.nanobot/config.json`, bagian `mcp_servers`) memakai bentuk yang sama
(`command` + `args` + `env`); pastikan `cwd` menunjuk folder `web/`.

## Uji

`npm run mcp:smoke` menyalakan server lewat stdio, memanggil 14 tool (semua kecuali
`gaji_employee_profile` dan `gaji_payslips` yang butuh id karyawan), lalu mencetak hasilnya —
kalau ada yang gagal, exit code 1. Terakhir dijalankan: **14/14 sukses**.

## Batasan

- Ini jembatan baca saja. Aksi (approve absensi, jalankan payroll, catat kasbon) tetap lewat UI;
  menambah aksi tulis butuh keputusan desain tersendiri (auth, audit, idempotensi).
- Butuh akses langsung ke Postgres, jadi jangan diekspos ke publik. Untuk produksi, arahkan
  `GAJI_DATABASE_URL` ke read replica / user Postgres yang hanya punya hak `SELECT`.
