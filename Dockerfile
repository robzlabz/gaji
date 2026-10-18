# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Gaji — Next.js 15 (App Router) production image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies ----------------------------------------------------------
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# --- build -----------------------------------------------------------------
FROM base AS builder
# Nilai placeholder: build tidak menyentuh database (semua halaman dinamis).
# Nilai asli di-inject Easypanel saat runtime.
ENV NODE_ENV=production \
    DATABASE_URL="postgres://build:build@127.0.0.1:5432/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-0000000000000000000000000000" \
    BETTER_AUTH_URL="http://localhost:3000"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrasi skema dijalankan saat container start (lihat scripts/migrate.mjs).
# `postgres` di-bundle webpack untuk app, jadi perlu disalin manual untuk script migrasi.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
