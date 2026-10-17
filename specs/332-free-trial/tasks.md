---
description: "Task list for LIRA-332: free trial on signup (web app)"
---

# Tasks: Free trial on signup (web app)

**Input**: Design documents from `/specs/332-free-trial/`:

- [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md)
- [contracts/rest-trial.md](./contracts/rest-trial.md), [contracts/ui-trial.md](./contracts/ui-trial.md)
- [quickstart.md](./quickstart.md)

**Tests**: REQUIRED.

- **Failing first (CLAUDE.md rule 17)**: write each guard first and record its real failure on the unfixed code, then fix. Never revert or re-break finished code to prove a test.
- **New contracts**: a test of a contract that does not exist yet only fails to compile. Mark it "not proven failing-first (new contract)".
- **Affected tests only**: pass explicit file paths, and never run a full jest suite (RAM).
- **Ask the owner before running any test or suite.** Agents follow the same rule.
- **No Electron or desktop e2e on the owner's Mac**: the paired-PC work is proven with jest in `electron-app/offline/__tests__` only.
- **Clock**: backend and middleware boundary tests fake **only the system time**: `jest.useFakeTimers({ now, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] })`, or `jest.setSystemTime` on top of that config. `Intl` honours the faked `Date`. Faking the timers themselves hangs supertest/Express and the merge loop's `await setImmediate`, and a hung suite looks like the worker OOM / fast no-op traps of rules 25 and 28. Core service tests inject `now` through the existing `SubscriptionService(repo, now)` constructor.

**Organization**: grouped by user story. US1 + US2 + US3 ship **together** (plan "Phasing"), and nothing is pushed to `main` in between, because a push deploys.

**Abbreviations**:

| Short | File |
| --- | --- |
| `SS` | `packages/core/src/services/SubscriptionService.ts` |
| `SR` | `packages/core/src/repositories/SubscriptionRepository.ts` |
| `TPS` | `packages/core/src/services/TenantProvisioningService.ts` |
| `TSP` | `packages/core/src/services/TenantStorageProvisioner.ts` |
| `PTP` | `backend/src/database/perTenantStorageProvisioner.ts` |
| `CAL` | `packages/core/src/utils/trialCalendar.ts` |
| `LINK` | `packages/core/src/utils/activationLink.ts` |
| `Banner` | `frontend/src/shared/components/SubscriptionBanner.tsx` |
| `Admin` | `backend/src/api/admin.ts` |

Line numbers drift: search for the named symbol.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [x] T001 Re-read the LAST entry of `packages/core/src/db/migrations/index.ts` (v219 on 2026-10-17; other sessions add migrations) and note the next free version for T009. Do not reserve it anywhere. Use whatever is free at the moment T009 is written.
- [x] T002 [P] Read the three premise-changed suites and list the exact assertions that describe a self-served shop as "unlimited / no trial", so they can be rewritten, not deleted (research R12, rule 24):
  - `packages/core/src/services/__tests__/TenantProvisioning.subscription.test.ts`
  - `backend/src/api/__tests__/signup.api.test.ts`
  - `backend/src/api/__tests__/googleAuth.api.test.ts`

---

## Phase 2: Foundational (blocks every story)

### Tests first

- [x] T003 [P] Write the boundary table in `packages/core/src/utils/__tests__/trialCalendar.test.ts`, every row of quickstart §1:
  - summer 2026-07-15 (+3);
  - winter 2026-11-01 (+2), the spec's US4 date;
  - autumn DST 2026-10-24, including the repeated 23:30;
  - spring DST 2027-03-27, where local 00:00 does not exist and the end must be 03-27 22:00 UTC, not 21:00;
  - each at 00:30, 02:59 and 23:30 on the last day and the day after;
  - the day-count convention (sign-up 2026-10-17 → last day 2026-10-30; day 3 → `daysLeft` 12; last day → 1; the day after → 0 and `ended`);
  - `endsSoon` at 3, 2 and 1 days left, and false at 4.

  Not proven failing-first (new contract).
- [x] T004 [P] Write `packages/core/src/utils/__tests__/activationLink.test.ts`:
  - the URL starts `https://wa.me/96181077357?text=`;
  - the decoded text equals "Hi LiraTek, I'd like to activate my shop {name} ({address})." (FR-007);
  - a missing name or address leaves no "undefined";
  - Arabic or ampersands in the shop name survive encoding.

  Not proven failing-first (new contract).
- [x] T005 [P] Write the time-zone guard in `packages/core/src/utils/__tests__/trialCalendar.icu.test.ts`: `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).resolvedOptions().timeZone === "Asia/Beirut"`, and 2026-07-15T12:00Z formats as 15:00 while 2026-11-01T12:00Z formats as 14:00. This makes a Node build without ICU fail loudly instead of silently computing in UTC (research R3).
- [x] T006 [P] Write `packages/core/src/services/__tests__/SubscriptionService.trial.test.ts` (in-memory DB, injected `now`). It covers:
  - the precedence table of data-model "Derived: standing", all 5 rows, including no row → `null` (fail open) and the broken-invariant row → its paid reading;
  - `canWrite === false` for `trial_ended`, and `true` for `trial`, `active` and `grace`;
  - `statusFor` returns `trial` from the CAL single derivation;
  - `markPaid` on a trial row clears `trial_started_at` and `trial_ends_at`;
  - **no grace for trials (FR-008)**: a `trial_ended` row put through `runLapseSweep()` twice stays exactly as it was (`status='active'`, no `grace_ends_at`).

  The `standing`, `trial` and markPaid-clears cases fail on today's code. The sweep case already passes by construction (R1): record that it was observed passing, as a characterization, not as a failing-first guard.

### Implementation

- [x] T007 Implement CAL, a pure leaf with no import from `db/`, `logger` or `node:*` (rule 29):
  - constants `SHOP_TIME_ZONE = "Asia/Beirut"` and `TRIAL_LENGTH_DAYS = 14` (FR-002: the single place to change it);
  - `shopDayOf`;
  - `startOfShopDay`, which returns the FIRST instant whose Beirut day equals the given day (search forward from a noon-offset estimate);
  - `endOfShopDay`;
  - `trialEndFor`;
  - `trialView(endsAt, now) → { endsAt, lastDay, daysLeft, endsSoon, ended }`.

  Export it from `packages/core/src/index.ts` and `packages/core/src/browser.ts`. Makes T003 and T005 pass.
- [x] T008 [P] Implement LINK: `LIRATEK_WHATSAPP_NUMBER = "96181077357"` and `buildActivationWhatsAppUrl({ shopName, shopAddress })`, a pure leaf. Export it from both core entries. Confirm `src/__tests__/browserEntryIsNodeFree.guard.test.ts` still passes with CAL and LINK reachable (ask before running). Makes T004 pass.
- [x] T009 Write the migration at the next free version (T001) in `packages/core/src/db/migrations/index.ts`:
  - `ALTER TABLE tenant_subscriptions ADD COLUMN trial_started_at DATETIME`;
  - `… ADD COLUMN trial_ends_at DATETIME`;
  - partial index `idx_tenant_subscriptions_trial_ends ON tenant_subscriptions(trial_ends_at) WHERE trial_ends_at IS NOT NULL`;
  - a `down()` that removes both columns and the index (follow the `add-migration` skill);
  - **no backfill**.

  Mirror it in `electron-app/create_db.sql` (columns in `CREATE TABLE tenant_subscriptions`, plus the index), with the desktop seed INSERT unchanged (rule 10). Then `yarn check:schema-equivalence`, expecting 0 diffs.
- [x] T010 Update SR:
  - add both columns to `COLUMNS`, `SubscriptionEntity` and `UpdateSubscriptionData`;
  - `createForTenant` writes `trial_started_at` and `trial_ends_at` (default NULL);
  - `update` applies them only when present (the existing present-keys-only rule);
  - `listAll` also selects `t.created_at AS tenant_created_at`.

  Every statement keeps `tenant_id = ?` or its existing `tenant-exempt` marker. Run `yarn check:tenant-scoping` and `yarn check:bind-arity`.
- [x] T011 Implement in SS:
  - `SubscriptionStatusView.standing: "trial" | "trial_ended" | "active" | "grace" | "read_only"` and `trial: TrialView | null`, derived in `toView` using the injected `now` and `trialView()`;
  - `canWrite = standing !== "read_only" && standing !== "trial_ended"`;
  - the invariant check logs one warning and falls back to the paid reading;
  - `markPaid` also clears `trial_started_at` and `trial_ends_at`;
  - `runLapseSweep` is unchanged.

  Makes T006 pass.
- [x] T012 [P] Create `packages/core/src/services/subscriptionSeed.ts` with `payingSubscriptionSeed()` (today's literal: `plan:"standard", status:"active", current_period_end:null, entitled_modules:null`) and `trialSubscriptionSeed(now)` (the same, plus `trial_started_at` = now and `trial_ends_at` = `trialEndFor(now)`, both as UTC `YYYY-MM-DD HH:MM:SS`). Test it in `packages/core/src/services/__tests__/subscriptionSeed.test.ts`: the paying seed deep-equals the literal both provisioners hard-code today. Not proven failing-first (new contract).
- [x] T013 [P] Create `packages/core/src/validators/subscription.ts` with:
  - `activateSubscriptionSchema = z.object({ until: dateOnly.nullable() })`;
  - `extendTrialSchema = z.object({ lastDay: dateOnly })`;
  - `dateOnly` = `/^\d{4}-\d{2}-\d{2}$/` plus a real-calendar-date refine.

  Export `ActivateSubscriptionInput` and `ExtendTrialInput` (`z.input`) through `validators/index.ts`, so both `index.ts` and `browser.ts` carry them (rule 21). Test in `packages/core/src/validators/__tests__/subscription.test.ts`: 2026-02-30 is rejected, `null` until is accepted, extra keys are stripped. Not proven failing-first (new contract).

**Checkpoint**: core can say, for any row and instant, whether a shop is on a trial, has an ended trial, or pays, and how many days are left.

---

## Phase 3: User Story 1: a new shop starts on a free trial and sees the days left (P1) 🎯 MVP part 1

**Goal**: both public sign-up paths, in both storage modes, create a shop on a 14-day trial. Owner-created and existing shops do not get one. Every web page shows the strip.

**Independent Test**: sign up through the invite link and through Google. Each shop's row has `trial_ends_at` = 00:00 Beirut on day 15. `GET /api/subscription/status` reports `standing:"trial"` with `daysLeft:14`, and the strip renders on every page.

### Tests (write first, see them fail)

- [x] T014 [P] [US1] In `packages/core/src/services/__tests__/TenantProvisioning.trial.test.ts` (new), shared mode:
  - `provisionTenant({..., trial:{source:"invite_link"}})` → a row with `trial_ends_at` = `trialEndFor(now)`;
  - **without** `trial` → a row deep-equal to today's (FR-004);
  - an admin-user failure rolls back, leaving no tenant and no subscription row.

  Rewrite the T002 assertions in `TenantProvisioning.subscription.test.ts` so they state "no trial **when not requested**", not "never".
- [x] T015 [P] [US1] In `backend/src/database/__tests__/perTenantStorageProvisioner.test.ts`: with `subscriptionSeed` carrying a trial, the PLATFORM row has `trial_ends_at` and the shop file has no `tenant_subscriptions` rows (§ 12.2 unchanged). Without a seed, the row is today's literal. Fails today, because PTP hard-codes the literal.
- [x] T016 [P] [US1] In `backend/src/api/__tests__/signup.trial.api.test.ts` (new):
  - invite-link signup, both a `source='self'` invite and an owner-sent invite → `standing:"trial"`, `daysLeft:14`;
  - `POST /api/admin/tenants` → `standing:"active"`, `trial:null` (FR-004);
  - no payment field is accepted or required (FR-003).

  Rewrite the T002 assertions in `signup.api.test.ts`.
- [x] T017 [P] [US1] Google sign-up (in `googleAuth.api.test.ts`, the existing sign-up describe): the new shop is on a trial, and a signup audit row exists with `metadata.via === "google"`. Rewrite the T002 assertions.
- [x] T018 [P] [US1] In `backend/src/api/__tests__/subscriptionStatus.trial.api.test.ts` (new):
  - `GET /api/subscription/status` returns `standing`, `trial` and `shop:{name,address}` for a trial tenant;
  - both fallbacks (platform user, no row) return `standing:"active"`, `trial:null` (SC-006);
  - **FR-021 guard**: `GET /api/subscription/by-key` for a trial tenant that holds a licence key returns `status:"active"` and **no** `standing`, `trial` or `shop` keys.
- [x] T019 [P] [US1] Desktop guard in `electron-app/__tests__/licenseSync.trial.test.ts` (new, jest only): a `/by-key` response for a trial tenant leaves the local row `active` with no trial, and `getSubscriptionStatus` on desktop reports no trial (FR-021).
- [x] T020 [P] [US1] In `frontend/src/shared/components/__tests__/SubscriptionBanner.trial.test.tsx` (new). The `getSubscriptionStatus` mock returns a stable object (rule 25). It covers:
  - `trial` with 12 days → `trial-strip` reads "Free trial: 12 days left";
  - 1 day → "Last day of your free trial";
  - 3 days → the ends-soon text with `lastDay`;
  - the button `href` equals `buildActivationWhatsAppUrl(...)`;
  - `active`, `null` and a rejected promise → nothing renders;
  - `grace` and `read_only` render today's exact text (regression).

### Implementation

- [x] T021 [US1] In TPS, add `ProvisionTenantData.trial?: { source: "invite_link" | "google" }`. The seed is chosen once as `data.trial ? trialSubscriptionSeed(now) : payingSubscriptionSeed()` and passed in `CreateTenantStorageInput.subscriptionSeed` (a new optional field in TSP). `SharedTenantStorageProvisioner.createTenant` uses `input.subscriptionSeed ?? payingSubscriptionSeed()` in place of its literal. Makes T014 pass.
- [x] T022 [US1] In PTP step (a), use `input.subscriptionSeed ?? payingSubscriptionSeed()` in place of the hard-coded `createForTenant` literal, in the same platform transaction. Makes T015 pass.
- [x] T023 [US1] In `backend/src/api/auth.ts`, the invite-link `/signup` handler: pass `trial: { source: "invite_link" }` into `provisionTenant`. This covers both the self-requested and the owner-sent invites (FR-001).
- [x] T024 [US1] In `backend/src/api/googleSignup.ts`: pass `trial: { source: "google" }`. If the route writes no self-service signup audit row, add one that mirrors auth.ts (`metadata.via:"google"`, actor = the new admin, wrapped so it can never fail the committed sign-up). Makes T016 and T017 pass.
- [x] T025 [US1] In `backend/src/api/subscription.ts`:
  - `/status` returns the service view plus `shop:{ name, address }`, where the address is `<slug>.<APP_BASE_DOMAIN>`, or the slug alone when it is unset;
  - both fallbacks gain `standing:"active", trial:null, shop:null`;
  - `/by-key` returns `toDesktopView(view)`, which drops `standing`, `trial` and `shop`.

  Makes T018 and T019 pass.
- [x] T026 [US1] In `frontend/src/api/backendApi.ts`, extend `SubscriptionStatusView` with `standing`, `trial` and `shop`, typed from core's exported view types, not hand-copied (rule 21). Neither IPC nor REST builds a new payload.
- [x] T027 [US1] Banner: render the `trial` states of contracts/ui-trial.md, with the button built by `buildActivationWhatsAppUrl`. The branch is on `standing`, not `status`. `grace` and `read_only` markup stays byte-identical. Makes T020 pass.

**Checkpoint**: new shops are on a trial and see it. Nothing is enforced yet, so **do not push**.

---

## Phase 4: User Story 2: when the trial ends, the shop is asked to activate and loses nothing (P1) 🎯 MVP part 2

**Goal**: after the end instant, every write from the shop's own users is refused with the trial wording. Every read, sign-in and export still works, and no record is touched.

**Independent Test**: move a trial shop's `trial_ends_at` into the past. Sign in, open every page, export, and try a sale: the sale is refused with the trial text, no sale row is created, and all earlier rows are still present.

### Inventory (before the gate exists)

- [x] T028 [US2] **Route inventory**. Enumerate EVERY write route under `backend/src/api/*.ts` and `server.ts`. Grep `router\.(post|put|patch|delete)\(` WITHOUT requiring the path on the same line, because multi-line declarations are common (85 matched the single-line form). Include `/api/auth/*`, `/api/auth/google/*`, `/api/auth/signin-code/*`, `/api/mobile/auth/*`, `/api/password-reset/*`, `/api/user-email/*` and `/api/offline/*`.
  - Classify each as **record-creating**, which stays blocked, or **allowed**, with a one-line reason: view, export, sign-out, account safety, or access-removing.
  - Confirm or drop each provisional entry of research R6, reading each handler: `vouchers/validate` must not write, and the `voice/*` routes must record nothing.
  - Write the final list as `TRIAL_ENDED_ALLOWED_WRITES` (method + path regex + reason comment) in `backend/src/middleware/requireOpenTrial.ts`.
- [x] T029 [P] [US2] **Writes the UI fires without a user action**. Grep `frontend/src` and `mobile/src` for POST/PUT/PATCH/DELETE adapter calls made on mount, on login, or on a timer, not on a button. Each one is either added to the T028 allowlist with a reason, or made to skip when `standing === "trial_ended"`. Otherwise every page load of an ended shop shows an error (FR-009).

### Tests (write first, see them fail)

- [x] T030 [P] [US2] In `backend/src/middleware/__tests__/requireOpenTrial.test.ts` (new):
  - **ended tenant**:
    - POST `/api/sales`, `/api/clients`, `/api/expenses`, `/api/settings/x`, `/api/debts/repayments` and `/api/inventory` (a sample of every T028 "record-creating" family) each → HTTP 200 `{success:false, code:"TRIAL_ENDED", error:"Your free trial has ended. Contact LiraTek on WhatsApp to activate."}`;
    - the handler never runs;
    - every `TRIAL_ENDED_ALLOWED_WRITES` entry → passes;
    - GET passes;
  - **trial / active / grace / read_only tenant** → passes this gate;
  - no bearer token, a platform user, or a device-key request → passes;
  - a thrown subscription lookup → passes (fail open);
  - **ordering**: an ended tenant's POST `/api/users` gets `TRIAL_ENDED`, never `SUBSCRIPTION_READ_ONLY`;
  - **wording**: no response body contains "overdue", "lapsed" or "read-only" (FR-011).

  Not proven failing-first (new contract). The ordering case fails against today's server, because it returns the 402 lapsed text once `canWrite` is false.
- [x] T031 [P] [US2] In `backend/src/middleware/__tests__/requireWritableSubscription.test.ts`, add a case: when it is reached directly with a `trial_ended` view (gate bypassed in the test), it answers with the trial code and wording. The existing `read_only` and `grace` cases stay unchanged and must still pass.
- [x] T032 [P] [US2] In `packages/core/src/services/__tests__/UserInvitationService.trialEnded.test.ts` (new): check/accept into a trial-ended shop is refused (no user created). The message says the free trial has ended and does not mention a subscription lapse. Code `SHOP_NOT_ACTIVE` is kept.
- [x] T033 [P] [US2] In `packages/core/src/services/__tests__/ModuleService.entitlement.test.ts`, add a case: a trial-ended shop's enabled modules are unchanged, so it can still view every module.
- [x] T034 [P] [US2] In `frontend/src/api/__tests__/httpClient.trialEnded.test.ts` (new): a 200 body with `code:"TRIAL_ENDED"` dispatches `TRIAL_ENDED_EVENT` exactly once and still returns the envelope to the caller. Other failure codes dispatch nothing.
- [x] T035 [P] [US2] Banner: in `SubscriptionBanner.trial.test.tsx`, `trial_ended` renders `trial-ended` with the FR-011 text and the WhatsApp button. Firing `TRIAL_ENDED_EVENT` triggers an immediate re-fetch.

### Implementation

- [x] T036 [US2] Extract tenant resolution from `requireWritableSubscription.ts` (`req.user`, else `verifyJwt` on the bearer) into `backend/src/middleware/requestTenant.ts` (`resolveRequestTenantId`). The existing middleware imports it and its behaviour is unchanged. The existing `requireWritableSubscription*.test.ts` files are the regression net.
- [x] T037 [US2] Implement `backend/src/middleware/requireOpenTrial.ts`:
  - pass when the method is not a write, when there is no tenant, or when the path is allowlisted (T028);
  - otherwise `getSubscriptionService().statusFor(tenantId)`, and refuse only when `standing === "trial_ended"`;
  - catch → `next()`;
  - log a `warn` with tenant, method and path;
  - export a `TRIAL_ENDED_MESSAGE` constant, used by every refusal site.

  Mount it in `backend/src/server.ts` immediately BEFORE `app.use(requireWritableSubscription)`. Makes T030 pass.
- [x] T038 [US2] In `requireWritableSubscription.ts`: when `!canWrite` and `standing === "trial_ended"`, answer with the trial code and wording instead of the lapsed text. Makes T031 pass.
- [x] T039 [US2] In `packages/core/src/services/UserInvitationService.ts`, choose the SHOP_NOT_ACTIVE message by standing ("This shop's free trial has ended. Its admin can contact LiraTek to activate."). The `canWrite` call stays where it is. Makes T032 pass.
- [x] T040 [US2] In `frontend/src/api/httpClient.ts`, export `TRIAL_ENDED_EVENT` and dispatch it when a parsed body has `code === "TRIAL_ENDED"`. Makes T034 pass.
- [x] T041 [US2] Banner: add the `trial_ended` alert (contracts/ui-trial.md) and a `TRIAL_ENDED_EVENT` listener that re-runs `load()`. The listener is removed on unmount. Makes T035 pass.
- [x] T042 [US2] Apply the T029 findings: skip or allowlist each automatic write.

**Checkpoint**: a trial ends exactly on time and the shop keeps everything. **Still do not push**: the owner cannot activate yet.

---

## Phase 5: User Story 3: the owner activates or extends a shop (P1)

**Goal**: the LiraTek owner sees every shop's trial state and can Activate subscription (open-ended or until a date) or Extend trial, with history. This is separate from Suspend, and only the super admin can do it.

**Independent Test**: as the super admin, extend shop A and activate shop B (until a date). Each shop's status and gate change on the next request. Shop C is unchanged. A shop admin calling the routes gets 403.

### Tests (write first, see them fail)

- [ ] T043 [P] [US3] In `packages/core/src/services/__tests__/SubscriptionService.ownerActions.test.ts` (new, injected `now`):
  - **`activate(tenantId, null)`** on `trial` and on `trial_ended` → `active`, no period, trial columns NULL;
  - **`activate(tenantId, "2027-10-31")`** → `current_period_end` = `endOfShopDay("2027-10-31")` (UTC `2027-10-31 22:00:00`: DST ends at 00:00 on 2027-10-31, so 11-01 00:00 is +2; verified with Python `zoneinfo`), after which `runLapseSweep` behaves as today;
  - **activate** with `until` already over → refused;
  - **`extendTrial(tenantId, lastDay)`** → `trial_ends_at` = `endOfShopDay(lastDay)`, and an ended trial becomes `trial`;
  - **extend** to a past or today-already-ended day → "Choose a date in the future";
  - **extend** on grace, read-only or active-with-period → "This shop pays; use Activate subscription";
  - **extend** on an owner-created active no-period shop → starts a trial (spec edge case);
  - **neither action** reads or writes `tenants.status` (FR-016).

  Not proven failing-first (new contract).
- [ ] T044 [P] [US3] In `packages/core/src/repositories/__tests__/AuditRepository.subscriptionHistory.test.ts` (new): platform audit rows for tenant A (`entity_type 'subscription'`) are returned newest first, limit 50. Tenant B's rows and other entity types are excluded.
- [ ] T045 [P] [US3] In `backend/src/api/__tests__/admin.trial.api.test.ts` (new):
  - a super admin can call `activate`, `extend-trial` and `history`;
  - a shop admin or staff, including an impersonation token, gets 403 (FR-017);
  - Zod refusals for bad dates;
  - an audit row per action with old and new `{standing, trialEndsAt, trialLastDay, currentPeriodEnd}` (FR-022);
  - **activating A leaves B's row byte-identical** (US3-4);
  - activate on a suspended tenant leaves `tenants.status='suspended'`;
  - `GET /subscriptions` rows carry `standing`, `trial` and `tenant_created_at` (FR-015);
  - after activate or extend, `scheduleOfflineRound` was called with the tenant id (mock).
- [ ] T046 [P] [US3] In `frontend/src/features/admin/pages/Tenants/__tests__/TenantsPage.trial.test.tsx` (new): `PlanCell` shows "Trial · 12 days left · ends 2026-11-01" and "Trial ended 2026-11-01". The Suspend/Activate row button text is unchanged.
- [ ] T047 [P] [US3] In `frontend/src/features/admin/components/__tests__/PlanModal.trial.test.tsx` (new):
  - **"Activate subscription"** with "No end date" sends `{until:null}`, and with a date sends `{until:"YYYY-MM-DD"}`;
  - **"Extend trial"** sends `{lastDay}`;
  - the field names are asserted by parsing the sent body through `activateSubscriptionSchema` and `extendTrialSchema` (rule 24);
  - a server refusal shows inline;
  - **History** renders the entries;
  - neither new button's label is the bare word "Activate" (FR-016).

### Implementation

- [ ] T048 [US3] In SS, add:
  - `activate(tenantId, until: string | null)`: one `SR.update` setting `status:"active"`, `current_period_end`, and `grace_ends_at`, `trial_started_at`, `trial_ends_at` to null;
  - `extendTrial(tenantId, lastDay)`: the rules of data-model "State transitions".

  Both validate against the injected `now` through CAL, and both return `{ before, after }` views for the audit. Makes T043 pass.
- [ ] T049 [US3] History read:
  - `AuditRepository.listSubscriptionHistory(tenantId, limit)`: platform scope through `runWithoutTenant`, `?` placeholders, filtered on `entity_type='subscription'` and the target-tenant metadata (match how `logAdminAction` stores `targetTenantId`);
  - `AuditService.subscriptionHistory(tenantId)`.

  Run `yarn check:tenant-scoping` and mark it `tenant-exempt` with a reason only if the control-plane read needs it. Makes T044 pass.
- [ ] T050 [US3] In Admin, add:
  - `POST /subscriptions/:tenantId/activate` (`validateRequest(activateSubscriptionSchema)`);
  - `POST /subscriptions/:tenantId/extend-trial` (`validateRequest(extendTrialSchema)`);
  - `GET /subscriptions/:tenantId/history`;
  - in `GET /subscriptions`, map rows through the service so each carries `standing` and `trial`.

  Each write route:

  - calls `logAdminAction({ action:"activate_subscription" | "extend_trial", entityType:"subscription", oldValues, newValues })`;
  - calls `scheduleOfflineRound(tenantId)`;
  - uses the admin router's existing error style.

  Static paths stay before `/:id` ones. Makes T045 pass.
- [ ] T051 [US3] In `frontend/src/api/backendApi.ts`, add `adminActivateSubscription(tenantId, body: ActivateSubscriptionInput)`, `adminExtendTrial(tenantId, body: ExtendTrialInput)` and `adminSubscriptionHistory(tenantId)`. Each is `assertWebOnly`, the same as `adminUpdateSubscription`, and the payload types are imported from `@liratek/core` (rule 21). Extend `AdminSubscription` with `standing`, `trial` and `tenant_created_at`. Add the mutations and the history query in `frontend/src/features/admin/hooks/useSubscriptions.ts`, invalidating the subscriptions query.
- [ ] T052 [US3] On the Tenants page and in PlanModal: the `PlanCell` trial texts and a "Created" date, plus the PlanModal sections "Activate subscription", "Extend trial" and "History" (contracts/ui-trial.md), each saved separately. Makes T046 and T047 pass.

**Checkpoint**: US1 + US2 + US3 are complete together. This is the earliest point at which a push to `main` is acceptable (after Polish gates).

---

## Phase 6: User Story 4: days left are the same on every screen and around midnight (P2)

**Goal**: the shop's strip, the owner's list and the gate agree at any instant, and the trial ends on the right Beirut day whatever the server's TZ.

**Independent Test**: set a trial's last day, then with a fake clock at 23:30, 00:30 and 02:59 Beirut on the last day and the day after (summer and winter), compare the status route, the admin list and a POST.

- [ ] T053 [P] [US4] In `backend/src/__tests__/trialBoundary.api.test.ts` (new):
  - a faked system time only (the Tests header `doNotFake` config) over every quickstart §1 row, with the process `TZ` forced to `UTC` for the test, so the server clock really is UTC as on Fly;
  - for each row, assert that `GET /api/subscription/status` `trial.{lastDay,daysLeft,ended}` deep-equals the matching row of `GET /api/admin/subscriptions` (US4-4);
  - POST `/api/sales` is refused **only** on the "ended" rows (US4-1…3, SC-005).

  Add one variant that sends a forged `X-Client-Day` of the previous day on an ended row, and assert that it is **still refused** (research R3: the header is never trusted for enforcement). Not proven failing-first (new contract) for the agreement half. The forged-header half is a guard on T037's design.
- [ ] T054 [US4] If T053 finds any disagreement, fix it at the single derivation (`trialView` / SS `toView`), never per screen (rule 14).

**Checkpoint**: SC-005 is proven on the server. The screens render server values, so they agree by construction (T020 and T046 assert that the rendering uses them verbatim).

---

## Phase 7: User Story 5: the phone app and offline PCs follow the shop's trial (P3)

**Goal**: the phone shows the same strip and refusal. A paired PC uploads and books pre-end sales after the end, holds post-end ones until activation (default D-332-A), and refuses new offline work once it knows the trial ended.

**Independent Test**: for a trial shop with a phone and a PC, end the trial. The phone shows the ended strip and its sale is refused. PC events stamped before the end book after reconnecting. Events stamped after the end stay waiting and then book after Extend. The PC recorder refuses a new offline sale.

### Tests (write first, see them fail)

- [ ] T055 [P] [US5] In `mobile/src/api/__tests__/client.trialEnded.test.ts` (new): a 200 body `{success:false, code:"TRIAL_ENDED", error:"Your free trial…"}` yields `{success:false, error:"TRIAL_ENDED"}`. Today it yields the sentence, so this fails first. `mobile/src/auth/messages.ts` maps it to the FR-011 text.
- [ ] T056 [P] [US5] In `mobile/src/components/__tests__/TrialStrip.test.tsx` (new): the same states and texts as T020 and T035 (12 days / last day / ends soon / ended / nothing for active or null). The button opens `buildActivationWhatsAppUrl(...)` through `Linking.openURL` (mocked).
- [ ] T057 [P] [US5] In `packages/core/src/services/__tests__/OfflineMergeProcessor.trial.test.ts` (new), with an injected `trialEndFor`:
  - one PC with seq 1–2 stamped before the end and seq 3–4 after (by `corrected_at ?? occurred_at`), trial ended → seq 1–2 `booked`, seq 3–4 still `received`, and `next_expected_seq = 3`, with no review item and nothing refused;
  - with `trialEndFor` returning null (activated) → the next round books 3–4;
  - **two PCs**: the paused PC does not block the other PC's pre-end events;
  - **an event uploaded after the end but stamped before it** → booked (FR-019);
  - **manifest**: `compareManifest` for that PC while seq 3–4 are held → `matched: true`, with no `pc_data_mismatch` item (held events explain their rows).
- [ ] T058 [P] [US5] In `packages/core/src/services/__tests__/OfflineDeviceService.trial.test.ts` (new): `checkin` returns `trial:{standing,endsAt}` for a trial or ended shop, `null` for a paying shop, and `null` when the lookup throws (fail open).
- [ ] T059 [P] [US5] In `electron-app/offline/__tests__/recorder.trial.test.ts` (new, jest only):
  - **offline mode, stored trial ended** → an `offline`-class channel returns `{success:false, code:"TRIAL_ENDED"}` and writes no outbox row;
  - a `read` channel and a `local` channel (sign-in) still run;
  - **stored `endsAt` in the past by the PC clock**, standing still `trial` → refused;
  - **no stored trial** → allowed.

  Also, in `electron-app/offline/__tests__/syncClient.test.ts`: the checkin `trial` is persisted through `pairingStore`.

### Implementation

- [ ] T060 [US5] Phone:
  - in `mobile/src/api/client.ts`, read a top-level `code` before `env.error`;
  - add `mobile/src/api/subscription.ts` (`GET /api/subscription/status`);
  - add `mobile/src/components/TrialStrip.tsx`, using core `buildActivationWhatsAppUrl` (the phone already imports core leaves, e.g. `@liratek/core/utils/localDate`);
  - mount it in `mobile/src/app/(app)/_layout.tsx`, refreshing on sign-in, on focus and every 15 min;
  - add the `TRIAL_ENDED` text to `mobile/src/auth/messages.ts`.

  Makes T055 and T056 pass.
- [ ] T061 [US5] In `packages/core/src/services/OfflineMergeProcessor.ts`:
  - add the dependency `trialEndFor?: (tenantId) => number | null` (the default reads `getSubscriptionService().statusFor(tenantId)`, and returns `Date.parse(trial.endsAt)` only when `standing === "trial_ended"`), resolved ONCE per round;
  - in `merge()`, when the head's `corrected_at ?? occurred_at >= trialEnd`, persist `next_expected_seq` as the head (the same as the gap branch) and drop that PC from this round without calling the engine.

  If owner decision D-332-A chooses differently, only this task changes. Makes T057 pass.
- [ ] T062 [US5] In `packages/core/src/services/OfflineDeviceService.ts`, `checkin` adds `trial` (with try/catch → null). Update the checkin result type. Makes T058 pass.
- [ ] T063 [US5] Paired PC:
  - `electron-app/offline/syncClient.ts` stores the checkin `trial` in `pairingStore.ts` (a new optional field; an old pairing file without it reads as `null`);
  - `electron-app/offline/recorder.ts` refuses `offline`/`checkpoint`-class channels with `TRIAL_ENDED` (and the FR-011 text) when the stored trial is ended or its `endsAt <= now`;
  - standalone mode is untouched (FR-021).

  Makes T059 pass. Run `electron-app/offline/__tests__/channelPolicy.complete.test.ts` and `handlerBindingParity.test.ts` as regression (ask first).

**Checkpoint**: no side door. The phone and the PC follow the same rule, and no pre-end sale is lost.

---

## Phase 8: Polish & cross-cutting

- [ ] T064 [P] Release note (FR-023, rule 30): under "## 🌐 Web app" in `docs/release-notes/UNRELEASED.md`, add "New shops now start with a free 14-day trial. You can see how many days are left at the top of every page and in the phone app, and contact us on WhatsApp to activate. When a trial ends you can still sign in, see and export everything; nothing is deleted." Add a "What users will notice:" line to the LIRA-332 ticket in `current_sprint.md`. Then run `node scripts/build-release-notes.cjs --check`.
- [ ] T065 [P] Add a one-line pointer under D2 in `docs/plans/ongoing_plans/SUBSCRIPTION_MANAGEMENT_PLAN.md`: "Superseded for publicly signed-up shops by LIRA-332 (specs/332-free-trial), 2026-10-17." Do this only as part of the implementing change; this planning pass does not edit that file.
- [ ] T066 [P] Log the pre-existing finding from research R10 as a new ticket in `current_sprint.md`: PlanModal "record payment" sends a date-only `periodEnd` that lapses at 00:00 UTC (02:00/03:00 Beirut), a rule-27 defect on the paid path. It is not fixed here.
- [ ] T067 Write the web e2e `frontend/tests/e2e-web/lira-web-0NN-free-trial.spec.ts` (the next free number at build time; 071 was last on 2026-10-17), following quickstart §4 steps 1–7:
  - rows are matched by identity, and deltas are asserted (rule 15);
  - the ended state is set through the fixture's direct DB helper (test setup only);
  - every page in the lira-web-001 list renders for the ended shop **and shows `trial-ended`** (and, in step 2, every page shows `trial-strip`). This proves FR-006 on every page, and a route outside `MainLayout` fails here;
  - Debts export downloads;
  - a sale is refused with the trial text and no new sale row exists;
  - activation clears the alert without signing out (FR-018).

  Ask before running. Use `yarn rebuild:node` first if needed, and never the desktop e2e.
- [ ] T068 Run the gates on affected scope only (ask first):
  - `yarn typecheck`, `yarn lint`;
  - `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`;
  - the explicit test files from T003–T063, `browserEntryIsNodeFree.guard.test.ts`, and the existing `requireWritableSubscription*`, `SubscriptionService.test.ts` and `perTenantStorageProvisioner.test.ts` as regression;
  - `yarn build`.

  Confirm each run actually executed: count the tests reported and check the elapsed time (rule 28a).
- [ ] T069 Walk quickstart §5 on the test tenant with the owner: Google and email-link sign-ups, the phone, a paired PC. Record the results in the ticket.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: T009 needs T001. T011 needs T007 and T010. T021 needs T012.
- **US1 (T014–T027)** needs Phase 2.
- **US2 (T028–T042)** needs T011. T037 needs T028. T042 needs T029.
- **US3 (T043–T052)** needs T011 and T013. T050 needs T048 and T049. T052 needs T051.
- **US4 (T053–T054)** needs T025, T037 and T050.
- **US5 (T055–T063)** needs T025 (phone) and T011 (PC). T061 and T062 are independent of each other. T063 needs T062.
- **Polish** comes after US1–US5. T067 needs US1–US3.
- **Ship rule**: US1, US2 and US3 go together. Never push a state where a trial starts but cannot end or be activated.

### Parallel opportunities

- **Phase 2 tests**: T003, T004, T005 and T006. T008, T012 and T013 can run alongside T007, T009 and T010.
- **US1 tests**: T014–T020 are all [P] (different files).
- **US2**: T029–T035 in parallel, after T028 is started.
- **US3 tests**: T043–T047.
- **US5 tests**: T055–T059. Also, T060 (phone) runs in parallel with T061–T063 (PC).

### Parallel example: US1 tests

```text
Task: "TenantProvisioning.trial.test.ts (core, shared mode)"          # T014
Task: "perTenantStorageProvisioner.test.ts seed case"                 # T015
Task: "signup.trial.api.test.ts"                                      # T016
Task: "googleAuth.api.test.ts trial case"                             # T017
Task: "subscriptionStatus.trial.api.test.ts (+ by-key guard)"         # T018
Task: "licenseSync.trial.test.ts (desktop guard)"                     # T019
Task: "SubscriptionBanner.trial.test.tsx"                             # T020
```

## Implementation Strategy

1. **Phase 1 + Phase 2**: core truth (calendar, columns, standing).
2. **US1 → US2 → US3, as one deliverable** (the MVP). Validate with T067 before any push.
3. **US4**: boundary proof across transports.
4. **US5**: phone and PC.
5. **Polish**: release note, gates, owner walk-through.

## Notes

- **Total tasks: 69.**
  - Setup: 2
  - Foundational: 11
  - US1: 14
  - US2: 15
  - US3: 10
  - US4: 2
  - US5: 9
  - Polish: 6
- The owner decision still open is **D-332-A** (post-end offline events). The default "hold, book on activation" is in T061.
- `.specify/feature.json` was deliberately not touched by this planning pass. Another Spec Kit session owns it.
