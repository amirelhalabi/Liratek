# Deploying the LiraTek web app

The desktop Electron app is unaffected by everything in this document. Both
transports ship from the same codebase and land on the same `@liratek/core`
services — desktop over IPC against a local/network SQLite file, web over REST
against a server-hosted one. See `CLAUDE.md` § Dual-Transport Architecture.

**Status:** the container stack below is complete but **has not yet been built or
run** — see § Verification status. Subdomain-per-tenant login IS
implemented but stays inert until `APP_BASE_DOMAIN` is set; see § Not done
yet.

---

## 1. What this deploys

```
browser ──► nginx :80  ──┬──►  /            SPA (frontend/dist)
   (one origin)          ├──►  /api/*       proxy → backend:3000  (REST + voice WS)
                         ├──►  /socket.io/  proxy → backend:3000  (Socket.IO)
                         └──►  /health      proxy → backend:3000

                              backend :3000  (internal only, not published)
                                └── SQLite on the `liratek_data` volume
```

**One origin** is the load-bearing choice. It means no CORS preflights, and no
API hostname compiled into the JS bundle: the nginx image writes a
`runtime-config.js` that sets `window.__LIRATEK_BACKEND_URL =
window.location.origin`, which `httpClient.ts` and `socket.ts` both honour ahead
of the build-time `VITE_BACKEND_URL`. One image therefore works on an IP today,
your domain tomorrow, and per-tenant subdomains after that — with no rebuild.

**SQLite has exactly one writer.** Never scale `backend` past one replica. That
single constraint is why this targets one small VPS instead of anything that
autoscales.

## 2. Cost

About **$5/month**: a €4–5/mo VPS (Hetzner CAX11 ARM / CX22, or a $5–6
DigitalOcean/Vultr/Linode box) plus ~$12/yr for a domain. TLS is free via Let's
Encrypt. Verify current prices before buying — they drift.

2 vCPU / 4 GB is comfortable. The ARM tiers work: both Dockerfiles keep a
build toolchain because `better-sqlite3` has no linux/arm64 prebuild and
compiles from source there.

## 3. First deploy

```bash
# On the VPS (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh

git clone <your-repo> liratek && cd liratek

cp .env.deploy.example .env.deploy
# Fill in, at minimum:
#   JWT_SECRET            openssl rand -base64 48
#   DATABASE_KEY          required by the prod check — read § 6 first
#   CORS_ORIGIN           http://<your-ip>  (or https://<host> later)
#   SUPER_ADMIN_USERNAME  the platform control-plane account
#   SUPER_ADMIN_PASSWORD  must pass validatePasswordComplexity()
#   API_RATE_LIMIT_MAX    1000 — the 100 default is sized for one user
nano .env.deploy

docker compose up -d --build     # first build is slow (native compile)
docker compose logs -f backend   # watch schema → migrations → super admin

bash scripts/deploy-smoke.sh http://<your-ip>
```

(Invoked via `bash` rather than `./` because the executable bit does not survive
a Windows checkout.)

The smoke script checks the proxy, the SPA, the runtime origin binding, super
admin login, and that `/api/admin/tenants` is _rejected_ without a token. Exit
code is the failure count. `--create-tenant` additionally exercises the write
path.

**First boot** bootstraps the schema from `electron-app/create_db.sql`, then runs
every migration, then creates the super admin if `SUPER_ADMIN_*` are set. Later
boots run only pending migrations, so an existing volume upgrades in place.

## 4. Once you have a domain

Point an A record at the VPS, then put a TLS terminator in front. Change the
`web` service's published port to `127.0.0.1:8080:80` in `docker-compose.yml`
so only the terminator is exposed, and run Caddy on the host:

```caddyfile
liratek.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy fetches and renews the certificate automatically. Also update
`CORS_ORIGIN` to `https://liratek.example.com` and restart the backend.

**HTTPS is not cosmetic here.** Voice input calls `getUserMedia`, which browsers
refuse outside a secure context, and JWTs live in `localStorage` — on plain HTTP
they cross the network in cleartext. IP-only HTTP is fine for a private box you
are the only one hitting; it is not fine for a tester in the field.

For per-tenant subdomains later, the intended shape is Caddy **on-demand TLS**
with an `ask` endpoint that validates the requested hostname's slug against the
`tenants` table — a cert per subdomain, issued on first visit, no wildcard
certificate and no DNS-01 plugin. The `ask` endpoint is part of § Not done yet.
Until then, list hostnames explicitly in the Caddyfile.

## 5. Operations

```bash
docker compose logs -f backend            # app logs (pino, JSON)
docker compose ps                         # health status
docker compose up -d --build              # deploy a new version
docker compose down                       # stop (the volume survives)
```

Migrations run automatically on every backend start, so a deploy is just
rebuild + restart. There is no automated rollback: a migration that has run
cannot be undone by restarting the previous image. Back up before upgrading.

**Backup.** The volume is the only copy of the shop's data, and the desktop app's
backup/restore is Electron-only (`ReportService` imports `electron` directly), so
there is no server-side equivalent. Take a consistent copy with SQLite's own
backup API — safe against a live WAL database, unlike `cp`:

```bash
docker compose exec -T backend node -e "
  const D = require('better-sqlite3');
  const db = new D('/data/liratek.db', { readonly: true });
  db.backup('/data/backup-' + new Date().toISOString().slice(0,10) + '.db')
    .then(() => { console.log('ok'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
"
docker compose cp backend:/data/backup-$(date +%F).db ./
```

Put that on a daily cron and copy the result off the box. Untested as written —
run it once by hand before trusting it.

## 6. At-rest data — read this before believing the docs

`DATABASE_KEY` **does not encrypt anything today.** `CLAUDE.md` and older plan
docs describe the database as "SQLCipher-encrypted"; it is not, in either
transport.

Verified by direct probe on this repo's driver: stock `better-sqlite3` ships no
SQLCipher codec, so `PRAGMA key` is silently accepted and ignored, the file
header stays `SQLite format 3`, and a canary string inserted after setting the
key is readable in the raw bytes. Worse, `applySqlCipherKey()`
(`packages/core/src/db/sqlcipher.ts`) reports `applied: true` in exactly this
case, so nothing warns you.

`validateProductionEnv()` still requires the variable under `NODE_ENV=production`,
so set it — but protect the data by other means: host full-disk encryption,
restrictive filesystem permissions, and encrypted off-box backups. Real
at-rest encryption requires building a SQLCipher-enabled `better-sqlite3` for
both the container and Electron, which is its own project.

## 7. Verification status

Written and reviewed, **not yet executed** — there is no Docker daemon on the
authoring machine. Nothing here has been proven by a real build:

- neither image has been built
- the stack has never started
- `scripts/deploy-smoke.sh` has never run against a live deployment (syntax
  checked with `bash -n` only)

Treat the first `docker compose up -d --build` as the real test. The things most
likely to need a fix on that first run: the exact `COPY` set in
`backend/Dockerfile` (workspace resolution is fussy), and the `sed` that injects
`runtime-config.js` into the built `index.html` (guarded by a `grep -q`
assertion in the same layer, so it fails the build rather than shipping broken).

## 8. Not done yet

- **Subdomain-scoped login — BUILT, switched off until a domain exists.**
  Set `APP_BASE_DOMAIN` (e.g. `liratek.app`) and the backend resolves the
  tenant from the request Host: `<slug>.liratek.app` is that tenant's realm,
  the apex (and `admin.`/`www.`) is the platform realm for super admins.
  Login then refuses credentials belonging to another tenant, refuses
  unknown subdomains, and refuses a suspended or archived tenant — with the
  same generic error as a bad password, so subdomains cannot be probed.
  Unset, it is a no-op, which is why the current `vercel.app`/IP deployment
  is unaffected. `TENANT_HOST_HEADER_OVERRIDE=true` swaps Host for an
  `X-Tenant-Slug` header for local testing; never enable it in production.
  Still open: per-tenant TLS (Caddy on-demand TLS with an `ask` endpoint,
  see § 4) and per-tenant usernames — usernames remain globally unique, so
  two shops cannot both have an `admin`.
- **No audit trail on the web transport.** Only the Electron IPC handlers call
  `audit(...)`; REST action routes don't. The audit _viewer_ reads over REST, so
  the gap is invisible in the UI (`WEB_PARITY_ROADMAP.md` § 9).
- **Web-transport test coverage is thin.** 16 web e2e specs plus 7 of the 83
  desktop specs running over HTTP. Roadmap phases 3 and 4 remain open.
- **Printing and offline are desktop-only** — browsers cannot print silently to
  a named thermal printer, and the web app is dead when the connection drops.
  The counter keeps Electron; the web app is the remote/owner view.

## Temporary scaffolding — what to delete when the backend gets a real host

Right now the Express backend runs on a developer PC and is exposed through a
free Cloudflare quick tunnel, with Vercel serving the SPA and proxying `/api`
to that tunnel. Some of the tooling for that is throwaway; most of today s work
is not. Keeping the two straight matters, because the throwaway half looks
load-bearing until you know why it exists.

### Delete

| Thing                                                               | Why it goes                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/web-tunnel.mjs`                                            | Its entire job is coping with a hostname that changes on every restart. A hosted backend has a fixed hostname.                                                                                                   |
| `scripts/install-cloudflared.mjs`                                   | Nothing needs `cloudflared` once the backend is not behind a tunnel.                                                                                                                                             |
| `scripts/refresh-web-db.mjs`                                        | Copies one local SQLite file to another. A real deployment has ONE server database, so there is nothing to copy. (The idea may return as a proper staging-seed tool — that would be a new script, not this one.) |
| `yarn web:tunnel`, `web:tunnel:install`, `web:up`, `web:db:refresh` | The scripts above, plus `web:up` which only exists to start backend+tunnel+deploy together.                                                                                                                      |
| `.tools/` and its `.gitignore` entry                                | Only ever held the `cloudflared` binary.                                                                                                                                                                         |
| The `trycloudflare.com` rewrites in `vercel.json`                   | Replace the four proxied rewrites destinations with the real backend origin. Keep the rewrites themselves — they are what gives the browser a single origin.                                                     |
| `backend/.env` (local, gitignored)                                  | A convenience for running the backend by hand. A host supplies env vars itself.                                                                                                                                  |

### Keep — these are host-independent and were real fixes

| Thing                                                                                             | Why it stays                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.yarnrc.yml` `yarnPath` + `.yarn/releases/yarn-4.12.0.cjs`                                       | Pins Yarn 4 for any host or CI without corepack. Yarn 1 cannot resolve the `workspace:*` protocol, so without this an install fetches `@liratek/core` from the registry and fails.      |
| `backend/package.json` build = `yarn workspace @liratek/core build && tsc`                        | `@liratek/core`s `dist/` is not committed, so building the backend alone produced a bundle importing a package that did not exist.                                                      |
| `httpClient.ts` same-origin API base                                                              | Lets ONE frontend build work on any hostname — preview URLs, a production domain, per-tenant subdomains — with no rebaked URL. Required by any single-origin deployment, tunnel or not. |
| `socket.ts` reusing `getBaseUrl()`                                                                | One resolver instead of a hardcoded `localhost:3000`.                                                                                                                                   |
| `app.set("trust proxy", 1)` in `server.ts`                                                        | Needed behind ANY reverse proxy, or the per-IP rate limiter collapses into one shared bucket.                                                                                           |
| Root `package-lock.json` deleted + gitignored                                                     | It was stale by twelve minor versions and made package-manager detection ambiguous; Vercel picked npm from it and npm cannot resolve `workspace:*`.                                     |
| `.gitattributes` LF pinning                                                                       | Shell scripts and Dockerfiles must not get CRLF, or they fail on Linux.                                                                                                                 |
| `yarn web:build`, `web:backend`, `web:deploy`                                                     | Building core+backend and starting `node dist/server.js` are what ANY host does. `web:deploy` stays as long as the frontend is on Vercel.                                               |
| `Dockerfile`, `backend/Dockerfile`, `docker-compose.yml`, `nginx.conf`, `scripts/deploy-smoke.sh` | The self-hosted path. Still valid the day you want one box running both halves.                                                                                                         |

### The one-line summary

The tunnel scripts are a workaround for _where the backend runs_. Everything
else fixed how the app _builds and finds its API_, which every deployment needs.

## 9. Related

| What                                | Where                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| Dual-transport architecture & rules | `CLAUDE.md`                                                 |
| Web-parity status per module        | `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`               |
| Multi-tenant decisions              | `docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md` |
| Money-path invariants               | `docs/FEATURE_GUIDE.md`                                     |
