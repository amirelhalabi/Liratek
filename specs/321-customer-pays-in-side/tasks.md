---
description: "Task list for LIRA-321 — Customer pays becomes the money-in side of payout screens"
---

# Tasks: "Customer pays" becomes the money-in side of payout screens

**Input**: Design documents from `/specs/321-customer-pays-in-side/` — [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/payment-box.md](./contracts/payment-box.md), [contracts/write-payloads.md](./contracts/write-payloads.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. CLAUDE.md rule 17 — every guard is written first and seen failing on the unfixed code before the fix; never prove a test by reverting finished code. If a guard could not be seen failing first, write "not proven failing-first" next to its task. **Ask the owner before running any test suite** (standing rule); desktop e2e is never run on the owner's Mac.

**Organization**: grouped by user story. Delivery order (one PR each, see plan): Foundation (Phase 2 + US2) → Exchange (US1 + US5) → Whish App / OMT App (US3) → Binance (US4). US6 needs no work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md
- Paths are repo-relative. Line numbers are from 2026-10-14 and may drift; search for the named symbol.

---

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §13 and note, per screen (Exchange, Whish App receive, OMT App receive, Binance cash-out), the checklist items this feature touches (payment legs, client propagation, CUSTOMER_ACCOUNT model, void path, profit stamping) in a short "§13 map" section appended to `specs/321-customer-pays-in-side/research.md`
- [X] T002 Confirm the Node ABI for core jest (`node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`); if it fails run `yarn rebuild:node`. Record the result in the PR description, no file change

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared contract, the booking helper and the shared Split button. No screen behaviour changes in this phase.

### Tests first

- [X] T003 [P] Write failing core tests for `bookCustomerLegs` in `packages/core/src/repositories/__tests__/moneyPosting.bookCustomerLegs.test.ts`, using the in-memory DB helpers the other `moneyPosting` tests use. Cases:
  - (a) exact cash cover;
  - (b) short with a `CUSTOMER_ACCOUNT` leg books one `debt_ledger` row of the given type and currency, linked by `transaction_id`;
  - (c) short with no account leg and no forgive throws;
  - (d) a forgive within `isWithinShortfallMax` ($5 / 450,000 LBP) is accepted and returned as `forgiven`;
  - (e) a forgive above the cap throws;
  - (f) legs summing to more than expected throw (no overpay);
  - (g) an account leg with no `clientId` throws;
  - (h) a non-USD/LBP leg currency (EUR) on the account leg books its USD equivalent at the passed `rate`;
  - (i) USDT counts 1:1 as USD for the comparison and for the debt;
  - (j) each non-account leg posts a positive payment row to `drawerFor(leg)` and moves that drawer's balance by the same amount.
- [X] T004 [P] Write failing schema tests for the shared fragment in `packages/core/src/validators/__tests__/customerLegs.test.ts`:
  - `customerLegSchema` refuses amount ≤ 0 and an empty method;
  - `customer_waived_amount` refuses a negative value.

### Implementation

- [X] T005 [P] Add `customerLegSchema` and `customerPaymentsField` (`customerPayments: z.array(customerLegSchema).min(1).optional()`, `customer_waived_amount: z.number().min(0).optional()`) to a new `packages/core/src/validators/customerLegs.ts`.
  - Export them and their input types from `packages/core/src/index.ts`, and also from `packages/core/src/browser.ts`, since the frontend resolves `browser.ts` (rule 21).
  - The module must import no Node built-in (rule 29).
- [X] T006 Implement `bookCustomerLegs(db, { legs, expected: { amount, currency }, rate, debtType, clientId, transactionId, drawerFor, waived, tenantId, createdBy })` in `packages/core/src/repositories/moneyPosting.ts` per research R4, until T003 passes.
  - Same-currency sum when every leg is in `expected.currency`; `reconcileLegs` for mixed USD/LBP; USDT counted 1:1 as USD.
  - Post non-account legs with the existing `insertPaymentRow`/`applyDrawerDelta` writers.
  - Book account legs once per currency through `bookClientDebtCharge`. The `debtType` is passed as a string literal by each caller, so the guard test can see it.
  - Return `{ paid, owed, forgiven }`.
  - Do NOT touch `bookFeeCollectionLegs` in `FinancialServiceRepository.ts` (plan: old `feePayments` replay unchanged).
- [X] T007 [P] Extract the existing `split-toggle` button markup (MPI:2463-2504) into `packages/ui/src/components/ui/SplitToggle.tsx`. Props: `{ active, onClick, testId, disabled? }`. Use it in MPI's header with `testId="split-toggle"`. This is a pure refactor: no visual or behaviour change, and the existing `MultiPaymentInput.test.tsx` split tests must stay green unchanged.

**Checkpoint**: core can book customer legs; nothing calls it yet.

---

## Phase 3: User Story 2 — the money-in side works like the money-out side (P1) 🎯 foundation

**Goal**: the "Customer pays" section has real single/split behaviour, sits above "Shop pays", reports its balance and gets the payout labels. Pages still send `feePayments`, so no money change.

**Independent test**: `MultiPaymentInput.test.tsx` counterFlow block, plus the Whish App receive "fee paid separately" sheet. The fee line is the only line until US3.

### Tests first

- [X] T008 [P] [US2] Write failing RTL tests in `frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx` (counterFlow describe):
  - (a) one seed line ⇒ single mode, no `counter-flow-add-split` and no remove ×;
  - (b) two `seedLines` ⇒ split mode with both lines;
  - (c) typing less than `totalAmount` in single mode switches to split and adds the leftover line (CUSTOMER_ACCOUNT when offered, else CASH);
  - (d) `counter-flow-split-toggle` toggles single ↔ split, and back-to-single re-seeds one full line;
  - (e) `onStateChange` reports `balanced`/`overpaid`/`needsClient`/`owedToAccount` for: exact, short with an account line, over, and an account line with no client;
  - (f) `lockCurrency` disables every `counter-flow-currency-*` select and adds lines in `currency`;
  - (g) with `payer="payout"`:
    - `counter-flow-section` precedes `payment-summary`'s card header in DOM order (`compareDocumentPosition`);
    - the header reads "Shop pays";
    - `direction-chip-you-pay` reads "OUT" and `direction-chip-customer-pays` reads "IN";
    - the title is "Customer pays — LBP" with `lockCurrency`, else "Customer pays";
  - (h) without `payer="payout"`, the header still reads "Payment" (money-in screens unchanged);
  - (i) a `maxForgive` shortfall can be forgiven and is reported in `forgiven`;
  - (j) while short, `counter-flow-unaccounted` shows "Still to settle: <amount> <CUR>" and `onStateChange` reports `unaccounted`;
  - (k) an auto-added leftover line (method untouched) switches from CASH to CUSTOMER_ACCOUNT when `hasClient` turns true; a line the cashier changed keeps its method.

  Update the existing chip tests (1683-1694) to pass `payer="payout"` and expect the new texts.
  - Failing-first: 18 failed / 9 passed before the fix. Not proven failing-first by design: (h) "not a payout: header still reads Payment" (guards unchanged behaviour) and the negative (i) "no Forgive control above maxForgive" (asserts absence).
- [X] T009 [P] [US2] Write a failing test in `frontend/src/features/recharge/components/__tests__/PaymentSheet.counterFlow.test.tsx`:
  - `confirmDisabled` disables the Confirm button;
  - the new counterFlow fields (`seedLines`, `lockCurrency`, `maxForgive`, `onStateChange`) reach MultiPaymentInput.

  Update the chip-text assertions at 56-67.

### Implementation

- [X] T010 [US2] Create `packages/ui/src/components/ui/useLinesSection.ts` per research R1, until the T008 hook-driven cases pass.
  - It holds: split flag; touched ref; seed from `seedLines` (default one CASH line at `totalAmount`); add / remove / update (currency change converts the amount, as MPI:2360-2381 does today); leftover method = `CUSTOMER_ACCOUNT` when offered, else CASH, and CASH on a 0 leftover; auto-switch to split with a leftover line when the single line is below the total.
  - It computes `paid`/`owedToAccount`/`forgiven`/`balanced`/`overpaid`/`needsClient`/`unaccounted`.
  - It tracks the auto-added leftover line id (like MPI's `autoDebtLineIdRef`) and switches it to CUSTOMER_ACCOUNT when `hasClient` turns true, unless the cashier changed its method.
  - Move the current counterFlow state and handlers (MPI:2285-2392) onto the hook. The step-1 leftover rule must keep passing ("leftover line method (LIRA-321 step 1)" tests).
- [X] T011 [US2] Wire the hook into `packages/ui/src/components/ui/MultiPaymentInput.tsx`:
  - extend the `counterFlow` prop type with `seedLines?`, `lockCurrency?`, `maxForgive?`, `onStateChange?` per [contracts/payment-box.md](./contracts/payment-box.md);
  - render single mode (one large `PaymentLineRow`, no `onRemove`, no add) vs split mode (rows with ×, `counter-flow-add-split`);
  - add a `SplitToggle` with `testId="counter-flow-split-toggle"` in the section header;
  - disable the currency select when `lockCurrency` (extend `PaymentLineRow` with an optional `currencyLocked` prop that disables its currency `<select>`; MPI:532-543);
  - add a Forgive control for a shortfall ≤ `maxForgive`;
  - render "Still to settle: <amount> <CUR>" (`counter-flow-unaccounted`) while `unaccounted > 0`.
- [X] T012 [US2] In `packages/ui/src/components/ui/MultiPaymentInput.tsx`, when `isPayout && counterFlow`:
  - move the `counter-flow-section` block (MPI:2656-2710) above the card header (2422) and swap its `border-t` to a bottom border;
  - header text "Shop pays", replacing the page's own `label` (Services passes "Cashout" on Whish ↓); chip texts OUT / IN, testids unchanged;
  - section title `Customer pays — ${currency}` when `lockCurrency`, else "Customer pays".

  Otherwise render exactly as today. DOM order only: no prop, state, total or payload change (FR-019). T008 (g)(h) must pass.
- [X] T013 [US2] In `frontend/src/features/recharge/components/PaymentSheet.tsx`, extend its `counterFlow` type (125-133) with the new fields, and add `confirmDisabled?: boolean` gating the Confirm button together with `isSubmitting` (340-346). T009 must pass.
- [X] T014 [US2] On the three existing fee screens, pass `onStateChange` and set `confirmDisabled` from `overpaid || needsClient || !balanced`. Payloads unchanged: still `feePayments`.
  - `frontend/src/features/services/pages/Services/index.tsx` (counterFlow ~2602); it already passes `payer: "payout"` on RECEIVE (~2558), keep that.
  - `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` (~1299-1312).
  - `frontend/src/features/recharge/components/CryptoForm.tsx` (~810-832).
  - Run the existing page tests (`Services.feeCounterFlow`, `Services.whishReceiveFee`, `OmtWhishAppTransferForm.appWalletFeeModes`, `CryptoForm.feeCollectedSeparately`) after asking the owner.

**Checkpoint**: payment box done; the three fee screens show IN above OUT with the new labels; money unchanged.

---

## Phase 4: User Story 1 — Exchange: customer pays part now, owes the rest (P1) 🎯 MVP

**Goal**: the Exchange sheet has "Customer pays — <CUR>" (locked); a shortfall becomes an `Exchange Debt` for a linked client; the client is saved with the exchange.

**Independent test**: $1,000 at 89,500 for a linked client, 87,600,000 LBP paid: LBP cash +87,600,000, USD cash −1,000, Exchange Debt +1,900,000 LBP on the Debts page.

### Tests first

- [X] T015 [P] [US1] Write failing core tests in `packages/core/src/repositories/__tests__/ExchangeRepository.customerPayments.test.ts`, asserting ledger deltas, not absolute totals:
  - spec US1 scenarios 1, 2, 4 and 5;
  - `client_id` stored on `exchange_transactions` and on the unified `transactions` row;
  - a EUR→USD exchange whose shortfall is booked in USD at the exchange's own EUR→USD rate;
  - a For-Partner exchange carrying `customerPayments` is refused;
  - a payload WITHOUT `customerPayments` books the single CASH lump exactly as today (FR-018).
- [X] T016 [P] [US1] Write failing schema tests in `packages/core/src/validators/__tests__/exchange.customerPayments.test.ts` for both `createExchangeSchema` and `exchangeSubmitSchema`:
  - `clientId` is required when any `customerPayments` line is `CUSTOMER_ACCOUNT`;
  - every line's `currencyCode` must equal `fromCurrency`;
  - refused with `partnerMode === "FOR"`;
  - `payments` (payout) is unchanged.
- [X] T017 [P] [US1] Write a failing test that `'Exchange Debt'` is classified: extend `packages/core/src/constants/__tests__/moduleDebtTypes.guard.test.ts` expectations if needed, so an unlisted literal fails.
- [X] T018a [P] [US1] Write a failing core test in `packages/core/src/repositories/__tests__/DebtRepository.exchangeDebtRepayment.test.ts`: an `Exchange Debt` of 1,900,000 LBP is listed in the client's open debts and is fully settled by a 1,900,000 LBP repayment through the normal repayment path (FR-015). Make it pass with T021 (whitelisting feeds `REPAYMENT_COVERABLE_DEBT_TYPES`).
- [X] T018 [P] [US1] Write a failing profit test in `packages/core/src/repositories/__tests__/ProfitRepository.exchangeDebt.test.ts`: the US1.7 exchange's recognised profit equals the fully paid exchange's. This confirms plan owner-check #1 ("Likely: counts at once"). Report the result to the owner before Phase 6.
- [X] T019 [P] [US1] Write failing page tests in `frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.customerPays.test.tsx`, mocking `useApi` with a STABLE reference (rule 25):
  - the sheet passes `counterFlow` with `totalAmount = amountIn`, `currency = fromCurrency`, `lockCurrency`;
  - Confirm is disabled while a 1,900,000 LBP account line has no client;
  - submit sends `customerPayments` and `clientId`, with field names taken from the schema (rule 24);
  - For-Partner mode renders no customer section and sends no `customerPayments`.

### Implementation

- [X] T019a [P] [US1] Write a failing offline replay test in `packages/core/src/offline/bindings/__tests__/exchange.binding.test.ts`: a queued exchange with `customerPayments` + `clientId` replays to the same drawer deltas and debt as an online save (FR-017).
- [X] T020 [US1] Add migration v215 to `packages/core/src/db/migrations/index.ts` (check that the last entry is still v214 first; increment from it):
  - `ALTER TABLE exchange_transactions ADD COLUMN client_id INTEGER NULL REFERENCES clients(id)` and `CREATE INDEX idx_exchange_transactions_client_id ON exchange_transactions(tenant_id, client_id)`;
  - `down()` rebuilds the table without the column.

  Mirror it in `electron-app/create_db.sql` (`exchange_transactions` ~1110-1137 + index). Run `yarn check:schema-equivalence`.
- [X] T021 [US1] Add `'Exchange Debt'` to `MODULE_DEBT_TRANSACTION_TYPES` in `packages/core/src/constants/transactionTypes.ts` (699-706). T017 must pass.
- [X] T022 [US1] Spread `customerPaymentsField` and `clientId: z.number().int().positive().optional()` into `createExchangeSchema` and `exchangeSubmitSchema` in `packages/core/src/validators/exchange.ts`, with refines for: client required when an account line exists; line currency = `fromCurrency`; not with `partnerMode === "FOR"`. T016 must pass.
- [X] T023 [US1] Rule-23 three-way key diff, then add `clientId`, `customerPayments` and `customer_waived_amount` to all three, so no key is stripped:
  - schema keys;
  - the `exchange:add-transaction` `data` type in `electron-app/preload.ts` (505-535, hand-written, rule 12);
  - `CreateExchangeData` in `packages/core/src/repositories/ExchangeRepository.ts` (79-148).

  Confirm `electron-app/handlers/exchangeHandlers.ts` and `backend/src/api/exchange.ts` forward the whole validated object, and that `packages/core/src/offline/bindings/exchange.ts` passes it through.
- [X] T024 [US1] In `ExchangeRepository.createTransaction` (`packages/core/src/repositories/ExchangeRepository.ts`):
  - write `client_id` on the `exchange_transactions` INSERT (~311) and pass `client_id` to `getTransactionRepository().createTransaction` (~479-542) (rule 11);
  - when `customerPayments` is present (and not For-Partner), replace the CASH lump (544-565) with `bookCustomerLegs(... expected: { amount: amountIn, currency: fromCurrency }, debtType: 'Exchange Debt', rate: <fromCurrency→USD rate of this exchange>, waived: customer_waived_amount ...)`;
  - book a forgiven part with the LIRA-310 `WAIVED_SHORTFALL` writer in `packages/core/src/repositories/keptChange.ts`.
    _Done as: the shared `bookForgivenShortfallSibling` in `packages/core/src/repositories/forgivenShortfall.ts` (not keptChange.ts — that file is imported by TransactionRepository, so the writer there would be an import cycle). Exchange, Whish App / OMT App and Binance all call it (FR-012, rule 14)._

  Payout legs code untouched (FR-010). T015 must pass.
- [X] T025 [US1] (backend half done: `client_id` + `client_full_name` projected by `ExchangeRepository.getHistory`; UI half done: HistoryModal shows `client_full_name ?? client_name`, `HistoryModal.linkedClient.test.tsx`) Project `client_id` and the client's name in the exchange history read (`ExchangeRepository` `getColumns` 198-225 / `getHistory` ~1115), and show the client in `frontend/src/features/exchange/pages/Exchange/components/HistoryModal.tsx` (FR-014).
- [X] T026 [US1] Exchange page `frontend/src/features/exchange/pages/Exchange/index.tsx`:
  - replace the free-text client input (1870-1880) with the shared client picker used on Services (id + name + phone; keep the typed-name fallback);
  - pass `counterFlow` to `PaymentSheet` (1966-2018) with `totalAmount = amountIn`, `currency = fromCurrency`, `lockCurrency: true`, `seedLines: [{ method: "CASH", currencyCode: fromCurrency, amount: amountIn }]`, all drawer methods + `CUSTOMER_ACCOUNT`, `requiresClient: true`, `hasClient: !!clientId`, `maxForgive` from `SHORTFALL_MAX`;
  - set `confirmDisabled` from `onStateChange`;
  - in `handleProcess` (1039-1100), build the payload ONCE with `customerPayments` (non-zero lines), `customer_waived_amount` and `clientId` (rule 22);
  - hide the section and send nothing new when `forPartner`.
  - Follow-ups 2026-10-14: EUR owing blocked; client picker in sheet.

  T019 must pass.
- [X] T027 [US1] Type the adapter: `frontend/src/api/backendApi.ts` (~2137), `frontend/src/api/ElectronApiAdapter.ts` (~371) and `packages/ui/src/api/types.ts` (~1482) keep `ExchangeSubmitPayload = z.input<typeof exchangeSubmitSchema>`. Confirm the new fields flow with no hand-written type (rule 21). Run `yarn typecheck`.
- [X] T028 [US1] (written, not run: `frontend/tests/e2e-web/lira-web-061-exchange-customer-pays.spec.ts` test (a)) Write a new web e2e `frontend/tests/e2e-web/lira-web-0xx-exchange-customer-pays.spec.ts` (take the next free number):
  - snapshot the LBP/USD General drawers and the client's debt;
  - run the $1,000 at 89,500 exchange paying 87,600,000 with a seeded client;
  - assert the deltas +87,600,000 / −1,000 / +1,900,000 LBP, matching the transaction by identity (rule 15);
  - check the debt on the Debts page, then repay it there and assert the debt is 0 and the LBP drawer moved by +1,900,000.

  Run it after asking the owner.

**Checkpoint**: US1 is shippable on both transports.

---

## Phase 5: User Story 5 — undo (P1), Exchange part (ships with US1)

- [X] T029 [P] [US5] Write failing tests in `packages/core/src/repositories/__tests__/TransactionRepository.exchangeCustomerPaysReversal.test.ts`:
  - void and full refund of the US1.1 exchange net to 0 for LBP cash, USD cash, `debt_ledger` (Exchange Debt) and exchange profit, per currency;
  - same for the forgive case (US1.4), including the `WAIVED_SHORTFALL` row;
  - partly repaid debt then refund follows the existing account-charge rule (US5.3, `_unwindServiceDebtCoverageFifo`).
- [X] T030 [US5] Make T029 pass. Expected owner: the generic `_reversePayments` + `_cancelDebt` (`packages/core/src/repositories/TransactionRepository.ts` 8150, 8417) plus the LIRA-310 waived-row reversal. Change code only if a case fails, and record which reversal owner covered each row (rule 20).
- [X] T031 [US5] (written, not run: lira-web-061 test (b)) Extend T028's web e2e with a refund step that asserts every delta returns to 0.

---

## Phase 6: User Story 3 — Whish App / OMT App cash-out (P2)

**Goal**: the transfer becomes a customer line (Whish wallet / OMT wallet) next to the fee line (Whish App only; OMT App has no fee, D1).

**Independent test**: spec US3 (a)–(c) deltas; OMT App mirror with no fee line.

### Tests first

- [X] T032 [P] [US3] Write failing core tests in `packages/core/src/repositories/__tests__/FinancialServiceRepository.receiveCustomerPayments.test.ts`:
  - spec US3 scenarios 1–4 for WHISH_APP ($100 transfer, $5 fee, `customerPayments`): Whish_App, OMT_App, USD cash and Service Debt deltas;
  - US3.6 for OMT_APP: transfer only, and any fee still refused (D1, `OMT_RECEIVE_NO_FEE_MESSAGE`);
  - a provider-wallet line is stored with `method` = provider code, and `isInternalLegJs` is still true for it (`TransactionRepository.ts` 377-401);
  - `customerPayments` together with `feePayments` is refused;
  - a payload WITHOUT `customerPayments` books the single provider row exactly as today (FR-018).
- [X] T033 [P] [US3] Write failing schema tests in `packages/core/src/validators/__tests__/financial.customerPayments.test.ts`:
  - `customerPayments` only on RECEIVE for WHISH_APP / OMT_APP / BINANCE;
  - not with `feePayments`;
  - not For-Partner.
- [X] T034 [P] [US3] Write failing page tests in `frontend/src/features/recharge/components/__tests__/OmtWhishAppTransferForm.customerPays.test.tsx`:
  - Whish App + fee separately seeds two lines ($100 Whish, $5 Cash) in split mode;
  - OMT App seeds one line, single mode;
  - the submit payload carries `customerPayments` (schema names) and no `feePayments`.

### Implementation

- [X] T034a [P] [US3] Write a failing offline replay test in `packages/core/src/offline/bindings/__tests__/financial.test.ts`: a queued Whish App receive with `customerPayments` replays to the same wallet/cash deltas and debt as an online save (FR-017).
- [X] T034b [P] [US3] Add a failing case to T034's page test: switching the fee from "Customer pays separately" to "Deducted" or "Sender" removes the fee line, and the section goes back to single mode when only the transfer is owed.
- [X] T035 [US3] Spread `customerPaymentsField` into `createFinancialServiceSchema` in `packages/core/src/validators/financial.ts`, with refines per [contracts/write-payloads.md](./contracts/write-payloads.md). Keep `feePayments` and the D1 refine untouched. T033 must pass.
- [X] T036 [US3] Rule-23 key diff for the financial channel (`electron-app/handlers/omtHandlers.ts:38`, `electron-app/preload.ts` binding, `backend/src/api/services.ts:107-110`, `packages/core/src/offline/bindings/financial*`). Add the new keys wherever a hand-written type lists fields.
- [X] T037 [US3] In `FinancialServiceRepository.createTransaction` wallet-transfer branch (`packages/core/src/repositories/FinancialServiceRepository.ts` 3519-3962), when `customerPayments` is present on a WHISH_APP/OMT_APP RECEIVE:
  - replace the single inflow row (3754-3765) with `bookCustomerLegs(... expected: transfer + fee (fee only when paid separately), cash currency, debtType: 'Service Debt' ...)`, with a `drawerFor` that maps the provider's own wallet line to `method` = provider code and that wallet drawer;
  - skip `bookFeeCollectionLegs` (the fee is inside `customerPayments`);
  - book a forgiven part (`customer_waived_amount`) with the LIRA-310 `WAIVED_SHORTFALL` writer (`packages/core/src/repositories/keptChange.ts`), and add a forgive case to T032;
    _Forgive aligned 2026-10-14: first shipped as a cut to the row's own profit stamp (never on the Profits "Waived" line); now the shared `bookForgivenShortfallSibling` (forgivenShortfall.ts) books a WAIVED_SHORTFALL sibling like Exchange, the fee profit stays the full fee, and the parent's void/refund voids the sibling (`_cascadeWaivedShortfallSiblingVoid`, any parent type)._
  - keep the payout side (`payments`, `cashoutMethod`, kept change) and the COMMISSION row unchanged.

  T032 must pass.
- [X] T038 [US3] Frontend `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx`:
  - on RECEIVE show the customer section always (not only when the fee is paid separately), with `seedLines` = transfer line (WHISH / OMT wallet) + fee line (Cash) when the fee is separate on Whish App;
  - keep the lines in state;
  - in `buildWalletTransferPayload` (`packages/core/src/utils/walletTransfer.ts` 256-300 / form 383-445) send `customerPayments` instead of `feePayments`, building the payload once.

  T034 must pass.
- [X] T039 [US3] Write failing-first reversal tests for US3 (a)–(c) in `packages/core/src/repositories/__tests__/TransactionRepository.receiveCustomerPaysReversal.test.ts`: void and refund net to 0 for Whish_App, OMT_App, USD cash, Service Debt and fee profit. Then make them pass (spec US5.2; rule 20).
- [X] T040 [US3] (written, not run: `frontend/tests/e2e-web/lira-web-062-whish-app-receive-customer-pays.spec.ts`) Write a new web e2e `frontend/tests/e2e-web/lira-web-0xx-whish-app-receive-customer-pays.spec.ts`: case (c) deltas (Whish_App +90, USD cash −95, debt $10), then refund back to 0. There is no existing web e2e for app-wallet receive. Run it after asking the owner.

---

## Phase 7: User Story 4 — Binance cash-out (P2)

**Goal**: the USDT amount becomes a customer line (Binance) next to the fee line, with a USDT shortfall owed 1:1 in USD.

**Independent test**: spec US4: 80 USDT Binance + $20 cash + $2 fee ⇒ Binance +80 USDT, USD cash −78.

- [X] T041 [P] [US4] Write failing core tests in `packages/core/src/repositories/__tests__/FinancialServiceRepository.binanceCustomerPayments.test.ts`:
  - spec US4 scenarios 1–4 (Binance drawer in USDT, USD cash, Service Debt in USD, 1 USDT = $1);
  - void and refund of each net to 0 (US5).
- [X] T042 [P] [US4] Write failing page tests in `frontend/src/features/recharge/pages/Recharge/__tests__/Recharge.binanceCustomerPays.test.tsx`:
  - seed lines (100 USDT Binance + $2 Cash fee when separate);
  - the payload carries `customerPayments`;
  - switching the fee away from "Customer pays separately" removes the fee line and returns to single mode.
- [X] T043 [US4] Extend T037's branch to BINANCE RECEIVE: the Binance line in USDT goes to the `Binance` drawer with `method = BINANCE`; cash lines in USD/LBP; the shortfall is debt in USD 1:1; a forgiven part is booked with the `WAIVED_SHORTFALL` writer (add a forgive case to T041). T041 must pass.
- [X] T044 [US4] Frontend:
  - `frontend/src/features/recharge/components/CryptoForm.tsx` (counterFlow 810-832; allow USDT for the Binance line, USD for cash);
  - `frontend/src/features/recharge/pages/Recharge/index.tsx` (`handleCryptoSubmit` 1461, `addOMTTransaction` 1572-1636): send `customerPayments` instead of `feePayments`.

  T042 must pass.
- [X] T045 [US4] (written + typechecked, not run) Write a new web e2e `frontend/tests/e2e-web/lira-web-064-binance-receive-customer-pays.spec.ts`: US4.2 deltas, then refund back to 0. Run it after asking the owner. — written (typechecked), NOT run.

---

## Phase 8: Polish & cross-cutting

- [X] T046 [P] (lines placed under "💳 Payment window", incl. the Exchange line; no separate heading) Add release-note lines under `## 💳 Payment window` and a new `## 💱 Exchange` heading (none exists yet) in `docs/release-notes/UNRELEASED.md`, in shop-owner wording, one per shipped phase:
  - "Customer pays" now on top with OUT/IN labels;
  - Exchange: pay part now, owe the rest, linked to a client;
  - Whish App / OMT App / Binance cash-out: the transfer can be paid across methods or owed.
- [X] T047 [P] Update `docs/FEATURE_GUIDE.md` (§8 payment legs / §13 checklist): `customerPayments[]` is the IN side of payout screens, booked by `bookCustomerLegs`; reversal owners. Add the new guard specs to the guide's table.
- [X] T048 Update the LIRA-321 ticket in `current_sprint.md` per phase: built / tests, with counts confirmed; "What users will notice".
- [X] T049 (2026-10-14: typecheck 0/41s, lint 0 errors/9 old warnings, tenant-scoping, bind-arity, schema-equivalence 98 tables, release-notes check — all exit 0) Run the quality gates in [quickstart.md](./quickstart.md) §4 (`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`). Confirm elapsed time and test counts, so a fast no-op isn't read as a pass (rule 28).
- [ ] T050 After deploy, run the manual check on test.liratek.shop (quickstart §5) and screenshot the Exchange sheet for the owner. Submit nothing on real tenants.

---

## Dependencies

- Phase 1 → Phase 2 → **US2** (Phase 3) → **US1** (Phase 4) → **US5-exchange** (Phase 5) → **US3** (Phase 6) → **US4** (Phase 7) → Polish.
- US1 needs T005/T006 (schema fragment, helper) and US2 (section behaviour, `confirmDisabled`).
- US3 and US4 need T005/T006 and US2; they do not need US1. They could start right after US2, but the owner's order is Exchange first.
- US4 reuses T037's branch, so it comes after US3.
- US6: no tasks (Whish ↓ unchanged).

## Parallel opportunities

- Phase 2: T003, T004, T007 together; then T005 ∥ T006 (T006 imports types from T005, so finish T005 first if they share a file).
- US2: T008 ∥ T009, then T010 → T011 → T012 (same file, sequential), T013 ∥ T014.
- US1: T015, T016, T017, T018, T019 together. Then T020 ∥ T021 ∥ T022, then T023 → T024 → T025, and T026 → T027 → T028.
- US3: T032 ∥ T033 ∥ T034; T035 → T036 → T037; T038 after T035.
- US4: T041 ∥ T042; T043 → T044 → T045.

## Implementation strategy

1. **PR 1 — Foundation**: Phases 1–3. The visible change is the box (IN above OUT, labels, single/split) on the three fee screens; no money change.
2. **PR 2 — MVP Exchange**: Phases 4–5. This delivers the trigger case: stop, show the owner on test.liratek.shop, get approval.
3. **PR 3 — Whish App / OMT App**: Phase 6.
4. **PR 4 — Binance**: Phase 7.
5. Polish tasks ride along with each PR (release note and ticket every time). The owner says "commit" before every commit.
