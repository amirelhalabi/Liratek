# Research: Phone app bottom tabs (LIRA-300)

Facts below were checked in the repository on 2026-10-10 unless marked otherwise.

## R1. Tab bar component

- **Decision:** Expo Router's JS `Tabs` (`import { Tabs } from "expo-router"`), backed by
  `@react-navigation/bottom-tabs`.
- **Rationale:** already installed: `expo-router ~55.0.18` depends on `@react-navigation/bottom-tabs ^7.15.5`, and
  `mobile/node_modules/@react-navigation/bottom-tabs` is 7.20.0. No new native code, so no rebuild of `ios/` or
  `android/` for the tab bar itself. Fully themeable (FR-015) through `tabBarStyle`, `tabBarActiveTintColor` and
  per-tab icons from `lucide-react-native`, which the app already uses.
- **Alternatives considered:**
  - `expo-router/unstable-native-tabs` (native iOS/Android tab bars): rejected; marked unstable in SDK 55, and its
    styling differs per platform, which conflicts with matching the web app's colours.
  - Burger menu / drawer: rejected by the owner (2026-10-10) in favour of tabs.

## R2. Route layout and nested stacks

- **Decision:** one tab group with a nested Stack in the two tabs that have detail pages:

  ```text
  (app)/_layout.tsx            → PageBackground + Tabs (replaces the current Stack)
  (app)/index.tsx              → Home tab
  (app)/sell/_layout.tsx       → Stack: index, [provider]
  (app)/sell/index.tsx         → Sell tab (sale tiles)
  (app)/sell/[provider].tsx    → transfer form (moved from sale/[provider].tsx)
  (app)/debts/_layout.tsx      → Stack: index, [id]
  (app)/debts/index.tsx        → Debts tab (debtor list)
  (app)/debts/[id].tsx         → customer page (moved from client/[id].tsx)
  (app)/activity.tsx           → Activity tab (latest transactions, moved out of Home)
  (app)/settings.tsx           → Settings tab
  ```

- **Rationale:**
  - If the transfer form and the customer page stayed in an outer Stack above the tabs, the tab bar would be hidden
    on them, so the owner could not switch tabs from a half-filled form (FR-014).
  - A nested Stack inside a tab keeps its state while another tab is shown (tab screens stay mounted after their
    first visit), and pressing the focused tab again pops its Stack to the top: the bottom-tabs default (US1 #3).
  - Paths change: `/sale/[provider]` → `/sell/[provider]`, `/client/[id]` → `/debts/[id]`. No deep links point at
    the old paths (the app has no link handling yet), so nothing outside `mobile/` is affected.
- **Gotcha:** typed routes (`.expo/types/router.d.ts`) regenerate only while Metro runs. Start Metro once after
  moving files and before `yarn typecheck`; otherwise typecheck fails on, or passes against, stale route types.
- **Keyboard:** `tabBarHideOnKeyboard: true` so the bar never covers an input or the Save button (edge case).

## R3. Data caching library

- **Decision:** `@tanstack/react-query` v5, the same major the web app uses (`frontend/package.json`
  `^5.101.0`), and the same library hetivo-mobile-driver uses (`^5.90.21`, `src/lib/query-client.ts`).
- **Rationale:** gives "show last data at once, refresh in the background" (FR-009), per-key invalidation after a
  sale (FR-012), and one `clear()` for sign-out (FR-013) without hand-written cache code.
- **Alternatives considered:** a small hand-written cache in a React context: rejected; it would re-implement stale
  times, de-duplication of quick repeated taps, and invalidation, which are the parts that go wrong.

## R4. Duplicate React (BLOCKING risk)

- **Fact:** root `node_modules/react` is 19.2.3 (web/desktop); `mobile/node_modules/react` is 19.2.0 (what Expo SDK 55
  requires). Root also already has `@tanstack/react-query@5.101.0`.
- **Risk:** `yarn workspace @liratek/mobile add @tanstack/react-query` will most likely reuse the root copy. That
  copy resolves `react` from the root, i.e. 19.2.3, while the app renders with 19.2.0. Two Reacts give "Invalid hook
  call" or "No QueryClient set" at runtime, and typecheck does NOT catch it. Every React-dependent package the phone
  uses so far (lucide, svg, navigation) landed inside `mobile/node_modules`; this would be the first that doesn't.
- **Decision:** after installing, check where the package landed. Add a Metro `resolveRequest` rule that resolves
  `react`, `react/*` and `react-native` to `mobile/node_modules` for every importer, so any hoisted package uses the
  app's React. Prove it with a real render on the simulator, not with typecheck.
- **Alternative:** Yarn `installConfig.hoistingLimits: "workspaces"` on `mobile/`: rejected for now; it re-lays the
  whole mobile install and changes what the Docker focus and CI caches see (LIRA-289 infra work).

## R5. When does a tab refresh?

- **Fact (React Query on React Native):** queries refetch on mount, window focus and reconnect. On React Native
  there is no window focus, and a tab screen stays mounted after its first visit. So **switching tabs alone does not
  refetch anything**, and `staleTime` only marks data stale.
- **Decision:**
  - a `useRefreshOnFocus` hook per tab screen: on screen focus, refetch that screen's queries if they are stale (older
    than 30 s, FR-009); skip on the first focus (the mount already fetches);
  - `focusManager` wired to `AppState`, so returning from the background counts as focus (edge case "app returns after
    a long time");
  - pull-to-refresh calls `refetch()` directly (FR-011).
- **Consequence to state openly:** after `invalidateQueries`, queries of tabs that are mounted but not visible are
  "active" and refetch immediately, not "when next shown". This is correct (the data is fresh when the owner looks)
  and costs one request per affected query. Request counts in SC-002 are measured on a fresh sign-in only.

## R6. Retries and errors

- **Decision:** queries retry once (`retry: 1`) except when the error is `UNAUTHORIZED` or `NO_CONNECTION`. A 401
  already sends the owner to sign-in through `setUnauthorizedHandler`; retrying it only delays that. Mutations are not
  moved into React Query (R7), so no mutation retry exists to turn off.
- **Rationale:** hetivo uses `retry: 2` for flaky driver networks. Here a retry of a read is harmless, but each
  failed retry delays the "could not refresh" notice (FR-010).
- **Request helpers stay as they are:** `mobile/src/api/*` return `{ success, data | error }`. A small adapter turns
  `success: false` into a thrown error carrying the code, so React Query sees failures; screens keep the same
  messages.

## R7. Money submissions are not changed (FR-016)

- **Decision:** `recordServiceSale`, `recordRepayment` and `createClient` stay plain async calls with their existing
  Idempotency-Key refs. After a `success` result the screen calls one `invalidateAfter(action, …)` helper (data-model
  § Invalidation map). They are not wrapped in `useMutation`.
- **Rationale:** the payload and the duplicate-submission guard are proven by LIRA-289's money tests; touching how
  they are sent buys nothing for this feature.

## R8. Sign-out and the old shop's data

- **Decision:**
  - one module-level `queryClient` (`mobile/src/data/queryClient.ts`), imported by the root layout's
    `QueryClientProvider` and by `AuthContext`;
  - on BOTH exits, `signOut()` and the 401 handler: `await queryClient.cancelQueries()`, then `queryClient.clear()`,
    then `setStatus("signedOut")`. Without the cancel, a request already in flight can write the old shop's data
    back into the cache after the clear;
  - every query key starts with the signed-in shop slug, so even a missed clear could never show shop A's data to
    shop B (SC-005, second line of defence).

## R9. Tests for the phone

- **Fact:** `mobile/` has no test runner today. `scripts/run-tests.mjs` discovers workspaces through
  `yarn workspaces list` and runs every one that has a `test` script, refusing a run that reports zero tests.
  CI runs workspaces in separate jobs (`.github/workflows/ci.yml`).
- **Decision:** add `jest` + `jest-expo` (preset `jest-expo`) as hetivo-mobile-driver does, with a `test` script, so
  `yarn test` picks it up automatically. Unit-test the pure modules: query keys (shop slug first) and the
  invalidation map (which keys each action marks). Add a mobile test step to CI with a test-count floor, as the other
  jobs have (rule 28).
- **Not automated:** SC-003 (under 0.3 s on return) and the tab flows are checked by hand on the simulator and the
  Android phone (quickstart). Phone UI automation (Maestro) stays deferred, as in LIRA-289 T060.

## R10. Constitution scope

The phone reuses REST reads and writes that already exist. No new endpoint, schema, IPC channel, migration or core
change. Rules 19 (dual transport), 21 (derived adapter types) and 22 (one payload shape) therefore have nothing new to
apply to; the existing phone payload types already derive from core schemas (LIRA-289).
