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

## 4b. Decisions on record

**Quick tunnel now, named tunnel later (decided 2026-09-08).**

The domain `liratek.shop` exists and serves the SPA at `www.liratek.shop`
through Vercel, but its nameservers are Spaceship's
(`launch1/launch2.spaceship.net`), not Cloudflare's. A **named** Cloudflare
tunnel — the thing that would give a stable `api.liratek.shop` and end the
`vercel.json` edit-and-redeploy on every tunnel restart — requires Cloudflare
to be the DNS authority for the zone: `cloudflared tunnel route dns` creates a
CNAME inside a Cloudflare-hosted zone, and a tunnel's own
`<uuid>.cfargotunnel.com` address resolves only through Cloudflare's
resolvers, so it cannot be CNAMEd to from an external DNS provider either.
(The partial/CNAME-only setup that avoids delegation is a Business-plan
feature.)

Moving the nameservers was deliberately **deferred**: the prize is a stable
hostname, and a stable hostname matters most once there is a stable server
behind it — which is the hosting question, still open. Meanwhile
`yarn web:up` automates the whole restart-and-redeploy cycle, so the churn
costs one command.

Revisit when the backend moves off a developer PC. The steps then:

1. Add `liratek.shop` to a free Cloudflare account; let it import the records.
2. Verify the imported Vercel records (`www` CNAME, apex A) and set them to
   **DNS only** (grey cloud) — proxying would put Cloudflare in front of
   Vercel in front of the tunnel.
3. Switch the nameservers at Spaceship.
4. `cloudflared tunnel login`, create the tunnel, `tunnel route dns` it to
   `api.liratek.shop`, and point `vercel.json`'s proxied rewrites at that
   hostname instead of a `trycloudflare.com` one.

**Note what this does NOT fix:** WebSockets. Traffic would still be
browser → Vercel → tunnel, and Vercel does not forward the `Upgrade`
handshake to an external origin (verified: HTTP and socket.io long-polling
return 200, an upgrade request returns 400). Real WebSockets need the frontend
pointed at `api.liratek.shop` **directly**, which reintroduces a second origin
and therefore real `CORS_ORIGIN` configuration. Long-polling is still push, so
there is no functional gap today.

## 4c. Named tunnel — the runbook (code side is ready)

`scripts/web-tunnel.mjs` now takes `TUNNEL_NAME`. Set it and the script runs a
NAMED tunnel and **stops touching `vercel.json` and stops redeploying** — both
of those exist only to chase a hostname that changes. Unset, nothing changes.

```bash
TUNNEL_NAME=liratek-web yarn web:up      # named: stable hostname, no redeploy
yarn web:up                              # quick: today's behaviour
```

Everything below the flag is a ONE-TIME setup, and step 1 is the gate — see
4b for why a named tunnel is impossible without it.

1. **Move the zone to Cloudflare** (owner action, at Spaceship). Add
   `liratek.shop` to a free Cloudflare account, let it import, then set the
   Vercel records (`www` CNAME, apex A) to **DNS only / grey cloud** before
   switching nameservers — proxying them puts Cloudflare in front of Vercel in
   front of the tunnel, which breaks Vercel's own certificate.
2. `cloudflared tunnel login` — browser flow, picks the zone, writes a cert to
   `~/.cloudflared/`.
3. `cloudflared tunnel create liratek-web` — writes a credentials JSON. **Do
   not commit it**; it is a bearer credential for the tunnel.
4. `cloudflared tunnel route dns liratek-web api.liratek.shop` — creates the
   CNAME to `<tunnel-id>.cfargotunnel.com`.
5. Point `vercel.json`'s four proxied rewrites at `https://api.liratek.shop`
   and commit that **once**. It never changes again, which is the entire point.
6. From then on: `TUNNEL_NAME=liratek-web yarn web:up`.

**VERIFIED 2026-09-08.** The zone moved to Cloudflare and the whole path was
exercised end to end: tunnel `liratek-web`
(`722b2841-15e8-410f-9031-70927d4cacdf`), `api.liratek.shop` CNAME created by
`tunnel route dns`, and `TUNNEL_NAME=liratek-web yarn web:tunnel` came up with
4 registered QUIC edge connections. The inline-ingress form
`cloudflared tunnel --url http://127.0.0.1:PORT --edge-ip-version 4
--no-autoupdate run <name>` **is accepted** by cloudflared 2026.8.3 — no
`config.yml` needed (it logs "Cannot determine default configuration path" and
proceeds, which is expected, not an error).

Credentials live at `~/.cloudflared/<tunnel-id>.json` plus `cert.pem`. **Neither
belongs in git** — the JSON is a bearer credential for the tunnel; revoking it
means deleting the tunnel.

One ordering note worth keeping: `api.liratek.shop` is NXDOMAIN until the
nameserver delegation actually propagates, so keep the OLD quick tunnel running
and switch `vercel.json` only after `https://api.liratek.shop/health` answers.
Switching first just takes `/api` down for the length of the TTL.

Do NOT re-enable DNSSEC at the registrar during the move. Disabling zone signing
while the registry still publishes the DS leaves every validating resolver
(1.1.1.1, 8.8.8.8) returning SERVFAIL — the domain disappears until the registry
drops the DS. That happened here; it cleared on its own once the `.shop`
registry processed the removal, and the tell is
`EDE(9): DNSKEY Missing no SEP matching the DS`.

### The same DNS move unlocks per-tenant subdomains

`APP_BASE_DOMAIN` is implemented and inert (§ 8). Turning it on needs a
wildcard `*.liratek.shop` and a certificate for it, which is the same
nameserver move — so do them together rather than paying the migration twice:

- **DNS**: a wildcard record for `*.liratek.shop`.
- **Vercel**: add `*.liratek.shop` as a domain on the project, so
  `<slug>.liratek.shop` serves the same SPA. Vercel issues the wildcard
  certificate itself once it is the DNS target — which is a real reason to keep
  Vercel in front rather than moving to the Caddy on-demand shape in § 4.
- **Backend**: set `APP_BASE_DOMAIN=liratek.shop`. Login then resolves the
  tenant from the Host, and an unknown subdomain is refused with the same
  generic error as a bad password.
- **Never** set `TENANT_HOST_HEADER_OVERRIDE` here — it lets any client claim
  any tenant via a header.

Until this lands, self-service signup is only half usable: a second shop can be
created but shares `www.liratek.shop` with everyone, and the no-realm username
inference (§ 8) deliberately resolves a contested username to the FIRST tenant
— so the newcomer cannot log in at all.

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

## 5b. Self-service signup (`/signup`)

The web app has a public sign-up page at `/#/signup` that creates a whole
tenant — registry row, seeded config, first admin — through the SAME
`provisionTenant()` a super admin uses. It is **off unless you turn it on**:

```bash
# In backend/.env — any non-empty string. Unset or removed = signup disabled.
SIGNUP_INVITE_CODE=liratek-something-only-you-know
```

Unset is deliberately the safe default. An open tenant-creation endpoint on a
POS platform collects junk tenants, and every signup permanently consumes a
globally-unique slug, so forgetting to configure something must not be what
exposes it. With no code set the route answers 403 for everyone; with one set,
a caller must send it in the request body.

Three other things guard it:

- `signupLimiter` — 5 requests per IP per hour, and unlike the login limiter it
  counts **successes** too, since a success is what consumes a slug. That also
  means a mistyped invite code burns a slot, so `SIGNUP_RATE_LIMIT_MAX`
  overrides the 5 (this dev deployment sets 30).
- The slug charset and the reserved-name blocklist are the same ones that guard
  staff-created tenants — `signupSchema` extends `createTenantSchema` rather
  than restating the rules, so `admin`, `www`, `api` and friends cannot be
  claimed.
- **No token is issued on success.** The response carries only the new
  `{ id, name, slug }`, and the page sends the user to `/login`. Once
  `APP_BASE_DOMAIN` is set (§ 8), that shop's credentials work only on
  `<slug>.<domain>`, so minting a token for a realm the browser is not on
  would contradict the whole model.

To close signups again, remove `SIGNUP_INVITE_CODE` and restart the backend.
To rotate, change it — existing tenants are unaffected, only new signups.

The login page asks `GET /api/auth/signup-status` (public, returns one boolean)
and only shows "Create your shop" when signup is actually on, so flipping the
variable is the whole switch — there is no second place to update, and the login
page never advertises a door that is bolted.

Desktop is untouched: Electron provisions its single tenant through the
first-run setup wizard, and the login page hides the "Create your shop" link
outside the browser.

## 5c. Automatic tenant subdomains

When a tenant is provisioned — by self-service signup or by you in the admin
panel — it gets `<slug>.liratek.shop` with nobody touching a dashboard.

```bash
# backend/.env — the feature is OFF unless ALL of these are set
CLOUDFLARE_API_TOKEN=...   # scoped token: Zone > DNS > Edit, on this zone only
CLOUDFLARE_ZONE_ID=...     # Cloudflare > liratek.shop > Overview, right column
VERCEL_TOKEN=...           # vercel.com/account/tokens
VERCEL_PROJECT_ID=...      # Vercel > project > Settings > General
# VERCEL_TEAM_ID=...       # ONLY if the project belongs to a team
# VERCEL_DNS_TARGET=...    # defaults to cname.vercel-dns.com
```

**Why two calls and not one.** Vercel routes by `Host`: a DNS record without
the hostname registered on the project is a 404, and the registration without
DNS never resolves. Doing only one is worse than doing neither, because it
looks configured. So provisioning creates the Cloudflare CNAME **and** adds
the domain to the Vercel project.

**The CNAME is DNS-only (grey), deliberately.** A proxied record puts
Cloudflare in front of Vercel, which terminates TLS with its own certificate
— the usual result is a redirect loop, and Vercel then sees Cloudflare's IPs
instead of real visitors. `api.liratek.shop` is the one record that MUST stay
proxied, because a tunnel hostname only resolves through the proxy.

**It fails soft, always.** Unconfigured, bad token, rate limit, network down,
garbage response — every path logs and returns, and none of them can throw
into the caller. A subdomain is a convenience; a signup is revenue, and
losing a registration to a DNS hiccup would be absurd. It is also not
awaited: two third-party calls would otherwise add seconds to a form submit,
and the tenant already works on the shared host without them.

**It is idempotent.** "Record already exists" (Cloudflare 81057) and
"domain already in use by this project" (Vercel) both count as success, so
re-running is safe and a retry needs no extra bookkeeping.

A Vercel failure deliberately LEAVES the DNS record behind: harmless on its
own, it makes the retry a no-op, and deleting it could remove a record
somebody created by hand.

**Not done:** nothing retries automatically, and no UI reports that a
subdomain failed — check the backend log for `tenant subdomain`. Custom
customer-owned domains (`pos.theirshop.com`) are a separate problem; the
productised answers are Cloudflare for SaaS or Vercel's Domains API.

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

- **Subdomain-scoped login — LIVE since 2026-09-08.** `APP_BASE_DOMAIN=liratek.shop`
  is set, so the backend resolves the tenant from the request Host. Verified
  against the real deployment, not just unit tests — the matrix below was run
  both locally (varying the `Host` header against 127.0.0.1) and end to end
  through Vercel:

  | Host                       | credentials                    | result                                      |
  | -------------------------- | ------------------------------ | ------------------------------------------- |
  | `<slug>.liratek.shop`      | that tenant's admin            | **accepted**, token issued                  |
  | `<slug>.liratek.shop`      | wrong password                 | refused                                     |
  | another tenant's subdomain | tenant A's admin               | refused                                     |
  | `nosuchshop.liratek.shop`  | anything                       | refused                                     |
  | `www.liratek.shop`         | a non-incumbent tenant's admin | refused                                     |
  | `liratek.shop` (apex)      | —                              | **308 → www before it reaches the backend** |

  The refusals all use the same generic error as a bad password, so subdomains
  cannot be probed.

  **The non-obvious part, and the thing most likely to break this later: the
  original Host survives Vercel's rewrite to the tunnel.** `/api/*` is
  rewritten to `api.liratek.shop`, so a naive reading says the backend sees
  Host `api.liratek.shop` — which resolves to label `api`, no such tenant,
  and would refuse EVERY web login. It works because Vercel sends
  `X-Forwarded-Host` with the original hostname and Express honours it via
  `req.hostname` under `trust proxy` (set in `server.ts`). If `trust proxy`
  is ever removed, or a future proxy drops that header, every tenant login
  breaks at once with a generic "invalid username or password" — a symptom
  that points nowhere near the cause. Proven by a real login on
  `signup-probe.liratek.shop` returning a token through Vercel.

  Onboarding a tenant is two clicks and no deploy: a `CNAME <slug>` →
  `13746778f9200660.vercel-dns-017.com` in Cloudflare (**DNS only**, grey —
  Vercel must terminate TLS), then add `<slug>.liratek.shop` to the Vercel
  project. Vercel issues the certificate itself, and `vercel.json`'s rewrites
  are project-wide, so the new subdomain proxies `/api` to the tunnel with no
  extra config.

  `www` is deliberately INERT (behaves as if no base domain), which is what
  keeps the existing login working; see `tenantHost.ts` for why treating it as
  either a tenant or the platform would lock users out.
  `TENANT_HOST_HEADER_OVERRIDE=true` swaps Host for an `X-Tenant-Slug` header
  for local testing; never enable it in production.

  Still open: a WILDCARD `*.liratek.shop` so onboarding needs no clicks at all.
  Not done because Vercel's wildcard certificates want Vercel's own
  nameservers, which would rule out the Cloudflare named tunnel — and
  per-tenant domains added one at a time work today. Revisit when the click
  gets tedious.

- **Per-tenant usernames — DONE** (migration v172, 2026-09-08). Usernames used
  to be globally unique, so only one shop on the whole platform could have an
  `admin`. They are now unique per tenant: `users.username` lost its table-wide
  UNIQUE and gained `idx_users_tenant_username` (tenant-scoped) plus a partial
  `idx_users_platform_username` covering the platform realm, where super admins
  live and global uniqueness is still correct. Login resolves the realm from the
  Host first and looks the user up inside it. With `APP_BASE_DOMAIN` unset there
  is no realm, so login infers one: an unambiguous username resolves directly,
  and a name owned by two realms resolves to the platform realm (super admins)
  and then to the deployment's FIRST tenant — the incumbent shop. Nothing leaks,
  because the password is still checked against whichever row comes back; the
  consequence is that a later self-signed-up tenant that picks an already-taken
  username cannot log in on the shared hostname at all. Set `APP_BASE_DOMAIN`
  (and wildcard DNS) before onboarding a second tenant and the question does not
  arise. **Do not "simplify" this back to refusing an ambiguous username** — it
  reads safer and is not: signup is public, so anyone with the invite code could
  register a shop whose admin is named `admin` and lock the incumbent out of
  their own login.
- ~~**No audit trail on the web transport.**~~ **This was wrong** — corrected
  2026-09-08. REST routes audit through `auditRest(...)`, not `audit(...)`, and
  there are ~117 call sites; a grep for the IPC helper's name found none of them
  and the gap was written up from that. Two route files genuinely had no audit
  call and have since been fixed. What remains is narrow: a few
  `servicePresets` PUT/DELETE routes (`WEB_PARITY_ROADMAP.md` § 9).
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
