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

| Keep                                                                           | Why                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| The two-tier plan definition (Essentials / Professional) and the module matrix | Owner's product decision; nothing about multi-tenancy changes it         |
| The grace-period policy (7 days, notify on day 1/3/6, then lock)               | Sound, and it matches the lapse concern in `WEBAPP_MULTI_TENANT_PLAN.md` |
| Google Sheet as the surface the owner EDITS                                    | A real advantage — see § 4. Its role changes; its usefulness does not    |
| `backend/scripts/generate-api-key.cjs`                                         | Still needed IF desktop licensing survives (D5)                          |
| `docs/GOOGLE_SHEETS_SETUP.md`                                                  | Setup steps are transport-independent                                    |

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

## 3. Revised architecture — entitlements keyed on the tenant

```
JWT (tenantId)  ──►  requireEntitlement("exchange")  ──►  tenant_subscriptions row
   (web)                    middleware                      (control plane, NOT
                                                             tenant-writable)
API key (tenantId) ──►  same middleware  ──►  same row
   (desktop, only if D5 keeps it)
```

Two identity models, **one** entitlement check. The check reads control-plane
state; the transport only decides how `tenantId` was established. This is the
dual-transport rule (19) applied to entitlements: one core service, two ways in.

### Schema (one migration, both `migrations/index.ts` and `create_db.sql` — rule 10)

```sql
CREATE TABLE tenant_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  plan TEXT NOT NULL CHECK (plan IN ('trial','essentials','professional')),
  status TEXT NOT NULL CHECK (status IN ('active','grace','read_only','suspended')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly','yearly','lifetime')),
  current_period_end DATETIME,          -- null = indefinite
  grace_ends_at DATETIME,
  notes TEXT,                            -- owner's manual ledger until billing exists
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
```

Deliberately a **separate table**, not columns on `tenants`:

- `tenants.status` answers "may this shop log in at all" and is already load-bearing
  in `AuthService.login`. Subscription state answers "what may it _do_". Fusing
  them means every lapse becomes a lockout, which is exactly the churn-by-fury
  outcome `WEBAPP_MULTI_TENANT_PLAN.md` warns about.
- It keeps the `tenants.status` CHECK untouched. Adding `grace` to that CHECK
  requires a **table rebuild** (SQLite cannot alter a CHECK), on a table that is
  an FK target for `users` and ~47 others — the same 12-step rebuild v172 needed
  for `users`, for no benefit.

### Enforcement — it must not be self-grantable

`requireEntitlement(moduleKey)` resolves plan → allowed modules from a **constant
in core** (rule 14: defined once, reused by both transports and the frontend),
and reads plan/status from `tenant_subscriptions`. The `modules` table stays
what it is: the tenant's own on/off preference **within** what it is entitled to.
The effective answer is the AND of the two, and the entitlement side is writable
only by `super_admin` control-plane routes.

Frontend mirrors it for UX only — hide what is not entitled, show an upgrade
prompt. Never the security boundary; that lives in the middleware.

### Lapse behaviour — `read_only` is the point

| Status      | Reads | Writes | Login                                 |
| ----------- | ----- | ------ | ------------------------------------- |
| `active`    | ✅    | ✅     | ✅                                    |
| `grace`     | ✅    | ✅     | ✅ + a countdown banner               |
| `read_only` | ✅    | ❌     | ✅                                    |
| `suspended` | ❌    | ❌     | ❌ (`tenants.status` does this today) |

`read_only` exists for one reason that is specific to this product: a shop's
`debt_ledger` is **its own receivables**. Cutting a lapsed shop off from seeing
who owes it money is how a billing dispute becomes a lost customer and a bad
story. Let them read, and export, forever.

---

## 4. Google Sheets — the right role is the ADMIN SURFACE, not the database

The original plan made the Sheet the source of truth and the SQLite side a 12h
cache. Invert that. With a real registry in place, a second database that can
disagree with the first is a defect generator, and the failure mode is bad:
Sheets outage or a stale cache decides whether a shop can trade.

But the Sheet's actual value was never storage — it is that **the owner can edit
it from a phone with no admin panel**, which is worth a great deal while there
are ten tenants and no billing integration. So keep the Sheet as an **operator
console**: it writes INTO the control plane through the existing super-admin
routes, and reads a projection back out for the owner to look at.

- Source of truth: `tenant_subscriptions`.
- Sheet → control plane: an owner-triggered "apply" (or a poll) that calls
  `PATCH /api/admin/tenants/:id/subscription`.
- Control plane → Sheet: a read-only mirror, for eyeballing.
- If Sheets is down, nothing about trading changes. That is the whole gain.

_(Recommendation, not verified: `docs/GOOGLE_SHEETS_SETUP.md` on the branch
already covers OAuth setup. A service account with the sheet shared to it is
simpler than the refresh-token dance in `scripts/get-refresh-token.js`, but I
have not re-checked the current Google console flow.)_

---

## 5. Order of work

Nothing here should start before its dependency, and the first one is not code.

0. **`APP_BASE_DOMAIN` + wildcard DNS.** Not part of this plan, but it gates it:
   until each tenant has its own subdomain, a second shop cannot even log in
   (`docs/DEPLOYMENT.md` § 8), so there is nobody to bill.
1. **Schema + core service.** Migration, `SubscriptionService` (reads/writes the
   row, resolves plan → modules from the shared constant), plan constant, and
   `tenants.email`.
2. **Signup stamps the initial state**, inside `provisionTenant()`'s transaction.
   Trial length is D2.
3. **`requireEntitlement` middleware + IPC equivalent**, applied to the module
   routes. Failing-first proof that an Essentials tenant is refused Exchange
   **even after its own admin enables the module** — that is the test that
   matters, and it is the one the old design could not have passed.
4. **Frontend**: entitlement-aware nav, upgrade prompt, grace banner,
   `/subscription` page showing plan + what is included.
5. **Control-plane routes + Sheet bridge** (super-admin only, audited via
   `auditRest`).
6. **Lapse job**: `active` → `grace` at `current_period_end`, `grace` →
   `read_only` at `grace_ends_at`. One scheduled task, idempotent.

---

## 6. Open decisions — the owner's, not mine

| #      | Decision                                                                                                                                                                                                                                                                                | Why it blocks code                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **D1** | **Price**, per tier, per currency (USD or LBP?)                                                                                                                                                                                                                                         | Nothing else in the plan needs it, but nothing ships without it |
| **D2** | Trial: length, or no trial at all (invite-code signup may make a trial pointless — you already vet who gets in)                                                                                                                                                                         | Step 2 stamps whatever this says                                |
| **D3** | **Payment channel.** `WEBAPP_MULTI_TENANT_PLAN.md` § billing viability found Stripe does **not** onboard Lebanon-based merchants, and this market runs on cash/OMT/Whish. If collection is manual, the control plane needs _manual mark-paid_, not webhooks — that is a different build | Decides whether step 5 is a Stripe webhook or a button          |
| **D4** | Grace = 7 days then `read_only`, or straight to `read_only`?                                                                                                                                                                                                                            | Step 6                                                          |
| **D5** | **Does desktop licensing survive?** If the counter app stays (printing, offline), it needs the API-key path and the Sheet's key column. If the web app is the only paid product, delete that whole branch of the design                                                                 | Decides whether `validateApiKey` is rebuilt at all              |
| **D6** | Are the tiers still Essentials/Professional with that exact module split? It was drawn in March, before Carrier Lines, Loto, Partners and Exchange lots existed                                                                                                                         | Step 1's constant                                               |

**My recommendation on D5**, since it shapes the most code: keep desktop
unlicensed and free, and charge for the web/multi-tenant product. It is the
cheaper build, it needs no secret on the client, and the plan's own note already
spots the hole in the alternative — an exported `.db` imports straight into the
free desktop app, so desktop licensing is bypassable by design.

---

## 7. Proof required

- **The self-grant test** (§ 3, step 3) — failing-first, per rule 17.
- Cross-tenant: tenant A's plan change must not alter tenant B's entitlements.
- Lapse transitions are idempotent — running the job twice must not double-shift
  a tenant from `active` to `read_only`.
- `read_only` blocks **writes only**: a lapsed tenant must still read its
  `debt_ledger`. Assert both halves.
- Both transports: web e2e plus the desktop path, if D5 keeps it.
