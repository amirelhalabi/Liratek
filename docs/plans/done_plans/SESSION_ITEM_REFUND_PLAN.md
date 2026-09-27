# Session basket — single-item refund (plan)

**Status:** DONE 2026-09-27 (verified: full suites, desktop and web e2e; not yet committed). Owner answered all 4 questions on 2026-09-26 (§9).
Ticket: **LIRA-232**.
**Source:** owner item #9 of the 2026-09-26 list, plus the owner's own test of Sale #4 / Session #1 (below).
**Depends on:** LIRA-231 (POS refunds use the payment form; session-paid sales BLOCKED). This plan
replaces that block with the proper flow.

---

## 1. Why this exists — what the owner saw

The owner started Session #1 for **amir**, sold 3 inventory items (iPhone $1,500, "test" $120, "testpart"
$15 = **$1,635**), checked the basket out **on amir's account**, then refunded the iPhone from the POS
sale screen ("Refund item"). Read from `~/Documents/LiraTek/liratek.db`:

| What | Value | Should be |
| --- | --- | --- |
| `debt_ledger` "Session Debt" (session 1) | **$1,635 owed**, `covered_usd` 0 | **$135** |
| Debts page → amir → balance / aging | **−$1,635** | **−$135** |
| Session #1 Basket view | Sale +$1,635 · Basket Debt $1,635, no refunded line | shows the iPhone as refunded, Basket Debt $135 |
| Profits → Deferred "Unpaid sales" | $1,635 / potential $225 | $135 / $25 (being fixed in the LIRA-231 batch) |
| REFUND transaction | −$1,500, profit −$200, **no payment legs** | correct amount; the account is reduced instead of cash |

So the customer would be asked to pay **$1,500 for a phone he returned**. Root cause:
`SalesRepository.refundSaleItem` reverses the sale's OWN `payments` rows in proportion. A session sale has none,
because its payment lives on the basket (pooled `payments` rows with `session_id` set and `transaction_id` NULL,
and/or a `debt_ledger` "Session Debt" row with `session_id` set). So nothing is reversed except the stock and the
profit stamp.

## 2. Owner decisions already taken (2026-09-26)

1. **Amount:** the item's own amount, exactly what its row shows ($1,500 for the iPhone).
2. **How it goes back:** the cashier picks it in the refund form. This is the SAME refund window as the
   Transactions page and LIRA-231 (`RefundMethodModal` + `MultiPaymentInput`), pre-filled, editable.
3. **Account first:** if part of the basket was charged to the customer's account, the refund **reduces what he
   owes first**. Only what's left is handed back through the form.
4. **Which rows:** only **sold items** can be refunded on their own: products (sale lines), services, recharges.
   **Payouts** (loto prize, OMT/Whish/Binance cash-outs) and **kept change** are only undone by the whole-basket
   reversal, because they were netted against the items.

## 3. The operation — one core service method, both transports

`refundSessionBasketItem({ sessionId, transactionId, saleItemId?, quantity?, refundLegs? })`

- `transactionId` = the basket member, i.e. the unified transaction in `customer_session_transactions`.
  `saleItemId` + `quantity` are required when the member is a SALE: it refunds one line, or part of a line's
  quantity.
- **A = the refund amount:** the row amount of what's being returned. For a sale line that's
  `sold_price_usd × quantity`, net of that line's discount share (reuse `netSaleRevenueExpr`, rule 14).
- Steps, in ONE db transaction:
  1. **Guards.**
     - The member belongs to the session.
     - The member is a sold item (not a payout, prize or kept change).
     - It hasn't already been refunded (quantity cap).
     - The basket hasn't been whole-reversed.
     - Reuse `_assertReversible(…, { allowSessionMember: true })`, then add these session checks.
  2. **Item side, reusing the existing per-type reversal.**
     - A sale line: the stock-return, `refunded_quantity` and negated-profit parts of `refundSaleItem`, WITHOUT
       its "reverse own payments" step.
     - Other members: the generic refund's profit/source reversal, WITHOUT its payment step.
     - This needs a small refactor: split `refundSaleItem` / `refundTransaction` into an "item reversal" part and a
       "money back" part, so both paths share the item part (rule 14).
  3. **Account first.**
     - `D` = the basket's outstanding (uncovered) account charge: `Session Debt` minus `covered_*`.
     - Reduce it by `min(A, D)`, writing a debt_ledger credit linked to the session AND to the REFUND transaction
       (§5).
     - If the debt and the refund are in different currencies, convert at the day's **buy** rate, the same rule
       session payments already use.
  4. **Money back.** Remainder `R = A − reduction`. If `R > 0`, the refund form's confirmed legs are posted as OUT
     legs through the repository's ONE shared loop (rule 16).
     - The form is pre-filled from the basket's pooled IN legs, in proportion to `R`.
     - It's validated server-side: per currency, it can't hand back more than `R`; drawer-affecting methods only.
  5. **Records.** A REFUND transaction linked to the member (and to the session, so it appears in the session group,
     #11-B), with its legs and profit stamp.

**Worked examples:**

| Basket paid with | Refund | Account reduction | Handed back (form) |
| --- | --- | --- | --- |
| $1,635 all on account (amir) | iPhone $1,500 | $1,500 (owes $135 after) | $0 |
| $35 cash | charger $15 | — | $15, pre-filled "Cash · USD · $15" |
| $60 cash + $40 on account | item $50 | $40 (owes $0) | $10 |
| $100 on account, customer already repaid $70 (owes $30) | item $50 | $30 (owes $0) | $20 |

## 4. Where the owner starts it (UI)

- **Transactions page, session group** (#11-B): each **sold-item** member row gets **"Refund"**, and a SALE member
  lets you pick which line and quantity. It opens the refund form, showing the account reduction as a read-only line
  ("Reduces amir's account by $1,500") above the payment lines for the remainder.
- **POS sale screen:** for a session-paid sale, "Refund item" opens this same flow instead of LIRA-231's block.
  "Refund Sale" (the whole sale) refunds all its remaining lines through the same method, in one operation
  (owner answer Q2).
- **Debts page → Session basket view:** read-only. It shows the refunded item and the reduced Basket Debt.

## 5. Data model — decisions the build must make carefully

- **Account credit row:** do NOT reuse `debt_ledger` "Refund Reversal" with `transaction_id` NULL. Today that exact
  shape MEANS "the whole basket was reversed". `_assertSessionBasketReversible`'s idempotency check and
  `ProfitRepository.getPaymentMethodRows`' LPAY-V1 exclusion ("a debt_ledger 'Refund Reversal' row exists") both key
  on it. Use a distinct, named shape: either `transaction_type = 'Session Item Refund'` (a credit) or "Refund
  Reversal" WITH `transaction_id` = the REFUND id. Update the debt-type classification and the `moduleDebtTypes`
  guard (rule 20), and make both readers ignore it.
- **Cash-back legs:** post them with `transaction_id` = the REFUND id (not NULL), so they're the refund's own legs.
  They must never look like pooled basket legs to `_reverseSessionPooledPayments` or the By Payment
  `session_legs` / orphan-legs CTEs.
- **Session membership of the REFUND:** link it via `customer_session_transactions` (or the field #11-B's grouping
  reads), so it shows inside the session group, and the Debts basket view can list it.

## 6. Interactions and guards (rule 20 — every row has a reversal owner)

- **Whole-basket reversal after item refunds (Q1).** The recommended behaviour: it reverses **only what's left**.
  - Items already refunded are skipped.
  - Only the remaining account charge is cancelled.
  - The pooled legs are reversed MINUS what the item refunds already handed back.
  - Create + item refund + whole reversal must net to 0 per drawer, per ledger, per currency.
- **A refund is final.** An item REFUND cannot be voided. That's the existing rule for REFUND rows; confirm it and
  keep it, so the credit row and legs need no further reversal owner.
- **Profits:** item REFUND stamps already flow through `refundOriginalJoin`, and Deferred nets refunds (LIRA-231
  batch). Check By Payment, By Client/By Cashier, the Dashboard chart and closing (LIRA-219) with one real-writer
  fixture.
- **Closing / drawers:** cash back posts only through the shared loop, so drawer and closing figures follow
  automatically.

## 7. Both transports (rules 19, 21–23)

A core Zod schema (`packages/core/src/validators`) for the payload, with the refund legs typed like the existing
refund override. It gets an IPC handler (`requireRole` = the same roles as today's refunds, `validatePayload`), a
REST route (`authenticateJWT` → `requireRole`, userId from the JWT, IPC-identical envelope), a `backendApi` ipcOrHttp
function with its type derived from the schema, and the preload / electron.d.ts / ApiAdapter entries. One payload
shape.

## 8. Tests — failing first (rule 17: write each test BEFORE its fix and see it fail; never undo finished code), real writers

- **amir's case:** a session basket on account → refund the iPhone. Assert the debt is 135, there are no drawer
  moves, stock is +1, the profit stamp is −200, the basket view shows the refund, and Deferred shows 135/25.
- **Cash basket:** a refund with default legs, and one where the cashier changes the method/drawer. Assert the
  exact legs and drawer deltas.
- **Mixed basket:** cash + account, where the account is reduced first and the remainder is handed back.
- **Partly repaid debt:** only the outstanding part is reduced.
- **Refusals:** a payout / prize / kept-change member is refused; a double refund beyond the quantity is refused;
  a refund on a whole-reversed basket is refused.
- **Whole-basket reversal after item refunds:** it nets to 0 per drawer, ledger and currency.
- **The LPAY-V1 / idempotency readers** are unaffected by an item refund (regression).
- Transport tests (route + handler + dual-mode) and the UI (refund form with the account line).

## 9. Owner answers (2026-09-26) — all four took the recommended option

1. **Whole-basket reversal after an item refund:** **reverse only what's left.**
   - Items already refunded are skipped.
   - Only the remaining account charge is cancelled.
   - Pooled legs are reversed minus what item refunds already handed back.
   - Everything nets to 0.
2. **POS "Refund Sale" on a session sale:** **refund all its remaining lines through this flow**, in ONE operation:
   the account is reduced first, then the refund form handles the rest.
3. **Currency when the debt and the item differ:** **convert at the day's buy rate**, the same rule session
   payments use.
4. **Debts page basket view:** **no Refund button — read-only.** It shows the refunded item and the reduced
   Basket Debt.

## 9b. Decisions taken during the build (2026-09-26, after the phase-1 review) — owner may overrule

The phase-1 core passed amir's case end to end but an execution-based review measured money bugs. These
fixes carry design choices the owner did not explicitly make:

1. **Refund currency follows how the basket was paid.**
   - The cash-back part of a refund is pre-filled in the basket's own payment currency mix, converted at the
     day's buy rate (the same rule as Q3). Example: a basket paid in LBP gets LBP back.
   - The cashier can change the method or drawer, but not the per-currency totals.
   - Without this, an LBP-paid basket was refunded twice: $50 for the item, then the full LBP on the
     whole-basket refund.
2. **Repaid account money goes back as cash, never as a store credit.**
   - For each currency, the account reduction is capped at what the customer still owes right now.
   - The part of the item that was paid by a repayment is handed back through the form (worked example 4).
   - The whole-basket reversal then cancels only the part of the account charge not already consumed by
     item refunds.
3. **A missing exchange rate refuses the refund.** If a currency conversion is needed and no LBP rate is set,
   the refund is refused with "Set the LBP exchange rate first". It never guesses a rate.
4. **Refund amounts respect the sale discount.** A discounted line refunds its price after discount (this was
   already in §3).
5. **Every refund amount is a USD + LBP pair.** A service priced in both currencies refunds both parts.
6. **Aging nets the item credit.** Debt aging and overdue net each item credit against its own basket charge.
   How aging treats ordinary repayments is unchanged, which is pre-existing behaviour.
7. **Store credit and gift-card value never become cash** (decided after the second review).
   - Only money the customer actually repaid after the basket was charged comes back as cash (worked
     example 4).
   - An item bought with existing store credit goes back onto the account as credit.
   - Without this, a customer with $200 of store credit who returned a $50 item got $50 in cash.
8. **Whole-basket reversal keeps its old ledger shape.** It writes one "Refund Reversal" row per original
   debt row, as before this ticket, and "already reversed" no longer depends on a debt row existing.
9. **Void basket after an item refund stays refused.** The Void button is hidden once an item has been
   refunded; "Refund basket" reverses what's left.
13. **A basket whose items were all refunded one by one is closed** (owner request 2026-09-27).
    - "Refund basket" and "Void basket" are refused with "Everything in this basket has already been refunded
      item by item — there is nothing left to refund."
    - Both buttons are hidden on that basket.
    - A basket still holding a payout or kept change is not closed, because only the whole-basket reversal
      undoes those.
    - **Round-3 review finding F7 (deliberate, not a bug):** an ACCOUNT-CHARGED basket never closes this way,
      even after every item's own account share has been reduced to 0 by item refunds. `isSessionBasketFullyRefunded`
      also requires no qualifying `debt_ledger` row (`'Session Debt'`/`'CREDIT_DEPOSIT'`, `transaction_id IS NULL`)
      to exist for the session — and item refunds only CREDIT that row (offsetting its balance), they never delete
      or otherwise retire it. Decision 8's own idempotency marker (one `'Refund Reversal'` row per original debt
      row) is written ONLY by the whole-basket call, exactly once, so an account-charged basket always needs that
      final whole-basket call — even when its net balance is already $0 and there is nothing of substance left to
      reverse — purely to write the marker. "Refund basket" on such a basket is therefore a real (if financially
      inert) action, not a no-op, and is correctly still offered.
10. **A basket containing a payout can only be refunded as a whole** (decided after the third review).
    - Applies to payouts that were netted against the items at checkout: a loto prize, a wallet or Binance
      cash-out, or a custom-service payout.
    - This extends owner decision 4 ("payouts are only undone by the whole-basket reversal").
    - Refunding one item alone gave the wrong amount: $40 back on a $100 item when a $60 prize was netted.
    - Kept change is not a payout, so it doesn't block an item refund.
11. **An item refund never hands back more than the basket received** in each currency, counting all
    earlier item refunds together.
12. **SETTLED 2026-09-27 by LIRA-236 — see `REFUND_EXCHANGE_RATE_PLAN.md`: the rate typed in the refund popup, defaulting to the rate the sale was paid at.** Original question: The owner chose the day's buy rate
    (Q3).
    - When the basket was booked at a different rate, returning every item one by one leaves a small
      residue. For example, an LBP-account basket still owes 140,000 LBP (≈ $1.57), or a mixed payment
      returns $19.82 + 7,135,857 LBP instead of $20 + 7,200,000.
    - The alternative is the basket's own booked rate, which makes returning everything clear the account
      exactly.
    - The rate choice is isolated in one function, so it can be switched quickly.

## 10. Phasing

1. Core: the refactor that splits item reversal from money-back, then `refundSessionBasketItem`, the credit row, the
   legs linkage, and the guard updates. Failing-first tests.
2. Transports: schema, IPC, REST, adapter.
3. UI: Transactions session-group refund, the POS session-sale flow (replacing the LIRA-231 block), the Debts basket
   view display.
4. Whole-basket reversal "only what's left" (Q1), with net-zero proofs.
5. e2e: desktop + web, amir's scenario end to end.

**Risk:** this touches the refund core that normal sales use too. The refactor in phase 1 must leave every existing
sale refund test green before anything else lands.
