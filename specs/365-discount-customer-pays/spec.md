# Feature Specification: Discount wherever a customer pays the shop

**Feature Branch**: `365-discount-customer-pays` (work happens on `main`; ticket LIRA-365)

**Created**: 2026-10-31

**Status**: Draft

**Input**: Owner, 2026-10-31: "I cannot see the discount field in OMT system, why? … I'm thinking to enable discount in all pages where we have a payment form." After walking through every payment page, the owner chose: Discount only where a **customer pays the shop** (POS checkout, Exchange, OMT/Whish system send, voucher sale), capped like Waive ($5 / 450,000 LBP).

## Clarifications

### Session 2026-10-31 (owner decisions)

- Q: Which pages? → A: Only pages where a customer pays the shop: POS checkout, Exchange, OMT/Whish system send, voucher sale.
- Q: Pages where the shop pays money out (expenses, paying a supplier or partner, picking up held money, refunds, voucher cancel, payouts) and the settle sheets? → A: No discount. There a "discount" would mean the other side writes off part of the amount, which is a different thing.
- Q: How big can a discount be? → A: The same cap as Waive today: up to and including $5 on a dollar total, 450,000 LBP on a lira total.
- Q: Exchange already has a "Forgive" button in its customer-pays box, under the same cap. Discount there? → A: Replace that Forgive button with the standard Discount line, so every payment form shows the same Discount control. Same booking and same cap as Forgive today.
- Q: Does the cap also apply to POS checkout's existing discount, which has no limit today? → A: No. POS stays as it is; the cap applies to Exchange, OMT/Whish system send and voucher sale.
- Q (later the same day): The optional Note box, added here first, moved to its own ticket LIRA-366 (`specs/366-payment-note/`).
- Q: OMT/Whish system send has no shop profit at the moment of sending (the whole fee is owed to OMT/Whish). Who takes the discount? → A: The shop, as an expense named "Discount given". What is owed to OMT/Whish and the commission at settlement do not change.

## Today, per page

| Page | Discount today |
|---|---|
| POS checkout | Has its own Discount line, **no cap** |
| Exchange | None |
| OMT/Whish system send | None |
| Voucher sale | None |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discount on an OMT/Whish system send (Priority: P1)

The cashier sends $400 through OMT (Western Union) for a regular customer. The fee is $15. The cashier gives a $2 discount so the customer pays $413.

```
BEFORE (today)                   AFTER
Send $400 + fee $15              Send $400 + fee $15 − discount $2
Customer pays    $415            Customer pays    $413
Owed to OMT      $415            Owed to OMT      $415 (unchanged)
Drawer           +$415           Drawer           +$413
                                 Expense "Discount given"  $2
Commission later $1.50           Commission later $1.50 (unchanged)
```

**Why this priority**: This is the page the owner asked about; a discount here cannot come out of any profit, so it needs its own booking.

**Independent Test**: Record the send above. Drawer +$413; OMT account owed $415; one "Discount given" expense of $2 dated with the send; commission at settlement $1.50.

**Acceptance Scenarios**:

1. **Given** a $400 OMT Western Union send with a $15 fee, **When** the cashier enters a $2 discount and the customer pays $413 cash, **Then** the send is saved, the drawer goes up $413, OMT is owed $415, and a $2 "Discount given" expense is recorded.
2. **Given** the same send, **When** the cashier types a $6 discount, **Then** the discount is held at $5 and the form says the most allowed is $5.
3. **Given** an LBP send, **When** the cashier types a 500,000 LBP discount, **Then** it is held at 450,000 LBP.
4. **Given** a Whish system send, **When** a discount is given, **Then** it is booked the same way: Whish is owed the full amount, the shop records "Discount given".
5. **Given** a saved send with a $2 discount, **When** it is voided or refunded, **Then** the drawer goes back by $413, what is owed to OMT goes back by $415, and the "Discount given" expense is cancelled: every account nets to $0.

---

### User Story 2 - Discount on Exchange (Priority: P2)

The customer changes dollars to lira (or lira to dollars) and the cashier rounds the amount the customer hands over down a little. The "Forgive" button in the customer-pays box is replaced by the standard Discount line (the one POS and recharge use: under "Total Amount", a typed amount, "Capped to max" when over the cap). The same change applies to every payment form that shows that customer-pays box (the Whish App, OMT App and Binance cash-outs), so no form keeps a separate Forgive button.

**Why this priority**: Common at the counter; the discount lowers the shop's profit on that exchange, so no extra booking is needed.

**Independent Test**: Exchange where the customer owes 9,000,000 LBP for $100 at the sell rate; the cashier gives a 50,000 LBP discount; the customer pays 8,950,000 LBP. The drawer gets 8,950,000 LBP, the $100 goes out, and the profit of this exchange is 50,000 LBP lower than without the discount.

**Acceptance Scenarios**:

1. **Given** an exchange where the customer owes 9,000,000 LBP, **When** a 50,000 LBP discount is entered, **Then** the customer pays 8,950,000 LBP and the exchange's profit is 50,000 LBP lower.
2. **Given** a discount above 450,000 LBP (or $5 on a dollar side), **Then** it is held at the cap.
3. **Given** a discounted exchange, **When** it is voided, **Then** both drawers and the profit go back exactly.

---

### User Story 3 - Discount on a voucher sale (Priority: P3)

A customer buys a $50 voucher and pays $48. The voucher is still worth $50 when used.

**Why this priority**: Rare, but the same payment form.

**Independent Test**: Sell a $50 voucher with a $2 discount. Drawer +$48; the voucher is worth $50; a $2 "Discount given" expense is recorded. Cancelling the voucher sale undoes all three.

**Acceptance Scenarios**:

1. **Given** a $50 voucher, **When** a $2 discount is entered, **Then** the customer pays $48, the voucher keeps its $50 value, and a $2 "Discount given" expense is recorded.
2. **Given** that voucher, **When** the sale is cancelled, **Then** the refund to the customer is what they paid ($48), and the "Discount given" expense is cancelled.

---

### User Story 4 - POS checkout stays as it is (Priority: P3)

POS checkout already has a Discount line with no limit, and it keeps it. The $5 / 450,000 LBP cap applies only to the three pages where the discount is new.

**Independent Test**: A $300 phone sold at POS with a $30 discount is still accepted, as today.

---

### Edge Cases

- Discount equal to or larger than the whole amount: refused. The customer must pay something.
- Discount in a session basket: unchanged. The basket checkout keeps its own Waive; this feature adds the discount only to the walk-in payment form.
- Split payment (cash + wallet, or USD + LBP): the discount is one amount in the total's currency, taken off once.
- Discount together with Waive on the same payment: both together must stay within the one cap.
- "For Partner" sends (the partner's customer, our system): no discount. The money belongs to the partner's customer flow, not to the shop's sale.
- Backdated entry ("Set custom time"): the "Discount given" expense takes the same date and time as the send.
- Offline desktop entry replayed later: the discount and its expense are replayed with it, once.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The payment form on Exchange, OMT/Whish system send and voucher sale MUST show a Discount line, like the one on POS checkout.
- **FR-002**: On Exchange, OMT/Whish system send and voucher sale, a discount MUST be held at $5 for a dollar total and 450,000 LBP for a lira total, the same cap as Waive. Discount and Waive on one payment together MUST stay within that cap. The server MUST refuse a payment above it, whichever app sent it.
- **FR-003**: On an OMT or Whish system send, what is owed to OMT/Whish and the commission MUST NOT change. The discount MUST be recorded as a shop expense named "Discount given", in the currency of the send, on the same date as the send.
- **FR-004**: On a voucher sale, the voucher MUST keep its full value. The discount MUST be recorded as a "Discount given" expense.
- **FR-005**: On Exchange, the discount MUST lower the shop's profit for that day by exactly the discount, booked the way Forgive is booked today; no expense is recorded.
- **FR-005a**: The customer-pays box (Exchange, Whish App, OMT App and Binance cash-outs) MUST show the standard Discount line in place of its Forgive button. The booking and cap are unchanged.
- **FR-006**: The "Discount given" expense MUST show on the Expenses page. In the Transactions list it MUST be hidden by default, like other entries the system writes for the shop, and shown when filtering for expenses.
- **FR-007**: Voiding or refunding a discounted send, exchange or voucher sale MUST undo the discount and cancel its "Discount given" expense, so every drawer and account nets to zero in each currency.
- **FR-008**: Pages where the shop pays money out (expenses, supplier and partner payments, picking up held money, refunds, voucher cancel, payouts) and the settle sheets MUST stay without a discount.
- **FR-009**: All of the above MUST work the same in the desktop app and the web app.
- **FR-010**: The transaction details window MUST show the discount on a discounted send, exchange or voucher sale.

### Key Entities

- **Discount**: an amount, in the total's currency, that the customer does not pay. Belongs to one transaction.
- **"Discount given" expense**: a shop expense written by the system when a discount cannot come out of that transaction's profit (OMT/Whish system send, voucher sale). Belongs to its transaction and is cancelled with it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can give a discount on an OMT/Whish system send, an exchange and a voucher sale without leaving the payment form.
- **SC-002**: For every discounted entry, the drawer plus the "Discount given" expense (or the lower profit) equals what the entry would have booked without the discount, to the cent and to the lira.
- **SC-003**: Voiding any discounted entry leaves every drawer, account and expense total exactly where it was before the entry, in both currencies.
- **SC-004**: No payment above the cap is accepted from either app.

## Assumptions

- The cap is the existing Waive cap; changing it later changes both.
- Any user who can record the entry can give the discount (no admin step), because the cap is small.
- "Discount given" is a new expense category in the shop's expenses. The name can still change before release.
- The discount on a voucher sale is an expense because the voucher's full value is still owed to whoever uses it, as with OMT.
- Whish system send follows OMT: Whish is owed the full amount and the shop records the discount.
