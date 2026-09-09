# LiraTek ops dashboard (local only)

A one-page read-only view of prod: `yarn ops`, open http://127.0.0.1:4500.
No build step, no dependencies, nothing here can change anything (GET only,
and non-GET is rejected with 405).

## Panels

| Panel | Shows | Source |
| --- | --- | --- |
| **Fly / machine** | Machine count (red if ≠ 1 — SQLite has one writer, two machines on the volume is corruption, not capacity), state, region, image tag, health checks, recent deploy events, last 10 releases, volumes + snapshots | local `flyctl status/releases/volumes` |
| **Tenants** | Every tenant, subscription plan/status, and a DNS/Vercel drift block (orphan CNAME, missing CNAME, orphan Vercel domain) | super-admin login + `/api/admin/tenants` + `/api/admin/subscriptions`, reconciled against the Cloudflare/Vercel panels |
| **Vercel deployments** | Last 10 deployments (state, branch, commit, author) and registered domains | Vercel REST API |
| **Cloudflare DNS** | Zone status, all DNS records, which are tenant CNAMEs (amber if one points at Vercel with the orange cloud on — that causes a redirect loop) | Cloudflare REST API |
| **Backups & Litestream** | R2 bucket identity, Fly volume snapshots, and litestream's last-seen state from the logs | Fly volumes + (optionally) R2, see below |
| **Backend health** | `/health` + `/health/detailed` — database and reachability drive the light; the memory check is informational only (see note below) | `https://www.liratek.shop/health*` |
| **Recent logs** | Parsed `flyctl logs --no-tail`, newest first, 4xx amber / 5xx red | local `flyctl logs` |

Everything is fetched in parallel and each card fails independently — one
broken source never blanks the page.

The Tenants panel's DNS/Vercel drift block is read-only, by design (rule 8) —
to actually remove an orphaned subdomain it finds, run
`yarn ops:prune` (`scripts/prune-orphan-domains.mjs`), which computes the same
drift and dry-runs by default.

## Running it

```bash
yarn ops
```

Requires `flyctl` (see `scripts/fly.mjs` if it's not resolving) for the Fly
and log panels, and `backend/.env` for everything that talks to Vercel,
Cloudflare, or the live backend's super-admin API. Missing `backend/.env`
doesn't crash the server — those sections just report
`ok:false, error:"backend/.env not found"` and the page still loads.

## Localhost-only guarantee

The server binds `127.0.0.1:4500` (not `0.0.0.0`), so nothing outside this
machine can reach it at the network layer. On top of that, every request's
`Host` header is checked against `127.0.0.1:4500` / `localhost:4500` and
anything else gets a 403 — a cheap guard against DNS rebinding (a malicious
page tricking your browser into treating this dashboard as if it were the
page's own origin). No route accepts anything but `GET`. No secret value
(tokens, passwords, JWTs, `license_key`) is ever sent to the browser — only
booleans and names.

## The R2 gap

The **Backups** panel can't yet show real R2 bucket contents. Reason:
`CLOUDFLARE_API_TOKEN` in `backend/.env` is scoped to zone/DNS only (it's
used for tenant subdomain provisioning), and the R2 API rejects it outright —
R2 needs its own token scope. To light this panel up:

1. In the Cloudflare dashboard, create a new API token scoped to
   **Account → R2 → Read** (or Read/Write if you also want it for anything
   beyond listing) for the account that owns the `liratek-backups` bucket.
2. Add to `backend/.env`:
   ```
   R2_API_TOKEN=<the new token>
   R2_ACCOUNT_ID=<the Cloudflare account id>
   ```
3. Restart `yarn ops`. The server checks for both vars and, if present, calls
   `GET /client/v4/accounts/$R2_ACCOUNT_ID/r2/buckets` with the new token.
   Any failure there degrades back to the "unavailable" shape — it never
   throws and never takes down the rest of the Backups card.

Until then, the panel still shows what's knowable without R2 credentials:
the bucket name/prefix/sync interval (static config), the Fly volume
snapshots, and litestream's state as read from the logs.

## Why `www.liratek.shop`, not `api.liratek.shop`, for super-admin login

The Tenants panel logs in as the super admin to read `/api/admin/tenants`
and `/api/admin/subscriptions`. That login **must** go through
`https://www.liratek.shop`, never `https://api.liratek.shop` directly.
Vercel's rewrite is what sets `X-Forwarded-Host` to the platform realm
(`www.`/`admin.`) before the request reaches the backend. Hit
`api.liratek.shop` directly and the backend's tenant-resolution middleware
reads the literal `Host` header, treats the label `api` as a **tenant
slug**, finds no such tenant, and refuses the login with a generic "Invalid
credentials" — which looks exactly like a wrong password and is not. This
has already cost someone real time elsewhere in this repo (see
`docs/DEPLOYMENT.md` §8 and `scripts/deploy-api.mjs`'s own realm check).

The dashboard also caches the resulting JWT in memory and only re-logs-in on
a 401 or when it holds no token — there's a rate limiter in front of
`/api/auth/login`, and a dashboard that logged in on every 30s poll would
eventually lock the owner out of their own admin account.
