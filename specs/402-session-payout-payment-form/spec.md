# Feature Specification: Payment form on payout baskets at Session Checkout

**Feature Branch**: `402-session-payout-payment-form` (work happens on `main`; ticket LIRA-402)

**Created**: 2026-11-19

**Status**: Implemented

**Input**: Owner report (Corner Tech, 2026-11-19): a walk-in session with Exchange 10 EUR → $10.50 (shop pays $10.50) and a Whish App receive of $201 with the $2 fee taken from the payout (shop pays $199). Total −$209.50. Session Checkout shows only a "Payout to customer" box with one "Cash · General" select per currency: no Split, no second currency, no typed amount, no "− Less | + Extra". Its note says "nets against the payment below" while nothing is below. Owner: "We should always see a payment form in all payment pages."

## Today

`SessionCheckoutModal` renders the payment box only while the customer still owes money (`hasChargeToCollect`). Payouts are shown in a separate "Payout to customer" box with one method select per currency (BIDIRECTIONAL_PAYMENT_LEGS_PLAN Phase F). A basket where the shop owes the customer therefore has no way to split the payout, pay it in the other currency, or round it.

## Clarifications

### Session 2026-11-19 (decided by orchestrator, owner may change)

- **When the payout form shows.** Net = charges − General-drawer cash payouts (today's #11-A netting, always measured as if the payout is cash). Net > 0: today's pay-in form, unchanged. Net < 0 (payout-only, or mixed where the payout is bigger): the same payment box in payout mode, seeded with the net payout. Net = 0: nothing, as today.
- **What the payout form carries.** The General-drawer payout left after netting (wallet / app / Binance cash-outs, loto prize) plus any exchange payout. Split, both currencies, a method per line (Cash and the methods today's select offers, Customer Account only with a chargeable client), and the "− Less | + Extra" line with the same booking as the other payout screens: Extra = "Change rounding" expense (`rounding_given_*`), Less = kept change as profit (`kept_change_*`), cap $5 / 450,000 LBP.
- **OMT/Whish SYSTEM payouts keep their own row and method select** and still post in full on their own (a different cash box, never netted). The select no longer appears for money the payout form carries — one control per amount.
- **An exchange payout inside the payout form**: its agreed amount is never re-priced; it joins the payout total in its own currency. Paying it in the other currency is the cashier's choice on the form, at the form's rate (same as the standalone Exchange payout sheet).
- **Netting basis in payout mode is always cash.** Picking Customer Account or a wallet on a payout line pays the NET out that way; the charge is not "un-netted" back into a pay-in form (today's select un-netted the charge; that switch is gone because it would swap the form under the cashier's hands).
- **Item `cashoutMethod` stamp** on cash-out items (display only for deferred session items): the method every payout line in that item's currency shares, else Cash.
- **Session basket void / refund** voids the "Change rounding" expense with the basket. A single-item refund leaves it (same as the LIRA-334 rule: the rounding was really handed over).

### Open questions for the owner

1. **Netting overrides the "gross on the Debts page" rule for payout baskets.** The modal's own rule said a charge on account and a payout must show in full on the Debts page ("$10 charge + $20 cash-out books a $10 debt AND a $20 credit, not one collapsed −$10 line"). In payout mode the box carries the NET: a $10 charge + $20 cash-out paid to Customer Account books ONE $10 credit, no debt line. Keep the net, or should a Customer Account line on the payout box un-net (book the $10 debt + $20 credit)?
2. **Single-item refund after "− Less" / "+ Extra"** (measured in `lira402.sessionPayoutForm.test.ts`): refunding the Whish App receive alone asks the customer to pay back the item's full $199 and leaves the basket's kept profit / rounding expense in place. After "− Less $0.50" the customer received $198.50 but pays back $199 (shop +$0.50 cash, +$0.50 kept profit stays); after "+ Extra $0.50" they received $199.50 and pay back $199 (the $0.50 expense stays). The books balance (same rule as the LIRA-334 change rounding); the cashier can still edit the refund lines. Should the refund pre-fill what was really handed over instead?
3. A basket whose only payout is an OMT/Whish SYSTEM receive still shows just the payout row with its method select (no Split / Less / Extra), because that money must stay in the OMT/Whish box. Should it get the payout form too (needs per-line box routing)?
4. Should a payout basket with no "Less/Extra" claim be checked by the server against what is owed (as the standalone payout screens do)? Today the server trusts the screen's lines; the screen blocks Confirm unless the lines match. Measured: a hand-built payload paying out $199 where $197.88 was owed is accepted.
5. The tenant test page (5176) runs today's deployed backend: split / currency / method work there right away; "− Less" is refused (safe); **"+ Extra" is accepted and pays out the extra but books NO rounding expense** (the old schema passes the unknown key through and ignores it) — do not use "+ Extra" on the test tenant until this backend is deployed.
6. Also fixed while testing (pre-existing): an OMT/Whish SYSTEM receive in the same basket as a wallet cash-out paid part of the SYSTEM payout from General (`systemPayoutTotal*` counted wallet cash-outs).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Pay a payout basket in two currencies (Priority: P1)

The owner's basket (exchange $10.50 + Whish App receive $199 = $209.50 owed). The cashier pays $200 cash and the rest in LBP.

**Acceptance Scenarios**:

1. **Given** the basket, **When** checkout opens, **Then** a payment box in payout mode shows $209.50 to pay out, with Split, both currencies and the method list; there is no per-currency payout select.
2. **Given** Split, $200 USD cash + 850,500 LBP cash at 89,000 (= $9.56 … the cashier types the LBP that covers $9.50), **When** Confirm, **Then** General USD −200 and General LBP −(typed LBP), the items book as before.

### User Story 2 - Round a payout (Priority: P2)

1. **Given** the box, **When** "+ Extra" 0.50 is typed, **Then** the line pays $210.00, the payload carries `rounding_given_usd: 0.5`, and a "Change rounding" expense of $0.50 is booked, linked to the session.
2. **Given** "− Less" 0.50, **Then** the line pays $209.00, the payload carries `kept_change_usd: 0.5`, and a KEPT_CHANGE profit row of $0.50 is booked.
3. Above $5 / 450,000 LBP → held at the cap (box) and refused by the server.

### User Story 3 - Mixed baskets (Priority: P2)

1. Charge $20 (POS) + Whish App receive $100 → payout form for $80.
2. Charge $150 + Whish App receive $100 → today's pay-in form for $50, unchanged.
3. Basket with an OMT SYSTEM receive + Whish App receive → the payout form carries the Whish App part; the OMT part keeps its own row and select.

### Edge Cases

- LBP-only payout: the box total is LBP and the Less/Extra line is measured in LBP (cap 450,000).
- Customer Account line without a chargeable client: not offered.
- Void / refund of the basket: drawers, kept profit and the rounding expense all net to 0.

## Requirements _(mandatory)_

- **FR-001**: Session Checkout shows `MultiPaymentInput` (payout mode, `payer="payout"`) whenever the net (cash-basis) is a payout carried by the General drawer.
- **FR-002**: ONE leg builder (`buildSessionCheckoutLegs`, core, browser-safe) for both modes; payout lines become `OUT / PAYOUT / GENERAL` legs; SYSTEM payouts keep their gross `SYSTEM` legs.
- **FR-003**: `sessionCheckoutSchema` accepts `rounding_given_usd/lbp` (shared `roundingGivenFields`); the recharge basket schema refuses them (it never pays out).
- **FR-004**: The server verifies a payout basket's Less/Extra claim before any write: only PAYOUT legs (no IN / change), payout lines move a drawer, within the cap, net (charge − payout + payout legs) equals −kept or +rounding at the basket rate; never both.
- **FR-005**: Extra is booked with `bookPayoutRoundingExpense` linked to `customer_sessions` / session id; Less with the existing session KEPT_CHANGE row. Rule 20 reversal owner: `voidSessionBasket` / `refundSessionBasket` call `voidLinkedExpenses`.
- **FR-006**: Confirm is enabled in payout mode only when lines + less − extra cover the net payout.
- **FR-007**: Release note + What's new card with a real screenshot (rule 30).

## Success Criteria _(mandatory)_

- **SC-001**: Component test: the owner's basket renders a payment input (failing first: none today).
- **SC-002**: Core variant test (rule 28d) through the real schema + `SessionCheckoutService.checkout`: payout-only, LBP payout, split USD+LBP, + Extra, − Less, mixed payout > charge, mixed charge > payout (unchanged), SYSTEM payout present; drawer deltas per currency; void nets to 0.
- **SC-003**: Web e2e `lira-web-105`: owner's basket, split USD+LBP payout, drawer deltas per currency.
