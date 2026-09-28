# Production Database & Hosting Plan

> **Status (2026-09-28)**: Phases 0, A, B, C ✅ **shipped** — commits `4dcd16c0`, `161dd1c0`,
> `a4c791d4`, `7c150b2f`, all pushed and deployed; CI green; desktop e2e 315/315 green (v187 safe
> on desktop). Production runs **`TENANT_DB_MODE=shared`** (verified on the machine: env unset,
> `/data/tenants` empty, schema v187). The split was **dry-run on a production snapshot**
> (2026-09-28): `ok`, 70 tables × 2 shops match, 0 FK violations, boot guards pass — after two
> real-data fixes (§ 12.7). **Only Phase D remains** (runbook § 12.4), incl. the Litestream
> restore drill (unverified until run). Owner schedules it.
> Blocks `docs/plans/todo_plans/OFFLINE_DESKTOP_FALLBACK_PLAN.md` (its Step 1).
> **Written**: 2026-09-09. Supersedes the "one shared file" assumption in
> `MULTI_TENANT_IMPLEMENTATION_PLAN.md`.
> Companion docs: `docs/OPERATIONS.md` (what is live), `docs/DEPLOYMENT.md` § 4d
> (Fly runbook).
>
> Historical sections, kept for their reasoning, not for their instructions:
> § 4 (the spike's premises), § 5 (VPS options — superseded by Fly), § 7 (cost
> still counts Turso), § 9 items 1–2 (Turso questions, moot).

---

## 1. What is decided

| Decision                                            | Owner's call                          | Why                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One database file per tenant**                    | Yes                                   | See § 2. Reverses the earlier "shared file + `tenant_id` filter" recommendation.                                                                                                                                                                                                                     |
| **A separate control-plane database**               | Yes                                   | `tenants`, `tenant_subscriptions`, super-admin users/sessions, platform audit.                                                                                                                                                                                                                       |
| **Backend leaves the owner's laptop**               | Yes                                   | Power and internet in Lebanon must not be a dependency of other people's shops.                                                                                                                                                                                                                      |
| **Cloudflare Tunnel retired for production**        | Yes                                   | It exists to reach a machine that should not be the server.                                                                                                                                                                                                                                          |
| ~~Turso Cloud as the hosted database~~              | **DROPPED after Phase 0**, 2026-09-09 | Compatible, but reads cost a network round-trip each and this data layer is deliberately chatty; embedded replicas fix reads yet keep a local file anyway, leaving managed durability as the only gain — bought with network-bound writes and an availability coupling. § 4bis has the measurements. |
| **Local SQLite files on the host, one per tenant**  | Yes                                   | Reads _and_ writes at ~0.1 ms, zero data-layer change, no third party that can stop shops selling. Durability via Litestream → R2 plus the snapshot built this session.                                                                                                                              |
| **Fly.io for compute** (`fra`), SPA stays on Vercel | Owner's decision, 2026-09-09          | Backend off the laptop. Runbook: `docs/DEPLOYMENT.md` § 4d, config in `fly.toml`. Cutover is one DNS record on `api.liratek.shop`.                                                                                                                                                                   |
| **Desktop app unchanged**                           | Yes                                   | Stays offline-first on a local file with `better-sqlite3`. Non-negotiable: an offline till is the product.                                                                                                                                                                                           |

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

   **⚠ CORRECTED 2026-09-27 — "nothing caches a handle" is false.** 14 repositories
   store a handle in a field, and 13 of them are process-wide singletons (the 14th,
   `LotoRepository`, fans one handle out to five sub-repositories). Under per-tenant
   routing, a singleton built while shop 1 was active would keep serving shop 1's file
   to every shop: a cross-tenant leak with no error. Removing that capture is Phase A
   work, see § 11.2.

3. **The process-wide caches are schema-shape only** — `tableExistsCache`,
   `_hasCommissionModelColumnCache`, `_hasSettlementAllocationsTableCache`. They cache
   _"does this column exist"_, not data, and are identical across tenants **provided
   every tenant file is at the same migration version**. That is an invariant to
   enforce (§ 6), not a blocker.

Gains: no cross-tenant write lock; blast radius of any bug is one shop; per-shop
backup/restore is a file operation; a shop can move between desktop and web by
copying its file; and placement becomes possible — no query joins across tenants, so
nothing forces all tenants onto one node.

**Timing is the strongest argument: there is exactly one real tenant today.** The
current file _is_ CornerTech's. Splitting now moves a handful of control-plane rows.
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

Turso is a _server-mediated_ SQLite. LiraTek is built on SQLite internals. Three
findings from the vendor docs say this must be measured before it is committed to,
not after.

### 4.1 `db.pragma()` is not supported by `libsql`

The `libsql` Node package is a synchronous, better-sqlite3-compatible driver
(so the earlier "async only, like Postgres" objection was **wrong**), but its API doc
marks `db.pragma()` — plus `backup()` and function registration — unsupported.

**23 production call sites** (75 including tests):

| Pragma                                                                              | Uses | Consequence if unavailable                                                                               |
| ----------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `foreign_keys = ON`                                                                 | 4    | Referential integrity across 68 tables                                                                   |
| `foreign_key_check`                                                                 | 4    | Migration verification                                                                                   |
| `foreign_keys = OFF`                                                                | 2    | **The migration runner brackets every batch with this** — it is what makes v172's table rebuild possible |
| `defer_foreign_keys = ON`                                                           | 1    | `deleteTenantCascade`                                                                                    |
| `table_info(...)`                                                                   | 4    | `tenantScopedTables()`, `tableExists`, migrations                                                        |
| `journal_mode = WAL`, `busy_timeout`, `synchronous`, `cache_size`, `wal_checkpoint` | 8    | Server-managed remotely; likely moot                                                                     |

Many are mechanically rewritable as `db.prepare("PRAGMA …")`. The question is not
syntax, it is **whether the engine honours them**.

### 4.2 Foreign keys are OFF by default and per-connection

libSQL documents foreign keys as **disabled by default**, enabled per _connection_
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
   - FK enforcement still holds on the _next_ statement and inside a transaction;
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
**not** the production number. The _ratios_ generalise; the absolutes do not.

### Compatibility: PASS — and the vendor docs are wrong

Every blocker in § 4.1 and § 4.2 evaporated on contact:

| Concern from the plan                                                       | Measured                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `db.pragma()` unsupported                                                   | **Works.** Returned `[{"foreign_keys":1}]`                                                                                 |
| Foreign keys OFF by default                                                 | **Already ON**, and enforced                                                                                               |
| FK enforcement per-connection / unreliable                                  | Orphan insert rejected with `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`, and **still enforced on later statements** |
| Transaction rollback                                                        | **Correct** — a throw mid-transaction left 0 of 1 rows; an FK violation rolled the whole transaction back                  |
| `foreign_keys = OFF` rebuild bracket (v172)                                 | **Works**, and the pragma restores to ON afterwards                                                                        |
| `defer_foreign_keys` (`deleteTenantCascade`)                                | Accepted                                                                                                                   |
| `ROW_NUMBER()` (v174), partial unique index, `COLLATE NOCASE`, `table_info` | All work                                                                                                                   |

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

| Workload                          | Remote only                  | Embedded replica       |
| --------------------------------- | ---------------------------- | ---------------------- |
| 50 sequential `SELECT`s           | **9 829 ms** (196.6 ms each) | **4 ms** (0.1 ms each) |
| 1 `SELECT` returning 200 rows     | 316 ms                       | 1 ms                   |
| 10-write transaction (a checkout) | 3 554 ms                     | **8 019 ms**           |
| 10 individual writes              | 5 288 ms                     | 10 590 ms              |
| initial replica sync              | —                            | 19 977 ms              |

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
that point Turso's marginal value over § 8 is _managed durability and branching_,
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

| Provider                       | ~Price      | Nearest useful region            | Notes                                                                                      |
| ------------------------------ | ----------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| **Hetzner** CX22 / CAX11 (ARM) | €4–5/mo     | Falkenstein, Nuremberg, Helsinki | Best price/performance; EU + US only                                                       |
| **Vultr**                      | $5–6/mo     | **Dubai**                        | Closest to Beirut of the mainstream providers                                              |
| **DigitalOcean**               | $6/mo       | Frankfurt, Amsterdam             | Simplest UI, easy snapshots                                                                |
| **Linode / Akamai**            | $5/mo       | Frankfurt                        | Comparable to DO                                                                           |
| **Fly.io**                     | usage-based | Frankfurt, Amsterdam             | Volumes work, but its many-small-VMs model fights single-writer SQLite; pin to one machine |
| **Railway / Render**           | $5–20/mo    | EU                               | Managed PaaS with disks; less control, more money                                          |

**Region rule, and it changes with the Phase 0 outcome:**

- **If Turso is the store**: co-locate the VPS with the Turso primary region. Every
  query crosses that link, so VPS↔Turso latency dominates end-user latency.
- **If local files**: pick for proximity to Lebanon (Vultr Dubai, else Frankfurt).

_Assumption (unverified): Turso primary regions map to AWS regions including
Frankfurt. Confirm in the dashboard before choosing the VPS region._

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

| Phase | Work                                                                                                                                                                                       | Est.     | Depends on | Status (2026-09-27)                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| **0** | Compatibility spike + decision (§ 4)                                                                                                                                                       | ~1 day   | —          | ✅ Turso dropped (§ 4bis)                                                                             |
| **A** | Tenant-aware `getDatabase()`: connection map keyed by tenant id, migrate-on-open, idle close. Failing-first tests.                                                                         | ~1 day   | 0          | ✅ Built (§ 11)                                                                                       |
| **B** | Control-plane split: `tenants`, `tenant_subscriptions`, super-admin users/sessions, platform audit. **Touches login, impersonation, subscriptions.**                                       | 2–3 days | A          | ✅ Built (§ 12)                                                                                       |
| **C** | Provisioning creates a tenant database from `create_db.sql` + migrations + config seed + first admin. Tenant delete becomes "archive the file" — the 68-table cascade becomes unnecessary. | ~1 day   | A, B       | ✅ Built (§ 12; migration v187 adds `provisioning` status)                                            |
| **D** | Move the live tenants (**CornerTech id 1, Test id 5**, not N=1) into `/data/tenants/<id>.db`; extract control-plane rows; flip the mode flag (§ 11.1).                                    | hours    | C          | ⬜ Next — runbook § 12.4, dry-run on a prod snapshot passed 2026-09-28                                |
| **E** | Hosting. **Done as Fly.io** (`fly.toml`, `fra`, one machine); tunnel out of the serving path. Remaining, optional: Cloudflare proxied + wildcard `*.liratek.shop`, retiring `tenantDomains.ts`. | —        | D          | ✅ core / ⬜ wildcard                                                                                 |
| **F** | Durability. **Litestream → R2 live** for the shared file, restore proven (§ 10). Remaining: switch `backend/litestream.yml` to the `dir` + `watch` layout, prove a restore from it, delete the `web/liratek` prefix. | ~½ day   | D          | ✅ single file / ⬜ per-tenant                                                                        |

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

| Item                                                         | Monthly     |
| ------------------------------------------------------------ | ----------- |
| VPS (Hetzner CX22 / Vultr)                                   | ~$5–6       |
| Turso Developer (unlimited databases, 9 GB, 25 M row writes) | $4.99       |
| Domain                                                       | ~$1         |
| Cloudflare proxy, Universal SSL                              | $0          |
| **Total**                                                    | **~$11/mo** |

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
- ~~Assumption: Litestream's config is a static list of databases, so dynamically
  created tenant files need config regeneration on provisioning.~~ **WRONG —
  checked 2026-09-09.** Litestream 0.5 replicates a DIRECTORY: `dir` + `pattern`
  - `watch: true` discovers a newly created database within seconds without a
    restart, and namespaces the replica by the file's relative path. So the
    per-tenant case needs no machinery at all — see § 10.

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

---

## 10. Backups — current state and the per-tenant shape

**LIVE since 2026-09-09.** Litestream 0.5.17 replicates `/data/liratek.db` to
Cloudflare R2 (`liratek-backups`, prefix `web/liratek`) with a 1 s sync interval,
alongside Fly's encrypted volume and its daily snapshots.

**A restore has actually been performed**, which is the only thing that makes a
backup real: pulled from R2 into a scratch file on the running machine —
`integrity_check ok`, schema v174, CornerTech present, 3 users, 18 transactions,
`shop_name` intact, live database untouched. Scripts kept in the session
scratchpad; the procedure is two commands (`litestream restore -o <tmp> <db>`
then open the copy read-only).

### One gotcha that cost real time

The bucket was created with **EU jurisdiction**, so it is reachable ONLY at
`https://<account>.eu.r2.cloudflarestorage.com`. The default endpoint returns
`403 AccessDenied` for the same bucket and the same credentials — which is
indistinguishable from a bad key. If replication ever fails with AccessDenied,
check the endpoint before the token.

### Per-tenant layout, once Phases A–D land

Keyed by tenant **id**, never by name or slug: a shop renaming itself (as
`default` → `cornertech` did) must not orphan its backup history.

```
liratek-backups/
  platform/          the control-plane database
  tenants/1.db/      one prefix per tenant database
  tenants/2.db/
```

Litestream produces that for free — it replicates a directory and namespaces
each replica by the file's relative path:

```yaml
dbs:
  - path: ${PLATFORM_DATABASE_PATH}
    replica: { type: s3, bucket: ${LITESTREAM_BUCKET}, path: platform, ... }

  - dir: /data/tenants
    pattern: "*.db"
    watch: true      # a new shop's database is replicated within seconds,
                     # with no config regeneration and no restart
    replica: { type: s3, bucket: ${LITESTREAM_BUCKET}, path: tenants, ... }
```

So provisioning stays a pure `getDatabase()` concern — nothing in the backup
layer has to be told a tenant was created. That is the main reason the earlier
worry about regenerating Litestream config is retired.

---

## 11. Phase A — design (2026-09-27)

**Goal:** `getDatabase()` returns the current tenant's own database file on the
web backend, and **nothing changes for anyone** until the mode flag flips at
Phase D. Desktop keeps exactly one file and `initFixedTenantContext(1)`.

### 11.1 Shape

- **Core keeps one seam.** `packages/core/src/db/connection.ts` gains
  `setDatabaseResolver(fn | null)`. `getDatabase()` becomes: test hook →
  resolver (if one is installed) → the single `db`, as today. Core does not know
  about tenants or files. It asks an injected strategy (dependency inversion).
  Desktop never installs a resolver, so its path doesn't change at all.
- **`TenantDatabasePool`** (new, `packages/core/src/db/tenantDatabasePool.ts`,
  exported from `index.ts` ONLY and never from `browser.ts`, since it uses `fs`
  (rule 29)). It is constructed with its dependencies injected: `dir`, an
  `openDatabase(path)` factory (applies pragmas and the SQLCipher key),
  `migrate(db)`, `maxOpen`, `idleMs`, a clock.
  - `get(tenantId)` → the cached connection, or open `<dir>/<id>.db`, run
    `migrate` once, cache it. Files are named by **id**, never slug.
  - **Missing file ⇒ throw, never create.** Creating a tenant database is
    provisioning (Phase C). A silently auto-created empty file would look like a
    shop that lost all its data.
  - **A failed migration poisons only that tenant:** log loudly, keep the error,
    throw it for that tenant's requests until restart. Every other tenant keeps
    serving (§ 6 invariant).
  - **Idle close** on a timer. It skips any handle with `db.inTransaction`.
    better-sqlite3 transactions are synchronous, so a close can never land
    mid-transaction from another request. `closeAll()` runs on shutdown.
- **Backend resolver** (`backend/src/database/connection.ts`) routes like this:
  - inside `runWithTenant(id)` → `pool.get(id)`;
  - inside `runWithoutTenant()` or with no scope → the **platform** database,
    which until Phase D is simply today's shared file.
- **Mode flag `TENANT_DB_MODE=shared|per-tenant`, default `shared`.** With
  `shared`, no resolver is installed and behaviour is byte-identical to today.
  Phase D moves the files, then flips the flag. **Rejected:** a hybrid "use the
  file if it exists, else the shared file". A failed file creation would then
  send one shop's writes into the shared file, silently.

### 11.2 Prerequisite refactor: remove the captured handles

Every repository must read its handle through a getter
(`protected get db() { return getDatabase(); }`, the `BaseRepository` pattern),
never store one. That covers the 14 repositories that currently capture a handle:

`CategoryRepository`, `ModuleRepository`, `PaymentMethodRepository`,
`ProductSupplierRepository`, `SettingsRepository` (constructor calls
`getDatabase()`); `CustomerSessionRepository`, `SubscriptionRepository`,
`SupplierPurchaseRepository`, `TenantRepository`, `LotoRepository` and its five
sub-repositories `LotoTicket/Settings/MonthlyFee/Checkpoint/CashPrize` (take a
`db` in their constructor).

Constructor `db` parameters that tests inject stay allowed as an explicit
override. The default must be the live getter, not a snapshot. Add a guard test
that fails when any `*Repository.ts` assigns `getDatabase()` to a field, so the
pattern can't come back.

Also delete the stale, git-tracked `packages/core/src/db/connection.js` (May, a
pre-`getDatabasePath` copy of `connection.ts`). Jest resolves `.ts` first today,
so it's harmless. Any resolver order change would make it shadow the real
module, and it would silently lack the resolver.

### 11.3 Tests: each written first and seen failing (rule 17)

1. A singleton repository built under tenant 1 returns tenant 5's data under
   `runWithTenant(5)`. **Fails today** because of § 11.2. This is the headline guard.
2. Two tenant files: a write under tenant 1 is invisible under tenant 5, and
   vice versa.
3. Two interleaved async "requests" across `await` points each keep their own
   connection.
4. A file at an older schema version is migrated before its first query.
5. A migration that throws on one file leaves the other tenant serving; the bad
   tenant gets its error, repeatably.
6. Missing tenant file ⇒ throws; no file is created on disk.
7. Bypass scope / no scope ⇒ platform database. With no resolver + a fixed
   tenant (desktop), behaviour is unchanged.
8. Idle close then reopen works; a handle inside a transaction is not closed.
9. `browserEntryIsNodeFree.guard` still passes (the pool is not reachable from
   `browser.ts`).

Gates: full `yarn test` (not core-only), `yarn typecheck`, `yarn lint`,
`yarn check:tenant-scoping`. No release note, because users see no change (rule 30).

### 11.4 Decision needed before building

**A-D1 — what `tenant_id` do rows carry inside a tenant's file?**
**DECIDED 2026-09-27 (owner): (a), keep the shop's real id.** This supersedes
§ 1's "always `1` per tenant file". Options kept below for the reasoning.

- **(a) Keep the shop's real id** (file `5.db` holds rows with `tenant_id = 5`).
  **Recommended.** Phase A then needs no change to tenant filtering. The existing
  `tenant_id` predicate stays a **second fence**: a routing bug that hands shop 5
  the wrong file returns zero rows instead of another shop's sales. Phase D's
  move is a plain copy. Cost: a desktop that mirrors a web file (offline plan)
  must set its fixed tenant from the file's own `tenants` row, not hardcode 1.
- **(b) Rewrite to 1**, as § 1 originally said. It gives byte-compatibility with
  desktop files, but every file then says `tenant_id = 1`, so the fence
  disappears: a mis-routed request is a silent cross-shop leak. It also needs a
  "row tenant id ≠ routing id" split in `tenantContext`, and a rewrite pass
  over every table at Phase D.

### 11.5 Explicitly not in Phase A

The control-plane split (B), provisioning (C), `BackupService` per tenant, the
Litestream layout (F), and cross-tenant admin reads such as
`TenantRepository.listAll()`'s "last activity" (a `MAX` over `transactions` and
`sessions` subqueries correlated on `t.id`). That query is
cross-tenant in the shared file and must become a per-file fan-out in Phase B.
It is listed here so it isn't discovered then.

---

## 12. Phases B–D — findings and design (2026-09-27)

Phase A is built (uncommitted at the time of writing): resolver hook, `TenantDatabasePool`,
`TENANT_DB_MODE` switch (default `shared`), live-handle refactor of 14 repositories, idle
sweep. Three read-only surveys then mapped everything B–D touches. **What breaks the
moment `TENANT_DB_MODE=per-tenant` is set today:**

| # | Break | Where |
|---|-------|-------|
| 1 | **Every shop login fails.** `authService.login()` runs with no tenant scope, so it searches the platform file | `backend/src/api/auth.ts:72` |
| 2 | **Every authenticated request 401s.** `validateSession()` runs before `runWithTenant()` | `backend/src/middleware/auth.ts:225` vs `:288` |
| 3 | "Signed-in devices" and revoke read the shop file, while sessions were written to the platform file | `SessionRepository` tenant-scoped methods |
| 4 | Impersonation 404s: the shop's admin is looked up in the platform file | `admin.ts:292` `findFirstActiveAdminByTenant` |
| 5 | Impersonation audit, and every action taken during impersonation, writes `impersonator_id` (FK → `users`) with a super-admin id that exists only in the platform file ⇒ FK violation | `create_db.sql` `audit_log.impersonator_id` |
| 6 | Subscription status + sidebar module filter read `tenant_subscriptions` from inside a shop scope | `api/subscription.ts:109`, `ModuleService.filterByEntitlement` |
| 7 | Plan editor's sellable-module list queries per-shop `modules` from the platform | `SubscriptionRepository.listSellableModuleKeys` |
| 8 | Admin tenants list (user count, last activity) correlates shop tables in one query | `TenantRepository.listAll` (also feeds `yarn ops`) |
| 9 | Provisioning writes the new shop's seed data into the platform file; `create_db.sql` seeds a `tenants(id=1)` row | `TenantProvisioningService`, `create_db.sql:24` |
| 10 | Delete runs the 68-table cascade against the platform file and reports success, deleting nothing | `deleteTenantCascade` |
| 11 | Litestream, the restore-on-empty-volume entrypoint and the deploy verifier know one file only | `backend/litestream.yml`, `docker-entrypoint.sh`, `scripts/deploy-api.mjs` |

**Pre-existing bug found (independent of the split):** subscription-change and
license-key audit rows are **never written**. `auditRest()` runs outside any tenant
scope, `getCurrentTenantId()` throws, and `AuditService` swallows it
(`admin.ts:462-585`).

Confirmed fine: database reset (already scoped to the calling shop), health routes,
lapse sweep, `requireWritableSubscription` (runs pre-scope → platform, where
subscriptions live), websocket, web backup (not wired on web at all yet).

### 12.1 Owner decisions (2026-09-27)

| # | Decision |
|---|----------|
| B-D1 | **Shop sessions live in the shop's file.** The session check routes by the JWT's signed `tenantId` claim (null ⇒ platform). Super-admin sessions stay in the platform file. |
| B-D2 | **Web login must come through a shop subdomain (or www for super-admin).** In per-tenant mode the "search every shop for this username" fallback refuses. It stays for single-file mode, so desktop is unaffected. |
| B-D3 | **Platform audit log + a note in the shop.** Admin actions are recorded in the platform file's `audit_log` with `tenant_id NULL` (nullable already, so no migration) and the target shop in metadata. The shop's own `audit_log` gets a row with `impersonator_id NULL` and the admin's username as text. Fixes the pre-existing dropped-audit bug in the same change. |
| B-D4 | **Deleting a shop archives its file** to `/data/tenants/archive/<id>-<timestamp>.db`. Purging archives is a manual step. |

### 12.2 Design defaults (not owner decisions; change on request)

- **The platform file is today's `liratek.db`, keeping the full schema** (same
  migrations everywhere, no second schema to maintain). After Phase D it holds only:
  `tenants`, `tenant_subscriptions`, super-admin users (`tenant_id NULL`), their
  sessions, and platform audit rows.
- **Each shop file keeps one local `tenants` row at its real id.** 70 tables have
  `tenant_id REFERENCES tenants(id)`, and SQLite foreign keys are per file. That row
  is a mirror; the platform row is the truth.
- **Cross-shop reads become a fan-out:** list the shop ids (from the pool's
  directory), then `runWithTenant(id, …)` for each. At N=2 the cost is trivial.
  Revisit with cached stats if N grows large.
- **Sellable modules come from the `MODULE_SEED_ROWS` constant,** not a query.
- **Every shop file is migrated at boot,** not only on first request. That makes the
  deploy verifier meaningful. A failure is logged for that shop and not fatal.
- **Provisioning runs in two steps with cleanup,** since no transaction can span two
  files. First a platform transaction inserts `tenants` (status `provisioning`) +
  `tenant_subscriptions`. Then the shop file is built at a temp path
  (`create_db.sql` with the id-1 seeds corrected, `runMigrations`, config seed, first
  admin), renamed atomically into place, and the status flipped to `active`. On
  failure the temp file and the platform rows are removed.

### 12.3 Build order

**Wave 1 (parallel, disjoint files):**
- **W1 Auth & sessions:** login scoped by realm (B-D2), session check scoped by the
  JWT claim (B-D1).
- **W2 Control plane:** subscription reads forced to platform scope, sellable modules
  from the constant, the whole `admin.ts` (impersonation lookups/session in the shop
  scope, B-D3 audit rework incl. `impersonator_id`), the dropped-audit fix.
- **W3 Database operations:** shop-id listing contract, boot-time migrate-all,
  Litestream `dir` config, entrypoint restore of the tenant directory, deploy
  verifier, and the Phase D split script (tested on a copy of real data).

**Wave 2:**
- Phase C provisioning + archive-on-delete.
- `listAll` + session-sweep fan-out.
- A backend integration test that boots in per-tenant mode and exercises login →
  request → impersonate → provision → delete end to end.

**Phase D (owner-scheduled):**
1. Short maintenance window.
2. Run the split script.
3. Set `TENANT_DB_MODE=per-tenant`.
4. Deploy and verify.
5. Prove a restore from the new layout, then retire the `web/liratek` prefix.

### 12.4 Phase D runbook (W3, 2026-09-27)

What W3 built for this: the shop-id listing contract
(`packages/core/src/db/tenantDatabaseIds.ts`), boot-time migrate-all
(`backend/src/database/migrateAllTenants.ts`, wired into
`connection.ts`), the Litestream `dir` replica for the tenants directory
(`backend/litestream.yml`), a restore-on-empty-volume attempt for tenant
files (`backend/docker-entrypoint.sh`), a deploy-verifier check for the
per-tenant boot marker (`scripts/deploy-api.mjs`), and the split tool itself
(`packages/core/src/db/tenantSplit.ts` + the CLI wrapper,
`backend/src/scripts/tenantSplitCli.ts`). None of it runs, changes behaviour,
or is invoked automatically — every command below is something an operator
types by hand, on purpose, since Phase D itself is owner-scheduled.

**W5 (§ 12.3 wave 2) added, on top of the above:** the session sweep
(`deleteExpiredSessions`/`deleteInactiveSessions`) now fans out across the
platform file and every tenant file in per-tenant mode instead of only ever
running against one file — `SessionSweepService`
(`packages/core/src/services/SessionSweepService.ts`), scheduled from
`backend/src/services/sessionSweep.ts` the same way `lapseSweep.ts` already
schedules the subscription lapse timer; the entrypoint's restore step no
longer needs `TENANT_DATABASE_IDS_HINT` for the common case — it derives the
id list itself from the platform file's own `tenants` table
(`backend/src/scripts/listTenantIds.ts`, § 12.4's runbook updated above); and
the split tool now hard-fails (`ok: false`, nothing written) instead of
silently copying a table wholesale into every shop file when that table has
no `tenant_id` column and isn't on the known-global allowlist, or when its
name isn't a safe SQL identifier (`packages/core/src/db/tenantSplit.ts`,
guarded by failing-first tests in `tenantSplit.test.ts`).

**Two guards close the gap this runbook existed to prevent: flipping
`TENANT_DB_MODE=per-tenant` WITHOUT running the split above first.** Before
this, that mistake left `/data/tenants` empty (every shop request fails —
"no database file for tenant N") while the boot summary said
`{ok:0, failed:0}` and the deploy verifier PASSED, because there was
nothing to migrate when nothing was found.

1. **Safety lock** (`packages/core/src/db/platformSplitGuard.ts`'s
   `checkPlatformSplitStatus()`, called from `installTenantDbRouting()` in
   `backend/src/database/connection.ts` before anything per-tenant is
   installed). Reuses the split tool's own `discoverTenantScopedTables()` /
   `quoteIdent()` to check whether the platform database still holds rows
   with a non-NULL `tenant_id` in any tenant-scoped table (excluding
   `tenant_subscriptions`, which legitimately keeps real tenant ids in the
   platform file both before and after the split). If it does, the split
   has not run: per-tenant routing is REFUSED — the resolver/lister/
   provisioner are never installed, so the app behaves EXACTLY like
   `shared` mode and every shop keeps working off the platform file — and
   one ERROR line is logged: `Per-tenant mode REFUSED: platform database
   still holds shop data — run the Phase D split first`, with
   `{ tablesWithShopRows, totalRows }`. It never throws: a crash-loop on
   this single Fly machine would itself take every shop offline, which is
   the exact outcome this exists to prevent. `scripts/deploy-api.mjs` hard-
   fails the deploy on that marker line.
2. **Completeness check** (`backend/src/database/tenantCompletenessCheck.ts`,
   called right after `migrateAllTenants()` in the same function). Compares
   the platform's own `tenants` registry (`active`/`suspended` = expected to
   have a file; `provisioning` and `archived` are excluded from that — see
   the module header) against the ids the directory lister actually found.
   The `"Tenant databases migrated"` boot line now also carries `missing`
   and `missingIds`; a non-zero `missing` count is an ERROR (an expected
   shop has no file at all — `migrateAllTenants()` alone can never notice
   this, since it only ever loops over ids that WERE found). Tenants stuck
   in `provisioning`, and files with no matching platform row at all
   (orphans), are logged as warnings only, never a failure.
   `scripts/deploy-api.mjs` (via `scripts/lib/tenantMigrationLogCheck.mjs`)
   fails the deploy on a non-zero `missing` count, and — since an older boot
   log that predates this check has no `missing` field at all and so can't
   be trusted either way — on that shape too.

Both are read-only checks against an already-open connection; neither
changes anything on disk, and both are complete no-ops in `shared` mode
(the branch they run in is never reached at all).

**Before starting:** confirm which tenant ids actually exist —
**Assumption (unverified): this doc's header says shops today are ids 1
(CornerTech) and 5 (Test), but treat that as a hint, not ground truth.**
Check it live:

```bash
yarn api:ssh
  cd /app/backend
  node -e "const d=require('/app/node_modules/better-sqlite3');const b=new d('/data/liratek.db',{readonly:true});console.log(b.prepare('SELECT id, name, slug, status FROM tenants ORDER BY id').all())"
```

**Step-by-step:**

1. **Maintenance window.** Put the shop(s) on notice; the split itself takes
   seconds per tenant on data this size, but the whole procedure (snapshot,
   split, inspect, move, deploy, verify) is not something to do live.

2. **Snapshot on the machine — never touch the live file directly:**

   ```bash
   yarn api:ssh
     cd /data
     node -e "const d=require('/app/node_modules/better-sqlite3');const b=new d('/data/liratek.db',{readonly:true});b.exec(\"VACUUM INTO '/data/liratek-split-source.db'\")"
   ```

   (A plain `cp` of a live WAL-mode SQLite file is not a valid snapshot on
   its own — `VACUUM INTO` is the same technique `docs/DEPLOYMENT.md` § 4d's
   original migration used, and it is guaranteed consistent because SQLite
   itself produces it.)

3. **Run the split tool against the snapshot, dry run first:**

   ```bash
   node backend/dist/scripts/tenantSplitCli.js /data/liratek-split-source.db /data/split-out
   ```

   Read the JSON report. `ok: true` and an empty `unexpectedGlobalRows` are
   the gate — do not proceed past a `false` without understanding exactly
   why (an unexpected global row is a real finding: some table has a
   `tenant_id IS NULL` row nobody accounted for; decide by hand whether it
   belongs in the platform file or is a bug, this tool will never guess).

4. **Run it for real:**

   ```bash
   node backend/dist/scripts/tenantSplitCli.js /data/liratek-split-source.db /data/split-out --write
   ```

   Re-read the report: `ok: true`, `mismatches: []`, every `fileChecks` entry
   `foreignKeyViolations: 0` and `integrityCheck: "ok"`.

   **If `foreignKeyViolations` is non-zero for a file**, that file's own
   `foreignKeyViolationRows` (capped at the first 50 — `foreignKeyViolations`
   itself is always the exact total, never capped) now names each offending
   row: which table holds the dangling reference, its `rowid`, and which
   parent table the missing row was expected in. This means the split
   narrowed some table to one tenant's rows while another table that tenant
   kept still points at a row that belonged to a DIFFERENT tenant and got
   deleted out from under it — e.g. a shop-5 transaction whose `client_id`
   references a client that only ever belonged to shop 1. **Do NOT proceed
   past this** — moving a file with a dangling FK into `/data` ships a
   database `PRAGMA integrity_check` already flagged as broken. Decide, per
   listed row: is the reference itself wrong (a bug to fix in the shared
   source file before re-splitting), or does it point at data that
   legitimately needs to be duplicated/reassigned first? Either way, fix the
   *shared* source file (never the split output — the output is disposable,
   re-run from step 2's snapshot once the source is fixed), then repeat from
   step 2.

   **`droppedReplicationTables` listing `_litestream_seq`/`_litestream_lock`
   is expected, not a finding** — production runs Litestream, which creates
   these two bookkeeping tables inside every database it replicates; the
   split drops them from every output file (they carry no `tenant_id` and are
   not shop data) and Litestream recreates them on its own the moment it
   starts replicating `/data/liratek.db.new`/`/data/tenants/<id>.db`. An
   EMPTY `droppedReplicationTables` on a source that Litestream has been
   replicating is the surprising case, not a full one.

   **`rewrittenLegacyImpersonatorRows` listing one or more `audit_log` rows
   is also expected, not a finding** — an impersonation-start row written
   before 2026-09-27 (B-D3) put the PLATFORM super admin's id directly in
   the tenant-scoped `impersonator_id` FK column; the split now rewrites
   each one to the current shape (`impersonator_id NULL`, the impersonator's
   id/username folded into `metadata`) instead of failing on the dangling
   reference. Production has exactly one such row as of this writing (the
   Test shop, tenant 5, dated 2026-09-09) — confirm the count you see here
   matches what you expect before moving on; anything else the FK check
   flags is a REAL problem and follows the paragraph above, not this one.

5. **Inspect the report**, then move the files into place (the tool refuses
   to write into `/data` directly — it only ever writes into an empty output
   directory you gave it, so this move is a separate, deliberate step):

   ```bash
   mv /data/split-out/platform.db /data/liratek.db.new
   mkdir -p /data/tenants
   mv /data/split-out/tenants/*.db /data/tenants/
   # Swap the platform file in. Stop the app first (fly machine stop), or
   # accept a brief blip — there is no way to hot-swap the file the running
   # process has open.
   mv /data/liratek.db /data/liratek.db.pre-split-backup
   mv /data/liratek.db.new /data/liratek.db
   rm -f /data/liratek.db-wal /data/liratek.db-shm  # stale WAL beside a
                                                     # DIFFERENT file is how a
                                                     # restore corrupts (§ 4d)
   ```

6. **Set `TENANT_DB_MODE=per-tenant`** (Fly secret, triggers a machine
   update on its own — no separate deploy needed for the env var alone):

   ```bash
   yarn api -- secrets set TENANT_DB_MODE=per-tenant
   ```

7. **Deploy and verify:**

   ```bash
   yarn api:deploy
   ```

   The verifier (`scripts/deploy-api.mjs`) now also looks for the
   `"Tenant databases migrated"` boot line and hard-fails if its `failed`
   count is non-zero — this only fires once the app is actually in
   `per-tenant` mode, so it is silent (and correctly so) on every deploy
   before this one.

8. **Prove a restore, from the NEW layout** (extends the existing drill in
   `docs/OPERATIONS.md` — same idea, one file per tenant now):

   ```bash
   yarn api:ssh
     cd /app/backend
     litestream restore -o /tmp/check-platform.db /data/liratek.db
     litestream restore -o /tmp/check-tenant5.db /data/tenants/5.db
     node -e "const d=require('/app/node_modules/better-sqlite3');for (const p of ['/tmp/check-platform.db','/tmp/check-tenant5.db']){const b=new d(p,{readonly:true});console.log(p, b.pragma('integrity_check')[0].integrity_check)}"
     rm /tmp/check-platform.db /tmp/check-tenant5.db
   ```

   **UNVERIFIED beyond this point** (no real R2 bucket or Fly machine was
   available to this session): whether `litestream restore` correctly
   resolves a `dir`-configured replica for a database path that does not yet
   exist locally, the way it resolves a single `path`-configured one. If a
   real disaster-recovery drill (restoring `/data/tenants/<id>.db` on a
   volume where it was never present) behaves differently than the command
   above, this runbook and `docker-entrypoint.sh`'s per-tenant restore block
   need a second pass informed by that result — do not assume this section
   is battle-tested. The entrypoint now derives the tenant id list on its own
   whenever `DATABASE_PATH` exists (`dist/scripts/listTenantIds.js`, reading
   the platform file's own `tenants` table — W5, § 12.3 wave 2), so
   `TENANT_DATABASE_IDS_HINT` is only still needed when `DATABASE_PATH`
   itself is missing too (a genuinely empty volume, nothing on the box to
   derive ids from) or to force a specific list for a one-off drill; set it
   (see `docker-entrypoint.sh`'s comment) before restarting the machine.

9. **Retire the `web/liratek` prefix** — once step 8 is proven and a few
   days have passed with `per-tenant` mode stable, the old single-file
   replica prefix (`platform` is now the live one) can be deleted from R2.
   Not urgent, and not reversible — keep it until you are confident.

**Rollback**, if step 6/7 goes wrong before step 9: set
`TENANT_DB_MODE=shared` back, restore `/data/liratek.db.pre-split-backup`
over `/data/liratek.db` (delete its `-wal`/`-shm` first), redeploy. The
shared-mode code path was never touched by any of this, so it is exactly as
reliable as it was before Phase D started.

**Any data entered during the per-tenant window before this rollback is
discarded, not merged — there is no tool to recover it.** Every write made
against `/data/tenants/*.db` while the app ran in per-tenant mode simply
isn't in `liratek.db.pre-split-backup`, and nothing in this repo reconciles
the two afterward (verified directly by the rehearsal below: a post-split
client creation survives in the tenant file but is completely absent from
the restored shared file, with no merge path anywhere). **Rollback is a last
resort, not a routine undo; it is only clean before shops start working** —
once real shop activity has happened in per-tenant mode, rolling back means
choosing to lose it.

**Rehearsing this runbook.** `scripts/rehearsal/phase-d/` runs the whole
thing — split, boot, verify, rollback — against a COPY of the real desktop
DB, never the live file; see its `README.md` for the exact commands. One
Windows-only wrinkle showed up rehearsing there and is worth knowing before
you hit it on a real run too: **on Windows, close every open handle on the
split output (a DB browser, an editor, an antivirus scan) before moving the
files into place** — step 5's `mv`/`rename` fails with `EBUSY`/`EPERM` if
anything still has one of those files open, because Windows refuses to
rename a file out from under an open handle. **Not an issue on the real Fly
Linux host** this runbook actually targets — `rename`/`unlink` on Linux
never fails that way; the process can still have the old inode open and the
move still succeeds.

### 12.5 Fixed: id reuse after a platform-only restore (2026-09-27)

An adversarial review found that `createTenant()`
(`backend/src/database/perTenantStorageProvisioner.ts`) never checked
whether `finalPathFor(tenantId)` already existed before
`fs.renameSync(tempPath, finalPath)` — and `renameSync` silently REPLACES an
existing destination on both Windows and Linux. Because the platform file
and the `tenants/` directory are two SEPARATE Litestream streams (§ 12.4), a
platform-only restore rolls `tenants`' own `sqlite_sequence` back while shop
files newer than that snapshot are untouched on disk; the next ordinary
provisioning call would then reissue one of those ids and silently overwrite
that shop's live database with an empty new-tenant seed — no error, no log
line, nothing in the returned `TenantEntity`.

Fixed both layers: `createTenant()` now computes the highest tenant id with
any file on disk (live `<id>.db` under `tenantsDir`, or an archived
`<id>-<timestamp>.db` under `tenantsDir/archive/`) and raises `tenants`'
AUTOINCREMENT floor above it (`TenantRepository.raiseSequenceFloor`) inside
the SAME platform transaction, before the new row is inserted — so the id
handed out is already impossible to collide with anything on disk in the
ordinary case. An existence check immediately before the rename is the
belt-and-braces for that floor raise ever being bypassed: it refuses (throws)
rather than overwrites, and the failure path rolls back the platform rows and
deletes the temp file without ever touching a pre-existing file that belongs
to another tenant. Guarded by
`backend/src/__tests__/tenantIdReuseAfterRestore.guard.test.ts` (proven
failing-first per rule 17 against an isolated copy of the pre-fix code, never
by reverting the working tree) — Test 1 proves the floor raise (no throw, new
tenant lands on a new id, old shop untouched), Test 2 proves the
existence-check guard independently by simulating the floor raise being
bypassed.

### 12.6 Accepted: `tenantSplit.ts` copies `sqlite_sequence` wholesale (LOW, accepted 2026-09-27)

The one-time split tool (`packages/core/src/db/tenantSplit.ts`) copies
`sqlite_sequence` byte-identical into the platform file AND every tenant
file — it is SQLite's own bookkeeping table, excluded from both the
per-tenant DELETE loop and the unexpected-global-row hard-fail scan (both
filter on `name NOT LIKE 'sqlite_%'`). This means a split-produced shop file
(CornerTech, Test) reveals the platform-wide AUTOINCREMENT high-water mark
for every autoincrementing table, not just that tenant's own — a metadata
leak of every other tenant's total lifetime row counts to anyone with read
access to one shop's own file. **Accepted, not fixed**: resetting a
tenant file's `sqlite_sequence` down to that tenant's own counts risks
reissuing an id that was ever used and freed within that file (e.g. a
deleted/voided row's id), which risks colliding with a still-live row
elsewhere that FK-references the old id — a worse failure mode than the
metadata leak it would close. Revisit before the offline-desktop plan
(`docs/plans/todo_plans/OFFLINE_DESKTOP_FALLBACK_PLAN.md`) gives shops their
own file, since that plan's whole premise is a shop holding only its own
data. Characterized (not "unfixed bug") by
`packages/core/src/db/__tests__/tenantSplitSqliteSequenceLeak.characterization.test.ts`.


### 12.7 Production-snapshot dry run (2026-09-28)

A consistent snapshot of the live database (`VACUUM INTO` from a read-only connection on the
machine, downloaded with `flyctl ssh sftp get`, server copy deleted) was split locally with the
shipped tool. It surfaced two things synthetic data never had — both fixed in `7c150b2f`:

1. **Litestream's own tables** (`_litestream_seq`, `_litestream_lock`) tripped the unknown-table
   refusal. They are now dropped from every output file (Litestream recreates them) and listed
   in `droppedReplicationTables`.
2. **One legacy impersonation audit row** (Test shop, 2026-09-09, before B-D3) had the super
   admin's id in `audit_log.impersonator_id`. Such rows are rewritten to the current shape and
   listed in `rewrittenLegacyImpersonatorRows`.

Rerun: `ok`; an independent check (separate code) confirmed per-table counts for both shops, no
cross-shop rows, a platform file holding only `tenants`, `tenant_subscriptions`, the super admin
and its session; the boot guards report split done and no missing shops. Facts confirmed on the
way: production shops are ids **1 cornertech** and **5 test**; most web data belongs to the Test
shop; the 179 MB `liratek.db-wal` is a harmless high-water mark (1 live frame).
