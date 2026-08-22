# PDF Injection API (apps/api) — Bun + Elysia.
#
# Build context MUST be the repository root (this is a Bun workspace
# monorepo; @pdf-injection/* deps are `workspace:*` and only resolve when
# the whole workspace is present), e.g.:
#   docker build -f apps/api/Dockerfile -t pdf-injection-api .
# or via docker-compose.yml (build.context: ., build.dockerfile: apps/api/Dockerfile).
#
# This file is not executed by any agent per CLAUDE.md ("NEVER build the
# software until the user explicitly asks for a build") — it is validated
# with `docker compose config` only.

FROM oven/bun:1

WORKDIR /app

# Copy the full workspace (root manifest + lockfile first for layer caching,
# then everything else). .dockerignore excludes node_modules, dist, test
# artifacts, and VCS metadata.
COPY package.json bun.lock ./
COPY . .

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
# Persisted job artifacts + sqlite DB live under this directory; mount a
# volume here in docker-compose so data survives container restarts.
ENV PS_STORAGE_DIR=/app/data
ENV PS_DB_PATH=/app/data/pdf-injection.sqlite
ENV PS_PORT=3001

# Run as the non-root `bun` user oven/bun images ship (UID/GID 1000), not
# root. /app/data is the volume mount point (see docker-compose.yml) and
# must be owned by `bun` before the volume takes over its permissions on
# first mount, otherwise the API process can't write job artifacts/sqlite.
RUN mkdir -p /app/data && chown -R bun:bun /app /app/data
USER bun

EXPOSE 3001

# oven/bun images don't ship curl/wget; use bun's own fetch instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PS_PORT || 3001) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "--cwd", "apps/api", "start"]
