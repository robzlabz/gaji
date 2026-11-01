# Business Case — Gaji

Dokumen ini menjelaskan **mengapa** Gaji layak dibangun dan dijual: masalah yang diselesaikan, pasar yang dituju, model pendapatan yang diusulkan, dan nilai yang diterima pemakainya. Dokumen ini melengkapi [`README.md`](../README.md) yang menjelaskan **cara** aplikasi bekerja.

| | |
| --- | --- |
| **Status** | Draf untuk ditinjau |
| **Tanggal** | 1 November 2026 |
| **Cakupan** | Produk Gaji (aplikasi payroll & absensi multi-tenant) |
| **Sifat angka** | Angka pasar dikutip dari sumber publik; angka finansial adalah **model asumsi** yang diberi label, bukan hasil riset pasar primer |

> **Cara membaca dokumen ini.** Setiap klaim tentang kemampuan produk menunjuk ke file kode yang membuktikannya (lihat [Lampiran A](#lampiran-a--peta-kapabilitas-ke-kode)). Setiap angka finansial adalah asumsi yang ditulis terbuka beserta rumusnya, sehingga bisa diganti dengan data nyata tanpa merombak kesimpulan.

---

## 1. Ringkasan eksekutif

Gaji adalah aplikasi penggajian untuk usaha kecil Indonesia yang membayar karyawannya dengan **lebih dari satu cara**: per jam, per hari, per bulan, dan per tugas — sering dalam satu tempat usaha yang sama. Aplikasi ini menggabungkan absensi, upah, kasbon, saldo prabayar, cuti, kontrak, dan slip gaji dalam satu alur yang berakhir pada payroll yang bisa disetujui dan dicetak.

Tiga hal membuat posisi produk ini berbeda dari spreadsheet dan dari aplikasi HR korporat:

1. **Empat tipe upah dalam satu aplikasi, dengan prorata yang benar.** Gaji menghitung upah per jam (lembur dari catatan admin, memakai tarif yang berlaku saat kejadian), per hari (per kehadiran), per bulan (prorata hari kerja + cuti berbayar), dan per tugas (kuantitas × tarif satuan). Sebagian besar pesaing memaksa satu model upah.
2. **Dua mekanisme uang muka yang memang dipakai UMKM: kasbon dan saldo.** Kasbon adalah utang karyawan yang dipotong dari slip; saldo adalah uang yang sudah dikirim owner lebih dulu dan dipotong per kehadiran. Keduanya punya ledger sendiri dan aturan potong yang eksplisit.
3. **Pemakaian tanpa pelatihan.** Login nomor HP + PIN 6 digit, antarmuka karyawan berjalan sebagai PWA di HP, dan data dibatasi per organisasi.

**Rekomendasi:** jadikan Gaji produk berlangganan dengan harga rendah: gratis untuk usaha di bawah 5 karyawan, **Rp50.000/bulan** untuk usaha kecil, dan **Rp100.000/bulan** untuk usaha dengan banyak cabang — ditagih **tahunan** secara default (Rp500.000 dan Rp1.000.000/tahun), karena pemilik usaha kecil di Indonesia enggan membayar bulanan. Nilai yang diterima pelanggan 15 karyawan sekitar **Rp630.000/bulan**, terhadap harga **Rp50.000/bulan** — ROI sekitar **12,6×** pada skenario dasar dan **8,6×** pada skenario konservatif. Model ini belum diuji ke pengguna nyata dan harus divalidasi pada 20–30 wawancara sebelum harga dikunci.

---

## 2. Masalah

### 2.1 Konteks pasar

- Kementerian Koperasi dan UKM mencatat **64,2 juta unit UMKM** pada 2024, mencakup 99,99% unit usaha dan menyumbang **61,07% PDB** ([ANTARA](https://jatim.antaranews.com/berita/1016713/sinergi-sektor-fiskal-membantu-umkm-naik-kelas)).
- BPS mencatat **rata-rata upah buruh Rp3,33 juta/bulan** (Keadaan Ketenagakerjaan November 2025, rilis 5 Februari 2026) — upah adalah pos biaya terbesar yang harus dikelola usaha kecil, sekaligus yang paling sering dikerjakan manual ([BPS](https://www.bps.go.id/id/pressrelease/2026/02/05/2547/november-2025--tingkat-pengangguran-terbuka--tpt--sebesar-4-74-persen-dan-rata-rata-upah-buruh-sebesar-3-33-juta-rupiah-.html)).
- Riset **Business Fitness Index 2024** (OCBC × NielsenIQ) menemukan **77% UMKM yang disurvei masih mencatat keuangan secara manual** ([siaran pers OCBC](https://www.ocbc.id/id/tentang-ocbc/informasi/siaran-pers/2024/08/19/ocbc-business-fitness-index), [Kompas](https://money.kompas.com/read/2025/11/21/154704826/77-persen-umkm-masih-catat-manual-mekari-jurnal-dan-ocbc-hadirkan-integrasi)).

Artinya: mayoritas usaha kecil menjalankan penggajian dengan alat yang tidak dirancang untuk itu, sementara biaya tenaga kerja adalah pengeluaran terbesar mereka.

### 2.2 Masalah operasional yang konkret

Berdasarkan model kerja yang didukung aplikasi ini, ada enam titik gesek yang berulang setiap periode gaji:

| # | Masalah | Bentuk nyata di lapangan |
| --- | --- | --- |
| M1 | **Upah campuran** | Satu warung punya kasir bulanan, barista per jam, tukang bersih per hari, dan staf produksi per tugas. Spreadsheet butuh rumus berbeda per baris, dan satu kesalahan menular ke semua. |
| M2 | **Absensi tidak sinkron dengan upah** | Kehadiran dicatat di buku/WhatsApp, lalu direkap ulang saat bayaran. Jam masuk diambil dari ingatan, bukan dari jam server. |
| M3 | **Kasbon tidak terlacak** | Utang karyawan dicatat di buku tulis. Sisa utang, cicilan, dan keputusan "potong sekarang atau tunda" tidak punya jejak — sumber sengketa paling umum saat hari bayaran. |
| M4 | **Uang muka tidak terlihat** | Owner sering mengirim uang lebih dulu (transfer harian/mingguan). Tanpa ledger, tidak ada yang tahu karyawan sudah dibayar berapa dan masih kurang berapa. |
| M5 | **Tarif berubah, slip lama ikut berubah** | Kenaikan upah bulan ini mengubah hitungan bulan lalu ketika spreadsheet diubah di tempat. Riwayat tarif hilang, audit jadi mustahil. |
| M6 | **Slip dan pembukuan dibuat dua kali** | Angka diketik ulang ke slip dan ke buku kas, sehingga dua dokumen bisa berbeda untuk orang yang sama. |

### 2.3 Biaya dari masalah tersebut

Model biaya per organisasi 15 karyawan dengan total upah Rp60 juta/bulan (asumsi di [Lampiran B](#lampiran-b--asumsi-dan-rumus)):

| Komponen biaya | Asumsi | Nilai/bulan |
| --- | --- | --- |
| Waktu admin mengerjakan payroll manual | 12 jam/periode × Rp45.000/jam | Rp540.000 |
| Waktu admin dengan Gaji (verifikasi + approve + kirim slip) | 3 jam × Rp45.000/jam | Rp135.000 |
| **Hemat waktu** | 9 jam | **Rp405.000** |
| Koreksi kesalahan bayar | 1 kesalahan per 2 periode × Rp250.000 | Rp125.000 |
| Risiko saldo minus / kasbon tak terpantau | estimasi konservatif | Rp100.000 |
| **Total manfaat** | | **Rp630.000** |

---

## 3. Solusi: apa yang sudah ada hari ini

Gaji bukan konsep di atas kertas. Kapabilitas di bawah ini sudah berjalan di `main` dan dipakai oleh alur admin maupun karyawan.

| Kapabilitas | Masalah yang diselesaikan | Ringkas cara kerja |
| --- | --- | --- |
| **Empat tipe upah** — per jam, per hari, per bulan, per tugas | M1 | Satu fungsi perhitungan memilih cabang berdasarkan `pay_type`; tipe lain tetap bisa menerima tugas sebagai penghasilan tambahan |
| **Prorata gaji bulanan** | M1 | Penyebut selalu hari kerja periode penuh; pembilang dipotong oleh tanggal bergabung/berhenti, kehadiran, dan cuti berbayar |
| **Riwayat tarif per kejadian** | M5 | Absensi menyimpan tarif yang berlaku saat itu; kenaikan tarif tidak mengubah masa lalu, dan slip memberi peringatan bila tarif berubah di tengah periode |
| **Absensi dari HP (PWA)** | M2 | Clock-in/out dengan waktu server, satu sesi terbuka per karyawan (dijamin partial unique index), foto & geofence opsional, ongkos kedatangan per kedatangan |
| **Kasbon dengan rencana potong/tunda** | M3 | Setiap kasbon punya saldo, cicilan, dan keputusan per periode: potong sebagian atau tunda ke periode berikutnya — tersimpan sebagai data, bukan kesepakatan lisan |
| **Saldo prabayar** | M4 | Ledger append-only (`topup`, `accrual`, `adjust`, `settle`, `kasbon`); saldo boleh minus, yang berarti owner masih kurang bayar |
| **Cuti berbayar & tanpa upah** | M1 | Hanya untuk karyawan bulanan; cuti berbayar menambah hari yang dibayar, cuti tanpa upah menurunkan prorata, hari yang sudah ada absensinya tidak dihitung dua kali |
| **Payroll draft → final** | M6 | Periode payroll dihitung sebagai draft, ditinjau, lalu difinalkan; slip menyimpan snapshot kuantitas, tarif, dan jumlah |
| **Slip siap cetak & ekspor CSV** | M6 | Slip A4 untuk karyawan, CSV untuk pembukuan, dengan pengaman formula injection pada sel teks |
| **Kontrak & pengingat berakhir** | M5 | Kontrak aktif memperbarui upah dan mencatat perubahan; ambang pengingat bisa diatur per organisasi |
| **Multi-tenant & multi-cabang** | — | Semua data dibatasi `org_id`, satu akun bisa berpindah organisasi, peran `owner`/`admin`/`employee` dipisah |
| **Audit log** | M5, M3 | Perubahan penting tercatat dengan aktor dan entitas |
| **MCP read-only untuk AI** | — | Klien AI bisa menjawab "siapa yang belum clock-in hari ini?" dari data asli, lewat transaksi read-only dengan timeout |

Detail teknis dan peta kode: [Lampiran A](#lampiran-a--peta-kapabilitas-ke-kode).

### 3.1 Yang belum ada (dan harus jujur disebut)

Business case yang berguna juga menyebut batas produk. Saat ini Gaji **belum** menangani:

- **PPh 21 dan BPJS** (Kesehatan & Ketenagakerjaan) — tidak ada perhitungan potongan pajak atau iuran.
- **THR, pesangon, dan kompensasi akhir kontrak.**
- **Lembur otomatis** — lembur dicatat manual oleh admin; sistem hanya mengalikan tarif dengan pengali yang diatur.
- **Pembayaran langsung ke rekening karyawan** (payout/bank integration).
- **Penagihan langganan** — belum ada billing, kuota, atau pembatasan paket di dalam aplikasi.
- **Tanda tangan elektronik kontrak** — dokumen kontrak disimpan sebagai referensi, bukan ditandatangani di aplikasi.

Poin-poin ini masuk ke roadmap ([§7](#7-roadmap)) dan menjadi bagian dari risiko kepatuhan ([§6](#6-risiko-dan-mitigasi)).

---

## 4. Pasar dan segmentasi

### 4.1 Segmen utama

**Usaha 5–50 karyawan dengan upah campuran dan satu orang admin yang merangkap banyak hal.** Ciri yang membuat mereka cocok:

- Ada minimal dua tipe upah berbeda dalam satu lokasi (bulanan + harian, atau bulanan + per tugas).
- Karyawan tidak punya email kantor dan tidak akan menghafal password — cocok dengan login HP + PIN.
- Sudah memakai HP untuk operasional (WhatsApp, kasir, marketplace), tetapi belum memakai aplikasi HR.
- Siklus gaji bukan selalu tanggal 1 — cocok dengan periode gaji yang bisa digeser.

Contoh vertikal: F&B (kafe, katering, warung), retail & toko kelontong, jasa (salon, bengkel, laundry), dan usaha produksi kecil dengan upah satuan.

### 4.2 Segmen sekunder

- **Konsultan payroll / biro jasa pembukuan** yang mengelola beberapa klien: multi-tenant dan audit log adalah nilai jual langsung, dan mereka bisa menjadi kanal distribusi.
- **Usaha dengan beberapa cabang** yang butuh pemisahan data per organisasi namun satu pemilik.

### 4.3 Estimasi ukuran pasar

Model asumsi, bukan hasil riset primer:

| Lapis | Definisi | Unit | Nilai/tahun |
| --- | --- | --- | --- |
| TAM | UMKM 64,2 juta × asumsi 2% adalah pemberi kerja dengan ≥5 karyawan | 1.284.000 | Rp1,00 triliun |
| SAM | 30% TAM: sudah digital, upah campuran, ada admin | 385.200 | Rp300 miliar |
| SOM (tahun 3) | 3.000 pelanggan berbayar = 0,78% SAM | 3.000 | Rp2,34 miliar ARR |

ARPU campuran **Rp65.000/bulan** berasal dari asumsi 70% pelanggan di paket Rp50.000 dan 30% di paket Rp100.000. Jika asumsi 2% terlalu optimistis (misalnya hanya 1%), TAM turun menjadi Rp502 miliar dan target 3.000 pelanggan menjadi 1,56% SAM — masih dalam jangkauan, tetapi menuntut kanal akuisisi yang lebih murah daripada penjualan langsung.

---

## 5. Model bisnis

### 5.1 Usulan paket

Harga dibuat rendah dengan sengaja: modal kecil, tanpa tim penjualan, dan pelanggan usaha mikro yang tidak akan membayar harga korporat. Dua harga berbayar saja — cukup untuk memisahkan usaha kecil dari usaha multi-cabang.

| Paket | Harga | Isi | Alasan adanya |
| --- | --- | --- | --- |
| **Gratis** | Rp0 | ≤5 karyawan, 1 cabang, absensi + slip | Menghapus hambatan coba; usaha mikro jadi pintu masuk |
| **Dasar** | **Rp50.000/bulan**, atau **Rp500.000/tahun** | ≤15 karyawan, kasbon + saldo, cuti, ekspor CSV | Di bawah ambang "tidak perlu mikir"; setara Rp3.300/karyawan/bulan untuk 15 orang |
| **Lengkap** | **Rp100.000/bulan**, atau **Rp1.000.000/tahun** | ≤50 karyawan, multi-cabang, audit log, MCP | Yang dibayar adalah kontrol dan jejak audit lintas cabang |
| **Konsultan** | Nego, mulai 5 organisasi | Banyak organisasi, ekspor massal, dukungan prioritas | Kanal distribusi; satu konsultan membawa banyak tenant |

- **Tagihan tahunan adalah jalur utama.** Harga tahunan = 10× harga bulanan, artinya dua bulan gratis. Ini bukan sekadar diskon: pemilik usaha kecil lebih mau membayar sekali Rp500.000 daripada diingatkan setiap bulan.
- **Bulanan tetap tersedia** untuk yang ingin mencoba lebih lama sebelum berkomitmen setahun, dengan harga penuh.
- **Kelebihan karyawan** di atas kuota: **Rp5.000/karyawan/bulan**.
- Harga per karyawan pada paket Dasar untuk 15 orang adalah **Rp3.333/bulan** — masih di bawah biaya satu jam lembur seorang karyawan.

### 5.2 Konsekuensi harga rendah yang harus diterima

Harga Rp50.000 hanya masuk akal bila biaya melayani satu pelanggan juga kecil. Aturan yang mengikat keputusan produk:

| Konsekuensi | Artinya dalam praktik |
| --- | --- |
| **Wajib self-serve** | Tidak ada onboarding manual atau pendampingan per pelanggan; kalau ada, Rp50.000 habis di 15 menit pertama |
| **Dukungan asinkron** | Dokumentasi + email/WhatsApp, bukan telepon. Dukungan prioritas hanya untuk paket Konsultan |
| **Akuisisi tanpa sales** | Konten, komunitas pemilik usaha, dan mitra konsultan — bukan iklan berbayar dengan CAC tinggi |
| **Plafon biaya dukungan** | Biaya dukungan harus **< Rp10.000/pelanggan/bulan**; jika lewat, harga naik atau paket dipecah, bukan ditekan dengan mengurangi kualitas |
| **Tidak ada janji SLA** | Untuk pasar ini, keandalan dijaga lewat rekayasa (migrasi otomatis, backup), bukan kontrak SLA |

### 5.3 Skenario pendapatan

Asumsi: ARPU Rp65.000 (70% pelanggan di Rp50.000, 30% di Rp100.000), tanpa pendapatan setup, campuran tagihan bulanan dan tahunan.

| Tahun | Pelanggan berbayar | MRR | ARR | Pangsa SAM | Breakeven unit |
| --- | --- | --- | --- | --- | --- |
| 1 | 250 | Rp16.250.000 | Rp195 juta | 0,06% | 95 pelanggan |
| 2 | 1.000 | Rp65.000.000 | Rp780 juta | 0,26% | 190 pelanggan |
| 3 | 3.000 | Rp195.000.000 | Rp2,34 miliar | 0,78% | 380 pelanggan |

Breakeven dihitung dari biaya tetap bulanan (infrastruktur, alat, dukungan) dibagi margin per pelanggan setelah biaya payment gateway 2,9%: sekitar **Rp6 juta/bulan di tahun 1**, **Rp12 juta** di tahun 2, dan **Rp24 juta** di tahun 3. Pada 3.000 pelanggan, sisa margin per pelanggan sekitar **Rp61.000/bulan** — cukup untuk dukungan asinkron, tidak cukup untuk dukungan telepon tanpa menaikkan harga.

Karena harga rendah, pertumbuhan ditentukan volume, bukan harga. Target 3.000 pelanggan pada tahun 3 adalah **0,78% SAM** — ambisius tetapi tidak mustahil untuk produk berharga Rp50.000 yang bisa dipakai tanpa pelatihan.

### 5.4 Mengapa berlangganan tahunan, bukan sekali bayar

Penggajian berulang setiap bulan, dan nilainya justru muncul saat data menumpuk (riwayat tarif, saldo, kasbon, audit), sehingga pendapatan berulang sejalan dengan manfaat yang dirasakan. Yang diubah dari model langganan biasa adalah **ritme penagihannya**: tahunan, nominal kecil, lewat QRIS/transfer/VA — bukan kartu kredit bulanan yang tidak cocok dengan kebiasaan pemilik usaha kecil.

Satu hipotesis yang perlu diuji pada fase validasi: **bayar per proses payroll** (misalnya Rp15.000 sekali proses) untuk usaha yang menggaji tidak rutin. Model ini lebih sulit diprediksi pendapatannya, jadi jangan dijadikan jalur utama sebelum ada bukti permintaan.

---

## 6. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| **Kepatuhan pajak & BPJS** — produk tidak menghitung PPh 21/BPJS, sementara pelanggan menganggap "aplikasi gaji" seharusnya menghitung | Kepercayaan rusak; risiko hukum bagi pelanggan | Nyatakan batas ini di materi pemasaran dan dalam aplikasi; prioritaskan modul PPh 21/BPJS di fase 2; jangan pakai klaim "patuh pajak" sampai fitur ada |
| **Perubahan aturan upah** (UMP, formula pesangon, THR) | Perhitungan cepat usang | Semua parameter (hari kerja efektif, pengali lembur, tanggal periode) disimpan per organisasi, bukan hardcode — perubahan aturan jadi perubahan konfigurasi + rilis kecil |
| **Kesalahan hitung** pada uang orang | Risiko terbesar produk payroll | Snapshot nilai di slip, peringatan eksplisit saat tarif berubah atau potongan melebihi pendapatan, skrip pemeriksaan (`check:cuti`, `check:saldo`), dan review sebelum payroll difinalkan |
| **Ketergantungan satu admin** (bus factor) | Operasional berhenti bila admin keluar | Peran `owner`/`admin`, audit log, ekspor CSV agar data tidak terkunci |
| **Kebocoran data antar-tenant** | Fatal untuk kepercayaan | Setiap query dibatasi `org_id`; MCP berjalan read-only dengan API key terikat satu organisasi |
| **Kanal MCP disalahgunakan** | Data payroll terbaca pihak lain | Read-only, transaksi read-only, `statement_timeout` 20 detik, key bisa dicabut dari UI |
| **Push ke `main` langsung deploy produksi** | Satu kesalahan bisa langsung terasa ke pelanggan | Wajib review sebelum merge, migrasi dijalankan otomatis saat container start, dan perubahan schema harus lewat migrasi yang di-commit |
| **Harga belum divalidasi** | Salah harga = salah seluruh model | Validasi 20–30 wawancara + uji dua titik harga (Rp50.000 dan Rp100.000) serta pilihan tahunan vs per proses; gratis untuk 5 karyawan pertama menurunkan risiko coba |
| **Harga rendah tidak menutup biaya dukungan** | Setiap pelanggan merugi pelan-pelan | Plafon biaya dukungan Rp10.000/pelanggan/bulan, wajib self-serve, dukungan prioritas hanya untuk paket Konsultan; naikkan harga bila plafon terlampaui |

---

## 7. Roadmap

| Fase | Fokus | Alasan urutan |
| --- | --- | --- |
| **0 — Validasi** (0–2 bulan) | 20–30 wawancara pemilik usaha 5–50 karyawan; uji alur payroll nyata di 3–5 usaha; uji kesediaan bayar pada Rp50.000 dan Rp100.000, tahunan vs per proses | Semua angka di dokumen ini masih asumsi; validasi lebih murah daripada membangun billing untuk harga yang salah |
| **1 — Siap dijual** (2–4 bulan) | Billing & kuota paket, onboarding mandiri, halaman status/langganan, dokumentasi pelanggan, PPh 21/BPJS versi awal | Tanpa billing tidak ada pendapatan; tanpa pajak/BPJS produk belum menyelesaikan pekerjaan sampai tuntas |
| **2 — Menjadi sistem** (4–8 bulan) | THR & pesangon, lembur otomatis, payout ke rekening, tanda tangan kontrak, laporan biaya tenaga kerja per cabang | Menaikkan nilai per pelanggan dan memperkuat alasan tidak pindah |
| **3 — Skala** (8–12 bulan) | Program mitra konsultan, API/MCP lebih kaya, benchmark upah per vertikal, paket multi-tahun | Distribusi lewat mitra lebih murah daripada akuisisi langsung |

---

## 8. Metrik keberhasilan

**North Star:** jumlah payroll yang difinalkan per bulan (bukan jumlah akun terdaftar — akun yang tidak pernah menjalankan payroll tidak bernilai).

| Kategori | Metrik | Target awal |
| --- | --- | --- |
| Aktivasi | Organisasi yang menyelesaikan payroll pertama dalam 14 hari | ≥60% |
| Retensi | Organisasi yang menjalankan payroll 3 bulan berturut-turut | ≥70% |
| Kualitas | Slip yang direvisi setelah difinalkan | <2% |
| Kepercayaan | Selisih saldo setelah `resync` | 0 |
| Pendapatan | ARPU dan churn bulanan | ARPU ≥Rp60.000; churn <3% |
| Efisiensi dukungan | Tiket per 100 organisasi/bulan | <10 |

---

## 9. Keputusan yang diminta

1. **Setuju pada segmen utama** (5–50 karyawan, upah campuran) sebagai target 12 bulan pertama?
2. **Setuju pada dua harga berbayar (Rp50.000 dan Rp100.000)** dengan tagihan tahunan sebagai jalur utama, sebagai hipotesis yang akan divalidasi — bukan harga final?
3. **Setuju bahwa PPh 21/BPJS adalah prioritas fase 1** dan bahwa klaim pemasaran tidak boleh mendahuluinya?
4. **Setuju pada target SOM tahun 3 (3.000 pelanggan berbayar)** sebagai angka perencanaan, dengan breakeven di 95 pelanggan pada tahun 1?

---

## Lampiran A — Peta kapabilitas ke kode

| Kapabilitas | Bukti di repo |
| --- | --- |
| Multi-tenant, peran, ganti organisasi | `src/db/schema.ts` (`organizations`, `memberships`), `src/lib/session.ts`, `src/app/api/switch-org/route.ts` |
| Login nomor HP + PIN | `src/app/login/`, `src/lib/accounts.ts` |
| Empat tipe upah | `src/lib/payroll.ts` — cabang `hourly`, `daily`, `monthly`, `per_task` |
| Prorata bulanan + cuti berbayar | `src/lib/payroll.ts`, `src/lib/leave.ts`, `src/lib/period.ts` |
| Riwayat tarif | `pay_rate_history` di `src/db/schema.ts`, `rateAtDate` di `src/lib/saldo.ts` |
| Absensi, satu sesi terbuka, geofence & foto | `time_entries` + partial unique index `time_entries_one_open`, `src/app/employee/actions.ts` |
| Ongkos kedatangan per kehadiran | `time_entries.transport_amount`, baris `transport` di `src/lib/payroll.ts` |
| Tugas per satuan | `work_tasks`, `src/lib/task.ts`, `src/app/admin/tugas/` |
| Kasbon + rencana potong/tunda | `cash_advances`, `cash_advance_plans`, `src/lib/kasbon.ts` |
| Saldo prabayar (ledger) | `wage_floats`, `wage_float_txns`, `src/lib/saldo.ts` |
| Snapshot slip | `payslip_items`, `src/lib/payroll.ts` |
| Payroll draft → final, CSV, slip A4 | `src/app/admin/payroll/`, `src/lib/payroll-run.ts`, `src/components/payslip-sheet.tsx` |
| Kontrak & pengingat | `contracts`, `organizations.contract_alert_days` |
| Audit log | `audit_logs`, `src/lib/audit.ts` |
| MCP read-only | `mcp/`, `src/app/api/mcp/[key]/route.ts`, `mcp/README.md` |
| PWA / mobile | `public/manifest.webmanifest`, `src/app/layout.tsx` |

---

## Lampiran B — Asumsi dan rumus

**Biaya masalah (§2.3)**
- Admin payroll manual: 12 jam/periode. Basis: 45 menit per karyawan untuk rekap absensi, hitung upah, potong kasbon, dan tulis slip × 15 karyawan = 11,25 jam, dibulatkan 12.
- Admin dengan Gaji: 3 jam/periode (verifikasi, approve, kirim slip).
- Tarif waktu admin: Rp45.000/jam.
- Hemat waktu = (12 − 3) × Rp45.000 = **Rp405.000**.
- Koreksi kesalahan = 1 kesalahan per 2 periode × Rp250.000 = **Rp125.000**.
- Risiko saldo/kasbon tak terpantau = **Rp100.000** (estimasi konservatif).
- Total = **Rp630.000**; net setelah harga Rp50.000 = **Rp580.000**; ROI **12,6×**.
- Skenario konservatif (hanya 50% penghematan waktu terwujud) = Rp427.500 → ROI **8,6×**. Harga tetap menguntungkan bahkan jika penghematan waktu hanya seperempat dari perkiraan (Rp101.250 → ROI **2,0×**).

**Pasar (§4.3)**
- TAM unit = 64.200.000 × 2% = 1.284.000; TAM nilai = unit × ARPU × 12.
- SAM = 30% × TAM.
- ARPU = (70% × Rp50.000) + (30% × Rp100.000) = Rp65.000.
- Breakeven unit = biaya tetap bulanan ÷ (ARPU × (1 − 2,9%)); contoh tahun 1: Rp6.000.000 ÷ Rp63.115 = 95 pelanggan.
- Harga tahunan = 10 × harga bulanan (dua bulan gratis).
- SOM = pelanggan berbayar × ARPU × 12.

**Yang perlu diganti dengan data nyata sebelum keputusan final:** jumlah jam admin per periode, tarif waktu admin, frekuensi kesalahan bayar, persentase UMKM dengan ≥5 karyawan, dan harga yang bersedia dibayar.

---

## Lampiran C — Sumber

1. ANTARA — jumlah UMKM 2024 dan kontribusi PDB: <https://jatim.antaranews.com/berita/1016713/sinergi-sektor-fiskal-membantu-umkm-naik-kelas>
2. BPS — rata-rata upah buruh Rp3,33 juta (November 2025): <https://www.bps.go.id/id/pressrelease/2026/02/05/2547/november-2025--tingkat-pengangguran-terbuka--tpt--sebesar-4-74-persen-dan-rata-rata-upah-buruh-sebesar-3-33-juta-rupiah-.html>
3. OCBC — Business Fitness Index 2024 (77% UMKM mencatat manual): <https://www.ocbc.id/id/tentang-ocbc/informasi/siaran-pers/2024/08/19/ocbc-business-fitness-index>
4. Kompas — ringkasan temuan yang sama: <https://money.kompas.com/read/2025/11/21/154704826/77-persen-umkm-masih-catat-manual-mekari-jurnal-dan-ocbc-hadirkan-integrasi>
