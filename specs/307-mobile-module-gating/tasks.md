---
description: "Task list for LIRA-307 — phone app follows the shop's module switches"
---

# Tasks: Phone app follows the shop's module switches

**Input**: Design documents from `/specs/307-mobile-module-gating/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/enabled-modules.md, quickstart.md

**Tests**: included. The constitution (rule 17) requires each guard test to be written first and seen failing before
the code it guards exists. Record the real failure output in the task's commit/notes.

**Organization**: grouped by user story (spec.md). All paths are relative to the repo root; the app lives in `mobile/`.
Run commands from `mobile/` (`npx jest …`, `npx tsc --noEmit -p .`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 Sell tab gate, US2 Debts tab gate, US3 Home drawer lines, US4 fail-closed offline

---

## Phase 1: Setup

**Purpose**: ticket bookkeeping before code.

- [ ] T001 Add ticket LIRA-307 to `current_sprint.md` (same layout as LIRA-302..306): title "Phone app follows the
      shop's module switches", link `specs/307-mobile-module-gating/`, owner decisions D1–D3 from spec.md, and the line
      "What users will notice: on the phone app, the Sell and Debts tabs and the Home drawer lines now follow Settings →
      Modules, like the web app; with no connection they stay hidden until the phone can check."

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the module list read and the gate state. Every story reads `isEnabled` from here.

- [ ] T002 [P] Write failing-first tests in `mobile/src/utils/__tests__/moduleGates.test.ts` (jest picks up
      `src/**/__tests__/**/*.test.ts`) for the not-yet-existing `mobile/src/utils/moduleGates.ts`: - `parseEnabledModuleKeys(body)` returns `Set(["debts","ipec_katch"])` for
      `{ success: true, modules: [{ key: "debts" }, { key: "ipec_katch", label: "x" }] }`; - it THROWS for `{ success: false }`, for `{ success: true }` (no `modules`), for `modules` not an array, and for
      an entry whose `key` is not a string — "Any other shape is treated as a failure → gate stays closed" (contract); - `gateFrom(undefined).isEnabled("debts") === false` and `gateFrom(undefined).verified === false`
      ("`unverified` … `isEnabled(key)` always `false`", data-model.md); - `gateFrom(new Set(["debts"]))`: `verified === true`, `isEnabled("debts") === true`, `isEnabled("ipec_katch") === false`.
      Run `npx jest src/utils/__tests__/moduleGates.test.ts` and record the failure (module not found). Do NOT write
      `moduleGates.ts` before this run.
- [ ] T003 Create `mobile/src/utils/moduleGates.ts` (pure: no React, no React Native imports) exporting
      `SALE_MODULE = "ipec_katch"`, `DEBTS_MODULE = "debts"`, `type GateState = { verified: boolean; isEnabled: (key: string) => boolean }`,
      `parseEnabledModuleKeys(body: unknown): ReadonlySet<string>` (throws on any shape other than
      `{ success: true, modules: { key: string }[] }`), and `gateFrom(keys: ReadonlySet<string> | undefined): GateState`.
      Re-run T002's command: all pass; record the test count.
- [ ] T004 [P] Add `modules: (shop: string) => [shop, "modules"] as const` to `mobile/src/data/queryKeys.ts`, and add
      `queryKeys.modules(shop)` to the `ALL` list in `mobile/src/data/__tests__/queryKeys.test.ts` so the
      "every key starts with the shop" guard covers it.
- [ ] T005 [P] Create `mobile/src/api/modules.ts` exporting
      `getEnabledModules(): Promise<ApiResult<ReadonlySet<string>>>`: `request<unknown>("GET", "/api/modules/enabled")`
      (from `./client`); on `success` return `{ success: true, data: parseEnabledModuleKeys(r.data) }`; let the parse
      throw on a malformed body. Same style as `mobile/src/api/catalog.ts`.
- [ ] T006 Create `mobile/src/data/useModuleGates.ts` exporting `useModuleGates(): GateState`: `useQuery({ queryKey:
  queryKeys.modules(slug), queryFn: async () => unwrap(await getEnabledModules()), enabled: !!slug, staleTime: 0 })`
      with `slug` from `useShopSlug()`; return `gateFrom(query.data)`. No persistence of any kind ("Held only in the
      in-memory query cache … never written to device storage (FR-005)"). Foreground refetch comes from the existing
      `focusManager` wiring in `mobile/src/app/_layout.tsx` — do not add another listener.

**Checkpoint**: `npx jest` and `npx tsc --noEmit -p .` green; nothing visible changes yet.

---

## Phase 3: User Story 1 — Switched-off sales disappear (P1) 🎯 MVP

**Goal**: Sell tab shows only when `ipec_katch` is in the verified list (FR-002, D1, D2).

**Independent Test**: quickstart scenarios 1 and 2.

- [ ] T007 [US1] Add failing-first tests to `mobile/src/utils/__tests__/moduleGates.test.ts` for a not-yet-existing
      `sellTabVisible(gate: GateState): boolean`: false when unverified; false when verified without `ipec_katch`;
      true when verified with `ipec_katch`; and a guard that `SALE_MODULE === "ipec_katch"` with a comment citing
      `frontend/src/features/recharge/types/index.ts` (all four providers use `module: "ipec_katch"`). Run and record
      the failure.
- [ ] T008 [US1] Implement `sellTabVisible` in `mobile/src/utils/moduleGates.ts`; T007 passes.
- [ ] T009 [US1] In `mobile/src/app/(app)/_layout.tsx` call `useModuleGates()` and set
      `hidden={!sellTabVisible(gates)}` on `<NativeTabs.Trigger name="sell">`.
- [ ] T010 [US1] In the same file, move the phone to Home when the tab on screen gets hidden (FR-007): read the current
      top segment with `useSegments()` from `expo-router`; in a `useEffect`, if it is `"sell"` and
      `!sellTabVisible(gates)`, call `router.replace("/")` (the `(home)` group's index). Write it as a helper keyed by
      tab name so T013 reuses it.
- [ ] T010a [US1] In `mobile/src/app/(app)/sell/_layout.tsx` call `useModuleGates()` and return `null` (instead of the
      `Stack`) while `!sellTabVisible(gates)`, so the whole Sell stack unmounts and any cart in
      `sell/catalog/[provider].tsx` is discarded (spec Edge Cases: "No half-filled sale is kept"). Same for
      `mobile/src/app/(app)/debts/_layout.tsx` with `debtsTabVisible` in T013.

**Checkpoint**: quickstart 1 and 2 pass on the iOS simulator.

---

## Phase 4: User Story 2 — Switched-off Accounts disappears (P1)

**Goal**: Debts tab shows only when `debts` is in the verified list (FR-003).

**Independent Test**: quickstart scenarios 3 and 4.

- [ ] T011 [US2] Add failing-first tests for a not-yet-existing `debtsTabVisible(gate: GateState): boolean` to
      `mobile/src/utils/__tests__/moduleGates.test.ts` (false unverified; false without `debts`; true with `debts`).
      Run and record the failure.
- [ ] T012 [US2] Implement `debtsTabVisible` in `mobile/src/utils/moduleGates.ts`; T011 passes.
- [ ] T013 [US2] In `mobile/src/app/(app)/_layout.tsx` set `hidden={!debtsTabVisible(gates)}` on
      `<NativeTabs.Trigger name="debts">` and extend T010's helper so an on-screen `"debts"` tab that gets hidden also
      goes to Home. Apply T010a's unmount rule to `mobile/src/app/(app)/debts/_layout.tsx` with `debtsTabVisible`.

**Checkpoint**: quickstart 1–4 pass (SC-001: tab bar matches the web home grid in all 4 combinations).

---

## Phase 5: User Story 4 — No connection means no gated parts (P1)

**Goal**: fail closed (D3, FR-005). Mostly delivered by Phase 2's `gateFrom(undefined)`; this phase proves it end to end.

**Independent Test**: quickstart scenarios 6, 7 and 9.

- [ ] T014 [US4] Check `mobile/src/data/queryClient.ts` and `mobile/src/app/_layout.tsx` have no query persister
      (no `persistQueryClient`, no AsyncStorage/SecureStore write of query data). If one exists, exclude
      `queryKeys.modules` from it. Note the finding in the ticket.
- [ ] T015 [US4] Run quickstart scenario 6 (cold start in airplane mode) on the iOS simulator: only Home, Activity,
      Settings in the tab bar. Then scenario 7 (connection back, app to foreground): switched-on tabs appear with no
      restart. Then scenario 9 (verified, then airplane mode): tabs stay. Save screenshots under the session scratchpad
      and note results in the ticket.

**Checkpoint**: SC-002 met.

---

## Phase 6: User Story 3 — Home shows only switched-on drawers (P2)

**Goal**: Home drawer lines follow the web Dashboard rule (FR-004).

**Independent Test**: quickstart scenario 5.

- [ ] T016 [US3] Add failing-first tests for a not-yet-existing `visibleDrawers(drawers: string[], gate: GateState): string[]`
      to `mobile/src/utils/__tests__/moduleGates.test.ts`, built on `isDrawerVisible` from
      `@liratek/core/constants/drawerModules`: unverified → owned drawers (`Binance`, `Katsh`, `Whish_App`) removed,
      unowned ones (e.g. `"Cash"`, an unknown `"Mystery"`) kept; verified with `binance` → `Binance` kept;
      verified without `omt_whish` → `Whish_App`/`OMT_App` removed; order preserved. Run and record the failure.
- [ ] T017 [US3] Implement `visibleDrawers` in `mobile/src/utils/moduleGates.ts` as
      `drawers.filter((d) => isDrawerVisible(d, gate.isEnabled))`; T016 passes. Do not copy the drawer→module map —
      import it from core (rule 14).
- [ ] T018 [US3] In `mobile/src/app/(app)/(home)/index.tsx` call `useModuleGates()` and pass both lists through
      `visibleDrawers`: `sortedDrawers(balances.data)` (Drawer balances, including the "No drawers yet." empty check)
      and `sinceCount.data` (filter entries by `d.drawer`). Keep the `WALLET_DRAWERS` request list as is; only the
      rendered rows are filtered. Also add the modules query's `refetch` to Home's pull-to-refresh list
      (`usePullRefresh([...])`) so pulling down re-checks the gates (spec US4 #2).

**Checkpoint**: quickstart 5 passes; phone Home rows match web Dashboard cards (SC-003).

---

## Phase 7: Polish & cross-cutting

- [ ] T018a Run quickstart scenarios 1–5 on the iOS simulator. For each of 1–4, screenshot the phone tab bar next to
      the web home grid for the same switches (SC-001, 4 of 4 must match). For 5, compare the phone Home drawer lines
      with the web Dashboard drawer cards (SC-003). Record results in the ticket.
- [ ] T019 Run quickstart scenarios 8 (put one item in a Katsh cart, then flip `ipec_katch` off → phone on Home; flip it back
      on, open Sell → Katsh: the cart is empty) and 10 (sign out, sign in
      to another shop → that shop's gates) on the iOS simulator; record results.
- [ ] T020 [P] Run the same tab scenarios (1–4, 6) on an Android build/emulator if one is available; otherwise state
      "Android not run" in the ticket.
- [ ] T021 Gates: from `mobile/` run `npx tsc --noEmit -p .` and `npx jest` and record elapsed time and test counts
      (rule 28: a fast empty run is not a pass). `mobile/package.json` has no `lint` script, so root `yarn lint` does not
      cover the phone — the phone's gates are `tsc` + `jest` (CI's mobile test job enforces a test-count floor). Also
      run `npx prettier --check` on every changed `mobile/` file.
- [ ] T022 [P] Release note: add one line under a phone-app heading in `docs/release-notes/UNRELEASED.md` only if the
      phone app is already shipped to shops; if not, record "no release note — app unreleased" in the ticket (rule 30).
- [ ] T023 Mark LIRA-307 done in `current_sprint.md` with the verification results; commit the spec folder with the
      code (specs are committed with the feature).

---

## Dependencies & execution order

- Phase 1 → Phase 2 → stories. T002 before T003 (failing-first). T004, T005 parallel; T006 needs T003–T005.
- US1 (Phase 3) and US2 (Phase 4) both edit `mobile/src/app/(app)/_layout.tsx` → do them in order (US1 then US2);
  T007, T011 and T016 all edit `mobile/src/utils/__tests__/moduleGates.test.ts`, so they are sequential.
- US4 (Phase 5) needs Phases 3–4 for the tab-bar checks.
- US3 (Phase 6) depends only on Phase 2; can run in parallel with Phases 3–5 (different files: home screen).
- Polish after all stories.

```text
T001 → T002 → T003 ┬→ T006 ┬→ US1 (T007→T008→T009→T010) → US2 (T011→T012→T013) → US4 (T014, T015)
       T004 ───────┤        └→ US3 (T016→T017→T018)
       T005 ───────┘                                                         → Polish (T019–T023)
```

## Parallel examples

- Phase 2: T004 (`queryKeys.ts`) and T005 (`api/modules.ts`) together, after T003.
- After Phase 2: one person/agent on US1→US2→US4 (`_layout.tsx`), another on US3 (`(home)/index.tsx`).

## Implementation strategy

- **MVP**: Phases 1–3 (Sell tab gated, fail-closed by construction). This is the case the owner raised: the phone
  offering sales a shop turned off.
- Then US2 (same pattern), US4 proof, US3 (Home rows), Polish.
- Stop and validate on the simulator at each checkpoint; the gate rules are pure and unit-tested, the tab behaviour is
  only provable on a device.
