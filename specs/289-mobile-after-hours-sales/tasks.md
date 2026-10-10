---
description: "Task list for LIRA-289 — mobile app for after-hours digital sales"
---

# Tasks: Mobile app — owner records and tracks digital sales from the phone

**Input**: Design documents from `specs/289-mobile-after-hours-sales/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mobile-api.md, quickstart.md

**Tests**: Required. The constitution (§VI, CLAUDE.md rule 17) makes failing-first guard tests mandatory: write each test task first, run it against the unfixed code, record the real failure, then implement. Never revert finished code to prove a test. If a guard was written after its fix, mark it "not proven failing-first".

**Organization**: Tasks are grouped by user story. "Owner" = a user with role `admin` (spec, third round).

## Progress (2026-10-10)

- **Done (22 of 62):** T001–T004, T006, T007–T012 (double-save protection, migration v208), T013, T014, T016, T020, T023, T027, T029, T030, T032–T034.
- **Partial:**
  - T026: sign-in form without Google.
  - T024: `POST /login` only.
- **Not done in Setup/Foundational:**
  - T005 (mobile lint/`expo export` CI job);
  - T015 (client tests).
- **Changes from the plan** (research R11/R12):
  - SDK 55;
  - the app lives in `mobile/src/app/` (Expo Router `src/` layout), not `mobile/app/`;
  - "Create your shop" reuses `POST /api/auth/signup/request`, so T024's `/signup-link` is dropped;
  - `mobile/babel.config.js` and a Metro blockList were added;
  - `backend/package.json` now declares `ws`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1–US5, mapped to spec.md User Stories 1–5

## Path conventions

- Core: `packages/core/src/`
- API: `backend/src/`
- Desktop IPC: `electron-app/`
- Web: `frontend/src/`
- Phone: `mobile/` (new)

After any core change, rebuild core and sync it: `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: The Expo workspace exists, builds and type-checks inside the monorepo.

- [x] T001 Confirm the current Expo SDK and its React / React Native versions against `frontend/package.json` (`react ^19.2.0`) and record the chosen SDK in `specs/289-mobile-after-hours-sales/research.md` R8 (Verify item)
- [x] T002 Scaffold the Expo app (TypeScript strict, Expo Router) in `mobile/` with `mobile/package.json` named `@liratek/mobile`, and add `"mobile"` to the root `package.json` `workspaces`
- [x] T003 Configure Metro in `mobile/metro.config.js` for the Yarn 4 `node-modules` monorepo, with a resolver alias that maps only the needed core validator modules (`packages/core/src/validators/financial.ts`, `debt.ts`, `common.ts`, `closing.ts`, `mobileAuth.ts`). Never map `packages/core/src/index.ts` (it pulls `better-sqlite3`). Do not import the whole `browser.ts` barrel (research R8).
- [x] T004 [P] Add `zod` at the same major as `packages/core/package.json` (`^4.3.6`) to `mobile/package.json`, and make `mobile/tsconfig.json` strict with path aliases matching T003
- [ ] T005 [P] Add `mobile` lint, `tsc --noEmit` and `npx expo export --platform all` (bundle check that catches DOM and Hermes gaps) scripts to `mobile/package.json`, and wire them into `.github/workflows/ci.yml` as a separate job
- [x] T006 [P] Create `mobile/app.json` (app name "LiraTek", bundle id / package `shop.liratek.app`, scheme `liratek`) and `mobile/eas.json` with `development`, `preview` and `production` profiles

**Checkpoint**: `yarn workspace @liratek/mobile typecheck` and `expo export` succeed on an empty app.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The phone's HTTP client and the server-side duplicate-submission guard, used by every story.

### Tests (write first, see them fail)

- [x] T007 [P] Write `packages/core/src/repositories/__tests__/IdempotencyRepository.test.ts`:
  - claim + store-response + replay;
  - a concurrent claim with the same `(tenant_id, user_id, route, idem_key)` replays instead of re-running;
  - `{success:false}` responses are NOT stored;
  - rows older than 24 h are deleted by the sweep.
- [x] T008 [P] Write `backend/src/api/__tests__/idempotency.api.test.ts` against `POST /api/services/transactions` and `POST /api/debts/repayments`:
  - two requests with one `Idempotency-Key` give one transaction and an identical replayed body;
  - two parallel requests give one transaction;
  - a business refusal followed by a retry with the same key runs fresh;
  - no header means unchanged behaviour.

### Implementation

- [x] T009 Add migration v202 `idempotency_keys` to `packages/core/src/db/migrations/index.ts`, with `down()`, and to `electron-app/create_db.sql`.
  - Columns: `id` INTEGER PK, `tenant_id` INTEGER NOT NULL, `user_id` INTEGER NOT NULL, `idem_key` TEXT NOT NULL ("client UUID … 8–128 chars `[A-Za-z0-9-]`"), `route` TEXT NOT NULL, `response_json` TEXT, `created_at`, `updated_at`.
  - Unique index `(tenant_id, user_id, route, idem_key)`.
  - Re-read the last migration entry first. If v202 is taken, use the next free number.
- [x] T010 Implement `packages/core/src/repositories/IdempotencyRepository.ts` (extends `BaseRepository`, tenant-scoped, `?` placeholders): `claim`, `storeResponse`, `findResponse`, `deleteOlderThan(hours)`
- [x] T011 Implement `backend/src/middleware/idempotency.ts`. When `Idempotency-Key` is present, the claim, the route's service call and the stored success response run in ONE SQLite transaction: no `pending` state, and a crash rolls everything back (data-model.md). It replays stored responses and does not store `{success:false}`. Mount it on `POST /api/services/transactions` (`backend/src/api/services.ts`) and `POST /api/debts/repayments` (`backend/src/api/debts.ts`).
- [x] T012 Add `deleteOlderThan(24)` for idempotency keys to the hourly sweep in `backend/src/services/authCleanupSweep.ts`
- [x] T013 [P] Implement `mobile/src/api/client.ts`. It sends:
  - `Authorization: Bearer`;
  - `X-Client-Day` (the phone's local `YYYY-MM-DD`);
  - `X-Client-Tz-Offset` (copy the exact expression from `frontend/src/api/httpClient.ts:251`, same sign);
  - an optional `Idempotency-Key`.

  It also:
  - stores `X-Renewed-Token` when present;
  - normalises any non-2xx JSON body to `{success:false,error}` (`POST /api/debts/repayments` returns 400);
  - maps network failure to a `NO_CONNECTION` error with no retry queue (FR-018).
- [x] T014 [P] Implement `mobile/src/auth/tokenStore.ts` on `expo-secure-store` (token, shop slug, shop name), plus `mobile/src/auth/AuthContext.tsx`. The `api` instance is read through a ref inside effects (rule 25).
- [ ] T015 [P] Write `mobile/src/api/__tests__/client.test.ts`: the headers are present, a renewed token is stored, a 400 JSON body is normalised, and a network error gives `NO_CONNECTION`

**Checkpoint**: The duplicate guard is live on the two write routes. The phone client is ready.

---

## Phase 3: User Story 1 — Sign in and land in the right shop (P1) 🎯 MVP

**Goal**: An admin signs in with Google or with shop + username + password, and lands in their one shop.

**Independent Test**: With two shops, each with an `admin` user with different passwords, sign in by password with shop A and with shop B, and by Google. Each time only that shop's data is shown (quickstart Slice 1).

### Tests (write first, see them fail)

- [x] T016 [P] [US1] Write `backend/src/api/__tests__/mobileAuth.api.test.ts` covering every row of quickstart Slice 1:
  - shop A + A's password → success with `sessions.device_type = 'mobile'`;
  - shop A + B's password, an unknown shop, or an inactive shop → the identical `INVALID_CREDENTIALS` body;
  - staff → `ADMIN_ONLY` with no session row;
  - a lapsed shop signs in and returns `shop.status`;
  - an existing web session is still valid after the phone signs in;
  - revoking the phone session → 401;
  - unknown shop / unknown user take comparable time to a wrong password (dummy hash compare).
- [ ] T017 [P] [US1] Extend `backend/src/api/__tests__/mobileAuth.api.test.ts` for Google (mock JWKS):
  - admin in exactly one shop → success;
  - no directory match → `GOOGLE_NOT_CONNECTED`;
  - staff only → `ADMIN_ONLY`;
  - admin in two shops → `MULTIPLE_SHOPS` with no shop list in the body;
  - reused or expired nonce, or wrong `aud` → `INVALID_GOOGLE_TOKEN`.
  - Run the role lookups in per-tenant DB mode too.
- [ ] T018 [P] [US1] Extend `packages/core/src/services/__tests__/GoogleAuthService.test.ts` so `verifyIdToken` accepts an allow-list of audiences and still rejects any `aud` outside it

### Implementation

- [ ] T019 [US1] **Verify (research R6) before T022–T024.** Pick the native Google sign-in library. On a real Android and iOS build, record which client ID appears in the ID token's `aud`, and whether a server-issued nonce can be embedded. Write the result into `research.md` R6. If the nonce cannot be passed, switch T022–T024 to the code + PKCE fallback (`expo-auth-session`, with the server exchanging the code) and skip T021.
- [x] T020 [P] [US1] Create `packages/core/src/validators/mobileAuth.ts`:
  - `mobileLoginSchema`: `shop` slug, `username`, `password`, optional `deviceName` ≤ 100 chars;
  - `mobileGoogleSchema`: `idToken`, `nonce`, optional `deviceName`;
  - `mobileSignupLinkSchema`: `email`.

  Export it from `packages/core/src/validators/index.ts`.
- [ ] T021 [P] [US1] Add the platform table `mobile_google_nonces` to `packages/core/src/db/migrations/index.ts` (same migration as T009, or the next one) and to `electron-app/create_db.sql`:
  - columns: `id`, `nonce_hash` TEXT UNIQUE NOT NULL ("sha256 of the nonce; the raw nonce is never stored"), `expires_at` ("issued + 10 min"), `used_at` ("single use"), `created_at`, `updated_at`.

  Also implement `packages/core/src/repositories/MobileNonceRepository.ts` on the platform DB (pattern: `signin_codes`, v199), and add its sweep to `backend/src/services/authCleanupSweep.ts`.
- [ ] T022 [US1] Extend `GoogleAuthService.verifyIdToken` in `packages/core/src/services/GoogleAuthService.ts` to take an audience allow-list. Add env `GOOGLE_MOBILE_CLIENT_IDS` (comma-separated) in `packages/core/src/config/env.ts`. Existing web callers keep passing the single web client ID.
- [x] T023 [US1] Implement `packages/core/src/services/MobileAuthService.ts` (no SQL; repositories only, rule 13):
  - `loginWithShop`: tenant by slug via the tenant repository. Then, inside `runWithTenant(tenant.id)`, authenticate the username in that tenant only, require `role === 'admin'`, and create the session with `deviceType 'mobile'` and `deviceInfo = deviceName`. Use a dummy hash compare when the shop or user is unknown.
  - `loginWithGoogle`: verify, consume the nonce, read `signin_directory` matches for the `sub`, look up each match's role inside `runWithTenant(match.tenant_id)`, and keep admins in active or lapsed shops. Exactly one → session. Otherwise return the refusal codes in `contracts/mobile-api.md`.
- [ ] T024 [US1] (partial 2026-10-10: `POST /login` built and mounted, curl-verified locally for admin / wrong password / unknown shop / other shop / staff; the shop/role logic lives in the route for now and moves into `MobileAuthService` with T023; Google routes pending; "Create your shop" reuses the web's `POST /api/auth/signup/request`) Implement `backend/src/api/mobileAuth.ts`:
  - `POST /login`, `POST /google/nonce`, `POST /google`, `POST /signup-link`;
  - `validateRequest` with the T020 schemas, the existing failed-login rate limiter, and the HTTP 200 envelope;
  - the same token response shape as `POST /api/auth/login` (`backend/src/services/webLoginSession.ts`);
  - `/signup-link` calls the existing LIRA-278 create-shop-by-email service and always returns `{success:true}`.

  Mount it at `/api/mobile/auth` in `backend/src/server.ts`, without `authenticateJWT`.
- [ ] T025 [US1] Reject the device date on mobile writes. In `backend/src/middleware/auth.ts`, when the session's `device_type === 'mobile'` and the method is a write, refuse with `{success:false,error:"DEVICE_CLOCK"}` if `X-Client-Day` is more than 1 day from the server's UTC day. Web and desktop are unchanged (spec FR-011). Add the test to `backend/src/middleware/__tests__/` first.
- [ ] T026 [P] [US1] (partial 2026-10-10: shop/username/password form, "Create your shop" and refusal messages built in `mobile/src/app/(auth)/`; Google button waits for T019) Build `mobile/app/(auth)/sign-in.tsx`:
  - "Continue with Google";
  - shop address + username + password, with the shop pre-filled from `tokenStore`;
  - "Create your shop" (email → `/signup-link`, then "check your email");
  - a message for each refusal code (`GOOGLE_NOT_CONNECTED` explains connecting Google in web Settings).
- [x] T027 [US1] Add a sign-in gate in `mobile/app/_layout.tsx`: a stored valid token opens `(app)`, and a 401 anywhere clears the token and returns to sign-in. Add `mobile/app/(app)/settings.tsx` with Sign out (`POST /api/auth/logout`, phone token only) and a "Delete account" link to the web.
- [ ] T028 [US1] Check production `APP_BASE_DOMAIN` / `TENANT_DB_MODE` with `yarn api secrets list` (never `flyctl` directly). Record the values in `research.md` R5. Add `GOOGLE_MOBILE_CLIENT_IDS` to the Fly secrets checklist in `docs/OPERATIONS.md`.

**Checkpoint**: The T016–T018 suites are green. A dev build signs in on Android and iOS.

---

## Phase 4: User Story 2 — Record a digital sale from the phone (P1)

**Goal**: An admin records WHISH_APP / OMT_APP transfers and Katsh / iPick vouchers, paid by `CUSTOMER_ACCOUNT`, `WHISH`, `OMT` or `BINANCE`, with results identical to the counter.

**Independent Test**: For each provider × payment, the phone payload gives the same drawer, debt, fee and profit deltas as the web payload, and a void nets every ledger to 0 (quickstart Slice 2).

### Tests (write first, see them fail)

- [x] T029 [P] [US2] Write `packages/core/src/utils/__tests__/servicePayloads.test.ts` for the shared builders (T032):
  - fixtures from the current inline bodies in `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx:369-430` and `KatshForm.tsx:1725-1770`;
  - every built object parses through `createFinancialServiceSchema`;
  - field names come from the schema (rule 24).
- [x] T030 [P] [US2] Write `packages/core/src/repositories/__tests__/FinancialServiceRepository.phoneSales.test.ts`:
  - for `WHISH_APP`, `OMT_APP`, `Katsh`, `iPick` × `CUSTOMER_ACCOUNT`, `WHISH`, `OMT`, `BINANCE`, snapshot the drawer balances and client debt, create, and assert deltas (rule 15);
  - headline case: WHISH_APP SEND $50 paid with `WHISH` nets `Whish_App` to +fee;
  - void each one through the existing void path and assert a net 0 per ledger per currency (rule 20);
  - `clientId` propagates to `transactions.client_id` (rule 11).
- [ ] T031 [P] [US2] Add web-form regression tests in `frontend/src/features/recharge/components/__tests__/` asserting both forms call the shared builders (T032) and send unchanged bodies

### Implementation

- [x] T032 [US2] Extract pure builders into `packages/core/src/utils/servicePayloads.ts`:
  - `buildWalletTransferPayload` (WHISH_APP/OMT_APP: fee into `whishFee`/`omtFee`, payments, `cashoutMethod`);
  - `buildVoucherSalePayload` (Katsh/iPick: `itemKey`, `itemCategory`, `cost`, `checkoutTotal`, `tender_exchange_rate`, `telecomCreditReturns`, `mobileServiceItemId`).

  Type the input and output as `z.input<typeof createFinancialServiceSchema>`. No Node or DOM imports (rule 29). Export from `packages/core/src/browser.ts` and `index.ts`.
- [x] T033 [US2] Switch `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` and `KatshForm.tsx` to the T032 builders (one payload shape, rule 22). The existing form tests must stay green.
- [x] T034 [US2] Add `mobile/src/api/endpoints.ts` with typed calls: `recordServiceSale(payload, idemKey)` → `POST /api/services/transactions`, `getVoucherCatalog()` → `GET /api/mobile-service-items`, `searchClients(q)` → `GET /api/clients?search=`. Use only the core input types, never hand-written types (rule 21).
- [ ] T035 [US2] (Katsh/iPick catalog sales done 2026-10-10 in LIRA-302, `specs/302-mobile-catalog-sales/`; bills not on the phone by owner decision) (partial 2026-10-10: WHISH_APP / OMT_APP SEND built in `mobile/src/app/(app)/sale/[provider].tsx` — client search or new client, on account / Whish wallet / OMT wallet, one Idempotency-Key per Save tap, no-connection message; Katsh/iPick vouchers and Binance deferred by owner decision 2026-10-10) Build `mobile/app/(app)/sale/[provider].tsx` for `WHISH_APP`, `OMT_APP`, `Katsh`, `iPick`:
  - SEND only for transfers;
  - client picker (required when the payment is `CUSTOMER_ACCOUNT`, FR-004);
  - payment choice limited to `CUSTOMER_ACCOUNT | WHISH | OMT | BINANCE` (FR-003, no cash);
  - voucher catalog cards for Katsh/iPick;
  - payload from the T032 builders, with no `transaction_time` (the phone never backdates);
  - one `Idempotency-Key` per Save tap, reused on retry;
  - Save disabled while posting;
  - "Not saved — no connection" on `NO_CONNECTION`;
  - the server's low-balance refusal shown as the web shows it.
- [ ] T036 [US2] Add a sale picker (4 tiles) to `mobile/app/(app)/index.tsx`. Hand-over flows are never shown (FR-005).
- [ ] T037 [US2] Run the `docs/FEATURE_GUIDE.md` §13 checklist against the phone payloads and record the result in `specs/289-mobile-after-hours-sales/research.md` (new section "§13 run").

**Checkpoint**: The T029–T031 suites are green. A phone sale shows on the web Transactions page with the right client and amounts.

---

## Phase 5: User Story 3 — Sales count on the local day; the count already includes them (P1)

**Goal**: Every day-grouped report uses the shop's local date. The count screen lists sales since the last count. Saved counts never change.

**Independent Test**: Quickstart Slice 0 + Slice 3, on desktop and web.

This phase does not depend on US1/US2 and can ship first (plan "Slice 0").

### Tests (write first, see them fail)

- [x] T038 [P] [US3] Write `packages/core/src/repositories/__tests__/TransactionRepository.localDay.test.ts`:
  - two rows at 00:30 Beirut, one stored as ISO `…T21:30:00.000Z` (`transaction_time`) and one as `YYYY-MM-DD 21:30:00` (`CURRENT_TIMESTAMP` shape);
  - the list `from`/`to` filter, `getDailySummary` and `getCashFlowByDate` all place both on the Beirut date for a fixed client offset.
- [x] T039 [P] [US3] Write `frontend/src/features/audit/hooks/__tests__/useTransactionRows.localDay.test.ts`: the date filter places both timestamp shapes on the local date, and parses the space form as UTC (append `Z`)
- [x] T040 [P] [US3] Write `packages/core/src/repositories/__tests__/ClosingRepository.sinceLastCount.test.ts`:
  - count `Whish_App`, then post sales → exactly those are returned;
  - CHECKPOINT transactions and `CHECKPOINT_ADJUSTMENT_METHOD` legs are excluded;
  - `is_auto` rows are excluded by default (rule 26);
  - mixed timestamp shapes are compared through `julianday()`;
  - a never-counted drawer has no lower bound and a cap of 200;
  - the saved `daily_closings` / `daily_closing_amounts` rows are unchanged (SC-003);
  - the next expected amount = count + sales (SC-004).
- [x] T041 [US3] **Verify** in T040 whether a WHISH_APP SEND paid with `CUSTOMER_ACCOUNT` writes a `payments` row on `Whish_App`. If it does not, extend the T043 predicate so the sale still appears.

### Implementation

- [x] T042 [US3] Make the day filters and buckets in `packages/core/src/repositories/TransactionRepository.ts` use `reportingTimeFragments` (`localDayExpr`, `dateRange`): the list filters (around `:1481-1488`), `getDailySummary` (around `:9331, 9346`) and `getCashFlowByDate` (around `:1411-1440`). Normalise through `datetime()`/`julianday()`, never raw string order (rule 14, research R2).
- [x] T043 [US3] Add `getTransactionsSinceLastCount(drawerNames)` to `packages/core/src/repositories/ClosingRepository.ts` per data-model.md. Add a `ClosingService.getTransactionsSinceLastCount` pass-through in `packages/core/src/services/ClosingService.ts` (no SQL).
- [x] T044 [P] [US3] Add `sinceLastCountSchema` (`drawers`: non-empty array of drawer names) to `packages/core/src/validators/closing.ts`
- [x] T045 [US3] Add `GET /api/closing/since-last-count` (admin, `authenticateJWT` then `requireRole(["admin"])`, envelope) in `backend/src/api/closing.ts`, with a test in `backend/src/api/__tests__/`
- [x] T046 [US3] Add the IPC `closing:get-since-last-count` (`requireRole`, `validatePayload`) in `electron-app/handlers/dbHandlers.ts`, the preload binding in `electron-app/preload.ts`, and the type in `frontend/src/types/electron.d.ts`
- [x] T047 [US3] Add the dual-mode `getTransactionsSinceLastCount` in `frontend/src/api/backendApi.ts` (`ipcOrHttp`), expose it on `ElectronApiAdapter.ts`, and type it in `packages/ui/src/api/types.ts` from the schema input type (rule 21)
- [x] T048 [US3] Fix the local-date filter in `frontend/src/features/audit/hooks/useTransactionRows.ts`: compare local dates, and parse the `YYYY-MM-DD HH:MM:SS` shape as UTC
- [x] T049 [US3] Show "N sales since the last count" with the list on the drawer count screen (the component using `frontend/src/features/closing/hooks/useDrawerCheckpoint.ts`) through `useApi()`
- [ ] T050 [P] [US3] Add desktop e2e `frontend/tests/e2e-electron/lira-289-since-last-count.spec.ts` and web e2e `frontend/tests/e2e-web/lira-web-289-since-last-count.spec.ts`. Match rows by identity and assert deltas (rule 15).

**Checkpoint**: A 00:30 sale shows on one date on every page. The count screen lists sales since the last count on desktop and web.

---

## Phase 6: User Story 4 — Track sales and balances on the phone (P2)

**Goal**: The phone shows wallet and voucher balances, sales since the last count (and by date), and a client's debt.

**Independent Test**: After a few phone sales, the home screen's balances and list match `GET /api/dashboard/drawer-balances` and `GET /api/closing/since-last-count` (spec Story 4).

- [x] T051 [P] [US4] Add `getDrawerBalances()` → `GET /api/dashboard/drawer-balances`, `getSinceLastCount(drawers)` → `GET /api/closing/since-last-count`, `getTransactionsByDate(from,to)` → `GET /api/transactions/recent`, and `getClientDebtTotal(id)` → `GET /api/debts/clients/:clientId/total` to `mobile/src/api/endpoints.ts`
- [ ] T052 [US4] (partial 2026-10-10: balances, latest transactions and a since-last-count summary per wallet drawer done; per-transaction list and date switcher pending) Build the home screen `mobile/app/(app)/index.tsx`:
  - balances for `Whish_App`, `OMT_App`, `Binance`, `Katsh`, `iPick`;
  - "Since last count" (union over those drawers), with time, type, client, amount and payment;
  - a date switcher for "by date";
  - pull-to-refresh.
- [x] T053 [US4] Build `mobile/app/(app)/client/[id].tsx` showing the client's total debt (FR-015)
- [ ] T054 [P] [US4] Add component tests in `mobile/app/__tests__/home.test.tsx`: the balances render, the list renders, and the `useApi`-style mock returns a stable reference (rule 25)

**Checkpoint**: The owner can check balances before accepting a night request.

---

## Phase 7: User Story 5 — Record a wallet repayment (P3)

**Goal**: An admin records a customer repayment paid into the Whish, OMT or Binance wallet.

**Independent Test**: The repayment from the phone gives the same debt and drawer deltas as one from the counter (spec Story 5).

- [x] T055 [P] [US5] Write `packages/core/src/repositories/__tests__/DebtRepository.walletRepayment.test.ts`: repayments with `payments` on `WHISH`/`OMT`/`BINANCE` lower the debt and raise that drawer by the same amount (deltas), and a void nets to 0 per currency
- [x] T056 [US5] Add `recordRepayment(payload, idemKey)` → `POST /api/debts/repayments` in `mobile/src/api/endpoints.ts`, typed `z.input<typeof addRepaymentSchema>`. The fields come from the schema (`clientId`, `amountUSD`, `amountLBP`, `payments[]`); never snake_case copies (rule 22).
- [x] T057 [US5] Add a "Record repayment" form to `mobile/app/(app)/client/[id].tsx`: amount, currency, wallet choice `WHISH | OMT | BINANCE`, an Idempotency-Key per tap, and the same no-connection handling as T035

**Checkpoint**: The on-account loop can be closed from the phone.

---

## Phase 8: Polish and cross-cutting

- [ ] T058 [P] Add release-note lines to `docs/release-notes/UNRELEASED.md`:
  - Transactions: "sales made after midnight now show on the right date everywhere";
  - closing: "the count screen lists sales since the last count";
  - a new "📱 Mobile app" heading once the app ships.

  Also add the "What users will notice" line to LIRA-289 in `current_sprint.md` (rule 30).
- [ ] T059 [P] Store readiness, recorded in `docs/OPERATIONS.md`:
  - Android and iOS OAuth clients;
  - privacy policy URL (`landing/privacy.html`);
  - a delete-account link;
  - EAS `production` builds;
  - Apple 4.8 and account-deletion confirmation at the first review (research R9).
- [ ] T060 Phone UI e2e (choose Maestro or Detox and record the choice in `research.md`): sign in, after-hours WHISH_APP on account, airplane-mode Save shows "Not saved", double-tap creates one sale. The flows go in `mobile/e2e/`.
- [ ] T061 Run every constitution gate:
  - `yarn lint`, `yarn typecheck`;
  - `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`;
  - core, backend, electron and frontend jest (confirm the suite and test counts actually ran, rule 28);
  - `yarn build`, `node scripts/build-release-notes.cjs --check`;
  - the `mobile` typecheck, lint and `expo export`.
- [ ] T062 Update the LIRA-289 status in `current_sprint.md` and the coverage index in `frontend/tests/e2e-electron/README.md`

---

## Dependencies and execution order

- **Setup (T001–T006)** blocks only the phone tasks (`mobile/`). The server and web tasks can start at once.
- **Foundational (T007–T015)** blocks US2 and US5 (idempotency) and every phone screen (client and token store).
- **US3 (T038–T050)** is independent of everything else. Start it first: it is plan Slice 0 + 2, and fixes desktop and web on its own.
- **US1 (T016–T028)** comes after Foundational. T019 (Verify) gates T021–T024.
- **US2 (T029–T037)** comes after Foundational. Its phone screens need US1's sign-in (T026–T027) for manual testing; the core and web tasks (T029–T033) don't.
- **US4 (T051–T054)** needs T043–T045 (the since-last-count route) and US1.
- **US5 (T055–T057)** needs Foundational and US1. It can share T053's screen.
- **Polish** comes last.

Story order: US3 ∥ (Foundational → US1 → US2 → US4 → US5) → Polish.

## Parallel examples

- **Kick-off:** T038, T039 and T040 (US3 tests) alongside T001–T006 (Expo scaffold) and T007–T008 (idempotency tests). They touch disjoint files.
- **US1:** T016, T017 and T018 together; then T020 and T021 together.
- **US2:** T029, T030 and T031 together, before T032.
- **US3:** T044 alongside T042/T043, then T045–T047 in order (shared adapter files).

## Implementation strategy

1. **First release (no phone yet):** US3. Local-date reports and the since-last-count list ship to desktop and web users. Low risk, high value, and the phone needs it.
2. **Phone MVP:** Foundational, then US1 + US2. An admin signs in and records an after-hours sale. This is the customer's original request (SC-001, SC-002, SC-008, SC-009). Release it to the requesting customer through an EAS internal build before store review.
3. **Then** US4 (tracking), then US5 (repayment), then store submission (T059).
4. Stop and validate at each checkpoint. Never mark a slice done on a fast or quiet test run without confirming the counts (rule 28).
