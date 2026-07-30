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
    LIRATEK_SKIP_NATIVE_REBUILD=1

# Yarn resolves the whole workspace graph declared in the root package.json, so
# every workspace's manifest must exist — even frontend/electron-app, whose
# sources this image never copies. Manifests first so an edit to source code
# reuses the (slow) install layer.
COPY package.json yarn.lock .yarnrc.yml ./
COPY backend/package.json       backend/package.json
COPY frontend/package.json      frontend/package.json
COPY electron-app/package.json  electron-app/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json   packages/ui/package.json

RUN corepack enable && yarn install --immutable

# Sources: core (the actual business logic) + backend (routes only).
COPY packages/core/ packages/core/
COPY backend/ backend/

# Core must be built first — backend/tsconfig.json resolves @liratek/core
# through it, and the runtime imports its dist/.
RUN yarn workspace @liratek/core build \
 && yarn workspace @liratek/backend build

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

# Drop root. /data is the DB volume mountpoint (DATABASE_PATH), created here so
# the unprivileged user can write it even on a fresh named volume.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

WORKDIR /app/backend

EXPOSE 3000

CMD ["node", "dist/server.js"]
