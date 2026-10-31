# Roadmap MVP Gaji

Dokumen ini adalah rencana kerja dari sisi CTO untuk membawa Gaji ke status **MVP yang bisa dipakai tanpa error dan tanpa cacat perhitungan**. Isinya bukan daftar keinginan: setiap butir punya bukti (file:baris), kriteria selesai yang bisa diuji, dan urutan yang sadar dependensi.

Terakhir diperbarui: 31 Oktober 2026 · dasar audit: `main` @ `df5d6cf`.

---

## 1. Ringkasan eksekutif

Produknya sudah jauh melampaui MVP dari sisi fitur: multi-tenant, karyawan & kontrak, absensi PWA, cuti, tugas, kasbon, saldo prabayar, payroll + slip, dan server MCP read-only. Yang belum ada adalah **jaminan bahwa angka yang dibayar benar dan bahwa rilis bisa sampai ke produksi**.

Tiga temuan yang mendefinisikan seluruh rencana:

1. **Jalur rilis putus.** `main` tidak bisa di-build (`src/app/employee/page.tsx:110`, type error). Workflow Deploy tercatat **0 sukses dari 33 run** — semuanya berhenti karena akun Actions terkunci masalah billing. Produksi `gaji.timbolu.com` masih image lama (rute `/api/mcp/<key>` yang rilis 24 Okt masih 404).
2. **Inti perhitungan sudah benar untuk kasus yang dites, tetapi belum untuk kasus yang dibayar.** Tiga script cek (`check:cuti`, `check:saldo`, `check:csv`) lulus, namun semuanya menguji fungsi murni di jalur bahagia. Seluruh P0 yang terkonfirmasi (#27, #35, #37, #61, #62, #63, #64) hidup di kode yang **tidak punya satu pun tes**.
3. **Ada satu jalur pengambilalihan lintas tenant.** `resetPinAction` mengganti kredensial global `userId`, sehingga admin org A bisa mereset PIN orang yang merupakan owner org B, lalu masuk sebagai owner org B.

Konsekuensi strategis: **jangan menambah fitur dulu.** MVP didefinisikan sebagai "satu organisasi pilot bisa menjalankan satu periode payroll penuh, angkanya cocok dengan hitungan manual, dan tidak ada uang yang hilang atau dibayar dua kali."

---

## 2. Definisi MVP

### 2.1 Masuk cakupan (harus benar sebelum dianggap MVP)

| Kapabilitas | Bukti ada | Status kualitas |
| --- | --- | --- |
| Login nomor HP + PIN, multi-organisasi | `src/app/login/**`, `src/lib/session.ts` | Berfungsi; perlu hardening (#65, enumerasi nomor) |
| Data karyawan & riwayat tarif | `src/app/admin/karyawan/**`, `pay_rate_history` | Berfungsi; tarif tidak deterministik (#69) |
| Kontrak & perpanjangan | `src/app/admin/kontrak/**` | Kontrak bertanggal masa depan tidak pernah berlaku (#62) |
| Absensi clock-in/out + approval + PWA | `src/app/employee/clock-card.tsx`, `/admin/absensi` | Absensi pending periode lalu tidak bisa di-approve (#37) |
| Cuti (berbayar / tanpa upah) | `src/lib/leave.ts`, `computePayslip` | Cuti tanpa upah tidak memotong gaji tanpa absensi (#26) |
| Tugas berbasis kuantitas | `src/lib/task.ts`, `/admin/tugas` | Tugas tanpa karyawan bisa di-approve tapi tidak dibayar (#67) |
| Kasbon + saldo prabayar | `src/lib/kasbon*.ts`, `src/lib/saldo*.ts` | Saldo bisa menggelembung & upah dibayar dua kali (#34, #35, #64, #66) |
| Payroll run + slip + ekspor CSV | `src/lib/payroll-run.ts`, `/admin/payroll` | Void tidak mengembalikan potongan; tugas bisa dibayar dua kali (#27, #61) |
| MCP read-only untuk AI | `mcp/**`, `/api/mcp` | Angka berbeda dari aplikasi (#28, #70) |

### 2.2 Di luar cakupan MVP (ditunda, jangan dikerjakan sekarang)

- PPh 21, BPJS, THR, dan pelaporan pajak.
- Transfer bank / disbursement otomatis.
- Aplikasi mobile native (PWA sudah cukup).
- Multi-mata uang, multi-negara (kolom `countries.ts` tetap ada, tidak diaktifkan).
- Payroll terjadwal otomatis (cron) dan notifikasi WhatsApp/email.
- Portal karyawan lanjutan (slip PDF massal, pengajuan pinjaman baru).

### 2.3 Prinsip yang mengikat semua pekerjaan

1. **Uang tidak boleh ambigu.** Setiap angka rupiah harus punya satu sumber kebenaran. Kalau dua tempat menghitung hal yang sama, salah satunya harus dihapus.
2. **Tidak ada perubahan yang masuk produksi tanpa gate.** Build + typecheck + lint + script cek harus lulus otomatis.
3. **Periode payroll yang sudah final bersifat beku.** Data yang membentuk slip final tidak boleh berubah diam-diam.
4. **Satu organisasi pilot dulu.** Rilis ke banyak tenant setelah satu periode terbukti cocok.

---

## 3. Kondisi saat ini (bukti terverifikasi)

### 3.1 Yang sudah lulus

| Cek | Hasil |
| --- | --- |
| `npx tsx scripts/check-cuti-payroll.ts` | lulus, 14 kasus (prorata, cuti berbayar/tanpa upah, `joinedAt`, `endedAt`) |
| `npx tsx scripts/check-saldo.ts` | lulus, 20 kasus (accrual, lembur, shortfall, tarif campuran, kasbon vs tunai) |
| `npx tsx scripts/check-csv.ts` | lulus, 16 kasus (CSV injection dinetralkan) |
| `npx eslint` | 0 error, 3 warning (variabel tak terpakai di `admin/tugas`) |
| `npm run build` (dengan env placeholder) | **lulus** di branch `fix/build-paytype`, gagal di `main` |

### 3.2 Yang menghalangi

| # | Temuan | Bukti | Dampak |
| --- | --- | --- | --- |
| B1 | `main` gagal build (type error) | `src/app/employee/page.tsx:110` vs `clock-card.tsx:54` | Tidak ada rilis yang bisa dibuat |
| B2 | CI tidak pernah jalan | 33/33 run gagal, "account is locked due to a billing issue" | Tidak ada gate, tidak ada deploy otomatis |
| B3 | Produksi tertinggal | `/api/mcp/<key>` 404 padahal rilis 24 Okt; 200 di `/login` | Pengguna memakai versi lama tanpa diketahui |
| B4 | Journal migrasi desync | `drizzle/0004_soft_delete_time_entries.sql` ada, tanpa snapshot & entri journal | `drizzle-kit generate` berikutnya menghasilkan migrasi duplikat yang mematikan container saat start |
| B5 | Build bergantung `DATABASE_URL` saat import | `mcp/core.ts:33-39` | Build lokal/PR gagal tanpa env; CI bergantung pada placeholder |
| B6 | Tidak ada tes otomatis | tidak ada `test` script, tidak ada `*.test.*` | Semua P0 di kode tak bertes |

### 3.3 Temuan uang yang paling berbahaya

Diurutkan berdasarkan kerugian, bukan berdasarkan nomor issue:

1. **`settleShortfall` tidak dibatasi bruto slip** (`src/app/admin/actions.ts:1343-1352` + `src/lib/saldo.ts:121-130`). Nilai `settle` diambil dari selisih accrual ledger, bukan dari uang yang benar-benar diserahkan. Digabung #34 (accrual memakai tarif bulanan sebagai tarif per jam), satu karyawan bulanan bisa menghasilkan accrual puluhan juta, slip mencatat "pelunasan tunai" sebesar itu, dan saldo menjadi plus puluhan juta — semua periode berikutnya otomatis "sudah dibayar via saldo" dan tidak ada uang tunai yang diserahkan. **Ini satu baris perbaikan dengan nilai tertinggi di seluruh audit.**
2. **#34** — accrual saldo memakai `payRate` apa adanya untuk semua `payType` (`saldo-server.ts:152`), padahal karyawan harian/bulanan boleh di-top-up dari `/admin/saldo/baru`.
3. **#35** — approve sebelum clock-out, lalu clock-out tidak pernah memicu accrual ulang → upah hari itu dibayar lewat slip **dan** tidak pernah memotong saldo.
4. **#64** — tombol "Hitung ulang dari absensi approved" meng-accrue seluruh riwayat tanpa batas tanggal/status slip.
5. **#61** — tugas lama bisa masuk slip sebagai "bawaan" sekaligus di periode asalnya.
6. **#27** — void periode tidak mengembalikan potongan kasbon/saldo, dan periode tidak bisa dihitung ulang.
7. **#26 / #56 / #55 / #37 / #63 / #62 / #67** — kasus upah hilang atau kelebihan bayar yang lebih sempit tetapi rutin terjadi.

---

## 4. Gate rilis

MVP hanya boleh diumumkan kalau **kelima gate** ini hijau. Gate ini yang menggantikan "sepertinya sudah jalan".

| Gate | Isi | Cara membuktikan |
| --- | --- | --- |
| **G1 — Rilis** | `main` build hijau, CI menjalankan typecheck + lint + script cek, deploy otomatis ke Easypanel | push ke `main` → workflow sukses → `/login` 200 dengan build id baru |
| **G2 — Uang** | Semua invariant payroll lulus otomatis | `npm run check:all` hijau di CI (lihat §6) |
| **G3 — Tenant & auth** | Tidak ada jalur lintas tenant; login tidak membocorkan data | daftar tes keamanan §6.3 lulus + review manual |
| **G4 — Operasional** | Backup harian, rollback image, migrasi ber-lock, error terlihat | uji restore 1x + uji rollback 1x + error boundary terpasang |
| **G5 — Pilot** | Satu org pilot menyelesaikan 1 periode penuh; slip direkonsiliasi manual | selisih = Rp 0 untuk seluruh karyawan pilot |

---

## 5. Roadmap per fase

Setiap fase punya satu tujuan yang bisa dinyatakan dalam satu kalimat. Fase berikutnya tidak dimulai sebelum gate fasenya hijau.

### Fase 0 — Buka jalur rilis (target: 2 hari)

**Tujuan:** perubahan apa pun bisa sampai ke produksi dengan aman.

| Pekerjaan | Rujukan | Ukuran |
| --- | --- | --- |
| Merge perbaikan build `payType` | PR `fix/build-paytype` | build hijau di `main` |
| Perbaiki billing Actions, lalu tambah gate `tsc --noEmit`, `eslint`, dan ketiga script cek ke workflow | `.github/workflows/deployment.yml` | workflow hijau pada push berikutnya |
| Verifikasi env produksi: `BETTER_AUTH_SECRET` (≥32 char acak), `BETTER_AUTH_URL` | `src/lib/auth.ts:10-12` | tidak ada warning "default secret" di log |
| Perbaiki journal migrasi + advisory lock di `scripts/migrate.mjs` | `drizzle/meta/_journal.json`, B4 | `drizzle-kit generate` tidak menghasilkan diff |
| Putuskan ketergantungan build pada `DATABASE_URL` (lazy import di `mcp/core.ts`) | B5 | `npm run build` tanpa env = sukses |

**Gate Fase 0:** G1 hijau.

### Fase 1 — Keamanan & integritas tenant (target: minggu 1)

**Tujuan:** tidak ada data tenant lain yang bisa dibaca atau diambil alih.

| Pekerjaan | Rujukan | Prioritas |
| --- | --- | --- |
| Tolak reset PIN untuk user yang punya membership admin/owner di org lain | `src/app/admin/actions.ts:361-387`, `src/lib/accounts.ts:52-63` | P0 |
| `findLoginAccount` hanya mengembalikan boolean; hapus nama & role dari halaman PIN anonim; rate-limit | `src/app/login/actions.ts:39-82`, `src/app/login/pin/page.tsx:33,61` | P0 |
| Jangan set `phoneNumberVerified: true` tanpa verifikasi; sediakan jalur admin melepas nomor | `src/lib/accounts.ts:38`, `register/actions.ts:93` | P1 |
| Helper `safeNextPath()` untuk `next` pasca-PIN | `login/pin/pin-form.tsx:146`, issue #65 | P1 |
| URL koneksi MCP dari base URL terkonfigurasi, token lewat header, tambah expiry + rate limit | `admin/mcp/page.tsx:23-34`, `mcp/keys.ts:84-96` | P1 |
| Kunci mutasi absensi pada periode payroll `approved`/`paid` | issue #29 | P0 |

**Gate Fase 1:** G3 hijau.

### Fase 2 — Determinisme input (target: minggu 1–2)

**Tujuan:** angka yang sama selalu dihasilkan dari data yang sama, kapan pun dihitung.

| Pekerjaan | Rujukan | Catatan |
| --- | --- | --- |
| Urutkan riwayat tarif + tie-break `created_at`, lalu unique index `(employee, kind, effective_from)` | issue #69, `src/lib/saldo.ts:41-52` | tanpa ini semua fix berikutnya tidak bisa diverifikasi |
| Ganti semua `new Date().toISOString().slice(0,10)` dengan `localDateString(date, org.timezone)` | issue #59, 7 lokasi di `admin/actions.ts` + `saldo-server.ts:621` | bug 00:00–07:00 WIB |
| Satu fungsi `periodStartFor(year, month, startDay)` untuk `periodContaining`/`shiftPeriod`/`recentPeriods` + script sweep startDay 1–31 × 2025–2027 | issue #46, `src/lib/period.ts` | identitas periode adalah kunci join `pay_periods.period_start` |
| Validasi server action: `qty > 0`, `payRate > 0`, `payType` ∈ daftar, `kind` kontrak, `renewedFromId` milik karyawan yang sama | issue #58, `admin/actions.ts:249-253,391-486,930,973` | sekaligus menghapus cast `as PayType` |
| Kontrak tumpang tindih atomik (transaksi + row lock atau exclusion constraint) | issue #44 | |

**Gate Fase 2:** G2 bagian determinisme hijau.

### Fase 3 — Upah benar (target: minggu 2–3)

**Tujuan:** setiap komponen slip — gaji pokok, lembur, ongkos, tugas — dibayar sesuai aturan yang disepakati owner.

| Pekerjaan | Rujukan | Keputusan yang dibutuhkan |
| --- | --- | --- |
| Cuti tanpa upah memotong gaji bulanan meski tanpa absensi | #26 | rumus: `employedWorkDays − unpaidLeaveDays` |
| "Hari kerja efektif per bulan" dipakai untuk prorata | #57 | **owner**: model minggu kerja (Senin–Sabtu vs pengaturan org) |
| Gaji harian memakai tarif per tanggal absensi | #56 | — |
| Lembur untuk harian & bulanan, atau field-nya disembunyikan + peringatan | #55 | **owner**: rumus turunan upah lembur non-jam |
| Absensi pending lintas periode bisa di-approve | #37 | — |
| Reaktivasi karyawan membersihkan `endedAt`; tolak `endedAt` lampau untuk karyawan aktif | #63 | — |
| Kontrak bertanggal masa depan selalu menulis riwayat tarif dan diterapkan saat payroll | #62 | — |
| Tugas tanpa karyawan tidak bisa di-approve | #67 | — |
| Ongkos kedatangan untuk harian/bulanan: dipakai atau field-nya dihapus | #68 | **owner** |

**Gate Fase 3:** setiap aturan upah punya kasus uji di `scripts/check-*.ts`.

### Fase 4 — Saldo & kasbon benar (target: minggu 3–4)

**Tujuan:** ledger saldo dan slip tidak pernah berbeda, dan tidak ada uang yang dibayar dua kali.

| Pekerjaan | Rujukan | Catatan |
| --- | --- | --- |
| Batasi `shortfall`/`settle` pada bruto slip: `min(accrualTotal, gross) − covered` | `admin/actions.ts:1343-1352` | **perbaikan satu baris, nilai tertinggi** |
| Simpan `saldoCovered` yang sudah dibatasi ke `payslips` | `admin/actions.ts:1295` vs `payroll.ts:366` | laporan & CSV jadi rekonsiliasi |
| Accrual menghormati `payType` (atau batasi saldo hanya untuk `hourly`) | #34 | **owner**: dukung saldo untuk harian/bulanan? |
| Accrual memakai `overtimeMultiplier` organisasi | #66 | — |
| `occurredAt` ikut ter-update; approve menolak tanpa clock-out; clock-out memicu accrual ulang | #35 | — |
| Batasi "Hitung ulang dari absensi approved" pada absensi yang belum masuk slip final | #64 | — |
| Void mengembalikan repay + settle, mengecualikan `void` dari guard, validasi transisi status | #27 | — |
| Pindahkan penulisan repay/settle ke saat finalisasi, bukan saat draft | `admin/actions.ts:1319-1352` | draft yang ditinggal tidak boleh mengubah utang |
| `notExists` pada `payslip_items` untuk tugas (cegah bayar dua kali) | #61 | pertimbangkan `work_tasks.paid_in_payslip_id` |
| Snapshot saldo kasbon per periode (bukan saldo berjalan) | `kasbon.ts:59,78` | recompute harus idempoten |

**Gate Fase 4:** G2 hijau penuh, termasuk invariant ledger vs slip.

### Fase 5 — Paritas & guardrail (target: minggu 4–5)

**Tujuan:** tidak ada tempat kedua yang menghitung hal berbeda, dan kegagalan terlihat sebelum pengguna mengeluh.

| Pekerjaan | Rujukan |
| --- | --- |
| MCP memanggil logika preview yang sama; hapus SQL sendiri; `deleted_at is null` di semua query | #28, #70 |
| Root `error.tsx` + `global-error.tsx`, structured logging, error reporter | F16 |
| Backup harian + uji restore + rollback image didokumentasikan | G4 |
| Hapus `db:push` dari dokumentasi produksi, guard saat `NODE_ENV=production` | F13 |
| Audit untuk `deletePayrollDraftAction` | F15 |
| Cap ukuran foto absensi, clamp lembur/istirahat, validasi geofence | F6–F8 |
| Format waktu mengikuti zona org; kontrol foto bisa diakses keyboard | #30, #60 |

**Gate Fase 5:** G4 hijau.

### Fase 6 — Pilot & rilis (target: minggu 5–6)

1. Onboarding satu organisasi pilot dengan data nyata (bukan seed).
2. Jalankan satu periode payroll penuh: draft → review → approve → paid.
3. Rekonsiliasi manual: hitung ulang slip 3 karyawan (per jam, harian, bulanan) di spreadsheet, bandingkan dengan slip.
4. Perbaiki selisih apa pun sebelum menambah tenant kedua.
5. Baru setelah itu: buka onboarding.

**Gate Fase 6:** G5 hijau → MVP dinyatakan siap.

---

## 6. Strategi tes: dari "sudah dicek" ke "terbukti"

### 6.1 Prinsip

Semua bug P0 hari ini berada di kode yang tidak punya tes. Tes tidak ditulis setelah fitur; tes adalah definisi "selesai" untuk setiap perbaikan di §5.

### 6.2 Struktur

```
scripts/
  check-payroll.ts      # semua tipe gaji × kehadiran × cuti × lembur × ongkos
  check-saldo.ts        # (ada) accrual, coverage, settle, kasbon
  check-kasbon.ts       # cicilan, override, tunda, sisa utang
  check-period.ts       # sweep startDay 1–31 × 2025–2027
  check-rate.ts         # riwayat tarif, tarif campuran, tie-break
  check-invariant.ts    # ledger vs slip (lihat 6.4)
  check-csv.ts          # (ada)
```

Satu perintah: `npm run check:all` → dipanggil CI sebelum build.

### 6.3 Kasus wajib (minimum untuk MVP)

**Upah**

- Per jam: kehadiran penuh, sebagian, tanpa clock-out, tarif berubah di tengah periode, lembur dengan pengali, ongkos per kedatangan.
- Harian: tarif berubah di tengah periode, lembur, hari tanpa clock-out.
- Bulanan: penuh, prorata masuk/berhenti, cuti berbayar, cuti tanpa upah tanpa absensi, tanpa absensi sama sekali, organisasi 5 hari kerja.
- Tugas: qty × tarif, tugas telat approve (bawaan), tugas tanpa karyawan, tugas negatif ditolak.
- Kombinasi: gaji + tugas + ongkos + kasbon + saldo dalam satu slip.

**Saldo & kasbon**

- Accrual per `payType`; lembur memakai pengali; approve sebelum clock-out; edit tanggal; hapus absensi.
- Saldo kurang → shortfall tunai; saldo lebih → tidak hangus; `settle` tidak menambah dana periode.
- Kasbon: cicilan, override, ditunda, sisa utang, kasbon saat upah sudah dibayar saldo (net tidak minus).
- Resync tidak meng-accrue absensi yang sudah dibayar tunai.

**Periode & tarif**

- Setiap tanggal jatuh tepat di satu periode (sweep penuh).
- Dua perubahan tarif di hari yang sama → hasil deterministik.
- Kontrak mulai masa depan → tarif berlaku saat tanggalnya tiba.

**Keamanan**

- `next` pasca-PIN menolak `//evil.com` dan `/\evil.com`.
- Reset PIN lintas tenant ditolak.
- Semua server action admin menolak ID milik org lain.
- Ekspor CSV menetralkan `=`, `+`, `-`, `@`, tab, CR.

### 6.4 Invariant yang wajib lulus

Ini yang mengubah "mudah-mudahan benar" menjadi gate:

```
I1. gross slip = Σ baris upah (reguler + lembur + tugas + ongkos)
I2. net = gross − potongan, dan net ≥ 0
I3. Σ accrual ledger periode = komponen upah slip periode (± ongkos), untuk karyawan bersaldo
I4. settle ≤ tunai yang benar-benar diserahkan = net
I5. saldo akhir periode = saldo awal + dana masuk − accrual − settle
I6. satu absensi / satu tugas hanya masuk paling banyak satu slip non-void
I7. payroll draft yang dihitung dua kali menghasilkan angka identik (idempoten)
I8. total slip = Σ bruto seluruh karyawan (tidak ada baris hilang saat grouping)
```

I3 dan I4 sendirian akan menangkap #34, #35, #64, #66, dan bug `settle` di §3.3 sekaligus.

---

## 7. Peta issue → fase

| Fase | Issue | Jumlah |
| --- | --- | --- |
| 0 | B1–B6 (temuan audit), PR build | 6 |
| 1 | #29, #65, #58, F3, F4, F5, F9, F10 | 8 |
| 2 | #69, #59, #46, #44 | 4 |
| 3 | #26, #37, #55, #56, #57, #62, #63, #67, #68 | 9 |
| 4 | #27, #34, #35, #61, #64, #66, settle cap, saldo snapshot | 8 |
| 5 | #28, #30, #60, #70, F6–F16 | 13 |
| 6 | pilot & rekonsiliasi | — |

Sisa issue terbuka yang tidak masuk tabel di atas adalah duplikat atau sudah diperbaiki di `main` (#36 sudah diperbaiki oleh `80c2c53`; #48, #49, #47, #45, #39, #38, #33, #31, #25, #23, #13, #7, #5 sudah tertutup).

---

## 8. Keputusan yang menunggu owner

Empat hal ini tidak bisa diputuskan engineering karena mengubah angka yang dibayar:

1. **Model minggu kerja** — prorata memakai Senin–Sabtu (25–27 hari) atau pengaturan "hari kerja efektif per bulan" (#57)?
2. **Lembur non-jam** — karyawan harian/bulanan dibayar lembur dengan rumus apa, atau field lembur disembunyikan (#55)?
3. **Ongkos kedatangan** — berlaku untuk semua tipe gaji atau hanya per jam (#68)?
4. **Saldo prabayar** — hanya untuk karyawan per jam, atau semua tipe (#34)?

Sampai keempatnya dijawab, Fase 3 dan 4 tetap bisa dikerjakan untuk bagian yang tidak bergantung keputusan (mis. #56, #37, #63, #62, #67, settle cap, #35, #61, #27).

---

## 9. Ritme kerja

| Ritme | Isi | Keluaran |
| --- | --- | --- |
| Harian (otomatis) | cek kesehatan repo: build, typecheck, lint, script cek, status CI, kesehatan produksi, triase issue baru | laporan singkat + issue baru bila ada temuan |
| Mingguan (manual) | review gate fase, perbarui dokumen ini, putuskan urutan berikutnya | status gate G1–G5 |
| Per rilis | jalankan seluruh gate, rekonsiliasi satu slip secara manual | catatan rilis |

Detail jadwal otomatis ada di `docs/automation.md` (heartbeat 30 menit, audit harian 00:00 WIB) dan pada jadwal pengecekan repo yang dipasang untuk sesi CTO ini.

---

## 10. Risiko utama

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Perbaikan payroll dikerjakan tanpa tes | Bug baru menggantikan bug lama | Setiap PR wajib menambah kasus di `scripts/check-*.ts`; CI menolak bila gagal |
| Actions tetap terkunci billing | Tidak ada gate, tidak ada deploy | Perbaiki billing di Fase 0; sampai itu, gate dijalankan manual sebelum merge |
| Data produksi lama tidak bisa dimigrasi | Selisih slip historis | Fase 0 memutuskan strategi data; jangan migrasi sebelum Fase 4 selesai |
| Owner menunda 4 keputusan §8 | Fase 3–4 macet | Kerjakan bagian yang tidak bergantung keputusan lebih dulu |
| Cakupan melebar (pajak, BPJS) | MVP tidak pernah rilis | §2.2 mengikat; permintaan baru masuk backlog pasca-MVP |

---

## 11. Definition of Done (per pekerjaan)

Sebuah item dianggap selesai hanya bila:

1. Kode sudah di `main` dan build hijau.
2. Ada tes yang gagal sebelum perbaikan dan lulus sesudahnya.
3. Angka yang berubah dijelaskan di deskripsi PR (sebelum → sesudah, dalam rupiah).
4. Tidak menambah tempat kedua yang menghitung hal yang sama.
5. Issue terkait ditutup dengan menyebut commit.
