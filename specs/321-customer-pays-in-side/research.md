# Research: "Customer pays" becomes the money-in side of payout screens

**Feature**: LIRA-321 · **Date**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

Code facts were read from the repository on 2026-10-14 by three parallel research passes (payment box, Exchange backend, app-receive/Binance backend). File references are `path:line` at that date. "Likely" marks an inference not confirmed by running code.

---

## R1. Where the "Customer pays" section lives today, and the reuse seam

**Facts.** `MultiPaymentInput` (`packages/ui/src/components/ui/MultiPaymentInput.tsx`, MPI) has an opt-in `counterFlow` prop (MPI:364-381: `label, totalAmount, currency, onChange, paymentMethods?, requiresClient?, hasClient?`). State and handlers at MPI:2285-2392; JSX at MPI:2656-2710, rendered **between** the main lines (2523-2652) and the `payment-summary` footer (2713+). There is **no single mode**: `counterFlowSplitMode` only stops re-seeding; "+ Add line" (`counter-flow-add-split`) and × always render. The step-1 prerequisite (leftover line defaults to `CUSTOMER_ACCOUNT` when offered) is already in `addCounterFlowLine` (MPI:2333-2344). `PaymentSheet.tsx:125-133` repeats the prop shape and passes it through (:333).

The main section's single/split (`isSplitMode` 657, `toggleSplitMode` 2253-2277, `split-toggle` 2463-2504, single render 2616-2650, split render 2524-2614) and its auto-debt remainder (1377-1469) are bound to `paymentLines`, `allocatePayments` and the discount, so they cannot be reused as-is.

**Decision.** Extract two small pieces from MPI and build the counter-flow on them; the main section keeps its own code in this feature:
- `SplitToggle` — the existing `split-toggle` button markup, unchanged look, used by both headers (the owner asked that both sections look and behave the same).
- `useLinesSection({ seedLines, currency, convert, methods, leftoverMethod, lockCurrency })` — split flag, touched ref, add/remove/update, remaining, balanced/overpaid, auto-leftover. Rendered through the existing `PaymentLineRow` (MPI:485-582) for single (one large row, no ×) and split (rows + "+ Add line").

**Rationale.** Smallest change that gives the IN side real single/split without copying the main section's logic; the main section can move onto the hook later.
**Alternatives rejected.** (a) Copy the main section's split code into the counter-flow — two implementations drift (rule 14 spirit). (b) Move the main section onto the hook now — larger blast radius across every payment screen for no user benefit in this feature.

## R2. Labels and order (FR-002, FR-019)

**Facts.** Header text is `{label || "Payment"}` (MPI:2426); Services overrides with `"Cashout"` on RECEIVE (~2547). The "You pay" chip (2432-2439) shows whenever `counterFlow` is set; "Customer pays" chip (2665-2670) is inside the section. `isPayout` is resolved at MPI:641-643. No test or e2e asserts the order of the two sections (no `compareDocumentPosition`, no positional `nth` across them); testid prefixes `counter-flow-*` and `payment-*` do not overlap. `lira-services-for-partner-ui.spec.ts:305` asserts "Payment" on a sheet without counter-flow.

**Decision.** Gate the new wording on `isPayout && counterFlow`: header "Shop pays" + OUT chip, IN chip in the section; title "Customer pays — <CUR>" only when `counterFlow.lockCurrency` is set (Exchange), otherwise "Customer pays". Everything else renders as today (POS and money-in screens unchanged). Move the counter-flow block above the main header (DOM order only; swap the `border-t`). No prop, state, handler or payload changes because of order.
**Rationale.** FR-019 says order must not change behaviour; DOM-only move with stable testids satisfies that, and the existing suites (which query by testid) prove it.

## R3. Wire format for customer legs

**Facts.** On financial services, `payments[]` already carries the payout and `feePayments[]` (no `direction`) carries the customer-paid fee (`validators/financial.ts:164-206`); `BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md` §1.2 explains why the IN side of `payments[]` is taken. On Exchange, every `payments[]` entry is treated as a payout leg (`ExchangeRepository.ts:569-650`).

**Decision.** One new sibling array, `customerPayments[]` (`{ method, currencyCode, amount }`, no direction), on both schemas, holding **every** line of the "Customer pays" section (transfer + fee lines alike). Defined once as a shared Zod fragment in `packages/core/src/validators/payments.ts` (or the existing legs module) and spread into `createExchangeSchema`, `exchangeSubmitSchema` and `createFinancialServiceSchema`. `feePayments[]` stays accepted unchanged for old clients and offline replay (FR-017); a request may carry one or the other, never both (schema refine).
**Rationale.** The section is one list on screen; splitting it back into "transfer" and "fee" arrays on the client would need a per-line purpose the cashier never chose (an added leftover line belongs to neither). Profit already comes from `commission`, not from fee legs (R6), so the server does not need to know which line paid the fee.
**Alternatives rejected.** (a) `direction: "IN"` entries inside `payments[]` — collides with the payout and the change-leg convention (rule 16). (b) Two arrays `transferPayments[]` + `feePayments[]` — forces a purpose on lines the cashier adds.

## R4. One shared booking helper

**Facts.** `bookFeeCollectionLegs` (FSR = `packages/core/src/repositories/FinancialServiceRepository.ts`:2679-2735) reconciles fee legs against `expectedTotalIn(fee, cashCurrency)`, books `CUSTOMER_ACCOUNT` via `bookClientDebtCharge` ("Service Debt", 2704-2713) and other legs via `resolveServiceCashDrawer`. `reconcileLegs` / `sumLegsByCurrency` (`moneyPosting.ts:262-354`) **throw on any currency other than USD/LBP**. `bookClientDebtCharge` is at `moneyPosting.ts:530-567`. `RechargeRepository.ts:1658-1697` silently drops non-USD/LBP debt legs.

**Decision.** New `bookCustomerLegs(db, { legs, expected: {amount, currency}, rate, debtType, clientId, transactionId, drawerFor, forgiveMax, tenantId, createdBy })` in `moneyPosting.ts`:
1. Refuse when the legs add up to **more** than expected (FR overpay decision).
2. Accept a shortfall only when covered by a `CUSTOMER_ACCOUNT` leg (needs `clientId`) or a forgiven amount within `isWithinShortfallMax` (cap $5 / 450,000 LBP).
3. Post every non-account leg to its drawer/wallet (`drawerFor(leg)`), positive.
4. Book the account legs once as `debtType` in USD/LBP; a leg in any other currency is converted to USD at `rate` before booking (owner decision: owe the USD equivalent).
Same-currency comparison is done directly when every leg is in the expected currency (Exchange: currency locked). Mixed USD/LBP goes through `reconcileLegs`. USDT counts 1:1 as USD, the convention `expectedTotalIn(payout, "USD")` already uses for Binance (FSR:3560-3561, 3873-3879).
`bookFeeCollectionLegs` is left untouched in this feature: its current checks may accept payloads the new helper refuses (overpay, uncovered shortfall), and queued offline `feePayments` must replay unchanged (FR-017).
**Rationale.** One writer for "customer legs → drawers + debt" across Exchange and financial services (rule 14), and the only place the USD-equivalent rule lives.

## R5. Exchange specifics

**Facts.** `ExchangeRepository.createTransaction` (234-730): the IN side is one CASH lump of `amountIn` to the General drawer in `fromCurrency` (544-565, skipped in For-Partner mode); `createTransaction(...)` on the unified table at 479-542 passes **no `client_id`**; `exchange_transactions` has `client_name` but no `client_id` (`create_db.sql:1110-1137`); history reads `exchange_transactions` only (198-225, 1115). The unified `transactions` table already has `client_id`. Payout legs refuse non-drawer methods (604-608), which stays (FR-010). `ExchangeService.addDirectTransaction` (215-257) has no SQL. Latest migration: **v214** (`migrations/index.ts:14708`).

**Decision.**
- Migration **v215**: `exchange_transactions.client_id INTEGER REFERENCES clients(id)` (nullable) + index; both migration file and `create_db.sql`; `down()` rebuilds without it.
- `clientId` on both exchange schemas, preload `data` type (hand-written, rule 12), `CreateExchangeData`, offline binding (pass-through), and `createTransaction({ client_id })` (rule 11). History projects `client_id` and the client's name.
- When `customerPayments[]` is present (and not For-Partner), replace the lump with `bookCustomerLegs` against `{ amountIn, fromCurrency }`, `debtType: 'Exchange Debt'`, `rate` = the exchange's own fromCurrency→USD rate (leg-1 rate when via USD, the direct rate when the target is USD). Absent → today's lump (old clients, FR-017).
- `'Exchange Debt'` added to `MODULE_DEBT_TRANSACTION_TYPES` (`constants/transactionTypes.ts:699-706`), so the generic void/refund `_cancelDebt` (TransactionRepository 8417-8475) cancels it and repayment FIFO covers it (feeds `SERVICE_DEBT_COVERAGE_TYPES` / `REPAYMENT_COVERABLE_DEBT_TYPES`). The guard test `moduleDebtTypes.guard.test.ts` requires the literal at the call site.

**Exchange screen limits.** The sheet opens only when the target is USD or LBP (`Exchange/index.tsx:725-726`, unchanged). Owner decision 2026-10-14: owing and forgiving are blocked when the customer pays in any currency other than USD/LBP (EUR, USDT…), because the exchange position code records the full amount as bought while the drawer only got what was paid; the customer pays such exchanges in full (`exchangeCustomerCanOwe` in `validators/exchange.ts`, also enforced in the repository).

## R6. Profit

**Facts.** Exchange profit is stamped from the trade (`totalProfitUsd` + kept change), on the full amounts, regardless of how the customer paid; exchange recognition (`ProfitRepository.ts:2843`, gates 3744-3749) has **no** debt-pending gate. Financial services stamp profit from `commission`; the fee COMMISSION row has zero drawer delta (FSR:3952-3961). Under the existing DBT-1 rule (`ProfitRepository.ts:1069-1095`) any module-debt row on a financial transaction ("Service Debt") holds that transaction's profit until the client repays.

**Decision.** No profit code changes. Amounts are never changed by owing (FR-012). Timing follows each module's existing rule: Exchange counts at once; a receive with a "Service Debt" waits for repayment, exactly as a fee owed does today. Recorded as an owner check in the plan (consistency question), not changed silently.

## R7. App receive and Binance

**Facts.** All three go through FSR's wallet-transfer branch (3519-3962). The inflow is **one** row: `insertPayment(txnId, data.provider, systemDrawer, cryptoCurrency, cryptoAmount)` + balance delta (3754-3765), method = provider code (`WHISH_APP`/`OMT_APP`/`BINANCE`). That method is in `INTERNAL_LEG_METHODS` (`TransactionRepository.ts:280-291`), so `isInternalLegJs` (377-401) keeps it out of customer in/out summaries and refund overrides. Wallet providers write no supplier-ledger siblings (FSR:4700-4707, 4790-4797). Refunds negate every payment row (`_reversePayments`, 8150) and cancel module debt by `transaction_id`, so several inflow rows reverse with no new code. The `Binance` drawer is in USDT (`create_db.sql:1673-1674`). **OMT App RECEIVE refuses any fee** (D1: FSR:1950-1959, `validators/financial.ts:319-349`).

**Decision.**
- When `customerPayments[]` is present on an app/Binance RECEIVE, the inflow is booked by `bookCustomerLegs` against `{ transfer + fee (when paid separately), cashCurrency }`, `debtType: 'Service Debt'` (already whitelisted), instead of the single provider row.
- A leg whose method maps to the provider's own wallet (Whish wallet on Whish App, OMT wallet on OMT App, Binance on Binance) is stored with **method = provider code** in that wallet's currency, so it stays an internal leg exactly as today. Other legs (OMT wallet on a Whish App receive, Cash) are stored with their own method and drawer.
- OMT App: one transfer line, no fee line (D1 unchanged). Spec Story 3.6 corrected to say so.
- The payout side (`payments[]`, `cashoutMethod`, kept change) is untouched.

## R8. Frontend wiring

**Facts.** Exchange sheet `Exchange/index.tsx:1966-2018` (no counterFlow, CASH-only, `direction="payout"`); `handleProcess` 1039-1100 sends free-text `clientName` (1072); client input 1870-1880. Whish/OMT App: `OmtWhishAppTransferForm.tsx` (`feePaymentLines` 150, `showFeeCounterFlow` 277-282, payload via `buildWalletTransferPayload` 383-445, counterFlow 1299-1312). Binance: payload in `features/recharge/pages/Recharge/index.tsx` (`handleCryptoSubmit` 1461, `addOMTTransaction` 1572-1636), counterFlow in `CryptoForm.tsx:810-832`. MPI exposes no validity; `PaymentSheet` confirm is gated only by `isSubmitting` (340-346); balance is enforced server-side only.

**Decision.** Each page passes `counterFlow.seedLines`, keeps the lines in state, sends them as `customerPayments` through the existing adapter function (payload built once, rule 22), and disables Confirm while the section reports not balanced or a debt needs a client (new `onStateChange`, contract in [contracts/payment-box.md](./contracts/payment-box.md)). The server check stays authoritative. Exchange swaps the free-text client field for the shared client picker (`clientId` + name), hides the section in For-Partner mode.

## R9. Tests to extend

Core: `ExchangeRepository.splitPayout/keptChange/forPartner`, `TransactionRepository.exchangeLotReversal`, `FinancialServiceRepository.appWalletTransfer/binance/receiveFeeLegs/receiveFeeCutoverD1`, `TransactionRepository.refundFeeOnTopReceive/walletCashoutVoid`, `moduleDebtTypes.guard`, offline bindings for exchange and financial. Frontend: `MultiPaymentInput.test.tsx` (counterFlow 1628-1857; chip tests gain `payer="payout"`), `PaymentSheet.counterFlow.test.tsx:56-67`, `Exchange.splitPayout`, `OmtWhishAppTransferForm.appWalletFeeModes`, `Recharge.cryptoFeeCollectedSeparately`. Web e2e: `lira-web-022-exchange-submit-parity`, `lira-web-017`; there is **no** web e2e for app-wallet or Binance receive yet (new ones needed, rule 19). Desktop e2e (not run on the owner's Mac): lira-101, lira-136, lira-134.

## §13 map (T001)

FEATURE_GUIDE §13 items this feature touches, per screen. Items not listed (3 IN/OUT badge, 8 supplier/partner ledger, 11 sessions, 12 audit viewer) are unchanged: no new transaction type, no new supplier sibling, payout side untouched.

| §13 item | Exchange | Whish App receive | OMT App receive | Binance cash-out |
| --- | --- | --- | --- | --- |
| 1 Schema/plumbing | v215 `exchange_transactions.client_id` (both files); `clientId` + `customerPaymentsField` on both exchange schemas, preload, `CreateExchangeData`, offline binding (rule 23 key diff) | `customerPaymentsField` on `createFinancialServiceSchema` (RECEIVE, app/Binance only) | same, transfer only (D1: no fee) | same |
| 4 Payment legs | IN lump replaced by `bookCustomerLegs` against `{amountIn, fromCurrency}`; lines locked to `fromCurrency`; payout `payments[]` and kept change unchanged | inflow single provider row replaced by `bookCustomerLegs` against transfer + fee (when paid separately); own-wallet line keeps method = `WHISH_APP` (internal leg) | against transfer only; own-wallet line method = `OMT_APP` | against transfer + fee; Binance line in USDT, method = `BINANCE`; USDT 1:1 as USD |
| 5 Drawers | each line to its drawer in `fromCurrency` (was General only) | Whish_App / OMT_App / General per line | same | Binance (USDT) / General per line |
| 6 Client propagation | NEW: `clientId` UI → IPC/REST → repo → `createTransaction({client_id})` + `exchange_transactions.client_id` | already propagated; required when an account line exists | same | same |
| 7 CUSTOMER_ACCOUNT | NEW `'Exchange Debt'`, one row per currency; non-USD/LBP owed as USD at the exchange rate | `'Service Debt'` (existing) | `'Service Debt'` | `'Service Debt'`, USDT shortfall as USD |
| 9 Void path | generic: `_reversePayments` negates every line; `_cancelDebt` once `'Exchange Debt'` is in `MODULE_DEBT_TRANSACTION_TYPES`; forgiven part via LIRA-310 `WAIVED_SHORTFALL` reversal | generic, no new code (several inflow rows reverse like one) | same | same |
| 10 Profits | unchanged amounts; counts at once (no debt gate on exchange) — owner check | `Service Debt` holds the profit until repaid (DBT-1), as a fee owed does today | same | same |
| 13 E2E guard | extend `lira-web-022` (delta + identity) | new web e2e needed (none exists) | new web e2e needed | new web e2e needed |
| 15 Legs vs amount | `bookCustomerLegs` refuses overpay, uncovered short, account line without client, forgive over cap, non-drawer methods (GIFT_CARD) — one predicate for check and post | same helper | same | same |
