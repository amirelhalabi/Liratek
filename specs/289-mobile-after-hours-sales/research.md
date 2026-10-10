# Research — LIRA-289 mobile app

Phase 0 output for `/speckit-plan`. Every finding below was read from the code on 2026-10-08 (file:line cited). Items marked **Likely** or **Verify** were not executed.

## R1. How closing and the "expected" balance work today

**Finding** (certain, from code):

- There is no "day closed" state and no lock on writes after a count. Every save is a per-drawer `CHECKPOINT` through `ClosingRepository.createCheckpoint` (`packages/core/src/repositories/ClosingRepository.ts:367`); `createTransaction` inserts unconditionally (`TransactionRepository.ts:1289-1312`).
- "Expected" is the live running balance in `drawer_balances` (`ClosingRepository.getSystemExpectedBalancesDynamic`, `:220-237`), maintained by `applyDrawerDelta` (`moneyPosting.ts:399`). A checkpoint posts `physical − live` as an adjustment and resets the balance (`ClosingRepository.ts:560-575, 661-678`).
- The closing PDF is built on the client at save time (`frontend/src/features/closing/hooks/useDrawerCheckpoint.ts:410-440`); counted amounts live in `daily_closing_amounts`.

**Decision**: Drop the "next business day" model (owner, third round). Transactions count on their local calendar date. FR-009 and "expected includes them" (FR-010) already hold by construction and get tests only.

**Rationale**: The business-day rule existed to protect a counted day from a late sale; the running-balance model already does that. A real business day would need a new shop-level close event, a `business_day` stamp on four tables and a rework of every report.

**Alternatives considered**: Real business day — rejected by the owner as a separate, high-risk epic.

## R2. Reports disagree on what "a day" is (blocks SC-005)

**Finding** (certain, from code):

- Profits and Dashboard use the client-offset fragments `localDayExpr` / `isToday` / `dateRange` (`packages/core/src/repositories/reportingTimeFragments.ts:81-148`).
- The Transactions page does not:
  - The backend filters raw UTC (`TransactionRepository.ts:1481-1488`).
  - The frontend compares `row.created_at.slice(0,10)` (`frontend/src/features/audit/hooks/useTransactionRows.ts:495-503`).
  - `getDailySummary` uses `DATE(created_at)` (`TransactionRepository.ts:9331, 9346`).
  - `getCashFlowByDate` uses `substr(created_at,1,10)` (`:1411-1440`).
- `getDailyActivityStats(day)` compares `created_at` against `${day} 00:00:00`–`23:59:59` through `dateRange` (`ClosingRepository.ts:715-776`).

**Decision**: Make every day-grouped query listed above use the shared `reportingTimeFragments` (rule 14), and make the frontend date filter compare a local date, not the UTC prefix. This is a prerequisite slice that ships before the phone app, and it fixes desktop and web too.

**Rationale**: After-midnight sales are this feature's core case; a 00:30 Beirut sale is 21:30 UTC the previous day.

**Format finding** (certain, from code): `created_at = COALESCE(transaction_time, CURRENT_TIMESTAMP)` (`TransactionRepository.ts:1310`). `transaction_time` is optional backdating, validated as `z.string().datetime()` (`validators/common.ts:54`), so it is ISO UTC with `T…Z`. Rows without it get SQLite's `YYYY-MM-DD HH:MM:SS`, also UTC. Both are UTC, but the **two string shapes are mixed**. So:
- Every comparison or bucket must normalise through SQLite `datetime()`/`julianday()`, never raw string order (`'T' > ' '`).
- The frontend must parse both shapes as UTC: append `Z` to the space form, because without it JavaScript reads the time as local, and Safari may reject it.
- The phone sends no `transaction_time`; it records "now" and never backdates.

The Slice 0 tests create one row of each shape.

**Alternatives considered**: Leave the pages as they are and mark SC-005 unmet. Rejected, because the owner would see the same sale on two dates.

## R3. "Since the last count" list

**Finding**: `getLastCheckpointPerDrawer` (`ClosingRepository.ts:1184-1231`) already returns each drawer's last `checked_at`. Nothing lists transactions since then.

**Decision**: Add `ClosingRepository.getTransactionsSinceLastCount(drawerNames?)`. For each drawer it returns the transactions whose payment legs touched that drawer after its last `checked_at`. The count screen shows the list for the drawer being counted. The phone's "Since last count" view uses the union over the wallet and voucher drawers.

**Rationale**: Counts are per drawer, so "since the last count" is only well defined per drawer.

**Alternatives considered**:
- Since General's last count: simpler, but wrong for a wallet counted at a different time.
- Since the latest count of any drawer: hides sales on drawers counted earlier.

## R4. Writes the phone reuses

**Finding** (certain, from code):

| Phone action | Route | Schema | Roles |
| --- | --- | --- | --- |
| WHISH_APP / OMT_APP transfer, Katsh / iPick voucher | `POST /api/services/transactions` (`backend/src/api/services.ts:97-137`) | `createFinancialServiceSchema` (`packages/core/src/validators/financial.ts:79-511`) | admin, staff |
| Debt repayment | `POST /api/debts/repayments` (`backend/src/api/debts.ts:85-120`) | `addRepaymentSchema` (`validators/debt.ts:30-72`) | admin, staff |

- Real codes:
  - Providers: `WHISH_APP`, `OMT_APP`, `Katsh`, `iPick`. "IPEC/Katch" are UI names; migration v48 renamed them.
  - Payment methods: `CUSTOMER_ACCOUNT`, `WHISH`, `OMT`, `BINANCE` (`create_db.sql:2009-2015`).
  - Drawers: `Whish_App`, `OMT_App`, `Binance`, `Katsh`, `iPick` (`constants/drawerModules.ts:79-104`).
- `CUSTOMER_ACCOUNT` moves no drawer (`utils/payments.ts:28`).
- A WHISH_APP SEND paid with `WHISH` puts both legs on `Whish_App`. No guard rejects this; the expected net is +fee. This is the headline scenario, so it gets an explicit test.
- Neither route has idempotency. Neither schema has `client_day`; the day arrives through the `X-Client-Day` / `X-Client-Tz-Offset` headers (`backend/src/middleware/auth.ts:301-323`).
- `POST /api/debts/repayments` returns HTTP 400 on failure, unlike the IPC envelope (`debts.ts:117`).

**Decision**:
- Reuse both routes unchanged in behaviour.
- Add an optional `Idempotency-Key` header, handled by a new middleware (R7).
- The phone client treats any non-2xx with a JSON body as `{success:false,error}`.
- Changing the repayment route's status code is out of scope (the web adapter depends on it).

## R5. Sign-in from a native app

**Finding** (certain, from code):

- The tenant comes only from the request Host (`backend/src/middleware/tenantHost.ts:128-149`).
- A native app calling `api.liratek.shop` resolves to the reserved slug `api`, giving `unknown` and a refused login (`utils/tenantSlug.ts:23`).
- `x-tenant-slug` exists, but only behind `TENANT_HOST_HEADER_OVERRIDE`, which is documented "DEVELOPMENT AND TESTS ONLY" (`config/env.ts:93-97`). It must not be used.
- After login, no middleware compares Host to the JWT tenant: authenticated requests rely on the JWT + DB session (`auth.ts:237-271`). So once the phone holds a token, every existing route works from `api.liratek.shop`.
- JWT: `Authorization: Bearer`, 7 days, sliding renewal through `X-Renewed-Token` (`auth.ts:120-175`).
- Sessions carry `device_type`, which already allows `mobile` (`SessionRepository.ts:17-31`).
- The web's "same browser ends previous session" is done in the web client (`frontend/src/api/httpClient.ts:130-160`), not on the server. The phone does the same with its own stored token, so web sessions are untouched.
- Roles are `super_admin | admin | staff` only (`UserRepository.ts:86`). "Owner" = `admin`.

**Decision**: New router `backend/src/api/mobileAuth.ts`, mounted at `/api/mobile/auth`:

- `POST /login {shop, username, password, deviceName?}`:
  - resolve the tenant with `getTenantRepository().getBySlug(shop)`, then authenticate inside that tenant only;
  - refuse non-admins;
  - create the session with `deviceType:'mobile'`;
  - return the same token envelope as web login.
- Unknown shop, wrong password and an inactive shop all return the same generic refusal (FR-028). It reuses the existing failed-login limiter.
- The phone sends `X-Client-Day` / `X-Client-Tz-Offset` on every request (rule 27). The offset uses the exact expression the web uses (`frontend/src/api/httpClient.ts:251`), so the sign convention is identical.
- **Timing:** unknown shop and unknown user must take as long as a wrong password (a dummy hash compare), or response time reveals which shops exist (FR-028). Check whether the web login already does this; mirror or add it.

**Alternatives considered**:
- Enabling `x-tenant-slug` in production: rejected; it is a documented dev-only bypass of host realm checks.
- Having the phone call `<slug>.liratek.shop`: rejected; it needs per-shop Vercel routing for a native client, and it fails for per-tenant lookups before the slug is known.

## R6. Google sign-in from a native app

**Finding** (certain, from code):

- Google sign-in is only a server redirect flow (code + PKCE, state/nonce in an httpOnly cookie) (`backend/src/api/googleAuth.ts:15-31`).
- `GoogleAuthService.verifyIdToken` (`packages/core/src/services/GoogleAuthService.ts:261-300`):
  - accepts exactly one `aud`;
  - requires an exact nonce;
  - requires `email_verified`.
- The shop is found through `signin_directory` (`SigninDirectoryRepository`). Its rows have no role column.

**Decision**: Two new endpoints in `mobileAuth.ts`:

1. `POST /google/nonce` returns a short-lived, single-use nonce. It is stored hashed, reusing the hand-off token store pattern and the hourly cleanup (`authCleanupSweep.ts`).
2. `POST /google {idToken, nonce, deviceName?}`:
   - verifies with `verifyIdToken`, extended to accept an **allow-list** of audiences: `GOOGLE_CLIENT_ID` plus a new `GOOGLE_MOBILE_CLIENT_IDS`;
   - consumes the nonce;
   - looks up directory matches for the `sub`;
   - loads each match's user role;
   - keeps admins only.
   - The role lives in each shop's own database, so each match's role lookup runs inside `runWithTenant(match.tenant_id)`. Exactly one match → session (`mobile`). Zero matches, or more than one admin match → a refusal with its reason code (FR-025).

**Verify before building** (not checked; **Likely** only):

- Which client ID ends up in the ID token's `aud` with the chosen native library on Android and iOS. Likely the *web* client ID when the library is configured with a server/web client ID. If so, the allow-list may only need the existing ID.
- Whether that library lets the app pass a nonce into the ID token.
- Fallback if it cannot: use `expo-auth-session` with code + PKCE against Google, with the server exchanging the code. This keeps nonce checking server-side.

## R7. Duplicate submissions (FR-017)

**Finding**: There is no idempotency anywhere (`backend/src/middleware/`, `server.ts`).

**Decision**: New table `idempotency_keys`, migration **v202** (the last migration is v201, `packages/core/src/db/migrations/index.ts:13932`), plus a repository and a backend middleware `idempotency.ts`:

- On a key seen for the same tenant + user + route within 24 h, replay the stored response; never re-run the write.
- The key is claimed inside the same DB transaction as the write, or with an INSERT-first claim so two concurrent requests cannot both run.
- Applied to the two write routes when the header is present; the web is unaffected.

**Alternatives considered**: Client-side disable-on-tap only. Rejected, because a weak-signal retry after a lost response still double-posts money.

## R8. Expo app inside the monorepo

**Finding**:

- Yarn 4.12, `nodeLinker: node-modules`. Workspaces are `backend`, `frontend`, `packages/*`, `electron-app`.
- Frontend React `^19.2.0`.
- Core uses zod `^4.3.6`; the frontend uses zod `^3.23.8`.
- Core's `main` is `dist/index.js`, which pulls in `better-sqlite3`. The browser-safe entry `src/browser.ts` (it exports `validators/index.js`) is reachable only through a Vite alias (`frontend/vite.config.ts:21-24`).
- `packages/ui` is DOM-only (react-dom peer, `document`/`window` use). There is no existing `mobile/` directory and no Expo dependency.
- Expo SDK 56 (May 2026) ships React Native 0.85 + React 19.2, and SDK 57 followed in June 2026 ([expo.dev/sdk/56](https://expo.dev/sdk/56)). React 19.2 matches the frontend. **Verify** the SDK version at scaffold time.

**Decision**:

- New top-level workspace `mobile/` (Expo, TypeScript strict, Expo Router), added to the root `workspaces`.
- It imports **types and schemas only** from `packages/core/src/browser.ts`, through a Metro resolver alias (the Vite pattern). Payload types are `z.input<typeof createFinancialServiceSchema>` and `z.input<typeof addRepaymentSchema>` (rule 21).
- The phone uses core's zod 4 through that import and does not add a second zod major.
- `packages/ui` is not used.
- ~~Builds and store submission use EAS.~~ **Superseded 2026-10-10 (owner):** local builds only, with no EAS or online Expo. Android APKs are signed with a local upload key through `mobile/plugins/withReleaseSigning.js`.
- Import only the needed validator modules, not the whole `browser.ts` barrel. The rule 29 guard catches Node built-ins only; it does **not** catch `window`, `document`, `localStorage` or Hermes gaps, which crash Metro at runtime.
- Add an `expo export` bundle check to the gates.

**Alternatives considered**:
- `packages/mobile`: rejected; apps live at the top level here (`frontend/`, `backend/`), and `packages/*` holds libraries.
- A separate repository: rejected, because the shared schemas would be copied (rule 14).

## R10. Payload builders shared with the web (rule 22)

**Finding**: The web forms build the request bodies inline: `OmtWhishAppTransferForm.tsx:369-430` and `KatchForm.tsx:1725-1770`. That covers fee field per provider, `checkoutTotal`, `tender_exchange_rate`, `itemKey`/`itemCategory` and `telecomCreditReturns`.

**Decision**: Before the phone screens:
- Extract pure builders into core's browser-safe side: `buildWalletTransferPayload` and `buildVoucherSalePayload`, typed `z.input<typeof createFinancialServiceSchema>`.
- Switch the two web forms to them, under their existing tests.
- Have the phone call the same functions.

One builder per operation means SC-002 compares phone and web by construction, not against a third hand copy.

**Alternatives considered**: The phone writes its own bodies. Rejected: rule 22 defect (two builders that nothing compares).

## R11. Expo vs Capacitor, and which SDK (decided 2026-10-10)

**Decision**: Use Expo, following `~/Documents/Hetivo/hetivo-mono/apps/hetivo-mobile-driver`, on **SDK 55** with its versions: `expo ~55.0.31`, `react 19.2.0`, `react-native 0.83.10`, Expo Router.

**Rationale**:
- The owner's own projects (hetivo-mono, Klareo `klareomobile`, `mobile-shop`) all ship Expo apps, so there's a proven path and reference.
- SDK 57 and SDK 56 both fail to compile on this Mac. Their `expo-modules-jsi` uses `weak let`, which Swift 6.2.1 (Xcode 26.1.1) rejects: "'weak' must be a mutable variable".
- Hetivo builds iOS in EAS's cloud, which has a newer Xcode, so it never hit this.
- SDK 55 builds and runs on the iPhone 17 simulator (verified 2026-10-10).

**Consequence**:
- React 19.2.0 for the app sits beside the web's 19.2.3 at the root. All React Native packages resolve from `mobile/node_modules`.
- `expo-doctor` reports that duplicate (17/18 checks). Revisit once Xcode is updated and the app can move to SDK 57 (React 19.2.3).

**Alternatives considered**:
- **Capacitor** (wrap web code): it reuses the React components and API layer. Rejected because:
  - there is no reference project on this Mac;
  - Apple rejects apps that are "just a website" (guideline 4.2), which is a higher risk;
  - Google sign-in still needs a native plugin;
  - the shared payload builders (R10) already give one source of truth either way.

  Sources: [Capgo Google sign-in](https://capgo.app/blog/how-to-sign-in-with-google-using-capacitor/), [MobiLoud on 4.2](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper).
- **SDK 57 / 56**: blocked by the local Xcode, as above.

**Local toolchain**:
- iOS: `yarn workspace @liratek/mobile ios` runs `expo run:ios` (CNG; `mobile/ios` is generated and git-ignored).
- Android: needs JDK 17 (Homebrew `openjdk@17`) and the Android SDK from `android-commandlinetools`.

## R12. Build findings while making the app run (2026-10-10)

These came up getting the app to build and run on the iPhone 17 simulator and against a local backend. Each is fixed in the working tree (uncommitted).

| Finding | Fix | Where |
| --- | --- | --- |
| Expo SDK 57/56 Swift code (`weak let` in `expo-modules-jsi`) fails on Swift 6.2.1 (Xcode 26.1.1) | Use SDK 55, hetivo's versions (R11) | `mobile/package.json` |
| Two CocoaPods runs at once corrupted `ios/Pods` (`ReactNativeDependencies.xcframework … No such file`) | Delete `ios/Pods`, `ios/build` and DerivedData, then run once | process note |
| Babel rejects core's `declare readonly` class fields (`packages/core/src/utils/errors.ts`). Hetivo's shared code has none, so it never hit this | `mobile/babel.config.js`: `babel-preset-expo` plus `@babel/plugin-transform-typescript` with `allowDeclareFields: true` | `mobile/babel.config.js` |
| Core source is imported as `@liratek/core/<module>`; core uses `./x.js` ESM specifiers | Metro `resolveRequest` maps the prefix to `packages/core/src/<module>.ts` and strips `.js` inside core; tsconfig `paths` mirror it | `mobile/metro.config.js`, `mobile/tsconfig.json` |
| Another session rebuilt core and re-copied `node_modules/@liratek/core` while Metro ran. This corrupted Metro's file map ("already exists in the file map as a file") and every core import failed | Metro `blockList`: the built core copy, `packages/core/dist`, `frontend`, `backend`, `electron-app`, `dist-electron` (merged with Expo's defaults) | `mobile/metro.config.js` |
| The backend imported `ws` without declaring it and got v8 by root hoisting. React Native's `ws@^7` displaced it, and the backend crashed: "does not provide an export named 'WebSocket'" | `backend/package.json` declares `"ws": "^8.18.0"` | `backend/package.json` |
| `expo-doctor` reports a duplicate React (app 19.2.0 under `mobile/node_modules`, web 19.2.3 at the root) | Accepted. Every React Native package resolves from `mobile/node_modules`. Revisit on SDK 57 | — |
| Auth error bodies are `{ code, message }`, not strings | The phone client reads `error.code` | `mobile/src/api/client.ts` |

**Account check (owner request 2026-10-10):**
- Git commits in this repo use the personal identity (`amirelhalabi`, repo-local config).
- The remote is `github.com/amirelhalabi/Liratek`, and the keychain GitHub account is `amirelhalabi`.
- Expo CLI is logged in as `techhetivo` (Hetivo). It is unused so far, because local `expo run:*` builds need no account. **No EAS at all** (owner, 2026-10-10). Leave the `techhetivo` login unused; builds are local only.
- No Klareo account is used anywhere.

## R9. Store and policy items (not code)

- **No Sign in with Apple** (owner decision). **Likely**, based on App Review 4.8: own username/password alongside Google satisfies it. **Verify** at the first iOS review.
- **Likely**, based on the account-deletion rule: because the app starts sign-up, it needs a "Delete account" entry. A link to the web is expected to suffice.
- Needs Apple Developer and Google Play accounts, and Android + iOS OAuth client registrations.
