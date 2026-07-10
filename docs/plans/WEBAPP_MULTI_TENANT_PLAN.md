# Web-Deployable + Multi-Tenant Platform — Options Plan

**Created:** 2026-07-08 · **Last revised:** 2026-07-10 (browser smoke test executed — see Appendix A)
**Status:** 🟡 EXPLORATORY — no architectural decisions have been made yet
**Verified against:** repo at v1.29.3, migration **v122** (`rename_debts_module_to_accounts`; the audit's earlier v99 reading was wrong — migration entries are out of order in `migrations/index.ts`, and CLAUDE.md's v97 is also stale)

---

## Purpose of this document

This is a **planning and options** document, not an implementation plan. It captures the discussion on turning LiraTek from a single-tenant Electron desktop app into (1) something deployable as a website and (2) a multi-tenant SaaS platform at `liratek.com`, with subdomains per client and an admin panel.

**Nothing in here is a final decision.** Every fork below is intentionally left open, with the tradeoffs that were discussed. When we're ready to commit to an approach, that should happen as its own explicit step — not be inferred from this doc.

## Revision notes (2026-07-09)

The first draft was audited claim-by-claim against the repo. The largest corrections:

1. **A dual-mode IPC/HTTP adapter layer already exists and is wired live** — the first draft's "zero fetch usage, backend not connected to anything" was stale. See "Current architecture".
2. **SQLCipher encryption is not assured** — the installed driver is stock `better-sqlite3` prebuilds, which do not bundle the SQLCipher codec, and the key is optional. See Immediate hygiene item 3.
3. **The "camelCase frontend vs snake_case backend" parity gap is wrong** — casing is inconsistent *within each side* (three conventions coexist in `packages/core/src/validators/`). The old "normalize backend casing" start-now item was not no-regret and has been removed.
4. **"connection.ts is the one structural change" for DB-per-tenant badly understated the blast radius** — ~41 repository + ~37 service singletons cache state process-wide; the naive port is a cross-tenant data-corruption bug, not a compile error.
5. Entire missing topics added: offline/sync, receipt printing from a browser, fleet migrations, Socket.io tenant scoping, security (cookies/CSRF/secrets/admin realm/subdomain lifecycle), existing-desktop-customer import, billing viability in Lebanon, subscription-lapse policy.

---

## Immediate hygiene (do regardless of any decision)

These fell out of the audit and are worth doing now, independent of everything else in this doc:

1. **Rotate the committed API key.** `backend/.env.dev` is git-tracked and contains a live-looking `DASHSCOPE_API_KEY` (line 66). Rotate the key and untrack the file. *(Size: XS)*
2. **`backend/.env.prod` is corrupted.** The committed file contains only a stray tool-output artifact string, not real config (commit `0009db4`). Replace or remove; production env files probably shouldn't be committed at all. *(XS)*
3. **Verify whether the desktop DB is actually encrypted.** The plan (and CLAUDE.md) describe the DB as "SQLCipher-encrypted", but: `resolveDatabaseKey()` (`packages/core/src/db/dbKey.ts:25-45`) resolves one optional key from `DATABASE_KEY` or a plaintext `~/Documents/LiraTek/db-key.txt`; `applySqlCipherKey()` (`packages/core/src/db/sqlcipher.ts`) is an explicit no-op when no key exists; and the installed driver is stock `better-sqlite3@12.8.0` official prebuilds — no `SQLCIPHER`/`HAS_CODEC` build flags anywhere in the repo, and vanilla SQLite **silently ignores** `PRAGMA key`. A keyless (or codec-less) install runs a plain-text DB while everyone believes it's encrypted. Verify with a hex dump of a real install's DB header. *(S — investigation)*
4. **Dormant voucher-image defects** (low priority, note only): `frontend/src/contexts/MobileServiceItemsContext.tsx:183` reads `v.image_data` but rows carry `image_path` (display always undefined), and nothing in the UI calls `setVoucherImage` — the upload flow is unreachable.

---

## Current architecture (corrected)

The live desktop path:

```
Renderer (frontend/src, React 19)
   │  components call window.api.* directly (~60-65 prod files)
   │  OR go through the adapter layer (below) — both patterns coexist today
   ▼
contextBridge / preload.ts — 44 namespaces, ~310 invoke methods + 17 event bindings
   ▼
Main Process (electron-app/) — 36 handler modules, requireRole(), Zod validation
   ▼
Shared Core (packages/core/src) — services/ + repositories/ (parameterized SQL)
   ▼
SQLite — phone_shop.db (SQLCipher intended; see hygiene item 3), one file, one writer
```

**The adapter layer that already exists** (the first draft missed this entirely):

- `frontend/src/api/httpClient.ts` — fetch-based JSON client with JWT Bearer auth (token in localStorage `liratek.jwt`), base URL `http://localhost:3000`, overridable via `globalThis.__LIRATEK_BACKEND_URL`.
- `frontend/src/api/backendApi.ts` — ~2,600 lines, 174 exported dual-mode functions; each branches via `ipcOrHttp()` (tries Electron IPC, falls back to HTTP on failure).
- `packages/ui` (a workspace missing from the first draft's diagram) — defines a ~167-method `ApiAdapter` interface (`packages/ui/src/api/types.ts`) and an `ApiProvider` React context.
- **Wired live at `frontend/src/app/App.tsx:340`** via `<ApiProvider adapter={backendApiAdapter}>`; ~59 files already consume `useApi`/`ApiContext`.
- `frontend/src/api/socket.ts` imports `socket.io-client` (currently unconsumed by any component).

So the frontend today is *mid-migration* between direct `window.api.*` calls and the adapter — at least one page (`Debts/index.tsx:608-630`) hand-maintains the same repayment payload in **both** casing conventions, one per path. That dual-maintenance tax the first draft warned about hypothetically is already being paid.

The web backend (`backend/`):

- Express + Socket.io; 30 route files, 28 mounted under `/api/*` (+ `/health` unprefixed).
- 26 of 30 route files import services from `@liratek/core`; `backend/src/services/` holds only a backend-specific voice-transcription service; the duplicated repositories described in `docs/archive/BACKEND_DIFFERENCES.md` **no longer exist** (that doc is historical).
- Auth: **JWT wrapping a core DB session** — login creates a DB session row, then signs `{userId, role, sessionToken}` (7-day expiry, no refresh endpoint). ⚠️ Legacy JWTs *without* a sessionToken are accepted on signature alone (`backend/src/middleware/auth.ts:81-85`) — a backward-compat hole any tenant-scoping work must close.
- `helmet`, CORS (single fixed origin `CORS_ORIGIN`), and in-memory per-IP rate limiting exist; **no `trust proxy`**, no static-file serving (`express.static` appears nowhere — someone must serve `frontend/dist`).
- Socket.io: **zero handshake auth**; `emitEvent()` is a global `io.emit` broadcast; one production emit site (`sales:processed` after `POST /api/sales/process`); a second WebSocket server exists for voice. A dev-only `/api/ws/emit` debug endpoint is prod-gated (404) but should be deleted for SaaS.
- Config is centralized in `packages/core/src/config/env.ts` (Zod-validated: PORT, HOST, CORS_ORIGIN, DATABASE_PATH, DATABASE_KEY, JWT_SECRET, JWT_EXPIRES_IN, voice keys) with `validateProductionEnv()` called at startup.
- ⚠️ `backend/src/database/connection.ts` bootstraps missing schema by reading `electron-app/create_db.sql` via a **relative cross-package path** — breaks if backend is ever deployed without `electron-app/` present (e.g. a container).

Note: `frontend/src/config/env.ts` (apiUrl / wsUrl / `appMode`) is **entirely dead code** — nothing imports it. Mode detection actually happens by runtime sniffing (`isElectron()` checks `window.api` presence). Either adopt it or delete it during the adapter work.

---

## Part 1 — Making the app genuinely web-deployable

**Goal:** the same product runs as a browser-hosted web app, not just inside Electron.

### The open fork

**Option A — Unify on the backend.**
Electron stops calling core via data IPC. It runs the `backend/` Express server locally and the renderer points at `http://localhost:<port>` — the same server a browser client would hit. IPC survives only for genuinely native things.

- ✅ One auth model, one payload shape, one place money logic lives.
- ✅ The mechanism already exists and is exercised every dev session: `ELECTRON_RENDERER_URL` dev mode loads the renderer from a URL (`electron-app/main.ts:144-157`); production Option A is "flip `loadFile` to `loadURL` + serve static from the embedded server."
- ❌ Bigger lift, and **bigger than the first draft priced**: the REST surface has real coverage holes (below), not just shape drift.

**Option B — Two thin clients, one shared core.**
Keep Electron's direct-IPC path; finish the existing dual-mode adapter so a browser build uses HTTP-only.

- ✅ Smaller step from today's reality — `backendApi.ts` already implements exactly this branching.
- ❌ Two live entry points forever: two auth models, and the casing/dual-payload tax already visible in `Debts/index.tsx` becomes permanent.

**OPEN DECISION #1:** A vs B vs staged (B now, A later).

### What Option A actually retires vs keeps (measured)

Of the 36 registered handler modules in `electron-app/main.ts`:

- **Retired (data-carrying, ~29 files):** auth, client, currency, debt, exchange, financial, inventory, maintenance, omt, rate, recharge, sales, loto, suppliers, partners, holdMoney, vouchers, etc. (`whatsappHandlers` contains no Electron APIs at all — it's already server-portable.)
- **Kept as IPC (~5 files):** `printHandlers` (silent thermal printing to named printers), `reportHandlers` (PDF via `printToPDF` **and** the local backup/restore/relaunch lifecycle — this one file needs splitting), `updaterHandlers`, `backupHandlers` (hourly local backups to Documents), `setupHandlers` (first-run DB path selection, `app.relaunch`).
- **Mixed (2):** `dbHandlers` (data channels retire; `database:browse`/`changePath` stay), `voiceBotHandlers` (Qwen ASR WebSocket proxy lives in main only because of the API key; moves to the backend, which already has the skeleton).

Also: `packages/core/src/services/ReportService.ts` **imports `electron` directly** (deliberately not exported to backend) — backup/restore-from-UI and PDF export currently have **no server-side implementation at all**.

### REST coverage gap (bigger than a "parity audit")

`backend/src/api/` has **no routes at all** for: loto (33 IPC channels!), partners, drawer top-ups, hold-money, voucher codes, mobile service items, audit log, whatsapp, backups. Existing routes are also thinner than their IPC twins (e.g. debts REST = 4 endpoints, no addCredit). Under either option, a browser client needs these **built**, not audited.

### Browser-client capability gaps (may decide the whole fork)

- **Receipt printing (HIGH).** Every sale prints silently to a named thermal printer via `webContents.print({silent, deviceName})`. Browsers cannot enumerate printers or print silently — a web client either pops a print dialog per sale (unacceptable at a counter) or requires a local print agent (QZ-Tray-style), which reintroduces an installed component. This alone may force "Electron stays at the counter; web is for the owner's remote view."
- **Offline (HIGH).** Today the product is fully offline by construction. A browser app is dead the moment the shop's connection drops mid-sale — and this product's dual USD/LBP drawer model exists *because* of Lebanon's infrastructure. See Part 2's offline section; the answer here materially changes Option A/B.
- **Voice features.** The active path builds a HuggingFace key into the renderer bundle (`VITE_HUGGINGFACE_API_KEY` — a browser deploy would ship the key to everyone); the Qwen path proxies through Electron main. Web mode needs a server-side proxy (skeleton exists in `backend/src/api/voice.ts`).

### Steps common to either option

1. **Finish the adapter migration** (rescoped from "build an abstraction layer" — it exists): migrate the ~60-65 files still calling `window.api.*` directly onto the adapter; extend coverage from ~167 to ~310 methods; reconcile the two competing interface definitions (`frontend/src/types/electron.d.ts` — 38/44 namespaces, 7 missing, one stale `binance` namespace, conflicting optional re-declaration in `window-globals.d.ts` — vs `packages/ui/src/api/types.ts`); adopt-or-delete the dead `config/env.ts`. *(Size: L)*
2. **Decide payload casing** — an open decision, not a given: three conventions coexist in `packages/core/src/validators/` (snake_case `createSaleSchema`, camelCase `addRepaymentSchema` with one snake_case field, and a third style in `addCreditSchema`). Normalizing touches core validators + electron-app Zod schemas + frontend call sites — **not** just backend routes. Do not start this before the pinning tests (next item) exist. *(M, after decision)*
3. **Pin current behavior with API-level tests** (supertest against `/api/*`; some infra exists in `backend/src/middleware/__tests__/`) — must land **before** any casing/shape change, or the tests can't catch regressions from it. *(M)*
4. **Money-critical parity matrix** — ONE audit, one deliverable (a checked matrix doc): for each of the 44 IPC namespaces, does a REST route exist / match behavior on payments, drawers, ledgers per `docs/FEATURE_GUIDE.md` §13. The route-existence column is already known to have big holes (above). *(M)*
5. **Serve the frontend** — decide who serves `frontend/dist` + SPA fallback (Express static vs reverse proxy vs CDN); today nobody does. *(S)*
6. **Socket.io handshake auth** — required for any web deployment even single-tenant (today any connected browser receives all `sales:processed` events without logging in). *(S)*

### Open questions — Part 1

- [ ] Option A vs B vs staged? (Decision #1)
- [ ] Does Electron stay long-term (printing + offline both push "yes, at the counter")? (Decision #2)
- [ ] Payload casing convention? (Decision #3)
- [ ] Which interface is *the* adapter contract — `electron.d.ts` or `packages/ui` ApiAdapter? (Decision #4)
- [ ] Timeline relative to Part 2? (Decision #11)

---

## Part 2 — Multi-tenant SaaS platform

**Goal:** `liratek.com` hosts the product; `admin.liratek.com` manages subscribed businesses; each business gets `clientname.liratek.com`.

**Working assumption (itself open — Decision #11):** Part 1 lands first; Part 2 multiplies a working web backend across tenants.

### Shape of it

- **Control plane** (`admin.liratek.com`) — LiraTek's bookkeeping: subscribed businesses, subdomain, plan, status.
- **Data plane** (`clientname.liratek.com`) — the POS, one behavioral instance per client.
- Reverse proxy (Caddy or Cloudflare — Decision #10) with a wildcard cert for `*.liratek.com`; middleware resolves `Host` → tenant.

⚠️ **Naming collision:** the schema's existing `clients` table means "the shop's own customers" (debt ledgers, phone numbers — `create_db.sql:141-148`, FK'd from `debt_ledger` and `transactions`). The SaaS concept needs its own name (`tenants` / `accounts` / `subscribers`) — Decision #5.

### The DB fork — leaning direction, with honest costs

**Database-per-tenant (leaning, not finalized)** — every client gets their own SQLite file.

- ✅ SQL itself needs no `tenant_id` filter anywhere — the tenant boundary is the file. Isolation from missed-WHERE-clause leaks is structural.
- ✅ Backup/export/offboarding = one file (but see Compliance below re: replicated copies).
- ❌ **The singleton blast radius (corrected from first draft):** it is *not* just `connection.ts`. Process-wide cached state lives in three layers: ~41 module-level repository singletons (`getXRepository()` caching `let instance`), ~37 service singletons freezing a repo reference at construction, and the repos split into two camps — ~30 extend `BaseRepository` whose lazy `get db()` calls `getDatabase()` per access (these follow a request-scoped `getDatabase()` for free), but ~12 capture `this.db` in their constructor and would **stay bound to the first tenant's handle**. The naive port silently serves tenant A's data to tenant B — a data-corruption bug, not a compile error. Fix shapes: AsyncLocalStorage-backed `getDatabase()` + constructor-camp cleanup, or per-request factory/DI. This is the largest single code change in the DB-per-tenant path. *(Size: L)*
- ❌ The connection is currently constructed **outside** core in both live paths (`electron-app/main.ts:267` and `backend/src/database/connection.ts:55` each do `new Database()` + pragmas + key + inject via `initDatabase`); a tenant-aware cache needs that open/configure/key/bootstrap sequence extracted into core first. Backend also registers SIGTERM/SIGINT handlers closing its single handle — must iterate a cache instead.
- ❌ **Synchronous better-sqlite3 in one process = one slow query blocks every tenant.** `ProfitService.getSummary` synchronously chains ~10 aggregate queries; `ProfitRepository` is 1,172 lines of SUM/CASE aggregation, already exposed over HTTP at `/api/profits`. On desktop (one user) this is invisible; in a shared server it's the central scaling constraint. Options to evaluate: worker_threads pool, process pools with tenant pinning, Node cluster, or explicit query-time budgets. Interacts with the connection cache and with Socket.io (needs a Redis adapter + sticky sessions if ever multi-process).
- ❌ **Connection-cache correctness hazards:** eviction = `db.close()`, which throws under an in-flight transaction — needs refcounting/pinning, not pure LRU; each open WAL DB holds ~3 fds (db/-wal/-shm), so cache size is an fd budget; evict should checkpoint the WAL or idle tenants' -wal files grow unbounded (and checkpointing interacts with Litestream, which tails the WAL); WAL/foreign_keys pragmas must be replayed on every open.

**Shared database with `tenant_id` (classic pattern)** — one Postgres, every table + query gets a tenant filter.

- ✅ Single DB to operate; native concurrent writes; easy cross-tenant analytics.
- ❌ Touches every repository *query* (vs the per-tenant path touching every repository *singleton* — both are large; they are different-shaped L's, and the first draft understated the per-tenant one).
- ❌ The missed-`WHERE tenant_id` leak class, in a money app.
- ❌ Migration off better-sqlite3 entirely.

**OPEN DECISION #6:** confirm DB-per-tenant only after sizing the singleton refactor honestly against the shared-DB query refactor.

### Fleet operations (new section — recurring cost of DB-per-tenant)

- **Schema upgrades across N files:** `runMigrations(db)` takes one handle and today runs only at Electron startup. Needed: eager loop-at-deploy vs lazy migrate-on-connect; behavior when tenant #37 of 200 fails mid-fleet (mixed schema versions against one server binary → runtime `no such column` on money queries); per-tenant backup-before-migrate; a version gate refusing to serve a behind-schema tenant; `down()` semantics across a partial fleet.
- **create_db.sql ↔ migrations drift** has already produced two in-repo hotfixes (v70 heal, loto_settlements). Provisioning fresh tenant DBs from `create_db.sql` multiplies that risk × N — an automated equivalence check (fresh-from-SQL vs migrated-from-zero schema diff) should be provisioning pre-work. Also: the fresh-install bootstrap is inline glue duplicated in `electron-app/main.ts:307-334` and `backend/src/database/connection.ts:26-45` (the latter via a fragile relative path) — extract one shared `bootstrapTenantDb()` into core.
- **Restore:** per-tenant point-in-time restore procedure + periodic drills, not just "Litestream exists".
- **Support access:** how staff debug a tenant's DB (copying a shop's full financial DB is a PII/access-control question the admin panel must answer, with audit).

### Realtime (new section)

Socket.io today = global unauthenticated broadcast (`io.emit`); multiplied across tenants, every shop's `sales:processed` stream reaches every connected browser on every subdomain — a leak requiring no SQL mistake at all, and it undermines "isolation is structural." Needed: JWT verification in `io.use()` handshake middleware, per-tenant rooms (`io.to(tenant).emit`), a tenant parameter on `emitEvent()`, same treatment for the voice WebSocket server, delete `/api/ws/emit` for SaaS.

### Security & auth (new section)

- **Browser credential storage / cookies / CSRF (HIGH):** the JWT currently rides in localStorage (`liratek.jwt`, 7-day, no refresh/rotation) → XSS exfiltration risk; the alternative (cookies) must NOT use `Domain=.liratek.com` (rides to every tenant subdomain **and** admin) — host-only/`__Host-` cookies, SameSite, and CSRF protection (none exists today) are all undesigned. Also close the legacy signature-only JWT acceptance path before any tenant claims matter.
- **Secrets management (HIGH):** one global `JWT_SECRET` (no rotation story); SQLCipher key resolution is single-key-per-machine from env/plaintext-file — meaningless for N tenant files. Per-tenant keys (where stored — KMS? next-to-the-path-in-control-plane defeats the purpose), one shared server key (one leak decrypts every tenant, including Litestream replicas), or drop SQLCipher server-side in favor of disk + encrypted-bucket — undecided (Decision #8). Stripe/billing webhook signature verification belongs here too.
- **Admin realm (HIGH):** the `users` table lives *inside each tenant's DB* — control-plane admins structurally cannot reuse it. Separate credential store, MFA (these accounts can reach every tenant's money data), IP allowlisting worth considering, and an append-only `admin_audit_log` in the control plane (core's ActivityService writes per-tenant and can't hold cross-tenant admin actions).
- **Subdomain lifecycle (HIGH):** reserved-names blocklist (`www`, `api`, `admin`, `mail`, confusables) + strict slug charset before any self-service signup; unmatched Host must hard-404 (never fall through to a default tenant); a recycling policy for churned slugs (a re-registered slug inherits the old shop's password-manager autofill and bookmarks — practical account-takeover against the previous tenant's staff).
- **CORS (MEDIUM):** single fixed origin today (also duplicated in the Socket.io config). The fix must be a dynamic origin callback validated against the tenant registry — with `credentials: true` already set, a lazy regex-reflect allows credentialed cross-origin calls between tenants. Exclude `admin.` as an allowed origin for data-plane APIs.
- **Rate limiting (MEDIUM):** in-memory, per-IP, no `trust proxy` — behind the planned proxy all tenants share one bucket keyed to the proxy's IP (any tenant can starve the platform; careless `trust proxy` later = spoofable `X-Forwarded-For` bypassing the login limiter). Needed: correct trust-proxy config, limits keyed by tenant+account, a shared store once >1 instance, and per-account lockout (no failed-attempt tracking exists in core at all). Current global limit (100 req/15min across all of `/api`) is also far too low for a live POS.

### Compliance & data lifecycle (new section)

- "Delete = one file" contradicts the Litestream leaning: replicas in S3/R2 survive local deletion. Need per-tenant backup purge/retention (+ key destruction if per-tenant encryption), an offboarding export commitment, and a stance on statutory retention of financial/POS records — this is a money app; tax law may *forbid* immediate deletion.
- Central server logs become a cross-tenant PII store (the rate limiter already logs attempted usernames). Log retention, tenant tagging, and scrubbing rules needed.
- **Subscription-lapse policy** shapes the control-plane status enum (active/grace/read-only/suspended/purged): hard cutoff means a shop can't see who owes *them* money (debt_ledger is their receivables) — churn-by-fury. Decide grace period, read-only mode, guaranteed `.db` export on exit (note: an exported file imports into the free desktop app — an unexamined competitive dynamic), retention window, reactivation.

### Business & product (new section)

- **Offline/sync (HIGH — plausibly the deciding factor for adoption):** a web-only POS dies with the connection. If the answer is "Electron stays at the counter, syncing to the tenant DB," that is **bidirectional multi-writer sync over money tables** (drawers, debt_ledger, sales) with conflict resolution — the hardest engineering problem in this entire document, and Litestream (one-way backup) cannot provide it. This deserves its own investigation before the Option A/B call is made, because "web app = owner's remote dashboard (read-mostly), desktop = the counter" is a very different — and much easier — product than "web app replaces the desktop."
- **Existing-customer import (HIGH):** provisioning currently only covers *new* signups. The installed base has local `phone_shop.db` files (possibly encrypted, at older migration versions, with local users/settings). Needed: export from desktop → upload → decrypt/re-key → migrate to fleet version → money-invariant integrity checks → cutover semantics (does the desktop keep writing after import?). Without this the SaaS strands every current customer.
- **Billing viability (MEDIUM):** two threshold checks before "just use Stripe": (a) **Stripe does not onboard Lebanon-based merchant entities** — the default recommendation may be unavailable outright (Paddle/Lemon Squeezy as merchant-of-record, or a non-Lebanese entity, are the usual workarounds — verify); (b) will Lebanese shop owners pay by recurring card at all? The product's own domain model (dual-currency cash drawers, OMT/Whish) exists because the market runs on cash and transfer offices. The realistic channel may be manual invoicing / cash / OMT — which inverts the design: control plane needs manual mark-paid + human-driven suspension rather than webhook-driven status.
- **Entitlements (MEDIUM):** "plan" must map to something. The per-tenant `modules` table is controlled by the *tenant's* admin — it cannot be the entitlement source (a tenant flipping a row ≠ a free upgrade). Control-plane-enforced feature flags, seat caps (per-tenant `users` is uncapped), and metering for cost-bearing features (the voice bot has real per-use cost) should be reserved for in the control-plane schema now, even if unimplemented.
- **Release cadence (MEDIUM, if Electron survives):** continuous web deploys vs tag-driven `electron-updater` desktop releases = schema/API drift between an un-updated desktop and a newer server. Needs API versioning or a minimum-client handshake, and a rule for which side's migration waits.

### Tooling landscape for DB-per-tenant hosting (checked 2026-07-08, none selected)

| Option | Fit | Cost to adopt |
|---|---|---|
| **Self-host + Litestream** | Keep `better-sqlite3` as-is; one file per tenant; Litestream ships each WAL to S3/R2 | Free, zero code change. One-way backup only — not sync, and restores of encrypted files need the key story settled |
| **Fly.io + LiteFS** | Mounts as a normal path; sync driver keeps working | Beta; Fly deprioritized it (managed backup sunset Oct 2024); FUSE ~100 tx/sec/file |
| **Turso (libSQL)** | Purpose-built DB-per-tenant; free tier 100 DBs; $4.99/mo unlimited | `@libsql/client` is **async** → rewrite of every sync repository/service call path |
| **Cloudflare D1** | Thousands of DBs cheaply | Workers runtime only — abandons the Express backend entirely |

### New components required (regardless of fork outcomes)

1. Control-plane schema — tenant, subdomain, plan/status (rich lifecycle enum), DB location, entitlement flags, admin users, `admin_audit_log`.
2. Tenant-resolution middleware — Host → tenant → request-scoped DB + tenant-tagged logger (AsyncLocalStorage).
3. Provisioning flow — shared `bootstrapTenantDb()` extracted to core (see Fleet ops) + slug validation/reserved names.
4. Fleet migration runner + version gate (see Fleet ops).
5. Tenant-scoped auth — JWT carries tenant; middleware rejects cross-subdomain replay; legacy-JWT path closed.
6. Tenant-scoped realtime (rooms + handshake auth).
7. Admin panel (`admin.liratek.com`) — list/provision/suspend, subscription status, audit trail.
8. Per-tenant observability + rate limiting/quotas.

---

## What can start now (no-regret work)

Safe under **every** open decision:

1. **Immediate hygiene items 1-3** (key rotation, .env.prod, SQLCipher verification). *(XS-S)*
2. **Finish the adapter migration** — Part 1 step 1. Required by both Option A and B; it's completing an in-flight refactor, not new architecture. *(L)*
3. **Parity matrix** — Part 1 step 4. Research with a concrete deliverable; produces the evidence for Decision #1. *(M)*
4. **API pinning tests** — Part 1 step 3. Hardens the dormant backend regardless; must precede any payload-shape work. *(M)*
5. **Socket.io handshake auth** — Part 1 step 6. A security fix for any future web deployment; harmless to desktop. *(S)*
6. **Tenant vocabulary** — Decision #5 is cheap to make early and expensive to make late; making it costs a conversation, not code.

**Removed from the first draft's list:** "normalize backend payload casing to camelCase" — not no-regret (three conventions live in *core validators*, not backend routes; frontend money flows are predominantly snake_case; changing shapes before pinning tests exist destroys the safety net; and the convention itself is an open decision).

Dependency map for the deferred work: embedding the backend in Electron / retiring IPC handlers ← Decision #1; tenant-aware connection + singleton refactor ← Decision #6; control plane/admin panel/wildcard TLS/billing ← Part 1 shipped + Decisions #6-#10.

---

## Decision criteria (what evidence resolves each fork)

- **#1 Option A vs B** ← the parity matrix (how much REST must be built anyway), the printing answer, and the offline answer. If offline/printing force "Electron stays at the counter," B's dual-path cost shrinks and A's payoff shrinks with it.
- **#2 Electron's future** ← offline investigation + printing. These are product questions before they are code questions.
- **#6 DB fork** ← honest sizing of the singleton/AsyncLocalStorage refactor vs the add-tenant_id-everywhere refactor, plus expected tenant count (#13) and whether cross-tenant analytics is ever a product feature.
- **#7 Hosting tool** ← the SQLCipher decision (#8) + ops appetite; Turso only re-enters if an async rewrite is ever paid for other reasons.
- **#9 Billing** ← a half-day feasibility check: can the business entity be onboarded (Stripe: no for Lebanon; verify Paddle/LS), and how do target customers actually want to pay?

---

## Master list of open decisions

> ⚠️ **Update 2026-07-10:** Decisions **#5** (tenant vocabulary → `tenants`/`tenant_id`) and **#6** (DB model → **one shared SQLite DB with `tenant_id`**, NOT database-per-tenant) are now **RESOLVED** — see `docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md`, which supersedes this document's Part 2 DB-fork leaning. That plan also settles tenant resolution (JWT, no subdomains in v1) and the super-admin realm (`users.tenant_id = NULL` + `super_admin` role).

1. Option A vs B vs staged (Part 1).
2. Electron long-term: retired, or permanent counter-companion (printing/offline).
3. Payload casing convention (one convention across core validators, schemas, clients).
4. Canonical adapter interface: `electron.d.ts` vs `packages/ui` ApiAdapter.
5. Tenant vocabulary (`tenants` / `accounts` / `subscribers`).
6. DB-per-tenant vs shared-DB (+ the singleton-refactor approach if per-tenant).
7. Tenant-file hosting: self-host+Litestream / Fly.io+LiteFS / Turso / other.
8. Server-side encryption: per-tenant SQLCipher keys / shared key / disk-level only.
9. Billing provider & collection model (webhook-driven vs manual mark-paid).
10. Reverse proxy: Caddy vs Cloudflare.
11. Sequencing/timeline: Part 1 before/alongside Part 2.
12. Offline product stance: web = full POS vs web = remote dashboard + desktop counter.
13. Expected scale (tenants year 1 / year 3) — input to #6/#7.
14. Who administers `admin.liratek.com` (solo vs support team with roles).

---

## References

**Repo (facts in this doc were verified against these on 2026-07-09):**
`frontend/src/api/` (httpClient.ts, backendApi.ts, ElectronApiAdapter.ts, socket.ts) · `frontend/src/app/App.tsx:340` · `packages/ui/src/api/types.ts` · `frontend/src/types/electron.d.ts` · `frontend/src/config/env.ts` · `electron-app/preload.ts` · `electron-app/main.ts` · `electron-app/session.ts` · `electron-app/handlers/` (printHandlers, reportHandlers, updaterHandlers, backupHandlers, setupHandlers) · `backend/src/server.ts` · `backend/src/middleware/` (auth.ts, rateLimit.ts) · `backend/src/websocket/io.ts` · `backend/src/database/connection.ts` · `packages/core/src/db/` (connection.ts, dbKey.ts, sqlcipher.ts, migrations/index.ts) · `packages/core/src/config/env.ts` · `packages/core/src/validators/` · `docs/FEATURE_GUIDE.md` · `docs/archive/BACKEND_DIFFERENCES.md` (historical only)

**External (volatile — re-verify before relying):**
- [Turso Database Pricing](https://turso.tech/pricing) · [Turso Developer Plan](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)
- [LiteFS · Fly Docs](https://fly.io/docs/litefs/) · [LiteFS FAQ](https://fly.io/docs/litefs/faq/)
- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)

---

## Appendix A — Browser smoke test results (2026-07-09/10, live run)

The app was run in a real browser: backend (`yarn workspace @liratek/backend dev`, Node ABI via `yarn rebuild:node`, `backend/.env` pointing `DATABASE_PATH` at a **copy** of the dev DB) + Vite (`yarn workspace @liratek/frontend dev`), driven by headless Chromium through login and all 20 routes.

**Result: login works end-to-end and 9 of 20 pages render clean** — `/dashboard`, `/pos`, `/exchange`, `/expenses`, `/maintenance`, `/partners`, `/profits`, `/settings`, `/audit`.

**Fixes applied during the run** (all in working tree, typechecked):
1. `backendApi.login` — unwrap the `data:{}` envelope from `/api/auth/login` (was: JWT never stored, login always "failed"). `/api/auth/me` responds flat — live proof of intra-backend envelope drift.
2. `httpClient.ts` — default base URL `localhost:3000` → `127.0.0.1:3000` (browsers may resolve `localhost` to IPv6 `::1`, where another process — Docker here — can squat the port; surfaces as a fake CORS error).
3. `SessionContext` — guard IPC-only session polling (was: caught TypeError logged every 7s in web mode).
4. `Dashboard.tsx` — guard two IPC-only mount effects (`closing.hasInitialBalancesSet` / `hasStartingCheckpoint`); page crashed to the ErrorBoundary in web mode.
5. `rateLimit.ts` — limits now env-tunable (`API_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, defaults unchanged). One authenticated session burned the 100-req/15-min budget in ~6 pages; boot-time 401 `/me` probes also eat the 5-attempt login budget.

### Appendix A.1 — Broken-page fix round (2026-07-10, roadmap step 1)

All pages below were fixed; `yarn test:e2e:web` is green at **16 tests** (4 web-native + **12 desktop spec tests running shared**, incl. real money-writes: exchange, OMT send, expense record, product/client creation through the UI over REST).

**Fixes landed** (all typechecked + linted, Electron path untouched):
- Envelope unwraps in `backendApi.ts`: `getClients`, `getProducts`, `createProduct`, new `createClient`/`updateClient` (routes wrap in `createSuccessResponse({data})`, adapter read flat).
- `useShopBase.ts` (crashed /services + /suppliers) → dual-mode `getAllSettings()`.
- `ClientAutocompleteInput` (failed on every page embedding it) → dual-mode `getClients`/`getDebtors`.
- Exchange submit: REST `createExchangeSchema` demands `rate` + full-ISO `transaction_time` the form never sent → normalized in the HTTP branch. ⚠️ The REST validator also **strips the leg1*/leg2* profit fields** — leg-profit stamping parity is an open step-2 item.
- **Backend route bug** (`backend/src/api/inventory.ts` POST): `createProductSchema` field names (`cost_price_usd`, `stock`…) were validated then passed unmapped to core's `CreateProductData` (`cost_price`, `stock_quantity`…) → **products created via REST got NULL prices**. Route now maps. Same class fixed in `createClient` (`whatsapp_opt_in` boolean vs 0/1).
- IPC-only guards (Dashboard pattern): CheckpointTimeline, CustomerSessions, Recharge drawer balances, Vouchers (+ user-facing "not available in web yet"), service presets (page + modal), Services' partners lookup.
- `ErrorBoundary` now resets on hashchange (one crashed page no longer poisons all later routes — desktop benefits too).

**Still blocked (with exact causes):**
- ~~POS complete-sale + Debts settle~~ **FIXED (2026-07-10, step 2 opener):** the real sale contract (`SaleProcessSchema` + payment-leg schema) moved from `electron-app/schemas/` into `packages/core/src/validators/sale.ts` (`saleProcessSchema`); the REST route now validates against it and allows staff (role parity with IPC). Both transports feed the identical `SalesService.processSale`. **app.spec.ts passes 14/14 in web mode — `yarn test:e2e:web` = 18 green**; backend jest 384/384. The old thin `createSaleSchema` is `@deprecated`.
  - ⚠️ Found while doing it: `packages/core` declares **zod ^4.3.6** while root/backend/electron declare **^3.2x** and the hoisted runtime is 3.25 — core's emitted d.ts uses zod-4 generics that zod-3 consumers reject (bridged with one typed cast in `electron-app/schemas/index.ts`). Align the zod versions across workspaces — hygiene item.
- `/loto`: `/api/loto/*` routes don't exist (step 2 continues — same recipe: lift the loto IPC schemas to core validators, add routes calling the same core services).
- lira-073: its `createOmtAppSend` seeding form (`#transfer-amount`) doesn't open in web mode — uninvestigated.

**Original broken-page table (historical, all fixed except /loto):**

| Route | Failure | Root cause |
|---|---|---|
| `/products` | crash (`ProductList.tsx:130` `.length` of undefined) | data shape/guard on HTTP path |
| `/clients` | crash (`DataTable` `.map` of undefined) | list response shape mismatch on HTTP path |
| `/services`, `/suppliers` | crash (`useShopBase.ts:18` `.settings`) | **one shared hook** hits `window.api` unguarded — single fix, two pages |
| `/checkpoint-timeline` | crash (`index.tsx:32` `.closing`) | unguarded `window.api.closing` |
| `/loto` | degraded; 404s on `/api/loto/*` | **routes don't exist** — confirms the REST coverage gap live |
| `/recharge` | degraded (drawer balances) | unguarded `window.api.recharge` |
| `/custom-services` | degraded (presets, autocomplete) | unguarded `window.api.servicePresets` / shared autocomplete |
| `/vouchers` | degraded (`.vouchers` undefined) | unguarded/shape |
| `/customer-sessions` | degraded | unguarded `window.api.session` in page |
| `/debts` | renders; React key warnings only | minor |

**Shared E2E specs (added 2026-07-10):** the desktop suite's `fixtures.ts` and `helpers/seed.ts` are now dual-mode — `playwright.web.config.ts` sets `E2E_MODE=web` and the SAME spec files run against browser+REST (its `web-shared` project, allowlisted via `SHARED_DESKTOP_SPECS` + grep). Current state: 4 of app.spec.ts's sub-tests pass in web mode (incl. the record-an-expense write flow). An inventory of all 53 desktop spec files found ~50 are BLOCKED-API — they drive `window.api.*` directly via `page.evaluate` to seed/verify money state, independent of which page they visit. The strategic lever for reusing them wholesale is a **web-mode `window.api` shim** that maps the IPC surface onto REST (the `backendApi.ts` dual-mode functions are ~half of that shim already) — worth doing after route coverage closes, since a shim over missing routes just converts API errors into 404s. Two new web bugs found by the shared specs: **exchange form submit silently fails over REST** (form never clears; write-path envelope/adapter mismatch), and lira-073's export test depends on a transfer form in a broken flow.

**Cross-cutting findings:**
- `ClientAutocompleteInput` (shared) fails on every page that embeds it — one component fix clears noise on 4+ pages.
- **The app-root ErrorBoundary is sticky across hash navigation**: one crashing page shows "Something went wrong" on every route visited after it (affects desktop too, in principle). Needs per-route boundaries or reset-on-navigation.
- The dev DB at `~/Library/Application Support/liratek/phone_shop.db` is **confirmed plaintext** (`SQLite format 3` header) — hygiene item 3 is now verified fact, not suspicion.
- Ops gotchas for reruns: kill the node child holding port 3000 (killing `tsx watch` orphans the server and a relaunch dies with `EADDRINUSE` while the old limiter state keeps serving); Docker publishing `*:3000` on IPv6 shadows the backend for anything resolving `localhost`.
