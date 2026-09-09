# syntax=docker/dockerfile:1
#
# Backend container — Express + Socket.IO + better-sqlite3, serving the web
# transport of the SAME @liratek/core the Electron app uses.
#
# Build from the REPO ROOT:  docker build -f backend/Dockerfile .
# (or via docker-compose.yml, which sets the context correctly)

# ─────────────────────────────────────────────────────────────── build ───────
FROM node:20-bookworm-slim AS build

# better-sqlite3 compiles from source whenever no prebuild matches the target
# (notably linux/arm64, i.e. the cheap ARM VPS tiers). Toolchain stays in this
# stage only — the runtime image never needs a compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Both of these are load-bearing, not optimizations:
#
#  LIRATEK_SKIP_NATIVE_REBUILD — `electron` is a root devDependency and the root
#    postinstall runs scripts/rebuild-native-deps.cjs, which replaces the
#    better-sqlite3 binary with Electron's ABI (125). This image runs plain Node
#    (ABI 115), so that binary is unloadable and the server dies at require().
#  ELECTRON_SKIP_BINARY_DOWNLOAD — skips a ~100 MB Electron download this image
#    has no use for.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    LIRATEK_SKIP_NATIVE_REBUILD=1 \
    # Stream package build output instead of writing it to a log file inside
    # the builder. Without this, a failing postinstall reports only
    # "couldn't be built successfully (exit code 1, logs can be found here:
    # /tmp/xfs-…/build.log)" — a path in a container that is already gone by
    # the time you read the error, which makes the one failure you actually
    # need to debug the one you cannot.
    YARN_ENABLE_INLINE_BUILDS=1

# Yarn resolves the whole workspace graph declared in the root package.json, so
# every workspace's manifest must exist — even frontend/electron-app, whose
# sources this image never copies. Manifests first so an edit to source code
# reuses the (slow) install layer.
COPY package.json yarn.lock .yarnrc.yml ./
# .yarnrc.yml pins yarnPath at this committed binary, so the install needs it.
COPY .yarn/releases/ ./.yarn/releases/
COPY backend/package.json       backend/package.json
COPY frontend/package.json      frontend/package.json
COPY electron-app/package.json  electron-app/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json   packages/ui/package.json

# The root `postinstall` is `node scripts/rebuild-native-deps.cjs`, so the file
# has to be in the image BEFORE the install or yarn fails the root workspace
# build with MODULE_NOT_FOUND. LIRATEK_SKIP_NATIVE_REBUILD above cannot rescue
# this: the script must exist in order to run and read the flag.
#
# Just this one file, not the whole scripts/ directory — the rest of it changes
# far more often and would invalidate the (slow) install layer on every edit.
COPY scripts/rebuild-native-deps.cjs scripts/rebuild-native-deps.cjs

RUN corepack enable && yarn install --immutable

# Sources: core (the actual business logic) + backend (routes only).
COPY packages/core/ packages/core/
COPY backend/ backend/

# Core must be built first — backend/tsconfig.json resolves @liratek/core
# through it, and the runtime imports its dist/.
RUN yarn workspace @liratek/core build \
 && yarn workspace @liratek/backend build

# ── Litestream ───────────────────────────────────────────────────────────────
# Fetched in the BUILD stage so the runtime image needs no curl and gains no
# extra layers; only the ~12 MB static binary is copied forward.
#
# Version is PINNED. An unpinned backup tool is one that changes underneath you,
# and the release you validated a restore against is the only one you know
# restores. Note the asset is named x86_64, not amd64.
ARG LITESTREAM_VERSION=0.5.17
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && case "${TARGETARCH:-amd64}" in \
       amd64) LS_ARCH=x86_64 ;; \
       arm64) LS_ARCH=arm64 ;; \
       *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${LS_ARCH}.tar.gz" \
     | tar -C /usr/local/bin -xz litestream \
  && /usr/local/bin/litestream version

# ───────────────────────────────────────────────────────────── runtime ───────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# node_modules carries the better-sqlite3 .node compiled above against THIS
# base image's Node ABI, plus the @liratek/core workspace link.
COPY --from=build /app/node_modules         ./node_modules
COPY --from=build /app/package.json         ./package.json
COPY --from=build /app/packages/core        ./packages/core
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist         ./backend/dist

# First boot on an empty volume bootstraps the schema from the Electron SQL
# file: backend/src/database/connection.ts resolves it relative to its own
# compiled location (backend/dist/database → ../../../electron-app/…), so the
# path below is not arbitrary — it must sit exactly here or boot fails ENOENT.
# Migrations then run on every start, so an existing volume upgrades in place.
COPY electron-app/create_db.sql ./electron-app/create_db.sql

# Litestream: the static binary, its config (read from /etc/litestream.yml by
# default) and the entrypoint that restores-if-empty then replicates.
COPY --from=build /usr/local/bin/litestream /usr/local/bin/litestream
COPY backend/litestream.yml                 /etc/litestream.yml
COPY backend/docker-entrypoint.sh           /usr/local/bin/docker-entrypoint.sh

# chmod here rather than relying on the file's mode in git: this repo is checked
# out on Windows, where the executable bit does not survive, so the committed
# file arrives non-executable (docs/DEPLOYMENT.md hits the same thing with
# deploy-smoke.sh).
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop root. /data is the DB volume mountpoint (DATABASE_PATH), created here so
# the unprivileged user can write it even on a fresh named volume.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

WORKDIR /app/backend

EXPOSE 3000

# The entrypoint execs the server, so node is still PID 1's process image and
# signal handling is unchanged. It falls through to starting the app on every
# failure path — see the script for why nothing there may block a boot.
CMD ["/usr/local/bin/docker-entrypoint.sh"]
