# Research: Waive on every payment page (LIRA-310)

Three read-only sweeps (2026-10-11) covered the customer-side core, the counterparty-side core, and the UI wiring. File:line references are as of commit `4b869033`.

---

## R1. One cap constant, inclusive, compared in the total's own currency

- **Decision**: Add `SHORTFALL_MAX = { USD: 5, LBP: 450_000 } as const` to `packages/core/src/validators/exchange.ts`, next to `PAYOUT_KEEP_CHANGE_MAX`. Then:
  - Redefine `PAYOUT_KEEP_CHANGE_MAX = SHORTFALL_MAX`, so the name stays for its existing callers but there is one value.
  - Add a pure helper `isWithinShortfallMax(amount, currency)` = `amount <= SHORTFALL_MAX[currency] + tolerance`. It returns false for any currency other than USD and LBP.
  - Both MPI and `resolveKeptChange` use the helper.
- **Rationale**:
  - Owner decisions 2 and 4: one value, $5 / 450,000 LBP, applying both to Waive and to automatic payout kept change.
  - "Up to and including" was confirmed by the owner on 2026-10-11.
  - The payout branch today refuses at `keptInPayout >= cap` (`keptChange.ts:525-532`, strict). That becomes `> cap`.
  - MPI today compares the waive in USD-equivalent (`MultiPaymentInput.tsx:1269-1272`). That becomes the total's own currency, as payout keep already does (`:1224-1232`).
  - The file is browser-safe (rule 29): it is already imported by MPI.
- **Alternatives rejected**:
  - A separate waive constant with the payout cap left at $1: the owner explicitly raised the payout cap.
  - A USD-equivalent comparison: the owner stated an LBP figure (450,000), and the rate drifts.
- **Consequence**: these tests pin the old cap and are updated deliberately in the same change:
  - core: `keptChange.test.ts:257-303, :810`; `ExchangeRepository.keptChange.test.ts:345-355, :495-505`; `RechargeRepository.payoutKeptChange.test.ts:276-284, :340-348`; `TransactionRepository.refundKeptChange.test.ts:401-409`; `SalesRepository.refundItemKeptChange.test.ts:396-406`; `FinancialServiceRepository.receiveKeptChange.test.ts:352`; `HoldMoneyRepository.keptChange.test.ts:180-183`
  - frontend: `MultiPaymentInput.payoutKeepChange.test.tsx:72-172`; `RefundMethodModal.refundWording.test.tsx:63, :71`; `MultiPaymentInput.test.tsx:504-573`
  - These are **behaviour changes** the owner asked for, not regressions. Each updated case must be shown failing against the old constant (rule 17: new boundary cases written first).

## R2. MPI: the Waive button itself

- **Decision**:
  1. Gate every waive on `!isPayout`. The existing gap: a waive button can sit next to "Change kept (profit)".
  2. **Built-in waive**: when no `onWaiveRemaining` is passed, the internal discount is visible and lowers the total, and the page books it (`!!onDiscountChange`), the click sets `discountRaw` to `clampedDiscount + shortfall`. The value is converted into `discountCurrency` and rounded **up** (LBP whole; USD to cents; 4 dp when a USD discount sits against an LBP total). Remaining must reach 0 without crossing into change.
  3. **External waive** (`onWaiveRemaining`): MPI rounds the shortfall to the total currency's precision and calls `onWaiveRemaining(amount, remainingByCurrency)`. The second argument comes from the same `allocatePayments(...).remaining` call `prefillAmountFor` already uses (`:635-644`). Debts and Session need the per-currency split.
  4. **Ceiling**:
     - Built-in: hide when `maxDiscount !== undefined && clampedDiscount + shortfall > maxDiscount + matchTolerance`.
     - External: new optional prop `waiveRemainingMax` (room left in the page's own discount). Hide when `shortfall > waiveRemainingMax + matchTolerance`.
  5. **Threshold**: the default becomes `SHORTFALL_MAX[totalAmountCurrency]`. The `waiveRemainingThreshold` prop is kept but is now in the total's currency. No caller passes it today, so this is safe.
  6. **Waive follows Remaining** (owner decision 2026-10-11): Waive lives inside the Remaining row and shares every one of its visibility rules. When Remaining is hidden, Waive is hidden too. That includes the auto-debt case: with `autoDebtRemainder` and a client attached, the shortfall becomes an automatic CUSTOMER_ACCOUNT line and Remaining does not show (`:1085-1176`), so Waive does not show either. There is no separate Waive on the account line.
- **Rationale**:
  - The owner rejected a second waive path ("this creates multiple scenarios").
  - The single-line auto-sync (`:700-726`) returns early once the cashier types an amount, so a waive is never undone by a refill. Verified by reading.
- **Known pitfall, not fixed here**: discount currency auto-sync (`:656-661`) re-reads `discountRaw` without converting when the line currency flips. This is pre-existing. A waive followed by a currency flip shows the same oddity as a typed discount does today. It is logged in tasks as a follow-up candidate, not in scope.
- **Alternatives rejected**:
  - A controlled discount prop on MPI: it touches the 11 MPI suites and every caller.
  - Folding waive into kept change: different sign and different meaning.

## R3. Group A page wiring (no server change)

| Page | Mechanism | Ceiling |
| --- | --- | --- |
| Recharge PaymentSheets (6) | built-in: they already pass `showDiscount` + `maxDiscount` + `onDiscountChange` (`PaymentSheet.tsx:255-290`) | `maxDiscount` = margin (`rechargeDiscount.ts:34-40`) |
| Suppliers Pay | built-in (`Suppliers/index.tsx:2712-2714`) | `maxDiscount = |payAmount|` |
| POS / Maintenance | external → `setDiscount(d => min(d + amt, maxDiscount ?? ∞))`, `waiveRemainingMax = maxDiscount − discount` | Maintenance USD: labour; POS: none |
| Debts repay | external → add `remainingByCurrency` USD to `repayDiscountUsd`, LBP to `repayDiscountLbp` | `applyDebtDiscount` already caps at due per currency |
| Partners settle | external → `setDiscountAmount(parsedDiscount + amt)` | discount + gap = room exactly (`settlementDiscount.ts`) |
| Expenses | external → `setBillAmount(bill − amt)` | none (the bill is just lowered) |
| Custom Services | built-in discount made real: pass `onDiscountChange` + `maxDiscount = max(0, price − cost)`, and send `price − discount` as the price | price − cost |

- **PaymentSheet** forwards `onWaiveRemaining`, `waiveRemainingThreshold` and `waiveRemainingMax`. **CounterpartySettleModal** spreads its MPI bag (`:152`), so it needs no change.
- **Custom Services**: the server reconciles against the price sent (`CustomServiceRepository.ts:369-385`), so sending the lowered price is consistent. Profit = price − cost + kept (`:542-543`). The price field is already editable, so this adds no new authority.

## R4. Customer-side Group B: `resolveKeptChange` gains a "reduction" claim

- **Decision**:
  - Extend the customer branch of `resolveKeptChange` (`keptChange.ts:346-396`) with an optional `claimedReduction: { usd, lbp }` and `reductionCap: { usd, lbp }`. It returns `reductionUsd/reductionLbp`.
  - Rules:
    - Refuse when the reduction is > 0 and any of these hold: kept > 0; any OUT leg; `isForPartner`; no IN legs.
    - Reconcile against `expected − reduction`, the same way the payout branch lowers its target (`:546-558`).
    - The claim must equal `expected − (IN − OUT)` per currency within `KEPT_CHANGE_ROUNDING_TOLERANCE`, using the exact-match pattern at `:616-625`.
    - The reduction must not exceed `reductionCap` per currency.
- **Loto ticket** (`lotoSellSchema`, `LotoTicketRepository.createTicket`):
  - New fields `discount_usd`, `discount_lbp`: the owner's "make the Discount work", which the Waive fills.
  - Cap = commission, converted at the tender rate. The UI Waive is also bounded by `SHORTFALL_MAX`.
  - Migrate the raw `reconcileLegs` at `:282-293` to `resolveKeptChange`. This also closes the missing kept-change excess/funding checks that Loto never had.
  - Profit: `profit_usd = kept_usd − discount_usd`, `profit_lbp = commission + kept_lbp − discount_lbp`. Record `metadata_json.discount_usd/lbp`.
  - Unchanged: `amount_lbp` (face value) and the LOTO supplier TOP_UP (`sale − commission`, `:583-605`).
  - Refuse a discount under `deferPayment` (session cart): the basket waive owns that case.
  - `ProfitRepository` `lotoKeptChange*` fragments (`:1347-1357`) subtract the stored discount, so the discount never reads as negative kept change.
- **Session checkout** (`sessionCheckoutSchema`, `SessionCheckoutService.checkout`, `SessionPaymentService.recordBasketPayment`):
  - New fields `waived_usd`, `waived_lbp`.
  - `resolveBasketKeptChange` runs when kept **or** waived is claimed. Expected = `basketNetCharge`; cap = `SHORTFALL_MAX`.
  - Booked as a new sibling row type `WAIVED_SHORTFALL`: amount 0/0, `profit_usd/lbp = −waived`, linked with `linkTransaction(sessionId, "waived_shortfall", …)`, `client_name` stamped like KEPT_CHANGE.
  - Every KEPT_CHANGE classification site gains the new type:
    - `transactionTypes.ts` (constant; NON_REVERSIBLE; SESSION_BASKET_BYPASSABLE; item-refund exclusion)
    - `sessionPayoutMember.ts:71`, `profitRowClass.ts:71`, `postingRules.ts` (`no-money`), `profitModuleDetailSupport.ts:33`
    - `cashFlow.ts:60`, `transactionText.ts:105`
    - `ProfitRepository` KEPT_CHANGE branches `:1975-1980, :2114, :2706, ~:8675-8710`
  - Reversal owner: `voidSessionBasket` / `refundSessionBasket`, which already loop over linked members. No new reversal code.
- **Rationale**:
  - Profit lowered inside the transaction's own stamp is what the generic void/refund already negates (FEATURE_GUIDE §4.1). A basket has no single stamp, so it gets a sibling row, exactly as KEPT_CHANGE does.
  - A reduction never touches what LOTO, a partner or a supplier is owed (FR-006).
- **Alternatives rejected**:
  - Reuse KEPT_CHANGE with a negative profit: this muddles the "kept change" bucket and its labels.
  - Lower the Loto face value: this changes the commission and the amount owed to LOTO.

## R5. Counterparty-side Group B: bundled supplier DISCOUNT, both directions

- **Decision**: extract `_postSupplierDiscount` (`SupplierRepository.ts:5589-5675`) into one shared writer, `postSupplierBundledDiscount`, that takes:
  - `direction: "received" | "forgiven"`:
    - received: ledger −x, profit +x;
    - forgiven: ledger +x, profit −x.
  - `parentLedgerId` (sets `source_ref_*`)
  - `applyPurchaseCoverage` (false for settlements)
  - `settlementId?` (self-stamp, with a `.changes` check)
  - Supplier cashflow keeps calling it as `received` with coverage, so its behaviour is unchanged.
- **Account settle** (`supplierSettleAccountSchema`, `settleAccount`):
  - New field `discount?: counterpartyDiscountInput`.
  - Direction: PAY → received, COLLECT → forgiven.
  - Refused when combined with surplus, when no cash is owed, or when the discount is above `SHORTFALL_MAX`.
  - Legs reconcile per currency against `total − discount`.
  - The anchor member's neutralizer is reduced by the discount, capped at the anchor's net in that currency (this avoids `resolveEntry`'s opposite-sign throw). The DISCOUNT row is self-stamped with the settlement's `settlement_id`, so `getAccountUnsettled` never lists it.
- **Batch settle** (`supplierSettleSchema`, `settleTransactions`):
  - New field `discount?`, received only.
  - Refused for bills-only batches, OTHER_PAYMENT mode, `!owesCash`, and above the cap.
  - Legs reconcile against `amount − discount`. SETTLEMENT row = −(amount − discount). The DISCOUNT row links `source_ref_id` to it and is self-stamped.
- **Reversal (rule 20)**:
  - Widen `_linkedSupplierDiscount` (`TransactionRepository.ts:6553`) to accept `SUPPLIER_SETTLEMENT` parents.
  - Skip `_giveBackSupplierPurchaseCoverage` for settlement parents.
  - Relax `_assertSupplierBundledDiscountVoidable` when the discount's `settlement_id` belongs to the parent's own settlement.
  - Void and refund of SUPPLIER_SETTLEMENT then sweep the bundled discount (ledger soft-void + negated profit), matching the partner LIRA-085 behaviour.
- **LOTO settlement** (`lotoCheckpointSettleSchema`, `lotoCheckpointsSettleBatchSchema`, `settleCheckpoint(s)`):
  - New field `discount_lbp?`.
  - Direction: net < 0 (the shop pays LOTO less) → received; net > 0 (LOTO pays the shop less) → forgiven.
  - Legs reconcile against `|net| − discount`. The SETTLEMENT row = net ∓ discount. The insert id is captured and used as the DISCOUNT's parent.
  - **Non-reversible**, like LOTO_SETTLEMENT itself (`transactionTypes.ts:444`). The correction path is an opposite supplier adjustment. Documented in FEATURE_GUIDE §9.
- **Plumbing**:
  - Preload inline types for settle (`preload.ts:827-863`) and settle-account (`:870-896`), and `electron.d.ts:2029, :2069`, are hand-written. The new key is added there (rules 12, 23). The full rule-21 rewrite of those hand-written types is out of scope and listed as debt.
  - `SettleAccountRequest` (`useSuppliers.ts:611-641`) is hand-written as well: same treatment.
  - All five settle channels are **ONLINE_ONLY** (`channelPolicy.ts:205-207, :246-247`), so no offline binding is needed. `onlineOnlyExempt.ts` gains the shared discount writer, because it uses `datetime('now')`.
- **Alternatives rejected**:
  - A standalone COUNTERPARTY_DISCOUNT after the settlement: it is non-reversible, so it breaks rule 20.
  - Leave the settlement ledger row at the full amount: the balance would end at ±discount instead of 0.

## R6. Offline replay (LIRA-306)

- `loto:sell` (`channelPolicy.ts:107`) and `session:checkout` (`:133`) are offline channels. Their bindings already pass the schema-parsed payload, but the fixtures gain the new fields so `bindings.complete` exercises them:
  - `offline/bindings/loto.ts:23-40` casts to `SellTicketData`, so it gains the type.
  - fixtures `loto.ts:6-23`, `sessions.ts:59-66`.
- The ids are unchanged, so there is nothing new to rewrite.

## R7. Verification constraints

- Desktop Electron e2e must not run on this Mac (owner standing rule). Proof uses:
  - core jest (create + void/refund nets to 0 per ledger per currency, failing-first);
  - frontend jest (MPI boundary cases, page wiring);
  - web e2e (`frontend/tests/e2e-web/lira-web-*`).
- The existing Electron S55 POS-waive spec (`CheckoutModal.spec.ts:339-378`) stays valid and runs in CI.
