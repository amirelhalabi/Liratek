# Research: LIRA-365 — Discount wherever a customer pays the shop

The Note part (R10–R12) moved to `specs/366-payment-note/research.md`.

Code read on 2026-10-31. Paths are repo-relative. Line numbers are approximate and drift.

## R1. How the page gets the discount

- **Decision**: Use `MultiPaymentInput`'s existing Discount line (`showDiscount`, `maxDiscount`, `onDiscountChange`). The page keeps its own copy of the emitted amount and sends it as an explicit payload field, checked again on the server. This is the Loto pattern (`Loto/index.tsx` ~729, `LotoTicketRepository.ts` ~338-375).
- **Rationale**: `onDiscountChange` emits one number already converted to the total's currency and clamped to `maxDiscount` (`MultiPaymentInput.tsx` ~1018-1035, ~1181). For OMT/Whish and vouchers the server must write an expense for exactly that amount, so it needs the figure itself. It cannot get it from a fee folded on the client.
- **Alternatives rejected**:
  - Fold the discount into the fee on the client, as the OMT/Whish App form does (`walletTransfer.ts` ~322-358). This would change what is owed to OMT and the commission, which the spec forbids (FR-003). It also leaves the server nothing to book the expense from.

## R2. One cap for Discount and Waive

- **Decision**: Pass `maxDiscount` = the shared cap `SHORTFALL_MAX` (`validators/exchange.ts` ~27) in the total's currency. The server checks `discount + waived ≤ cap` with the existing `isWithinShortfallMax`.
- **Rationale**: The built-in Waive already writes into the same discount field and checks `clampedDiscount + waiveShortfall <= maxDiscount` (`MultiPaymentInput.tsx` ~2040-2047, ~2086-2101). One cap gives one rule (rule 14).

## R3. OMT/Whish system SEND booking

- **Decision**:
  - Add `discount_amount` (≥ 0, in the send's currency) to the financial create schema.
  - `FinancialServiceRepository` subtracts it from `totalCustomerPays` before `reconcileLegs` (~4944-4990). What is owed to OMT/Whish, the fee and the commission are untouched.
  - After the transaction is written, it books a books-only auto expense "Discount given", linked by `source_ref_table/source_ref_id`.
  - Accepted only on provider OMT/WHISH, serviceType SEND, not `partnerMode: "FOR"`, not `deferPayment`.
  - It must be less than what the customer pays: `amount + fee`, or `amount` when "Fee included in amount" is ticked.
- **Rationale**:
  - The drawer already receives the lower amount through the legs. The expense must therefore move no drawer (books-only), or the $2 would leave the drawer twice.
  - `changeRoundingExpense.ts` (~46, ~69-103) is the exact template: books-only, linked to its parent, voided with it.
  - `ExpenseRepository.createExpense` derives `is_auto` from `source_ref_table` (~668), so rule 26 holds without a hand-set flag.
- **Alternatives rejected**:
  - A WAIVED_SHORTFALL sibling (`forgivenShortfall.ts`). It books negative profit, but the owner asked for an expense, so the cost shows on the Expenses page.
  - A drawer-moving expense. It double-counts the drawer.
- **On account**: when part of the send is charged to the customer's account, the debt is the discounted amount still owed. This needs no extra rule because reconcile runs on the discounted total.

## R4. Exchange booking

- **Decision**: On Exchange, "Discount" on the customer-pays (IN) sheet is booked through the existing forgiven-shortfall path (`customer_waived_amount`, which becomes a WAIVED_SHORTFALL sibling with profit equal to minus the amount, `ExchangeRepository.ts` ~208-218, ~818-851). The sheet's Discount line feeds the same field. No new server concept is added.
- **Rationale**:
  - Exchange already has Forgive under the same cap. A second mechanism that lowers profit by the same amount would duplicate it (rule 14).
  - The sibling is already reversed by the generic void (step 5c3), and its negative profit lowers that day's profit by exactly the discount. That meets FR-005 for the shop's profit. The exchange row's own stamp is unchanged.
- **Owner decision 2026-10-31**: the counter-flow Forgive button (`MultiPaymentInput.tsx` ~2927-2945, `counter-flow-forgive`) becomes the standard `DiscountLine` (`DiscountLine.tsx`, under "Total Amount", typed amount, "Capped to max" note, no Extra switch). It is the same everywhere counter-flow is used (Exchange, Whish App, OMT App, Binance cash-outs). The typed amount feeds `customer_waived_amount` as Forgive does, so the booking, the cap (`maxForgive`) and the reversal are unchanged. Forgive filled the whole gap with one tap; the Waive button keeps that one-tap path by writing the gap into the line.
- **Alternatives rejected**:
  - Subtracting from the exchange's FIFO lot profit (~549-568). This mixes currencies inside lot accounting and gives the void path a second reversal to own.

## R5. Voucher sale booking (revised after review)

- **Decision**:
  - Add `discount_amount` (in the sale currency) to `voucher.ts`.
  - The VOUCHER_SALE **transaction amount is what was actually paid** (face value − discount). The voucher record keeps its face value.
  - `sellVoucher` reconciles legs against face value − discount and books the books-only "Discount given" expense linked to the voucher.
  - `cancelWithRefund` calls `voidLinkedExpenses`. VOUCHER_SALE is in `NON_REVERSIBLE_TRANSACTION_TYPES`, so vouchers own their reversal.
- **Rationale**:
  - The sale amount is read in several places: `utils/cashFlow.ts`, `utils/clientDebtDetails.ts`, `utils/transactionText.ts`, `constants/postingRules.ts`, and the audit presentation in the frontend.
  - Keeping it at face value would make every one of them over-count a discounted sale.
  - With amount = paid, `findSaleTotals` (`VoucherRepository.ts` ~605-623) already refunds the right cash ($48), with no special case.
  - Every reader that needs the face value must read it from the voucher record. A task checks each reader listed above.
- **Rule 20**: reversal owner = `cancelWithRefund`. Test: sale + cancel nets to 0 on drawer, debt and expenses, per currency.

## R6. Expense category

- **Decision**: A new constant `DISCOUNT_GIVEN_EXPENSE_CATEGORY = "Discount_Given"` next to `CHANGE_ROUNDING_EXPENSE_CATEGORY`, plus a label in `expenseCategoryLabel.ts` (en + ar).
- **Rationale**: `expenses.category` is free text with no CHECK (`create_db.sql` ~1110), so **no migration** is needed.

## R7. Void and refund

- OMT/Whish send: the generic void and refund already cascade expense siblings (`TransactionRepository._cascadeExpenseSiblingVoid` ~8793, called ~6382 and ~7106). Payment-leg reversal returns the $413 actually paid. No new reversal code; a test proves it nets to 0.
- Exchange: the generic void reverses the WAIVED_SHORTFALL sibling (step 5c3). No new code.
- Voucher: `cancelWithRefund` (R5).

## R8. Transaction details

- **Decision**: Fill the common `details.discount {amount, currency}` (`validators/transactionDetails.ts` ~56-61) in `buildOmtWhishTransferDetails`, `buildExchangeDetails` and `buildVoucherDetails`.
- **Rationale**: The viewer is generic and shows the key automatically (`transactionDetailsView.ts`, `TransactionDetailsPanel.tsx`), and Loto already does this (~78-80).

## R9. Session basket

- OMT system send in a session goes through `addToSessionCart` with `deferPayment` (`Services/index.tsx` ~1492-1556), and the repository skips reconcile. **Decision**: no discount there; the basket checkout's Waive covers it. The server refuses `discount_amount` with `deferPayment`, as Loto does.
- Exchange posts immediately and only links to the session. A discount works there as on a walk-in exchange.

