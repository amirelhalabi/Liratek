# Setup Wizard — Implementation Plan

> **Status:** Planning  
> **Target:** Desktop (Electron-first, dev mode bypasses wizard)  
> **Author:** Rovo Dev  
> **Date:** 2026-03-03

---

## Overview

A one-time setup wizard that runs on first launch of the Electron app. It collects
the minimum required configuration to make the app usable, replacing the current
hard-coded seed of `admin/admin123` and the default `shop_name = 'Corner Tech'`.

The wizard is skipped entirely in `yarn dev` (web/dev mode) and on any subsequent
launch after setup has been completed.

---

## 🔴 Decisions Required Before Implementation

These must be agreed before a single line is written.

### D-1 — Setup completion flag: DB or file?

Two options for persisting "setup is done":

| Option                                                  | Pros                     | Cons                                            |
| ------------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| **A) `settings` table key** `setup_complete = '1'`      | Already in DB, queryable | DB must exist first; edge case if DB is deleted |
| **B) Sidecar file** (e.g. `.setup_done` next to the DB) | Survives DB recreations  | Extra file to manage, non-obvious               |

**Recommendation:** Option A — `settings` table key. The DB is already the source of truth for all config. If the DB is deleted, a fresh setup is correct behaviour anyway.

---

### D-2 — Which seed data is SKIPPED in wizard mode vs always seeded?

| Data                                  | Always seed   | Take from user in wizard                         |
| ------------------------------------- | ------------- | ------------------------------------------------ |
| Modules (pos, inventory, debts, …)    | ✅            | ❌ (just enable/disable in wizard)               |
| Currencies (USD, LBP, EUR)            | ✅            | ❌ (toggleable in wizard, step is skippable)     |
| Payment methods (CASH, OMT, WHISH, …) | ✅            | ❌ (enable/disable in wizard, step is skippable) |
| Drawers (General, OMT_App, …)         | ✅            | ❌                                               |
| Exchange rates                        | ✅ (defaults) | ❌                                               |
| Suppliers (OMT, Whish, IPEC, Katch)   | ✅            | ❌                                               |
| **Admin user** (`admin/admin123`)     | ❌            | ✅ — Step 1 of wizard                            |
| **Shop name** (`Corner Tech`)         | ❌            | ✅ — Step 1 of wizard                            |

**Conclusion:** Only the admin user creation and shop name are taken from the user. Everything else is pre-seeded as today. The wizard lets the user _configure_ the pre-seeded data (toggle modules, payment methods, currencies) but the seed always runs first so defaults are safe.

---

### D-3 — Opening/Closing/Checkpoint feature toggle

The `opening/closing` feature is currently always active. The wizard and settings should offer a toggle to hide it from:

- The sidebar navigation
- The home grid cards

**Checkpoint** is mentioned as not yet fully implemented. Plan:

- Add a `feature_session_management` settings key (`enabled` | `disabled`)
- Add it to the Settings > Shop Config page as "Opening & Closing Sessions"
- Checkpoint will be a separate `feature_checkpoint` key, added when the feature is complete
- When disabled, the sidebar items and home grid cards for Opening/Closing are hidden (same pattern as module hiding)

**Agreed behaviour:** If the user skips the Sessions step in the wizard, it defaults to **enabled** (safe default).

---

### D-4 — Admin password complexity in wizard

The existing `UsersManager` enforces 8+ chars, uppercase, lowercase, digit. Should the wizard enforce the same rules?

**Recommendation:** Yes — same rules, enforced client-side with visible hints in the UI. Prevents weak passwords from day one.

---

### D-5 — Can the wizard be re-opened after completion?

**Recommendation:** No automatic re-open. But add a hidden "Reset to setup" action in Settings > Danger Zone that clears `setup_complete` and restarts the app (Electron only). This is useful for demos and factory-reset scenarios.

---

### D-6 — WhatsApp config in wizard

WhatsApp config (phone number, API key) is optional and complex. Should it be in the wizard?

**Recommendation:** Include it as a skippable step with a clear "Skip for now" CTA. WhatsApp is a module — if the WhatsApp module is not enabled in the Modules step, this step is auto-skipped.

---

## Pages / Steps Design

**Minimum pages: 4** (plus a final confirmation screen = 5 screens total)

```
┌─────────────────────────────────────────────────────────┐
│  Step 1 of 4 ● ○ ○ ○                                   │
│  Welcome — Admin Account & Shop                         │
│                                                         │
│  Shop Name         [              ]                     │
│  Admin Username    [              ]                     │
│  Admin Password    [              ]                     │
│  Confirm Password  [              ]                     │
│                                  [Next →]               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 2 of 4 ● ● ○ ○                                   │
│  Modules & Features                                     │
│                                                         │
│  [✓] POS              (mandatory, locked)               │
│  [✓] Inventory        (mandatory, locked)               │
│  [ ] Debts                                              │
│  [ ] Exchange                                           │
│  [ ] Recharge                                           │
│  [ ] Expenses                                           │
│  [ ] Maintenance                                        │
│  [ ] Custom Services                                    │
│  [ ] Clients                                            │
│  [ ] Profits                                            │
│                                                         │
│  ── Session Management ──────────────────────────────   │
│  [✓] Enable Opening & Closing Sessions                  │
│                                                         │
│  ── Payment Methods ─────────────────────────────────   │
│  [✓] Cash             (mandatory, locked)               │
│  [✓] OMT                                               │
│  [✓] Whish                                             │
│  [ ] Binance                                            │
│  [✓] Debt             (mandatory, locked)               │
│                                                         │
│  [← Back]                          [Next →]            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 3 of 4 ● ● ● ○                                   │
│  Currencies & Drawers          [Skip — use defaults]    │
│                                                         │
│  Active Currencies:                                     │
│  [✓] USD  [✓] LBP  [ ] EUR                            │
│                                                         │
│  Drawer Currencies: (same UI as Settings today)         │
│                                                         │
│  [← Back]                          [Next →]            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 4 of 4 ● ● ● ●                                   │
│  Additional Users & WhatsApp   [Skip — configure later] │
│                                                         │
│  ── Add Staff Users (optional) ──────────────────────   │
│  [+ Add User]  username / password / role               │
│                                                         │
│  ── WhatsApp Integration (optional) ─────────────────   │
│  Phone Number  [              ]                         │
│  API Key       [              ]                         │
│                                                         │
│  [← Back]                          [Finish Setup →]    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ✓ Setup Complete!                                      │
│  Your shop is ready.                                    │
│                                                         │
│  Shop:  My Shop                                         │
│  Admin: johndoe                                         │
│  Modules enabled: POS, Inventory, Debts, Recharge       │
│                                                         │
│  [Launch App →]                                         │
└─────────────────────────────────────────────────────────┘
```

**Why 4 steps:**

- Step 1 is mandatory and cannot be skipped (admin + shop name)
- Step 2 is mandatory (you must choose your modules/payment methods — but has safe defaults pre-selected)
- Step 3 is skippable (currencies/drawers — defaults are fine)
- Step 4 is skippable (users + WhatsApp — can be done in settings later)

---

## Architecture

### Detection Flow (Electron)

```
Electron main.ts
  └─ DB init & migrations run (always)
  └─ Check settings: setup_complete == '1'?
       ├─ YES → normal boot, seed admin/admin123 is SKIPPED
       └─ NO  → set a flag in the BrowserWindow URL query param:
                 e.g. app://index.html?setup=1
```

The frontend reads this flag from `window.location.search` (or via a new IPC call
`window.api.app.isSetupRequired()`) on mount.

### Detection Flow (Web / `yarn dev`)

```
App.tsx
  └─ VITE_SKIP_SETUP=true (set in .env.dev)
  └─ Setup wizard is never mounted
  └─ App boots normally as today
```

### Frontend Routing

```
App.tsx
  ├─ /setup  → <SetupWizard />   (only if isSetupRequired && !isAuthenticated)
  ├─ /login  → <Login />         (redirects to /setup if setup not complete)
  └─ /*      → <ProtectedRoute>  (redirects to /setup if setup not complete)
```

The `isSetupRequired` flag lives in a new `SetupContext` (or in `AuthContext` as a
boolean). Once the wizard posts the completion payload to the backend, the context
is updated and the user is auto-logged in with the new admin credentials.

### Backend / Electron IPC

New IPC handler: `app.isSetupRequired()` → returns `boolean`

New IPC handler: `app.completeSetup(payload)` where payload is:

```ts
interface SetupPayload {
  shop_name: string;
  admin_username: string;
  admin_password: string;
  enabled_modules: string[]; // array of module keys
  enabled_payment_methods: string[]; // array of PM codes
  session_management_enabled: boolean;
  // Optional
  active_currencies?: string[]; // currency codes
  drawer_currencies?: DrawerCurrency[];
  extra_users?: { username: string; password: string; role: string }[];
  whatsapp_phone?: string;
  whatsapp_api_key?: string;
}
```

The handler:

1. Creates the admin user (skips default `admin/admin123` seed)
2. Saves `shop_name` to settings
3. Applies module enabled/disabled states
4. Applies payment method active states
5. Applies currency active states (if provided)
6. Saves `feature_session_management` setting
7. Creates extra users (if any)
8. Saves WhatsApp config (if provided)
9. Sets `setup_complete = '1'` in settings **last**

### Settings Keys Added

| Key                          | Values                     | Description                               |
| ---------------------------- | -------------------------- | ----------------------------------------- |
| `setup_complete`             | `'0'` / `'1'`              | Has the wizard been completed?            |
| `feature_session_management` | `'enabled'` / `'disabled'` | Show opening/closing in sidebar & home    |
| `feature_checkpoint`         | `'enabled'` / `'disabled'` | (future — when checkpoint is implemented) |

### Session Management Feature Toggle

`feature_session_management` is consumed in:

- `Sidebar.tsx` — hide Opening/Closing nav items when disabled
- `HomeGrid.tsx` — hide Opening/Closing cards when disabled
- Settings > Shop Config — expose the toggle alongside shop name

The same pattern used by `ModuleContext` for hiding modules will be reused here.

---

## Files to Create

| File                                                    | Purpose                                   |
| ------------------------------------------------------- | ----------------------------------------- |
| `frontend/src/features/setup/SetupWizard.tsx`           | Root wizard component, step state machine |
| `frontend/src/features/setup/steps/Step1Account.tsx`    | Shop name + admin account                 |
| `frontend/src/features/setup/steps/Step2Modules.tsx`    | Modules, session toggle, payment methods  |
| `frontend/src/features/setup/steps/Step3Currencies.tsx` | Currency & drawer config (skippable)      |
| `frontend/src/features/setup/steps/Step4Users.tsx`      | Extra users + WhatsApp (skippable)        |
| `frontend/src/features/setup/steps/StepComplete.tsx`    | Summary + launch button                   |
| `frontend/src/features/setup/context/SetupContext.tsx`  | Wizard state across steps                 |
| `electron-app/handlers/setupHandlers.ts`                | IPC: `isSetupRequired`, `completeSetup`   |

## Files Modified

| File                                                           | Change                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `frontend/src/app/App.tsx`                                     | Add `/setup` route, guard logic                                                   |
| `frontend/src/features/auth/context/AuthContext.tsx`           | Expose `isSetupRequired` flag                                                     |
| `electron-app/main.ts`                                         | Skip `admin/admin123` seed when setup not complete; register setupHandlers        |
| `packages/core/src/db/migrations/index.ts`                     | Add migration for `setup_complete` and `feature_session_management` settings keys |
| `packages/core/src/services/SettingsService.ts`                | Add `isSetupComplete()` helper                                                    |
| `frontend/src/shared/components/layouts/Sidebar.tsx`           | Hide Opening/Closing when `feature_session_management = disabled`                 |
| `frontend/src/shared/components/layouts/HomeGrid.tsx`          | Hide Opening/Closing cards when disabled                                          |
| `frontend/src/features/settings/pages/Settings/ShopConfig.tsx` | Add session management toggle                                                     |
| `.env.dev` (frontend)                                          | Add `VITE_SKIP_SETUP=true`                                                        |

---

## Plan Challenges (Self-Review)

### Challenge 1 — Race condition: migrations vs setup check

The setup check (`setup_complete`) must happen **after** migrations run, because the
`settings` table might not exist yet on first launch. Electron's `main.ts` already
runs migrations before any IPC handler is registered, so the order is safe — but
this must be tested explicitly.

### Challenge 2 — Skipping admin seed without breaking web/dev mode

In dev mode there is no setup wizard, so `admin/admin123` must still be seeded.
The condition in `main.ts` must be:

```
if (setup_complete != '1') seed admin
```

…not just "if no users exist". This way, a reset-to-setup scenario doesn't
accidentally re-seed the default password over a legitimate admin account.
**Actually:** On reset-to-setup, `setup_complete` is cleared, but the admin user
already exists. The seed logic must check `setup_complete` AND user count both.

```
if (setup_complete != '1' && userCount == 0) seed admin
```

### Challenge 3 — Web mode (backend API, not Electron)

The backend API (`backend/src/`) has its own user seeding. The setup wizard only
targets Electron. The web backend should continue seeding `admin/admin123` on first
run, as it's assumed to be a dev/staging environment (per `.env.dev`). Document
this clearly. If web first-run setup is needed later, a separate plan is required.

### Challenge 4 — Step 3 (currencies/drawers) complexity

The existing `CurrencyManager.tsx` is complex (300+ lines). Reusing it wholesale
inside the wizard would be unwieldy. The wizard step should be a simplified
"activate/deactivate currencies" list only. Full drawer-per-currency configuration
can remain in Settings — the wizard just selects which currencies are active.

### Challenge 5 — Wizard state on browser refresh

If the user refreshes mid-wizard, state is lost. `SetupContext` should persist
step progress to `sessionStorage` so a refresh restores the last completed step.

### Challenge 6 — Auto-login after wizard completion

After `completeSetup` succeeds, the frontend must auto-login with the new admin
credentials so the user lands directly on the dashboard without a separate login
screen. This requires `AuthContext.login()` to be called from `SetupWizard` after
completion.

---

## Acceptance Criteria

| #     | Criteria                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------ |
| AC-1  | On first Electron launch, the app routes to `/setup` before showing login                        |
| AC-2  | `yarn dev` (web mode) never shows the setup wizard                                               |
| AC-3  | Step 1 cannot be skipped; shop name and admin credentials are required                           |
| AC-4  | Admin password enforces: 8+ chars, uppercase, lowercase, digit                                   |
| AC-5  | POS and Inventory modules are locked enabled; cannot be toggled off                              |
| AC-6  | CASH and DEBT payment methods are locked enabled; cannot be toggled off                          |
| AC-7  | Steps 3 and 4 can be skipped; defaults are applied on skip                                       |
| AC-8  | After `Finish Setup`, the user is auto-logged in as the new admin                                |
| AC-9  | On second launch, `/setup` is never shown again                                                  |
| AC-10 | `feature_session_management = disabled` hides Opening/Closing from sidebar and home grid         |
| AC-11 | `feature_session_management` is toggleable in Settings > Shop Config                             |
| AC-12 | Setup wizard state is restored on browser refresh (sessionStorage)                               |
| AC-13 | Default admin seed (`admin/admin123`) is NOT created when setup wizard is used                   |
| AC-14 | All pre-seeded data (modules, currencies, payment methods, drawers) is seeded before wizard runs |
| AC-15 | A "Reset to Setup" action in Settings clears `setup_complete` and restarts the app               |

---

## Testing Checklist

### Unit Tests

- [ ] `SettingsService.isSetupComplete()` returns false when key is absent or `'0'`
- [ ] `SettingsService.isSetupComplete()` returns true when key is `'1'`
- [ ] `completeSetup` handler creates admin user with correct hashed password
- [ ] `completeSetup` handler saves shop name to settings
- [ ] `completeSetup` handler applies module enabled states correctly
- [ ] `completeSetup` handler does NOT override mandatory modules (POS, Inventory)
- [ ] `completeSetup` handler does NOT disable mandatory payment methods (CASH, DEBT)
- [ ] `completeSetup` sets `setup_complete = '1'` only on full success (not partial)

### Integration Tests

- [ ] First Electron launch → DB created → migrations run → `setup_complete` absent → wizard shown
- [ ] Second Electron launch → `setup_complete = '1'` → wizard not shown → login shown
- [ ] Completing wizard → auto-login works → lands on dashboard
- [ ] Skipping Step 3 → default currencies remain active
- [ ] Skipping Step 4 → no extra users created, WhatsApp not configured
- [ ] `yarn dev` → no wizard, app boots normally, `admin/admin123` seeded

### UI / E2E Tests

- [ ] Step 1: empty shop name → Next button disabled
- [ ] Step 1: password mismatch → validation error shown
- [ ] Step 1: weak password → validation error shown
- [ ] Step 2: toggling POS or Inventory off → toggle is blocked / snaps back
- [ ] Step 2: toggling CASH or DEBT off → toggle is blocked
- [ ] Step 3: Skip → proceeds to Step 4 without error
- [ ] Step 4: Skip → proceeds to completion without error
- [ ] Complete wizard → summary screen shows correct shop name, admin, enabled modules
- [ ] Complete wizard → `Launch App` redirects to dashboard and user is authenticated
- [ ] Refresh mid-wizard on Step 3 → wizard restores to Step 3 with filled data
- [ ] `feature_session_management = disabled` → Opening/Closing absent from sidebar
- [ ] `feature_session_management = disabled` → Opening/Closing cards absent from home grid
- [ ] Settings > Shop Config → toggle session management → sidebar updates without reload
- [ ] Settings > Danger Zone → Reset to Setup → app restarts to wizard on next launch

### Regression Tests (ensure nothing is broken)

- [ ] Existing dev workflow (`yarn dev`) still works unchanged
- [ ] Login page still functions normally after setup is complete
- [ ] All existing settings pages still work (ShopConfig, Modules, PaymentMethods, etc.)
- [ ] Opening/Closing modals still work when `feature_session_management = enabled`
- [ ] All existing IPC handlers still register correctly alongside the new setupHandlers

---

## Implementation Order

1. **Migration** — add `setup_complete` and `feature_session_management` settings keys
2. **Backend** — `SettingsService.isSetupComplete()`, `setupHandlers.ts` IPC
3. **Electron `main.ts`** — skip admin seed when setup not done; register handler
4. **Feature toggle** — `feature_session_management` in Sidebar, HomeGrid, ShopConfig
5. **SetupContext** — wizard state with sessionStorage persistence
6. **Step components** — Step1 → Step2 → Step3 → Step4 → StepComplete
7. **SetupWizard root** — step state machine, progress indicator
8. **App.tsx routing** — `/setup` route + guard
9. **AuthContext** — expose `isSetupRequired`, auto-login after wizard
10. **Testing** — unit, integration, E2E per checklist above
