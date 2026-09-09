# Production Database & Hosting Plan

> **Status**: decided in principle, **gated on a compatibility spike** (Phase 0).
> **Written**: 2026-09-09. Supersedes the "one shared file" assumption in
> `MULTI_TENANT_IMPLEMENTATION_PLAN.md`.
> Companion doc: `docs/DEPLOYMENT.md` (the current tunnel-based scaffolding).

---

## 1. What is decided

| Decision | Owner's call | Why |
| --- | --- | --- |
| **One database file per tenant** | Yes | See § 2. Reverses the earlier "shared file + `tenant_id` filter" recommendation. |
| **A separate control-plane database** | Yes | `tenants`, `tenant_subscriptions`, super-admin users/sessions, platform audit. |
| **Backend leaves the owner's laptop** | Yes | Power and internet in Lebanon must not be a dependency of other people's shops. |
| **Cloudflare Tunnel retired for production** | Yes | It exists to reach a machine that should not be the server. |
| **Turso Cloud as the hosted database** | Owner's decision, 2026-09-09 | Account created. **Conditional on Phase 0 passing** — § 4 explains exactly what could stop it. |
| **Desktop app unchanged** | Yes | Stays offline-first on a local file with `better-sqlite3`. Non-negotiable: an offline till is the product. |

Explicitly **not** changing: the schema, `tenant_id` on every table (always `1` per
tenant file, exactly as desktop already does), every repository, every service, the
frontend.

---

## 2. Why database-per-tenant

This reverses an earlier recommendation. Three verified facts changed it:

1. **The desktop app already is this architecture.** Each desktop shop is one SQLite
   file running the full schema with `tenant_id = 1` (`initFixedTenantContext(1)`),
   bootstrapped from `create_db.sql` + migrations. A per-tenant web database is a
   desktop database, hosted — not a new design.

2. **The routing seam is one function.** `BaseRepository.db` is a **getter that calls
   `getDatabase()` on every access** (`BaseRepository.ts:115`); nothing caches a
   handle. The 33 direct `getDatabase()` calls elsewhere are also per-call. Routing by
   tenant therefore lives in `getDatabase()` alone, and every repository follows.

3. **The process-wide caches are schema-shape only** — `tableExistsCache`,
   `_hasCommissionModelColumnCache`, `_hasSettlementAllocationsTableCache`. They cache
   *"does this column exist"*, not data, and are identical across tenants **provided
   every tenant file is at the same migration version**. That is an invariant to
   enforce (§ 6), not a blocker.

Gains: no cross-tenant write lock; blast radius of any bug is one shop; per-shop
backup/restore is a file operation; a shop can move between desktop and web by
copying its file; and placement becomes possible — no query joins across tenants, so
nothing forces all tenants onto one node.

**Timing is the strongest argument: there is exactly one real tenant today.** The
current file *is* CornerTech's. Splitting now moves a handful of control-plane rows.
At twenty tenants it is a migration project with downtime.

Side benefit: the realmless-login ambiguity that caused the `admin`/`Admin` incident
becomes impossible by construction — with no tenant host there is no tenant database
to search, only the platform.

---

## 3. Target architecture

```
platform database                  per-tenant databases
  tenants                            <tenant_id>.db  ×N
  tenant_subscriptions               the full LiraTek schema, tenant_id = 1
  users     (super admins only)      (byte-compatible with a desktop database)
  sessions  (super admin sessions)
  audit_log (platform actions)
```

Request flow:

```
Host → slug            (tenantHost.ts, already built)
  → platform DB        resolve slug → tenant_id, status, subscription
  → runWithTenant(id)  (already built)
  → getDatabase()      returns THAT tenant's connection  ← the only new routing
runWithoutTenant()     → platform DB
Desktop: initFixedTenantContext(1) → its one local file, unchanged
```

**Databases are named by tenant `id`, never by slug**, so a slug rename stays free.

The four tables with no `tenant_id` today — `tenants`, `sync_queue`, `sync_errors`,
`schema_migrations` — are the natural control-plane set (`schema_migrations` exists
per file as well).

---

## 4. Phase 0 — the compatibility spike (BLOCKING)

Turso is a *server-mediated* SQLite. LiraTek is built on SQLite internals. Three
findings from the vendor docs say this must be measured before it is committed to,
not after.

### 4.1 `db.pragma()` is not supported by `libsql`

The `libsql` Node package is a synchronous, better-sqlite3-compatible driver
(so the earlier "async only, like Postgres" objection was **wrong**), but its API doc
marks `db.pragma()` — plus `backup()` and function registration — unsupported.

**23 production call sites** (75 including tests):

| Pragma | Uses | Consequence if unavailable |
| --- | --- | --- |
| `foreign_keys = ON` | 4 | Referential integrity across 68 tables |
| `foreign_key_check` | 4 | Migration verification |
| `foreign_keys = OFF` | 2 | **The migration runner brackets every batch with this** — it is what makes v172's table rebuild possible |
| `defer_foreign_keys = ON` | 1 | `deleteTenantCascade` |
| `table_info(...)` | 4 | `tenantScopedTables()`, `tableExists`, migrations |
| `journal_mode = WAL`, `busy_timeout`, `synchronous`, `cache_size`, `wal_checkpoint` | 8 | Server-managed remotely; likely moot |

Many are mechanically rewritable as `db.prepare("PRAGMA …")`. The question is not
syntax, it is **whether the engine honours them**.

### 4.2 Foreign keys are OFF by default and per-connection

libSQL documents foreign keys as **disabled by default**, enabled per *connection*
via `PRAGMA foreign_keys=ON`, and **not togglable inside a multi-statement
transaction**. Vendor discussion notes this is awkward on a server model, where a
session is not guaranteed to be one connection.

This is the single most dangerous finding. If FK enforcement is off or
non-deterministic, orphaned financial rows appear **with no error** — the failure
mode this codebase spends the most effort preventing (rule 20, reversal symmetry).

### 4.3 Availability becomes coupled

Turso down ⇒ every shop's POS down. With local files only the VPS matters. For a POS
in Lebanon that is a real regression in the failure model, and it should be an
accepted trade rather than a discovered one.

### 4.4 The gate: point the existing test suite at Turso

Do not argue compatibility — measure it with the suite that already exists. The core
suite is **3061 tests over 295 suites**, most of it money code, and it already
supports injection via the documented `__LIRATEK_TEST_DB__` global.

Spike tasks:

1. Create a throwaway Turso database. Add `libsql` and open it with the
   better-sqlite3-compatible API.
2. Run `create_db.sql` + all 174 migrations against it. **v172 (table rebuild) and
   v174 (`ROW_NUMBER()` window function) are the interesting ones.**
3. Point `__LIRATEK_TEST_DB__` at it and run the full core suite.
4. Targeted probes, each pass/fail:
   - a `db.transaction(fn)` that throws **rolls back** every statement;
   - inserting a child row with a bogus parent id **throws**;
   - FK enforcement still holds on the *next* statement and inside a transaction;
   - a `foreign_keys = OFF` bracketed table rebuild completes;
   - `VACUUM INTO` (or a documented substitute) produces a restorable file;
   - measured latency of a representative 10-statement checkout transaction from the
     intended VPS region.

**Exit criteria — all must hold:**

- core suite green (3061/3061);
- FK violations rejected, demonstrably;
- transaction rollback correct;
- migrations 1→174 apply cleanly;
- a checkout transaction completes within a budget the owner accepts.

**If the gate fails**, fall back to § 8 (local files on the VPS). The rest of this
plan is unchanged either way — that is deliberate: **Phases A–D are storage-agnostic.**

---

## 5. Hosting

The compose stack already exists (`docker-compose.yml`, `backend/Dockerfile`) and is
written for exactly this: one backend replica, one volume, nginx in front, with the
single-writer constraint stated in its own comments.

### VPS options

| Provider | ~Price | Nearest useful region | Notes |
| --- | --- | --- | --- |
| **Hetzner** CX22 / CAX11 (ARM) | €4–5/mo | Falkenstein, Nuremberg, Helsinki | Best price/performance; EU + US only |
| **Vultr** | $5–6/mo | **Dubai** | Closest to Beirut of the mainstream providers |
| **DigitalOcean** | $6/mo | Frankfurt, Amsterdam | Simplest UI, easy snapshots |
| **Linode / Akamai** | $5/mo | Frankfurt | Comparable to DO |
| **Fly.io** | usage-based | Frankfurt, Amsterdam | Volumes work, but its many-small-VMs model fights single-writer SQLite; pin to one machine |
| **Railway / Render** | $5–20/mo | EU | Managed PaaS with disks; less control, more money |

**Region rule, and it changes with the Phase 0 outcome:**

- **If Turso is the store**: co-locate the VPS with the Turso primary region. Every
  query crosses that link, so VPS↔Turso latency dominates end-user latency.
- **If local files**: pick for proximity to Lebanon (Vultr Dubai, else Frankfurt).

*Assumption (unverified): Turso primary regions map to AWS regions including
Frankfurt. Confirm in the dashboard before choosing the VPS region.*

### Front door

Cloudflare **proxied** (orange cloud) in front of the VPS, with a **wildcard
`*.<domain>` A record**. One record covers every tenant forever, and Universal SSL
covers one wildcard level — which **retires `tenantDomains.ts` per-tenant DNS
provisioning entirely**, plus the tunnel and the Vercel per-domain registration.

Caddy or nginx terminates TLS at the origin; the backend keeps trusting one proxy hop
so `req.hostname` stays the original Host (`DEPLOYMENT.md` § 8 explains why that is
load-bearing for tenant resolution).

---

## 6. Phases

| Phase | Work | Est. | Depends on |
| --- | --- | --- | --- |
| **0** | Compatibility spike + decision (§ 4) | ~1 day | Turso account ✅ |
| **A** | Tenant-aware `getDatabase()`: connection map keyed by tenant id, migrate-on-open, idle close. Failing-first tests. | ~1 day | 0 |
| **B** | Control-plane split: `tenants`, `tenant_subscriptions`, super-admin users/sessions, platform audit. **Touches login, impersonation, subscriptions.** | 2–3 days | A |
| **C** | Provisioning creates a tenant database from `create_db.sql` + migrations + config seed + first admin. Tenant delete becomes "archive the file" — the 68-table cascade becomes unnecessary. | ~1 day | A, B |
| **D** | Move CornerTech: current file becomes tenant 1; extract control-plane rows. Trivial at N=1. | hours | C |
| **E** | Hosting: VPS, compose up, Caddy TLS, Cloudflare proxied + wildcard DNS, tunnel retired. | ~1 day | D |
| **F** | Durability: continuous backup per tenant database, encrypted, off-machine. Managed by Turso if Phase 0 passes; otherwise § 8. | ~1 day | E |

### Invariants to enforce, not assume

- **Every tenant database is migrated on open.** The schema-shape caches (§ 2.3) are
  only safe if no file lags a version. A lagging file plus a cache asserting a column
  exists is a live bug class.
- **One tenant's failed migration must not take down the others.** Isolate per file,
  log loudly, keep serving the rest.
- **Phase B is the security-sensitive one.** Every step gets a test that fails first
  (rule 17).

---

## 7. Cost

| Item | Monthly |
| --- | --- |
| VPS (Hetzner CX22 / Vultr) | ~$5–6 |
| Turso Developer (unlimited databases, 9 GB, 25 M row writes) | $4.99 |
| Domain | ~$1 |
| Cloudflare proxy, Universal SSL | $0 |
| **Total** | **~$11/mo** |

Free tier allows 100 databases and 5 GB, which covers development and the first
tenants. Current database size: **1.2 MB**.

---

## 8. Fallback if Phase 0 fails

Local SQLite files on the VPS volume, one per tenant, under `/data/tenants/<id>.db`.

- Zero driver change, zero pragma rewrite, full SQLite semantics, no network inside a
  money transaction, and no third party that can take every shop offline.
- Durability becomes ours: **Litestream** (Linux-supported; continuous replication,
  worst-case loss in seconds) plus the scheduled `VACUUM INTO` snapshot already built
  and tested this session, encrypted, to Cloudflare R2.
- *Assumption (unverified): Litestream's config is a static list of databases, so
  dynamically created tenant files need config regeneration on provisioning. The
  snapshot path has no such constraint.*

Phases A–D are identical in this branch. Only the connection string and Phase F
change — which is why the spike is cheap to lose.

---

## 9. Open questions

1. Turso primary regions available, and which is closest to the chosen VPS.
2. Whether Turso enforces foreign keys per connection reliably enough for the
   migration runner's `foreign_keys = OFF` bracket (Phase 0.4).
3. Whether `libsql` can serve the **desktop** app too (it supports local files, and
   libSQL has native encryption at rest, which would also answer the SQLCipher gap
   — `supported: false` in the current build). Deferred: swapping the driver under
   paying desktop customers is its own risk, and not required by anything here.
4. Backup encryption keys: where they live and who can restore.
