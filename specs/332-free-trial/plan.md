# Implementation Plan: Free trial on signup (web app)

**Branch**: `332-free-trial` (work on local `main`, ticket LIRA-332) | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/332-free-trial/spec.md` (clarified 2026-10-17: 14 days; after the end you can sign in, view and export, with no new records and no grace; an offline PC uploads its pre-end sales).

**Supersedes** decision D2 ("No trial") of `docs/plans/ongoing_plans/SUBSCRIPTION_MANAGEMENT_PLAN.md` §3 for publicly signed-up shops. That file is not edited by this plan. The implementing change adds a one-line pointer (T065).

## Summary

**What changes**:

- A shop created through a public sign-up path (an emailed sign-up link, owner-sent or self-requested, or "Continue with Google") starts on a 14-day trial. The trial is stamped in the same transaction as the tenant, in **both** storage modes (shared file and per-shop file).
- Every page of the web app and the phone app shows the days left and a pre-filled WhatsApp button.
- When the trial ends, the shop can still sign in, view and export, but **every** write is refused with "Your free trial has ended…" until the LiraTek owner activates it or extends it.
- Nothing is deleted. Existing shops and owner-created shops are untouched.

**How**:

- **Storage**: two nullable columns on `tenant_subscriptions` (`trial_started_at`, `trial_ends_at`). There are no new status values. Trial and trial-ended are derived live from `trial_ends_at` vs the clock, so the hourly lapse sweep never touches a trial: no grace by construction (research R1, R2).
- **Time**: the end instant is 00:00 Asia/Beirut on the day after the last trial day. It is computed by one pure, `Intl`-based leaf module and compared with server time.
  - The client's `X-Client-Day` is deliberately **not** trusted for enforcement, because a header the shop controls would extend its own trial (R3, rule 27).
  - The server computes `{standing, trial}` once, and the web, the phone and the owner's list render it (R5, US4).
- **Enforcement**:
  - A new global allowlist gate, `requireOpenTrial`, mounted before the existing read-only **denylist** gate. The denylist is left byte-identical for paying shops (R6).
  - The offline-PC side door is closed in core: the merge round holds post-end events and books pre-end ones (R8), and the PC recorder refuses new offline work after it learns the end.
- **Owner**: new validated `activate` and `extend-trial` routes, audited, separate from Suspend, with a History list in PlanModal (R10).

Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/rest-trial.md](./contracts/rest-trial.md), [contracts/ui-trial.md](./contracts/ui-trial.md), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 20 (Fly image `node:20-bookworm-slim`), Electron 31 (paired-PC recorder only), React 19, Expo (mobile)

**Primary Dependencies**:

- `@liratek/core`: `SubscriptionService` and `SubscriptionRepository`; `TenantProvisioningService` and the `TenantStorageProvisioner` port; `AuditService.logAdminAction`; `OfflineMergeProcessor` and `OfflineDeviceService`; validators.
- Express backend: `backend/src/middleware`, `api/subscription.ts`, `api/admin.ts`, `api/auth.ts`, `api/googleSignup.ts`, `database/perTenantStorageProvisioner.ts`.
- Frontend: `SubscriptionBanner`, `httpClient`, `backendApi`, and the admin Tenants page and PlanModal.
- Mobile: `api/client.ts`, `(app)/_layout.tsx`.

**Storage**: SQLite. One migration, at the **next free version at build time** (the last entry of `packages/core/src/db/migrations/index.ts` + 1; v219 was last on 2026-10-17, and other sessions add migrations at the same time), plus `electron-app/create_db.sql` (rule 10). The migration adds 2 columns and 1 partial index. There is no backfill and no new table.

**Testing**:

- core jest: calendar table, service, provisioning, merge processor;
- backend jest: middleware, sign-up, admin and offline API, with an injected clock;
- frontend jest: banner, PlanCell, PlanModal, httpClient event;
- mobile jest: strip and error mapping;
- electron-app offline jest: recorder and syncClient;
- one new web e2e.

Affected files only, ask before running, and no Electron or desktop e2e on the owner's Mac.

**Target Platform**: the multi-tenant web app, the phone app, and paired offline PCs. The standalone desktop app is explicitly unaffected (FR-021).

**Project Type**: monorepo: web + desktop + mobile off one core

**Performance Goals**: the gate adds one indexed single-row platform lookup per **write** request, the same cost `requireWritableSubscription` already pays on gated prefixes. No cost on reads.

**Constraints**:

- **Fail open**: an unknown standing never blocks and never shows a trial message (SC-006).
- Paying-shop behaviour is byte-identical.
- Exact end instant: no sweep latency.
- Correct across Lebanon's DST changes. Lebanon is +3 in summer and +2 in winter, and the spec's 2026-11-01 example is a winter date.
- The calendar and link helpers are browser- and phone-safe leaves (rule 29).

**Scale/Scope**:

- 1 migration;
- 2 new pure core utils, 1 new seed helper, 1 new validators file;
- service, repository and audit changes;
- 2 provisioners, 3 sign-up/admin routes, 1 new middleware, 1 shared tenant-resolver extraction;
- the merge-processor and checkin hook, and the PC recorder gate;
- banner, httpClient, admin page and modal;
- the mobile strip;
- about 20 test files new or extended, and 1 web e2e.

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1.*

| Principle | How this plan meets it | Status |
| --- | --- | --- |
| **I. One core, two transports** | All policy is in `SubscriptionService` and the pure `trialCalendar`. REST, the phone and the PC read the same view.<br>**Desktop IPC gets no trial by design (FR-021)**: there is no sign-up on desktop and the licence view is stripped. This is the same web-only-by-nature exception as LIRA-306 E1. It is recorded below rather than "worked around" with dead IPC.<br>**Rule 27**: the answer depends on an explicit zone, not on the server's TZ. The client's day is not used, because it is forgeable for an enforcement boundary (R3).<br>**Rule 29**: `trialCalendar.ts` and `activationLink.ts` import nothing from `db/` and no Node built-in. The `browserEntryIsNodeFree` guard covers them. | Pass, with the noted desktop exception |
| **II. Layer boundaries** | SQL stays in `SubscriptionRepository` and `AuditRepository`. The service decides standing and transitions. The middleware and routes only resolve, authorise and call. | Pass |
| **III. Contracts once** | `activateSubscriptionSchema` and `extendTrialSchema` are in `validators/subscription.ts`, exported from `index.ts` **and** `browser.ts`. Adapter payloads are `z.input` (rule 21). The unvalidated legacy PATCH is not extended, so there is no rule-23 diff to do. One seed helper serves both provisioners, and one link builder serves web and phone (rule 14). | Pass |
| **IV. Money integrity** | No money flow is added or changed. The gate refuses writes before any service runs. The offline merge either books an event through the existing ReplayEngine or leaves it `received`, and never partially books one. §13 checklist: N/A (no new transaction, leg, ledger or reversal). | Pass (N/A) |
| **V. Data and security** | `?` placeholders. The control-plane queries carry `tenant_id = ?`, the same as the existing repository. Owner routes are behind `authenticateJWT` + `requireSuperAdmin`, with the actor from the JWT (FR-017). Migration in both files with a `down()`. All new columns are nullable, with no `created_at`/`updated_at` changes needed (the table has them). | Pass |
| **VI. Testing** | Failing-first for every behaviour change. New-contract tests are marked "not proven failing-first (new contract)". The e2e matches rows by identity. Payload names come from the schemas. A web e2e proves the web path. Three premise-changed tests are rewritten, not deleted (R12). | Pass |
| **VII. Code quality** | Strict TS, no `any`. Module loggers. The banner reads `api` through the existing adapter function, and any new `useApi` dependency goes through a ref (rule 25). | Pass |
| **Delivery** | Release note line in `docs/release-notes/UNRELEASED.md` → "🌐 Web app" (FR-023, rule 30), plus a "What users will notice" line in the ticket. | Pass |

**Recorded exceptions**:

- **E-332-1**: no IPC counterpart. The trial is web-only by nature, because the desktop has no sign-up (FR-021).
- **E-332-2**: the owner routes keep the admin router's HTTP 4xx error style instead of 200 envelopes, matching every neighbouring `/api/admin` route. The shop-facing refusal uses HTTP 200 (rule 19c).

**Post-design re-check**: pass. No Complexity Tracking entry is needed.

## Project Structure

### Documentation (this feature)

```text
specs/332-free-trial/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R12 decisions
├── data-model.md        # columns, derived standing, transitions
├── quickstart.md        # boundary table + verification order
├── contracts/
│   ├── rest-trial.md    # status view, refusal envelope, owner routes, offline checkin
│   └── ui-trial.md      # strip / ended alert / WhatsApp link / owner screens
├── checklists/requirements.md
└── tasks.md
```

### Source Code (files this feature touches)

```text
packages/core/src/
├── utils/trialCalendar.ts                 NEW  pure: zone, length, day math, trialView
├── utils/activationLink.ts                NEW  pure: WhatsApp URL builder + number
├── services/subscriptionSeed.ts           NEW  paying / trial seed (one derivation)
├── validators/subscription.ts             NEW  activate / extend schemas
├── validators/index.ts, index.ts, browser.ts   exports
├── repositories/SubscriptionRepository.ts      columns, update keys, list join created_at
├── repositories/AuditRepository.ts             subscription history read
├── services/SubscriptionService.ts             standing, trial view, activate, extendTrial, canWrite
├── services/TenantProvisioningService.ts       `trial` opt-in → subscriptionSeed
├── services/TenantStorageProvisioner.ts        input.subscriptionSeed (shared mode)
├── services/UserInvitationService.ts           trial wording on refusal
├── services/OfflineMergeProcessor.ts           hold post-end events
├── services/OfflineDeviceService.ts            checkin → trial
└── db/migrations/index.ts                      next free version
electron-app/
├── create_db.sql                               columns + index
└── offline/{recorder.ts,syncClient.ts,pairingStore.ts}   PC refuses new work after the end
backend/src/
├── middleware/requestTenant.ts            NEW  shared tenant resolver (extracted)
├── middleware/requireOpenTrial.ts         NEW  allowlist gate
├── middleware/requireWritableSubscription.ts   use resolver; trial wording fallback
├── server.ts                                   mount order
├── database/perTenantStorageProvisioner.ts     input.subscriptionSeed (per-tenant mode)
├── api/auth.ts, api/googleSignup.ts            pass `trial`
├── api/subscription.ts                         view fields; by-key stripped
└── api/admin.ts                                list fields; activate; extend-trial; history
frontend/src/
├── api/httpClient.ts                           TRIAL_ENDED_EVENT
├── api/backendApi.ts                           view type; adminActivate/Extend/History (web-only via assertWebOnly,
│                                               like adminUpdateSubscription; not on ApiAdapter, so no packages/ui change)
├── shared/components/SubscriptionBanner.tsx    trial strip + ended alert
├── features/admin/pages/Tenants/index.tsx      PlanCell + created date
├── features/admin/components/PlanModal.tsx     Activate / Extend / History sections
└── features/admin/hooks/useSubscriptions.ts    mutations
mobile/src/
├── api/client.ts                               top-level `code`
├── api/subscription.ts                    NEW
├── components/TrialStrip.tsx              NEW
├── app/(app)/_layout.tsx                       mount strip
└── auth/messages.ts                            TRIAL_ENDED text
docs/release-notes/UNRELEASED.md                 🌐 Web app line
frontend/tests/e2e-web/lira-web-0NN-free-trial.spec.ts   NEW (next free number)
```

**Structure Decision**: an existing monorepo. Policy goes in core, transport in the backend, and rendering in the frontend and mobile. The PC gate lives inside the existing LIRA-306 offline modules. No new package.

## Phasing

1. **Foundation**: migration; calendar and link utils; seed helper; service standing and view; repository columns. This blocks everything.
2. **US1 (P1, MVP part 1)**: sign-up stamps the trial in both storage modes; status view; strip on web.
3. **US2 (P1, MVP part 2)**: the `requireOpenTrial` gate and its route inventory; ended alert; refusal wording everywhere; export and view proof.
4. **US3 (P1)**: owner activate, extend and history, and the Tenants page.
5. **US4 (P2)**: the boundary and DST table across service, middleware and owner list. Mostly tests on top of Foundation.
6. **US5 (P3)**: phone strip and errors; PC checkin, merge hold and recorder.
7. **Polish**: release note, plan pointer (D2), web e2e, gates.

US1 + US2 + US3 must ship **together**. A trial that starts but cannot end (US1 alone), or that ends with no way for the owner to activate (US1+US2 without US3), is worse than no trial. Do not push to `main` between them, because a push to `main` deploys.

## Owner decision needed

**D-332-A** (research R8): an offline PC that rang up sales *after* the trial ended, before it heard the trial had ended. The plan's default is to **hold them on the server and book them automatically on activation or extension**, never refusing or deleting them. The alternatives are to refuse them into the review list, or to book them anyway. Tasks T057 and T061 implement the default. The other choices would change only T061. PCs that have not installed this update have no recorder gate, so for them the hold path is the main case, not a rare one. The N5 manifest still matches with events held (verified in `compareManifest`), so held events do not strand a PC in `finishing`.

## Complexity Tracking

None.
