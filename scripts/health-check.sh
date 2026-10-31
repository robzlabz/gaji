#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Gaji — pemeriksaan kesehatan repo & rilis (dipakai jadwal CTO).
#
# Jalankan dari root repo:  bash scripts/health-check.sh
# Keluaran: ringkasan PASS/FAIL per cek + baris STATUS untuk dicatat.
#
# Cek sengaja tidak menyentuh database: semuanya statis atau lewat HTTP,
# supaya bisa dijalankan dari mana pun tanpa setup.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO="robzlabz/gaji"
PROD_URL="https://gaji.timbolu.com"
BRANCH="${1:-main}"

pass=0; fail=0; warn=0
ok()   { printf "  ✓ %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  ✗ %s\n" "$1"; fail=$((fail+1)); }
note() { printf "  · %s\n" "$1"; warn=$((warn+1)); }

echo "=== Gaji health check · $(date '+%Y-%m-%d %H:%M %Z') · branch $BRANCH ==="

# --- 1. build & typecheck ---------------------------------------------------
echo "[1] build & typecheck"
if [ -d node_modules ]; then
  if npx tsc --noEmit >/tmp/hc-tsc.log 2>&1; then ok "tsc --noEmit"; else bad "tsc --noEmit — $(head -1 /tmp/hc-tsc.log)"; fi
  if npx eslint >/tmp/hc-lint.log 2>&1; then ok "eslint (0 error)"; else bad "eslint — $(grep -c ' error ' /tmp/hc-lint.log) error"; fi
  if npm run check:cuti >/tmp/hc-cuti.log 2>&1; then ok "check:cuti"; else bad "check:cuti gagal"; fi
  if npm run check:saldo >/tmp/hc-saldo.log 2>&1; then ok "check:saldo"; else bad "check:saldo gagal"; fi
  if npm run check:csv >/tmp/hc-csv.log 2>&1; then ok "check:csv"; else bad "check:csv gagal"; fi
  if npm run check:period >/tmp/hc-period.log 2>&1; then ok "check:period"; else bad "check:period gagal"; fi
else
  note "node_modules belum ada — jalankan npm ci dulu"
fi

# --- 2. git & branch -------------------------------------------------------
echo "[2] git"
if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  if git diff --quiet "origin/$BRANCH" 2>/dev/null; then ok "lokal sinkron dengan origin/$BRANCH"; else note "lokal berbeda dari origin/$BRANCH"; fi
else
  note "tidak bisa fetch origin/$BRANCH"
fi
if [ -d node_modules ]; then
  if git status --porcelain | grep -q .; then note "ada perubahan belum di-commit"; else ok "working tree bersih"; fi
fi

# --- 3. CI -----------------------------------------------------------------
echo "[3] CI (GitHub Actions)"
if command -v gh >/dev/null 2>&1; then
  runs=$(gh run list --repo "$REPO" --branch "$BRANCH" --limit 5 --json conclusion,createdAt,displayTitle 2>/dev/null)
  if [ -n "$runs" ]; then
    total=$(printf '%s' "$runs" | grep -c conclusion || true)
    succ=$(printf '%s' "$runs" | grep -c '"conclusion":"success"' || true)
    if [ "$succ" -gt 0 ]; then ok "$succ/$total run terakhir sukses"; else bad "0/$total run terakhir sukses — CI tidak pernah hijau"; fi
    note "run terbaru: $(printf '%s' "$runs" | head -1 | cut -c1-120)"
  else
    note "tidak ada workflow run untuk $BRANCH"
  fi
else
  note "gh CLI tidak tersedia"
fi

# --- 4. produksi -----------------------------------------------------------
echo "[4] produksi ($PROD_URL)"
for path in / /login /register; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROD_URL$path" 2>/dev/null)
  if [ "$code" = "200" ]; then ok "$path → 200"; else bad "$path → $code"; fi
done
for path in /admin /employee; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROD_URL$path" 2>/dev/null)
  if [ "$code" = "307" ] || [ "$code" = "200" ]; then ok "$path → $code (redirect/login sesuai harapan)"; else bad "$path → $code"; fi
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$PROD_URL/api/mcp" 2>/dev/null)
if [ "$code" = "401" ]; then ok "/api/mcp → 401 (butuh key, sesuai harapan)"; else note "/api/mcp → $code"; fi
mcp=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROD_URL/api/mcp/gk_healthcheck" 2>/dev/null)
if [ "$mcp" = "404" ]; then note "/api/mcp/<key> → 404 — rute path-key belum ter-deploy"; else ok "/api/mcp/<key> → $mcp"; fi

# --- 5. isu terbuka --------------------------------------------------------
echo "[5] issue & PR"
if command -v gh >/dev/null 2>&1; then
  open=$(gh issue list --repo "$REPO" --state open --limit 100 --json number 2>/dev/null | grep -o '"number":[0-9]*' | wc -l | tr -d ' ')
  prs=$(gh pr list --repo "$REPO" --state open --limit 50 --json number 2>/dev/null | grep -o '"number":[0-9]*' | wc -l | tr -d ' ')
  note "$open issue terbuka, $prs PR terbuka"
  # Issue bug/security terbuka tertua = kandidat prioritas berikutnya.
  oldest=$(gh issue list --repo "$REPO" --state open --limit 100 --json number,createdAt 2>/dev/null \
    | grep -o '"number":[0-9]*' | grep -o '[0-9]*' | sort -n | head -5 | tr '\n' ' ')
  if [ -n "$oldest" ]; then note "issue terbuka nomor terkecil: $oldest"; fi
else
  note "gh CLI tidak tersedia"
fi

# --- 6. migrasi ------------------------------------------------------------
echo "[6] migrasi"
sql=$(ls drizzle/*.sql 2>/dev/null | wc -l)
snap=$(ls drizzle/meta/*_snapshot.json 2>/dev/null | wc -l)
if [ "$sql" -eq $((snap)) ]; then ok "$sql migrasi, $snap snapshot — journal sinkron"; else bad "$sql migrasi vs $snap snapshot — journal desync (F11)"; fi
if [ -d node_modules ]; then
  if npx drizzle-kit generate --dry-run >/tmp/hc-dk.log 2>&1 || true; then
    if grep -qiE 'no changes|nothing to' /tmp/hc-dk.log; then ok "drizzle-kit generate tidak menghasilkan diff"; else note "drizzle-kit generate menghasilkan diff baru — periksa"; fi
  fi
fi

# --- ringkasan -------------------------------------------------------------
echo "=== ringkasan: $pass lulus, $fail gagal, $warn catatan ==="
if [ "$fail" -gt 0 ]; then echo "STATUS: PERLU TINDAKAN"; exit 1; fi
echo "STATUS: SEHAT"
exit 0
