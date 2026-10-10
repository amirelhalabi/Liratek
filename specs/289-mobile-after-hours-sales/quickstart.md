# Quickstart — validating LIRA-289

This guide is for running checks, not for implementing. Contracts are in `contracts/mobile-api.md`; tables are in `data-model.md`.

## Prerequisites

- Core built and synced (`packages/core` build, then copy `dist` into `node_modules/@liratek/core/dist`).
- Node ABI for backend and core jest (`yarn rebuild:node`).
- Two test shops on a local backend (shared DB mode), each with an admin user called `admin` but **different passwords**, plus one staff user. One admin has Google connected.
- For the phone, an Expo dev build on an Android emulator and an iOS simulator, pointed at the local API.

## Run it locally (works today, 2026-10-10)

1. **Local backend** on a throwaway database. Port 4300 is often taken by another dev backend, so use 4310:
   ```bash
   cd backend && set -a && . ./.env && set +a
   DATABASE_PATH=<scratch>/liratek-mobile.db PORT=4310 npx tsx src/server.ts
   ```
   A fresh file runs every migration on start. A one-off seed script provisioned shop `mobiletest` with admin `admin` / `Mobile#2026` and staff `cashier` / `Cashier#2026`, through `TenantProvisioningService.provisionTenant` plus `UserRepository.createUser`. Local only, never on a deployed server.
2. **Point the app at it:** `mobile/.env.local` (git-ignored) holds `EXPO_PUBLIC_API_BASE_URL=http://localhost:4310`. Without it, the app calls `https://api.liratek.shop`, where `/api/mobile/auth/login` does not exist until this work is deployed.
3. **iOS simulator:** `yarn workspace @liratek/mobile ios` runs `expo run:ios`. The first build downloads about 250 MB of React Native and Hermes artifacts. After adding a native module, re-run it; JS-only changes hot-reload. **After changing the icon, splash or any other native setting in `app.config.ts`, regenerate first:** `APP_VARIANT=local npx expo prebuild --platform ios --clean`. A plain `expo run:ios` keeps the existing `ios/` folder, which is why the icon stayed blank white until this was done (2026-10-10). Restart Metro with `npx expo start --clear` if it misbehaves.
4. **Seeing the signed-in screens without the local backend:** use the development-only shop-address mode (`EXPO_PUBLIC_API_MODE=shop-host` in `mobile/.env.development.local`) and sign in to a deployed shop. The old "Preview screens" link was removed 2026-10-10 (owner).
5. **Android:** needs JDK 17 (`/opt/homebrew/opt/openjdk@17`) and the SDK in `~/Library/Android/sdk` (platform-tools, emulator, `platforms;android-36`, `build-tools;36.0.0`, `system-images;android-36;google_apis;arm64-v8a`), then an emulator device and `yarn workspace @liratek/mobile android`. Install in progress 2026-10-10.

Checked on 2026-10-10:

- The sign-in screen renders on the iPhone 17 simulator (iOS 26.1) in the web palette.
- Curl against `POST /api/mobile/auth/login` on port 4310:
  - admin → 200 with `shop`;
  - wrong password, unknown shop, or another shop's username → identical 401 `INVALID_CREDENTIALS`;
  - staff → 403 `ADMIN_ONLY` with the session revoked;
  - sessions are stored with `device_type = 'mobile'`.
- **No automated test yet** (T016). When it is written, it will not be proven failing-first, because the route already exists (rule 17).

## Slice 0: local-date reports (R2). Ships first, desktop + web.

1. Create two sales at 00:30 Beirut (21:30Z the previous day): one with `transaction_time` (ISO `T…Z`) and one stored with SQLite's default `YYYY-MM-DD HH:MM:SS` shape. Send `X-Client-Day`/`X-Client-Tz-Offset` for Beirut.
2. Expected: the Transactions page date filter, `getDailySummary`, `getCashFlowByDate`, Profits and Dashboard all put it on the Beirut date.
3. Guard: core jest tests for each repository query with a fixed offset. Each is written first and seen failing on the current code (rule 17).

## Slice 1: sign-in

| Check | Expected |
| --- | --- |
| `POST /api/mobile/auth/login` shop A + A's admin password | success, `shop.slug = A`; `sessions.device_type = 'mobile'` |
| shop A + B's admin password | `INVALID_CREDENTIALS` |
| unknown shop | `INVALID_CREDENTIALS` (same body) |
| staff user, right password | `ADMIN_ONLY`, no session row |
| Google: admin of exactly one shop | success |
| Google: not connected / staff only / admin in 2 shops | `GOOGLE_NOT_CONNECTED` / `ADMIN_ONLY` / `MULTIPLE_SHOPS` |
| Reused or expired nonce | `INVALID_GOOGLE_TOKEN` |
| Web session exists, then phone signs in | web session still valid |
| Revoke the phone in web Settings → Signed-in Devices | next phone request returns 401; the app returns to sign-in |

These are backend API tests in `backend/src/api/__tests__/mobileAuth.api.test.ts`.

## Slice 2: phone sales (money, rule 18 §13)

For each provider (`WHISH_APP`, `OMT_APP`, `Katsh`, `iPick`) × payment (`CUSTOMER_ACCOUNT`, `WHISH`, `OMT`, `BINANCE`):

- Snapshot `drawer_balances` and client debt, post through the route, then assert **deltas** (rule 15).
- Post the same body as the web form; the deltas must be identical (SC-002).
- Headline case: WHISH_APP SEND $50 paid with `WHISH`. `Whish_App` nets +fee, and both legs land on one drawer.
- Void each one through the existing void path. Every ledger nets to 0 per currency (rule 20).

Idempotency:

- Two identical requests with one `Idempotency-Key` produce one transaction and an identical replayed body.
- Two parallel requests produce one transaction; the other gets `DUPLICATE_IN_PROGRESS`.

## Slice 3: since the last count

1. Count `Whish_App`, then post two phone sales.
2. `GET /api/closing/since-last-count?drawers=Whish_App` lists exactly those two.
3. The saved checkpoint rows and PDF inputs are unchanged (SC-003).
4. The next count's expected amount equals the previous count + the sales (SC-004).

Prove this on both transports: a desktop spec plus `frontend/tests/e2e-web/lira-web-*` for the count screen list.

## Slice 4: phone app (manual + Maestro or Detox, decided in tasks)

1. Install the dev build, then sign in by Google and by password. This should take under 2 minutes (SC-008).
2. Record an after-hours WHISH_APP transfer on account in under 1 minute (SC-001).
3. Airplane mode, then Save: the app shows "Not saved — no connection" and nothing is posted.
4. Double-tap Save: one transaction.

## Gates (constitution)

`yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, core/backend/electron/frontend jest (confirm the counts actually ran, rule 28), `yarn build`, `node scripts/build-release-notes.cjs --check`. The Expo app adds `tsc --noEmit`, lint, and an `expo export` bundle check (it catches DOM or Hermes gaps that the rule-29 guard does not).
