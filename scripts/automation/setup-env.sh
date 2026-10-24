#!/usr/bin/env bash
# Menyiapkan container cloud untuk alur issue otomatis (lihat docs/automation.md):
# Postgres lokal + migrasi + seed demo, dependensi npm, dan Playwright untuk screenshot.
# Aman dijalankan berulang. omp dipasang terpisah lewat skill install-omp-inferhub
# (API key tidak boleh masuk repo).
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! pg_isready -q -h localhost 2>/dev/null; then
  service postgresql start >/dev/null
  sleep 2
fi
su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='gaji'\"" | grep -q 1 \
  || su postgres -c "psql -c \"create user gaji with password 'gaji' superuser;\" -c \"create database gaji owner gaji;\""

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/replace-with-a-random-secret-at-least-32-characters/$(openssl rand -hex 24)/" .env
fi

[ -d node_modules ] || npm ci --no-audit --no-fund
set -a; . ./.env; set +a
node scripts/migrate.mjs
npm run db:seed >/dev/null

# Playwright dipasang di luar repo supaya package.json tidak berubah.
TOOLS="${AUTOMATION_TOOLS:-/tmp/gaji-automation}"
if [ ! -d "$TOOLS/node_modules/playwright" ]; then
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm init -y >/dev/null && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.56.1 --no-audit --no-fund >/dev/null)
fi
echo "setup selesai. Jalankan dev server: npm run dev"
echo "screenshot: NODE_PATH=$TOOLS/node_modules node scripts/automation/screenshots.mjs <outDir> <admin|employee> <path...>"
