---

description: "Tasks for LIRA-300 — phone app bottom tabs"
---

# Tasks: Phone app bottom tabs

**Input**: Design documents from `specs/300-mobile-bottom-tabs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/navigation.md, quickstart.md

**Tests**: the plan asks for unit tests of the pure cache modules (query keys, invalidation map) in a new mobile jest
suite (research R9). UI flows and timing are checked by hand (quickstart). LIRA-289 money tests must stay green
unchanged (SC-006).

**Organization**: grouped by user story. All paths are relative to the repository root. All work is in `mobile/`
except T005 (CI) and the docs tasks.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

**Purpose**: dependencies, test runner, and the single-React guarantee.

\1(2026-10-10: react-query landed in `mobile/node_modules/@tanstack/react-query`, so it already resolves the phone's React 19.2.0; root keeps its own copy for the web) Add `@tanstack/react-query` `^5.101.0` to `mobile/package.json` dependencies, and `jest` `^29.7.0` and `jest-expo` `~55.0.22` to its devDependencies (the versions hetivo-mobile-driver uses), with `yarn workspace @liratek/mobile add …`; then run `ls -d mobile/node_modules/@tanstack/react-query node_modules/@tanstack/react-query` and record where react-query landed in the T001 note in this file
- [X] T002 Pin React for every importer in `mobile/metro.config.js`: inside the existing `resolveRequest`, resolve `react`, `react/*`, `react-native` and `react-native/*` to `mobile/node_modules` (`path.join(__dirname, "node_modules", moduleName)` through the default resolver) before the other rules; comment why (root has react 19.2.3, the app needs 19.2.0; a hoisted react-query would load the root copy — research R4)
- [X] T003 [P] Create `mobile/jest.config.js` with `preset: "jest-expo"`, `testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"]`, and `moduleNameMapper` for `^@/(.*)$` → `<rootDir>/src/$1`; follow hetivo-mobile-driver's `jest.config.js` for `transformIgnorePatterns`
- [X] T004 Add `"test": "jest"` to `mobile/package.json` scripts; confirm `node scripts/run-tests.mjs` now lists `@liratek/mobile` (it discovers workspaces with a `test` script) and refuses a zero-test run
- [X] T005 [P] Add a mobile unit-test step to `.github/workflows/ci.yml` (`yarn workspace @liratek/mobile test`), with a test-count floor parsed from jest's `Tests:` line like the other jobs (rule 28); `mobile/node_modules` is already in `CI_CACHE_PATHS`

**Checkpoint**: `yarn install` clean; Metro starts; the existing app still opens on the iPhone 17 simulator.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the cache module from contracts/navigation.md and its provider.

- [X] T006 [P] Create `mobile/src/data/queryKeys.ts`: `balances(shop)`, `sinceLastCount(shop, drawers)`, `recent(shop, limit)`, `debtors(shop)`, `clientBalance(shop, clientId)`; every key is a readonly tuple starting with `shop` (data-model: "Every key starts with `shop` = the signed-in shop slug")
- [X] T007 [P] Create `mobile/src/data/unwrap.ts`: `unwrap<T>(r: ApiResult<T>): T` returns `data` or throws an `ApiError` carrying the `error` code (`NO_CONNECTION`, `UNAUTHORIZED`, or the server code), so query functions fail visibly (research R6)
\1(2026-10-10: `refetchOnWindowFocus` left at its default `true` — setting it to false would disable the AppState focus refetch of T010; /speckit-analyze F1) Create `mobile/src/data/queryClient.ts`: one module-level `QueryClient` with `staleTime: 30_000`, `gcTime: 600_000`, `refetchOnWindowFocus: false`, and `retry: (count, err) => count < 1 && code not in [UNAUTHORIZED, NO_CONNECTION]`; export `resetCache()` = `await queryClient.cancelQueries()` then `queryClient.clear()` (research R6, R8)
- [X] T009 [P] Create `mobile/src/data/useRefreshOnFocus.ts`: uses `useFocusEffect` from `expo-router`; skips the first focus; on later focuses calls `refetch()` for each given query whose `isStale` is true (research R5)
- [X] T010 In `mobile/src/app/_layout.tsx`, wrap `AuthProvider` in `QueryClientProvider client={queryClient}`, and wire `focusManager.setEventListener` to `AppState` (`active` = focused) once at module level (research R5)
- [X] T011 In `mobile/src/auth/AuthContext.tsx`, call `await resetCache()` before `setStatus("signedOut")` in BOTH `signOut()` and the `setUnauthorizedHandler` callback (FR-013, research R8)
- [X] T012 [P] Unit tests in `mobile/src/data/__tests__/queryKeys.test.ts`: every key starts with the shop slug; two shops never produce equal keys for the same read

**Checkpoint**: app still renders on the simulator with the provider in place; no "Invalid hook call" and no "No QueryClient set" error (research R4 proof). `yarn workspace @liratek/mobile test` reports > 0 tests.

---

## Phase 3: User Story 1 — Move between sections with one tap (P1) 🎯 MVP

**Goal**: five-tab bar; each section its own page; detail pages keep the bar.

**Independent test**: quickstart scenarios 1, 2, 7, 8, 10.

- [X] T013 [US1] Replace the Stack in `mobile/src/app/(app)/_layout.tsx` with `Tabs` from `expo-router`: tabs in order `index` (Home, `House`), `sell` (Sell, `Send`), `debts` (Debts, `Users`), `activity` (Activity, `History`), `settings` (Settings, `Settings`); `headerShown: false` for the tab-level screens; `tabBarHideOnKeyboard: true`; tab bar colours from `useTheme()` (`card` background, `border` top line, `accent` active, `textMuted` inactive); keep `PageBackground` around it and transparent scene backgrounds (FR-001, FR-015)
- [X] T014 [P] [US1] Create `mobile/src/app/(app)/sell/_layout.tsx`: a Stack with `index` (title "Sell", header hidden or themed as today) and `[provider]` (title "Record a sale"), header styles copied from the current `(app)/_layout.tsx`
- [X] T015 [P] [US1] Create `mobile/src/app/(app)/debts/_layout.tsx`: a Stack with `index` (title "Customer debts") and `[id]` (title "Client"), same header styles
- [X] T016 [US1] Create `mobile/src/app/(app)/sell/index.tsx`: the four sale tiles and `openSale()` moved out of Home (`SALES` list, `ModuleTile`, "Coming next" alert for vouchers); `router.push({ pathname: "/sell/[provider]", params: { provider } })` (FR-004)
- [X] T017 [US1] Move `mobile/src/app/(app)/sale/[provider].tsx` to `mobile/src/app/(app)/sell/[provider].tsx` with `git mv`; delete the empty `sale/` folder; no logic change in this task
- [X] T018 [US1] Move `mobile/src/app/(app)/client/[id].tsx` to `mobile/src/app/(app)/debts/[id].tsx` with `git mv`; in `mobile/src/app/(app)/debts/index.tsx` change the push to `pathname: "/debts/[id]"` (params `id`, `name`, `phone` unchanged); delete the empty `client/` folder
\1(2026-10-10: built directly on the cache, together with T026) [US1] Create `mobile/src/app/(app)/activity.tsx`: the "Latest transactions" section moved out of Home (`txnAmount`, `txnTime`, list rendering, pull-to-refresh), still using the direct `getRecentTransactions(15)` call for now (US2 moves it to the cache) (FR-006)
- [X] T020 [US1] Trim `mobile/src/app/(app)/index.tsx` to balances, "since the last count" and a "Latest transactions" link row that opens the Activity tab (`router.navigate("/activity")`); remove the Settings gear (Settings is a tab now), the sale tiles, the debts row and the transactions list; Home no longer calls `getRecentTransactions` (FR-003)
\1(2026-10-10: Settings gets the tab navigator's themed header; no SafeAreaView needed) [US1] Adjust `mobile/src/app/(app)/settings.tsx` for a tab: add a `SafeAreaView` top inset and a page title, since it no longer gets a Stack header (FR-007)
- [X] T022 [US1] Move shared helpers used by Home and Activity (`txnTime`, drawer label) into `mobile/src/utils/format.ts` so the two screens do not each keep a copy (rule 14)
\1(2026-10-10: route types were already regenerated by the running Metro; mobile `tsc` checked with a deliberate error first — it fails on it, so the clean run is real) [US1] Start Metro once (`yarn workspace @liratek/mobile start`, then stop) so `.expo/types/router.d.ts` regenerates for the new paths; then `yarn typecheck` and `yarn lint` clean (research R2)
\1(2026-10-10, Maestro on iPhone 17: all five tabs open and highlight; Sell → form → Home → Sell keeps the typed amount; tapping Sell / Debts again returns to the list; keyboard hides the tab bar; Light/Dark theme applies to the bar. Found and fixed: a form opened by link had no list under it, so neither Back nor re-tapping the tab could return — `unstable_settings.initialRouteName = "index"` in both tab stacks) [US1] On the simulator, run quickstart scenarios 1, 2, 7, 8 and 10; record results in this file

**Checkpoint**: tabs work end to end with the old loading code. Shippable on its own.

---

## Phase 4: User Story 2 — Each page loads only what it shows (P1)

**Goal**: each tab fetches through the cache, only on first open.

**Independent test**: quickstart scenario 3 (Home makes 2 requests on fresh sign-in; Activity's request appears only when opened).

- [X] T025 [US2] Home (`mobile/src/app/(app)/index.tsx`): replace `load()` / `useState` / `useFocusEffect` with two `useQuery` calls, `queryKeys.balances(shop)` → `unwrap(await getDrawerBalances())` and `queryKeys.sinceLastCount(shop, WALLET_DRAWERS)` → `unwrap(await getSinceLastCount(WALLET_DRAWERS))`; `shop` from `useAuth().shop.slug`; since-last-count stays optional (hidden when it fails, as today)
- [X] T026 [P] [US2] Activity (`mobile/src/app/(app)/activity.tsx`): `useQuery(queryKeys.recent(shop, 15))` → `unwrap(await getRecentTransactions(15))`
- [X] T027 [P] [US2] Debts list (`mobile/src/app/(app)/debts/index.tsx`): `useQuery(queryKeys.debtors(shop))` → `unwrap(await getDebtors())`; keep the local search filter
- [X] T028 [P] [US2] Customer page (`mobile/src/app/(app)/debts/[id].tsx`): `useQuery(queryKeys.clientBalance(shop, clientId))` → `unwrap(await getClientBalance(clientId))`; the repayment form state and submit stay as they are
- [X] T029 [US2] Errors on first load: when a query has no data and failed, show the same messages the screens show today (no connection → existing `messages.ts` text) with pull-to-refresh to retry; one tab failing does not affect the others (US2 #3)
- [ ] T030 [US2] (open: request log not captured; by code Home now issues 2 reads, balances + since-last-count) On the simulator with the backend log open, run quickstart scenario 3; record the request list in this file (SC-002)

**Checkpoint**: Home makes 2 requests on fresh sign-in; each tab loads on first open only.

---

## Phase 5: User Story 3 — Coming back shows the last data at once (P2)

**Goal**: instant return, background refresh when stale, failed refresh keeps old data.

**Independent test**: quickstart scenarios 4 and 5.

- [X] T031 [US3] Add `useRefreshOnFocus` to Home, Activity, Debts list and the customer page, passing each screen's queries (FR-009)
- [X] T032 [US3] Show the full-page spinner only when a query has no data yet (`isPending`); when it has data and is refetching, show nothing extra; when a refetch fails with data present, show a one-line "Could not refresh — pull down to retry" notice above the content (FR-010). Put the notice in a shared `mobile/src/components/RefreshNotice.tsx`
- [X] T033 [US3] Pull-to-refresh on Home, Debts, Activity and the customer page calls the screen's `refetch()` for all its queries and drives `RefreshControl` from a local `refreshing` flag set around `await Promise.all(refetch…)` (FR-011)
- [ ] T034 [US3] (open: Android timing not done; on the simulator returning to Home shows balances with no spinner) On the simulator, then the Android phone, run quickstart scenarios 4 and 5; record the Android timing by eye (SC-003, target under 0.3 s)

**Checkpoint**: returning to a tab never shows a full-page spinner.

---

## Phase 6: User Story 4 — After a sale or repayment, every page agrees (P2)

**Goal**: the invalidation map from data-model.md, applied after each successful money action.

**Independent test**: quickstart scenario 6.

- [X] T035 [P] [US4] Create `mobile/src/data/invalidation.ts`: pure `keysToInvalidate(shop, action)` where `action` is `{ kind: "transfer", paidBy: "CUSTOMER_ACCOUNT" | "WHISH" | "OMT", clientId: number | null }` or `{ kind: "repayment", clientId: number }`, returning exactly the data-model map — transfer into a wallet: `balances`, `sinceLastCount`, `recent`; transfer on the customer's account and repayment: those plus `debtors` and `clientBalance(clientId)`; and `invalidateAfter(shop, action)` that calls `queryClient.invalidateQueries({ queryKey })` per key. Invalidate `sinceLastCount` and `recent` by prefix (`[shop, "sinceLastCount"]`, `[shop, "recent"]`) so any drawer list or limit is covered
- [X] T036 [P] [US4] Unit tests in `mobile/src/data/__tests__/invalidation.test.ts`: one case per row of the data-model invalidation map, asserting the exact key set; a wallet transfer does NOT touch `debtors`; every returned key starts with the shop
- [X] T037 [US4] In `mobile/src/app/(app)/sell/[provider].tsx`, after `recordServiceSale` returns `success`, call `invalidateAfter(shop, { kind: "transfer", paidBy: method, clientId })` before the success alert; do not change the payload, the Idempotency-Key ref, or the messages (FR-012, FR-016)
- [X] T038 [US4] In `mobile/src/app/(app)/debts/[id].tsx`, after `recordRepayment` returns `success`, call `invalidateAfter(shop, { kind: "repayment", clientId })` and drop the manual `await load()`; payload and Idempotency-Key unchanged (FR-012, FR-016)
- [X] T039 [US4] After a successful transfer, `router.back()` returns to the Sell list as today; confirm the owner stays in the Sell tab
\1(2026-10-10, Maestro: a $1 repayment for Amir → customer page and Debts list 280 → 279, Home Whish App -280 → -279, Activity lists it — no pull needed) [US4] On the simulator, run quickstart scenario 6; record balance before and after, and that the transfer is listed on Activity and in the customer's debt (SC-004)

**Checkpoint**: one transfer updates Home, Activity and Debts without a manual pull.

---

## Phase 7: User Story 5 — Signing out forgets the shop's data (P3)

**Goal**: no data from one shop shown after signing in to another.

**Independent test**: quickstart scenario 9.

- [X] T041 [US5] Confirm T011 covers both exits; in `mobile/src/auth/AuthContext.tsx` make `completeSignIn` also call `resetCache()` before `setStatus("signedIn")`, as a guard for a crash or kill between sign-out and sign-in
- [ ] T042 [US5] (open: needs a second test tenant) Create a second test tenant on the local backend (as for `mobiletest` in the LIRA-289 quickstart) with different balances; run quickstart scenario 9 for both sign-out and a session revoked from web Settings; record results (SC-005)

**Checkpoint**: shop A's numbers never appear after signing in to shop B.

---

## Phase 8: Polish & cross-cutting

- [ ] T043 Run all gates: `yarn typecheck`, `yarn lint`, `yarn test` (confirm `@liratek/mobile` ran with > 0 tests and core/backend money suites ran with their usual counts — SC-006), `yarn build`, `node scripts/build-release-notes.cjs --check`
- [ ] T044 (skipped 2026-10-10: the phone app itself has no release note yet — it is not released to customers; its first note should be written once, when it ships, and include the tabs) [P] Add one line to `docs/release-notes/UNRELEASED.md` under the phone app heading (create "## 📱 Phone app" if missing): "The phone app now has a tab bar at the bottom — Home, Sell, Debts, Activity and Settings — and pages you have already opened show at once." (rule 30)
- [X] T045 [P] Update `specs/289-mobile-after-hours-sales/quickstart.md` and `docs/OPERATIONS.md` "Phone app" section for the new paths (`/sell/[provider]`, `/debts/[id]`) and the tab bar
- [X] T046 [P] Update LIRA-300 in `current_sprint.md` (status, what was built, what users will notice) and the phone row in `docs/plans/ongoing_plans/PLAN_OVERVIEW.md` / `MOBILE_APP_PLAN.md`
- [ ] T047 Regenerate iOS only if a native dependency was added (`npx expo prebuild --platform ios --clean`; expected not needed — react-query and jest are JS only); build a fresh signed APK (`NODE_ENV=production APP_VARIANT=preview npx expo prebuild --platform android --clean --no-install && cd mobile/android && ./gradlew assembleRelease`, JDK 17, local keystore — no EAS) and run quickstart scenarios 3–6 and 9 on the Android phone
- [ ] T048 Check `yarn.lock` changes did not break the API Docker build: `backend/Dockerfile` focuses root + backend; confirm with a local `yarn workspaces focus liratek @liratek/backend` dry run or by watching the deploy workflow after the push (plan Risks 4)

---

## Dependencies & execution order

- **Setup (T001–T005)** → **Foundational (T006–T012)** → stories.
- **US1 (T013–T024)** has no story dependency; it uses the old loading code, so it ships alone.
- **US2 (T025–T030)** needs US1's screens (Activity, trimmed Home) and Foundational.
- **US3 (T031–T034)** needs US2 (queries exist).
- **US4 (T035–T040)** needs US2; T035/T036 can start right after Foundational.
- **US5 (T041–T042)** needs Foundational only (T011); its manual check is easiest after US2.
- **Polish** after all stories.

Inside a phase: T002 before any render check; T017/T018 (file moves) before T023 (typed routes); T035 before T037/T038.

## Parallel examples

- Setup: T003 and T005 together, after T001.
- Foundational: T006, T007, T009 and T012 together; T008 needs T007 (error codes).
- US1: T014 and T015 together; T016–T019 touch different files and can run together after T013.
- US2: T026, T027 and T028 together after T025 sets the pattern.
- US4: T035 and T036 together.
- Polish: T044, T045 and T046 together.

## Implementation strategy

1. **MVP = Setup + Foundational + US1.** Tabs work, each section is its own page; data still loads as today. Show
   it on the simulator before going on.
2. **+ US2 + US3:** the speed gain (per-tab loading, instant return). Check on the Android phone.
3. **+ US4:** pages agree after money actions.
4. **+ US5:** the cross-shop guard, proven with two tenants.
5. Polish, gates, fresh APK. Commit only on the owner's go; push decision separate.
