# Tasks: Exchange — customer account both ways, payment window for every currency (LIRA-369)

**Input**: `specs/369-exchange-account-all-currencies/` (spec, plan, research, data-model, contracts, quickstart)

**Tests**: REQUIRED. Constitution rules 17, 20, 24 and 28d apply:
- Guard tests are written first and seen failing before the fix.
- Create + void must net to 0 per currency.
- Field names come from the schema.
- Each money form gets a variant test.

Run each test by its own file path only, never a full suite. **Ask the owner before running any test.** No Electron or desktop e2e on this Mac.

**Format**: `- [ ] Txxx [P?] [Story?] Description with file path`

**Code map** (file:line as of 2026-11-01, from research.md):
- `ExchangeRepository.ts`:
  - lot effects call ~:557;
  - payout legs ~:681 / ~:884–966;
  - USD/LBP-target guard ~:901;
  - non-drawer refusal ~:916;
  - lump fallback ~:967;
  - `_assertCustomerPaysShape` ~:1079;
  - `_customerPaysUsdRate` ~:1125;
  - `_applyExchangeLotEffects` ~:1322.
- `moneyPosting.ts`:
  - `sumLegsByCurrency` ~:265;
  - `reconcileLegs` ~:300;
  - `expectedTotalIn` ~:359;
  - `postPayoutLegs` ~:973;
  - `bookCustomerLegs` ~:1507.
- `validators/exchange.ts`:
  - `exchangeCustomerCanOwe` :100;
  - `refineCustomerPays` :110–167;
  - `exchangeSubmitSchema` :238.
- `MultiPaymentInput.tsx` rate box ~:3030.
- Exchange page:
  - `canSplitPayout` ~:790;
  - submit button ~:2158;
  - `handleProcess` ~:1188;
  - `PaymentSheet` ~:2243.

---

## Phase 1: Setup

- [x] T001 Read `docs/FEATURE_GUIDE.md` §4, §5, §9, §10 and §13. Append a "§13 walk" at the end of `specs/369-exchange-account-all-currencies/research.md`, filling in each item for this feature:
  - transaction row fields;
  - IN/OUT badge;
  - payment legs (IN only, one predicate);
  - client propagation;
  - CUSTOMER_ACCOUNT (debt + `CREDIT_DEPOSIT`);
  - supplier/partner ledger (none);
  - void path;
  - profit stamping and the pending gate;
  - session branch;
  - audit viewer;
  - item 14 invariant;
  - item 15 reconcile.
- [x] T002 Rule 23 three-way key diff for the exchange submit:
  - (a) `exchangeSubmitSchema` and `createExchangeSchema` in `packages/core/src/validators/exchange.ts`;
  - (b) the exchange payload type in `electron-app/preload.ts` (~:580–629);
  - (c) `CreateExchangeData` in `packages/core/src/repositories/ExchangeRepository.ts` (~:90–227) and the fields `handleProcess` sends.

  Record the diff in research.md. Note any key missing from one side before adding new keys.

---

## Phase 2: Foundational (blocks every story)

- [x] T003 Write a failing guard `packages/core/src/repositories/__tests__/ExchangeRepository.lira369Lots.test.ts`. It pins TODAY's lot behaviour for cash-only exchanges, so the reorder in T005 must keep it green:
  - USD→EUR acquire/consume quantities;
  - unit cost;
  - realized profit;
  - void restoring lots (alongside `TransactionRepository.exchangeLotReversal.test.ts`).

  Then add the NEW expectation (failing): `_applyExchangeLotEffects` receives physically-moved quantities — acquire = `amountIn` − customer-side account lines in `fromCurrency`; consume = `amountOut` − payout account legs in `toCurrency`.
- [x] T004 In `packages/core/src/repositories/moneyPosting.ts`, add:
  - one predicate `isPhysicalPayoutLeg(leg)` (true unless `method === "CUSTOMER_ACCOUNT"`);
  - `reconcileNativeLegs({ legs, currency, expected, context })`. Every leg's `currencyCode === currency`, every method ∈ {CASH, CUSTOMER_ACCOUNT}, and Σ amounts = `expected` within that currency's rounding tolerance (0.01 for 2-decimal currencies). Otherwise throw a context-prefixed error.

  Unit test in `packages/core/src/repositories/__tests__/moneyPosting.reconcileNativeLegs.test.ts`, failing first.
- [x] T005 In `packages/core/src/repositories/ExchangeRepository.ts`:
  - measure and validate the customer legs and payout legs BEFORE the `_applyExchangeLotEffects` call (~:557);
  - pass the physical quantities into it (unit cost and proceeds unchanged).

  T003 must pass, including its pinned-today cases.
- [x] T006 In `packages/core/src/validators/exchange.ts`, add the schema keys to BOTH `createExchangeSchema` and `exchangeSubmitSchema`:
  - `customer_account_usd_rate: z.number().positive().optional()`;
  - `payout_account_usd_rate: z.number().positive().optional()`.

  Each must be "Required iff a customer-side [payout] account line is in a non-USD/LBP currency; refused otherwise." Add them to `CreateExchangeData`, to the `electron-app/preload.ts` exchange type, and check that `packages/ui/src/api/types.ts` derives the payload type from the schema (rule 21; fix it if it is hand-written).
- [x] T007 Write the validator guard `packages/core/src/validators/__tests__/exchange.lira369.test.ts`, failing first. Field names come from the schema (rule 24). Cases:
  - Native mode (`toCurrency` not USD/LBP): legs must be in `toCurrency`; methods only CASH and CUSTOMER_ACCOUNT; refuse `kept_change_*`, `rounding_given_*`, `added_change_*` and `tender_exchange_rate`.
  - Any CUSTOMER_ACCOUNT on either side without `clientId`: refused.
  - Rate-key presence: required and refused per T006.
  - A customer-side CUSTOMER_ACCOUNT in EUR: accepted.
  - Forgive/`customer_waived_amount` with non-USD/LBP `fromCurrency`: still refused.
  - Partner mode with any of these keys: refused.

  Then implement the refines (drop only the account half of the `exchangeCustomerCanOwe` refine at :156–166).

**Checkpoint**: lots count physical quantity, the schema accepts the new shapes, and native reconcile exists.

---

## Phase 3: User Story 1 — Payment window for every currency (P1) 🎯 MVP

**Goal**: every walk-in exchange confirms through the payment window. A native target pays out in cash in that currency.

**Independent test**: $110 → 100 EUR, cash both ways, through the window. Drawer USD +110, EUR −100, the same as today's direct save. EUR→GBP also opens.

- [x] T008 [P] [US1] Write a core guard in `packages/core/src/repositories/__tests__/ExchangeRepository.lira369.test.ts` (new file), failing first:
  - USD→EUR with `payments: [{CASH, EUR, 100}]` is accepted. Today it throws "A split payout requires a USD or LBP target currency".
  - Drawers: USD +110, EUR −100.
  - EUR lot consumed 100.
  - EUR→GBP with GBP cash legs is accepted.
  - Legs short of `amountOut` are refused.
  - A leg in USD on an EUR target is refused.
  - Void nets every drawer and lot to 0.
- [x] T009 [US1] In `ExchangeRepository.ts` payout booking:
  - replace the ~:901 USD/LBP-target throw with a mode switch. USD/LBP keeps `reconcileLegs` unchanged; native calls `reconcileNativeLegs`.
  - write the native CASH legs per leg with `insertPaymentRow` + `applyDrawerDelta` in `toCurrency`.
  - keep the lump fallback only for partner mode and legacy callers with no legs.

  T008 must pass.
- [x] T010 [P] [US1] Write a frontend guard `frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.lira369.test.tsx` (stable `useApi` mock, rule 25), failing first:
  - USD→EUR: clicking `exchange-submit` opens the payment window (today it submits directly).
  - The payout methods are exactly Cash + Customer account, currency EUR.
  - No keep/round-up/added-change controls.
  - For Partner still submits directly.
  - A lot-tracked loss shows the loss confirmation from the window's Confirm before `addExchangeTransaction` is called (R8).
  - The payload built from the window matches `exchangeSubmitSchema` (parse it).
- [x] T011 [US1] In `frontend/src/features/exchange/pages/Exchange/index.tsx`:
  - `canSplitPayout = !forPartner`;
  - a native-mode flag `payoutIsNative = toCurrency not USD/LBP`;
  - payout `paymentMethods`: drawer CASH (+ CUSTOMER_ACCOUNT, added in US2) — native shows CASH in `toCurrency` only;
  - pass `toCurrency` as the sheet currency;
  - do not wire `onKeptChange`/`onRoundUpChange`/`onAddedChange` in native mode;
  - move the loss confirmation onto the sheet's `onConfirm` path;
  - `handleProcess` omits `tender_exchange_rate` and the kept/rounding/added fields in native mode (one payload builder, rule 22).
- [x] T012 [US1] Let the payment window list the payout currency: replace the hard-coded `currencies` (USD, LBP) in `frontend/src/features/recharge/components/PaymentSheet.tsx` (~:500) with an optional `currencies` prop defaulting to USD+LBP. The Exchange page passes `[{ code: toCurrency, symbol }]` in native mode. Check that `MultiPaymentInput` totals, "Paid" and `fmt` handle a non-USD/LBP currency (2 decimals, symbol). Add a case to T010. T010 must pass.

**Checkpoint**: US1 is shippable alone (the reported bug is fixed).

---

## Phase 4: User Story 2 — OUT to customer account (P1)

**Goal**: the shop pays all or part of the result onto the client's account.

**Independent test**: $110 → 100 EUR, 60 cash + 40 on account at 1.10. EUR drawer −60, `CREDIT_DEPOSIT` −$44 with note "40 EUR @ 1.10 = $44", EUR lot consumed 60. Void nets to 0.

- [x] T013 [P] [US2] Extend `ExchangeRepository.lira369.test.ts`, failing first:
  - **USD target, account $2,235**: `CREDIT_DEPOSIT` −2,235 USD, `transaction_id` = the exchange transaction id, no USD drawer move.
  - **LBP target, account**: credit in LBP.
  - **EUR target, all on account at 1.10**: credit −$110; EUR drawer and lot unchanged; note `"100 EUR @ 1.10 = $110"`; details `account_conversion` snapshot.
  - **Split 60 cash + 40 account**: as in the independent test.
  - **Without `clientId`**: refused. **Without `payout_account_usd_rate` on EUR**: refused.
  - **Typed rate 1.08 vs trade 1.10 on 40 EUR**: credit $43.20 and the exchange margin +$0.80 (R6).
  - **Void and refund**: drawers, `debt_ledger` per currency, lots and margin all net to 0 (rule 20).
- [x] T014 [US2] In `ExchangeRepository.ts`:
  - remove the stale ~:916 refusal for CUSTOMER_ACCOUNT only; other non-drawer methods stay refused;
  - in the payout leg loop, a CUSTOMER_ACCOUNT leg calls `getDebtService().addCreditOrThrow({ clientId, amountUsd | amountLbp, transactionId: txnId, note })` and never touches a drawer or writes a drawer `payments` row:
    - USD/LBP: credited in that currency;
    - native: `round2(amount × payout_account_usd_rate)` USD;
  - append the snapshot note and push `account_conversion` into the exchange details (R7);
  - fold the typed-rate gap `q·(t − r)` into the stamped margin (leg1 for a direct trade, leg2 for a cross trade).

  T013 must pass.
- [x] T015 [US2] Exchange page: add CUSTOMER_ACCOUNT to the payout `paymentMethods` in both modes, gated by the existing client requirement (Confirm off and "pick a client" with no client, matching the customer side). Add page-test cases to `Exchange.lira369.test.tsx`, failing first.

---

## Phase 5: User Story 3 — IN from customer account in every currency (P2)

**Goal**: a customer paying in EUR (or other) may put it on account, charged in USD at the typed rate.

**Independent test**: 100 EUR on account at 1.10 → `'Exchange Debt'` +$110 with the snapshot note; EUR drawer and lot unchanged; void nets to 0.

- [x] T016 [P] [US3] Extend `ExchangeRepository.lira369.test.ts`, failing first:
  - EUR→USD, customer side `CUSTOMER_ACCOUNT` 100 EUR, `customer_account_usd_rate: 1.10`: debt +$110 (one `'Exchange Debt'` row, `transaction_id` linked, note snapshot); no EUR drawer move; EUR lot acquired 0.
  - Part 60 EUR cash + 40 EUR account: lot acquired 60, debt $44.
  - USD/LBP customer side: unchanged from today (no rate key).
  - Void: debt cancelled; everything nets to 0.
- [x] T017 [US3] In `ExchangeRepository.ts`:
  - in `_assertCustomerPaysShape` (~:1097–1107), allow CUSTOMER_ACCOUNT for any `fromCurrency`; keep forgive USD/LBP-only;
  - pass `customer_account_usd_rate` as the `rate` to `bookCustomerLegs` when present (same `amount * rate` convention), else today's `_customerPaysUsdRate`;
  - snapshot note and `account_conversion`.

  T016 must pass.
- [x] T018 [US3] Exchange page: `customerPaymentMethods` offers CUSTOMER_ACCOUNT for every `fromCurrency`; `customerMaxForgive` stays USD/LBP-only. Page-test cases, failing first.

---

## Phase 6: User Story 4 — One rate box for any currency (P2)

**Goal**: "1 EUR = … USD", seeded at the exchange's own rate and editable, shown when a non-USD/LBP account line exists.

**Independent test**: an EUR-target exchange with an Account line shows `1 EUR = 1.10 USD`. Typing 1.12 changes the credited USD. A rate of 0 or empty keeps Confirm off.

- [x] T019 [P] [US4] Write a ui guard `packages/ui/src/components/ui/__tests__/MultiPaymentInput.lira369RatePair.test.tsx`, failing first:
  - with a new prop `accountRate: { currency: "EUR", value: 1.10, onChange }` and an Account line in EUR, the box reads "1 EUR = … USD" with its own testid (`payment-account-rate`);
  - edits fire `onChange`;
  - without the prop the existing "1 USD = … LBP" box renders exactly as today (snapshot of the existing testid `payment-exchange-rate`);
  - the counter-flow section supports the same prop for the customer side.
- [x] T020 [US4] Implement the `accountRate` prop in `packages/ui/src/components/ui/MultiPaymentInput.tsx` (header ~:3030 and counter-flow section), shown only when a CUSTOMER_ACCOUNT line in `accountRate.currency` exists. Pass it through `PaymentSheet.tsx`. Strings go in the `packages/ui/src/i18n/locales/{en,ar}/` common namespace (no new namespace).
- [x] T021 [US4] Exchange page: state `payoutAccountRate` / `customerAccountRate`.
  - Seed both from the exchange's own per-unit USD value (R5): direct = `amountIn/amountOut` or the inverse; cross = USD notional ÷ quantity. Put this in ONE helper `exchangeUnitUsd(result, currency)` in `frontend/src/features/exchange/utils/`.
  - Reseed on a new calculation.
  - Send `payout_account_usd_rate` / `customer_account_usd_rate` only when the matching side has a non-USD/LBP account line.
  - Confirm is off while that rate is ≤ 0.

  Page-test cases, failing first.

---

## Phase 7: User Story 5 — Margin counts when the money is received (P1, FR-016)

**Goal**: an exchange's margin is pending while any `'Exchange Debt'` on it is open, and counts under the exchange's own date once paid. This also applies to existing USD/LBP exchanges paid on account.

**Independent test**: $60 cash + $50 account, $5 margin. Profits shows $0 counted / $5 pending. Repay $25: still pending. Repay $25: $5 counted, dated the exchange day. Voiding the last repayment makes it pending again.

- [x] T022 [P] [US5] Write a core guard `packages/core/src/repositories/__tests__/ProfitRepository.lira369ExchangePending.test.ts`, failing first:
  - exchange totals, the By Module drill-down (`ExchangeDetailRow`), by-user and pending reads;
  - each scenario from the independent test;
  - a cash-only exchange is unaffected;
  - a USD/LBP exchange recorded with an account line also waits.
- [x] T023 [US5] In `packages/core/src/repositories/ProfitRepository.ts`:
  - apply the existing `notDebtPending(<exchange's transactions.id expr>)` to every exchange read — totals, drill-down, by-user, pending. Reuse the fragment, never copy it (rule 14);
  - expose `debt_pending` on `ExchangeDetailRow` as the other modules do;
  - fix the stale comment at ~:535.

  Confirm that `'Exchange Debt'` coverage is swept by `DebtRepository._coverServiceDebtsFIFO` (it is in `SERVICE_DEBT_COVERAGE_TYPES`); add a repayment case to T022 proving it. T022 must pass.
- [x] T024 [US5] Profits page: make sure the exchange drill-down shows pending rows the way recharge/financial rows do (`not_counted`). Find the component with `grep -rn "ExchangeDetailRow\|debt_pending" frontend/src/features/profits`. Add a page test, failing first.

---

## Phase 8: Polish & cross-cutting

- [x] T025 Variant table test (rule 28d) in `packages/core/src/repositories/__tests__/ExchangeRepository.lira369Variants.test.ts`:
  - walk {USD→LBP, LBP→USD, USD→EUR, EUR→USD, EUR→LBP, EUR→GBP} × payout {cash, account, split} × customer side {cash, account, split};
  - build each payload exactly as `handleProcess` does (import the page's payload builder, or extract it to `frontend/src/features/exchange/utils/` first so one builder serves page and test, rule 22), then parse it through `exchangeSubmitSchema` and run it through `ExchangeService.addDirectTransaction`;
  - assert each one is accepted, the data-model.md invariant holds per currency, and void nets to 0.
- [x] T026 [P] Web e2e `frontend/tests/e2e-web/lira-web-089-exchange-account.spec.ts`:
  - USD→EUR 100 EUR: 60 cash + 40 account at 1.10, with a picked client;
  - assert by identity and by delta (rule 15): EUR drawer −60, client balance −$44 with the note text, Positions EUR −60;
  - void → back;
  - save the What's new screenshot `frontend/public/whats-new/1.35.0/exchange-account-any-currency.png` (landscape, the real window).
- [ ] T027 [P] `docs/release-notes/UNRELEASED.md`:
  - bullets under the Exchange area (window for every currency; customer account both ways, booked in dollars with the original amount and rate; an exchange paid on account now counts its profit when the customer pays, including earlier ones);
  - a `### ` card in `## ✨ Highlights` with the T026 screenshot;
  - run `node scripts/build-release-notes.cjs --check`.
- [x] T028 [P] `docs/FEATURE_GUIDE.md` §5 and §10: Exchange takes the account both ways; converted lines are fixed USD with a snapshot note; lots count physical quantity; the exchange margin is gated by `notDebtPending`. Name the guarding tests.
- [x] T029 Gates:
  - core build + sync (`cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`);
  - `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`;
  - the affected test files only (ask first).

  Update the LIRA-369 entry in `current_sprint.md` with the built state, the tests (failing-first or not) and "What users will notice".
- [x] T030 Delete the throwaway demo folder `frontend/.lira369-demo/` (used for the comparison artifact).

---

## Dependencies

- Phase 2 (T003–T007) blocks every story. T005 depends on T003; T007 depends on T006.
- US1 (T008–T012) is first. US2 and US3 build on US1's window and native mode. US4 needs US2 or US3 (an account line to convert). US5 is independent of US1–US4 and can run in parallel after Phase 2.
- Polish (T025–T029) comes after all stories. T026 needs US1, US2 and US4.

## Parallel opportunities

- T004 runs alongside T003.
- Inside each story, the [P] test task can be written while the previous story's implementation finishes.
- US5 (T022–T024) runs in parallel with US2–US4.
- T026, T027 and T028 run in parallel.

## Implementation strategy

1. MVP = Phase 2 + US1. This fixes the reported bug: the window opens for EUR.
2. Then US2 and US5. US2 is the owner's main ask; US5 makes profit honest for today's account exchanges too.
3. Then US3 + US4 (any currency on account with a typed rate).
4. Polish: variant test, web e2e and screenshot, release notes, guide, gates.

## Implementation notes (2026-11-01)

- T003/T005: no reorder was needed — the account totals come straight from the payload (`accountTotal(customerPayments / payments)`), so they are passed into `_applyExchangeLotEffects` at its existing call site. Lot quantities are covered by `ExchangeRepository.lira369.test.ts` (position deltas) plus the unchanged lot suites (lotSettlement, exchangeLotReversal: green).
- Failing-first evidence: `ExchangeRepository.lira369.test.ts` 16/18 failed on the old code ("A split payout requires a USD or LBP target currency", "Payout method \"CUSTOMER_ACCOUNT\" is not supported"); `exchange.lira369.test.ts` 28/34 failed; `moneyPosting.reconcileNativeLegs.test.ts` 6/6 failed (not a function). All now pass.
- Rewritten (rule 24, premise reversed by the owner 2026-11-01): `ExchangeRepository.splitPayout` (CUSTOMER_ACCOUNT now needs a client; GIFT_CARD still refused; USD line on EUR target refused), `exchange.customerPayments` validator + repository (EUR account allowed with the typed rate; discount still refused).
- Review fix: mixed-currency account payout credited per line currency (2 guards failing first in `ExchangeRepository.lira369`). T025 widened to cross pairs (54 cases). T027 What's new card NOT done (rule 30 — required). Session-mode account exchange unverified.
