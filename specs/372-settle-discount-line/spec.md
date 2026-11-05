# Feature Specification: One Discount line on every settle screen

**Feature Branch**: `372-settle-discount-line` (work happens on `main`; ticket LIRA-372)

**Created**: 2026-11-05

**Status**: Draft

**Input**: Owner, 2026-11-05: "Discount for settlement in debts accounts page, suppliers and partners … Let's have all of them consistent. So discount line in all these pages."

## Clarifications

### Session 2026-11-05 (owner decisions)

- Q: What should the settlement discount do, given that LIRA-365 (2026-10-31) said "no discount on supplier/partner pay or settle sheets"? → A: Make all settle screens consistent: one Discount line on every one of them. This replaces that part of the LIRA-365 decision and the LIRA-310 follow-up of 2026-10-12 ("no Waive anywhere on the Suppliers page").
- Q: How big can the discount be? → A: $5 for a USD amount, 450,000 LBP for an LBP amount (the same limit as Waive and the LIRA-365 discount).
- Q: In which direction does the line show? → A: Both. When the shop pays, the other side accepts less (OMT owed $1,000, shop pays $997, discount $3). When the shop receives, the shop accepts less (partner owes $500, pays $495, discount $5).
- Q: Does the limit apply to Debts "Forgive (no cash)" too, which today goes up to the full due? → A: Yes. $5 / 450,000 LBP on Debts as well; bigger amounts go through the admin Write off.
- Q: Waive shortcut on the line? → A: No. The cashier types the discount. Debts and Partners lose their Waive button on the settle screens, so every screen matches (consistent with the 2026-10-12 Suppliers decision). Loto's own settlement Waive is not touched.

### Session 2026-11-05 (owner decisions after planning)

- Q: Does typing a discount move the payment line? → A: Yes, on all 7 screens. Owed $412.50, Discount $2.50 → the payment fills to $410.00 automatically (Debts and Partners change from "hint only" to this).
- Q: Mixed-direction Settle Account (shop pays $500 USD, OMT pays 900,000 LBP): discount on both currencies at once? → A: Keep today's refusal; a discount on one currency per mixed settlement.
- Q: Batch Settle only moves money in for a bills commission with no balance to discount. → A: Discount line shows there only when the shop pays.
- Q: Staff and forgives over $5 on Debts → A: Fine. Staff discount up to $5 / 450,000 LBP; bigger amounts need an admin's Write off.
- Q: The cashier typed the payment by hand first ($500 owed, types $500 in Cash), then types a $5 discount: keep $500 and block Confirm, or lower the payment? → A (owner, 2026-11-05, option B): the discount always wins. The payment is lowered to $495 by itself and Confirm works. Whenever the discount changes, payment = owed − discount in that currency, typed by hand or not.

### Session 2026-11-05 (owner decisions after build)

- Q: Voiding or refunding a Debts repayment that carried a discount: does the discount come back too? → A (decision A): Yes. Customer owed $105, paid $100 + $5 discount; void → owes $105 again, drawer −$100, the 'Debt Discount' row and its discount profit (−$5) reversed, and the coverage the discount applied given back. Same as Supplier and Partner discounts, which are reversed with their settlement. This overturns the earlier CQ-10 rule that left a repayment's discount booked. Discounts booked on their own (admin Write off) are not tied to a repayment and stay as they are. Applies to repayments saved from now on (older discounts carry no link to their repayment).
- Q: Is the $5 / 450,000 LBP cap also checked on the server, beyond the shared schema? → A (decision B): Yes, with the one shared check, in Debts Repay (`DebtService.addRepayment`), Partners settle by amount (`PartnerService.settle`) and Partners settle by day (`PartnerSettlementRepository.settleDays`), like the supplier settlement waive check. Admin Write off stays uncapped.

### What exists today (read from the code, 2026-11-05)

| Screen | Discount today | Limit today |
|---|---|---|
| Debts, Repay (picker and calendar) | "Forgive (no cash)", $ and LBP, with a reason | Up to what is due |
| Suppliers, Pay / Receive | Discount, only when the shop pays | Up to what is owed |
| Suppliers, batch Settle | None | — |
| Suppliers, Settle Account sheet (incl. OMT SMS amount) | None | — |
| Partners, Settle by day | "Forgive", only when the partner pays | Room left after the payment |
| Partners, Settle by amount | "Forgive" | Room left after the payment |

Admin "Write off" windows on Debts and Partners are separate and are not part of this feature.

Who may open each settle screen (read from the code): the Suppliers settle screens (Pay / Receive, batch Settle, Settle Account) are admin-only; Debts Repay and both Partners settles are admin + staff.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shop pays a supplier a little less (Priority: P1)

The shop owes a supplier $412.50 and the supplier accepts $410. On the supplier's settle screen the cashier types a $2.50 discount. The payment is $410, the supplier balance closes at $0, and the $2.50 is recorded as a discount received.

**Why this priority**: The owner settles suppliers daily and rounds to cash in hand. Today only Pay / Receive allows it, not the settle sheets.

**Independent Test**: Supplier owes-to $412.50 on picked days. Settle Account, Discount $2.50, pay $410 cash. Drawer −$410, supplier balance $0, picked days settled, profit +$2.50 shown as a supplier discount.

**Acceptance Scenarios**:

1. **Given** any supplier settle screen (Settle Account, batch Settle when the shop pays, Pay / Receive), **Then** a Discount line shows, the same look and place on every screen.
2. **Given** $412.50 owed and a payment line (typed by hand or not), **When** the cashier types a $2.50 discount, **Then** the payment line fills to $410.00 by itself.
3. **Given** a $2.50 discount, **When** confirmed, **Then** the amount to pay drops by $2.50, the balance closes, and the discount is booked like today's Pay-tab discount.
4. **Given** a discount above $5 (or 450,000 LBP), **Then** the screen refuses it with the limit shown, and the server refuses it too.

---

### User Story 2 - Shop receives a little less (Priority: P1)

A partner owes the shop $500 and hands over $495. The cashier types a $5 discount. The partner balance closes; the $5 is recorded as a discount given.

**Why this priority**: Same daily rounding, other direction.

**Independent Test**: Partner owes $500. Settle, Discount $5, receive $495. Drawer +$495, partner balance $0, profit −$5 as a partner discount.

**Acceptance Scenarios**:

1. **Given** Debts Repay, Partners settle (by day and by amount) and Suppliers Receive, **Then** the same Discount line shows when the shop receives.
2. **Given** a partner owing $500 and a payment line (typed by hand or not), **When** the cashier types a $5 discount, **Then** the payment line fills to $495.00 by itself (Debts and Partners included).
3. **Given** a discount, **When** confirmed, **Then** the debt or balance closes by payment + discount, and the discount is booked as today's forgive/discount entry for that page.

---

### User Story 3 - OMT account settlement with a discount (Priority: P2)

The OMT Settle Account sheet (including the SMS amount box) gets the same Discount line in both directions.

**Why this priority**: The OMT sheet is the biggest settle screen, but its commission is already worked out from the SMS amount, so the discount must not be confused with commission.

**Independent Test**: OMT owed $772.30 expected, SMS 772.30, Discount $2.30, pay $770 cash. Drawer −$770, commission unchanged ($4.20), OMT balance $0, profit = commission + $2.30 discount received.

**Acceptance Scenarios**:

1. **Given** the OMT sheet, **When** a discount is entered, **Then** the commission line does not change, and the payment drops by the discount.
2. **Given** an SMS amount and a discount together, **Then** the sheet shows both separately in the summary.

---

### User Story 4 - Void or refund reverses the discount (Priority: P1)

Voiding or refunding a settlement with a discount puts the balance and profit back where they were.

**Independent Test**: Do story 1, then void. Supplier balance back to $412.50 owed, drawer back, discount profit gone, days unsettled again.

**Acceptance Scenarios**:

1. **Given** a settlement with a discount, **When** voided or refunded, **Then** every drawer, ledger, balance and profit returns to its earlier value, per currency.

---

### Edge Cases

- A discount bigger than what remains owed is refused (a discount never creates credit).
- The cashier typed the payment by hand first (e.g. $500 on $500 owed), then types a $5 discount: the payment is lowered to $495 by itself and Confirm works (owner, 2026-11-05, option B: the discount always wins). Typing the payment again AFTER the discount is the cashier's choice; payment + discount may still not exceed what is owed.
- Settle Account with the shop paying in one currency and the other side paying in the other (shop pays $500, OMT pays 900,000 LBP): a discount is allowed on one currency only; typing one in both is refused with today's message.
- Batch Settle that only brings money in (a bills commission with nothing owed): no Discount line.
- Discount and payment in two currencies: the limit applies per currency ($5 and 450,000 LBP).
- A balance under $5 can be closed by discount alone, with no payment. That is allowed only when the screen already allows a settlement with no money moved.
- Debts "Forgive" today allows any amount up to the due; with this feature it is limited to $5 / 450,000 LBP. Larger amounts go through the admin Write off.
- Partners "Forgive" today only shows when the partner pays; it now shows in both directions.
- Loto settlement on the Loto page keeps its Waive and is not part of this feature.
- Waive button: none on any settle screen. Debts and Partners settle screens lose theirs; the cashier types the discount.
- Desktop and web behave the same.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every settle screen on Debts (Repay picker and calendar), Suppliers (Settle Account incl. OMT, batch Settle, Pay / Receive) and Partners (Settle by day, Settle by amount) MUST show one Discount line, the same component, label and place on each.
- **FR-002**: The Discount line MUST show whether the shop pays or receives, with one exception: batch Settle shows it only when the shop pays (its money-in case has no balance to discount).
- **FR-003**: The discount MUST be limited to $5 for USD and 450,000 LBP for LBP, per currency, checked on screen and on the server, and MUST NOT exceed what remains owed after the payment.
- **FR-004**: A discount when the shop pays MUST be booked as a discount received (profit up). A discount when the shop receives MUST be booked as a discount given (profit down). Each page keeps its existing booking where it has one.
- **FR-005**: A discount MUST reduce the money moved by the same amount and close the same balance, days or items as a full payment would.
- **FR-006**: On the OMT sheet, a discount MUST NOT change the commission worked out from the SMS amount.
- **FR-007**: Void and refund MUST reverse the discount with the settlement, netting to zero across every ledger touched, per currency.
- **FR-008**: The discount and its optional reason MUST show on the transaction details and in the counterparty's Payments history.
- **FR-009**: Admin Write off windows stay as they are. Who may open each settle screen stays as it is (Suppliers settle: admin; Debts and Partners: admin + staff); the $5 / 450,000 LBP limit applies to every role, and anything bigger goes through an admin's Write off.
- **FR-010**: Typing a discount MUST set the payment line to owed − discount on all 7 screens (owed $412.50, discount $2.50 → payment $410.00), even when the cashier typed the payment by hand before the discount (owner, 2026-11-05, option B). If the cashier edits the payment after the discount, payment + discount may not exceed what is owed.
- **FR-011**: On a Settle Account where the two currencies go opposite ways, a discount MUST be accepted on one currency only; a discount on both is refused (today's rule, kept).

### Key Entities

- **Settlement discount**: amount per currency, direction (received / given), optional reason, linked to its settlement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 7 settle screens show the same Discount line (batch Settle only when the shop pays), and on each the payment line drops by the discount.
- **SC-002**: A settlement with a discount closes the balance exactly (0 left) when payment + discount = owed.
- **SC-003**: Create + void of a discounted settlement nets to 0 in every drawer, ledger and profit figure, per currency.
- **SC-004**: A discount over the limit is refused 100% of the time on both desktop and web.

## Assumptions

- The reason field stays optional, as on today's lines.
- The existing Debts and Partners bookings ("Debt Discount", partner DISCOUNT) and the supplier DISCOUNT booking are reused; a supplier Receive discount (shop accepts less from a supplier) is new and is booked as a discount given.
- No migration: every ledger already has a discount entry type (confirmed in research R11).
- ~~A payment typed by hand is kept~~ — overturned by the owner on 2026-11-05 (option B): typing a discount always sets the payment to owed − discount, typed by hand or not. Example: $500 owed, $500 typed by hand, then $5 discount → payment becomes $495 and Confirm works (FR-010).
- The $5 / 450,000 LBP limit applies to admins too; an admin forgives more only through Write off.
