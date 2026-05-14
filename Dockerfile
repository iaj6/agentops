################################################################################
# AgentOps self-host image
#
# Builds the dashboard (Next.js standalone) and bundles the CLI so admins can
# run `docker compose exec dashboard agentops user add <email>` to bootstrap.
#
# Single image, two stages:
#   builder  - installs all workspaces, compiles TypeScript + Next.js
#   runtime  - copies the standalone build + the CLI dist + node_modules
################################################################################

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native-build deps for better-sqlite3 (clean up after we install).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for a cache-friendly install.
COPY package.json package-lock.json* ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

# Now bring in sources and build. Each workspace tsconfig.json extends
# the shared base at the repo root.
COPY tsconfig.base.json ./
COPY packages packages

# Build core/db/sdk/cli first (tsc).
RUN npm run build --workspace=packages/core \
                  --workspace=packages/db \
                  --workspace=packages/sdk \
                  --workspace=packages/cli

# Build the web dashboard. Skip the workspace's postbuild script (which has
# odd cross-environment behavior with the cp pipeline) and replicate it
# explicitly so we know what runs and why.
RUN cd packages/web && npx --no next build
RUN mkdir -p packages/web/.next/standalone/packages/web/.next \
    && cp -r packages/web/.next/static packages/web/.next/standalone/packages/web/.next/static \
    && if [ -d packages/web/public ]; then cp -r packages/web/public packages/web/.next/standalone/packages/web/public; fi

# Prune dev deps from the workspace roots that ship to runtime.
# (We keep the build artifacts in dist/ + .next/ — those are not deps.)
RUN npm prune --workspaces --omit=dev

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Run as a non-root user so files written to the mounted /data volume
# don't end up owned by root on the host.
RUN groupadd --system --gid 1001 agentops \
    && useradd  --system --uid 1001 --gid agentops --shell /bin/bash --home /home/agentops --create-home agentops

WORKDIR /app

# Copy everything the runtime needs.
COPY --from=builder --chown=agentops:agentops /app/package.json ./package.json
COPY --from=builder --chown=agentops:agentops /app/package-lock.json* ./
COPY --from=builder --chown=agentops:agentops /app/node_modules ./node_modules
COPY --from=builder --chown=agentops:agentops /app/packages ./packages

# CLI wrapper so `docker compose exec dashboard agentops user add ...`
# Just Works. The wrapper points at the compiled CLI entrypoint.
RUN printf '#!/bin/sh\nexec node /app/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/agentops \
    && chmod +x /usr/local/bin/agentops

# Database lives on a mounted volume. AGENTOPS_DB_PATH points the dashboard
# and the bundled CLI at the same file.
ENV AGENTOPS_DB_PATH=/data/agentops.db
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

# Create the volume mountpoint with the right ownership ahead of time so a
# bind-mounted host directory inherits sensible perms on first start.
RUN mkdir -p /data && chown agentops:agentops /data

VOLUME /data
EXPOSE 3000

USER agentops

# Default command: launch the Next.js standalone server. The CLI is reachable
# via `docker compose exec` for user-management commands.
CMD ["node", "packages/web/.next/standalone/packages/web/server.js"]
