# Research: Exchange — customer account both ways, payment window for every currency (LIRA-369)

Code facts below were read from the source on 2026-11-01 (file:line as of that day). Nothing was run.

## Today, in the code

| Area | Where | What it does now |
|---|---|---|
| Window gate | `frontend/src/features/exchange/pages/Exchange/index.tsx:790` | `canSplitPayout = !forPartner && (toCurrency USD/LBP)`. Otherwise Confirm calls `handleProcess()` directly. |
| Payout methods | same file, `paymentMethods` on `PaymentSheet` | CASH only. |
| Customer-side account | same file, `customerCanOwe` | Offered only when `fromCurrency` is USD/LBP. |
| Payout guard | `ExchangeRepository.ts` ~:901 | Throws "A split payout requires a USD or LBP target currency". |
| Payout method guard | `ExchangeRepository.ts` ~:916 | Throws for every non-drawer leg. The comment "exchange_transactions does not carry client_id" is stale: `clientId` exists since LIRA-321. |
| Payout reconcile | `moneyPosting.ts` `expectedTotalIn`, `sumLegsByCurrency`, `reconcileLegs` | USD/LBP only. An EUR leg throws `payment leg currency "EUR" is not USD or LBP — cannot reconcile`. |
| Customer-side booking | `moneyPosting.ts:1507` `bookCustomerLegs` | Already folds ONE non-USD currency into USD (`amount * rate`). It is blocked only by `exchangeCustomerCanOwe` (`validators/exchange.ts:100`, `:156-166`; `ExchangeRepository.ts` `_assertCustomerPaysShape`). |
| Client credit writer | `DebtRepository.addCredit` → `CREDIT_DEPOSIT` (negative row); `DebtService.addCreditOrThrow` for money flows | Used by repayment return legs and by POS. |
| Lots | `ExchangeRepository._applyExchangeLotEffects` (~:1322) | Acquires the full `amountIn` and consumes the full `amountOut`. It is called before any leg is booked. |
| Void/refund | `TransactionRepository._cancelDebt` | Scans `MODULE_DEBT_TRANSACTION_TYPES` (includes `'Exchange Debt'`) plus `CREDIT_DEPOSIT` by `transaction_id`. `_reverseExchangeLotEffects` voids lots by source, whatever their quantity. |
| Rate box | `MultiPaymentInput.tsx` ~:3030 | Hard-coded "1 USD = … LBP". There is no currency-pair prop. |
| Debt repayment | `validators/debt.ts`, `DebtRepository.addRepayment` | Clears USD/LBP only. EUR legs are ignored in the totals, so EUR repayment goes through an Exchange (spec, Edge Cases). |

## Decisions

### R1 — The window opens for every walk-in exchange

- **Decision**:
  - `canSplitPayout` becomes `!forPartner`.
  - A non-USD/LBP payout (the "native" mode) offers CASH in the target currency plus CUSTOMER_ACCOUNT.
  - The USD/LBP mode is unchanged, plus CUSTOMER_ACCOUNT.
  - Keep-change, round-up and added change stay USD/LBP-only. They are hidden in native mode and refused by the schema there.
- **Rationale**: owner decision (FR-001, FR-004). It removes the one-click path that skipped the client and account choices.
- **Alternatives**: a second, simpler EUR window. Rejected: two windows for one operation drift apart (rule 22).

### R2 — Payout to the account = `CREDIT_DEPOSIT` linked to the exchange

- **Decision**:
  - In the payout leg loop, a CUSTOMER_ACCOUNT leg calls `DebtService.addCreditOrThrow({ clientId, amountUsd | amountLbp, transactionId: txnId, note })` instead of moving a drawer.
  - It never touches a drawer and never writes a `payments` row with a drawer.
  - USD and LBP legs are credited in their own currency. A non-USD/LBP leg is credited in USD (R4).
- **Rationale**: this reuses the one credit writer. `_cancelDebt` already reverses `CREDIT_DEPOSIT` by `transaction_id`, so rule 20 is met with no new reversal code. `postPayoutLegs` (`moneyPosting.ts` ~:1030) has the same per-leg branch as precedent.
- **Alternatives**:
  - An OUT CUSTOMER_ACCOUNT leg. Rejected: exchange payouts refuse OUT legs, and these legs are payout (IN-shaped) legs.
  - A new `'Exchange Credit'` type. Rejected: the client statement and void already know `CREDIT_DEPOSIT`.

### R3 — Reconcile in native mode

- **Decision**:
  - Add one predicate-driven helper `reconcileNativeLegs({ legs, currency, expected })`.
  - Every leg must be in the target currency, with method CASH or CUSTOMER_ACCOUNT.
  - The legs must add up to `amountOut` in that currency, within the currency's rounding tolerance.
  - USD/LBP targets keep `reconcileLegs` exactly as today.
  - The same predicate ("counts toward the payout") feeds both the guard and the posting loop (FEATURE_GUIDE §13 item 15).
- **Rationale**: `reconcileLegs` is USD/LBP-native by design. Teaching it EUR would touch every money module.
- **Alternatives**: convert EUR legs to USD and call `reconcileLegs`. Rejected: it compares at the USD/LBP sell rate, which is meaningless for EUR.

### R4 — Converting a non-USD/LBP account line to USD

- **Decision**:
  - Two optional schema fields: `customer_account_usd_rate` (customer side, `fromCurrency`) and `payout_account_usd_rate` (payout side, `toCurrency`).
  - Meaning: "1 <currency> = X USD", X > 0.
  - Required exactly when that side has a CUSTOMER_ACCOUNT line in a non-USD/LBP currency. Refused otherwise, so no key is accepted and then ignored (rule 23).
  - Credited/charged USD = `round2(amount × rate)`. It is stored as a plain USD amount and never recalculated (FR-014).
  - Customer side: the typed rate replaces `_customerPaysUsdRate` for the account fold in `bookCustomerLegs`. That function already uses `amount * rate` for a non-LBP currency, which is the same convention.
- **Rationale**: owner decision 2026-11-01 (typed rate, fixed USD).
- **Alternatives**: reuse `tender_exchange_rate`. Rejected: it means USD→LBP, and a second meaning on one key is a drift trap.

### R5 — Seed for the typed rate (owner-confirmed 2026-11-01)

- **Decision**: seed with the exchange's own per-unit USD value of that currency:
  - direct trade: `amountIn/amountOut` or `amountOut/amountIn`;
  - cross trade: the USD notional ÷ quantity.
  The cashier can change it.
- **Rationale**: putting the payout on the account gives the customer exactly the USD they paid.
- **Alternatives**: the shop's configured buy/sell rate. Rejected by the owner after the scenarios: it charges the shop's margin again without any EUR moving, and twice if the customer later collects the euros.

### R6 — Lots and margin (Q1 = option A)

- **Decision**:
  - The lot quantity counts only what physically moves:
    - acquire: `amountIn` − the customer-side account lines in `fromCurrency`;
    - consume: `amountOut` − the payout account legs in `toCurrency`.
  - Unit cost and proceeds stay at the trade's per-unit price.
  - The legs are measured before `_applyExchangeLotEffects` runs, which means moving validation/measurement ahead of the call at ~:557.
  - **Typed rate ≠ seed**: the difference for the account part of quantity `q`, trade per-unit USD value `t` and typed rate `r` is `±q·(t − r)`. It is folded into this exchange's margin (leg1 for a direct trade, leg2 for a cross trade). With the seed it is 0.
  - There is no separate "conversion profit" anywhere.
  - USD/LBP account lines have no conversion.
- **Void**: `_reverseExchangeLotEffects` voids lots by source, so the reduced quantity reverses unchanged. A refund negates the stamped margin as today.

### R6b — When the margin counts (owner 2026-11-01: option A, "all waits")

- **Decision**: the exchange arm of `ProfitRepository` gets the existing `notDebtPending(<exchange's transactions.id>)` gate. While any `'Exchange Debt'` linked to the exchange is still open, the margin is reported as pending, the same as Recharge and OMT/Whish rows.
- **Existing plumbing**:
  - `'Exchange Debt'` is already in `MODULE_DEBT_TRANSACTION_TYPES`, and therefore in `SERVICE_DEBT_COVERAGE_TYPES`.
  - Repayments already FIFO-cover it (`DebtRepository._coverServiceDebtsFIFO`), and its rule-20 mirror unwinds that coverage on a repayment void.
  - So the only change is applying the gate. The comment at `ProfitRepository.ts` ~:535 ("exchange carries no debt_ledger link") is stale since LIRA-321.
- **Rule 14**: reuse `notDebtPending`. Never copy its predicate. Every exchange read (totals, By Module drill-down, by-user, pending) goes through the same fragment.
- **Which day it counts on** (owner 2026-11-01): the exchange's own date. Once paid, the released margin shows under the day the exchange was recorded, the same as the other modules. No new dated event.
- **Scope**: this also changes existing USD/LBP exchanges paid on account. Their margin moves from "counted" to "pending" until they are repaid. A release note says so.

### R7 — Note snapshot (rule 31)

- **Decision**:
  - The debt/credit note for a converted line is `"<amount> <CUR> @ <rate> = $<usd>"`, appended to the exchange summary.
  - The transaction details store `accountConversion: [{ side, currency, amount, rate, usd }]`.
  - Both are a **snapshot at saving time**, labelled as such where they are read. Edits to the exchange do not re-convert.
- **Rationale**: FR-008 and FR-014. Rule 31 requires naming the copy's update owner; here it is "none, snapshot".

### R8 — Loss confirmation on the window path

- **Decision**: when the target currency is lot-tracked and the lot preview shows a loss, the window's Confirm shows the existing `showLossConfirm` dialog before `handleProcess(lines)`. Today that check runs only on the direct path, which this change removes.
- **Rationale**: spec US1 scenario 6. Removing the direct path must not drop the safety check.

### R9 — Schema changes (rule 23 three-way diff)

- **Decision** (`validators/exchange.ts`, `exchangeSubmitSchema` and `createExchangeSchema`):
  - Drop the account half of the `exchangeCustomerCanOwe` refine. Forgive/discount stays USD/LBP.
  - Add a native-mode payout refine: leg currency = `toCurrency`, method ∈ {CASH, CUSTOMER_ACCOUNT}, no kept/round/added/`tender_exchange_rate`.
  - Any CUSTOMER_ACCOUNT leg on either side requires `clientId`.
  - Add the two rate keys with their required/refused refines.
  - Diff the schema against the `preload.ts` exchange type and against `CreateExchangeData`, and add the new keys to all three.
  - `ApiAdapter` derives its payload type from the schema (rule 21).

## Risks

- `_applyExchangeLotEffects` runs before the legs are measured today. Reordering it is the riskiest change. Guard it with lot and void tests first (`TransactionRepository.exchangeLotReversal`, `ExchangeRepository.lotSettlement`).
- LIRA-365 replaces Forgive with Discount in the same counter-flow box. Whichever lands second rebases. There is no overlap in core, because the discount uses `customer_waived_amount`.

## §13 walk (T001)

Read from `docs/FEATURE_GUIDE.md` §4, §5, §9, §10, §13 on 2026-11-01. Nothing was run.

1. **Schema/plumbing**: no migration (no new column or table). Two new schema keys (R4, R9) carried through the one `exchangeSubmitSchema` on both transports; preload + `electron.d.ts` now use the derived `ExchangeSubmitPayload` (see T002 below).
2. **Transaction row**: same `EXCHANGE` row; `client_id` from `clientId`; profit stamped as today, minus/plus the R6 rate difference; details gain `accountConversion` (R7 snapshot).
3. **IN/OUT badge**: unchanged — `EXCHANGE` already classified; no new transaction type.
4. **Payment legs**: customer side through `bookCustomerLegs` (§4.3); payout legs are IN-shaped payout legs, OUT legs still refused; one "counts toward the payout" predicate feeds both `reconcileNativeLegs` and the posting loop (R3).
5. **Drawers**: CASH legs move the drawer of their own currency (native mode: the target currency's drawer); CUSTOMER_ACCOUNT legs move no drawer and write no drawer `payments` row (R2).
6. **Client propagation**: `clientId` UI → payload → handler (whole validated payload) → service → repo → `client_id`; required whenever either side has an account line (R9).
7. **CUSTOMER_ACCOUNT**: customer side = `'Exchange Debt'` in any `fromCurrency` (non-USD/LBP folded to USD at `customer_account_usd_rate`); payout side = `CREDIT_DEPOSIT` via `DebtService.addCreditOrThrow`, linked by `transaction_id`, USD at `payout_account_usd_rate` when non-USD/LBP (R2, R4).
8. **Supplier/partner ledger**: none touched. For Partner keeps today's path (window stays closed for it, R1).
9. **Void path**: generic. `_cancelDebt` reverses both `'Exchange Debt'` and the linked `CREDIT_DEPOSIT`; `_reverseExchangeLotEffects` voids the reduced lots by source; refund negates the stamped margin. Prove create + void nets to 0 per currency on drawers, debt ledger and lots.
10. **Profits**: margin stamped per exchange; the exchange arm of `ProfitRepository` gains the shared `notDebtPending` gate (R6b) — pending while an `'Exchange Debt'` on it is open, counted on the exchange's own date once paid; also changes older account-paid USD/LBP exchanges (release note).
11. **Sessions**: same page, same single payload builder (rule 22); the window and account behave the same inside a session (spec Edge Cases). Likely, based on the page reading: no separate session literal for exchange — confirm when the page change lands.
12. **Audit viewer**: no new type; `CREDIT_DEPOSIT` and `'Exchange Debt'` already have labels on the client statement; the converted note text is the snapshot from R7.
13. **E2E guard**: delta + identity per rule 15 (EUR drawer −60, client −$44 with note, EUR lot −60, void → back), failing-first (rule 17).
14. **Item 14 invariant**: one obligation, one owner — the account part lives only in `debt_ledger` (debt or credit); it never also moves a drawer or a lot. Worked check for the contract example (to be proved by the test, not yet run): USD drawer +110, EUR drawer −60, client credit $44, EUR lots −60 at unit cost c ⇒ margin = 110 − 44 − 60·c (with the seeded rate, R6 difference = 0).
15. **Item 15 reconcile**: native mode reconciles legs against `amountOut` in `toCurrency` (R3); USD/LBP mode keeps `reconcileLegs`; the guard and the posting loop share one predicate.
16. **Back-timed (item 16)**: unchanged — `ExchangeRepository` already calls `resolveBackTimedDrawerMovement`; account legs move no drawer, so they add nothing to resolve.

## Rule 23 key diff (T002)

Compared 2026-11-01: (a) `exchangeSubmitSchema` (+ `createExchangeSchema`, which shares `keptChangeFields`/`customerPaysFields`), (b) the `exchange.addTransaction` type in `electron-app/preload.ts` and `frontend/src/types/electron.d.ts`, (c) `CreateExchangeData` in `ExchangeRepository.ts`.

| Key | (a) schema | (b) preload (before) | (b) electron.d.ts (before) | (c) CreateExchangeData |
|---|---|---|---|---|
| `customer_account_usd_rate`, `payout_account_usd_rate` | yes | **missing** | **missing** | yes |
| `typedNote` (LIRA-366) | yes | **missing** | **missing** | **missing** — accepted, never read (rule 23 reverse; LIRA-366 owns it) |
| `leg1RateOverridden`, `leg2RateOverridden`, `clientPhone` | yes | yes | **missing** | yes |
| all other keys (legs, profits, currencies, partner, `payments`, `tender_exchange_rate`, kept/rounding/added, `clientId`, `customerPayments`, `customer_waived_amount`) | yes | yes | yes | yes |

Fix: both hand-written types replaced by `ExchangeSubmitPayload` (`z.input<typeof exchangeSubmitSchema>`, exported via the validators barrel from both `index.ts` and `browser.ts`), so (b) can no longer drift from (a). Transport check: the IPC handler validates with `ExchangeTransactionSchema` (= core `exchangeSubmitSchema` re-exported with the zod-major cast, not a local copy) and forwards the whole `v.data`; the REST route uses `validateRequest(exchangeSubmitSchema)` (which replaces `req.body` with the parsed value) and forwards the whole `req.body`. Neither picks fields. The adapters (`backendApi.ts`, `ElectronApiAdapter.ts`, `ApiAdapter` in `packages/ui/src/api/types.ts`) were already typed with `ExchangeSubmitPayload` from `@liratek/core`.

Note: R7 above says `account_conversion`; the code uses `accountConversion` (`ExchangeRepository.ts`, `validators/transactionDetails.ts`).
