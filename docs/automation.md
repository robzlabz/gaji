# Alur issue otomatis

Panduan untuk sesi Claude yang mengerjakan issue repo ini secara otomatis. Ada dua jadwal:

- **Heartbeat (tiap 30 menit):** kerjakan issue terbuka dan tindak lanjuti PR yang menunggu jawaban.
- **Audit harian (00:00 WIB):** periksa seluruh aplikasi dan buat issue baru.

Push ke `main` langsung men-deploy ke produksi (lihat `.github/workflows/deployment.yml`), jadi sesi otomatis **tidak pernah** merge PR atau push ke `main`. Owner yang merge.

## Persiapan sesi

1. Pasang omp lewat skill `install-omp-inferhub`. API key tidak boleh ditulis ke repo.
   Jalankan omp headless dengan stdin ditutup, kalau tidak omp menggantung:
   `omp -p "..." </dev/null`
2. `scripts/automation/setup-env.sh` (Postgres, migrasi, seed, Playwright).
3. `npm run dev` di background, tunggu `http://localhost:3000/login` merespons 200.

Akun demo seed: admin `08111111111` / PIN `111111`, karyawan `08333333333` / PIN `333333`.

## Heartbeat

1. Ambil issue terbuka dan PR terbuka. Kalau tidak ada issue yang perlu dikerjakan dan tidak ada PR berlabel `question` dengan komentar baru dari owner, **berhenti tanpa setup apa pun**.
2. Issue dianggap sudah ditangani kalau sudah ada PR terbuka yang menyebut `Closes #<n>`.
3. Untuk issue yang jelas:
   - Buat branch `auto/issue-<n>-<slug>` dari `main`.
   - Ambil screenshot **before** di `main` untuk halaman yang terdampak.
   - Kerjakan dengan omp: `omp -p "<instruksi lengkap: isi issue, file terkait, aturan repo>" </dev/null`. Review hasil diff omp, perbaiki bila perlu, jalankan `npm run lint` dan `npx tsc --noEmit`.
   - Ambil screenshot **after** di branch tersebut dengan path dan viewport yang sama.
   - Buka PR dengan `Closes #<n>` dan tabel before/after.
4. Untuk issue yang belum jelas: tetap buka PR (draft, boleh berisi langkah awal atau hanya rencana), beri label `need-attention` dan `question`, dan tulis pertanyaannya sebagai komentar di PR. Owner menjawab di komentar GitHub.
5. Untuk PR berlabel `question` yang sudah dijawab owner: lanjutkan pekerjaannya, perbarui before/after, lalu lepas label `need-attention` dan `question`.

## Before/after di PR

Ambil screenshot dengan:

```sh
NODE_PATH=/tmp/gaji-automation/node_modules \
  node scripts/automation/screenshots.mjs docs/pr-screenshots/<slug>/before admin /admin/absensi
```

Ulangi dengan folder `after` di branch PR. Commit gambarnya ke `docs/pr-screenshots/<slug>/` dan tampilkan di deskripsi PR. Pakai SHA commit (bukan nama branch) di URL supaya gambar tetap tampil setelah branch dihapus:

```md
| Before | After |
| --- | --- |
| ![](https://raw.githubusercontent.com/robzlabz/gaji/<commit-sha>/docs/pr-screenshots/<slug>/before/admin_absensi-desktop.png) | ![](https://raw.githubusercontent.com/robzlabz/gaji/<commit-sha>/docs/pr-screenshots/<slug>/after/admin_absensi-desktop.png) |
```

Sertakan desktop dan mobile. Kalau perubahan tidak menyentuh UI, tulis "Tidak ada perubahan UI" di bagian before/after.

## Audit harian

1. Persiapan sesi seperti di atas.
2. Minta omp memeriksa per area (payroll & perhitungan upah, absensi, kasbon/saldo, cuti, auth & akses multi-tenant, MCP server), misalnya:
   `omp -p "Audit src/lib/payroll.ts dan pemakainya: cari perhitungan yang salah, bug, dan masalah keamanan. Sebutkan file, baris, dan cara reproduksi." </dev/null`
3. Verifikasi setiap temuan sendiri (baca kodenya, jalankan `npm run check:cuti` / `npm run check:saldo` bila relevan). Buang temuan yang tidak bisa dibuktikan.
4. Cek duplikat terhadap issue yang sudah ada (terbuka maupun tertutup).
5. Buat satu issue per temuan dengan label `bug`, `feature`, atau `security`. Isi: ringkasan, lokasi kode, langkah reproduksi, dampak, usulan perbaikan. Detail eksploit untuk temuan `security` ditulis secukupnya saja karena repo ini publik.
