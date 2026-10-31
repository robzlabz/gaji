#!/usr/bin/env node
/**
 * Rilis otomatis Gaji — CalVer `vYYYY.MM.N`.
 *
 * Menyimpulkan semua PR yang sudah di-merge sejak rilis terakhir, mengelompokkannya
 * per jenis perubahan, memverifikasi build, lalu membuat tag + GitHub Release.
 *
 * Pemakaian:
 *   node scripts/release.mjs                # rilis sungguhan
 *   node scripts/release.mjs --dry-run      # cetak catatan rilis, tanpa membuat tag
 *   node scripts/release.mjs --skip-build   # lewati build (verifikasi lebih cepat)
 *   node scripts/release.mjs --force        # tetap rilis walau verifikasi gagal
 *
 * Aturan yang dipegang:
 * 1. Tidak ada PR baru sejak rilis terakhir -> tidak ada rilis (bukan rilis kosong).
 * 2. Build atau typecheck gagal -> rilis dibatalkan. Versi yang di-tag harus bisa di-build.
 * 3. Cek perhitungan yang gagal TIDAK membatalkan, tetapi dicatat di catatan rilis.
 *    Repo ini masih punya bug terbuka (#46), dan menyembunyikannya di catatan rilis
 *    lebih berbahaya daripada mengumumkannya.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.GAJI_REPO ?? "robzlabz/gaji";
const TIME_ZONE = "Asia/Jakarta";
const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const SKIP_BUILD = argv.has("--skip-build");
const FORCE = argv.has("--force");

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw new Error(`gh ${args.join(" ")} gagal: ${error.stderr?.toString() ?? error.message}`);
  }
}

function ghJson(args, opts) {
  const out = gh(args, opts);
  return out ? JSON.parse(out) : null;
}

/** Tanggal hari ini di zona Jakarta dalam bentuk YYYY-MM-DD (bukan UTC). */
function todayJakarta() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function stampJakarta() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
}

/** Ambil satu baris paling informatif dari output perintah yang gagal. */
function salientLine(raw) {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Buang banner npm dan baris perintah yang di-echo ulang.
    .filter((l) => !/^>/.test(l) && !/^npm (notice|warn|ERR!)/.test(l));
  const preferred = lines.find((l) => /(✗|error TS|Error:|gagal|failed)/i.test(l));
  return (preferred ?? lines[0] ?? "gagal").slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* 1. Kondisi repo                                                     */
/* ------------------------------------------------------------------ */

const branch = gh(["repo", "view", REPO, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
const headSha = gh(["api", `repos/${REPO}/commits/${branch}`, "--jq", ".sha"]);
const shortSha = headSha.slice(0, 8);

console.log(`repo      : ${REPO}`);
console.log(`branch    : ${branch} @ ${shortSha}`);
console.log(`tanggal   : ${todayJakarta()} (${TIME_ZONE})`);

/**
 * Tag menunjuk commit di GitHub, tetapi verifikasi (typecheck/build) dijalankan
 * pada working tree lokal. Kalau keduanya berbeda, yang diverifikasi bukan yang
 * dirilis — jadi hentikan sebelum membuat rilis yang menyesatkan.
 */
function assertLocalMatchesTarget() {
  let localSha;
  try {
    localSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Tidak berada di dalam repo git — jalankan skrip ini dari root repo.");
  }
  if (localSha !== headSha) {
    const message =
      `HEAD lokal (${localSha.slice(0, 8)}) berbeda dari ${branch} di GitHub (${shortSha}).\n` +
      `Rilis akan menandai commit yang tidak diverifikasi. Jalankan:\n` +
      `  git fetch origin && git checkout ${branch} && git pull --ff-only\n`;
    // Pratinjau tetap boleh jalan supaya catatan rilis bisa diperiksa lebih dulu.
    if (DRY_RUN) {
      console.log(`lokal     : HEAD berbeda dari ${branch} (dry run, hanya pratinjau)`);
      return;
    }
    throw new Error(message);
  }
  console.log(`lokal     : HEAD == ${branch} ✓`);
}

assertLocalMatchesTarget();

/* ------------------------------------------------------------------ */
/* 2. Rilis terakhir & PR baru                                         */
/* ------------------------------------------------------------------ */

const releases = ghJson([
  "release", "list", "--repo", REPO, "--limit", "100",
  "--json", "tagName,publishedAt,name",
]) ?? [];

const lastRelease = releases[0] ?? null;

if (lastRelease) {
  console.log(`rilis lalu: ${lastRelease.tagName} (${lastRelease.publishedAt})`);
} else {
  console.log("rilis lalu: belum ada — ini akan jadi rilis baseline");
}

const mergedPrs = ghJson([
  "pr", "list", "--repo", REPO, "--state", "merged", "--limit", "300",
  "--json", "number,title,mergedAt,url,author,labels,body",
]) ?? [];

const sinceMs = lastRelease?.publishedAt ? new Date(lastRelease.publishedAt).getTime() : 0;
const fresh = mergedPrs
  .filter((pr) => new Date(pr.mergedAt).getTime() > sinceMs)
  .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));

if (fresh.length === 0) {
  console.log("\nTidak ada PR baru yang di-merge sejak rilis terakhir.");
  console.log("Tidak ada rilis yang dibuat (rilis kosong tidak berguna).");
  process.exit(0);
}

console.log(`PR baru   : ${fresh.length}`);

/* ------------------------------------------------------------------ */
/* 3. Kelompokkan perubahan                                            */
/* ------------------------------------------------------------------ */

const GROUP_ORDER = ["keamanan", "perbaikan", "fitur", "performa", "dokumentasi", "internal", "lainnya"];
const GROUP_LABEL = {
  keamanan: "Keamanan",
  perbaikan: "Perbaikan",
  fitur: "Fitur",
  performa: "Performa",
  dokumentasi: "Dokumentasi",
  internal: "Internal & tooling",
  lainnya: "Lainnya",
};

/** Jenis perubahan dari judul konvensional, dengan label sebagai cadangan. */
function classify(pr) {
  const title = pr.title ?? "";
  const labels = (pr.labels ?? []).map((l) => l.name.toLowerCase());
  const scope = title.match(/^(\w+)(\([^)]*\))?!?:/)?.[1]?.toLowerCase() ?? "";

  if (labels.includes("security") || ["security", "sec"].includes(scope)) return "keamanan";
  if (["fix", "bugfix", "hotfix"].includes(scope) || labels.includes("bug")) return "perbaikan";
  if (labels.includes("feature") || ["feat", "feature"].includes(scope)) return "fitur";
  if (["perf", "performance"].includes(scope)) return "performa";
  if (["docs", "doc"].includes(scope) || labels.includes("documentation")) return "dokumentasi";
  if (["chore", "ci", "build", "refactor", "test", "style"].includes(scope)) return "internal";
  return "lainnya";
}

/** Ringkasan satu baris: buang prefix konvensional, pertahankan kalimatnya. */
function summarize(pr) {
  const title = (pr.title ?? "").replace(/^\w+(\([^)]*\))?!?:\s*/, "").trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const grouped = new Map(GROUP_ORDER.map((g) => [g, []]));
for (const pr of fresh) grouped.get(classify(pr)).push(pr);

/* ------------------------------------------------------------------ */
/* 4. Verifikasi                                                       */
/* ------------------------------------------------------------------ */

/** Jalankan satu perintah verifikasi; kembalikan status ringkas. */
function verify(name, command, commandArgs, { env = {}, blocking }) {
  try {
    execFileSync(command, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      timeout: 15 * 60_000,
    });
    console.log(`  ✓ ${name}`);
    return { name, ok: true, blocking, detail: "lulus" };
  } catch (error) {
    const detail = salientLine(`${error.stdout ?? ""}${error.stderr ?? ""}`);
    console.log(`  ${blocking ? "✗" : "!"} ${name} — ${detail.slice(0, 120)}`);
    return { name, ok: false, blocking, detail };
  }
}

const BUILD_ENV = {
  DATABASE_URL: "postgres://build:build@127.0.0.1:5432/build",
  BETTER_AUTH_SECRET: "build-time-placeholder-0000000000000000000000000000",
  BETTER_AUTH_URL: "http://localhost:3000",
};

/** Apakah sebuah npm script terdaftar di package.json? Script yang belum ada dilewati, bukan digagalkan. */
function hasNpmScript(name) {
  try {
    const pkg = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], {
      encoding: "utf8",
    }));
    return Boolean(pkg[name]);
  } catch {
    return false;
  }
}

console.log("\nverifikasi:");
const checks = [];

// Tanpa node_modules, semua cek akan gagal dengan pesan yang menyesatkan
// ("tsc tidak ditemukan") padahal masalahnya cuma belum `npm ci`.
if (!existsSync("node_modules")) {
  console.error(
    "node_modules belum ada. Jalankan `npm ci` dulu — skrip ini butuh dependensi untuk typecheck dan build.",
  );
  process.exit(1);
}

checks.push(verify("typecheck", "npx", ["tsc", "--noEmit"], { blocking: true }));

// `check:all` baru ada di branch roadmap. Selama belum di-merge, jangan gagalkan rilis —
// tetapi juga jangan diam: catat bahwa cek perhitungan belum tersedia.
if (hasNpmScript("check:all")) {
  checks.push(verify("cek perhitungan", "npm", ["run", "check:all"], { blocking: false }));
} else {
  console.log("  – cek perhitungan — dilewati (script check:all belum ada di branch ini)");
  checks.push({
    name: "cek perhitungan",
    ok: false,
    blocking: false,
    detail: "script check:all belum ada di branch ini — cek perhitungan tidak dijalankan",
    skipped: true,
  });
}

if (!SKIP_BUILD) {
  checks.push(verify("build", "npm", ["run", "build"], { env: BUILD_ENV, blocking: true }));
}

const blockingFailed = checks.filter((c) => c.blocking && !c.ok);
if (blockingFailed.length > 0 && !FORCE) {
  console.error(
    `\nRilis dibatalkan: ${blockingFailed.map((c) => c.name).join(", ")} gagal.` +
      `\nVersi yang di-tag harus bisa di-build. Perbaiki dulu, atau pakai --force bila memang disengaja.`,
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 5. Nomor versi                                                      */
/* ------------------------------------------------------------------ */

const [year, month] = todayJakarta().split("-");
const prefix = `v${year}.${month}.`;
const usedThisMonth = releases.filter((r) => r.tagName.startsWith(prefix)).length;
const tag = `${prefix}${usedThisMonth + 1}`;

/* ------------------------------------------------------------------ */
/* 6. Catatan rilis                                                    */
/* ------------------------------------------------------------------ */

const countByGroup = GROUP_ORDER.map((g) => [g, grouped.get(g).length]).filter(([, n]) => n > 0);

const lines = [];
lines.push(`# Gaji ${tag}`);
lines.push("");
lines.push(
  `Rilis otomatis harian · **${stampJakarta()}** · commit [\`${shortSha}\`](https://github.com/${REPO}/commit/${headSha})`,
);
lines.push("");

// --- ringkasan
lines.push("## Ringkasan");
lines.push("");
if (lastRelease) {
  lines.push(`**${fresh.length} perubahan** dari PR yang di-merge sejak [\`${lastRelease.tagName}\`].`);
} else {
  lines.push(
    `**Rilis baseline** — ${fresh.length} PR yang sudah di-merge sampai commit \`${shortSha}\`. ` +
      "Belum ada rilis sebelumnya, jadi catatan ini memuat seluruh riwayat yang tercatat sebagai PR.",
  );
}
lines.push("");
for (const [group, n] of countByGroup) {
  lines.push(`- ${n} ${GROUP_LABEL[group].toLowerCase()}`);
}
lines.push("");

// --- per kelompok
for (const group of GROUP_ORDER) {
  const items = grouped.get(group);
  if (items.length === 0) continue;
  lines.push(`## ${GROUP_LABEL[group]}`);
  lines.push("");
  for (const pr of items) {
    const author = pr.author?.login ? ` · @${pr.author.login}` : "";
    lines.push(`- **#${pr.number}** ${summarize(pr)} — [PR #${pr.number}](${pr.url})${author}`);
  }
  lines.push("");
}

// --- verifikasi
lines.push("## Verifikasi");
lines.push("");
lines.push("| Cek | Hasil |");
lines.push("| --- | --- |");
for (const check of checks) {
  let icon;
  let label;
  if (check.skipped) {
    icon = "–";
    label = "dilewati";
  } else if (check.ok) {
    icon = "✓";
    label = "lulus";
  } else {
    icon = check.blocking ? "✗" : "!";
    label = "gagal";
  }
  lines.push(`| ${check.name} | ${icon} ${label} |`);
}
lines.push("");
const failedChecks = checks.filter((c) => !c.ok && !c.skipped);
if (failedChecks.length > 0) {
  lines.push("**Cek yang gagal:**");
  lines.push("");
  for (const check of failedChecks) {
    const forced = check.blocking ? " (dipaksa rilis dengan `--force`)" : " (diketahui, masih terbuka)";
    lines.push(`- \`${check.name}\`${forced} — ${check.detail}`);
  }
  lines.push("");
  lines.push("Lihat `docs/roadmap-mvp.md` untuk rencana perbaikannya.");
  lines.push("");
}

// --- apa yang belum masuk rilis ini
const openPrs = ghJson([
  "pr", "list", "--repo", REPO, "--state", "open", "--limit", "50",
  "--json", "number,title,url,isDraft",
]) ?? [];
if (openPrs.length > 0) {
  lines.push("## Belum masuk rilis ini");
  lines.push("");
  lines.push("PR berikut masih terbuka dan akan masuk rilis setelah di-merge:");
  lines.push("");
  for (const pr of openPrs) {
    const draft = pr.isDraft ? " *(draft)*" : "";
    lines.push(`- **#${pr.number}** ${summarize(pr)} — [PR #${pr.number}](${pr.url})${draft}`);
  }
  lines.push("");
}

// --- kompatibilitas
lines.push("## Catatan pemakaian");
lines.push("");
lines.push(
  "- Migrasi database diterapkan otomatis saat container start (`node scripts/migrate.mjs`). " +
    "Versi ini tidak memerlukan langkah manual.",
);
lines.push("- Rollback: deploy ulang image/tag rilis sebelumnya di Easypanel, lalu pulihkan backup bila ada perubahan skema.");
lines.push("");

const notes = lines.join("\n");
const notesFile = join(mkdtempSync(join(tmpdir(), "gaji-release-")), "notes.md");
writeFileSync(notesFile, notes, "utf8");

console.log(`\nversi     : ${tag}`);
console.log(`catatan   : ${notesFile}`);

/* ------------------------------------------------------------------ */
/* 7. Buat rilis                                                       */
/* ------------------------------------------------------------------ */

if (DRY_RUN) {
  console.log("\n--- catatan rilis (dry run) ---\n");
  console.log(notes);
  console.log("\n(dry run: tidak ada tag atau release yang dibuat)");
  process.exit(0);
}

const title = `Gaji ${tag}`;
gh([
  "release", "create", tag,
  "--repo", REPO,
  "--title", title,
  "--notes-file", notesFile,
  "--target", headSha,
]);

console.log(`\n✓ Release ${tag} dibuat: https://github.com/${REPO}/releases/tag/${tag}`);
