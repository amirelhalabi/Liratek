# Web-Deployable + Multi-Tenant Platform — Options Plan

**Document Created:** 2026-07-08
**Status:** 🟡 EXPLORATORY — no architectural decisions have been made yet
**Priority:** Strategic / not yet scheduled

---

## Purpose of this document

This is a **planning and options** document, not an implementation plan. It captures the discussion on turning LiraTek from a single-tenant Electron desktop app into (1) something deployable as a website and (2) a multi-tenant SaaS platform at `liratek.com`, with subdomains per client and an admin panel.

**Nothing in here is a final decision.** Every fork below is intentionally left open, with the tradeoffs that were discussed. When we're ready to commit to an approach, that should happen as its own explicit step — not be inferred from this doc.

---

## Current architecture (for reference)

Today, exactly one path is live in production:

```
Renderer (frontend/src, React 19)
   │  window.api.* only — no fetch, no direct DB access
   ▼
contextBridge / preload.ts   ← hard Electron process boundary
   ▼
Main Process (electron-app/) — ipcMain handlers, requireRole(), Zod validation
   ▼
Shared Core (packages/core/src) — services/ (business rules) + repositories/ (parameterized SQL)
   ▼
SQLite — phone_shop.db, SQLCipher-encrypted, one file, one writer, one machine
```

A second path already exists in the repo but is **not connected to anything**:

```
backend/  — Express + Socket.io, ~30 REST routes under /api/*
          — imports the same @liratek/core services/repositories
          — no client anywhere in frontend/src calls it (zero fetch/axios usage)
```

Note: `docs/archive/BACKEND_DIFFERENCES.md` describes an older duplication problem (separate `electron-app/services` and `backend/src/services` implementations). That consolidation already happened — both are now thin and delegate to `packages/core`. The remaining gap between the two paths is about **auth model and payload shape** (Electron sessions vs JWT, camelCase vs snake_case), not duplicated business logic.

---

## Part 1 — Making the app genuinely web-deployable

**Goal:** the same product runs as a browser-hosted web app, not just inside Electron.

### The open fork

**Option A — Unify on the backend.**
Electron stops calling `packages/core` directly via IPC. It instead spawns/embeds the `backend/` Express server locally, and the Electron renderer becomes a browser view pointed at `http://localhost:<port>` — the same server a real browser client would hit. IPC survives only for OS-specific things: native print dialogs, file export/import, the auto-updater.

- ✅ One auth model, one payload shape, one place money logic lives — permanently closes the parity gap instead of paying an ongoing tax for it.
- ✅ Matches the project's existing philosophy of "one invariant, defined once" (see CLAUDE.md rules 13/14/16).
- ❌ Bigger upfront lift: need to run/manage a local server process from within Electron, retire the data-carrying IPC handlers, rework auth.

**Option B — Two thin clients, one shared core.**
Leave Electron's current direct-IPC path untouched. Add a web/HTTP adapter to the frontend that calls the existing `backend/` REST API for a browser client. Both paths already share `packages/core` for logic.

- ✅ Smaller, faster to ship — no change to how Electron currently works.
- ❌ Two live entry points forever: two auth models (Electron session vs JWT), two payload conventions (camelCase vs snake_case), and every future money-moving feature needs to be verified against both.

**OPEN QUESTION:** Which option, or a hybrid (e.g. start with B to ship something, migrate to A later)?

### Steps common to either option

1. **Frontend abstraction layer** — replace the ~71 files' direct `window.api.X.Y()` calls with a single `api.X.Y()` client behind an adapter interface. `frontend/src/config/env.ts` already has an unused `appMode: "standalone" | "electron"` flag — this is what it was seemingly meant for.
2. **Normalize payload casing** — pick one convention (likely camelCase, matching current frontend) across every REST route so the same TypeScript types serve both adapters.
3. **Audit money-critical parity before any cutover** — walk every payment-leg/drawer/ledger path (debts, sales, financial services, recharge) against `docs/FEATURE_GUIDE.md` §13. This is the highest-cost place for an IPC-vs-REST divergence to hide.
4. **Extend E2E coverage** to exercise the same money flows over HTTP that the Playwright suite currently drives through Electron IPC.

### Steps specific to Option A (if chosen)

5. Run the backend inside Electron's main process on launch, pointed at the same SQLite file.
6. Retire `electron-app/handlers/*.ts` for data (sales/debts/inventory/etc.) once the renderer goes through HTTP — keep IPC only for native dialogs, file export, updater.
7. Unify auth on JWT (or another single model) for both Electron's login and a browser's.

### Steps specific to Option B (if chosen)

5. Re-audit `backend/`'s existing REST routes against current `electron-app` behavior, route by route (request/response shape, not business logic — that part is already shared).
6. Decide how the frontend picks an adapter at runtime/build time (env var, subdomain, build target).

### Open questions — Part 1

- [ ] Option A vs B vs hybrid?
- [ ] Is the Electron desktop app staying long-term (e.g. for offline use at a shop with unreliable internet), or is it eventually retired once the web version exists?
- [ ] Timeline: does this need to land before or alongside the multi-tenant work in Part 2?

---

## Part 2 — Multi-tenant SaaS platform

**Goal:** `liratek.com` hosts the product; `admin.liratek.com` is a LiraTek-only panel to manage subscribed businesses; each business gets `clientname.liratek.com`.

This assumes Part 1 has produced a real web-facing backend to multiply across tenants — the two are sequential in practice even if not formally "blocking."

### Shape of it

Two planes, not one app:

- **Control plane** (`admin.liratek.com`) — LiraTek's own bookkeeping: which businesses are subscribed, their subdomain, plan, status. Only LiraTek staff use this.
- **Data plane** (`clientname.liratek.com`) — the actual POS, one instance of behavior per client, each seeing only their own data.

A reverse proxy (Caddy or Cloudflare) sits in front with a wildcard TLS cert for `*.liratek.com`, forwards the `Host` header, and middleware resolves which tenant (or the control plane) a request belongs to.

⚠️ **Naming collision to watch for:** the schema already has a `clients` table meaning "the shop's own customers" (people with debt ledgers, phone numbers). That is a different concept from "which business is paying LiraTek a subscription." The new SaaS concept needs its own name — e.g. `tenants`, `accounts`, or `subscribers` — to avoid confusing the two.

### The DB fork — leaning direction, not decided

**Database-per-tenant (leaning this way, not finalized)** — every client gets their own SQLite file, same as today's desktop install pattern.

- ✅ Reuses ~100% of existing repository/service code unchanged — no query in `packages/core/src/repositories/*` needs a `tenant_id` filter, because the tenant boundary *is* the file.
- ✅ Isolation is airtight by construction — a missed `WHERE` clause can't leak client A's data into client B's session, because there's no shared table to forget it on.
- ✅ Backup, export, and "delete this client's data" are trivial (one file).
- ❌ At real scale (hundreds+ tenants) eventually needs a story for sharding tenant files across servers.
- ❌ Needs `packages/core/src/db/connection.ts` to change from a single global singleton to a tenant-aware connection cache (keyed by tenant, LRU-evicted) — the one real structural change this path requires.

**Shared database, `tenant_id` on every table (classic multi-tenant pattern)** — one Postgres DB, every table gets a `tenant_id` column, every query filters by it.

- ✅ Single DB to operate; easy cross-tenant admin/analytics queries.
- ❌ Touches every repository in `packages/core/src/repositories/` — dozens of files — and introduces the single scariest failure mode for a money app: a query that forgets `WHERE tenant_id = ?` and leaks one client's financial data into another's view.
- ❌ Means migrating off `better-sqlite3` to Postgres or similar, since SQLite isn't built for many tenants' concurrent write traffic in one file.

**OPEN QUESTION:** Confirm database-per-tenant as the direction, or keep shared-DB on the table for later (e.g. if cross-tenant analytics becomes a product requirement)?

### Tooling landscape for DB-per-tenant hosting (checked 2026-07-08, none selected)

| Option | Fit | Cost to adopt |
|---|---|---|
| **Self-host + Litestream** | Keep `better-sqlite3` exactly as-is; one file per tenant on disk; Litestream continuously backs up each file's WAL to S3/R2 | Free, open source, **zero code change** — purely additive backup/DR |
| **Fly.io + LiteFS** | LiteFS mounts as a normal file path, so `better-sqlite3` keeps working synchronously, unchanged | Free/cheap infra cost. Caveat: beta status, Fly deprioritized it (their managed backup service was sunset Oct 2024), FUSE caps write throughput ~100 tx/sec (fine for a POS, not for high-frequency workloads) |
| **Turso (libSQL)** | Purpose-built for "database per tenant" SaaS. Free tier: 100 databases/5GB. $4.99/mo: unlimited databases | Requires swapping `better-sqlite3` for `@libsql/client`, which is **async** — cascades into rewriting every repository/service method and everything that calls them. Real migration cost, not a drop-in |
| **Cloudflare D1** | Scales to thousands of DBs cheaply (free: 10 DBs; paid: 50,000+) | Only runs inside Cloudflare Workers — a different runtime than Node/Express entirely. Means leaving `backend/` as an Express server behind, not just swapping a driver |

**Recommendation discussed (not decided):** stay on `better-sqlite3` + self-hosted/Fly.io + Litestream to avoid an async rewrite, and revisit Turso only if/when disk-per-server stops scaling.

### Near-seamless pieces (low-risk, likely fine to just pick)

- **Wildcard subdomains + TLS:** Caddy (automatic HTTPS via DNS-01) or Cloudflare (CDN/proxy product) — either handles this with minimal config, no custom code.
- **Subscription billing:** Stripe Billing (or Paddle/Lemon Squeezy) for charging clients monthly, handling upgrades/cancellations/failed payments via webhooks into the control-plane DB. Not worth building in-house.

### New components this requires (regardless of DB fork outcome)

1. **Control-plane schema** — tenant list, subdomain, plan/status, path to their DB file (or connection info).
2. **Tenant resolution middleware** — `Host` header → subdomain → control-plane lookup → attach the right DB connection to the request.
3. **Provisioning flow** — new subscriber signs up → row in control plane → new SQLite file created → existing migrations/`create_db.sql` run against it → seed an admin user. Reuses the existing "fresh install" bootstrap.
4. **Tenant-scoped auth** — JWTs encode which tenant they were issued for; middleware rejects a token replayed against a different subdomain than it was issued for.
5. **Admin panel** (`admin.liratek.com`) — its own small app: list/create/suspend clients, view subscription status. Does not need the full POS feature set.

### Open questions — Part 2

- [ ] Database-per-tenant confirmed, or keep shared-DB open as a later option?
- [ ] Self-host vs Fly.io vs a managed platform for where tenant files actually live?
- [ ] Expected scale — rough number of clients in year 1 vs year 3? (Changes how much the "hundreds of SQLite files on one disk" ceiling matters.)
- [ ] Is the Electron desktop app offered to SaaS clients too (e.g. as an offline-capable companion syncing to their tenant DB), or is the SaaS product web-only?
- [ ] Billing provider preference (Stripe / Paddle / Lemon Squeezy / other)?
- [ ] Who are "admin" users of `admin.liratek.com` — just you, or a LiraTek support team with roles?

---

## Master list of decisions NOT yet made

Repeating for clarity, since nothing above should be read as committed:

1. Option A vs B for Electron/web unification (Part 1).
2. Whether Electron stays long-term or is eventually retired.
3. Database-per-tenant vs shared-DB-with-tenant_id (Part 2).
4. Which hosting/replication tool for tenant SQLite files (self-host+Litestream / Fly.io+LiteFS / Turso / other).
5. Billing provider.
6. Sequencing/timeline between Part 1 and Part 2.

---

## References

- [Turso Database Pricing](https://turso.tech/pricing)
- [Turso Cloud Debuts the New Developer Plan](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)
- [LiteFS · Fly Docs](https://fly.io/docs/litefs/)
- [LiteFS FAQ · Fly Docs](https://fly.io/docs/litefs/faq/)
- [Limits · Cloudflare D1 docs](https://developers.cloudflare.com/d1/platform/limits/)
- [Pricing · Cloudflare D1 docs](https://developers.cloudflare.com/d1/platform/pricing/)
- `docs/archive/BACKEND_DIFFERENCES.md` — historical context on the Electron vs Express backend split (partially stale, see note in "Current architecture" above)
- `docs/FEATURE_GUIDE.md` — money-invariant rules to check against any change touching payments/drawers/ledgers
