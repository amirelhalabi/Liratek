# syntax=docker/dockerfile:1
#
# Frontend container — Vite build served by Nginx, which also reverse-proxies
# the backend so the whole app lives on ONE origin.
#
# Build from the REPO ROOT:  docker build -f Dockerfile .

# ─────────────────────────────────────────────────────────────── build ───────
FROM node:20-bookworm-slim AS build

# Present for better-sqlite3's install script, which runs during the workspace
# install even though the browser bundle never touches it (no prebuild for
# linux/arm64 ⇒ compiles from source ⇒ needs a toolchain).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# See backend/Dockerfile for why both of these are required, not optional.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    LIRATEK_SKIP_NATIVE_REBUILD=1

COPY package.json yarn.lock .yarnrc.yml ./
COPY backend/package.json       backend/package.json
COPY frontend/package.json      frontend/package.json
COPY electron-app/package.json  electron-app/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json   packages/ui/package.json

RUN corepack enable && yarn install --immutable

# packages/ui is source-consumed through a Vite/tsconfig alias (no build step),
# and the frontend imports types from packages/core — so both come along.
COPY packages/ packages/
COPY frontend/ frontend/

# Deliberately NOT the root `yarn build`: that one also compiles electron-app
# and runs scripts/build-stage.cjs to stage an Electron release, which this
# image does not ship.
RUN yarn workspace @liratek/core build \
 && yarn workspace @liratek/frontend build

# ───────────────────────────────────────────────────────────── runtime ───────
FROM nginx:alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Runtime origin binding — the reason one image works on every hostname.
#
# frontend/src/api/httpClient.ts and socket.ts both read
# `globalThis.__LIRATEK_BACKEND_URL` BEFORE the build-time VITE_BACKEND_URL,
# falling back to http://127.0.0.1:3000 (which, from a visitor's browser, means
# their own machine — the bug this replaces). Pointing it at the page's own
# origin means: no API hostname baked into the bundle, no rebuild when the
# domain arrives, and every future tenant subdomain served by this same image
# talks to its own host. Nginx below proxies /api on that origin.
RUN printf 'window.__LIRATEK_BACKEND_URL = window.location.origin;\n' \
      > /usr/share/nginx/html/runtime-config.js \
 && sed -i 's#</head>#  <script src="/runtime-config.js"></script>\n  </head>#' \
      /usr/share/nginx/html/index.html \
 && grep -q 'runtime-config.js' /usr/share/nginx/html/index.html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
