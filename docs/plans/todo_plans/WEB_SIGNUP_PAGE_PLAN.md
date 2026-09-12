# Web sign-up page — plan

**Goal:** a public sign-up page for the web app that does what the desktop setup
wizard does — stand up a working shop from nothing — except it creates a
**tenant** on the shared server instead of a local database file.

**Status:** not built. The backend for it, however, is essentially already here.

---

## 1. What already exists (verified, not assumed)

The provisioning path is complete and transactional. `TenantProvisioningService.provisionTenant()`
(`packages/core/src/services/TenantProvisioningService.ts:60`) does all of this in
ONE transaction:

1. Validates name, slug, admin username (min 3 chars).
2. `assertValidTenantSlug(slug)` — charset + reserved-name blocklist, defence in
   depth over the Zod layer.
3. Rejects a duplicate slug (`existsBySlug`) and a duplicate username
   (`usernameExists`) — usernames are **globally** unique today.
4. `validatePasswordComplexity(adminPassword)`, then `hashPassword`.
5. Creates the `tenants` row.
6. `seedConfig(tenantId, name)` — the full per-tenant config seed (mirrors
   `create_db.sql`; `shop_name` seeds from the tenant name).
7. Creates the tenant's first user: `role: "admin"`, `tenant_id` set.

Supporting pieces already in place:

| Piece                                                          | Where                                           |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `createTenantSchema` — incl. `adminUsername` / `adminPassword` | `packages/core/src/validators/tenant.ts:19`     |
| `tenants` table with `slug TEXT NOT NULL UNIQUE`               | `packages/core/src/db/migrations/index.ts:5099` |
| Provisioning route (super-admin gated)                         | `backend/src/api/admin.ts:85`                   |
| Reserved-slug blocklist + charset validation                   | `packages/core/src/utils/tenantSlug.ts`         |
| Password complexity rules                                      | `validatePasswordComplexity` in core            |

**So sign-up is not a new feature.** It is an _unauthenticated entry point_ to a
service that already works, plus a page.

## 2. What is missing

1. **A public route.** `POST /api/admin/tenants` sits behind
   `authenticateJWT + requireSuperAdmin` (`admin.ts:58`). Sign-up needs an
   endpoint reachable with no token.
2. **Abuse controls.** The moment tenant creation is public it is an
   account-creation endpoint on the open internet. See §5.
3. **The page itself** — `frontend/src/features/signup/`.
4. **Subdomain-scoped login**, if that is the model. Tracked separately; today
   login takes no tenant hint and nothing reads the Host header, so a tenant's
   user can authenticate on any hostname.

## 3. Desktop wizard → sign-up, step by step

The desktop wizard (`frontend/src/features/setup/SetupWizard.tsx`) renders:

| Desktop step | Component                                            | Sign-up?                                                                              |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0            | `StepDetect` — find an existing install / network DB | **Drop.** No local filesystem to detect.                                              |
| -1           | `StepJoinShop` — join a shop over the LAN            | **Drop.** Joining is "log in to your tenant" on the web.                              |
| 1            | `Step1Account` — shop name + admin credentials       | **Keep** — the core of sign-up. Add the slug field.                                   |
| 2            | `StepBaseSystem`                                     | **Keep.**                                                                             |
| 3            | `Step2Modules` — which modules are enabled           | **Keep**, or defer to Settings post-signup (see D3).                                  |
| 4            | `Step3Currencies`                                    | **Keep**, or defer.                                                                   |
| 5            | `Step4Users` — additional staff users                | **Defer.** Do it in Settings once logged in; it lengthens signup for no gain.         |
| 6            | `StepDrawerAmounts` — opening drawer balances        | **Defer.** Money data; belongs after first login, not before the account exists.      |
| 7            | `StepComplete`                                       | **Keep**, but it ends by sending the user to their tenant, not by relaunching an app. |

(`Step3DatabasePath.tsx` exists in the folder but is not rendered by the wizard —
desktop-only regardless, since it picks a local file path.)

**Minimum viable sign-up is one screen:** shop name → slug → admin username →
password. Everything `seedConfig` already provisions gives a working shop, and
modules/currencies/drawers are all editable in Settings afterwards. Recommend
shipping that, then adding optional steps if signups actually stall.

## 4. Route design

```
POST /api/auth/signup        (public — no authenticateJWT)
body: { name, slug, adminUsername, adminPassword, contactName?, contactPhone? }
  → signupSchema (core; createTenantSchema minus the admin-only fields)
  → TenantProvisioningService.provisionTenant(...)   ← unchanged
  → { success: true, data: { tenant: { id, name, slug }, token? } }
```

Notes:

- **Reuse the service as-is.** No logic in the route (rule 13). The only new core
  artifact is a validator, and it can be `createTenantSchema` re-exported.
- Mount on the **auth** router so it inherits `authLimiter`, not the general
  limiter (`server.ts:115`).
- IPC-identical envelope, HTTP 200 even on failure (rule 19c).
- **Desktop is unaffected** — no IPC counterpart. The desktop wizard keeps
  writing a local database via `setupHandlers`; this route is web-only. That is
  the one deliberate exception to the dual-transport rule, and it should be
  commented as such where the route is defined.
- Returning a `token` (auto-login) is convenient but couples signup to the login
  model; see D2.

## 5. Abuse controls — non-negotiable before this ships

A public endpoint that writes rows and seeds config is a spam target, and every
signup permanently consumes a globally-unique slug.

- **Rate limit per IP** — reuse `authLimiter`, and consider a tighter dedicated
  limit. Note the limiter is **in-memory**, so it resets on restart and is
  per-instance.
- **`trust proxy` must be set** or the limiter degenerates to one shared bucket
  behind a proxy. Already done (`server.ts`).
- **Invite code or captcha (recommended for now).** Until there is a billing or
  approval step, an open signup on a POS platform invites junk tenants. A single
  shared `SIGNUP_INVITE_CODE` env var is a five-line change and can be dropped
  later.
- **Slug squatting** — the reserved blocklist already exists; keep signup on it.
- Decide whether a signup is immediately `active` or lands `status: 'pending'`
  for approval (the `tenants.status` column already supports
  `active|suspended|archived`).

## 6. Open decisions

- **D1 — one screen or a multi-step wizard?** Recommend one screen (§3).
- **D2 — auto-login after signup, or redirect to the login page?** If tenancy
  becomes subdomain-scoped, the natural end of signup is a redirect to
  `https://<slug>.<domain>` and a fresh login there. Auto-login needs a token
  issued for a tenant the browser is not yet "on".
- **D3 — modules/currencies at signup or in Settings?** `seedConfig` already
  provides working defaults, so Settings is enough.
- **D4 — open signup, invite code, or admin approval?** §5. Recommend invite
  code initially.
- **D5 — is a slug user-chosen or derived from the shop name?** Derive-then-let-
  them-edit is friendliest, and it must be validated live against
  `assertValidTenantSlug` plus a uniqueness check.
- **D6 — email?** There is no email field on `tenants` and no mail sending
  anywhere in the codebase. No email means no password reset and no way to
  contact a tenant. Worth adding the column at signup even if nothing sends mail
  yet.

## 7. Proof required

- **Failing-first guard (rule 17):** a signup with a duplicate slug, a duplicate
  username, and a weak password each rejected — and the transaction rolled back
  so no orphan tenant row survives a mid-way failure.
- **Web e2e** (`frontend/tests/e2e-web/`): sign up → land on the new tenant →
  log in as its admin → confirm the seeded config exists (modules, currencies)
  and that the tenant sees **none** of another tenant's data.
- **Cross-tenant isolation** is the assertion that matters most here: create two
  tenants in one spec and prove each sees only its own rows.
- Signup must NOT be reachable without whatever control D4 settles on.

## 8. Depends on

Subdomain-scoped login, if that is the model — `tenants.slug` exists but nothing
resolves a tenant from the Host header, and login accepts any tenant's
credentials on any hostname. Sign-up that ends in "go to your subdomain" is not
meaningful until that lands.
