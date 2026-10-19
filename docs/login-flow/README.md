# Masuk dua langkah: nomor HP dulu, PIN di halaman terpisah

Sebelumnya halaman masuk meminta tab **Karyawan / Owner**, nomor HP, dan PIN sekaligus
dalam satu form. Sekarang alurnya dua langkah dan role tidak lagi dipilih user.

## Alur baru

1. **`/login` — hanya nomor HP.** Tidak ada tab, tidak ada kolom PIN.
   Tombol **Lanjut** mengecek nomor ke database (server action `findLoginAccount`).
   - Nomor tidak punya akun → pesan *"Nomor HP ini tidak memiliki akun atau belum
     terdaftar…"* dan user tetap di langkah 1.
2. **`/login/pin` — halaman baru, PIN saja.** Nomor yang dikenali membawa label role
   dari data akun (**Owner** / **Admin** / **Karyawan**) plus nama pemilik nomor.
   PIN diisi di 6 kotak terpisah (auto-pindah fokus, backspace mundur, tempel 6 digit
   sekaligus, tombol Tampilkan/Sembunyikan).
3. Tombol **Verifikasi** memanggil `signIn.phoneNumber`, lalu `resolveLoginGate()`
   menentukan tujuan dari role akun: owner/admin → `/admin`, karyawan → `/employee`.
   Tidak ada lagi kemungkinan "salah tab".

`/login/pin` yang dibuka tanpa nomor (atau dengan nomor tak dikenal) langsung
dialihkan balik ke `/login`.

## Bukti visual

Semua diambil dengan Playwright (desktop 1280x900 & mobile 390x844, light + dark,
device scale 2) terhadap dev server lokal.

### Sebelum — `before/`

| Berkas | Isi |
| --- | --- |
| `01-desktop-light.png` | Tab Karyawan/Owner + nomor HP + PIN dalam satu kartu |
| `02-desktop-dark.png` | Versi dark |
| `03-mobile-light.png` | Versi mobile |
| `04-tab-owner.png` | Tab Owner dipilih |
| `05-error-nomor-tidak-dikenal.png` | Error lama: "Nomor HP atau PIN salah." |

### Sesudah — `after/`

| Berkas | Isi |
| --- | --- |
| `01-step1-desktop-light.png` | Langkah 1: hanya nomor HP, tanpa tab & tanpa PIN |
| `02-step1-nomor-tidak-terdaftar.png` | Nomor gagal → "tidak memiliki akun atau belum terdaftar" |
| `03-step2-owner-pin-kosong.png` | Langkah 2: label **Owner** + 6 kotak PIN |
| `04-step2-owner-terisi-sebagian.png` | Auto-pindah fokus saat digit diketik |
| `05-step2-owner-pin-lengkap.png` | 6 digit terisi, tombol Verifikasi aktif |
| `06-owner-masuk-admin.png` | PIN benar → dashboard admin |
| `07-step2-karyawan-label.png` | Nomor karyawan → label **Karyawan** |
| `08-step2-pin-salah.png` | PIN salah → pesan, kotak dikosongkan, fokus kembali ke kotak 1 |
| `09-karyawan-masuk-employee.png` | PIN benar → dashboard karyawan |
| `10-step1-desktop-dark.png` | Langkah 1 dark |
| `11-step2-desktop-dark.png` | Langkah 2 dark |
| `12-step1-mobile-light.png` | Langkah 1 mobile |
| `13-step2-mobile-light.png` | Langkah 2 mobile |
| `14-step2-mobile-dark-pin-salah.png` | PIN salah, mobile dark |
| `15-ganti-nomor-kembali-step1.png` | Tautan "Ganti nomor HP" kembali ke langkah 1 |

## Uji perilaku (14/14 lulus)

Skrip Playwright yang sama juga menguji: akses `/login/pin` tanpa nomor → balik ke
`/login`, nomor tak dikenal di URL → balik ke `/login`, tempel 6 digit, backspace
mundur, Enter mengirim form, PIN salah mengosongkan kotak + fokus ke kotak 1, label
role owner/karyawan, dan tujuan redirect `/admin` vs `/employee`.
