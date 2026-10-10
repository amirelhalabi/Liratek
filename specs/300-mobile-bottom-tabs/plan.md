# Implementation Plan: Phone app bottom tabs

**Branch**: `300-mobile-bottom-tabs` (work on `main`, ticket LIRA-300) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/300-mobile-bottom-tabs/spec.md`

## Summary

Replace the phone app's single Stack (Home with everything on it, plus pushed screens) with a bottom tab bar of five
tabs: Home, Sell, Debts, Activity, Settings. Sell and Debts get their own nested Stack, so their detail pages
(transfer form, customer page) keep the tab bar and their state. All reads move into a TanStack Query cache keyed by
shop: each tab fetches on first open, returning shows the last data at once, stale data refreshes on focus and on
return from the background. After a sale or repayment, one helper invalidates exactly the affected reads. Sign-out
and a 401 cancel and clear the cache. Money submissions are untouched.

## Technical Context

**Language/Version**: TypeScript ~5.9 (strict), React 19.2.0, React Native 0.83.10

**Primary Dependencies**: Expo SDK 55, Expo Router ~55.0.18 (`Tabs`, via `@react-navigation/bottom-tabs` 7.20.0,
already installed); new: `@tanstack/react-query` ^5.101.0; new dev: `jest`, `jest-expo` ~55 (research R9)

**Storage**: none (in-memory cache only)

**Testing**: jest + jest-expo for pure modules (query keys, invalidation map); manual scenarios in quickstart for UI
and timing; existing core/backend money tests for SC-006

**Target Platform**: iOS (simulator, dev build) and Android (signed release APK, built locally)

**Project Type**: mobile app (`mobile/` workspace in the Yarn monorepo)

**Performance Goals**: return to an opened tab in under 0.3 s with no full-page spinner (SC-003); Home makes 2
requests on a fresh sign-in instead of 3 (SC-002)

**Constraints**: no server/core/web change; no EAS or online Expo; one React copy at runtime (research R4); money
submit code unchanged (FR-016)

**Scale/Scope**: 5 tabs, 7 routes, 5 cached reads, ~8 files moved or changed in `mobile/src/app/`, ~5 new files in
`mobile/src/data/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                              | Status | Note                                                                                           |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| I. One core, two transports (19, 22, 27, 29) | N/A    | Phone reuses existing REST reads/writes; no new endpoint, payload or core module (research R10). Existing `X-Client-Day` header unchanged. |
| II. Layer boundaries (13)              | Pass   | No SQL, service or handler touched.                                                            |
| III. Contracts defined once (14, 21, 23) | Pass   | No new schema; phone payload types still derive from core schemas (`z.input<…>`).               |
| IV. Money integrity (16, 18, 20, 26)   | Pass   | Submit functions and Idempotency-Key refs unchanged (FR-016, research R7); only cache invalidation added after `success`. |
| V. Data and security                   | Pass   | Cache keyed by shop, cleared with in-flight reads cancelled on sign-out and 401 (research R8). |
| VI. Testing (17, 28)                   | Pass   | New mobile jest suite wired into `yarn test` and CI with a count floor; invalidation-map tests are new behaviour (no unfixed version), so not failing-first guards. |
| VII. Code quality (1, 4)               | Pass   | Strict TS, no `any`; phone has no logger module, and no `console.log` is added.                |
| Delivery (30)                          | Pass   | One release-note line under a phone heading in `UNRELEASED.md`.                                |

No violations. Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/300-mobile-bottom-tabs/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R10
├── data-model.md         # cache keys, invalidation map, tabs
├── contracts/navigation.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md              # next: /speckit-tasks
```

### Source Code

```text
mobile/
├── package.json                 # + @tanstack/react-query, jest, jest-expo, "test" script
├── jest.config.js               # new (jest-expo preset)
├── metro.config.js              # + pin react / react-native to mobile/node_modules (R4)
└── src/
    ├── app/
    │   ├── _layout.tsx          # + QueryClientProvider, focusManager ↔ AppState
    │   └── (app)/
    │       ├── _layout.tsx      # Stack → Tabs (5 tabs, themed, hide on keyboard)
    │       ├── index.tsx        # Home: balances + since-last-count only, via queries
    │       ├── activity.tsx     # new: latest transactions (moved from Home)
    │       ├── settings.tsx     # becomes a tab
    │       ├── sell/
    │       │   ├── _layout.tsx  # new Stack
    │       │   ├── index.tsx    # new: sale tiles (moved from Home)
    │       │   └── [provider].tsx  # moved from sale/[provider].tsx; + invalidateAfter
    │       └── debts/
    │           ├── _layout.tsx  # new Stack
    │           ├── index.tsx    # debtor list via query
    │           └── [id].tsx     # moved from client/[id].tsx; query + invalidateAfter
    ├── auth/AuthContext.tsx     # resetCache() on signOut and 401
    └── data/                    # new
        ├── queryClient.ts
        ├── queryKeys.ts
        ├── invalidation.ts      # keysToInvalidate, invalidateAfter
        ├── useRefreshOnFocus.ts
        ├── unwrap.ts
        └── __tests__/           # queryKeys + invalidation tests
scripts/run-tests.mjs            # no change expected (auto-discovers workspaces with a "test" script); verify
.github/workflows/ci.yml         # + mobile test step with count floor
```

**Structure Decision**: all changes stay in the `mobile/` workspace, plus one CI step. Route moves are listed in
[contracts/navigation.md](contracts/navigation.md).

## Risks

1. **Duplicate React (blocking):** handled by research R4; proven only by a real render on the simulator.
2. **Stale typed routes:** run Metro once after the file moves, before `yarn typecheck` (research R2).
3. **Silent no-refresh on tab switch:** handled by `useRefreshOnFocus` + `focusManager` (research R5); covered by
   quickstart scenarios 4–6.
4. **`yarn.lock` and Docker:** adding packages to `mobile/` changes `yarn.lock`; the API Docker image focuses root +
   backend (LIRA-289) and should be unaffected. Check that the deploy workflow still builds before pushing.

## Complexity Tracking

None.
