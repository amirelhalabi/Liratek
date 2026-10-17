# Research: Free trial on signup (LIRA-332)

**Date**: 2026-10-17. **Input**: [spec.md](./spec.md), including Clarifications 2026-10-17.

All file and line references were read from `main` on 2026-10-17. Line numbers drift, so search for the named symbol.

**What this feature supersedes.** It supersedes decision **D2 ("No trial")** in `docs/plans/ongoing_plans/SUBSCRIPTION_MANAGEMENT_PLAN.md` §3, and the "No trial" row of its §6 table, which points at `provisionTenant` stamping `active` with a NULL period end. Per the brief, this spec does not edit that file. A follow-up note there belongs to the implementing change (task T065).

---

## What exists today (verified)

| Piece | Where | What it does today |
| --- | --- | --- |
| Commercial state | `tenant_subscriptions` (v173). Platform file only in per-tenant mode | `status` CHECK `('active','grace','read_only')`, plus `current_period_end`, `grace_ends_at`, `license_key`, `entitled_modules`, `notes`. One row per tenant (unique index). |
| Policy | `packages/core/src/services/SubscriptionService.ts` | `statusFor`, `canWrite` (false only in `read_only`), `markPaid`, and `runLapseSweep` (active→grace→read_only, one step per run). It has an injected clock (`now`). |
| SQL | `packages/core/src/repositories/SubscriptionRepository.ts` | Forces platform scope (`runWithoutTenant`). `findLapsed` selects `status='active' AND current_period_end IS NOT NULL AND current_period_end <= ?`. |
| Hourly sweep | `backend/src/services/lapseSweep.ts` | Runs `runLapseSweep` at boot and then hourly. Server only. |
| Write block | `backend/src/middleware/requireWritableSubscription.ts`, mounted globally in `server.ts` (`app.use(requireWritableSubscription)`) | **A DENYLIST** of admin prefixes (users, settings, modules, catalogues…). It is deliberately written never to block trading. Refusals return HTTP 402 `{success:false, error, code:"SUBSCRIPTION_READ_ONLY"}`. It reads the tenant from `req.user`, or else from the bearer JWT (`verifyJwt`). It fails open. |
| Status read | `backend/src/api/subscription.ts`: `GET /status` (JWT) and `GET /by-key` (desktop licence) | Two hand-built permissive fallbacks: platform user, and no row. |
| Provisioning | `TenantProvisioningService.provisionTenant` → port `TenantStorageProvisioner` | **Both** implementations hard-code `createForTenant(id, {plan:"standard", status:"active", current_period_end:null, entitled_modules:null})`: `SharedTenantStorageProvisioner` (core) and `perTenantStorageProvisioner.ts` (backend, platform transaction step a). |
| Sign-up paths | `backend/src/api/auth.ts` `POST /api/auth/signup` | Invite-link path: `SignupInvitationService.consume`. It serves both `source='self'` (asked for by email) and owner-sent invites. |
| | `backend/src/api/googleSignup.ts` | "Continue with Google". |
| | `backend/src/api/admin.ts` `POST /api/admin/tenants` | Owner-created. |
| Owner surface | `admin.ts`: `GET /subscriptions`, unvalidated `PATCH /subscriptions/:tenantId` (`periodEnd` → `markPaid`), `PATCH /tenants/:id` (`status` suspend/activate) | Audited with `AuditService.logAdminAction`, which never throws. |
| | `frontend/src/features/admin/pages/Tenants/index.tsx` (`PlanCell`, Suspend/Activate button) and `components/PlanModal.tsx` (record payment = date-only `periodEnd`) | |
| Banner | `frontend/src/shared/components/SubscriptionBanner.tsx`, mounted in `MainLayout.tsx` | Renders nothing when `status === "active"`. Refreshes every 15 min. Wording: "Payment overdue" / "Read-only". |
| Day helpers | `utils/localDate.ts` (browser leaf), `utils/requestDay.ts` (`clientDay()`, server-only) | Web and phone send the `X-Client-Day` and `X-Client-Tz-Offset` headers. |
| Phone | `mobile/src/api/client.ts` | Uses the same REST API and envelope. On failure it reads `env.error` (string, or `{code}`) as its code. It has no subscription call today. |
| Paired offline PC | `backend/src/api/offline.ts` (device-key auth, **no JWT**), `OfflineEventService.upload`, `OfflineMergeProcessor.merge` → `ReplayEngine` | Books events directly through core. The HTTP middleware never sees them. The order key is `corrected_at ?? occurred_at`. On the PC, `electron-app/offline/recorder.ts` gates channels by mode. |
| Desktop licence | `electron-app/licenseSync.ts` | Copies only `status` / `current_period_end` / `entitled_modules` from `/by-key`, and validates `status` against the 3 known values. |

---

## Decisions

### R1: Storage is two nullable columns on `tenant_subscriptions`, not new `status` values

- **Decision**: add `trial_started_at DATETIME NULL` and `trial_ends_at DATETIME NULL` (an absolute UTC instant, `YYYY-MM-DD HH:MM:SS`, the same shape as `CURRENT_TIMESTAMP`). The rules:
  - `trial_ends_at IS NULL` means not on a trial.
  - `status` stays `active` for the whole trial, ended or not.
  - The two trial standings are **derived**, never stored.
- **Rationale**:
  - Widening the `status` CHECK means a 12-step table rebuild of a table that also exists in every per-shop file.
  - It would also break `licenseSync`'s status validator, which refuses unknown values. That touches the desktop (FR-021).
  - NULL columns grandfather every existing shop and every owner-created shop with no backfill (FR-004, SC-001 "0 existing shops").
  - `findLapsed` only moves rows with a non-NULL `current_period_end`. A trial row has none, so the hourly sweep can never move a trial into grace. That gives FR-008's "no grace" by construction, and a test pins it.
- **Alternatives rejected**:
  - New status values (`trial`, `trial_ended`): rebuild cost, desktop validator, and the sweep would have to flip `trial` → `trial_ended`, up to an hour late.
  - A separate `tenant_trials` table: one more control-plane table to classify in `tenantSplit`, `platformSplitGuard`, `resetTables`, `offline/tables.ts`, `idRange.ts` and `tenantSnapshot.ts`, for a 1:1 fact.

### R2: The end is a stored instant, compared live, never swept

- **Decision**: a trial is ended when `now >= trial_ends_at`. `now` comes from the service's injected clock. This is checked on every request, so expiry is exact to the second. **No sweep transition is added.**
- **Rationale**:
  - The hourly sweep would end trials up to 59 minutes late.
  - It would also make the 23:30 / 00:30 / 02:59 boundary tests depend on when the sweep last ran.
  - A live comparison makes the activate and extend actions take effect on the next request, well inside FR-018's 15 minutes.
- **Alternative rejected**: sweep-driven standing. It is late, and it has more states to keep consistent.

### R3: The shop's day comes from an explicit `Asia/Beirut` zone, not from the client and not from the server clock (rule 27)

- **Decision**:
  - One pure leaf module, `packages/core/src/utils/trialCalendar.ts`. It must not import `db/`, the logger, or any Node built-in, because the phone and the browser may import it (rule 29).
  - It holds `SHOP_TIME_ZONE = "Asia/Beirut"` and `TRIAL_LENGTH_DAYS = 14` (FR-002: one place).
  - It provides these functions:
    - `shopDayOf(instant: Date): string`, using `Intl.DateTimeFormat("en-CA", {timeZone})`;
    - `startOfShopDay(day: string): Date`, the UTC instant of 00:00 Beirut on that day, offset resolved through `Intl` so DST is handled;
    - `trialEndFor(signupInstant: Date): Date`, which is `startOfShopDay(shopDayOf(signup) + 14 days)`;
    - `endOfShopDay(day)`, which is `startOfShopDay(day + 1)`, used by Extend and by Activate-until-date;
    - `trialView(endsAt, now)`, which returns `{ lastDay, endsAt, daysLeft, endsSoon, ended }`.
- **Rationale**:
  - Rule 27 says an answer must not depend on where the code runs. An explicit IANA zone gives the same answer on Fly (UTC) and on any machine.
  - Rule 27's usual remedy, "the client supplies its day", is **rejected for enforcement**. `X-Client-Day` is a request header that the shop controls. Trusting it would let a shop keep its trial alive by sending yesterday's date.
  - A fixed `+180` minutes is also wrong. Lebanon observes DST. Python `zoneinfo` gives **+3 until 2026-10-24 and +2 from 2026-10-25** (verified 2026-10-17), and the repo's "Beirut = 180" comments hold only in summer.
  - The spec's Assumptions confirm that every shop is in Beirut today.
- **Consequence for the spec's US4 examples**: last day 2026-11-01 falls in winter (+2), so 02:59 Beirut = **00:59 UTC on 2026-11-01**. The server's own date already agrees at that moment. The "server still says 10-31" case happens only between 00:00 and 01:59 Beirut on that date.
  - The test table therefore adds a **summer** last day (2026-07-15, +3), where 02:59 Beirut = 23:59 UTC the day before.
  - It also adds a **DST-changeover** last day (2026-10-24 / 10-25).
- **Likely, based on Node 20 shipping full ICU and the `node:20-bookworm-slim` Docker base**: `Intl` time-zone support is present on Fly. Task T005 asserts it in a unit test, so a missing ICU fails loudly instead of silently using UTC.
- **Alternatives rejected**:
  - `clientDay()`: forgeable.
  - `TZ=Asia/Beirut` on the server: rule 27 says not to.
  - A stored "last day" string with the instant derived from it: also valid. Storing the instant was chosen because the comparison is then a plain string or number compare with no zone math on the hot path. `lastDay` is derived for display, a single derivation that both screens use (rule 14).

### R4: Day-count convention, pinned by the spec's own examples

- **Decision**:
  - The sign-up day is **day 1**.
  - The last day is the sign-up day + 13 (14 calendar days in Beirut).
  - `daysLeft = (lastDay − today) + 1` while `today ≤ lastDay`, so it counts today.
  - `endsSoon = daysLeft ≤ 3`.
  - On the last day `daysLeft = 1`, and the strip says "Last day of your free trial".
  - After the last day, `ended = true` and `daysLeft = 0`.
- **Check against the spec**:
  - US1-3: day 3 → (D+13) − (D+2) + 1 = **12** ✓
  - US1-4: "3 days or fewer" ✓
  - US4-1: last day 00:30 → "last day" ✓
  - US4-3: next day 00:30 → ended ✓
  - FR-014: never "0 days" while the shop's day is still a trial day ✓
- **Consequence**: a shop that signs up at 23:50 Beirut gets 13 days plus 10 minutes. This is accepted, and it follows the spec's own example ("ends N days later" in calendar days).

### R5: One derived standing, with a written precedence order

- **Decision**: `SubscriptionService` derives `standing` once, and every consumer reads that:
  1. no row → `null` (fail open: no strip, no gate);
  2. `trial_ends_at` set and `now < trial_ends_at` → `trial`;
  3. `trial_ends_at` set and `now >= trial_ends_at` → `trial_ended`;
  4. otherwise `status` (`active` | `grace` | `read_only`), unchanged.
- **Invariant**: the service only ever sets `trial_ends_at` on a row with `status='active'` and `current_period_end IS NULL`. Both Activate and markPaid clear `trial_started_at` and `trial_ends_at`.
- **Fallback**: a row that breaks the invariant (hand-edited) reads by the paid columns, steps 4 first. A paying shop is never told "trial ended" (SC-006).
- **View changes**:
  - `SubscriptionStatusView` gains `standing` and `trial: TrialView | null`.
  - `canWrite` becomes `false` for `trial_ended` as well as `read_only`. Each consumer is reviewed in R7.
- **The two hand-built fallbacks** in `backend/src/api/subscription.ts` (platform user, no row) set `standing:"active"` and `trial:null`.

### R6: Enforcement is an allowlist gate, separate from the read-only denylist

- **Decision**: add a new global middleware `requireOpenTrial` (`backend/src/middleware/requireOpenTrial.ts`).
  - **Placement**: mounted in `server.ts` immediately **before** `requireWritableSubscription`, so a trial-ended shop always gets the trial wording, never "subscription has lapsed".
  - **Scope**: only write methods (POST/PUT/PATCH/DELETE) that carry a tenant JWT.
  - **Refusal**: when `standing === "trial_ended"`, refuse every write **except** `TRIAL_ENDED_ALLOWED_WRITES`. The refusal is HTTP **200** `{ success:false, error:"Your free trial has ended. Contact LiraTek on WhatsApp to activate.", code:"TRIAL_ENDED" }`. That is rule 19c's envelope. The existing gate's 402 is not copied, because a 402 makes `httpClient` throw an `ApiError` whose message some callers swallow.
  - **Tenant lookup**: extracted from `requireWritableSubscription` into one shared helper, `backend/src/middleware/requestTenant.ts`, so it is not duplicated.
  - **Fails open**: no tenant, no row, or a thrown lookup lets the write through, the same as today.
- **Why an allowlist here when the existing gate is a denylist**:
  - The existing gate's comment explains that a forgotten trading route must stay writable, because a paying shop must never lose its till.
  - The owner decision for an ended **trial** is the opposite: "NO new records of any kind" (Clarifications Q2).
  - For a shop that never paid, a forgotten route failing closed is the intended outcome. A forgotten read-like POST failing closed is the risk, and task T028's inventory exists for it.
- **The allowlist**: initial, confirmed route by route in T028. Each entry carries the reason it creates no business record.
  - Ending a session, viewing or exporting: `POST /api/auth/logout` (the phone signs out through it too, because `mobileAuth.ts` only has `/login`), `POST /api/profits/unlock`, `POST /api/profits/lock`, `POST /api/audit/search`, `POST /api/reports/pdf` (export), `POST /api/reports/backup/verify`.
  - Account safety: `POST /api/password-reset/change`, `/api/user-email/me/change`, `/api/user-email/verify`, `DELETE /api/auth/google/link`.
  - Access-removing: `POST /api/user-invitations/:id/revoke`, `POST /api/offline/devices/:id/revoke`.
  - Conditional entries: `POST /api/vouchers/validate` stays only if T028 confirms it does not write. `voice` start/stop/audio stays only if it records nothing.
- **Not affected**:
  - Public routes with no bearer token (login, sign-up, Google sign-in, sign-in code, password-reset request) pass because there is no tenant.
  - Device-key routes (`/api/offline/*` PC side) pass, and R8 covers them.
- **Pairing a PC after the end**: `POST /api/offline/pair` carries no bearer token, so it passes the gate. This is **allowed on purpose**. Pairing is configuration, not a business record. The new PC's first checkin reports `trial_ended` (R8), so its recorder refuses new work, and in standby it only shows the web app, which is gated. Refusing it in `OfflineDeviceService.pair` was rejected, because it would add a second refusal site for no data-safety gain.
- **Impersonation**: a super admin impersonating the shop is gated like the shop. The owner extends or activates first. This keeps a single rule.
- **Alternative rejected**: adding every trading prefix to the existing denylist. That flips a deliberate production-incident fix for paying shops, and it still misses future routes.

### R7: Every `canWrite` consumer, decided

| Consumer | Today | With `trial_ended` | Change |
| --- | --- | --- | --- |
| `requireWritableSubscription` | 402 on admin prefixes when `!canWrite` | Never reached for `trial_ended`, because `requireOpenTrial` runs first and refuses with TRIAL_ENDED. Still reached in fail-open edge cases. | Message branch: if `standing === "trial_ended"`, return the trial code and text instead of the lapsed text (defence in depth). |
| `UserInvitationService` (`canWrite` → SHOP_NOT_ACTIVE) | Refuses check/accept for a read-only shop | It must also refuse accept, because accepting creates a user, which is a new record. | Keep `canWrite`. The thrown message is chosen by standing: "This shop's free trial has ended…" vs today's text. |
| `ModuleService.filterByEntitlement` | Uses `entitledModules` only | No change: the modules stay visible (view everything). | None. Add a test. |
| `licenseSync` / `/by-key` (desktop) | Copies `status` | A trial tenant's `status` is still `active`, so the desktop never sees a trial. | `/by-key` returns `standing` and `trial` **stripped** (`toDesktopView`), plus a guard test (FR-021). |
| `preload.ts` `license.status` type / `electron.d.ts` | `canWrite: boolean` | Desktop values are unchanged. | None. The desktop channel never carries a trial. |

### R8: Paired offline PC: the rule lives in core, keyed on the event's own time

- **Decision**:
  - `OfflineMergeProcessor` gets an injected `trialEndFor(tenantId): number | null` dependency (the default reads `SubscriptionService`, platform scope).
  - While computing each PC's head, if the trial has ended and the head event's `corrected_at ?? occurred_at` is `>= trial_ends_at`, that PC is **paused for this round**. The head is dropped from the merge without advancing `next_expected_seq`, the event stays `received`, and nothing is booked or refused.
  - Events from before the end are booked as normal (FR-019 "accepted").
  - The periodic sweep (`OfflineMergeProcessor` "shops with events waiting") and an explicit `scheduleOfflineRound(tenantId)` from the Activate and Extend routes resume booking after the owner acts.
- **Why the event's own time**: upload time would refuse a sale rung up on Saturday and uploaded on Monday after a Sunday end, and FR-019 says no sale is ever lost. The clock-corrected time (FR-022 of LIRA-306) is the server's best estimate of when the sale happened.
- **PC side**:
  - `OfflineDeviceService.checkin` returns `trial: { standing, endsAt } | null`.
  - `electron-app/offline/syncClient.ts` stores it in `pairingStore`.
  - `electron-app/offline/recorder.ts` refuses `offline`/`checkpoint`-class channels with code `TRIAL_ENDED` when the stored standing is `trial_ended`, or when the stored `endsAt <= now` on the PC clock. Reads and `local` channels (sign-in, print) still run.
  - Unknown means allow (fail open).
- **Not the suspension path**: the shipped "stops sending and receiving while suspended" rule (`deviceAuth`) blocks uploads entirely, which would strand pre-end sales on the PC.
- **⚠ OWNER DECISION NEEDED (D-332-A)**: a PC that worked offline **after** the end, before it heard the trial had ended, has post-end events. This plan's default is **hold and book on activation**: they stay waiting on the server, are never refused or deleted, and book automatically once the owner activates or extends. The alternatives are "refuse them, and they appear as refused review items" or "book them anyway". The default keeps the data-safety promise and is reversible.
- **The N5 manifest is unaffected (verified).** `OfflineEventService.compareManifest` explains PC rows from `created_json` of **every** stored event for that device (`OfflineEventRepository.createdJsonForDevice`, no status filter). A held (`received`) event therefore explains its rows: there is no `pc_data_mismatch`. The finisher only needs the events acked plus the manifest accepted ("matched or not", `modeSwitch.ts`), so a PC with held events returns to standby normally.
- **PCs that have not installed this update** have no recorder gate. They keep recording offline after the end, which makes the hold path the main case for them, not a rare one. That is another reason the default must be data-safe.
- **Manual review actions** (`/api/offline/review/:id/apply`…) are JWT writes. They are refused while the trial is ended and work after activation. The quickstart documents this.

### R9: Provisioning: explicit opt-in, one seed helper, both storage modes

- **Decision**:
  - `ProvisionTenantData` gains `trial?: { source: "invite_link" | "google" }`, default absent (no trial).
  - The service computes the seed **once** with `trialSubscriptionSeed(now)` in `packages/core/src/services/subscriptionSeed.ts`. It returns `{plan, status:"active", current_period_end:null, entitled_modules:null, trial_started_at, trial_ends_at}`, or the paying default when there is no trial.
  - It passes the result in `CreateTenantStorageInput.subscriptionSeed`.
  - **Both** `SharedTenantStorageProvisioner` and `perTenantStorageProvisioner.ts` replace their hard-coded literal with `input.subscriptionSeed ?? payingSubscriptionSeed()`. That is the same shape as the `adminEmailFields` single-derivation precedent (rule 14).
  - The callers that pass `trial` are only `auth.ts` invite signup (both `source` values, FR-001) and `googleSignup.ts`. `admin.ts` `POST /tenants` and every script or test that omits it keep today's behaviour (FR-004).
- **Where the sign-up path is recorded**: in the existing self-service signup audit row (`metadata.via`). The Google route gets the same audit with `via:"google"` if it lacks one (T024). No new column is added.

### R10: Owner actions are new validated routes, not new PATCH keys

- **Decision**:
  - `POST /api/admin/subscriptions/:tenantId/activate`, body `activateSubscriptionSchema = { until: "YYYY-MM-DD" | null }`.
  - `POST /api/admin/subscriptions/:tenantId/extend-trial`, body `extendTrialSchema = { lastDay: "YYYY-MM-DD" }`.
  - Both schemas live in `packages/core/src/validators/subscription.ts` and are exported from **both** core entries (`index.ts`, `browser.ts`) for the adapter type (rule 21).
  - They sit behind the router-level `authenticateJWT, requireSuperAdmin` (FR-017).
- **Semantics**:
  - **Activate**: one repository update sets `status:"active"`, `current_period_end` = `until ? endOfShopDay(until) : NULL`, `grace_ends_at:NULL`, `trial_started_at:NULL`, `trial_ends_at:NULL`. `tenants.status` (suspension) is untouched. That covers the "activate a suspended shop" edge case.
  - **Extend**: allowed when the row has `trial_ends_at` set, **or** when it has `status='active' AND current_period_end IS NULL` (the spec's edge case: the owner can put an owner-created shop on a trial). It sets `trial_ends_at = endOfShopDay(lastDay)`, and `trial_started_at` too if it is NULL. It is refused when `endOfShopDay(lastDay) <= now` ("Choose a date in the future"), and refused for grace/read-only or paid-period rows ("This shop pays; use Activate subscription").
- **Not the existing PATCH**: `PATCH /subscriptions/:tenantId` has no schema. Adding keys there would trigger rule 23's three-way diff on a route whose other keys (`entitledModules`, `licenseKey`) this feature does not own.
- **Audit (FR-022)**:
  - Each action calls `AuditService.logAdminAction` with `entityType:"subscription"`, `action:"activate_subscription" | "extend_trial"`, and old/new `{standing, trialEndsAt, currentPeriodEnd}`.
  - The owner sees the history through a new read, `GET /api/admin/subscriptions/:tenantId/history`, which returns platform audit rows for that tenant and `entity_type='subscription'`. PlanModal shows them in a list.
  - **Known limit**: `logAdminAction` never throws (B-D3). An audit write failure is logged and the action still applies. This is the same trade-off every owner action already makes. A dedicated history table (R1, rejected) would close it at the cost named there.
- **Pre-existing finding, not fixed here**: PlanModal's "record payment" sends a date-only `periodEnd`. `findLapsed` compares it as a string against `YYYY-MM-DD HH:MM:SS` UTC, so a paid period lapses at 00:00 **UTC** on that date, which is 02:00 or 03:00 Beirut. That is a rule-27 defect on the paid path. The new Activate route avoids it by storing `endOfShopDay(until)`. The legacy PATCH path is left as is and logged for a ticket (T066).

### R11: Screens: one status read, rendered everywhere

- **Web**:
  - `SubscriptionBanner` branches on `standing`. `trial` → a slim strip ("Free trial: N days left", or the ends-soon variant with the date) with a "Contact us to activate" button. `trial_ended` → a full-width alert with the FR-011 text and the WhatsApp button. Every other standing keeps today's exact rendering.
  - The WhatsApp URL comes from one pure builder, `buildActivationWhatsAppUrl({ shopName, shopAddress })`, in `packages/core/src/utils/activationLink.ts` (browser-safe leaf). It produces `https://wa.me/96181077357?text=…`, the same format as `landing/wa.html`.
  - `GET /api/subscription/status` adds `shop: { name, address }`. The address is `<slug>.<APP_BASE_DOMAIN>`, built server-side so every client shows the same thing.
- **Refused writes**: `httpClient` dispatches a `TRIAL_ENDED_EVENT` when a response body has `code === "TRIAL_ENDED"`. The banner listens and re-fetches, so a cashier who hits the end mid-shift sees the message right away instead of only a toast (FR-011, edge case "trial ends while mid-sale").
- **Phone**:
  - New `mobile/src/api/subscription.ts` calls `GET /api/subscription/status`.
  - A `TrialStrip` in `mobile/src/app/(app)/_layout.tsx` uses the same builder.
  - `mobile/src/api/client.ts` reads a top-level `code` before `env.error`, because the TRIAL_ENDED body carries its code at the top level. Today it would surface the sentence as the "code".
- **Owner list**:
  - `GET /api/admin/subscriptions` adds the derived `standing` and `trial` per row (the service computes it; rule 14).
  - `PlanCell` shows "Trial · 12 days left (ends 2026-11-01)" or "Trial ended 2026-11-01".
  - PlanModal gets an "Activate subscription" section (open-ended or until a date) and an "Extend trial" section. The existing Suspend/Activate button text is unchanged (FR-016).
- **Desktop (standalone)**: `getSubscriptionStatus` on IPC reads the local licence row, which never carries a trial (R7). The strip therefore never renders on desktop (FR-021). No IPC channel is added. This is web-only by nature, the same as LIRA-306 exception E1.

### R12: Tests that change premise (rewrite, do not delete; rule 24)

- `packages/core/src/services/__tests__/TenantProvisioning.subscription.test.ts` asserts "active, NULL period, no trial" for every provisioning call. It stays true for the no-`trial` call. A new case covers `trial`.
- `backend/src/api/__tests__/signup.api.test.ts` and `backend/src/api/__tests__/googleAuth.api.test.ts`: any assertion that a self-served shop is unlimited becomes "on a 14-day trial".
- `backend/src/middleware/__tests__/requireWritableSubscription*.test.ts`: unchanged behaviour for `read_only` and `grace`. One added case shows `trial_ended` gets the trial wording.

## Owner decision 2026-10-17 — D-332-A

Sales that a paired PC records offline after the trial ended, before it hears about the end, are **held on the server and booked automatically when the owner activates the shop**. Nothing is refused or deleted, and they stay out of the books until activation. The other research defaults stand: pairing a PC after the end stays allowed, users can change their own password and email, and super-admin impersonation is blocked like the shop.

## Owner decision 2026-10-17 (after build): what an ended trial may still do

From the blocked list in write-inventory.md, the owner allowed two more:
- `POST /api/reports/backup`, so the shop can back up its own data.
- `PUT /api/users/:id/active`, only when it deactivates (`is_active: 0`). Re-activating stays refused.

Still refused: Google link/start, offline review dismiss/reviewed, WhatsApp sends.
