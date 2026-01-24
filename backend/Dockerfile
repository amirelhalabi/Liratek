# Backend container (Express + Socket.IO + better-sqlite3)
# Note: better-sqlite3 needs native build toolchain

FROM node:20-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests for yarn workspaces install (build context is repo root: liratek/)
COPY package.json yarn.lock .yarnrc.yml /app/
COPY .yarn /app/.yarn

# Copy backend sources
COPY backend/ /app/backend/

# Install dependencies (workspace)
RUN corepack enable && yarn install --immutable

WORKDIR /app/backend

# Build TS -> dist
RUN yarn build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.js"]
