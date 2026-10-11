---
description: "Task list for LIRA-310 — Waive on every payment page"
---

# Tasks: Waive on every payment page (LIRA-310)

**Input**: `specs/310-waive-everywhere/` — plan.md, spec.md, research.md (R1–R7), data-model.md, contracts/payloads.md, quickstart.md

**Tests**: REQUIRED. CLAUDE.md rule 17: each guard test is written first, run, and seen failing against the unfixed code. Record the failing line under the task, then fix. Never prove a test by reverting finished code.

**Owner decisions in force (2026-10-11)**:
- Limit is $5 / 450,000 LBP, **up to and including**, in the total's own currency.
- Hide Waive when it would go over a discount ceiling.
- Payout kept-change cap is raised to the same value.
- The Loto and Custom Services discount fields are made to work.
- No Waive on OMT system / Whish system transfers.
- **Waive follows Remaining**: Waive renders only inside the Remaining row, so whenever Remaining is hidden, Waive is hidden (including auto-debt with a client attached).

**Environment rules**:
- Never run desktop Electron e2e on this Mac. Use core jest, frontend jest and web e2e.
- After each `packages/core` change: `cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.
- Use `yarn rebuild:node` before core jest and web e2e.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Confirm the baseline. Run `yarn workspace @liratek/core test -- keptChange` and `yarn workspace @liratek/frontend test -- MultiPaymentInput`, and record the pass counts here. Confirm the elapsed time shows the suites really ran (rule 28a).
  - Done 2026-10-11: core `keptChange` 22 suites / 337 tests (~10 s); frontend `MultiPaymentInput` 11 suites / 157 tests. Node ABI confirmed.
- [X] T002 Reserve the web e2e id `lira-web-057` and check no file with that prefix exists in `frontend/tests/e2e-web/`. If one does (other sessions are active), take the next free number and update quickstart.md §4.
  - Done: `lira-web-057` free at 2026-10-11.

---

## Phase 2: Foundational (blocks every story)

**Goal**: one cap constant, plus the Waive behaviour in the shared payment component.

### Tests first

- [X] T003 [P] Write `packages/core/src/validators/__tests__/shortfallMax.test.ts`:
  - `isWithinShortfallMax(5,"USD")` → true
  - `isWithinShortfallMax(5.01,"USD")` → false
  - `isWithinShortfallMax(450000,"LBP")` → true
  - `isWithinShortfallMax(450001,"LBP")` → false
  - `isWithinShortfallMax(1,"EUR")` → false
  - `PAYOUT_KEEP_CHANGE_MAX` deep-equals `SHORTFALL_MAX`
  
  Run it; expect red (missing export).
  - Red first: 10/10 failed (missing export). Green after T005.
- [X] T004 [P] Write `frontend/src/shared/components/__tests__/MultiPaymentInput.waive.test.tsx`, cases:
  - **(a) External path**:
    - $0.50 short → `waive-remaining` visible;
    - click → `onWaiveRemaining(0.5, [{currency:"USD",amount:0.5}])`;
    - the amount is rounded to cents.
  - **(b) Limit, USD total**: $5.00 short → visible; $5.01 short → hidden.
  - **(c) Limit, LBP total**: 450,000 short → visible; 450,001 short → hidden.
  - **(d) `waiveRemainingMax`**: `waiveRemainingMax={0.3}` with $0.50 short → hidden.
  - **(e) Payout**: `payer="payout"` → never visible.
  - **(f) Built-in path, shows and clears**: `showDiscount`, `onDiscountChange` and `maxDiscount={2}`, $0.50 short → visible; click → `onDiscountChange` last called with 0.5 and Remaining row gone.
  - **(g) Built-in path, over ceiling**: `maxDiscount={0.3}` → hidden.
  - **(h) Built-in path, discount not booked**: `showDiscount` without `onDiscountChange` → hidden.
  - **(i) Waive follows Remaining**: `autoDebtRemainder` with a client, where the auto account line hides Remaining → no `waive-remaining`.
  - **(j) Cross-currency**: LBP total, USD discount currency, click → Remaining row gone and no change block shown.
  
  Run it; record failures.
  - Red first: 8/11 failed for the expected reasons. The 3 "hidden" cases passed before the change, so they are guards only, not proven failing-first.

### Implementation

- [X] T005 In `packages/core/src/validators/exchange.ts`:
  - add `export const SHORTFALL_MAX = { USD: 5, LBP: 450_000 } as const;`
  - redefine `PAYOUT_KEEP_CHANGE_MAX = SHORTFALL_MAX` and update its doc comment ("up to and including");
  - add `export function isWithinShortfallMax(amount: number, currency: string): boolean` using `KEPT_CHANGE_ROUNDING_TOLERANCE`;
  - export all three from **both** `packages/core/src/index.ts` and `packages/core/src/browser.ts` (rule 21 note).
  
  Then: core build + sync. T003 goes green.
  - Done. Side effect: raising the shared value also raised the payout cap value now, ahead of US4. The "$4.50 kept" payout cases can no longer be shown failing first; the inclusive "$5.00 kept" server cases still can (the server uses strict `>=` until T021).
- [X] T006 In `packages/ui/src/components/ui/MultiPaymentInput.tsx`:
  - **Props**: change `onWaiveRemaining` to `(amount: number, remainingByCurrency: Money[]) => void`. Make `waiveRemainingThreshold` default to `SHORTFALL_MAX[totalAmountCurrency]` (no waive for other currencies), compared with `<=` in the total's own currency. Add `waiveRemainingMax?: number`.
  - **Payout gate**: add `!isPayout` to `showWaiveButton` (~:1269).
  - **Remaining row**: keep the button inside the Remaining row (~:2540) so it inherits that row's visibility.
  - **External click**: round the shortfall to the total currency (USD cents, LBP whole). Compute the per-currency remainder via `allocatePayments({totals: effectiveTotals, payments, rates, side}).remaining`, the same call as `prefillAmountFor` (~:635).
  - **Built-in path**:
    - Condition: `!onWaiveRemaining && discountVisible && discountLowersTotal && !!onDiscountChange`, and `maxDiscount === undefined || clampedDiscount + shortfall <= maxDiscount + matchTolerance`.
    - Click: `setDiscountRaw(String(roundUp(convertSafe(clampedDiscount + shortfall, totalAmountCurrency, discountCurrency))))`. LBP rounds up to whole; USD rounds up to cents, or 4 dp when `totalAmountCurrency === "LBP"`.
  - **Ceiling**: hide when `waiveRemainingMax !== undefined && shortfall > waiveRemainingMax + matchTolerance`.
  - Update the prop doc comments. T004 goes green.
  - Done. The payout keep in MPI also moved to `isWithinShortfallMax` (part of T047). The cap is compared with the rounding tolerance, not `matchTolerance` (450,001 LBP must hide).
- [X] T007 Update `frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx:504-573` to the new contract: the second callback argument, and the $40-short case still hidden. This is a deliberate behaviour change (old threshold $1 → $5); note it in the commit body.
  - Done, plus the MPI payout-cap pins (`payoutKeepChange` ×2, `autoKeepChange` (c)) moved to $5 / 450,000 with new inclusive cases. Those new cases were not proven failing-first, because they were written after the component change. 12 suites / 170 tests green.

**Checkpoint**: the shared component is ready, and every page can now opt in.

---

## Phase 3: User Story 1 — Waive on pages that already have a discount (P1) 🎯 MVP

**Goal**: Waive works on POS, Maintenance, the 6 recharge forms, Debts repayment, Partners settle and Suppliers Pay.

**Independent test**: on each page, leave a gap under the limit, tap Waive, and check the discount rises by exactly the gap and the saved profit drops by it.

### Tests first

- [X] T008 [P] [US1] Extend `frontend/src/features/sales/pages/POS/components/__tests__/` with a new `CheckoutModal.waiveClamp.test.tsx`. Cases:
  - `maxDiscount=10` with discount 8 and $3 short → `waive-remaining` hidden;
  - `maxDiscount=10` with discount 8 and $2 short → click sets discount to exactly 10.
  
  Red first.
  - Done 2026-10-11. Real MPI rendered. Red: `CheckoutModal.waiveClamp.test.tsx:86 expect(waive()).not.toBeInTheDocument()` — found `waive-remaining` ($3 gap, $2 room). The "$8 + $2 = $10" case passed before the fix too (8 + 2 never exceeds the cap): not proven failing-first. Green after T013.
- [X] T009 [P] [US1] `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira310Waive.test.tsx`: a repay modal with $1.50 left plus 30,000 LBP left (rate 90,000) → click Waive → `repayDiscountUsd` = "1.50" and `repayDiscountLbp` = "30000". The submitted `discount` carries `amount_usd: 1.5, amount_lbp: 30000`. Take field names from `addRepaymentSchema` (rule 24). Red first.
  - Done 2026-10-11. Real modal + MPI, rate 90,000. 4 cases: $1.50 + 30,000 LBP split; adds to a typed discount ($1 + $2 = "3.00"); LIRA-308 picker (typed 133.5 kept, target kept); no Waive on cash-out. Red: the first three failed at `findByTestId("waive-remaining")` (:195, :222, :236 — button never rendered). The cash-out guard passed before the fix (MPI already blocks payouts): not proven failing-first. Green after T014.
- [X] T010 [P] [US1] `frontend/src/features/partners/pages/Partners/__tests__/Partners.lira310Waive.test.tsx`: balance 100, paid 98 → Waive → discount "2", Confirm enabled, payload `discount` = 2. Red first.
  - Done 2026-10-11. Real page + MPI; payload parsed via `partnerSettleSchema`. 2 cases (paid 98 → discount 2; typed 1 + gap 1 = 2). Red: both failed at `findByTestId("waive-remaining")` (:103, :122). Green after T015.
- [X] T011 [P] [US1] `frontend/src/features/recharge/components/__tests__/PaymentSheet.waive.test.tsx`: PaymentSheet forwards `onWaiveRemaining`, `waiveRemainingThreshold` and `waiveRemainingMax` to MPI. The built-in waive shows with `showDiscount` + `maxDiscount` + `onDiscountChange`. Red first.
  - Done 2026-10-11. Real MPI. Red: `PaymentSheet.waive.test.tsx:58 expect(button).toBeInTheDocument()` — received null (onWaiveRemaining not forwarded). The threshold/max cases passed vacuously before the fix (no button at all); they only guard forwarding now that onWaiveRemaining reaches MPI. The two built-in cases were already green (PaymentSheet already forwarded showDiscount/maxDiscount/onDiscountChange) — expected, no change needed. Green after T012.

### Implementation

- [X] T012 [US1] `frontend/src/features/recharge/components/PaymentSheet.tsx`: add the three props to `PaymentSheetProps` (~:21-90) and spread them conditionally into MPI (~:277, like `maxDiscount`). The six recharge forms then get the built-in waive with no change; confirm each passes `maxDiscount` (research R3 table).
  - Done. Three props added (`onWaiveRemaining` typed with `Money` from `@liratek/ui`) and spread conditionally. Six forms confirmed passing `maxDiscount` + `onDiscountChange` + `showDiscount`: FinancialForm, OmtWhishAppTransferForm, KatshForm, CardGridPayView, TelecomForm, CryptoForm. Exchange keeps `showDiscount={false}`.
- [X] T013 [US1] `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx`:
  - change ~:1143 to `onWaiveRemaining={(amt) => setDiscount((d) => Math.min((d ?? 0) + amt, maxDiscount ?? Infinity))}`;
  - pass `waiveRemainingMax={maxDiscount != null ? Math.max(0, maxDiscount - (discount ?? 0)) : undefined}` (conditional spread, `exactOptionalPropertyTypes`).
  
  Maintenance inherits it.
  - Done. Clamp + `waiveRemainingMax` via conditional spread when `maxDiscount != null`. Maintenance suites (inherit) green.
- [X] T014 [US1] `frontend/src/features/debts/pages/Debts/index.tsx`: add `onWaiveRemaining: (_amt, byCcy) => { add USD part (2 dp) to repayDiscountUsd; add LBP part (Math.round) to repayDiscountLbp }` to the CounterpartySettleModal `multiPaymentInput` bag (~:2510). Repay mode only; cash-out is a payout. Check that LIRA-308 `fillKey` behaviour still refills to the ticked sum minus discount.
  - Done. Repay-mode bag only. USD part → `toFixed(2)` added to the typed USD box, LBP part → `Math.round` added to the LBP box. LIRA-308 suite (`Debts.lira308TicksAmount`) green; picker case in T009 keeps the typed amount and target. Note: with the picker, MPI `totals` is the WHOLE debt, so Waive only appears when the whole remaining debt (not just the ticked items) is ≤ $5 — this follows "Waive follows Remaining". Verified by a throwaway probe (not kept): $14 sale unticked + $20 Loto ticked, 18.5 typed → Remaining $15.50, Waive hidden. Owner question: a ticked item short $1.50 gets no Waive while other debt is open; and when the whole remainder is ≤ $5, the waive also forgives unticked items (`repayPlan` adds the discount to the reduction → auto targets).
- [X] T015 [US1] `frontend/src/features/partners/pages/Partners/index.tsx`: add `onWaiveRemaining: (amt) => setDiscountAmount(String(round(parsedDiscount + amt)))` to the MPI bag (~:635).
  - Done. `onWaiveRemaining` sets `parsedDiscount + amount` (USD/USDT 2 dp, LBP whole). discount + gap = room after settlement, so `capSettlementDiscount` never clips it.
- [X] T016 [US1] Suppliers Pay (`frontend/src/features/suppliers/pages/Suppliers/index.tsx` ~:2712): there is no code change, because the built-in waive applies. Add `payer="shop"` to the PAY MPI bag so the row reads "Remaining to pay" instead of "Remaining (Debt)". Check that `payer="shop"` does not change the change/kept behaviour there (FEATURE_GUIDE §4.1, shop payer adds kept to cost). If it does, leave `payer` alone and note why here.
  - Done: `payer: cashflowDirection === "PAY" ? "shop" : "customer"` on the Pay/Receive MPI bag. Checked: the Pay tab wires no `onKeptChange`/`onReturnChange`, so `payer="shop"` only changes labels ("Remaining to pay"); the §4.1 kept→cost rule never applies there. Built-in Waive unchanged (no code). No dedicated test (label-only); Suppliers suites 98/98 green.
- [X] T017 [US1] Run T008–T011 green. Run the `MultiPaymentInput*`, `Debts*`, `Partners*` and `CheckoutModal*` suites in full: no new failures.
  - Done 2026-10-11. `MultiPaymentInput|Debts|Partners|CheckoutModal|PaymentSheet`: 56 suites / 341 tests green (~7 s). Also `features/recharge|maintenance|sales`: 114 suites / 474 tests green. Frontend typecheck clean (~23 s); eslint on changed files: 0 errors, warning counts identical to HEAD; prettier clean.

**Checkpoint**: MVP. Waive works on the 11 discount pages, screen only.

---

## Phase 4: User Story 2 — Customer pays the shop, no discount today: Loto ticket + Session checkout (P1)

**Goal**: the server-verified reduction lowers profit only; the counterparty's owed amount is unchanged; void/refund nets to 0.

### Tests first (core)

- [X] T018 [P] [US2] In `packages/core/src/repositories/__tests__/keptChange.test.ts`, add a `customer reduction` describe block:
  - Done, in its own file `keptChange.customerReduction.test.ts` (another lane edits keptChange.test.ts at the same time). Added cases beyond (a)–(g): over-claim, at-cap $5.00, split-currency over the total cap, cross-currency in both directions, negative claim, refusal wording. Red first: 15/15 failed on the unchanged helper (e.g. (a) "The payment doesn't add up to the total."; no-claim case `reductionUsd` undefined). Green after T021. The two exact-shape `toEqual`s in keptChange.test.ts gained `reductionUsd/Lbp: 0` (deliberate result-shape change). Later addition: the match tolerance also allows the tender currencies' rounding (an LBP ticket paid in USD lands a fraction of an LBP off the 4-dp USD waive); its two cases (7,751 vs a 7,750 gap accepted; a cent off on USD-only still refused) were written after that change — not proven failing-first.
  - (a) claim 0.50, IN 16.00, expected 16.50 → returns `reductionUsd 0.5`;
  - (b) claim 0.40 on a 0.50 gap → throws "does not match";
  - (c) claim over `reductionCap` → throws;
  - (d) reduction with `claimedKept > 0` → throws;
  - (e) reduction with an OUT leg → throws;
  - (f) reduction with `isForPartner` → throws;
  - (g) reduction with no IN legs → throws.
  
  Red first.
- [X] T019 [P] [US2] `packages/core/src/repositories/__tests__/LotoTicketRepository.lira310Discount.test.ts`:
  - **Sale**: a 500,000 LBP ticket, commission 25,000, cash 480,000, `discount_lbp` 20,000 → `profit_lbp` = 5,000; `metadata_json.discount_lbp` = 20000; the LOTO supplier TOP_UP is unchanged at 475,000 (delta assertion).
  - **Void**: drawer, supplier ledger and profit each net to 0.
  - **Refund**: same, with a separate fixture.
  - **Refusals**: `discount_lbp` 30,000 (> commission) refused; discount with `deferPayment: true` refused; discount with `partnerMode: "FOR"` refused.
  - **Kept-change check now applies**: a kept-change claim above the real excess is refused. Loto never had this check; R4 side effect, owner-accepted.
  
  Red first.
  - Done. 12 cases (sale, Loto-page kept figure, void, refund, 5 refusals, schema keys, phantom kept, no-discount control); Profits asserted through `ProfitService.getSummary` on the real schema. Red first: 11/12 failed (e.g. sale: "The payment doesn't add up to the total."; deferred discount: "Received function did not throw"; phantom 4,000 LBP kept: did not throw); the no-discount control passed before and after (guard). Green after T022–T024.
  - Added after review: a typed discount WITH change (500,000 handed, 20,000 off, 20,000 back) and its mismatch twin. Red first: both failed ("The discount can't be combined with change given back."). Fixed by `reductionAllowsChange` (Loto passes it; the session Waive does not, so a short basket still refuses change). Deviation from R4's refusal list, which refused any OUT leg.
- [X] T020 [P] [US2] `packages/core/src/services/__tests__/SessionCheckout.lira310Waive.test.ts`:
  - **Booking**: basket net $20, cash $17, `waived_usd` 3 → a `WAIVED_SHORTFALL` row with `profit_usd` −3, amount 0, linked to the session with kind `waived_shortfall`, and `client_name` = session name.
  - **Basket void**: profit, drawers and debt_ledger net to 0 per currency.
  - **Basket refund**: same.
  - **Refusals**: `waived_usd` 5.01 refused; a waived claim ≠ the real gap refused; waived with kept refused.
  - **No regression**: a basket with no claim behaves exactly as today.
  
  Red first.

  - Done (real schema, real `SessionCheckoutService.checkout` with a $20 OMT SEND; Profits via `ProfitService.getSummary`). Red first: 5/8 failed (booking: row `undefined`; $5.01 / wrong-gap: "Expected: false, Received: true" — the underpaid basket was accepted; waived+kept: "The payment doesn't add up to the total."; schema: a negative `waived_usd` accepted by `.passthrough()`). **Not proven failing-first:** the void and refund cases passed before the change, vacuously (nothing was booked, so there was nothing to net); they now also assert the −$3 is in the books before the reversal. The no-claim case is a regression guard (passed before and after).
  - Added after review (rule 20, every reversal path): refunding ONE item of a waived basket handed back the full $20 the customer never paid while the −$3 sibling stayed. Red first: "Received function did not throw". Fixed in `TransactionRepository.refundSessionBasketItem`: refused before any write when the basket has an ACTIVE WAIVED_SHORTFALL member ("…refund the whole basket instead."). The preview (`getSessionItemRefundPreview`) is not gated — the refusal comes on confirm.
### Implementation (core)

- [X] T021 [US2] `packages/core/src/repositories/keptChange.ts`:
  - **Customer input** (~:127-135): add `claimedReduction?: {usd:number; lbp:number}` and `reductionCap?: {usd:number; lbp:number}`.
  - **Result type**: add `reductionUsd/reductionLbp` to `KeptChangeResult` (~:191-206), default 0 in every branch.
  - **Customer branch** (~:346-396), when the reduction is > 0:
    - refuse kept > 0, OUT legs, `isForPartner`, and empty IN legs, with plain-sentence errors;
    - reconcile against `expected − reduction` (pattern at ~:546-558);
    - exact-match claim vs `expected − (IN − OUT)` per currency within `KEPT_CHANGE_ROUNDING_TOLERANCE` (pattern at ~:616-625);
    - enforce `reductionCap` per currency.
  - **Payout branch** (~:525-532): change the cap test from `>= cap` to `> cap + tolerance` using `isWithinShortfallMax`.
  
  T018 goes green.
  - Customer branch done (this lane): `claimedReduction`, `reductionCap`, `reductionLabel`, `reductionCapText`; `reductionUsd/Lbp` on every result. Deviation from the text: the gap match and the cap are checked in USD-equivalent at the tender rate (per-currency `expected − (IN − OUT)` is meaningless for cross-currency tender), plus each currency under its own cap. The payout-branch `>= cap` edit belongs to the other lane.
  - Also: `reductionAllowsChange` (gap = expected − (IN − OUT)); the match tolerance adds a tender currency's rounding only when the claim is not in that currency (so a cent off on a USD-only payment is refused — the $0.49-on-$0.50 case, written with the change, not proven failing-first).
- [X] T022 [US2] `packages/core/src/validators/loto.ts` `lotoSellSchema`: add `discount_usd: z.number().min(0).optional()` and `discount_lbp: z.number().min(0).optional()`. Add a refine that refuses a discount together with `partnerMode: "FOR"`. Mirror the fields into `SellTicketData` (`packages/core/src/services/LotoService.ts:55-82`) and pass them through `sellTicket` (~:184).
  - Done: `discount_usd/discount_lbp` + partner-FOR refine in `lotoSellSchema`; `SellTicketData` + `sellTicket` pass-through.
- [X] T023 [US2] `packages/core/src/repositories/LotoTicketRepository.ts` `createTicket`:
  - **Defer guard**: refuse a discount when `deferPayment`.
  - **Check**: replace the raw `reconcileLegs` (~:282-293) with `resolveKeptChange({payer:"customer", expected, inLegs, outLegs, claimedKept, claimedReduction: discount, reductionCap: commission per currency at the tender rate, tenderExchangeRate, isForPartner})`.
  - **Profit** (~:356): `profit_usd = keptUsd − reductionUsd`, `profit_lbp = commission + keptLbp − reductionLbp`. Add `discount_usd/lbp` to `metadata_json`.
  - **Leave unchanged**: `amount_lbp` and the supplier TOP_UP (~:583-605).
  
  T019 goes green.
  - Done. `reconcileLegs` replaced by `resolveKeptChange` (customer). Discount refused when deferred, partner FOR, no legs, or in USD (deviation: Loto discount is LBP only — a USD discount would be indistinguishable from USD kept change, because `lotoKeptChangeUsd` IS the loto USD profit in `ProfitService.getSummary`). Cap = commission (LBP; USD-eq at the tender rate). Profit stamp lowered; `metadata_json.discount_lbp`. Face value and TOP_UP unchanged.
- [X] T024 [US2] `packages/core/src/repositories/ProfitRepository.ts` (~:1347-1357): make the `lotoKeptChangeLbp/Usd` fragments add back `json_extract(metadata_json,'$.discount_lbp')` / `$.discount_usd` (COALESCE 0), so a discount is not read as negative kept change. Define the fragment once (rule 14). Add a case to T019 asserting `getTotalKeptChange` is unchanged by a discount.
  - Done: `lotoDiscountLbp(txnAlias)` is the one fragment; `lotoKeptChangeLbp` adds it back. `lotoKeptChangeUsd` unchanged (no USD discount exists). The T019 case `getTotalKeptChange` = 0/0 with a discount was red (−20,000 LBP) before the fragment change.
- [X] T025 [US2] `packages/core/src/validators/session.ts` `sessionCheckoutSchema`: add `waived_usd/waived_lbp: z.number().min(0).optional()`. Thread them into `CheckoutRequest` (`SessionCheckoutService.ts:79-93`) and `RecordBasketPaymentInput` (SessionPaymentService).
  - Done: `waived_usd/waived_lbp` (`min(0)`) in `sessionCheckoutSchema`; `CheckoutRequest.waived_*`; `RecordBasketPaymentInput.waived`; result `waivedUsd/Lbp`. A waive claim without an exchange rate is refused, like kept change.
- [X] T026 [US2] `packages/core/src/services/SessionPaymentService.ts`: make `resolveBasketKeptChange` (~:223-250) run when kept **or** waived is claimed, passing `claimedReduction` with `reductionCap = SHORTFALL_MAX` per currency. Return the verified reduction.
  - Done: `resolveBasketKeptChange` takes `claimedWaived` (cap `SHORTFALL_MAX`, label "waived amount") and returns `waivedUsd/Lbp`; `recordBasketPayment` runs it when kept OR waived is claimed; the no-payment-lines path calls it too (refuses).
- [X] T027 [US2] Add the `WAIVED_SHORTFALL` transaction type. Every site must get it:
  - `packages/core/src/constants/transactionTypes.ts`:
    - the constant;
    - `NON_REVERSIBLE_TRANSACTION_TYPES` (~:449);
    - `SESSION_BASKET_BYPASSABLE` (~:617);
    - item-refund exclusion (~:738).
  - other constants:
    - `utils/sessionPayoutMember.ts:71`;
    - `constants/profitRowClass.ts:71`;
    - `constants/postingRules.ts` (`no-money`, beside KEPT_CHANGE ~:1270);
    - `profitModuleDetailSupport.ts:33`.
  - `ProfitRepository` KEPT_CHANGE branches (~:1975-1980, :2114, :2706, ~:8675-8710).
  - `frontend/src/features/audit/cashFlow.ts:60` → none.
  - transaction text (~`transactionText.ts:105`) → label "Waived".
  
  Grep `"KEPT_CHANGE"` across `packages/core/src` and `frontend/src`, and list every hit here with its decision. No hit may be left unclassified.
  - Done. Grep of `KEPT_CHANGE` (and the lowercase link kind `kept_change`) across `packages/core/src` + `frontend/src`, non-test, with the decision per hit:
    - `constants/transactionTypes.ts` constant → **added** `WAIVED_SHORTFALL`; `NON_REVERSIBLE_TRANSACTION_TYPES` → **added**; `SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES` → **added** (without it the basket void throws on the sibling); item-refund (~:738) → **no code change**: `SESSION_ITEM_REFUNDABLE_TYPES` is a whitelist that never contained KEPT_CHANGE; comment updated.
    - `constants/sessionPayoutMember.ts:71` → **added** (amount 0, never a payout).
    - `constants/postingRules.ts` `POSTING_RULE_EXCLUSIONS` → **added** `"no-money"` (exclusion map only; no rule entry).
    - `utils/cashFlow.ts:60` (core, not frontend) → **added** `null` (no cash badge). `utils/transactionText.ts:105` → **added** label `"Waived"`.
    - `repositories/ProfitRepository.ts` `keptChangeSource` (both the type branch and the REFUND-via-`reverses_id` branch) → **added** through one constant `SESSION_PROFIT_ONLY_SIBLING_TYPES_SQL`. This one fragment feeds every Profits view (overview, By Module "Kept Change" row, By Date, By Cashier, By Client, the Kept Change drill-down, day close), so the waive's −profit lands everywhere and its basket REFUND nets. `keptChangeCountEligible` (:2126) and `keptChangeRecognizedCount` (:2718) → **deliberately not**: a waive is not a kept-change event (it must not inflate the count / Avg Profit per Txn denominator). :8697-8710 → comment only (the WAIVED row stamps `client_name` like KEPT_CHANGE).
    - `services/ProfitService.ts` Kept Change module (:1502, :1696, :2627) → **no change** (money comes through `keptChangeSource`); drill-down builder → **added** detail label "Waived at basket checkout".
    - `constants/profitRowClass.ts:71`, `constants/profitModuleDetailSupport.ts:33` → **not added (deviation)**: both classify a By Module KEY; there is no separate WAIVED_SHORTFALL module row — the waive nets inside the existing "Kept Change" row. A separate "Waived" row would need its own query in every Profits view; flagged for the owner (the "Kept Change" row now reads kept − waived).
    - `services/SessionCheckoutService.ts:759-816` → **added** the WAIVED_SHORTFALL booking beside it (T028).
    - `repositories/TransactionRepository.ts:4097, :6162` → comments; the gate is set-driven (`SESSION_BASKET_BYPASSABLE…`), so **no code change**.
    - `REFUND_KEPT_CHANGE_*` hits (validators/transaction.ts, transactionRowDisplay.ts, TransactionRepository refund kept change, ProfitRepository refund-kept fragments, frontend SaleDetailModal / refundLegOverride / RefundMethodModal / useSessionItemRefund / TransactionsViewer) → **unrelated** (refund kept change, not the session sibling).
    - Comment-only hits (keptChange.ts, CustomServiceRepository.ts:332, MaintenanceRepository.ts:692, validators/session.ts:57, validators/profits.ts:72, TransactionCells.tsx:147 — its "moves nothing" rule is generic) → **no change**.
    - Frontend `features/audit/nonReversibleReasons.ts:40` → **added** a cashier reason; `features/audit/transactionPresentation.ts:259` → **added** (label from core, no cash direction). `SessionCheckoutModal.tsx:348` → T032.
    - Lowercase link kind `kept_change`: only `SessionCheckoutService.ts:809` (the writer) and two ProfitService strings → **added** the `waived_shortfall` writer; no reader keys on the kind.
    - Frontend typecheck clean after the type was added (no other exhaustive `Record<TransactionType,…>` missed).
- [X] T028 [US2] `packages/core/src/services/SessionCheckoutService.ts`: after the KEPT_CHANGE block (~:764-816), book the `WAIVED_SHORTFALL` row when the verified reduction is > 0:
  - same shape as KEPT_CHANGE: amount 0/0, `profit_usd/lbp = −reduction`, cashier rate stamp, `client_name`, `metadata_json.waived_usd/lbp`;
  - `repo.linkTransaction(sessionId, "waived_shortfall", id)`.
  
  T020 goes green.
  - Done: WAIVED_SHORTFALL row booked after the KEPT_CHANGE block from the VERIFIED amount (amount 0/0, profit −waived per currency, `cashierRateStamp`, `client_id`, `client_name`, `metadata_json.session_id/waived_usd/waived_lbp`) and `linkTransaction(sessionId, "waived_shortfall", …, −waived)`. T020 green 8/8.
- [X] T029 [US2] Offline fixtures:
  - `packages/core/src/offline/testHelpers/fixtures/loto.ts` (~:6-23): add a `discount_lbp` case.
  - `fixtures/sessions.ts` (~:59-66): add a `waived_usd` case.
  - `packages/core/src/offline/bindings/loto.ts:23-40`: confirm the `SellTicketData` cast now carries the fields.
  - Run the `offline` jest pattern green.
  - Done: `fixtures/loto.ts` gains a 480,000-paid / 20,000-discount ticket; `fixtures/sessions.ts` gains session 4007 + cart line 4003 and a $17-paid / $3-waived checkout (needs `exchangeRate`). `bindings/loto.ts` spreads the payload as `SellTicketData`, which now declares the fields. `offline` jest: 58 suites / 410 tests green (the guards fail any fixture that does not book).
- [X] T030 [US2] Transport plumbing (rules 12, 21, 23): run a three-way key diff for `loto:sell` and `session:checkout`, covering the schema, the `electron-app/preload.ts` binding type (:940, :1730) and the handler forward (`lotoHandlers.ts:37-60`, `sessionHandlers.ts:230-260`), and record it here. Adapter types (`backendApi.ts:6714, :5534`; `packages/ui/src/api/types.ts:994, :2162`) derive from the schema, so confirm they pick up the new keys with no edit. The REST routes (`backend/src/api/loto.ts:256`, `sessions.ts:203`) use the same schema.

  - Done (read, not run on desktop). `loto:sell`: schema `lotoSellSchema` has `discount_usd/lbp`; preload binds `LotoSellPayload = z.input<typeof lotoSellSchema>` (derived, picks them up); handler spreads `v.data` into `sellTicket` (forwards every key); REST `/api/loto/sell` parses the same core schema and spreads it. `session:checkout`: schema has `waived_usd/lbp`; preload `SessionCheckoutPayload` derived; handler and REST spread the parsed data into `CheckoutRequest`. Adapters (`backendApi.ts` `LotoSellPayload` / `SessionCheckoutPayload`, `packages/ui` `ApiAdapter`) are schema-derived — no edit. No key is dropped on either transport. Runtime note: electron-app and backend read `node_modules/@liratek/core/dist`, which this lane did not rebuild (core build + sync still owed before any desktop/web run).
### Implementation (frontend)

- [X] T031 [US2] `frontend/src/features/loto/pages/Loto/index.tsx` (~:662-698):
  - **Discount wiring**: give MPI `onDiscountChange={setDiscount}` and `maxDiscount={commission}` (in the ticket currency). The built-in discount and Waive then work.
  - **Payload**: send `discount_lbp` (or `discount_usd`) in `ticketData` (~:283-353), built once (rule 22).
  - **Session cart**: do not send a discount in session-cart mode (~:360); hide the discount there (`showDiscount={!activeSession}`).
  - **Reset**: reset after submit.
  - **Test**: `frontend/src/features/loto/pages/Loto/__tests__/Loto.lira310Discount.test.tsx`, red first.
  - Done. MPI gets `showDiscount={!activeSession}`, `onDiscountChange={setDiscount}`, `maxDiscount` = sale × commission rate (LBP); the payload (built once) carries `discount_lbp` = whole LBP only when > 0, not partner, not session-cart; reset on both submit paths. Test `Loto.lira310Discount.test.tsx` (5 cases): red first 3/5 (`onDiscountChange` undefined; `discount_lbp` undefined; session `showDiscount` undefined). "No key when none" and "forgets after a sale" passed before and after (guards, not proven failing-first).
- [X] T032 [US2] `frontend/src/features/sessions/components/SessionCheckoutModal.tsx`:
  - **State**: add `waived` state `{usd, lbp}`.
  - **MPI** (~:1249): `onWaiveRemaining={(_a, byCcy) => setWaived(fromByCcy(byCcy))}`.
  - **Validation**: `isPaymentValid` (~:832) subtracts the waived amount.
  - **Payload**: send `waived_usd/lbp` only when > 0 (~:909-928), next to the kept fields. Clear the waived state when payment lines change in a way that makes it stale (a new gap differs from the waived amount).
  - **Test**: `frontend/src/features/sessions/components/__tests__/SessionCheckoutModal.lira310Waive.test.tsx`, red first.

  - Done. `waived {usd,lbp}` state set from MPI's `remainingByCurrency` (USD to cents, LBP whole); the waived amount comes off the per-currency totals passed to MPI (so Remaining and Waive go away); `isPaymentValid` counts it; `waived_usd` / `waived_lbp` each sent only when > 0 and a charge is due; a stale waive (new gap ≠ waived) is dropped by an effect; cleared on open and when nothing is left to collect. Test `SessionCheckoutModal.lira310Waive.test.tsx` (5 cases): red first 3/5 (`onWaiveRemaining` undefined; totals not reduced; no checkout call). The stale-waive and no-waive cases passed before and after (guards, not proven failing-first). Full frontend jest: 537 suites / 3,269 tests green.
**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Settlements with a supplier or LOTO (P2)

**Goal**: settle with a gap → a bundled discount → the balance closes to 0. Undoing a supplier settlement removes the discount.

### Tests first (core)

- [X] T033 [P] [US3] `packages/core/src/repositories/__tests__/SupplierRepository.lira310BatchSettle.test.ts`:
  - **Settle**: owes $503, legs $500, `discount {amount_usd:3}` → SETTLEMENT ledger −500, DISCOUNT ledger −3 with `source_ref_id` = settlement row and `settlement_id` stamped; supplier balance delta = −503; COUNTERPARTY_DISCOUNT profit +3.
  - **Void and refund** of the SUPPLIER_SETTLEMENT → balance, drawer and profit net to 0.
  - **Refusals**: discount 5.01; bills-only batch; OTHER_PAYMENT mode.
  
  Red first.
  - Red first (2026-10-11): 6/8 failed — settle: `DatabaseError: The payment doesn't add up to the total. (Settlement payment legs do not reconcile to the net amount owed — expected $503.00 + 0 LBP, got $500.00 + 0 LBP)`; >$5: same leg error instead of /more than/; bills-only: `Failed to settle transactions` instead of /bills/; Other-payment: `Received function did not throw`. The leg-mismatch and no-waive cases passed (guards, not proven failing-first).
  - Rule-20 intermediate red (after T039, before T038): void and refund both left `supplier: { "8|USD": -3 }` — the settlement's void did not remove its discount. Green after T038: 8/8.
- [X] T034 [P] [US3] `packages/core/src/repositories/__tests__/SupplierRepository.lira310AccountSettle.test.ts`:
  - **PAY**: shop owes $203, pays $200, discount 3 → received, +3 profit, anchor neutralizer reduced, account unsettled list empty afterwards (`getAccountUnsettled`).
  - **COLLECT**: account owes the shop $203, pays $200 → forgiven, −3 profit.
  - **Void**: both net to 0.
  - **Refusals**: discount with surplus; over cap.
  
  Red first.
  - Red first: 8/8 failed — `The payment doesn't add up to the total. (Account settlement payment legs do not reconcile to the settled amount — expected $203.00 + 0 LBP, got $200.00 + 0 LBP)` (and the surplus / >$5 cases threw that leg error, not the waive refusal). Green after T040: 8/8 (PAY + COLLECT, void + refund each).
- [X] T035 [P] [US3] `packages/core/src/repositories/__tests__/LotoCheckpointRepository.lira310Discount.test.ts`:
  - net −1,200,000 (shop pays LOTO), legs 1,000,000, `discount_lbp` 200,000 → received, +200,000 profit, LOTO supplier balance closes to 0;
  - net +1,200,000 (LOTO pays), legs 1,000,000 → forgiven, −200,000;
  - `discount_lbp` 450,001 refused;
  - same assertions for the batch path `settleCheckpoints`.
  
  Red first.
  - Red first: 7/8 failed (first 8 cases) — e.g. `Loto settlement #1: payment legs do not reconcile — expected $13.33 USD-equivalent ($0.00 + 1,200,000 LBP), got $11.11` (single and batch, both directions); 450,001 threw the leg error, not /more than/; "waive covers the whole net" did not throw. The "legs ≠ |net| − waive" case passed before (guard only). Green after T041: 8/8 (10/10 with the no-legs guard added under T041).

### Implementation (core)

- [X] T036 [US3] `packages/core/src/repositories/SupplierRepository.ts`: extract `_postSupplierDiscount` (~:5589-5675) into `postSupplierBundledDiscount(supplierId, discount, {direction:"received"|"forgiven", parentLedgerId, applyPurchaseCoverage, settlementId?, transactionMetadata})`:
  - ledger sign: received → −x, forgiven → +x;
  - posting via `buildCounterpartyDiscountPosting(direction)`;
  - `settlementId` self-stamp with a `.changes === 1` check.
  
  Keep `recordSupplierCashflow` calling it with `received`, `applyPurchaseCoverage: true` and no `settlementId`. Behaviour must be identical: existing `SupplierRepository` cashflow-discount tests stay green. Make it callable from `LotoCheckpointRepository` (public method or a shared module function).
  - Done: public `SupplierRepository.postSupplierBundledDiscount(supplierId, discount, {direction, parentLedgerId, createdBy, applyPurchaseCoverage, rate?, settlementId?, transactionMetadata?})`; `_postSupplierDiscount` removed. Link-stamp now checks `.changes === 1`; settlement_id stamp only when the column exists. `recordSupplierCashflow` calls it with `received` + coverage, no settlementId: `SupplierRepository.discount`, `SupplierPayment.bundledDiscountVoid`, `DrawersCounterparties.postingRules`, `ProfitService.transactionBased` 95/95 green, unchanged.
- [X] T037 [US3] `packages/core/src/constants/postingRules.ts`: add a `COUNTERPARTY_DISCOUNT/supplier-forgiven` rule (SUPPLIER_UP) beside ~:1095-1112.
  - Done: `COUNTERPARTY_DISCOUNT/supplier-forgiven` (SUPPLIER_UP, profit −x); the `COUNTERPARTY_DISCOUNT/supplier` note now lists the settlement parents. `postingRules.guard` green.
- [X] T038 [US3] `packages/core/src/repositories/TransactionRepository.ts`:
  - `_linkedSupplierDiscount` (~:6546-6578): accept `SUPPLIER_SETTLEMENT` parents too, finding the discount by the settlement's ledger rows (`source_ref_id IN` those rows).
  - `_reverseSupplierBundledDiscount` (~:6611): skip `_giveBackSupplierPurchaseCoverage` when the parent is a settlement.
  - `_assertSupplierBundledDiscountVoidable` (~:6584): allow it when the discount's `settlement_id` is one of the parent's own settlement rows.
  - The void (~:5354, :5569) and refund (~:5758, :6145) call sites must reach the widened path for SUPPLIER_SETTLEMENT.
  - Fix the stale doc comment in `ProfitRepository.getCounterpartyDiscountTotals` (~:4256).
  - Done: `_linkedSupplierDiscount` accepts SUPPLIER_SETTLEMENT (same `source_ref_id = original.source_id` lookup — the batch SETTLEMENT row or the account anchor row); `_assertSupplierBundledDiscountVoidable` allows `settlement_id === original.source_id` for a settlement; `_reverseSupplierBundledDiscount` skips the coverage give-back for settlements. Void (step 7a) and refund (step 6a) call sites reach it unchanged. Note: `_reverseSupplierSettlement` (5e) NULLs the discount row's settlement_id before 7a; the lookup does not depend on it. Stale doc on `ProfitRepository.getCounterpartyDiscountTotals` fixed.
- [X] T039 [US3] Batch settle:
  - **Schema**: `packages/core/src/validators/supplier.ts` `supplierSettleSchema`: add `discount: counterpartyDiscountInputSchema.optional()`, refined `isWithinShortfallMax` per currency.
  - **Repository**: `SettleTransactionsData` (SR ~:247) gains the field. In `settleTransactions` (~:2716-3307):
    - refuse for bills-only batches, OTHER_PAYMENT mode, and `!owesCash`;
    - reconcile legs against `amount − discount` per currency (~:2910-2957);
    - SETTLEMENT row −(amount − discount);
    - capture its id and call `postSupplierBundledDiscount(received, parentLedgerId, applyPurchaseCoverage:false, settlementId)`.
  - **Service**: `SupplierService` (~:193-212) passes it through.
  
  T033 goes green.
  - Done: `supplierSettleSchema.discount` = `counterpartyDiscountInputSchema.superRefine(cap per currency)` (field-level, so `.shape` keeps working). Repo: refusals before any write (bills-only, OTHER_PAYMENT, nothing owed, > cap, and — deviation — waive ≥ owed in that currency, so a settlement always moves some cash); legs reconcile against `amount − waive` in the same block the posting loop uses; SETTLEMENT row and the SUPPLIER_SETTLEMENT txn amount = cash paid; metadata `waived_*`/`owed_*`; DISCOUNT posted received, linked + self-stamped. Service passes `data` through unchanged.
- [X] T040 [US3] Account settle:
  - **Schema**: `supplierSettleAccountSchema` gains `discount` (same refine).
  - **Repository**: `SettleAccountData` (~:722) gains the field. In `settleAccount` (~:4415-5268):
    - refuse with surplus or when no cash is owed;
    - direction PAY → received, COLLECT → forgiven;
    - reconcile legs per currency against `total − discount` (~:4780-4812);
    - reduce the anchor member's neutralizer by the discount, capped at the anchor's net in that currency, else refuse;
    - post via `postSupplierBundledDiscount(direction, anchorLedgerId, false, settlementId)` inside the same db transaction.
  
  T034 goes green.
  - Done: `supplierSettleAccountSchema.discount` (same capped schema). Repo: refused with a surplus, when the rows net to 0, > cap, ≥ owed, or more than the ANCHOR member's own net in that currency (plain sentence + detail); legs reconcile to `amount + surplus − waive`; anchor neutralizer reduced by the waive; DISCOUNT on the anchor member (PAY received / COLLECT forgiven), `source_ref_id` + `settlement_id` = anchor row; txn amount = cash. `getAccountUnsettled` empty after, row re-opens after void/refund (tested).
- [X] T041 [US3] LOTO settle:
  - **Schemas**: `lotoCheckpointSettleSchema` and `lotoCheckpointsSettleBatchSchema` (`validators/loto.ts:198-243`) gain `discount_lbp: z.number().min(0).optional()`, refined ≤ `SHORTFALL_MAX.LBP` and < |net|.
  - **Threading**: through `LotoService` (~:815-900), the `LotoRepository.ts:233` pass-through, `lotoHandlers.ts:487-571` and `backend/src/api/loto.ts:545-640`.
  - **Repository**: in `LotoCheckpointRepository.settleCheckpoint` and `settleCheckpoints`:
    - reconcile against `|net| − discount` (`assertSettlementLegsReconcile` ~:50-91);
    - SETTLEMENT row = net ∓ discount;
    - capture the insert id and post the discount for the LOTO supplier (`resolveLotoSupplierId`): net < 0 → received, net > 0 → forgiven.
  
  T035 goes green.
  - Done: `discount_lbp` on both checkpoint settle schemas (≤ 450,000, field-level refine); `< |net|` checked in the repo. Threaded positionally through `LotoService.settleCheckpoint(s)`, the `LotoRepository.settleCheckpoint` pass-through (also now forwards `tenderExchangeRate`, which it dropped), both IPC handlers and both REST routes. Repo: one `resolveSettlementWaive` → `cashNet = net − sign(net)·waive` used by BOTH the leg reconciliation and the SETTLEMENT row / LOTO_SETTLEMENT amount; `loto_settlements.net_settlement` stays the true net; metadata `discount_lbp`; ledger insert id captured; discount via the shared writer (net < 0 received, net > 0 forgiven), no settlement_id stamp. Still non-reversible; no reversal added.
  - Follow-up gap (found in review): with NO legs the repo's leg check returns early, so a raw IPC/REST waive with no legs booked unchecked. Guard written first (T035 file, single + batch): red `Expected pattern: /waive/i — Received function did not throw` (2/10 failed); then refused with "Waive needs the payment that was actually made. (… discount_lbp … sent with no payment legs)". Green 10/10 (the whole-net case now sends a 1 LBP leg so it hits its own refusal).
- [X] T042 [US3] Plumbing:
  - add `discount` to the hand-written preload types `electron-app/preload.ts:827-863` and `:870-896`, to `frontend/src/types/electron.d.ts:2029, :2069`, and to `SettleAccountRequest` (`frontend/src/features/suppliers/hooks/useSuppliers.ts:611-641`);
  - three-way key diff for all five channels (rule 23);
  - add the shared discount writer to `packages/core/src/offline/testHelpers/onlineOnlyExempt.ts`;
  - log the rule-21 rewrite of those hand-written types in `current_sprint.md` as follow-up debt.
  - Done: `discount` added to `preload.ts` `suppliers.settleTransactions`/`settleAccount` inline types, both in `electron.d.ts`, and `SettleAccountRequest`. `postSupplierBundledDiscount` added to `onlineOnlyExempt.ts` for all five channels (old `_postSupplierDiscount` entry replaced); `onlineOnlyExemptions.guard` + `requestNow.guard` green. Rule-21 debt logged in `current_sprint.md` (LIRA-310 entry).
  - Rule-23 three-way key diff (new key only; schema / preload type / handler forward):
    - `suppliers:settle-transactions`: schema `discount` ✓ / preload inline type `discount` ✓ (added) / handler `{...v.data}` → service → repo reads `data.discount` ✓. REST `/:id/settle`: same schema, `{...req.body}` ✓. Adapter `SupplierSettleInput` = `z.infer` of the schema ✓.
    - `suppliers:settle-account`: schema `discount` ✓ / preload inline type ✓ (added) / handler `{...v.data}` ✓. REST `/:id/settle-account` same ✓. Adapter `SupplierSettleAccountPayload` (`z.input`) ✓; `SettleAccountRequest` hand-written, `discount` added.
    - `loto:checkpoint:settle`: schema `discount_lbp` ✓ / preload type `LotoCheckpointSettlePayload` (`z.input`, derived) ✓ / handler forwards `v.data.discount_lbp` positionally ✓. REST `/checkpoints/:id/settle` forwards it ✓.
    - `loto:checkpoints:settle-batch`: schema ✓ / `LotoCheckpointsSettleBatchPayload` derived ✓ / handler ✓ / REST ✓.
    - `suppliers:record-cashflow`: unchanged (already had `discount` in all three).

### Implementation (frontend)

- [X] T043 [US3] `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`:
  - pass `onWaiveRemaining` storing `waived {usd,lbp}` from `byCcy`, and `payer="shop"` for PAY;
  - make `underpaid` (~:295) subtract the waived amount;
  - send `discount` in the payload (~:331-363) only when > 0.
  
  Test `AccountSettleSheet.lira310Waive.test.tsx`, red first.
  - Red first: 2/4 failed — `Unable to find an element by: [data-testid="waive-remaining"]` (Waive on a $3 gap, and the stale-waive case). "No discount on a full payment" and "no Waive with a surplus" passed before (guards, not proven failing-first). Green: 4/4; all 5 AccountSettleSheet suites 27/27.
  - Built: shared `frontend/src/shared/hooks/useWaivedShortfall.ts` (waive stored per currency from MPI's 2nd arg; reads 0 once the lines or the reset key change, so a stale waive is never sent; Undo). MPI total = target − waived (key unchanged, typed lines kept); under/overpaid gates use it; `discount` sent only when > 0; `payer="shop"` on PAY; no `onWaiveRemaining` while a surplus is declared.
- [X] T044 [US3] `frontend/src/features/suppliers/pages/Suppliers/index.tsx` batch settle modal (~:3164-3500, gates ~:1567-1605, payload `handleBatchSettle` ~:1712-1780):
  - the same waive state plus a `discount` payload;
  - hide Waive for bills-only / OTHER_PAYMENT, by not passing `onWaiveRemaining`.
  
  Test `Suppliers.lira310BatchWaive.test.tsx`, red first.
  - Red first: 1/3 failed — `Unable to find an element by: [data-testid="waive-remaining"]` ($100 owed, $97 paid). "Full payment sends no discount" and "bills-only Other-payment: no Waive" passed before (guards). Green 3/3; Suppliers suites 98/98.
  - Built: same hook keyed on `settleKey|netPayUsd|netPayLbp`; `onWaiveRemaining` passed only when `!isBillsOnlyBatch && settleOwesCash` (so never on bills-only / Other-payment); gates and MPI total use `owed − waived`; payload keeps `amount_*` = owed and adds `discount` only when waived; `payer: "shop"`.
- [X] T045 [US3] `frontend/src/features/loto/components/SettlementVerification.tsx` (~:686-725):
  - pass `onWaiveRemaining` (LBP) and send `discount_lbp` in the single (~:233-245) and batch (~:255-263) payloads;
  - add the missing underpaid gating on the Settle button (paid + waived ≥ |net| − tolerance);
  - update the `frontend/src/features/loto/components/SettlementDrawerIntegration.tsx:71` caller if its type requires it.
  
  Test red first.
  - Red first: 2/3 failed — batch: `Received element is not disabled` (no underpaid gate); create-and-settle: `Unable to find an element with the text: stub-waive` (no `onWaiveRemaining`). "Full payment: no discount_lbp" passed before (guard). Green 3/3; all loto suites 51/51.
  - Built: waive state (LBP) reset on each dialog load; `discount_lbp` built once and spread into both the single and batch payloads; MPI total = |net| − waived; underpaid gate `paid + waived < |net| − 100 LBP` (MPI's own LBP match tolerance). Deviation: the gate applies only when payment legs are entered — settling with NO legs stays allowed (existing contract kept by the repository and by `SettlementVerification.batchSettle`'s "no payment lines" case). `SettlementDrawerIntegration.tsx` needed no change (optional field).

**Checkpoint**: settlements close with a gap; supplier undo removes the discount.

---

## Phase 6: User Story 4 — Payout kept change up to $5 / 450,000 (P2)

**Goal**: every payout page keeps up to and including the new cap.

- [X] T046 [US4] Write the new boundary cases first: $4.50 and $5.00 kept; $5.01 refused; 450,000 kept; 450,001 refused. Add them to: — DONE: LIRA-310 boundary describe added to all 7 core files; RED before the payout edit: 14 inclusive cases ($5.00 / 450,000 accepted) refused "You can only keep less than $5 …" from keptChange.ts `keptInPayout >= cap`; $4.50 / $5.01 / 450,001 passed already (cap value moved in Phase 2) — not proven failing-first. Old $1/100,000 pins moved to $5/450,000 with owner-decision comments. 22 suites / 372 tests green.
  - `keptChange.test.ts`;
  - `ExchangeRepository.keptChange.test.ts`;
  - `RechargeRepository.payoutKeptChange.test.ts`;
  - `FinancialServiceRepository.receiveKeptChange.test.ts`;
  - `TransactionRepository.refundKeptChange.test.ts`;
  - `SalesRepository.refundItemKeptChange.test.ts`;
  - `HoldMoneyRepository.keptChange.test.ts`;
  - frontend `MultiPaymentInput.payoutKeepChange.test.tsx`.
  
  Run them against the pre-T021-payout-edit code if that edit is not done yet. If T021 already landed, mark them "not proven failing-first" (rule 17, never re-break). Then update the old $1 / 100,000 pins listed in research R1 to the new values, one per file, citing the owner decision in a comment.
- [X] T047 [US4] `packages/ui/src/components/ui/MultiPaymentInput.tsx` payout keep (~:1224-1237): `remainingShortfall < payoutKeepCap` becomes `<=` (+ tolerance), via `isWithinShortfallMax`. `frontend/src/features/audit/components/RefundMethodModal.tsx:197-198` uses the same helper. Update the wording tests `RefundMethodModal.refundWording.test.tsx:63, :71` to "$5" / "450,000 LBP". — DONE (MPI part was Phase 2): keptChange.ts payout branch uses `isWithinShortfallMax` (message "up to $5"/"at most"); RefundMethodModal wording "short by up to $5 / 450,000 LBP" via SHORTFALL_MAX — wording test red ("less than $5") → green; RefundMethodModal.keptChange "$1 short blocked" pin moved to $6 + "$5 kept confirms" (not proven failing-first).
- [X] T048 [US4] `docs/FEATURE_GUIDE.md` §4.1 table and "Where it applies": cap $5 / 450,000 LBP, inclusive. — DONE: §4.1 table, payout bullet and "Where it applies" say $5 / 450,000 LBP inclusive.

---

## Phase 7: User Story 5 — Custom Services discount saved (P2)

(Loto's discount is done in T022–T024 and T031.)

- [X] T049 [US5] `frontend/src/features/custom-services/pages/CustomServices/index.tsx` (~:1394-1440): — DONE: onDiscountChange + maxDiscount = max(0, price − cost) in active currency; payload + session basket send price − discount (clamped, only when the sheet is shown); PriceChangeWarning unchanged (compares the price field, which discount does not touch). CustomServices.lira310Discount.test.tsx 4 red → green (stubbed MPI; built-in Waive itself covered by MPI tests, not re-proven on this page).
  - pass `onDiscountChange={setCsDiscount}` and `maxDiscount={Math.max(0, price − cost)}` to MPI, in the active currency;
  - send `price_usd/price_lbp = price − discount` in the payload (~:450-451), built once;
  - the built-in Waive then applies;
  - check `PriceChangeWarning` (~:1073-1090) still makes sense, or suppress it for a discount.
  
  Test `CustomServices.lira310Discount.test.tsx`: price 30, discount 2, paid 28 → payload `price_usd` 28; discount capped at price − cost. Red first.

---

## Phase 8: User Story 6 — Expenses: the vendor accepted less (P3)

- [X] T050 [US6] `frontend/src/features/expenses/pages/Expenses/index.tsx` (~:515-549): `onWaiveRemaining={(amt) => setBillAmount(String(round(bill − amt, billCurrency)))}`. Confirm the client block (~:216-221) clears and the server check (`ExpenseRepository.ts:323-393`, read its tolerance first) accepts the lowered bill. Test `Expenses.lira310Waive.test.tsx`: bill 52, handed 50 → Waive → payload amount 50. Red first. — DONE: onWaiveRemaining lowers the bill (rounded to bill currency); client block and ExpenseRepository shop reconcile (handed − returned − notReturned = bill) see an exact payment. Expenses.lira310Waive.test.tsx (real MPI) 2 red (no waive-remaining) → green; the ">$5 no Waive" case passed pre-change (not proven failing-first).

---

## Phase 9: Polish & cross-cutting

- [X] T051 [P] Check "no Waive" pages: Services (OMT/Whish system), Exchange, TopUpModal, HoldMoneySection, HoldMoneyPickupSheet, RefundMethodModal, Debts cash-out. Grep that none passes `onWaiveRemaining`, and that each has `showDiscount={false}` or is a payout. Add one MPI-level assertion per category if not already covered by T004 (e)/(h). — Done: Services, Exchange, TopUpModal, HoldMoneySection, HoldMoneyPickupSheet and RefundMethodModal pass no `onWaiveRemaining`; each has `showDiscount={false}` and/or is a payout, so no built-in Waive either. Debts cash-out is a payout, so it is hidden by the MPI gate (covered by T004).
- [X] T052 Web e2e `frontend/tests/e2e-web/lira-web-057-waive.spec.ts` (number from T002), per quickstart §4, using identity plus delta assertions (rule 15). Run with `node scripts/run-e2e.mjs web -g "lira-web-057"` and confirm the reported test count is > 0. **Done 2026-10-11:** `node scripts/run-e2e.mjs web view=off -g "lira-web-057"` → `5 passed (8.5s)` (session Waive + two refusals, Loto discount + over-commission refusal, supplier batch settle with discount + void, Alfa card $0.50 waived, Expenses page Waive button).
- [X] T053 `docs/FEATURE_GUIDE.md`: — Done: §4.1 cap (T048), §9 bundled settlement discounts + `WAIVED_SHORTFALL` sweep, §10 Waive rule incl. "Waive follows Remaining". COUNTERPARTY_LEDGERS.md not updated: §9 of FEATURE_GUIDE carries the forgiven-direction note; listed as a follow-up.
  - §9: supplier settlement now sweeps its bundled discount; LOTO settlement discount is non-reversible (correction = opposite supplier adjustment);
  - §10: Waive lowers profit; `WAIVED_SHORTFALL`;
  - §13: note "Waive follows Remaining".
  
  Also update `docs/COUNTERPARTY_LEDGERS.md` for the forgiven supplier discount.
- [X] T054 Release note in `docs/release-notes/UNRELEASED.md` (rule 30), one line per area, in owner/cashier wording: — Done: lines under POS, MTC/Alfa, Debts, Partners, Loto (×2), OMT/Whish & suppliers (×2), Exchange, Expenses, plus new Customer baskets and Custom services sections; `build-release-notes --check` up to date.
  - POS: Waive up to $5;
  - Mobile services: Waive;
  - Debts: Waive;
  - Partners: Waive;
  - Suppliers: settle with Waive;
  - Loto: discount saved, Waive on tickets and settlement;
  - Sessions: Waive;
  - Custom Services: discount saved;
  - Expenses: Waive;
  - Payouts: keep up to $5.
  
  Update `current_sprint.md` LIRA-310 status.
- [X] T055 Gates: `yarn typecheck` (confirm it took about 2 minutes), `yarn lint`, `node scripts/check-tenant-scoping.mjs`, `yarn check:bind-arity`, the full core jest, and the full frontend jest. Record the counts against T001. — Done: core build + sync; `yarn typecheck` exit 0 in 36 s; `yarn lint` 0 errors; frontend jest 538/538 suites (3,272 tests); core jest 724/727. The 3 failures are other-session LIRA-309 work in progress (migration v211 `resale_lines`: v210.offlineEvents expects latest 210, idRange/DatabaseReset table lists), not LIRA-310.
- [X] T056 Report to the owner: what changed per page, the tests proven failing-first vs not, and anything unverified. **Do not commit** until the owner says "commit". — Done: report delivered 2026-10-11. Extra guards added (LBP/USD cap agreement at rates 89k–100k, 22/22). COUNTERPARTY_LEDGERS.md updated. Not committed.

---

## Dependencies & execution order

- **Phase 1 → Phase 2** blocks everything.
- **US1** needs only Phase 2.
- **US2**: T021 is needed by T023 and T026.
- **US3**: T036 → T038 → T039/T040/T041.
- **US4**: T046 should land before or with the T021 payout edit to keep failing-first proof possible. Do T046 before T021 when executing.
- **US5** needs Phase 2.
- **US6** needs Phase 2.
- **Polish** comes last.

### Parallel opportunities

- **Phase 2**: T003 ∥ T004.
- **US1**:
  - tests T008 ∥ T009 ∥ T010 ∥ T011;
  - T012–T016 touch different files, so they can run in parallel after T006.
- **US2**:
  - tests T018 ∥ T019 ∥ T020;
  - frontend T031 ∥ T032 once the core is done.
- **US3**:
  - tests T033 ∥ T034 ∥ T035;
  - frontend T043 ∥ T044 ∥ T045.
- **Stories**: US1, US5 and US6 can run in parallel with the US2/US3 core work (different layers).

## Implementation strategy

1. **MVP**: Phase 1–3 (shared Waive + 11 discount pages, screen only). Demo to the owner.
2. **Next**: US4 (cap raise) and US2 (Loto + Session), each proven with net-to-zero tests.
3. **Then**: US3 (settlements), the riskiest posting change.
4. **Finally**: US5, US6, polish, docs, release note. Then wait for "commit".
