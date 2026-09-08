# Subscription management — revised plan

**Supersedes** `docs/SUBSCRIPTION_MANAGEMENT_PLAN.md` on branch
`origin/feat/subscriptions` (v1.0, 2026-03-12). That document's **business**
decisions are kept almost whole — they are the owner's calls and they are good.
Its **mechanism** is superseded, because the things it had to invent now exist.

**Revised** 2026-09-08, after self-service signup shipped (`80f4b4e2`).

---

## 0. Verdict on the branch — do not merge it

| Fact                    | Value                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Branch forked           | 2026-03-12 (`0dbc7a40`)                                                                                                               |
| Commits on `main` since | **538**                                                                                                                               |
| Commits on the branch   | 1, ~7,500 insertions across 60 files                                                                                                  |
| Touches                 | `AuthContext.tsx`, `App.tsx`, `backendApi.ts`, `server.ts`, `electron-app/main.ts`, `packages/core/src/services/index.ts` (333 lines) |

Rebasing that is not a rebase, it is a reconstruction — and it would reconstruct
a design whose foundation was replaced in the meantime. The branch predates
multi-tenancy in its entirety: the `tenants` table (v123, 2026-07-10), the
tenant registry, the super-admin realm, impersonation, per-tenant usernames
(v172), and the signup flow this document reconciles with.

**Salvage list — take these off the branch by hand, not by merge:**

| Keep                                        | Why                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------- |
| The 7-day grace period                      | Kept, but it now ends in read-only rather than a lockout — see D4     |
| Google Sheet as the surface the owner EDITS | A real advantage — see § 5. Its role changes; its usefulness does not |
| `backend/scripts/generate-api-key.cjs`      | **Needed** — D5 keeps desktop licensing, so keys must be generated    |
| `docs/GOOGLE_SHEETS_SETUP.md`               | Setup steps are transport-independent                                 |

**Superseded by § 3, do NOT salvage:** the two-tier Essentials/Professional
split and its module matrix (D6 chose one tier, which deletes the entitlement
layer outright), and "then lock" as the end of the grace period (D4 chose
read-only, permanently).

**Discard:** `validateApiKey.ts`, `SubscriptionCacheService`, `SubscriptionSyncService`,
`SubscriptionValidator.ts` **and** its committed build output
(`SubscriptionValidator.js` / `.d.ts` / `.map` sitting inside
`packages/core/src/services/` — that alone should not land), the duplicated
services in **both** `backend/src/services/` and `packages/core/src/services/`
(rule 13 wants one owner), and the unrelated payload the branch carries along
(Electron window fixes, test-perf changes, `test-google-sheets.ts` at repo root).

---

## 1. What changed underneath (verified 2026-09-08, not assumed)

| The old plan assumed                             | What is actually true now                                                                                 | Evidence                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A shop is identified by `shop_name`              | A shop is a row in `tenants`: `id`, `slug` UNIQUE, `status`                                               | `electron-app/create_db.sql:8-18`                          |
| The client holds `LIRATEK_API_KEY` in its `.env` | The web client is a **browser**. It cannot hold a secret; identity arrives as a JWT carrying `tenantId`   | `backend/src/middleware/auth.ts`                           |
| Subscription `status` lives in a Sheet           | `tenants.status` exists and login already refuses a non-active tenant                                     | `AuthService.login` tenant-status gate                     |
| `status` includes `grace_period`                 | It does **not** — CHECK allows only `active`, `suspended`, `archived`                                     | `create_db.sql:12`                                         |
| Plan → modules is the entitlement                | The `modules` table is writable by the **tenant's own admin**, so a tenant could grant itself the upgrade | `backend/src/api/modules.ts:53` (`requireRole(["admin"])`) |
| Nothing exists yet                               | Still true of subscriptions specifically: **no** plan/subscription column anywhere on `main`              | grep over `migrations/index.ts`                            |

The API-key-in-`.env` mechanism is worse than merely unavailable in a browser:
a Vite build inlines anything it can reach, so a key wired into the frontend
ships to every visitor. That is the same failure already flagged for
`VITE_HUGGINGFACE_API_KEY` in `docs/DEPLOYMENT.md`.

## 2. The new gap: signup creates tenants with no commercial state

`POST /api/auth/signup` (shipped `80f4b4e2`) creates a tenant `status: 'active'`
with **no plan, no expiry, no trial**. A self-served shop is today
indistinguishable from a paying one. Whatever subscriptions look like, signup is
now the moment a commercial relationship begins, so it MUST be the place the
initial plan/trial is stamped — inside the same `provisionTenant()` transaction,
or the two can disagree.

Also note what signup deliberately does not collect: **email**. There is no
email column on `tenants` and no mail sending anywhere in the codebase
(`WEB_SIGNUP_PAGE_PLAN.md` D6). Subscriptions need it — grace-period notices are
in the policy above, and "notify on day 1/3/6" is not implementable without it.
Adding `tenants.email` belongs to this work, not to a later cleanup.

---

## 3. Decisions — SETTLED 2026-09-08 by the owner

| #           | Decision                                   | Consequence                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D6**      | **One tier, one price**                    | **Deletes the entire entitlement layer.** No `requireEntitlement`, no plan→module matrix, no upgrade prompts — and the self-grant hole (a tenant's own admin toggling `modules`) stops existing rather than needing a guard. Enforcement collapses to: is this shop in good standing? |
| **D5**      | **License desktop AND web**                | Desktop needs an identity and a status check. Not my recommendation — an exported `.db` opens in the free desktop app, so it is bypassable — but the owner's call, and the offline decision below makes it cheap.                                                                     |
| **Offline** | **Never lock when offline**                | Desktop checks status when it can reach the server and **fails OPEN**: unreachable means keep working, indefinitely. Removes cached-expiry logic, clock-tampering concerns, and any chance of locking a paying shop out of its own till while the server is down.                     |
| **D3**      | **Manual mark-paid now, card-ready later** | No processor, no webhooks, no PCI surface. Status changes come from a super-admin action. `SubscriptionService` owns the transitions, so a processor can later call the same methods.                                                                                                 |
| **D2**      | **No trial**                               | Signup is invite-code gated, so every shop is vetted before it exists. A new tenant is stamped `active` with **no** period end — indefinite until the owner sets one.                                                                                                                 |
| **D4**      | **Grace → read-only, never hard-lock**     | 7 days fully working after the period ends, then reads keep working and writes stop. A lapsed shop can always see and export its own receivables (`debt_ledger` is money owed to THEM).                                                                                               |
| **D1**      | Price                                      | Still open, and blocks nothing — with one tier it is a number on a page, not a code path.                                                                                                                                                                                             |

## 4. Revised architecture — good standing, not entitlements

```
web:      JWT (tenantId) ─┐
                          ├─► SubscriptionService.statusFor(tenantId) ─► tenant_subscriptions
desktop:  license key ────┘                    │
                                               ▼
                              read_only?  ──►  block WRITES only
                                               (reads always allowed)
```

One question, two ways of establishing who is asking. The transport decides
identity; the answer comes from one core service (rules 13 and 19).

### Schema — one migration, both `migrations/index.ts` and `create_db.sql` (rule 10)

```sql
CREATE TABLE tenant_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  plan TEXT NOT NULL DEFAULT 'standard',   -- one tier today; the column exists
                                           -- so adding tiers is data, not schema
  status TEXT NOT NULL CHECK (status IN ('active','grace','read_only')),
  current_period_end DATETIME,             -- NULL = indefinite (D2: no trial)
  grace_ends_at DATETIME,
  license_key TEXT,                        -- desktop identity (D5)
  notes TEXT,                              -- the owner's manual payment ledger
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
CREATE UNIQUE INDEX idx_tenant_subscriptions_key
  ON tenant_subscriptions(license_key) WHERE license_key IS NOT NULL;
```

No `suspended` state: never hard-locking is D4, and abuse suspension already
lives in `tenants.status`, which gates login itself. Two different questions,
two different columns — fusing them would make every late payment a lockout.

A separate table rather than columns on `tenants`, for that reason plus a
mechanical one: adding a value to `tenants.status`'s CHECK needs the 12-step
SQLite table rebuild, on an FK target for ~47 tables.

**Existing tenants are grandfathered**: the migration inserts `active` with a
NULL period end for every current tenant, so turning this on changes nothing
for anyone already running.

### Enforcement — block writes, not features

`read_only` rejects `POST`/`PUT`/`PATCH`/`DELETE` with a clear error. Reads are
never blocked. The allowlist that must stay writable regardless:

- `POST /api/auth/login` and `/logout` — locking someone out of _logging in_ to
  see their own read-only data would defeat the point of D4;
- the subscription endpoints themselves;
- `POST /api/auth/signup` — a new tenant has no subscription row yet.

### Desktop identity — the license key goes in SETTINGS, not `.env`

A packaged Electron app's users cannot edit a `.env`, and the March plan's
`LIRATEK_API_KEY=` instruction quietly assumed a developer at a checkout. The
key belongs in the existing settings table, entered once in Settings, with a
"check now" button that reports what the server actually said.

Fail-open is the entire enforcement model on desktop (per the offline
decision): no key, no network, or a server error all mean **keep working**. The
check only ever _removes_ capability when it succeeds AND says `read_only`.

## 5. Google Sheets — the right role is the ADMIN SURFACE, not the database

Unchanged from the previous revision, and D3 makes it more attractive: with
manual collection the owner is in the loop for every payment anyway, so a sheet
they can edit from a phone is a real substitute for an admin panel. Source of
truth stays `tenant_subscriptions`; the sheet writes INTO it through the
super-admin routes and reads a projection back out. If Sheets is down, nothing
about trading changes.

## 6. Order of work — BUILT 2026-09-08

| #   | Step                                                                          | Commit     |
| --- | ----------------------------------------------------------------------------- | ---------- |
| 1   | Migration v173 + `create_db.sql`, existing tenants grandfathered              | `daab842c` |
| 1   | `SubscriptionRepository` + `SubscriptionService` (31 tests)                   | `d068ea18` |
| 2   | Signup stamps a subscription in the SAME transaction (3 tests)                | `603a4a0f` |
| 3   | Write block, status endpoint, owner plan-management routes (20 tests)         | `b6e6e342` |
| 3   | Per-tenant module gating in `ModuleService` (10 tests) + desktop licence sync | `0df96ae6` |
| 4   | Licence IPC + boot sync, wired through preload and `electron.d.ts`            | `3069c6c0` |
| 5/6 | Lapse timer + Settings > Licence panel                                        | `7a2fc7c0` |
| 5   | Grace / read-only banner + dual-mode `getSubscriptionStatus()`                | `d972915a` |

Gates: core **3026** pass, backend **727** pass (the 10 failures are
pre-existing `MaintenanceService` × 8 and `recharge.api` × 2, identical to the
pre-work baseline), typecheck clean across core/backend/electron/frontend,
lint clean on every new file. Schema equivalence: 0 diffs across 72 tables.

### Where each decision ended up in the code

| Decision                           | Lives in                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Per-tenant module allowlist        | `tenant_subscriptions.entitled_modules`, applied in `ModuleService.filterByEntitlement` |
| Never lock offline                 | `electron-app/licenseSync.ts` — every error path leaves access untouched                |
| Grace → read-only, never a lockout | `SubscriptionService.runLapseSweep` + `requireWritableSubscription`'s allowlist         |
| Manual mark-paid                   | `PATCH /api/admin/subscriptions/:tenantId`                                              |
| No trial                           | `provisionTenant` stamps `active` with a NULL period end                                |
| Ungateable chassis                 | `constants/subscription.ts`, exported from BOTH core entry points                       |

## 7. What is NOT done

- **No owner-facing UI for plan management.** The routes exist and are the
  intended surface, but there is no screen: managing a customer today means
  calling `PATCH /api/admin/subscriptions/:tenantId`. The Google-Sheet bridge
  in § 5 is the cheap version of that screen and is also unbuilt.
- **`tenants.email` still does not exist**, so the grace-period notices in the
  policy cannot be sent. The banner is the only warning a shop gets.
- **No e2e coverage.** Every layer has unit tests; nothing drives the whole
  path from an owner setting an allowlist to a module vanishing from a
  customer's sidebar.
- **D1 (price)** is still open, and still blocks nothing.
- **The desktop write block is UI-level only.** `requireWritableSubscription`
  guards REST; on desktop there is no central IPC wrapper to hook, so a
  `read_only` desktop shop is warned by the banner and gated in the nav but
  its IPC write channels are not individually refused. Consistent with
  "never lock when offline" — desktop enforcement is a business control, not
  a security boundary, because the machine belongs to the customer — but it
  should be a deliberate choice rather than a discovery.

## 8. Proof required (status)

- ✅ **The write block, both transports** — 20 middleware tests; a `read_only`
  tenant is refused a POST and served a GET. Failing-first: removing
  `/api/auth/login` from the allowlist fails three of them.
- ✅ **Login survives read_only** — asserted by name.
- ✅ **Fails OPEN** — asserted separately for no row, NULL allowlist, corrupt
  JSON, non-array JSON, no tenant context, a thrown lookup, an unknown key,
  and an unreachable server. Failing-first: making an absent row deny fails
  the grandfathering guard.
- ✅ **Lapse transitions are idempotent** — twice equals once, and a row
  advances only ONE step per sweep.
- ✅ **Grandfathering** — existing tenants writable immediately after the
  migration, no manual step.
- ✅ **Cross-tenant** — marking tenant A paid does not touch tenant B.
- ❌ **End-to-end** — see § 7.
