# Implementation Plan: Mobile app — owner records and tracks digital sales from the phone

**Branch**: `289-mobile-after-hours-sales` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/289-mobile-after-hours-sales/spec.md`

## Summary

The work is a native Android + iOS app (Expo) for shop admins, plus the server work it needs. On the phone, admins record WHISH_APP / OMT_APP transfers and Katsh / iPick vouchers, paid on the customer's account or into the Whish, OMT or Binance wallet. They also see balances, client debt and the sales since the last drawer count, and record wallet repayments.

The phone reuses the existing REST routes and `@liratek/core` money paths unchanged (research R4). The new server work is:

- a mobile sign-in router: shop + username + password, and Google ID token (R5, R6);
- an `Idempotency-Key` middleware (R7);
- a "since the last count" query (R3).

Research changed the day model. LiraTek has no "day closed" state; counts are per drawer against a live running balance (R1). So, by owner decision, transactions count on their local calendar date. The required fix is making every day-grouped report use the local date (R2). That ships first and benefits desktop and web.

## Technical Context

**Language/Version**: TypeScript strict across the board. Node (backend, current repo version). React Native through **Expo SDK 55** (React 19.2.0, React Native 0.83.10), matching hetivo-mono. SDK 56/57 need a newer Xcode than this Mac has (research R11).

**Primary Dependencies**: Express + `@liratek/core` (existing); Expo, Expo Router, `expo-secure-store` (token), a Google sign-in library chosen per R6. **Builds are local only** (`expo run:*` / Gradle): no EAS or online Expo services, and no Klareo or Hetivo accounts (owner, 2026-10-10).

**Storage**: SQLite through core (shared or per-tenant mode). New tables `idempotency_keys` (tenant, v202) and `mobile_google_nonces` (platform; only if the ID-token path is chosen).

**Testing**: core jest, backend jest (API tests), desktop + web Playwright for the count-screen list, and a phone UI test runner chosen in tasks (Maestro or Detox), plus manual store-build checks.

**Target Platform**: Android and iOS (store builds). Backend on Fly; web on Vercel (unchanged).

**Project Type**: Mobile app + existing API/monorepo.

**Performance Goals**: Record an after-hours sale in under 1 minute (SC-001); install and sign in in under 2 minutes (SC-008).

**Constraints**:

- Online only (no offline queue).
- Admin only.
- No Sign in with Apple.
- Never use the dev-only `x-tenant-slug` override.
- Rule 27 headers on every request.

**Scale/Scope**: About 6 phone screens (sign-in, sale, balances, since last count, client debt, repayment) and about 4 new server endpoints.

## Constitution Check

*Gate before research: passed with one exception, recorded below. Re-checked after design: passes.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports | **Exception** + pass | The phone is a third, REST-only client of the same core services (owner-approved; desktop data is not reachable from a phone). The shared parts (local-date reports, since-last-count) get IPC + REST. Day and offset come from the client (rule 27). The phone imports only `browser.ts` (rule 29). |
| II. Layer boundaries | Pass | New SQL lives in `ClosingRepository`, `IdempotencyRepository` and `MobileNonceRepository`. Services and routes hold no SQL or logic. |
| III. Contracts defined once | Pass (after R10) | Payloads are built once: the web forms' inline builders move to shared pure functions in core's browser-safe side, and the phone calls the same ones (rule 22, research R10). Payload types are `z.input<…>` from core schemas (rule 21). The new since-last-count schema is in `validators/closing.ts`, shared by IPC and REST. The local-day predicates reuse `reportingTimeFragments` (rule 14). Routes return the envelope; the existing repayment 400 is documented, not copied. |
| IV. Money integrity | Pass | No new money path. The phone posts through the existing routes, and the §13 checklist runs against the phone payloads (client propagation, legs, void). No new ledger rows, so there are no new reversal owners (rule 20). |
| V. Data and security | Pass | `?` placeholders. `idempotency_keys` is tenant-scoped. The mobile routes are pre-auth but rate-limited and give generic refusals. The actor always comes from the JWT. v202 is in both migration files with `down()`. |
| VI. Testing | Pass (planned) | Guards written first. Money asserted as deltas. Web proof is a `lira-web-*` spec for the count list. Run counts are confirmed. |
| VII. Code quality | Pass | Strict TS, no `any`, module loggers. `api` read through a ref in effects (rule 25 applies to the RN app too). |
| Delivery | Planned | Release notes per slice. Commits cite LIRA-289. |

## Project Structure

### Documentation (this feature)

```text
specs/289-mobile-after-hours-sales/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── mobile-api.md    # Phase 1
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not yet)
```

### Source Code (repository root)

```text
mobile/                                   # NEW Expo workspace (added to root "workspaces")
├── app/                                  # Expo Router screens
│   ├── (auth)/sign-in.tsx                # Google + shop/username/password, "Create your shop"
│   ├── (app)/index.tsx                   # balances + since-last-count
│   ├── (app)/sale/[provider].tsx         # WHISH_APP / OMT_APP / Katsh / iPick
│   ├── (app)/client/[id].tsx             # debt + repayment
│   └── (app)/settings.tsx                # sign out, delete-account link
├── src/api/client.ts                     # fetch wrapper: Bearer, X-Client-Day/Tz, X-Renewed-Token, Idempotency-Key
├── src/api/endpoints.ts                  # typed calls; payload types = z.input<core schemas>
├── src/auth/                             # secure token store, Google sign-in
├── metro.config.js                       # alias @liratek/core -> packages/core/src/browser.ts
├── app.json / eas.json
└── package.json

backend/src/
├── api/mobileAuth.ts                     # NEW /api/mobile/auth/{login,google/nonce,google,signup-link}
├── middleware/idempotency.ts             # NEW, on services/transactions + debts/repayments
├── api/closing.ts                        # + GET /since-last-count
└── server.ts                             # mount mobileAuth

packages/core/src/
├── repositories/IdempotencyRepository.ts # NEW
├── repositories/MobileNonceRepository.ts # NEW (if ID-token path)
├── repositories/ClosingRepository.ts     # + getTransactionsSinceLastCount
├── repositories/TransactionRepository.ts # local-date filters, getDailySummary, getCashFlowByDate (R2)
├── services/GoogleAuthService.ts         # verifyIdToken: audience allow-list
├── services/MobileAuthService.ts         # NEW: shop+password, Google-to-admin resolution
├── validators/closing.ts                 # + sinceLastCount schema
├── validators/mobileAuth.ts              # NEW
└── db/migrations/index.ts                # v202 idempotency_keys (+ platform nonce table)

electron-app/
├── create_db.sql                         # + idempotency_keys
└── handlers/dbHandlers.ts                # closing IPC lives here; + closing:get-since-last-count

frontend/src/
├── features/audit/hooks/useTransactionRows.ts   # local-date filter (R2)
└── features/closing/…                           # "since the last count" list on the count screen
```

> Moved by LIRA-300 (bottom tabs, 2026-10-10): `(app)/sale/[provider].tsx` is now `(app)/sell/[provider].tsx` and
> `(app)/client/[id].tsx` is now `(app)/debts/[id].tsx`; see `specs/300-mobile-bottom-tabs/`.

**Structure Decision**: The new app lives in a top-level `mobile/` workspace, like `frontend/` and `backend/`. It shares only schemas and types with core, through the Node-free browser entry. All server changes stay in the existing layers.

## Delivery slices (order)

1. **Slice 0: local-date reports (R2).** Desktop + web, no phone. It ships alone, because it fixes a live inconsistency.
2. **Slice 1: mobile sign-in + idempotency** (server only, API-tested).
3. **Slice 2: since-last-count** (server, IPC + REST, count-screen list on desktop and web).
4. **Slice 2b: shared payload builders** (R10). The web forms switch to them under their existing tests.
5. **Slice 3: Expo app** (sign-in, sale, balances, since-last-count, client debt, repayment).
6. **Slice 4: store readiness**: OAuth clients, privacy and delete-account link, EAS builds, review.

## Progress (end of 2026-10-10)

39 of 62 tasks done; all work is committed on `main` (pushed up to `062ce29a`, later commits local).

- **Built and verified:**
  - **Phone app (Expo SDK 55)**, iOS simulator and a signed release APK:
    - sign-in by shop address (and "Create your shop" via the web);
    - home with live drawer balances, latest transactions and "since the last count" per wallet;
    - **record a Whish App / OMT App transfer**, on the customer's account or into the Whish / OMT wallet;
    - customer debts and **record a repayment** into a wallet;
    - Dark / Light / System appearance;
    - the LiraTek icon, logo and splash.
  - **Server:**
    - `POST /api/mobile/auth/login`, with its rules in `MobileAuthService` and tested;
    - Idempotency-Key on the sale and repayment routes (v208, one transaction);
    - `GET /api/closing/since-last-count` and its IPC twin.
  - **Shared with web:**
    - `buildWalletTransferPayload` and the fee maths in core, now used by the web form too;
    - `visibleDrawerCurrencies`;
    - local-date bucketing on the Transactions filter, cash report and daily summary;
    - the "N sales since the last count" panel on the desktop/web count window.
  - **Money tests on the real schema:**
    - phone sales × every phone payment choice, voids net to zero;
    - wallet repayments, voids net to zero;
    - an on-account sale appears in its wallet's since-last-count list.
- **Deferred by owner decision (2026-10-10):** Google sign-in; Binance as a phone payment choice; Katsh/iPick vouchers on the phone.
- **Not done:**
  - web/desktop e2e for the count panel (T050): desktop e2e does not run on this Mac;
  - phone UI tests (T060, Maestro not installed);
  - store submission (T059): only the checklist is written, in `docs/OPERATIONS.md`;
  - lapsed-shop state at sign-in.
- **Deviations from this plan:** see research R11/R12. The build-only Docker focus is in `backend/Dockerfile`.

## Open items (from research)

- **R6 verify:** which `aud` the chosen native Google library puts in the ID token on Android and iOS, and whether it can carry a nonce. If not, use the code + PKCE fallback and drop `mobile_google_nonces`.
- **Expo SDK version:** decided, SDK 55 (research R11). Move to SDK 57 after an Xcode update.
- **Expo account:** none is used. Builds are local only, with no EAS (owner decision 2026-10-10, research R12).
- **Timestamp shapes:** `created_at` mixes ISO `T…Z` and SQLite `YYYY-MM-DD HH:MM:SS` (both UTC). Slice 0 normalises, and its tests cover both shapes (R2).
- **Apple 4.8 and account deletion:** confirm at the first iOS review (Likely only).
- ~~Production `APP_BASE_DOMAIN` / `TENANT_DB_MODE`~~: resolved. The mobile login resolves by slug and is live on production since Deploy API #63 (verified: an unknown shop gets 401).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Rule 19: phone is a REST-only third client; phone screens have no desktop/IPC twin | Desktop shops' data lives on the shop PC and is not reachable from a phone (owner-approved, spec Assumptions) | Building an IPC path for a phone is impossible; desktop sync is a separate, much larger project |
| New top-level workspace `mobile/` | Native app needs its own toolchain (Metro, EAS) | Reusing `frontend/` (DOM-only `packages/ui`) or a PWA was replaced by the owner's Expo decision |
