# Implementation Plan: Phone app follows the shop's module switches

**Branch**: `307-mobile-module-gating` (work happens on `main`; ticket LIRA-307) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/307-mobile-module-gating/spec.md`

## Summary

The phone reads the shop's enabled modules from the same endpoint the web uses (`GET /api/modules/enabled`) and hides
what the web hides: the Sell tab when `ipec_katch` is off (all four phone sales sit under it on the web), the Debts tab
when `debts` is off, and Home drawer lines whose module is off (core's `isDrawerVisible`, the web Dashboard's rule).
It fails closed: until the list is fetched in the current run of the app, every gated part is hidden, so a phone
started offline never opens a switched-off module. No server, schema or core change.

## Technical Context

**Language/Version**: TypeScript (strict), React Native 0.83 / Expo SDK 55 (`mobile/`)

**Primary Dependencies**: expo-router 55 (`NativeTabs`), TanStack Query 5, `@liratek/core` source via Metro mapping

**Storage**: none new — the list lives only in the in-memory query cache (research R4)

**Testing**: jest (`jest-expo`, `mobile/src/**/__tests__/*.test.ts`) for pure gate rules; simulator checks per
[quickstart.md](./quickstart.md)

**Target Platform**: iOS 26 (Liquid Glass bar) and older iOS; Android (Material bottom bar)

**Project Type**: mobile app consuming the existing REST backend

**Performance Goals**: one small GET per app start/foreground; gated tabs appear as soon as it returns

**Constraints**: fail closed (D3); match the web's gates exactly (D1); no new endpoint

**Scale/Scope**: 3 screens touched (tab layout, Home, Sell tab entry), ~5 new small files

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                             | Applies?                                                                                                            | Status             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| I. One core, two transports           | The phone is a REST-only client; no desktop/web code changes. Reuses core's `isDrawerVisible` instead of a copy.    | Pass               |
| I. Leaf modules from core (rule 29)   | `drawerModules.ts` has zero imports.                                                                                | Pass               |
| II. Layer boundaries                  | No service/repository change.                                                                                       | N/A                |
| III. Contracts defined once           | Reads an existing route; the phone types only the field it uses (`key`). No write path, no schema.                  | Pass               |
| IV. Money integrity                   | Read-only; no transaction, payment, drawer or ledger write.                                                         | N/A                |
| V. Data and security                  | No SQL. Route already behind `authenticateJWT` + tenant scoping. Hiding is UI-only, same as web (spec Assumptions). | Pass (limit noted) |
| VI. Testing — failing-first (rule 17) | Gate-rule tests written and seen failing before the rules exist.                                                    | Planned            |
| VI. Green means it ran (rule 28)      | Record jest test counts.                                                                                            | Planned            |
| VII. Code quality                     | Strict TS, no `any`, no `console.log`.                                                                              | Planned            |

Post-design re-check: unchanged — design adds no write path, no SQL, no new contract.

## Project Structure

### Documentation (this feature)

```text
specs/307-mobile-module-gating/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── enabled-modules.md
└── tasks.md             # /speckit-tasks (not yet)
```

### Source Code

```text
mobile/src/
├── api/modules.ts                     # NEW getEnabledModules() → GET /api/modules/enabled, keys only
├── data/queryKeys.ts                  # + modules(shop)
├── data/useModuleGates.ts             # NEW hook: query (staleTime 0) → gate state
├── utils/moduleGates.ts               # NEW pure rules: SALE_MODULE, tabVisible(), drawerVisible(), parse
├── utils/__tests__/moduleGates.test.ts# NEW failing-first unit tests
├── app/(app)/_layout.tsx              # Trigger hidden={…} for sell / debts; move to Home if active tab hides
└── app/(app)/(home)/index.tsx         # filter both drawer lists through drawerVisible()
```

**Structure Decision**: phone-only. Pure rules in `utils/` (testable under the existing jest config without React
Native), the fetch in `api/`, the React glue in `data/` — the split the phone already uses (e.g. `utils/activity.ts`

- `data/useRecentTransactions.ts`).

## Design notes

- **Gate state** (see [data-model.md](./data-model.md)): `unverified | { verified: true, keys: Set<string> }`.
  `isEnabled(key)` is false while unverified. Derived from the query: `data` present → verified; no data (pending,
  error, `NO_CONNECTION`, malformed) → unverified. A failed refetch after success keeps `data`, so the verified list
  survives a dropped connection within the run (spec Story 4 #3).
- **Malformed response**: `parseEnabledModuleKeys` accepts only `{ success: true, modules: [{ key: string }, …] }`; anything
  else throws, so the query errors and the gate stays closed.
- **Tabs**: `<NativeTabs.Trigger name="sell" hidden={!sellTabVisible(gates)}>`, same for `debts` with `debtsTabVisible`. An effect
  in the layout watches the active route; when its tab's gate closes, `router.replace("/")` (the `(home)` group's index) (FR-007; research R6).
- **Home**: `sortedDrawers(...).filter((d) => isDrawerVisible(d, gates.isEnabled))` for Drawer balances and Since last
  count.
- **Sign-out**: `resetCache()` already clears the query cache, so the next shop starts unverified.

## Risks

- **R2 inconsistency carried over**: Whish/OMT App sales follow `ipec_katch` while their drawers follow `omt_whish`, as
  on the web. Flagged to owner; out of scope.
- **Tab bar changes shape after launch**: Sell/Debts appear a moment after start, once the list loads. Accepted cost of
  fail-closed; on a normal connection it is one request.
- **NativeTabs `hidden` on the active tab** is unverified (R6) — covered by the explicit redirect and a simulator check.
- **UI-only gate**: a switched-off module's API still accepts requests (same as web).

## Complexity Tracking

None — no constitution violations.
