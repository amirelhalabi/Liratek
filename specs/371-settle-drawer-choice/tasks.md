# Tasks: Choose the cash drawer when settling OMT system items (LIRA-371)

**Input**: `specs/371-settle-drawer-choice/` (plan.md, research.md, data-model.md, contracts/cash-drawer-choice.md, quickstart.md)

**Tests**: Required. Money flow, CLAUDE.md rules 17, 20 and 28d. Guard tests come first, and each must be **seen failing for a real assertion reason** (not a TS compile error, rule 28a). Record the failure line in the task note.

- Never revert finished code to prove a test (rule 17).
- Run only the explicit paths listed, with the per-workspace commands in `quickstart.md`. Never full suites (owner rule; recorded exception in plan.md Complexity Tracking; CI runs the full suites on push).
- Web e2e only (`frontend/tests/e2e-web/`). Never desktop/Electron e2e on this Mac.
- Core changes need build + sync: `cd packages/core && npm run build && cd ../.. && cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

**Organization**: by user story (spec US1 Debts, US2 Suppliers, US3 Void / refund).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Check the working tree has no unrelated edits in the files listed in plan.md "Source Code". LIRA-373 is committed (`414ce0da`) and is the baseline. Check whether LIRA-372 has landed changes to `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`, `packages/core/src/validators/supplier.ts`, `docs/release-notes/UNRELEASED.md` or `current_sprint.md`; if so, re-read the plan's line references against them before editing. Confirm `frontend/tests/e2e-web/lira-web-092-*` is still free (last existing: 091; LIRA-372 takes 093).

---
  - **Done note:** Tree clean for plan files at start (only whats-new PNGs + specs dirs untracked). LIRA-372 had not yet touched the shared files. lira-web-092 free (last: 091).

## Phase 2: Foundational (types and contracts only, no behaviour change)

**Purpose**: Make every later test compile, so its first failure is a real assertion failure.

- [X] T002 Create the pure leaf `packages/core/src/constants/cashDrawerChoice.ts`. It imports nothing (rule 29). Contents:
  - `CASH_DRAWER_CHOICES = ["SYSTEM","GENERAL"] as const`
  - `type CashDrawerChoice`
  - `cashDrawerChoiceNotApplicable(baseSystem)`, the refusal sentence from contracts/cash-drawer-choice.md
  - `systemCashDrawerChoiceApplies({ provider, baseSystem, legs, isGeneralCash })`, **stubbed to `throw new Error("not implemented")`**

  Export it from `packages/core/src/browser.ts` and `packages/core/src/index.ts`.
- [X] T003 [P] Write `packages/core/src/constants/__tests__/cashDrawerChoice.test.ts`. Cover:
  - OMT shop + provider OMT + one CASH leg → true
  - provider WHISH on an OMT shop → false
  - provider OMT on a Whish shop → false
  - Katsh / `null` provider → false
  - only non-cash legs (WHISH_APP) → false
  - a CASH change (OUT) leg alone → true
  - the refusal text names "OMT" or "Whish" from `baseSystem`

  Run it and record the failure ("not implemented").
  - **Done note:** Failing-first: 6 failed / 1 passed, `Error: not implemented`.
- [X] T004 Implement `systemCashDrawerChoiceApplies` in `packages/core/src/constants/cashDrawerChoice.ts` (`provider === baseSystem && legs.some(l => isGeneralCash(l.method))`), then re-run T003 green.
  - **Done note:** 7 passed.
- [X] T005 [P] Write `packages/core/src/validators/__tests__/lira371.cashDrawer.schema.test.ts`. Cover:
  - `addRepaymentSchema` keeps `cashDrawer: "GENERAL"`
  - `supplierSettleSchema`, `supplierSettleAccountSchema` (legacy and `per_currency` shapes) and `supplierCashflowSchema` keep `cash_drawer`
  - `"OMT_System"` / `"general"` are refused
  - an absent key stays `undefined` after parse (no `.default()`, rule 22)
  - `supplierSettleAccountSchema.shape` includes `cash_drawer`
  - `partnerSettleSchema` does NOT have the key (FR-006)

  Run it and record the failures (key stripped).
  - **Done note:** Failing-first: 5 failed / 2 passed (`Expected: "GENERAL" Received: undefined` — key stripped; `refuses other values` Expected false Received true).
- [X] T006 Add `cashDrawerChoiceSchema = z.enum(CASH_DRAWER_CHOICES)` to `packages/core/src/validators/common.ts`, then add the keys:
  - `cashDrawer: cashDrawerChoiceSchema.optional()` to `addRepaymentSchema` in `packages/core/src/validators/debt.ts`
  - `cash_drawer: cashDrawerChoiceSchema.optional()` to `supplierSettleSchema`, `supplierSettleAccountBaseSchema` and `supplierCashflowSchema` in `packages/core/src/validators/supplier.ts`

  Both settle-account shapes accept it, so it is NOT added to `LEGACY_ONLY_…` / `AMOUNT_FIRST_ONLY_…`. Re-run T005 green.
  - **Done note:** 7 passed.
- [X] T007 Add optional type fields with no logic yet:
  - `CreateRepaymentData.cash_drawer?` in `packages/core/src/repositories/DebtRepository.ts:294`
  - `RepaymentData.cashDrawer?` in `packages/core/src/services/DebtService.ts:37` and `electron-app/handlers/debtHandlers.ts:30`
  - `SettleTransactionsData` (`SupplierRepository.ts:510`), `SettleAccountData` (`:1126`) and `SupplierCashflowData` (`:705`) `.cash_drawer?`
  - `ServiceCashDrawerContext.cashDrawer?` in `packages/core/src/utils/payments.ts:171`
- [X] T008 Extend the hand-written payload types (rule 12): `addRepayment` (`electron-app/preload.ts:433`), `settleTransactions` (`electron-app/preload.ts:811`), and `frontend/src/types/electron.d.ts:1427` (and its `settleTransactions` twin). Then do the rule 23 three-way key diff (schema / preload type / handler-forwarded) for `debt:add-repayment`, `suppliers:settle-transactions`, `suppliers:settle-account` and `suppliers:record-cashflow`, and note the result in this task. Expected gap: only `DebtService.addRepayment`'s rebuild (`DebtService.ts:307`), closed in T013.
  - **Done note:** Rule 23 diff: debt:add-repayment — schema has cashDrawer, preload+handler type has it, handler spreads v.data, REST spreads req.body; DebtService rebuild dropped it (closed in T013). suppliers:settle-transactions / settle-account / record-cashflow — schema has cash_drawer, preload types updated (settleAccount/recordCashflow are schema-derived), handlers spread v.data, routes spread, SupplierService passes data whole to the repository. No other gap.
- [X] T009 Build + sync core. Run `yarn typecheck` and confirm it takes real time (rule 28a).
  - **Done note:** core build+sync done; `yarn typecheck` exit 0 in 61.5s (real run).

**Checkpoint**: contracts exist, behaviour byte-identical.

---

## Phase 3: User Story 1 — Debt repayment: cash put in General (P1) 🎯 MVP

**Goal**: The Repay screen offers OMT Cash Drawer | General when the default would route cash to the system drawer. General keeps all the cash in General and changes nothing else.

**Independent test**: A client owes $200 for one OMT send. Pay $200 cash with General. Result: General +$200, OMT_System ±0, debt $0.

### Tests (write first, record failures)

- [X] T010 [US1] Write `packages/core/src/repositories/__tests__/DebtRepository.lira371DrawerChoice.test.ts`, using the `testHelpers/debtItemDb` helpers like `DebtRepository.lira304Routing.test.ts`. Cases:
  - (a) **baseline** (expected to pass, not a guard): no field and `SYSTEM` give identical payments rows and drawer deltas.
  - (b) $200 OMT send, $200 cash, `GENERAL` → General +200, OMT_System 0, debt 0, no `RESERVE` rows.
  - (c) $200 send + $50 sale, $250 cash: default gives OMT_System +200 / General +50; `GENERAL` gives General +250 / OMT 0. Coverage rows and `debt_ledger` identical between the two runs, and profit identical.
  - (d) `GENERAL` on a client with only a sale + recharge → refused with `cashDrawerChoiceNotApplicable("OMT")`, and nothing written (no ledger row, no payments, drawers unchanged). The same payment with `SYSTEM` is accepted and posts exactly as with no field (FR-007 as reconciled).
  - (e) `GENERAL` with a WHISH_APP-only payment → refused.
  - (f) Whish-main shop: Whish system send + `GENERAL` → General, Whish_System 0.
  - (g) cash change (OUT leg) on a `GENERAL` overpay leaves General (same as default).
  - (h) the coverage record has `routed.cash_drawer === "GENERAL"` and empty `by_transfer`; (i) FR-010 — the repayment's `payments` rows carry `drawer_name = 'General'` for the cash leg, and the transaction details' payment legs (TransactionRepository leg read) list General with no OMT move.
  - (j) split payment, $200 send paid $100 CASH + $100 WHISH_APP with `GENERAL` → the cash $100 in General, the WHISH_APP leg in its own drawer exactly as with the default, OMT_System 0 (edge case "choice only affects cash lines").

  Run it and record the real assertion failures for (b) (c) (d) (e) (f) (h) (i) (j).
  - **Done note:** Failing-first: 8 failed / 1 passed (baseline a passes). e.g. (b) `Expected "General|USD": 200 / Received "OMT_System|USD": 200`; (d)(e) `Received function did not throw`; (h) `Expected: "GENERAL" Received: undefined`.
- [X] T011 [P] [US1] Write `packages/core/src/services/__tests__/DebtService.lira371.test.ts` (mocked repo): `addRepayment({ …, cashDrawer: "GENERAL" })` hands `cash_drawer: "GENERAL"` to the repository. Absent stays absent. Record the failure (key dropped by the rebuild at `DebtService.ts:307`).
  - **Done note:** Failing-first: 1 failed / 1 passed — `Expected: ObjectContaining {"cash_drawer": "GENERAL"}`, Received object without the key (dropped by the rebuild).
- [X] T012 [P] [US1] Write the transport tests:
  - `backend/src/api/__tests__/debts.lira371.api.test.ts`: `POST /api/debts/repayments` with `cashDrawer: "GENERAL"` reaches `DebtService.addRepayment` with that key, and `cashDrawer: "OMT"` is refused with `success: false`.
  - `electron-app/handlers/__tests__/debtHandlers.lira371.test.ts`: same over `debt:add-repayment`.

  These may pass at once, because the handler and route spread the validated data. If so, label them "parity check, not proven failing-first".
  - **Done note:** Parity check, not proven failing-first: both pass at once (2/2 REST, 2/2 IPC) because route and handler spread the validated body.

### Implementation

- [X] T013 [US1] Add `repaymentRoutesToSystemDrawer(result) = result.routedUsd > 0 || result.routedLbp > 0` to `packages/core/src/utils/debtRepaymentAllocation.ts` (pure, browser-safe). It is the ONE "choice applies" test that T014 and T018 both call (rule 14). Forward `cashDrawer` → `cash_drawer` in `DebtService.addRepayment` (`packages/core/src/services/DebtService.ts:232` destructure and `:307` rebuild). Re-run T011 green.
  - **Done note:** T011 green 2/2.
- [X] T014 [US1] In `DebtRepository.addRepayment` (`packages/core/src/repositories/DebtRepository.ts`):
  - After `allocateRepayment` (`:1121`), if `data.cash_drawer === "GENERAL"` and `!repaymentRoutesToSystemDrawer(allocation)`, throw `DatabaseError(cashDrawerChoiceNotApplicable(baseSystem))` before any write.
  - If `GENERAL`, skip the RESERVE loop (`:1153-1192`).
  - Write `routed: { provider, drawer, by_transfer: [], legs: [], cash_drawer: "GENERAL" }` at `:1238`.

  No other line changes. Check that the throw sits inside the db transaction, so nothing is written: the ledger row is inserted earlier (`:990+`), and the throw must roll it back.
  - **Done note:** Throw sits inside `this.transaction` after allocateRepayment; (d)/(e) assert ledger/payments/transactions counts and drawers unchanged.
- [X] T015 [US1] Build + sync core. Re-run T010–T012 and record pass counts.
  - **Done note:** core build+sync; T010 9/9, T011 2/2, T012 2/2 + 2/2.

### UI

- [X] T016 [US1] Create the shared control `frontend/src/shared/components/CashDrawerChoice.tsx` and export it from `frontend/src/shared/components/index.ts`:
  - props `{ value, onChange, systemDrawer: "OMT_System"|"Whish_System", direction: "IN"|"OUT" }`
  - two pills reusing the classes of the existing Split pill, `packages/ui/src/components/ui/SplitToggle.tsx` (reuse, not a restyled copy)
  - `data-testid` `cash-drawer-choice`, `cash-drawer-choice-system`, `cash-drawer-choice-general`

  Add keys `cashDrawerChoice.{goesTo,comesFrom,omt,whish,general}` to `packages/ui/src/i18n/locales/en/payment.json` and `packages/ui/src/i18n/locales/ar/payment.json`. Order (rule 28a, a missing module is a resolve error, not a failure):
  1. Stub the component (renders `null`).
  2. Write `frontend/src/shared/components/__tests__/CashDrawerChoice.test.tsx` (labels per system; "Goes to" on IN / "Comes from" on OUT; a click calls onChange) and record the assertion failure.
  3. Implement.

  Also extract the Debts preview's `isCash` (`frontend/src/features/debts/pages/Debts/index.tsx:1053`) to `frontend/src/shared/utils/isGeneralCash.ts` as `isGeneralCash(code, methods)`, **keeping its exact rule**: `GIFT_CARD` and `CUSTOMER_ACCOUNT` → false; a method with a `drawer_name` → `affects_drawer === 1 && drawer_name === "General"`; a method without one → `code === "CASH"`. Order: stub `isGeneralCash` (`throw new Error("not implemented")`), write `frontend/src/shared/utils/__tests__/isGeneralCash.test.ts` covering the four branches (GIFT_CARD → false, CUSTOMER_ACCOUNT → false, method with `drawer_name: "General"` and `affects_drawer: 1` → true / `affects_drawer: 0` → false, no `drawer_name` + `CASH` → true / other code → false), record the failure, implement. Then the Debts preview calls it in place of the local function (pure refactor of the page, no behaviour change). Re-run `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira304Picker.test.tsx`, `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira308TicksAmount.test.tsx` (both assert `repay-goes-to` with routed OMT cash) and `frontend/src/features/debts/pages/Debts/__tests__/repayment.payloadLanguage.test.tsx` green with real counts. Not [P]: it edits `Debts/index.tsx`, which T018 edits next. T018 and T025 both use this one helper (rule 14).
  - **Done note:** Failing-first: component stub 3/3 failed `Unable to find an element by: [data-testid="cash-drawer-choice"]`; isGeneralCash stub 3/3 failed `not implemented`. Then 6/6 green. Pill classes: exported `splitPillClassName` from SplitToggle.tsx (SplitToggle uses it too), imported by subpath. Neighbours: lira304Picker + lira308TicksAmount PASS; repayment.payloadLanguage 11/12 — the failing case is `ZodError: The discount is more than $5` from the LIRA-372 agent's in-progress counterparty discount change, not this refactor.
- [X] T017 [US1] Write `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira371DrawerChoice.test.tsx`, with a stable `useApi` mock reference (rule 25). Cover:
  - the choice shows with OMT selected when the open items include an OMT transfer and a CASH line is paid
  - it is hidden for sale + recharge only, and for WHISH_APP-only payment
  - picking General makes "Goes to" show only General with the full cash
  - the submitted payload, parsed through `addRepaymentSchema` (rule 24), has `cashDrawer: "GENERAL"`; with the default it has `cashDrawer: "SYSTEM"`; with no choice shown it has no key

  Record the failures.
  - **Done note:** Failing-first: 4 failed / 3 passed (the 3 'hidden / no key' cases pass on unchanged code by nature). e.g. `expect(received).toBeTruthy() Received: null` (choice not in Goes to); `Unable to find an element by: [data-testid="cash-drawer-choice-general"]`.
- [X] T018 [US1] Implement in `frontend/src/features/debts/pages/Debts/index.tsx`:
  - state `repayCashDrawer` (reset to `"SYSTEM"` whenever the modal opens)
  - in `repayPreview` (`:1045`, cash test via `isGeneralCash` from T016), compute `choiceApplies = repaymentRoutesToSystemDrawer(result)` from the default allocation; for `GENERAL`, show all cash under General and no system line; change rows stay as today (Debts change always leaves General, owner 2026-11-05)
  - do not return `null` while `choiceApplies` (`:1093`)
  - render `<CashDrawerChoice>` inside `repay-goes-to` (`:3273`)
  - add `cashDrawer` to the single payload at `:1327` only when `choiceApplies` (rule 22)

  Re-run T017 green.
  - **Done note:** T017 7/7; lira304Picker + lira308TicksAmount still green (25/25 across the three files).

**Checkpoint**: US1 done on both transports (server-side verified by T010–T012).

---

## Phase 4: User Story 2 — OMT account settlement: cash from General (P1)

**Goal**: The main-system supplier's settle screens offer the choice when a cash line is paid. General moves every cash line (and change) in or out of General with identical balances.

**Independent test**: The OMT account owes $772.30. Settle Account, cash $772.30, General. Result: General −$772.30, OMT_System ±0, OMT balance $0, days settled.

### Tests (write first, record failures)

- [X] T019 [US2] Write `packages/core/src/repositories/__tests__/SupplierRepository.lira371DrawerChoice.test.ts`, with fixtures like `SupplierRepository.lira322AmountFirst.test.ts` / `lira343SettleDays.test.ts`. Cases:
  - (a) **baseline**: default and `SYSTEM` identical.
  - (b) amount-first Settle Account, OMT owes $772.30, cash PAY with `GENERAL` → General −772.30, OMT_System 0. Supplier balance, settled rows/days and commission are identical to a default twin run.
  - (c) two currencies: COLLECT +$7,492.70, PAY −60,000,000 LBP with `GENERAL` → both lines in General.
  - (d) change leg (OUT) with `GENERAL` → into General.
  - (e) legacy whole-row `settleAccount` with `GENERAL`.
  - (f) `recordSupplierCashflow` PAY and RECEIVE for the main-system supplier with `GENERAL`.
  - (g) Whish-main shop: `settleTransactions` bills-only `OTHER_PAYMENT` cash commission leg with `GENERAL` → General (`_bookBillsCommissionViaPaymentLegs`).
  - (h) refused, nothing written: `GENERAL` on Katsh, on a product supplier, on OMT in a Whish-main shop, and with non-cash legs only. `SYSTEM` on the same requests is accepted and posts as with no field.
  - (j) split payment: $772.30 paid as $400 CASH + $372.30 `WHISH_APP` with `GENERAL` → only the cash leg moves to General; the other leg posts exactly as with the default.
  - (i) FinancialService OMT SEND cash still lands in OMT_System (the resolver default is untouched).

  Record the real failures.
  - **Done note:** Failing-first: 12 failed / 1 passed (baseline a). e.g. (b) `- "General|USD": -772.3 / + "OMT_System|USD": -772.3`; (f) `+ "Whish_System|USD": -60`; (h) `Received function did not throw`; (i) `Expected: "General" Received: "OMT_System"`. Fixture note: the shop's base system is read through SettingsService/SettingsRepository singletons, reset per DB; a Whish-main fixture marks the Whish supplier active. One more case added after T022's first pass: legacy refusal — failed first with `Received message: "Failed to settle account"` (refusal text wrapped by the legacy try/catch), fixed by an early check. 14/14.
- [X] T020 [P] [US2] Write the transport parity tests:
  - `backend/src/api/__tests__/suppliers.lira371.api.test.ts`: the `cash_drawer` key reaches the service on `/settle`, `/settle-account` and `/cashflow`, and a bad value is refused with HTTP 200 + `success: false`.
  - `electron-app/handlers/__tests__/supplierHandlers.lira371.test.ts`: the same three channels.

  Label them as parity checks if they pass at once.
  - **Done note:** Parity check, not proven failing-first: 6/6 REST (bad value → HTTP 200 + success:false) and 6/6 IPC pass at once.

### Implementation

- [X] T021 [US2] In `resolveServiceCashDrawer` (`packages/core/src/utils/payments.ts:205`), return `paymentMethodToDrawerName(method)` when `ctx.cashDrawer === "GENERAL"`, and update its doc comment. Nothing else in the function changes.
- [X] T022 [US2] In `packages/core/src/repositories/SupplierRepository.ts`:
  - add `cashDrawer: data.cash_drawer` to the four `drawerCtx` builders (`:4580`, `:6588`, `:7134`, `:8853`)
  - before any write in each entry point, if `cash_drawer === "GENERAL"` and `!systemCashDrawerChoiceApplies({ provider: ctx.provider, baseSystem, legs: payments, isGeneralCash: m => resolveServiceCashDrawer(m, { ...ctx, cashDrawer: undefined }) === primaryCashDrawerName(baseSystem) })`, throw `DatabaseError(cashDrawerChoiceNotApplicable(baseSystem))`
  - the amount-first path takes the legs from `per_currency.*.payments`
  - put the check in ONE private helper used by all four (rule 14)
  - **Done note:** One private helper `_withCashDrawerChoice` used by all four builders. settleTransactions and recordSupplierCashflow build the context before their try/catch (that catch wraps every message as 'Failed to …', which would have hidden the refusal text); legacy settleAccount does an early refusal before its try, then re-resolves in the transaction on the fresh parent.
- [X] T023 [US2] Build + sync core. Re-run T019–T020 and record pass counts.
  - **Done note:** core build+sync; 157/157 across the two lira371 suites + seven neighbours (lira322AmountFirst, lira343SettleDays, lira370Sms, settlement, accountSettlement, lira304Routing, lira304Reversal); T020 6/6 + 6/6; suppliers.api.test 58/58 still.

### UI

- [X] T024 [US2] Write `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira371DrawerChoice.test.tsx`. Cover:
  - with `systemCashDrawer="OMT_System"` and a pre-filled CASH line, the control shows with OMT selected, and says "Comes from" on PAY / "Goes to" on COLLECT
  - picking General gives a payload that, parsed through `supplierSettleAccountSchema` (rule 24), has `cash_drawer: "GENERAL"`
  - with `systemCashDrawer={null}` (Katsh / product supplier) or a non-cash-only payment, there is no control and no key

  Record the failures.
  - **Done note:** Failing-first: 5 failed / 1 passed (the null-prop 'no control' case passes on unchanged code by nature): `Unable to find an element by: [data-testid="cash-drawer-choice"]`.
- [X] T025 [US2] Implement in `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`:
  - prop `systemCashDrawer?: "OMT_System" | "Whish_System" | null` on `AccountSettleSheetProps` (`:249`)
  - state reset per open
  - `applies = systemCashDrawer && systemCashDrawerChoiceApplies(...)` over every box's IN + OUT lines, with the cash test `isGeneralCash` from `frontend/src/shared/utils/isGeneralCash.ts` (extracted in T016, same rule as the Debts preview, rule 14)
  - render `<CashDrawerChoice>` under the payment boxes, next to the paid-total line
  - add `cash_drawer` in `buildSettlePayload` (`:867`) only when `applies`

  Re-run T024 green.
  - **Done note:** T024 6/6; neighbours lira322Currency + lira343Calendar + lira343OldHistory 34/34. The payload key is decided from the legs inside buildSettlePayload, so the old-history settle (no money) never carries it.
- [X] T026 [US2] Write `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira371DrawerChoice.test.tsx` **before T027**, with a stable `useApi` mock reference (rule 25). Cover:
  - on an OMT shop the OMT account sheet gets `systemCashDrawer="OMT_System"`, and Katsh gets `null`
  - on a Whish-main shop the batch Settle confirm for Whish bills with `OTHER_PAYMENT` cash shows the control, and its payload parsed through `supplierSettleSchema` has `cash_drawer: "GENERAL"` after picking General
  - on a Whish-main shop with Whish inactive (Pay / Receive tab shown), Pay with a CASH line shows the control, and its payload parsed through `supplierCashflowSchema` has `cash_drawer: "GENERAL"` after picking General
  - on an OMT shop, OMT shows no batch Settle / Pay / Receive tab (unchanged, owner 2026-11-05)
  - Partners pages are untouched (no import of `CashDrawerChoice` under `frontend/src/features/partners`)

  Record the failures.
  - **Done note:** Failing-first: 2 failed / 3 passed (the 3 'unchanged / absent' cases pass on unchanged code by nature); the Whish case was seen failing on an earlier draft that typed the commission through a loose textbox match, then rewritten to type into `supplier-settle-commission-lbp`: OMT sheet `Unable to find an element by: [data-testid="cash-drawer-choice"]`; Whish batch `Unable to find an element by: [data-testid="cash-drawer-choice-general"]`. The Pay / Receive case was NOT written: see T027 note.
- [X] T027 [US2] In `frontend/src/features/suppliers/pages/Suppliers/index.tsx`:
  - add `provider` to the `settlingAccount` state shape (`:1028`). `AccountBalance` has no top-level provider: take `children.find(c => c.is_parent)?.provider` for the OMT account, or the supplier list row by `account_supplier_id` for a single settle-by-day supplier (Whish, Katsh, products). Set it where `onSettle` fills the state
  - pass `systemCashDrawer = provider === baseSystem ? primaryCashDrawerName(baseSystem) : null` to `<AccountSettleSheet>` (`:4282`). `useShopBase()` at `:937` today destructures only `partnerSystem`; add `baseSystem` (the hook returns it, `frontend/src/hooks/useShopBase.ts:61`). `primaryCashDrawerName` comes from `@liratek/core`; confirm it is still reachable from `packages/core/src/browser.ts` (`:130`, `export * from "./constants/systemFloatDrawers.js"`, an import-free leaf, rule 29)
  - add the same control and payload key to the batch Settle confirm (`CounterpartySettleModal` children at `:3909`, payload in `handleBatchSettle` `:2127`) and to Pay / Receive (`:3099`, payload in `handleCashflow` `:1560`), gated by the same predicate

  Re-run T026 green.
  - **Done note:** Sheet prop + batch Settle confirm done; 5/5, neighbours (cashflowRate, settleNetPayCurrency, lira345SettleByDay, accountSettlement, commissionAtSettlement) 20/20. **Pay / Receive control not added (deviation):** the page renders Pay / Receive only when `selectedSupplier.is_active !== 0 && !isSettleByDay`, and `settlesByDay` is true for an active WHISH supplier, so the main-system supplier never reaches Pay / Receive on either shop (research R2's 'Whish inactive → Pay / Receive yes' row disagrees with the `is_active !== 0` gate). The server accepts `cash_drawer` on `/cashflow` (T019 f, T020) for any future screen.

**Checkpoint**: US1 + US2 done on both transports.

---

## Phase 5: User Story 3 — Void or refund puts the cash back in the chosen drawer (P1)

**Goal**: Reversal of a General payment nets every drawer and ledger to 0 per currency (rule 20). The reversal owner is the existing `_reversePayments` stored-drawer mirror (`TransactionRepository.ts:9749` with LIRA-373 applied). No new code is expected.

- [X] T028 [US3] In `packages/core/src/repositories/__tests__/DebtRepository.lira371DrawerChoice.test.ts`, add:
  - a `GENERAL` repayment (case b and case c) + void → every drawer Δ = 0 per currency, debt back to $200 / $250, coverage restored
  - an exact refund (no override) gives the same result
  - a refund with a CASH override of a `GENERAL` repayment lands in General

  These test existing code, so they are expected to pass first. State "protection test, not a fix guard" in the task note. If any fails, it is a real defect: fix it with that test as the failing-first guard.
  - **Done note:** Protection test, not a fix guard: void (b)(c), exact refund, CASH-override refund (lands in General, all drawers Δ 0) — passed first run, no defect.
- [X] T029 [US3] In `packages/core/src/repositories/__tests__/SupplierRepository.lira371DrawerChoice.test.ts`, add:
  - a `GENERAL` Settle Account (b, c) + void → General, OMT_System and the supplier ledger Δ = 0 per currency, days back to open
  - an exact refund gives the same result

  This relies on LIRA-373 (committed `414ce0da`): `SETTLEMENT_TRANSACTION_TYPES` = SUPPLIER_SETTLEMENT + PARTNER_SETTLEMENT refuse `refundLegs` (`TransactionRepository.ts:6771-6773`). Add one case: an override refund of a `GENERAL` Settle Account is refused. Pay / Receive rows (SUPPLIER_PAYMENT) keep the override, and a CASH override resolves to General.
  - **Done note:** Protection test, not a fix guard: void (b)(c), exact refund, override refund of a GENERAL Settle Account refused with LIRA-373's message and nothing changed, Pay/Receive (Whish shop) GENERAL + CASH-override refund nets General to 0 — 19/19 in the file, passed first run.
- [X] T030 [US3] In `packages/core/src/repositories/__tests__/DebtRepository.lira371DrawerChoice.test.ts`, pin the owner-confirmed "OMT drawer first" rule (spec Clarifications, edge case): $200 send, $100 `GENERAL` then $100 default → OMT_System +100, General +100, debt 0. Protection test (existing behaviour). Same file as T028, so not [P].
  - **Done note:** Protection test (existing behaviour): passed first run. DebtRepository lira371 file 14/14.

**Checkpoint**: all three stories done.

---

## Phase 6: Polish & cross-cutting

- [X] T031 Write the web e2e `frontend/tests/e2e-web/lira-web-092-settle-drawer-choice.spec.ts` (rule 15: identity + deltas, never row position). Cover:
  - (1) Debts: the client owes $200 OMT send; Repay $200 cash, General → General +200, OMT_System 0 (drawer snapshot deltas); void → back.
  - (2) OMT Settle Account $772.30 cash with General → General −772.30, OMT_System 0.

  Also open the repayment's transaction details and assert the cash line reads General (FR-010). Save a landscape screenshot of the Repay modal with the choice open to `frontend/public/whats-new/1.35.0/settle-drawer-choice.png`. Run with `npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-092-settle-drawer-choice.spec.ts --reporter=list`, and confirm "2 passed" (rule 28a).
  - **Done note:** "2 passed" (each test ~2s of real UI + REST steps). Settle Account case uses a $765 + $7.30 send on the spec's own past day and asserts General −(the paid line as shown) since the SMS box nets the expected commission; OMT_System Δ 0. Screenshot saved; while checking it, the picked pill was hard to tell apart from the other in this theme, so the picked option now carries a tick (same Split-pill classes).
- [X] T032 [P] Release notes (rule 30) in `docs/release-notes/UNRELEASED.md`:
  - a `### Choose the cash drawer when settling OMT` card in `## ✨ Highlights` with the T031 screenshot
  - bullets under the Debts and Suppliers / OMT headings, in plain words: "When a customer pays for an OMT send, or you settle OMT, you can now choose whether the cash goes into the OMT Cash Drawer or General. OMT Cash Drawer stays the default."

  Add "What users will notice:" to LIRA-371 in `current_sprint.md`. LIRA-373's entries are committed; LIRA-372 may have added its own lines meanwhile: merge with them, never overwrite. Run `node scripts/build-release-notes.cjs --check`.
  - **Done note:** Highlights card at the top of ## ✨ Highlights + bullets under 💸 OMT / Whish & suppliers and 📒 Accounts (the Debts page's heading); sprint entry appended with 'What users will notice'. `build-release-notes --check` OK.
- [X] T033 [P] Add a short note to `docs/FEATURE_GUIDE.md` §7 (Drawers): `ServiceCashDrawerContext.cashDrawer` can send a main-system cash leg to General (LIRA-371), and only settle/repay paths set it.
  - **Done note:** Row added to §7's table after the LIRA-304 'Debt repayment → PCD' row.
- [X] T034 Run the gates:
  - `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`
  - `packages/core/src/__tests__/browserEntryIsNodeFree.guard.test.ts`
  - `yarn check:schema-equivalence` and `yarn build`, the latter proving the new `browser.ts` export bundles (rule 29 fails first at build)
  - every explicit test path in `quickstart.md`
  - the existing neighbours (explicit paths):
    - core: `packages/core/src/repositories/__tests__/DebtRepository.lira304Routing.test.ts`, `…/DebtRepository.lira304Reversal.test.ts`, `…/SupplierRepository.lira322AmountFirst.test.ts`, `…/SupplierRepository.lira343SettleDays.test.ts`, `…/SupplierRepository.lira370Sms.test.ts`, `…/SupplierRepository.settlement.test.ts`, `…/SupplierRepository.accountSettlement.test.ts`, `…/TransactionRepository.lira322AmountFirstVoid.test.ts`, `…/TransactionRepository.lira373SettlementRefund.test.ts`, `packages/core/src/constants/__tests__/drawerModules.secondaryCashDrawer.test.ts`
    - transports: `backend/src/api/__tests__/suppliers.api.test.ts` (its `.shape` key tests may list keys; update them to include `cash_drawer`), `backend/src/api/__tests__/debts.api.test.ts`, `electron-app/handlers/__tests__/debtHandlers.test.ts`, `electron-app/handlers/__tests__/supplierHandlers.lira322.test.ts`
    - frontend: `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira304Picker.test.tsx`, `…/repayment.payloadLanguage.test.tsx`, `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira322Currency.test.tsx`, `…/AccountSettleSheet.lira343Calendar.test.tsx`, `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.cashflowRate.test.tsx`, `…/Suppliers.settleNetPayCurrency.test.tsx`, `…/Suppliers.lira345SettleByDay.test.tsx`

  Confirm test counts and elapsed time.

  The constitution's gate list includes the full core, backend, electron-handler and frontend suites. The owner rule "affected tests only" (no full suites locally) wins; this is the recorded exception in plan.md Complexity Tracking, and CI runs the full suites on push.

---
  - **Done note:** yarn typecheck 61.5s: only errors are 2× TS6133 in the LIRA-372 agent's AccountSettleSheet.lira372.test.tsx; core 9.1s / ui 2.9s / backend 7.5s / electron-app 2.4s typecheck exit 0. eslint on touched files: 0 errors (66 warnings, all in pre-existing lines of Debts/index.tsx, Suppliers/index.tsx, electron.d.ts); backend + ui lint exit 0. tenant-scoping 0 violations (1.3s), bind-arity OK, schema-equivalence 106 tables zero diffs, transport-parity OK, check:i18n 0 findings, build-release-notes --check OK. vite build OK (6.6s). Tests (uncached): core 16 suites / 207 (7.8s, incl. browserEntryIsNodeFree guard), backend 79, electron 13, frontend 13 suites / 93 (9.0s); web e2e lira-web-092 2 passed. Root `yarn typecheck` itself exits 1 (LIRA-372 test file only); `vite build` run, not the full `yarn build`. A mistyped glob also ran the WHOLE frontend jest suite once (877 suites / 5,393 passed, 1 skipped, 0 failed, 291s, includes packages/ui): not intended (owner rule: affected tests only). lira-web-051 (real Goes to box) 3/3. Lint warnings checked against this ticket's lines: none on them.

## Dependencies & execution order

- Setup (T001) → Foundational (T002–T009) → US1 (T010–T018) and US2 (T019–T027) can run in parallel after T009. Shared pieces: `CashDrawerChoice.tsx` and `isGeneralCash.ts` (both T016, used by T025/T027, so US2 UI waits for T016); `debtRepaymentAllocation.ts` (US1 only); `utils/payments.ts` (US2 only).
- Inside US1: T016 → T018 (both edit `Debts/index.tsx`; T018 uses `isGeneralCash` and `CashDrawerChoice`).
- Inside US2 UI: T024 → T025, then T026 → T027 (test first each time).
- US3 (T028–T030) needs T014 and T022.
- Polish: T031 needs US1 + US2 UI. T032 needs T031's screenshot. T034 is last.

### Parallel examples

- After T009: T010 ∥ T011 ∥ T012 ∥ T019 ∥ T020 (different files).
- T016 ∥ T024 (component vs sheet test; T024 only reads the extracted helper once T016 lands).
- T031 → T032 (screenshot first); T033 ∥ T031.

## Implementation strategy

- MVP = US1 (Debts), the most frequent case and fully independent.
- Then US2, the sheet the owner uses for $772-size settlements.
- US3 is mostly proof (no new reversal code).
- Release notes and e2e last, so the screenshot shows the real screen.
