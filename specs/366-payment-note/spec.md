# Feature Specification: Optional note on money-in payment forms

**Feature Branch**: `366-payment-note` (work happens on `main`; ticket LIRA-366)

**Created**: 2026-10-31

**Status**: Draft

**Input**: Owner, 2026-10-31: "add note optional field in all payment forms that have direction in". It was first added to LIRA-365 and moved to its own ticket the same day.

## Clarifications

### Session 2026-10-31 (owner decisions)

- Q: Which forms? → A: Every payment form where money comes in (the customer pays the shop). Not on money-out forms.
- Q: Where does the note show? → A: In full in the transaction details window, and as a mark on the row in the Transactions list. When part of the payment goes on the customer's account, the customer's debt entry carries the same note.

### Session 2026-11-01 (owner decision)

- Q: Do the Maintenance repair job and the Hold money deposit count? They already have their own note box. → A: Yes, both. Their existing note shows in the details window and gets the list mark. The repair note is also copied onto the customer's debt entry. Neither gets a second box.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Optional note on every money-in payment form (Priority: P1)

The cashier can type a short note on any payment form where the customer pays the shop ("paid for his brother", "will bring the rest Monday"). The note shows on the entry afterwards, and on the customer's debt when part of it is charged to the customer's account.

**Why this priority**: Owner request 2026-10-31. Cashiers have no consistent place to explain an entry.

**Independent Test**: Sell a $20 recharge to a known client, $15 cash and $5 on the client's account, with the note "rest on Monday". The note shows in the transaction details window, a note mark shows on its row in the Transactions list, and the client's $5 debt entry on the Debts page shows "rest on Monday".

**Acceptance Scenarios**:

1. **Given** any money-in payment form, **When** the cashier leaves the note empty, **Then** the entry saves as today.
2. **Given** a note typed on POS checkout, Exchange, OMT/Whish send, OMT/Whish App, Binance, recharge/bills/Katsh, Loto, custom services, voucher sale or debt repayment, **When** saved, **Then** the transaction details window shows the full note and the Transactions list marks the row as having a note.
3. **Given** a payment with a part charged to the customer's account, **When** saved with a note, **Then** the customer's debt entry shows the same note.
4. **Given** a saved note, **When** the note is edited later, **Then** the transaction and its debt entry both show the new note.
5. **Given** a money-out form (expense, supplier or partner payment, settle sheet, refund, payout), **Then** no new note box is added there.

---


### Edge Cases

- A note of only spaces counts as empty.
- A note on a session-basket item travels with the item to the basket checkout.
- A form that sends its own generated label today ("OMT - SEND", "Exchange USD → LBP") must not show that label as a typed note.
- Offline desktop entries replayed later keep their note.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every payment form where the customer pays the shop MUST offer one optional Note box (up to 500 characters): POS checkout, Exchange, OMT/Whish system send, OMT/Whish App and Binance, recharge/bills/Katsh, Loto, custom services, voucher sale, debt repayment. A form that already has a note keeps that one box; none gets two.
- **FR-002**: The note MUST be saved with the transaction, shown in full in the transaction details window, and marked on the row in the Transactions list.
- **FR-003**: When part of the payment is charged to the customer's account, the customer's debt entry MUST carry the same note.
- **FR-004**: Editing the note later MUST update the transaction and its debt entry together, so the two never disagree.
- **FR-005**: Money-out forms (expenses, supplier and partner payments, settle sheets, refunds, payouts) get no new note box from this ticket.
- **FR-006**: All of the above MUST work the same in the desktop app and the web app.

### Key Entities

- **Typed note**: free text up to 500 characters, typed by the cashier, belonging to one transaction and copied onto its debt entry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every money-in form listed in FR-001 has exactly one Note box; no money-out form gets one.
- **SC-002**: A typed note is visible on the entry, in the Transactions list and, when charged on account, on the customer's debt entry. After an edit, all three places show the same text.
- **SC-003**: Entries saved without a typed note show no note mark.

## Assumptions

- The research for this ticket was done under LIRA-365 and moved here (`research.md`).
- Vouchers have no edit path, so a voucher note is kept as typed when the voucher is sold.
