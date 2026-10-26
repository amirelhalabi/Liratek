---
description: "Task list for LIRA-343 OMT settlement by day"
---

# Tasks: OMT settlement by day (LIRA-343)

**Input**: Design documents from `specs/343-omt-settle-by-day/`: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md). Mock: https://claude.ai/artifact/VWkboFyYcNH7ZcFzSLxdf4.

**Tests are required** (constitution VI, CLAUDE.md rules 17, 24, 28). Every guard test is written first and run against the unchanged code. Record the real failure in the task's note, then write the code. Never revert finished code to prove a test. If a test was written after its code, say "not proven failing-first".

**Running tests (owner rules)**:
- Ask the owner before running any suite.
- Run only the affected test files, by explicit path. Never run full jest suites.
- No Electron on the owner's Mac: desktop e2e specs may be edited but are not run here.
- After any `packages/core` change, rebuild and sync core before frontend / e2e runs: `cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.
- A green run counts only after checking the test count and elapsed time (rule 28).

**Organization**: Tasks are grouped by user story (spec.md US1–US7) so each can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[USn]**: user story from spec.md

---

## Phase 1: Setup (shared groundwork)

**Purpose**: Small exports and type fields every later task uses.

- [X] T001 Export `NOT_REFUNDED_SQL` (today module-private, ~:1608) from `packages/core/src/repositories/FinancialServiceRepository.ts`, and replace the re-typed `COALESCE(is_refunded, 0) = 0` literals in the account-queue code of `packages/core/src/repositories/SupplierRepository.ts` (`ledgerNotRefunded` keeps its own alias form) with imports where they mean the same thing (rule 14). No behaviour change.
- [X] T002 [P] Add four fields to `AccountUnsettledRow` (`packages/core/src/repositories/SupplierRepository.ts` ~:799) and to its UI mirror (`packages/ui/src/api/types.ts` ~:643):
  - `shop_day: string` ("`YYYY-MM-DD`: the shop's calendar day of `created_at`, computed by the repository with `localDayExpr`")
  - `source_ref_table: string | null`
  - `row_scope: "DAY" | "ACCOUNT"` ("by provenance, not sign")
  - `transaction_id: number | null` (the unified `transactions.id`)
  Leave them unpopulated for now (typed but set by T006).
- [X] T003 [P] Add the read schemas `accountMonthSchema` (`month` matches `/^\d{4}-(0[1-9]|1[0-2])$/`) and `accountDaySchema` (`day` matches `/^\d{4}-\d{2}-\d{2}$/`) to `packages/core/src/validators/supplier.ts`, and export them from `packages/core/src/index.ts` and `packages/core/src/browser.ts`.

---

## Phase 2: Foundational (blocking)

**Purpose**: The pure math and the single row source that every story depends on. **No story work starts before this phase is done.**

### Credit classification (research R4)

- [X] T004 Write a failing-first test `packages/core/src/utils/__tests__/accountRowScope.test.ts` for `rowScopeOf(row)`:
  - FINANCIAL_SERVICE rows (incl. a RECEIVE with negative owed) → `DAY`
  - a LEDGER `PAYMENT` with `source_ref_table = 'recharges'` (OMT App cash-out) → `DAY`
  - a LEDGER row whose `transaction_id` points at a `SUPPLIER_SETTLEMENT` transaction (overpay `PAYMENT` negative, overpay `SUPPLIER_PAYS_US` **positive**, amount-first commission credit `SUPPLIER_PAYS_US`) → `ACCOUNT`
  - a manual Pay / Receive `PAYMENT` with no `source_ref_table` → `ACCOUNT`
  - iPick / OMT App TOP_UP charges → `DAY`
  Record the failure (module missing).
- [X] T005 Implement `packages/core/src/utils/accountRowScope.ts`:
  - `rowScopeOf(row)` (pure, browser-safe, no Node import — rule 29);
  - its SQL twin, kept ONCE as `accountRowScopeSql(alias)` in `SupplierRepository.ts` (rule 14; the utils copy was removed). It needs the settlement link, so the SQL joins `transactions` on `l.transaction_id` for `type = 'SUPPLIER_SETTLEMENT'`.
  Writer audit done 2026-10-26: no writer misclassified (DISCOUNT with no source → DAY, confirmed); see agent report. Also audit every writer of a negative `supplier_ledger` row for OMT-account members (`SupplierRepository.ts`, `RechargeRepository.ts`, `FinancialServiceRepository.ts`) and list each writer with its class in this task's note. Add a test case for any writer not yet covered. T004 must pass.

### One row source: open and range modes (research R2, R3)

- [X] T006 Write failing-first `packages/core/src/repositories/__tests__/SupplierRepository.lira343MonthRows.test.ts` (use `testHelpers/omtAccountDb.ts`):
  1. **Shop day.** A row stored `2026-10-24 22:30:00` UTC, read with client tz offset +180 (run inside `runWithTenant(..., { clientTzOffsetMinutes: 180 })`), returns `shop_day = '2026-10-25'`.
  2. **Range mode** returns closed rows too: a legacy whole-row settled FS row (`is_settled = 1`, `settlement_id` set, no coverage) is returned with `remaining_* = 0`.
  3. **Born-settled FS row.** An FS row born `is_settled = 1` of a non-pending type is returned with owed 0, so its day has activity.
  4. **Exclusions**: SETTLEMENT ledger rows, FS auto siblings (`source_ref_table = 'financial_services'`) and `isSettlementCommissionCredit` rows are excluded; refunded rows are excluded.
  5. **Invariant**: for every `shop_day` and currency, Σ(amount − covered) over range-mode DAY rows equals Σ `remaining` over the open-mode DAY rows of that day.
  6. **New fields**: open mode rows now carry `shop_day`, `source_ref_table`, `row_scope` and `transaction_id`.
- [X] T007 Refactor `getAccountUnsettled` (`packages/core/src/repositories/SupplierRepository.ts` ~:2901) into one private builder `_accountRows(accountId, { mode: "open" } | { mode: "range", fromUtc, toUtc })`, used by `getAccountUnsettled` (open) and a new `getAccountRows` (range). Range mode:
  - keeps the members (`accountMemberOf`), both FS branches (`getUnsettledBySupplier`'s pending-type and SEND `cost > 0` branches), the not-refunded predicates, the FS-sibling exclusion and `isSettlementCommissionCredit`;
  - drops only `is_settled = 0` / `settlement_id IS NULL`;
  - adds a third FS branch for born-settled non-pending rows (owed 0);
  - excludes `entry_type = 'SETTLEMENT'`;
  - filters `created_at` to `[fromUtc, toUtc)`.
  Both modes:
  - project `shop_day` via `localDayExpr(created_at)` (`reportingTimeFragments.ts`) — never `substr(created_at,1,10)` (rule 27);
  - set `row_scope` via T005;
  - project `source_ref_table` and the unified `transaction_id`;
  - compute coverage with ONE batched `getRowCoverage(kind, ids)`-style read, not one query per row (keep `_withCoverage` semantics).
  Add any FS-side helper needed to `packages/core/src/repositories/FinancialServiceRepository.ts`, reusing `SUPPLIER_OWED_EXPR` / `pendingSettlementSql` (rule 14). `tenant_id` on every query. T006 must pass; the existing LIRA-322 queue tests must stay green (run them by path).

### Generic days util (data-model "Day")

- [X] T008 [P] Write failing-first `packages/core/src/utils/__tests__/settleDays.test.ts` for `buildSettleDays(rows, { today, month })`, using the mock's October (quickstart §2):
  - 14 Oct `NONE`; settled days `SETTLED`;
  - 21 Oct `PARTIAL`, left $47, `paid_pct_usd` ≈ 0.83;
  - 22 Oct `PARTIAL`, `currency_state_usd = 'PAID'`, `currency_state_lbp = 'OWED'`, left 900,000 LBP;
  - 25 Oct (Sunday) `UNPAID`, left $200 and 990,000 LBP;
  - month left $482.00 + 1,890,000 LBP;
  - an `ACCOUNT` row on 20 Oct leaves 20 Oct `SETTLED`;
  - `selectable` is false for future days and `NONE` days.
- [X] T009 [P] Implement `packages/core/src/utils/settleDays.ts` with signature `buildSettleDays(rows, { today, month, coveredTypes })` (`coveredTypes` drives `waiting_count` via `isOmtRowCovered`; pass undefined for non-OMT screens), generic (rows need only `shop_day`, signed `remaining_usd`/`remaining_lbp`, `amount_usd`/`amount_lbp`, covered amounts, `row_scope`). Output fields exactly as data-model.md "Day":
  - `state` ∈ {`NONE`, `SETTLED`, `UNPAID`, `PARTIAL`}
  - `left_*`, `owed_*`
  - `paid_pct_*` = "`(owed − max(left,0)) / owed`, or null when that currency has no debt that day"
  - `currency_state_*` ∈ {`OWED`, `PART`, `PAID`}
  - `selectable`, `waiting_count`, `account_marks`
  Also export `openDaysBefore(rows, today)` (default selection / older-month link) and `monthLeft(days)`. Pure, browser-safe; it must not import `utils/requestDay.ts` (rule 29). Export from `packages/core/src/browser.ts` and `index.ts`. T008 must pass, and `packages/core/src/__tests__/browserEntryIsNodeFree.guard.test.ts` must stay green.

### Allocator: account credits the user sets (research R5, owner Q1)

- [X] T010 Write failing-first `packages/core/src/utils/__tests__/accountSettleAllocation.accountCredits.test.ts`, table-driven from the owner's Q1 table (page section 4). Rows are 23–25 Oct ($120, $95, $200) plus the 24 Oct receive −$40, with an account credit of $8.70. Cases as (credit set, paid → result):
  - ($8.70, $366.30 → all closed, credit 0 left)
  - ($5.00, $370.00 → all closed, credit 3.70 left)
  - ($0, $375.00 → all closed, credit untouched)
  - ($8.70, $300.00 → #430 part-paid, $66.30 left)
  - ($0, $380.00 → all closed, extra 5.00)
  - credit set larger than owed → refused by the caller rule (assert a typed error / flag)
  OMT-pays cases: day credits −$100, account credit $8.70, credit set $8.70, received $108.70 → all closed; credit set $4, received $104 → credit 4.70 left. Also assert: with `account_credits` absent the output equals today's output for the existing LIRA-322 fixture (regression net).
- [X] T011 Extend `allocateAccountSettlement` in `packages/core/src/utils/accountSettleAllocation.ts`:
  - **New optional inputs**: `account_credits: AccountSettleAllocRow[]` (negative remaining or positive account rows, oldest first) and `credit_used: number` (magnitude, this currency).
  - **Shop pays (D > 0)**: account rows net among themselves; then exactly `credit_used` of account credit covers the oldest debts (NETTING takes on both sides); then the money covers the rest oldest first; any rest is extra.
  - **OMT pays (D ≤ 0)**: the received money covers the day credits in `rows` first, then up to `credit_used` of account credits oldest first; any rest is extra.
  - **Unchanged**: at most one part-paid row per currency; account credits never produce `extra`.
  Update the contract doc `specs/322-omt-amount-first-settle/contracts/allocator.md` with a "LIRA-343 extension" section. T010 must pass, and the existing allocator tests must stay green (run by path).

### Schema keys (contracts/settle-account-days.md)

- [X] T012 Rule 23 three-way key diff for `suppliers:settle-account` before editing: compare (a) `supplierSettleAccountBaseSchema`, (b) the preload binding `data` type (`electron-app/preload.ts` ~:809), and (c) the fields `_settleAccountAmountFirst` reads. Record the diff in this task's note.
  Then add to `packages/core/src/validators/supplier.ts`:
  - `include_account_credits: z.boolean().optional()`
  - `credit_used: z.object({ usd: z.number().min(0).optional(), lbp: z.number().min(0).optional() }).optional()`, which requires `include_account_credits`
  Both are refused on the legacy (non-`per_currency`) path in `refineSettleAccount`. Add schema tests in `packages/core/src/validators/__tests__/` with field names taken from `supplierSettleAccountSchema.shape` (rule 24), failing-first.

**Checkpoint**: the pure math, the row source and the schema are ready. Stories can start.

---

## Phase 3: User Story 1 — See which days are settled (P1) 🎯 MVP

**Goal**: Settle Account opens on a month calendar showing each day's state and amounts left per currency, plus the month total under it (read-only).

**Independent Test**: Seed transfers across October (settled, part-paid, $-paid/LBP-open, unpaid, an empty Wednesday, a Sunday with activity). Open the sheet; check each day's colour, ring %, "$"/"L" badges, amounts, and "$482.00 + 1,890,000 LBP left this month" (spec US1 scenarios 1–5).

- [X] T013 [P] [US1] Add `getAccountMonthRows(accountSupplierId, month)` to `packages/core/src/services/SupplierService.ts`. It turns `month` into a UTC window of month ± 1 day, calls `getAccountRows`, and keeps rows whose `shop_day` starts with `month`. No SQL in the service (rule 13). Add a unit test with a mocked repository in `packages/core/src/services/__tests__/`.
- [X] T014 [P] [US1] Add the IPC handler `suppliers:account-month-rows` in `electron-app/handlers/supplierHandlers.ts` (same gate as `suppliers:account-unsettled` ~:67, `validatePayload(accountMonthSchema)`, raw-shape reply as the existing read), and the preload binding `getAccountMonthRows` in `electron-app/preload.ts` (types from core). Add a handler test in the electron-handler suite.
- [X] T015 [P] [US1] Add `GET /api/suppliers/:id/account-month-rows?month=YYYY-MM` in `backend/src/api/suppliers.ts`: `requireAuth`, the same gate as `account-unsettled`, `validateRequest(accountMonthSchema)` on the query, returns `{ success: true, rows }`, and is placed before any `/:id`-only route. Add a backend route test.
- [X] T016 [US1] Add the adapter `getSupplierAccountMonthRows(accountSupplierId, month)` (`ipcOrHttp`) in `frontend/src/api/backendApi.ts`, `frontend/src/api/ElectronApiAdapter.ts` and `ApiAdapter` in `packages/ui/src/api/types.ts`, plus the `useSupplierAccountMonthRowsQuery` hook in `frontend/src/features/suppliers/hooks/useSuppliers.ts` (read `api` through a ref — rule 25).
- [X] T017 [US1] Write failing-first `frontend/src/shared/components/settleCalendar/__tests__/SettleCalendar.test.tsx` for a generic `SettleCalendar` fed by `buildSettleDays` output. It should render:
  - every day as a circle;
  - settled = filled green with ✓;
  - one-currency open = % ring (green paid / red owed);
  - two-currency = state ring (red unpaid / amber something paid) with "$" and "L" badges on the bottom corners (`OWED` red, `PART` amber, `PAID` green);
  - amounts under the circle, one line per currency, with LBP labelled ("$200", "990k LBP");
  - `NONE` and future days as faint numbers, not selectable;
  - all week rows the same height;
  - month arrows on the calendar's own corners;
  - legend under the calendar (Settled · Partly paid · Unpaid · $ L);
  - the month line "<$> + <LBP> left this month" under the legend.
  Use a stable `useApi` mock reference (rule 25).
- [X] T018 [US1] Implement `frontend/src/shared/components/settleCalendar/SettleCalendar.tsx` (+ small `DayCircle.tsx`, `SettleLegend.tsx`). It is generic (no supplier imports) and matches the mock's look (dark sheet, 42px circles, fixed 54px columns on wide screens, compact rows). T017 must pass.
- [X] T019 [US1] Wire the calendar into `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`, read-only for this story: load the month rows (T016), compute days with `buildSettleDays`, month switching, and today from `localDay()` in the browser. Keep the existing payment box. Add i18n keys (`accountSettle.calendar.*`) for every new label in `packages/ui/src/i18n/locales/en/suppliers.json` and `packages/ui/src/i18n/locales/ar/suppliers.json` (where the existing `accountSettle` keys live).

**Checkpoint**: the calendar shows the truth for any month. US1 can be demonstrated on its own.

---

## Phase 4: User Story 2 — Pick days and settle them (P1)

**Goal**: The default selection is every open day before today. Tapping days toggles them. The OMT credit is an amount the user sets. The payment is pre-filled. Only picked days settle.

**Independent Test**: Open days 30 Sep and 21–25 Oct, today 26 Oct. Open the sheet → those days are picked, today is not, and the payment = owed − credit. Settle 23–25 Oct paying $250 + 990,000 LBP → coverage NETTING $40 + PAYMENT $80 / $95 / $75, 25 Oct has $125 left, LBP is closed, and nothing on unpicked days is touched (spec US2 scenarios 1–7).

- [X] T020 [P] [US2] Write failing-first `packages/core/src/utils/__tests__/settleDaySelections.test.ts` for `buildDaySelections(openRows, { pickedDays, untickedRows, coveredTypes, creditUsed })`. It returns `{ selections, expected_owed, account_credit, prefill }`:
  - `selections` = DAY rows of picked days − unticked − waiting rows;
  - ACCOUNT rows are never in `selections`;
  - `expected_owed` = Σ remaining(selections) + Σ ACCOUNT rows, signed, per currency;
  - `account_credit` = Σ ACCOUNT rows per currency;
  - `prefill` = owed − `creditUsed`;
  - the default `creditUsed` = min(owed, credit) per currency.
- [X] T021 [P] [US2] Implement `packages/core/src/utils/settleDaySelections.ts` (pure, browser-safe, exported from `browser.ts` / `index.ts`). It is the ONE payload builder for normal settling and old history (rule 22). T020 must pass.
- [X] T022 [US2] Write failing-first `packages/core/src/repositories/__tests__/SupplierRepository.lira343SettleDays.test.ts`:
  - **(a)** Pick 23–25 Oct, pay $250 + 990,000 LBP, `include_account_credits: true`, `credit_used` 0 → the exact coverage rows above; rows on 21 / 22 Oct are untouched.
  - **(b)** The same with an $8.70 account credit, `credit_used` 8.70, pay $366.30 → all closed and the credit is consumed.
  - **(c)** `credit_used` greater than the credit, or greater than owed → refused with a plain message.
  - **(d)** The stale check includes account rows.
  - **(e)** Create + undo nets to 0 per ledger per currency (drawers, OMT account balance, profit) (FR-020).
  - **(f)** `metadata_json` records `include_account_credits` and `credit_used`.
  - **(g)** a transfer recorded after `selections` was built (not in the list) is neither settled nor refused, and stays open.
- [X] T023 [US2] In `packages/core/src/repositories/SupplierRepository.ts` (`_amountFirstScope` ~:6619, `_settleAccountAmountFirst` ~:6066, `_planAmountFirstSection` ~:6681):
  - when `include_account_credits` is set, add every open ACCOUNT row to the scope as a separate `account_credits` list, after the `selections` checks;
  - include them in the stale sum;
  - validate `credit_used` per currency (0 ≤ x ≤ min(owed, credit) when the shop pays; ≤ credit when OMT pays);
  - pass `account_credits` and `credit_used` to the allocator;
  - account-credit coverage uses source `NETTING`, so the existing reversal applies.
  Read both new keys here, in the same change (rule 23 reverse). T022 must pass, and the LIRA-322 settle tests stay green (run by path).
- [X] T024 [US2] Write failing-first `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira343Calendar.test.tsx`:
  - the default selection = open days before today across months, today not picked;
  - tapping toggles a day;
  - the selection bar shows count, first → last day, total per currency, and Clear;
  - "Use OMT credit [x] of [total]" is pre-filled with min(owed, credit);
  - typing 0 makes the payment the full amount;
  - typing a payment does not change the credit;
  - the submitted payload equals `buildDaySelections` output plus `per_currency`, with field names from the schema (rule 24);
  - before confirming, the sheet shows per currency what stays open, which transfer will be part-paid (with the amount left), or the extra that becomes credit (FR-015);
  - SC-001: with the default selection, settling takes exactly two taps (open the sheet, Confirm) and no typing;
  - no raw `window.api` call (rule 19).
- [X] T025 [US2] Build `frontend/src/shared/components/settleCalendar/SettleSelectionBar.tsx` (generic: count, range, totals, Clear / Pick all open) and the selection behaviour in `SettleCalendar` (neutral band behind consecutive picked days, white ✓ badge, "+" on hover). Wire them into `AccountSettleSheet.tsx`:
  - pick state, plus the "Use OMT credit" amount per currency;
  - the payment pre-fill from `buildDaySelections`;
  - the per-currency preview (FR-015) from the shared allocator: what closes, the part-paid transfer and amount left, or the extra;
  - submit through `settleSupplierAccount` with `selections`, `include_account_credits: true`, `credit_used` and `expected_owed`.
  Remove the old top-level `<PickTransfers>` toggle (it moves into day details, T033). T024 must pass.
- [X] T026 [US2] Update the existing e2e specs that drive the old sheet to the calendar flow, matching rows by identity and asserting deltas (rule 15): `frontend/tests/e2e-web/lira-web-065-omt-amount-first-settle.spec.ts`, `frontend/tests/e2e-web/lira-web-035-omt-account-settlement.spec.ts`, `frontend/tests/e2e-web/lira-web-053-omt-statement-commission-types.spec.ts`. Also edit the desktop specs `frontend/tests/e2e-electron/lira-189-omt-account-settlement.spec.ts` and `frontend/tests/e2e-electron/lira-158-deferred-settlement-commission.spec.ts`, but do NOT run them on this Mac; note "not run (no Electron)".
- [X] T027 [US2] New web e2e `frontend/tests/e2e-web/lira-web-081-omt-settle-by-day.spec.ts`:
  1. seed OMT transfers on two days plus a receive;
  2. open Settle Account and assert the day colours;
  3. unpick one day and settle;
  4. assert the picked days' transfers are closed and the unpicked one is open (by identity), and that the drawer delta equals the amount paid;
  5. save a landscape screenshot `frontend/public/whats-new/<next version>/omt-settle-calendar.png` (rule 30).
  Ask the owner before running.

**Checkpoint**: MVP = US1 + US2. A shop can see its days and settle the picked ones.

---

## Phase 5: User Story 3 — Leave an older day open on purpose (P2)

**Goal**: Skipping an older open day is visible: an amber "!" badge, "N left out" in the bar, and a link to an older month.

**Independent Test**: Unpick 21 Oct while 22–25 Oct are picked → 21 Oct shows "!", the bar says "1 left out", and settling leaves 21 Oct open. With 30 Sep unpicked, viewing October shows "1 unselected day in September ›", which disappears when 30 Sep is picked (spec US3).

- [X] T028 [P] [US3] Write failing-first cases in `frontend/src/shared/components/settleCalendar/__tests__/SettleCalendar.test.tsx` for:
  - the "!" badge on open days older than the newest picked day that are not picked;
  - "N left out" in `SettleSelectionBar`;
  - the older-month link "N unselected day(s) in <Month> ›" (from `openDaysBefore`, only unpicked days, only for earlier months), placed under the calendar above the selection bar, and hidden once those days are picked.
- [X] T029 [US3] Implement the "!" badge, the left-out count and the older-month link (tap → switch month) in `frontend/src/shared/components/settleCalendar/`. T028 must pass.

---

## Phase 6: User Story 4 — See what is behind a day (P2)

**Goal**: Tapping a day shows its transfers (OMT / OMT App / iPick tag, amount, paid, left), the settlement(s) that paid them, and lets the user untick single transfers of a picked day.

**Independent Test**: Tap 21 Oct → "#404 Cash-out · OMT App · $50 paid by #10057 · $47 left". Untick one transfer of a picked day → the day shows "partly picked" and the totals / payload drop that transfer (spec US4, FR-016a).

- [X] T030 [P] [US4] Write failing-first `getAccountDayDetail` cases in `packages/core/src/repositories/__tests__/SupplierRepository.lira343DayDetail.test.ts`:
  - the day's range rows;
  - per row, active coverage grouped by settlement (`transaction_id`, settled date, currency, amount, source);
  - reversed coverage excluded;
  - the "added after settlement" flag (research R7): an open FS row whose unified `transactions.id` > the `transaction_id` of an active coverage row on another row of the same `shop_day` → `true`.
- [X] T031 [US4] Implement `SupplierRepository.getAccountDayDetail(accountId, shopDay)` (window = that shop day ± 1 UTC day, filtered by `shop_day`) and `SupplierService.getAccountDayDetail` in `packages/core/src/`. T030 must pass.
- [X] T032 [P] [US4] Add the transports for the day detail: IPC `suppliers:account-day-detail` (`electron-app/handlers/supplierHandlers.ts`, `validatePayload(accountDaySchema)`), preload binding (`electron-app/preload.ts`), REST `GET /api/suppliers/:id/account-day-detail?day=YYYY-MM-DD` (`backend/src/api/suppliers.ts`), adapter `getSupplierAccountDayDetail` (`frontend/src/api/backendApi.ts`, `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`), hook in `useSuppliers.ts`. Add handler + route tests.
- [X] T033 [US4] Write failing-first, then build the generic `frontend/src/shared/components/settleCalendar/SettleDayDetails.tsx` and wire it into `AccountSettleSheet.tsx`:
  - it lists the rows with the member tag, a paid bar, the settlements, and the tags "added after settlement" and "waiting for its statement type" (research R9);
  - checkboxes untick and re-tick open rows of a picked day (`untickedRows`);
  - a partly picked day shows a distinct mark;
  - totals and the payload follow via `buildDaySelections`.
  Tests: `__tests__/SettleDayDetails.test.tsx` and a case in `AccountSettleSheet.lira343Calendar.test.tsx`.

- [X] T033a [US4] Write failing-first tests, then add an optional shop-day range `{ from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }` to the supplier Transactions history read (`FinancialService.getAllByProvider` / `FinancialServiceRepository.getAllByProvider` ~:6306 and the account-ledger read `getAccountLedger` ~:2780 for account parents): filter with `localDayExpr(created_at) BETWEEN ? AND ?` (rule 27), applied BEFORE the row limit; extend the IPC handler, preload, REST route (`backend/src/api/suppliers.ts`), shared schema in `validators/supplier.ts` and adapter (`backendApi.ts`, `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`) in one change (rules 19, 21, 23). Repository + route tests.
- [X] T033b [US4] Add the from–to date filter UI (two date fields + presets Today, Yesterday, This month, and Clear) to the Transactions window in `frontend/src/features/suppliers/pages/Suppliers/index.tsx` (the `openTable === "transactions"` modal), and the "See in Transactions ›" link in `SettleDayDetails` that opens that window filtered to the day (both dates = that day). Frontend tests first (`frontend/src/features/suppliers/pages/Suppliers/__tests__/`), stable `useApi` mock (rule 25). i18n keys EN + AR in `packages/ui/src/i18n/locales/{en,ar}/suppliers.json`.

---

## Phase 7: User Story 5 — Undo any settlement (P2)

**Goal**: Any settlement can be undone, in any order, with no exception. Later settlements never change. Whatever they relied on becomes an account row; the undo day gets a ↺ badge with hover text (owner Q2 = option 3, FR-018, FR-016b).

**Independent Test**: #A leaves an $8.70 credit; #B uses it; undo #A → #A's days reopen, #B and 23–25 Oct stay settled, the account shows "you owe OMT $8.70", and 26 Oct shows ↺ with hover "Owed to OMT added: $8.70 (undo of #A)". Balance = Σ open remaining (spec US5).

- [X] T034 [US5] Write failing-first `packages/core/src/repositories/__tests__/TransactionRepository.lira343UndoAny.test.ts`:
  - **(a)** the #A/#B credit chain above: today refused by `_assertSettlementIsNewestOnItsRows`, after the change allowed with the balancing ACCOUNT row of +$8.70 linked by `transaction_id` = the undo transaction;
  - **(b)** #A part-paid a transfer that #B finished: undo #A → #B unchanged, and a balancing ACCOUNT row for #A's applied amount;
  - **(c)** for both, per currency: OMT account balance = Σ open remaining (DAY + ACCOUNT rows) and every drawer delta equals #A's money reversed;
  - **(d)** the existing LIRA-322 refusal tests for OMT accounts are rewritten to the new behaviour. Keep the refusal for non-OMT-account suppliers if it applies there; note which.
- [X] T035 [US5] Implement research R12 (undo) in `packages/core/src/repositories/TransactionRepository.ts` (`_assertSettlementIsNewestOnItsRows` ~:7778, `_reverseSupplierSettlement`) and `SupplierRepository.ts`:
  - for OMT-account settlements, stop refusing;
  - reverse the undone settlement's money and its own coverage, but keep the coverage rows later settlements rely on;
  - write a PAIR per member and currency (built 2026-10-26: an open ACCOUNT row of +r and a hidden self-stamped carry row of −r, so balance and queue stay equal) for the amount later settlements used (opposite sign, note "Undo of #A: already used by #B"), owned by the undo transaction (rule 20);
  - no `is_auto` hiding unless rule 26 applies (it is an operator-caused row: decide and note).
  T034 must pass.
- [X] T036 [US5] Extend the seeded property test `packages/core/src/repositories/__tests__/SupplierRepository.lira322Invariant.test.ts` (or a new `lira343Invariant`) with random sequences of settle (days + `credit_used`), undo (any order) and void. After every step, per currency: balance = Σ open remaining, and no coverage exceeds a row's amount. Seen failing on the unchanged code for at least one sequence.
- [X] T037 [US5] Add the ↺ badge (top-left, indigo) to `DayCircle.tsx`, from `account_marks` (`settleDays.ts`: ACCOUNT rows written by an undo / void, grouped by the shop day of that undo / void transaction). Hover / tap shows per currency "Owed to OMT added: $8.70 (undo of #A)" or "OMT credit added: $35.00 (void of #440)". It never changes `state`, and disappears once the account row is no longer open. In the selection bar, the "OMT credit" line names its origin with a link to that day. Write the tests first in `SettleCalendar.test.tsx` and `settleDays.test.ts`.

---

## Phase 8: User Story 6 — Correct the calendar after the fact (P3)

**Goal**: A back-dated transfer reopens its day (tagged). Voiding a paid transfer is allowed and becomes OMT credit on the account (FR-017, FR-019).

**Independent Test**: Settle 18 Oct, then record a $35 transfer dated 18 Oct → 18 Oct is PARTIAL and the transfer is tagged "added after settlement". Void transfer #440 ($35) paid by #10061 → the void goes through, #10061 is unchanged, 18 Oct is unchanged, the account shows $35 OMT credit, and 18 Oct (the void day) shows ↺ (spec US6).

- [X] T038 [US6] Write failing-first `packages/core/src/repositories/__tests__/TransactionRepository.lira343VoidCovered.test.ts`:
  - void and refund of a fully covered and of a part-covered OMT transfer: today refused by `_assertNoActiveSettlementCoverage`; after the change allowed;
  - the settlement's coverage on that row becomes one ACCOUNT credit row of the applied amount, owned by the void transaction;
  - the settlement is unchanged;
  - balance = Σ open remaining per currency;
  - void + no further step nets correctly on every ledger.
  Rewrite the LIRA-322 refusal tests for OMT accounts to the new behaviour.
- [X] T039 [US6] Implement research R12 (void) in `packages/core/src/repositories/TransactionRepository.ts` (`_assertNoActiveSettlementCoverage` ~:7819 and the void / refund paths ~:6196, ~:6649), keeping the refusal for non-OMT-account suppliers if it still applies (note it). T038 must pass. The back-dated tag needs no extra work beyond T030 / T031; add one sheet test that a back-dated transfer makes its settled day PARTIAL and shows the tag.

---

## Phase 9: User Story 7 — Settle old history up to a date (P3)

**Goal**: A one-time action uses the account credits (whatever their date) to pay old open transfers on or before a date, with no money moved (FR-021, FR-021a).

**Independent Test**: A $300 Pay / Receive credit dated 2 Oct and $300 of transfers on 28–30 Sep → "Settle old history up to 30 Sep" closes all three, no drawer moves, and the balance is unchanged. With only $280 of credit, 30 Sep stays PARTIAL with $20 left. Undo restores everything (spec US7).

- [X] T040 [US7] Write failing-first `packages/core/src/repositories/__tests__/SupplierRepository.lira343OldHistory.test.ts` covering the cases above through the real `settleAccount`:
  - `selections` = DAY rows with `shop_day` ≤ D;
  - `include_account_credits: true`, `credit_used` = min(owed, credit);
  - every section with `payments: []`;
  - assert no drawer delta, balance unchanged, and create + undo = 0.
  Expected: passes on the T023 code with no new repository code (research R6). If it fails, fix in `_settleAccountAmountFirst` and note why.
- [X] T041 [US7] Add the "Settle old history up to…" action to `AccountSettleSheet.tsx`: an admin-only date picker. It builds the payload with `buildDaySelections` (picked = all open days ≤ D, credit = min(owed, credit), money 0) and shows a preview of what closes before confirming. Write a frontend test first.

---

## Phase 10: Polish & delivery

- [X] T042 [P] Update `docs/FEATURE_GUIDE.md` §8.2 "Amount-first account settlement": add settle by day, day vs account rows, the credit the user sets, undo / void with no exception (balancing account rows) and old history.
- [X] T043 [P] Release notes (rule 30): add bullets under `## 🏦 Suppliers / OMT` in `docs/release-notes/UNRELEASED.md` in shop-owner words. Add a `### Settle OMT by day` card under `## ✨ Highlights` with the T027 screenshot. Add the "What users will notice" line to LIRA-343 in `current_sprint.md`. Run `node scripts/build-release-notes.cjs --check`.
- [ ] T044 (after deploy) Speed check (research R11): on the test shop, time the October `account-month-rows` read and record rows / ms here. If it is over 300 ms, batch further before release.
- [X] T045 Run every constitution quality gate: `yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`, `yarn build`, and the core, backend, electron-handler and frontend test suites. Ask the owner before each suite run: affected files by path first; full suites only with the owner's explicit OK (RAM); otherwise rely on CI and say so. Then the web e2e (T026, T027). Record test counts and elapsed times (rule 28).
- [X] T046 [P] Add a follow-up ticket "Remove OMT credit (booked as an expense, undoable)" to `current_sprint.md`, plus the rollout tickets (other suppliers → partners → client debts) referencing the generic `settleDays` / `SettleCalendar`.
- [X] T047 Republish the design page (https://claude.ai/artifact/VWkboFyYcNH7ZcFzSLxdf4) with "built" status and any deviation found during implementation.

---

## Dependencies & order

- **Phase 1 → Phase 2 → stories.** Phase 2 blocks everything: T005 ← T004; T007 ← T006, T005; T009 ← T008; T011 ← T010; T012 stands alone.
- **US1** (T013–T019) needs T007 and T009.
- **US2** (T020–T027) needs US1's calendar (T018 / T019), T011 and T012.
- **US3** needs US2's selection (T025).
- **US4** needs T007 and US2 (untick changes the payload).
- **US5** needs T023 (settlements with account credits) and T009 (`account_marks`).
- **US6** needs US5's balancing-row writer (T035) and T031 (tag).
- **US7** needs T023 and T021.
- **Polish**: after the stories it describes.

## Parallel examples

- **Phase 2**: T004/T005 (classification) ∥ T008/T009 (settleDays) ∥ T010/T011 (allocator) ∥ T012 (schema). T006/T007 run after T005.
- **US1**: T013 ∥ T014 ∥ T015 (service, IPC, REST: different files), then T016, then T017/T018 ∥ T019 prep.
- **US2**: T020/T021 ∥ T022 (core) while T024 is drafted.
- **US4**: T030 ∥ T032 (transports), then T031, then T033.

## Implementation strategy

1. **MVP = Phases 1–4 (US1 + US2).** The calendar plus settling picked days with the user-set credit. Ship-ready on its own, with the old refusals still in place.
2. **Then US3 + US4** (visibility, untick) as a second increment.
3. **Then US5 + US6** together. They change the LIRA-322 undo / void rules and share the balancing-row writer and the property test; ship them only with T036 green.
4. **Then US7** (one-time old history).
5. **Polish** last, but write the release-note lines with each increment that users can see.
