# Carrier-legs void asymmetry (multi-unit split checkouts)

**Status:** open — needs a design decision before implementation.
**Origin:** code-review 2026-07-17 of the auto-debt-remainder change set
(removed-behavior audit, findings 1–2). Pre-existing property of the
**lira-095 legs-carrying convention**, not a regression — but the auto-debt
feature makes split payloads far more common, so exposure is now real.

## The convention today

Multi-unit checkouts (KatchForm bills since lira-095; FinancialForm catalog
units since this change set) submit ONE transaction per unit, and the payment
legs (the customer's full tender + any CUSTOMER_ACCOUNT debt + change/return
legs + kept change) book against exactly **one CARRIER transaction** — the
first unit. Every sibling unit submits `deferPayment: true` (cost + commission
only). This is correct at create time: money books once, cost books per unit.

Guarded by: `FinancialForm.legsCarrier.test.tsx` (jest, failing-first proven)
and KatchForm's inline guard comment. The N×-overbooking alternative (same
legs attached to every unit call) is the bug this convention prevents.

## The asymmetry (rule 20 gap)

Each unit is an independent `FINANCIAL_SERVICE` transaction with **no
cart/group id linking siblings**, so the generic void/refund
(`TransactionRepository._reversePayments`, same path for void and refund)
operates per-transaction:

1. **Void the CARRIER** → the ENTIRE cart's customer cash-in (and debt) is
   reversed, but only the carrier's own cost/profit. Sibling units keep their
   `-cost` provider-drawer legs and profit stamps: books show the shop paid
   the provider for N−1 units, earned profit on them, and retained zero
   customer money.
2. **Void a SIBLING** → its cost/profit reverse, but the customer's payment
   for that unit (living on the carrier) is untouched: the customer stays
   fully charged for a unit that was cancelled; no cash/debt is returned.

Create + reverse does NOT net to 0 across ledgers per currency unless the
operator voids **every** unit of the checkout — and nothing enforces or even
suggests that.

## Candidate designs (pick one)

- **A. Checkout group id** — new column (e.g. `transactions.group_id` or a
  `checkout_id` on `financial_services`) stamped on every unit of one
  checkout. Void of ANY member offers/forces group void; the generic reversal
  walks the group. Deepest fix; touches migration + create paths + void UI.
- **B. Carrier-aware void guard** — voiding a transaction that carries legs
  larger than its own price (or one flagged `deferPayment`-sibling) is
  blocked with a message directing the operator to void the whole checkout
  (manually, unit by unit, carrier last). Cheap, honest, no schema change.
- **C. Proportional re-carry** — voiding a sibling moves a price-share of the
  carrier's legs onto a compensating adjustment row. Most "automatic", by far
  the most complex; interacts with debt, change legs, kept change. Not
  recommended as a first step.

Recommendation: **B now, A when a migration window is open.** Option B is a
single guard in the void path + one failing-first spec (void carrier of a
2-unit split → blocked; void sibling → blocked; void both in order → allowed
and nets to 0).

## Acceptance (rule 17 / rule 20)

- Failing-first test demonstrating today's non-zero net after a partial void
  of a 2-unit split-payment checkout (drawer + debt_ledger, per currency).
- After the fix: create + (whole-checkout) reverse nets to 0 across
  `payments`/drawers, `debt_ledger`, and profit stamps, per currency.
- KatchForm bills AND FinancialForm catalog units both covered.
