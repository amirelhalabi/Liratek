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
| ~~Turso Cloud as the hosted database~~ | **DROPPED after Phase 0**, 2026-09-09 | Compatible, but reads cost a network round-trip each and this data layer is deliberately chatty; embedded replicas fix reads yet keep a local file anyway, leaving managed durability as the only gain — bought with network-bound writes and an availability coupling. § 4bis has the measurements. |
| **Local SQLite files on the host, one per tenant** | Yes | Reads *and* writes at ~0.1 ms, zero data-layer change, no third party that can stop shops selling. Durability via Litestream → R2 plus the snapshot built this session. |
| **Fly.io for compute** (`fra`), SPA stays on Vercel | Owner's decision, 2026-09-09 | Backend off the laptop. Runbook: `docs/DEPLOYMENT.md` § 4d, config in `fly.toml`. Cutover is one DNS record on `api.liratek.shop`. |
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

## 4bis. Phase 0 RESULTS (measured 2026-09-09)

Ran against a real Turso database, `liratek-spike-amir619h.aws-eu-west-1.turso.io`
(AWS Ireland), with the `libsql` driver on Windows. **From the owner's laptop in
Lebanon**, so every figure below includes a ~150–200 ms Beirut→Ireland hop and is
**not** the production number. The *ratios* generalise; the absolutes do not.

### Compatibility: PASS — and the vendor docs are wrong

Every blocker in § 4.1 and § 4.2 evaporated on contact:

| Concern from the plan | Measured |
| --- | --- |
| `db.pragma()` unsupported | **Works.** Returned `[{"foreign_keys":1}]` |
| Foreign keys OFF by default | **Already ON**, and enforced |
| FK enforcement per-connection / unreliable | Orphan insert rejected with `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`, and **still enforced on later statements** |
| Transaction rollback | **Correct** — a throw mid-transaction left 0 of 1 rows; an FK violation rolled the whole transaction back |
| `foreign_keys = OFF` rebuild bracket (v172) | **Works**, and the pragma restores to ON afterwards |
| `defer_foreign_keys` (`deleteTenantCascade`) | Accepted |
| `ROW_NUMBER()` (v174), partial unique index, `COLLATE NOCASE`, `table_info` | All work |

So § 4.1/§ 4.2 are **withdrawn**. The `libsql` API doc marking `pragma()`
unsupported is stale.

### The one hard incompatibility: no VACUUM, no checkpoint

```
VACUUM INTO ?                  → SQL_PARSE_ERROR "SQL not allowed statement"
VACUUM                         → Sqlite3UnsupportedStatement
PRAGMA wal_checkpoint(TRUNCATE)→ Sqlite3UnsupportedStatement
```

**`BackupService` cannot run against a Turso database.** The consistent-snapshot
path built this session works only on a local file. For Turso-hosted tenants,
backups must come from Turso's own managed backup / point-in-time restore (or
`turso db dump`), not from our code. The desktop app is unaffected — it stays on
`better-sqlite3` with a local file.

### The real problem: latency amplification

| Workload | Remote only | Embedded replica |
| --- | --- | --- |
| 50 sequential `SELECT`s | **9 829 ms** (196.6 ms each) | **4 ms** (0.1 ms each) |
| 1 `SELECT` returning 200 rows | 316 ms | 1 ms |
| 10-write transaction (a checkout) | 3 554 ms | **8 019 ms** |
| 10 individual writes | 5 288 ms | 10 590 ms |
| initial replica sync | — | 19 977 ms |

Three things to take from this:

1. **Reads are the danger, not writes.** LiraTek's repositories are written for a
   zero-latency local file and issue many small sequential statements — free with
   `better-sqlite3`, one network round-trip each on Turso. A report doing 200 reads
   costs 200 round-trips. This is a property of the data layer, not of Turso.
2. **Embedded replicas fix reads completely** — 0.1 ms, i.e. as fast as today, a
   ~2 000× improvement. That is the mitigation, and it works.
3. **Embedded replicas make writes WORSE** (8.0 s vs 3.6 s for the same
   transaction), because a write forwards to the primary and then syncs back. Writes
   are network-bound in both modes and no local caching changes that.

### The uncomfortable implication

With embedded replicas you keep a **local database file on the server anyway** — so
you have not escaped local state, you have added a sync dependency on top of it. At
that point Turso's marginal value over § 8 is *managed durability and branching*,
bought with a write path that is network-bound and an availability coupling where
Turso being down stops every shop selling.

### What is still unknown, and it decides this

Everything above was measured from Lebanon. **The production question is what these
numbers look like from a backend co-located with `eu-west-1`.** Scaling by RTT alone,
a 10-write checkout would land somewhere in the low hundreds of milliseconds — but
that is arithmetic, not a measurement, and writes behaved non-linearly here.

**Next action: run the same two probes from a machine in the target region** (Fly
`lhr` is nearest to AWS `eu-west-1`; Fly has no Ireland region). Cheap, and it is the
only thing that turns this decision from an estimate into a fact.

Acceptance budget to agree beforehand: a checkout must commit within **X ms** at the
99th percentile. Without a number agreed up front, any measurement will get argued
into acceptability.

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
