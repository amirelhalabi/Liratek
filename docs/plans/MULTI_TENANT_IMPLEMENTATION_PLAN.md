# Multi-Tenant Implementation Plan — Shared DB + `tenant_id`

**Created:** 2026-07-10
**Status:** 🟢 COMMITTED APPROACH — this resolves Open Decisions #5 and #6 of `WEBAPP_MULTI_TENANT_PLAN.md`
**Verified against:** repo at v1.29.3, migration **v122** (true max; entries in `migrations/index.ts` are out of order — re-verify at implementation time)
**Reference implementation studied:** `~/Documents/Hetivo/hetivo-mono` — the backoffice "Connect as admin" (impersonation) feature

---

## 1. Decisions made

| # | Decision | Choice |
|---|---|---|
| D5 | Tenant vocabulary | Table **`tenants`**, column **`tenant_id`** (snake_case, matching every other FK in the schema: `user_id`, `client_id`) |
| D6 | DB model | **One shared SQLite database**, `tenant_id INTEGER REFERENCES tenants(id)` on every tenant-owned table. NOT database-per-tenant. |
| — | Super-admin realm | Platform admins live in the existing `users` table with **`tenant_id = NULL` + new role `super_admin`**. No separate credential store for v1. |
| — | Tenant resolution | **From the JWT**, not from the Host header. Subdomain routing is explicitly out of scope for v1 — one backend URL, tenant identity is embedded at login. |
| — | Usernames | **Globally unique** (kept as-is). Login has no tenant hint (no subdomain yet), so `username → user → tenant_id` must resolve globally. Per-tenant usernames can come with subdomains later. |
| — | Desktop | Electron stays **single-tenant**: migration creates tenant id=1 ("Default"), backfills every row, and the main process runs under a fixed tenant context. Zero behavior change for desktop users. |
| — | Impersonation | Adapted from hetivo: super admin mints a short-lived tenant-admin JWT, handed off via URL param → sessionStorage in a new tab, orange banner + Disconnect. Details in §5. |

### Out of scope for v1 (explicitly deferred)
Subdomains/wildcard TLS/reverse proxy · billing/entitlements · Postgres migration · offline sync · per-tenant rate limiting (noted as follow-up) · desktop-to-cloud tenant import · Socket.io is scoped in v1 only to the extent of handshake auth + tenant rooms (WP8).

---

## 2. Current-state facts the plan builds on (verified 2026-07-10)

- **Schema:** 52 tables in `electron-app/create_db.sql`. ~34 tenant business tables + ~13 per-tenant config tables need `tenant_id`; `schema_migrations` (+ legacy `sync_queue`/`sync_errors`) stay global.
- **~21 uniqueness constraints collide across tenants** and must become composite or partial: single-column UNIQUEs (`users.username`†, `clients.phone_number`, `products.barcode`, `suppliers.name`, `system_settings.key_name`, `currencies.code`, `exchange_rates.to_code`, `product_categories.name`, `product_suppliers.name`, `partners.name`, `payment_methods.code`, `vouchers.code`, `modules.key` TEXT PK, `loto_settings.key_name` TEXT PK) and composite PKs/UNIQUEs (`drawer_balances`, `currency_modules`, `currency_drawers`, `daily_closing_amounts`, `item_costs`, `voucher_images`, `mobile_service_items`). † username stays globally unique per D-above; all others gain `tenant_id`.
- **Query surface:** 43 repository classes; 30 extend `BaseRepository` (lazy `get db()` → `getDatabase()`), 13 standalone (12 of which bind `this.db` in the constructor). **~501 raw `.prepare(` statements** in production repo code. Heaviest: FinancialService (35), Recharge (33), Sales (29), LotoCheckpoint (26), Debt (24), Profit/CustomerSession (23), Closing (22).
- **Migrations:** true max version **v122**. `runMigrations()` is called **only from `electron-app/main.ts:403`**. The backend bootstraps schema from `create_db.sql` when the `users` table is absent and **never migrates** — an existing backend DB would silently miss v123. Fixing this is in scope (WP0).
- **Backend auth:** `POST /api/auth/login` → `AuthService.login` (users table, `is_active=1`) → DB session row → JWT `{ userId, role, sessionToken }`. **Legacy hole:** `backend/src/middleware/auth.ts:81-85` accepts any signed JWT *without* a `sessionToken` on signature alone. **No global auth middleware**; applied per route file, and **`sessions.ts` and `settings.ts` mount handlers with no auth at all.**
- **Roles today:** `'admin' | 'staff'` (`UserRepository.ts:19`). No tier above tenant admin.
- **Frontend web mode:** JWT in localStorage `liratek.jwt` (`httpClient.ts`); `isElectron()` = `!!window.api`; `backendApi.login()` branches IPC/HTTP.
- **Socket.io:** module singleton, `emitEvent()` = global unauthenticated `io.emit` — every event reaches every connected client.
- **Zero existing traces** of tenant/subdomain/impersonation anywhere in `backend/` or `packages/core/`.

---

## 3. Target architecture

```
                    ┌────────────────────────────────────────────────┐
                    │ Backend (Express)                              │
 Browser ──JWT──▶   │  authenticateJWT (hole closed)                 │
                    │   ├─ role=super_admin → /api/admin/* only      │
                    │   │    (control plane: tenants CRUD,           │
                    │   │     impersonate — NO tenant context)       │
                    │   └─ else → runWithTenant(jwt.tenantId, next)  │
                    │        └─ AsyncLocalStorage tenant context     │
                    ├────────────────────────────────────────────────┤
                    │ @liratek/core                                  │
                    │  getCurrentTenantId()  ← ALS, FAIL-CLOSED      │
                    │  (throws if unset — no default tenant, ever)   │
                    │  Repositories: every SQL statement carries     │
                    │  tenant_id (WHERE / INSERT columns)            │
                    ├────────────────────────────────────────────────┤
                    │ ONE SQLite file — tenants table +              │
                    │ tenant_id on all tenant-owned tables           │
                    └────────────────────────────────────────────────┘

 Electron main: initFixedTenantContext(1) at startup → getCurrentTenantId()
 returns 1 everywhere, same query code path as web. Desktop unchanged.
```

**The fail-closed rule is the backbone of the whole design.** `getCurrentTenantId()` throws when no context is set. There is no "default tenant" fallback in web mode — a request that reaches a repository without tenant context is a 500, not a silent cross-tenant read. Electron opts into a fixed context explicitly at boot; tests set context explicitly in fixtures.

### Tenant context (`packages/core/src/db/tenantContext.ts`, new)

```typescript
// AsyncLocalStorage-based; safe across await points in Express handlers
runWithTenant<T>(tenantId: number, fn: () => T): T
getCurrentTenantId(): number          // throws TenantContextError if unset
initFixedTenantContext(tenantId: number): void   // Electron/desktop mode
// Control-plane escape hatch — ONLY for TenantRepository/admin realm:
runWithoutTenant<T>(fn: () => T): T   // audited by the static checker (§6)
```

Why ALS and not a connection-level "current tenant": better-sqlite3 calls are synchronous, but Express handlers are async — between two sync DB calls in one handler, another request's handler can run. ALS keeps the context per-request across await points. (This also matches the fix shape the exploratory doc identified for the singleton problem.)

### JWT payload (new shape)

```typescript
{
  userId: number;
  role: "super_admin" | "admin" | "staff";
  sessionToken: string;        // now MANDATORY — legacy hole closed
  tenantId: number | null;     // null only for super_admin
  impersonatorId?: number;     // present ONLY on impersonation tokens (§5)
}
```

Hetivo trap adopted-and-fixed: hetivo's token has *inverted* field semantics (`userId` = actor, `impersonatingUserId` = target). We use unambiguous names — `userId` is always the **effective identity** (whose data/permissions apply), `impersonatorId` is always the **real super admin** behind it.

---

## 4. Schema changes

### New `tenants` table (both `create_db.sql` and migration v123)

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,               -- future subdomain; validated charset, reserved-name blocklist
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `tenant_id` on ~47 tables

- `ALTER TABLE x ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)` (nullable at SQL level — SQLite can't add NOT NULL without rebuild; enforcement lives in the query layer + checker), then `UPDATE x SET tenant_id = 1` backfill, then `CREATE INDEX idx_x_tenant_id ON x(tenant_id)` on high-volume tables (`transactions`, `sales`, `sale_items`, `payments`, `debt_ledger`, `financial_services`, `recharges`, `exchange_transactions`, `expenses`, `audit_log`, `loto_tickets`, …).
- The ~20 tables whose UNIQUE/PK constraints must become composite get the full **12-step SQLite table rebuild** (new table → copy → drop → rename → recreate indexes/triggers, `PRAGMA foreign_keys=OFF` around it, `PRAGMA foreign_key_check` after). `users` keeps global `username` uniqueness but still gains `tenant_id` (nullable = platform realm).
- `users.role` CHECK (if any) extended to include `'super_admin'`; seed one super admin row (`tenant_id NULL`) with a forced-password-change flag or documented bootstrap credential.
- `sessions` gains `tenant_id` (denormalized from user; simplifies `validateSession`) and `audit_log` gains `impersonator_id INTEGER NULL REFERENCES users(id)`.
- Migration v123 (electron path): creates `tenants`, inserts `(1, 'Default', 'default', 'active')`, adds columns, backfills `tenant_id=1` everywhere, rebuilds constrained tables, creates indexes. `down()` implemented.
- **`create_db.sql`** (backend fresh-install path): same end-state schema inline + `schema_migrations` entry for v123. **Fresh installs seed NO default tenant** — web tenants are provisioned explicitly (§5); only the super admin user is seeded. (The Default tenant is a *migration* artifact for existing desktop DBs, not part of the fresh web schema.)
- **Backend gains a migration runner:** after `ensureSchema()`, `backend/src/database/connection.ts` calls core `runMigrations(db)` at startup. This is what delivers v123+ to existing backend DBs and permanently closes the "backend never migrates" drift.

### Per-tenant config seeding

All of today's global seeds in `create_db.sql` (`system_settings`, `currencies`, `exchange_rates`, `modules`, `currency_modules`, `currency_drawers`, `payment_methods`, `loto_settings`, `drawer_balances` bootstrap) become **per-tenant seed data**. Extract them into `packages/core/src/services/TenantProvisioningService.ts` → `provisionTenant({name, slug, adminUsername, adminPassword})` runs in ONE transaction: insert tenant → seed config rows with its `tenant_id` → create tenant-admin user. The migration backfills tenant 1's config from the existing global rows; `create_db.sql` keeps seeds only for the desktop path (guarded) — the exact guard mechanics are WP5's first design task, with "seeds live in exactly one place (core)" as the acceptance bar.

---

## 5. Super admin + impersonation (the hetivo adaptation)

### Control-plane API (new: `backend/src/api/admin.ts`, all behind `requireSuperAdmin`)

| Endpoint | Behavior |
|---|---|
| `GET /api/admin/tenants` | List tenants + per-tenant stats (user count, last activity) |
| `POST /api/admin/tenants` | `provisionTenant()` — creates tenant + config seeds + tenant admin |
| `PATCH /api/admin/tenants/:id` | Update name/status (suspend blocks that tenant's logins) |
| `POST /api/admin/tenants/:id/impersonate` | Mint impersonation token (below) |

`requireSuperAdmin` = JWT role `super_admin` **and** `tenantId === null`. Control-plane repos (`TenantRepository`, cross-tenant user lookup) are the only code allowed inside `runWithoutTenant()`.

### Impersonation endpoint (hetivo recipe, LiraTek-ified)

1. Validate caller is super admin (server-side, not just route guard).
2. Tenant exists and `status = 'active'` (else 409).
3. Find the tenant's **first active `admin` user** (else 404 "no active tenant admin").
4. Create a **real DB session row** for that user (`device_type: 'impersonation'`) — so `validateSession` works and logout-revocation applies; no signature-only token.
5. Sign a JWT `{ userId: tenantAdmin.id, role: 'admin', tenantId, sessionToken, impersonatorId: superAdmin.id }` with **short expiry (2h, no refresh)**.
6. Write an `audit_log` row in the tenant's realm: "Super admin {username} connected as {tenantAdmin.username}", `impersonator_id` set.
7. Return `{ tenantName, token }`.

Auth middleware treats an impersonation token as a normal tenant session (context = `tenantId`), except: `req.impersonatorId` is attached, and **`/api/admin/*` rejects impersonation tokens** (no re-escalation — mirrors hetivo's `internal:false` flip). Writes that record `user_id` during impersonation attribute to the tenant admin; `audit_log` rows additionally carry `impersonator_id` where the write path already logs.

### Frontend flow (same SPA, hetivo's two-tab + sessionStorage pattern)

- Token precedence in `httpClient.getToken()`: **`sessionStorage['liratek.impersonation']` wins over `localStorage['liratek.jwt']`**. sessionStorage is per-tab → the super admin's own tab keeps its session untouched while the impersonation tab acts as the tenant.
- New route `/admin/tenants` (role-gated, web-only): tenant table with status, stats, actions — "Connect as admin" on active tenants.
- Connect-as: `POST .../impersonate` → `window.open('/?impersonation_token=<jwt>', '_blank', 'noopener,noreferrer')`.
- App bootstrap: read `?impersonation_token=` → move to sessionStorage → **strip from URL via `history.replaceState`** (token never sits in history) → proceed to normal authenticated boot.
- **Orange `ImpersonationBanner`** whenever the sessionStorage key exists: "Viewing as {username} ({tenantName}) — Disconnect". Disconnect clears sessionStorage + redirects to login; the admin tab was never touched. Session also dies naturally at JWT `exp`.
- Super admin login lands on `/admin/tenants`; tenant-scoped routes are hidden for the super admin role (they'd 500 fail-closed anyway — hide them in nav and guard in router).

---

## 6. Repository scoping — the 501-statement problem

Mechanics per statement type (the recipe every fan-out agent follows):

- `SELECT/UPDATE/DELETE` on a tenant table → add `AND tenant_id = ?` (parameterized, bound from `getCurrentTenantId()`), including inside JOINs/subqueries/CTEs that touch tenant tables.
- `INSERT` → add `tenant_id` to the column list, bound the same way.
- `BaseRepository` generic CRUD (`findById/findAll/create/update/delete/count`) gets the predicate injected **once, centrally**, gated on a per-repo `tenantScoped = true` flag (default true; `TenantRepository` and `schema_migrations` access opt out).
- Money repositories: agents add predicates **only** — no changes to payment-leg logic, drawer loops, or ledger writes (CLAUDE.md rule 16 / FEATURE_GUIDE §13 stay untouched by construction).

### The safety net: static tenant-scoping checker (built FIRST, in Phase 0)

`scripts/check-tenant-scoping.mjs` — scans every string passed to `.prepare(` under `packages/core/src/repositories/`, extracts referenced table names, and **fails** if a statement touching a tenant-scoped table lacks `tenant_id` (in WHERE for reads/writes, in the column list for INSERTs). Explicit escape comment `/* tenant-exempt: <reason> */` for the rare legitimate case (e.g. `schema_migrations`), and every `runWithoutTenant` call site is reported for review. Wired into `yarn lint` / CI.

This turns "did the agent miss a WHERE clause?" — the classic shared-DB leak, in a money app — from a code-review hope into a deterministic gate. It runs green only when all 501 statements are handled or explicitly exempted.

### Runtime verification

- **Cross-tenant isolation tests** (jest, `packages/core`): seed two tenants with mirrored data; for each major repo assert tenant B's context never sees tenant A's rows (list, getById cross-tenant → null, aggregate sums don't bleed). Per CLAUDE.md rule 17: prove at least one isolation test fails when a predicate is deliberately removed.
- **API-level supertest**: login as tenant-A admin, hit the money-relevant routes, assert zero tenant-B data; impersonation token behaves as tenant; super admin token 500/403s on tenant routes; revoked-session and no-sessionToken JWTs rejected.
- **Existing test fixtures WILL break** (known trap — core jest hand-rolls per-file SQL fixtures; the tenant_id columns will cascade `no such column`/NOT-NULL-style failures that mask real ones). A dedicated work package updates fixtures/seeds to create tenant 1 + set fixed context, BEFORE the repo fan-out lands.
- **Desktop E2E suite** must stay green end-to-end — it is the proof that migration v123 backfill + fixed tenant context leaves the desktop product byte-for-byte equivalent in behavior.

---

## 7. Work packages & agent orchestration

Orchestrator: **Fable 5** (this session). Implementers: **Sonnet agents** (`backend` / `database` / `electron` / `frontend` agent types), with worktree isolation for the parallel fan-out phase. Every WP prompt includes: the recipe from this doc, the exact file list, the verification command(s) that must pass, and "do not touch money logic" where applicable.

### Phase 0 — Foundations (sequential; each WP blocks the next)

| WP | Agent | Scope | Verify |
|---|---|---|---|
| **WP0 — Schema** | database | `tenants` table; `tenant_id` + backfill + indexes on ~47 tables; ~20 constraint rebuilds; `users.tenant_id` + `super_admin`; `sessions.tenant_id`; `audit_log.impersonator_id`; migration **v123** (with `down()`) + `create_db.sql` in lockstep; backend calls `runMigrations()` at startup; super admin seed | Fresh-from-SQL vs migrated-from-v122 schema diff is empty (script); `PRAGMA foreign_key_check` clean; desktop dev DB migrates without error |
| **WP1 — Tenant context + checker** | backend | `tenantContext.ts` (ALS, fail-closed, fixed mode, `runWithoutTenant`); `BaseRepository` central scoping (flag-gated); electron main calls `initFixedTenantContext(1)`; **`scripts/check-tenant-scoping.mjs`** + CI wiring | Unit tests for context (async interleaving, fail-closed throw); checker runs and reports the current ~501 unscoped statements as the baseline TODO list |
| **WP2 — Auth & realm** | backend | JWT payload v2 (`tenantId`, mandatory `sessionToken` — close auth.ts:81-85); tenant middleware (`runWithTenant` wrap); `requireSuperAdmin`; **add auth to `sessions.ts` + `settings.ts`**; login embeds `tenantId` from user row; suspended-tenant login block; `AuthService`/`UserRepository` tenant awareness | supertest: legacy JWT rejected, tenant JWT scoped, super admin blocked from tenant routes, unauthenticated settings/sessions now 401 |
| **WP2b — Test fixtures** | backend | Update every core jest fixture/seed to create tenant 1 + run under fixed context, so Phase 1 agents inherit a green baseline | `yarn workspace @liratek/backend test` green pre-fan-out |

### Phase 1 — Repository fan-out (parallel Sonnet agents, worktree isolation)

43 repos split into 6 batches by domain; each agent applies the §6 recipe to its batch, updates that batch's tests, and must leave **the checker green for its file list** + batch tests passing:

- **WP3a** Sales/POS: `SalesRepository`, `TransactionRepository`, `PaymentRepository`, `ProductRepository`, `CategoryRepository`, `ProductSupplierRepository`, `InventoryRepository`*
- **WP3b** Money services: `FinancialServiceRepository`, `RechargeRepository`, `ExchangeRepository`, `ItemCostRepository`, `VoucherRepository`, `MobileServiceItemRepository` *(predicates only — no leg/drawer logic changes)*
- **WP3c** Debts/clients/suppliers/partners: `DebtRepository`, `ClientRepository`, `SupplierRepository`, `SupplierLedger/PurchaseRepository`, `PartnerRepository`, `HoldMoneyRepository`
- **WP3d** Loto (6 repos) + `CustomServiceRepository` + `ServicePresetRepository`
- **WP3e** Closing/drawers/profits: `ClosingRepository`, `DrawerRepository`, `DrawerTopupRepository`, `ProfitRepository`, `CustomerSessionRepository`, `ExpenseRepository`, `MaintenanceRepository`
- **WP3f** System: `SettingsRepository`, `ModuleRepository`, `PaymentMethodRepository`, `CurrencyRepository`, `ExchangeRateRepository`, `UserRepository`, `SessionRepository`, `AuditRepository`, `ActivityRepository`*

(*exact repo names to be confirmed from `repositories/index.ts` when cutting the batch prompts; the 6-way split stays.)

**Gate to exit Phase 1:** checker 100% green across all repos + full core/backend test suites green + isolation tests (written here, WP3g, by one agent in parallel) proven per rule 17.

### Phase 2 — Control plane & impersonation (parallel where marked)

| WP | Agent | Scope |
|---|---|---|
| **WP5 — Provisioning** | backend | `TenantRepository` (control-plane, `runWithoutTenant`), `TenantProvisioningService` (transactional seed extraction from create_db.sql), admin routes list/create/patch |
| **WP6 — Impersonation** | backend | `POST /api/admin/tenants/:id/impersonate` per §5; middleware handling of `impersonatorId`; re-escalation block; audit rows; 2h expiry |
| **WP7 — Admin UI** ∥ | frontend | `/admin/tenants` page (list/create/suspend/connect-as), token precedence in `httpClient`, `?impersonation_token=` bootstrap + URL strip, `ImpersonationBanner`, role-gated routing/nav, `electron.d.ts` untouched (web-only feature) |

### Phase 3 — Hardening & proof

| WP | Agent | Scope |
|---|---|---|
| **WP8 — Socket.io** | backend | JWT in `io.use()` handshake; per-tenant rooms; `emitEvent(tenantId, event, payload)` signature change at the one production emit site; delete `/api/ws/emit` |
| **WP9 — E2E** | frontend | Desktop suite green (migration + fixed-context proof); new web-mode spec: super admin login → tenant list → provision tenant → impersonate → verify banner + tenant data + isolation |
| **WP10 — Review** | orchestrator | `/code-review` over the full diff; FEATURE_GUIDE §13 checklist pass on any file that touched money repos; `yarn typecheck && yarn lint` all workspaces; core build + node_modules sync |

Dependency graph: `WP0 → WP1 → WP2 → WP2b → [WP3a..3g parallel] → gate → [WP5, WP6, WP7 parallel] → [WP8, WP9 parallel] → WP10`.

---

## 8. Risks & traps (each has an owner in the WPs)

1. **A missed `WHERE tenant_id` is a silent money leak** → static checker (WP1) is built before any scoping work, fail-closed context means unscoped *contexts* crash loudly, isolation tests proven against removed predicates (rule 17).
2. **SQLite table rebuilds** on FK-referenced tables (users, clients, products…) → `foreign_keys=OFF` + `foreign_key_check`, backup-before-migrate, desktop E2E as the regression proof.
3. **Backend never migrated before** → WP0 makes it run `runMigrations()`; the fresh-SQL-vs-migrated schema-diff script guards create_db.sql ↔ migrations drift (a known, twice-bitten failure mode in this repo).
4. **Test-fixture cascade** (`no such column: tenant_id` masking real failures) → WP2b lands before the fan-out, not after.
5. **Hetivo's inverted JWT naming** → our names are semantic (`userId` = effective identity, `impersonatorId` = actor); documented in §3.
6. **Impersonation re-escalation** → `/api/admin/*` rejects tokens carrying `impersonatorId`; impersonation sessions are real DB sessions (revocable), 2h, no refresh.
7. **Token in URL** → sessionStorage handoff + immediate `history.replaceState` strip (hetivo pattern).
8. **Money-logic regression from mechanical edits** → WP3b prompts forbid touching leg/drawer/ledger logic; WP10 runs the §13 checklist on every money file in the diff.
9. **Suspended tenants** → login blocked at auth (WP2) and status checked at impersonation (WP6); existing sessions of a suspended tenant: validated against tenant status in `validateSession` (WP2).
10. **Electron regression** → fixed context + backfill designed for byte-equivalent behavior; full desktop E2E suite is the gate.

## 9. Open items to confirm before/while cutting agent prompts

- Exact repo/batch lists from `repositories/index.ts` (WP3 prompts).
- Migration number: re-verify max version at implementation time (v122 today → new = v123).
- Super admin bootstrap credential mechanism (env-provided initial password vs seeded + forced change).
- Whether `drawer_balances` PK rebuild interacts with the closing/checkpoint flows' upsert statements (WP3e agent to flag).
