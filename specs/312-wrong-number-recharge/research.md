# Research: Wrong-Number Card Recharge (LIRA-312)

Phase 0. Two read-only scouts ran on 2026-10-12. No tests were run.

Abbreviations:
- FSR = `packages/core/src/repositories/FinancialServiceRepository.ts`
- TR = `TransactionRepository.ts`
- ER = `ExpenseRepository.ts`

## R1. A card sale cannot be refunded "keeping the cost"

**Finding:**
- A refund or void of a `FINANCIAL_SERVICE` card sale always mirrors the provider cost leg back to the iPick/Katsh drawer. The cost leg is internal (`note` starts `"Cost:"`, TR:387), and `_reversePayments` mirrors every internal leg (TR:7859-7866).
- There is no "keep cost" or partial path for this type.
- Inside a session, a card sale is reversible only with the whole basket. `FINANCIAL_SERVICE` is not in `SESSION_ITEM_REFUNDABLE_TYPES`.

**Decision: "Refund as wrong number" is not a refund.**
- The sale stays exactly as it is. With the redo, it now stands for the correct recharge of the customer's right number: the customer paid for it, and its cost leg is the redo's cost.
- The wrong recharge is booked as a separate wrong-number expense of the same card, paid from the provider balance (R3).

**Money check (Alfa $7.58, cost 770,000, paid 800,000):**

| Row | iPick balance | Cash drawer | Profit / loss |
|---|---|---|---|
| Sale (now = correct recharge) | −770,000 | +800,000 | +30,000 |
| Wrong-number expense (the wasted recharge) | −770,000 | — | −770,000 |
| **Reality** | **−1,540,000** (two recharges sent) | **+800,000** | **−740,000** |

The rows match reality, and the sale is never touched. This also works for a card sold inside a session basket, with no basket reversal needed.

**Alternatives rejected:**
- A new refund mode that keeps the cost leg: it touches the most fragile reversal code (TR `_reversePayments`).
- Voiding the sale and re-selling with no payment: two extra rows and a fake sale.

## R2. Which card was wrong: the sale row does not know

**Finding:**
- A walk-in card sale is ONE row for the whole cart. `buildCatalogSalePayload` puts every item into `note`, and `mobile_service_item_id` and category are not saved.
- The recharged (recipient) number is not stored anywhere. `financial_services.phone_number` is the client's phone.

**Decision:**
- The wrong-number panel always asks the cashier to pick the card: a catalog item of the sale's provider, MTC/Alfa prepaid only, defaulting to the first MTC/Alfa item named in the sale's note.
- It also asks for the wrong number and the right number. Both are stored on the wrong-number record only.
- The sale-row action is offered on `FINANCIAL_SERVICE` rows whose provider is iPick, Katsh or WHISH_APP (from `metadata_json.provider`, the pattern of `isReceiptableRow` in TransactionCells.tsx:449). The carrier is known only after the card is picked.

## R3. The loss = the existing stock-use expense

**Finding:** `ER.createStockExpense` with source KATSH/IPICK/WHISH_APP (ER:662):
- loads the active catalog item and refuses `cost_lbp <= 0`;
- writes an expenses row: `amount_lbp = cost`, `paid_by_method = provider`, with `item_source`/`item_id`;
- writes an `EXPENSE_KATSH`/`EXPENSE_IPICK`/`EXPENSE_WHISH_APP` transaction;
- posts ONE payments leg `-cost_lbp` on the provider drawer;
- lowers net profit through `getExpenseTotals` (`activeExpense()`);
- reverses through the generic void: `_reversePayments` gives the provider balance back and `_markSourceRefunded` flags the expense.

**Decision:**
- Both paths (A: before saving, from Expenses; B: after saving, from the sale row) call ONE service, `WrongNumberService.recordWrongNumber`.
- That service calls `createStockExpense` (category "Wrong number card") and writes a `wrong_number_cards` record linked to the expense's transaction. Path B also links the sale.
- No new money path is added for the loss.

## R4. Credits received: copy the credit buy-back shape, as a new writer

**Finding:** `RechargeRepository.processCreditBuyback` (:1752) writes:
- one transaction;
- `applyMovement({creditsDelta:+X, reason, transactionId})` on the line;
- one USD `+X` payments row on the MTC/Alfa drawer, plus a `_LINE_DRIFT` leg when needed.

Void reverses it all through `_reversePayments` and `_reverseCarrierLineMovements` (TR:9413). It always uses the primary line and needs a payout leg (:1758), so it cannot be reused as-is. `CARRIER_LINE_ADJUSTMENT` cannot be voided, so it is ruled out.

**Decision:** a new transaction type, `WRONG_NUMBER_CREDITS`, written by `WrongNumberService.recordCreditsReceived` through the repository layer, in one DB transaction:
- `applyMovement` on the CHOSEN active shop line of the card's carrier (`carrierLineId`, not only the primary), with `creditsDelta:+X`, reason `WRONG_NUMBER_CREDITS` and `transactionId`;
- a `+X` USD leg on that carrier's drawer, plus the existing drift-correction leg rule;
- `source_table='wrong_number_cards'`, `source_id`.

It is reversible by the generic void. There is no validity change, so no validity LIFO guard applies.

## R5. How recovered credit reduces the loss: an LBP profit stamp

**Finding:**
- An expense can never be negative (ER:337-343).
- Net profit is kept per currency and never combined (ProfitService.ts:1206-1210).
- The loss is LBP (770,000), so a USD recovery would never net against it.
- Precedent: `WARRANTY_COST` is a profit-only row with its own line, `getWarrantyTotals` (ProfitRepository:4461).

**Decision (owner, 2026-10-12):**
- Recovered credit is valued at the shop's **credit sell price**: `telecom_credit_sell_price_lbp`, default 100,000 LBP per $1, set in Settings → Mobile Services as "the price of $1 of resold credit". The card flows already use it for Only-Days returned credit. `alfa_credit_sell_rate_lbp` in Shop Config (same default) is the credit-SALE rate and is not used here. The owner's words: "loss = 1,200,000 − 6$ × 100,000".
- The `WRONG_NUMBER_CREDITS` transaction stamps `profit_lbp = X × sell_rate` and `profit_usd = 0`. The rate used is saved in `metadata_json.credit_rate_lbp`, so a later rate change never rewrites history.
- It gets its own Profits line, "Wrong-number credits recovered", next to expenses. That line goes into `PROFIT_TXN_TYPES` and into a gross-profit LBP term (the WARRANTY_COST pattern).
- Example: a card costing 1,200,000 with $6 back gives a net LBP loss of −1,200,000 + 600,000 = −600,000.
- Void sets the row to VOIDED, and the `status='ACTIVE'` filter drops the stamp.

**Alternatives rejected (owner):** the card-credit cost rate (`telecom_credit_cost_rate_lbp`), and face USD with no LBP netting.

## R6. Undo order

**Decision:**
- Credits entries are voided one at a time.
- Voiding the wrong-number expense is refused while any active credits entry exists: "Undo the credits received first." This is one new guard in `_assertReversible`, keyed on `wrong_number_cards.expense_transaction_id`.
- Voiding the original SALE is unaffected and stays independent. If the owner voids the sale (the correct recharge), the wrong-number record stays, because the wrong recharge really happened.

## R7. Roles

**Finding:** void/refund is admin-only (IPC and REST). Stock-use expense is admin + staff.

**Decision (owner confirmed 2026-10-12):** recording a wrong number and entering credits use admin + staff. Undoing (void) stays admin-only, as today.

## R8. Migration

The latest migration is v211 (LIRA-309). LIRA-312 takes **v212**: the `wrong_number_cards` table. Re-check at build time, because a parallel session may land a migration first. The new IPC channels need classifying in `offline/channelPolicy.ts`: online-only, because these are money writes and rare.
