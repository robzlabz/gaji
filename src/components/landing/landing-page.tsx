"use client";

import Link from "next/link";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  FileText,
  MapPin,
  Printer,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoinFace, ReceiptFace, Sparkle, Squiggle } from "./cute-shapes";

gsap.registerPlugin(useGSAP, ScrollTrigger, DrawSVGPlugin);

/** Masalah yang paling sering diceritakan owner sebelum pakai Gaji. */
const PAINS = [
  {
    problem: "Rekap absen dari grup WA",
    solution: "Absensi pakai foto & titik lokasi, rekapnya otomatis per periode.",
    icon: MapPin,
  },
  {
    problem: "Kasbon yang lupa dicatat",
    solution: "Setiap kasbon punya rencana potong: dicicil atau ditunda, saldonya jelas.",
    icon: Wallet,
  },
  {
    problem: "Slip gaji bikin ulang tiap bulan",
    solution: "Slip dibuat sekali klik, siap cetak A4, plus ekspor CSV buat pembukuan.",
    icon: Printer,
  },
];

const FEATURES = [
  {
    title: "4 tipe penggajian",
    body: "Per jam, per hari, per bulan, atau per tugas. Satu karyawan bisa beda tipe.",
    icon: Clock,
  },
  {
    title: "Periode fleksibel",
    body: "Default tanggal 26, bisa digeser sesuai siklus gaji perusahaanmu.",
    icon: CalendarDays,
  },
  {
    title: "Kontrak & riwayat tarif",
    body: "Tarif lama tersimpan, jadi kenaikan gaji punya jejak yang bisa diaudit.",
    icon: FileText,
  },
  {
    title: "Multi-cabang",
    body: "Pisahkan data tiap cabang, akses diatur per anggota tim.",
    icon: Users,
  },
  {
    title: "Masuk pakai PIN",
    body: "Nomor HP + PIN 6 digit. Karyawan nggak perlu hafal password.",
    icon: Smartphone,
  },
  {
    title: "Jalan di HP",
    body: "Bisa dipasang ke layar utama seperti aplikasi biasa, tanpa install dari store.",
    icon: Check,
  },
];

const STEPS = [
  {
    title: "Tambah karyawan & tarif",
    body: "Isi nama, nomor HP, tipe gaji, dan tarifnya. Selesai dalam hitungan detik.",
  },
  {
    title: "Biarkan absensi jalan",
    body: "Karyawan clock in / clock out dari HP. Lembur dan koreksi dicatat manual.",
  },
  {
    title: "Jalankan payroll",
    body: "Sistem hitung gaji, potong kasbon, lalu terbitkan slip dan CSV.",
  },
];

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(".eye", { transformBox: "fill-box", transformOrigin: "50% 50%" });

        const hero = gsap.timeline({ defaults: { ease: "power3.out" } });
        hero
          .from("[data-hero-badge]", { y: 14, opacity: 0, duration: 0.5 })
          .from(
            "[data-hero-word]",
            { y: 28, opacity: 0, duration: 0.65, stagger: 0.05 },
            "-=0.25",
          )
          .from("[data-hero-lede]", { y: 16, opacity: 0, duration: 0.5 }, "-=0.35")
          // Animasi kena pembungkus CTA, bukan <Button>-nya: GSAP yang menulis
          // inline opacity/transform di elemen tombol bisa berhenti di tengah
          // jalan dan menyisakan tombol transparan permanen.
          .from("[data-hero-cta]", { y: 14, opacity: 0, duration: 0.45 }, "-=0.3")
          .from("[data-hero-note]", { opacity: 0, duration: 0.4 }, "-=0.2")
          .from(
            "[data-stage]",
            { scale: 0.94, opacity: 0, duration: 0.8, ease: "back.out(1.5)" },
            "-=0.9",
          )
          .from(
            "[data-squiggle] path",
            { drawSVG: "0%", duration: 0.9, ease: "power2.inOut" },
            "-=0.6",
          );

        // Maskot melayang pelan, ritme beda-beda biar terasa hidup.
        // Amplitudo dibatasi (data-float) supaya maskot tidak pernah menutupi teks kartu.
        gsap.utils.toArray<HTMLElement>("[data-float]").forEach((el, i) => {
          const amp = Number(el.dataset.float || 6);
          gsap.to(el, {
            y: i % 2 === 0 ? -amp : amp,
            rotate: i % 2 === 0 ? -4 : 5,
            duration: 2.8 + i * 0.35,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            delay: i * 0.25,
          });
        });

        // Mata koin berkedip tiap beberapa detik.
        gsap
          .timeline({ repeat: -1, repeatDelay: 3.2, delay: 1.4 })
          .to(".eye", { scaleY: 0.12, duration: 0.09, stagger: 0.02 })
          .to(".eye", { scaleY: 1, duration: 0.13, stagger: 0.02 });

        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, {
            y: 26,
            opacity: 0,
            duration: 0.65,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

        gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
          const target = Number(el.dataset.count ?? "0");
          if (!target) return;
          const state = { value: 0 };
          gsap.to(state, {
            value: target,
            duration: 1.1,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 92%", once: true },
            onUpdate: () => {
              el.textContent = String(Math.round(state.value));
            },
          });
        });
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-foreground">
              G
            </span>
            Gaji
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#fitur" className="transition-colors hover:text-foreground">
              Fitur
            </a>
            <a href="#cara-kerja" className="transition-colors hover:text-foreground">
              Cara kerja
            </a>
            <a href="#slip" className="transition-colors hover:text-foreground">
              Slip gaji
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="h-9 rounded-lg px-3">
              <Link href="/login">Masuk</Link>
            </Button>
            <Button
              asChild
              className="h-9 rounded-lg bg-brand px-3.5 text-brand-foreground hover:bg-brand/90"
            >
              <Link href="/register">Daftar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative isolate mx-auto w-full max-w-6xl overflow-hidden px-5 pt-14 pb-10 md:pt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-brand-soft/60 blur-3xl"
          />
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <span
                data-hero-badge
                className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft/60 px-3 py-1.5 text-xs font-medium text-brand-soft-foreground"
              >
                <Sparkle className="size-3.5" />
                Payroll + absensi untuk UMKM
              </span>

              <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                <span data-hero-word className="inline-block">
                  Gaji
                </span>{" "}
                <span data-hero-word className="inline-block">
                  karyawan
                </span>{" "}
                <span data-hero-word className="inline-block">
                  tanpa
                </span>{" "}
                <span data-hero-word className="relative inline-block text-brand">
                  drama
                  <span
                    data-squiggle
                    className="pointer-events-none absolute -bottom-1 left-0 w-full"
                  >
                    <Squiggle className="h-2.5 w-full" />
                  </span>
                </span>{" "}
                <span data-hero-word className="inline-block">
                  spreadsheet.
                </span>
              </h1>

              <p
                data-hero-lede
                className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
              >
                Absensi pakai foto &amp; lokasi, kasbon terkendali, slip gaji siap cetak. Semua
                hitungan gaji beres dalam satu aplikasi.
              </p>

              <div data-hero-cta className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  className="h-11 rounded-xl bg-brand px-5 text-[0.95rem] text-brand-foreground shadow-sm hover:bg-brand/90"
                >
                  <Link href="/login">
                    Masuk ke aplikasi
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 rounded-xl px-5 text-[0.95rem]"
                >
                  <a href="#slip">Lihat slip contoh</a>
                </Button>
              </div>

              <p data-hero-note className="mt-4 text-xs text-muted-foreground">
                Nomor HP + PIN 6 digit · Tanpa kartu kredit · Setup di bawah 5 menit
              </p>
            </div>

            {/* Panggung maskot + kartu ringkasan */}
            <div data-stage className="relative mx-auto w-full max-w-[24rem]">
              <div
                aria-hidden
                className="absolute -inset-5 rounded-[2.5rem] bg-brand-soft/70 blur-xl"
              />
              <div className="relative rounded-3xl border border-brand/15 bg-card p-6 shadow-lg shadow-brand/5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>26 Sep – 25 Okt</span>
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-soft-foreground">
                    Periode aktif
                  </span>
                </div>

                <div className="mt-4 space-y-2.5 text-sm">
                  <StageRow label="Budi Santoso" meta="Harian · 22 hari" value="Rp 2.200.000" />
                  <StageRow label="Sari Wulandari" meta="Harian · 20 hari" value="Rp 1.800.000" />
                  <StageRow label="Andi Pratama" meta="Bulanan" value="Rp 4.500.000" />
                </div>

                <div className="mt-4 flex items-center justify-between rounded-2xl bg-brand-soft/70 px-3.5 py-3">
                  <span className="text-xs font-medium text-brand-soft-foreground">
                    Total payroll
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-brand-soft-foreground">
                    Rp 8.500.000
                  </span>
                </div>
              </div>

              {/* Maskot menempel di tepi kartu. Posisi + amplitudo float dijaga
                  supaya maskot cuma menimpa area padding (24px), tidak pernah teks. */}
              <div
                data-float="5"
                className="absolute -top-6 left-0 size-12 sm:-top-10 sm:-left-10 sm:size-14"
              >
                <CoinFace className="size-full" />
              </div>
              <div
                data-float="5"
                className="absolute right-0 -bottom-7 w-11 sm:-right-10 sm:-bottom-10 sm:w-14"
              >
                <ReceiptFace className="w-full" />
              </div>
              <Sparkle className="absolute -top-2 right-10 size-4 text-brand/70" />
            </div>
          </div>
        </section>

        {/* Angka singkat */}
        <section className="mx-auto w-full max-w-6xl px-5">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
            {[
              { value: 4, label: "tipe penggajian" },
              { value: 5, label: "menit setup", suffix: "<" },
              { value: 1, label: "tempat untuk semua" },
              { value: 0, label: "spreadsheet lagi" },
            ].map((stat) => (
              <div key={stat.label} className="bg-card px-5 py-6" data-reveal>
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 flex items-baseline gap-1 text-3xl font-semibold tracking-tight whitespace-nowrap">
                  {stat.suffix ? <span className="text-xl text-muted-foreground">{stat.suffix}</span> : null}
                  <span data-count={stat.value}>{stat.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Masalah → solusi */}
        <section id="fitur" className="mx-auto w-full max-w-6xl px-5 pt-20 pb-12">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Tiga hal yang bikin gaji selalu ribet
            </h2>
            <p className="mt-3 text-muted-foreground">
              Semuanya berakar dari data yang tercerai-berai. Gaji menyatukannya.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PAINS.map(({ problem, solution, icon: Icon }) => (
              <article
                key={problem}
                data-reveal
                className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-foreground">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-medium text-muted-foreground line-through decoration-destructive/50">
                  {problem}
                </h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed">{solution}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Fitur */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-20 md:pt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, body, icon: Icon }) => (
              <article
                key={title}
                data-reveal
                className="rounded-2xl border border-border bg-card p-6"
              >
                <Icon className="size-5 text-brand" />
                <h3 className="mt-4 font-medium tracking-tight">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Cara kerja */}
        <section id="cara-kerja" className="border-y border-border bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Dari absen sampai slip, satu alur.
            </h2>

            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} data-reveal className="relative">
                  <span className="font-mono text-xs font-medium text-brand">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-medium tracking-tight">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Slip contoh */}
        <section id="slip" className="mx-auto w-full max-w-6xl px-5 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Slip yang bisa dijelaskan baris per baris.
              </h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Setiap potongan punya jejak: hari hadir, lembur, kasbon, sampai total diterima.
                Kalau ada yang tanya &ldquo;kok gajiku segini?&rdquo;, tinggal buka slipnya.
              </p>

              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "Periode mengikuti pengaturan perusahaan (default tanggal 26)",
                  "Lembur dicatat manual, tidak menebak dari jam absen",
                  "Kasbon dipotong sesuai rencana per periode",
                  "Ekspor CSV untuk pembukuan atau transfer bank",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Kartu slip: krem di tema terang, hijau gelap di tema gelap */}
            <div data-reveal className="relative mx-auto w-full max-w-sm">
              <div
                aria-hidden
                className="absolute -inset-4 -rotate-1 rounded-[2rem] border border-brand/20 bg-brand-soft/50"
              />
              <div className="relative rounded-2xl bg-brand-foreground p-6 text-brand shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium tracking-wide uppercase opacity-70">
                      Slip gaji
                    </p>
                    <p className="mt-1 text-base font-semibold">Budi Santoso</p>
                    <p className="text-xs opacity-70">Harian · 26 Sep – 25 Okt 2026</p>
                  </div>
                  <CoinFace className="size-10" />
                </div>

                <div className="mt-5 space-y-2.5 text-sm">
                  <SlipRow label="Hari hadir (22)" value="Rp 2.200.000" />
                  <SlipRow label="Lembur (6 jam)" value="Rp 180.000" />
                  <SlipRow label="Kasbon" value="− Rp 300.000" />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-brand/20 pt-3">
                  <span className="text-sm font-medium">Diterima</span>
                  <span className="font-mono text-lg font-semibold tabular-nums">
                    Rp 2.080.000
                  </span>
                </div>

                <p className="mt-4 text-[11px] opacity-60">
                  Dibuat otomatis oleh Gaji · tidak perlu tanda tangan basah
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA akhir */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-3xl bg-brand px-6 py-14 text-center text-brand-foreground">
            <Sparkle className="absolute top-6 left-8 size-5 opacity-50" />
            <Sparkle className="absolute right-10 bottom-8 size-4 opacity-40" />
            <h2 className="mx-auto max-w-lg text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Siap rapikan gaji bulan ini?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm opacity-85">
              Daftarkan perusahaan, tambah karyawan, dan jalankan payroll pertama hari ini.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button
                asChild
                className="h-11 rounded-xl bg-brand-foreground px-5 text-[0.95rem] text-brand hover:bg-brand-foreground/90"
              >
                <Link href="/register">
                  Daftar sekarang
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-xl border-brand-foreground/40 bg-transparent px-5 text-[0.95rem] text-brand-foreground hover:bg-brand-foreground/10 hover:text-brand-foreground"
              >
                <Link href="/login">Saya sudah punya akun</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Gaji · Payroll &amp; absensi untuk UMKM Indonesia</p>
          <div className="flex gap-5">
            <Link href="/login" className="transition-colors hover:text-foreground">
              Masuk
            </Link>
            <Link href="/register" className="transition-colors hover:text-foreground">
              Daftar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StageRow({ label, meta, value }: { label: string; meta: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <span className="font-mono text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function SlipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-brand/20 pb-2">
      <span className="opacity-80">{label}</span>
      <span className="font-mono text-xs tabular-nums">{value}</span>
    </div>
  );
}
