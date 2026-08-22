# PDF Injection web (apps/web) — Vite + React, multi-stage build.
#
# Build context MUST be the repository root (Bun workspace monorepo), e.g.:
#   docker build -f apps/web/Dockerfile -t pdf-injection-web .
# or via docker-compose.yml.
#
# This file is not executed by any agent per CLAUDE.md ("NEVER build the
# software until the user explicitly asks for a build") — it is validated
# with `docker compose config` only.

# ---- Stage 1: build ---------------------------------------------------
FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY . .

RUN bun install --frozen-lockfile
# apps/web has no "build" npm script defined (round 1 deliberately avoided
# defining one — CLAUDE.md forbids running a build until the user asks); we
# invoke the local `vite` binary directly instead of adding one.
RUN cd apps/web && bunx vite build

# ---- Stage 2: serve -----------------------------------------------------
# A second, smaller Bun image that only carries the built static assets
# plus the tiny serve.ts static file server (Bun.serve, SPA fallback, /api
# proxy to the api service — see apps/web/serve.ts).
FROM oven/bun:1-slim AS serve

WORKDIR /app/apps/web

COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/apps/web/serve.ts ./serve.ts

# NODE_ENV=production is belt-and-suspenders here: serve.ts also passes
# `development: false` explicitly to Bun.serve() so this server never
# renders Bun's debug error overlay (source/paths/stack trace) to a client
# regardless of this env var — see the hardening note at the top of
# serve.ts and .agents/state/memories/result-qa-r1b-session-20260822-132343.md.
ENV NODE_ENV=production
ENV PORT=80
ENV PS_API_PROXY_TARGET=http://api:3001

# Run as the non-root `bun` user oven/bun images ship (UID/GID 1000), not
# root. This stage only serves static files + proxies /api, so it never
# needs write access to anything.
RUN chown -R bun:bun /app
USER bun

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 80) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "serve.ts"]
