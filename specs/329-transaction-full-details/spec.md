# Feature Specification: Full transaction details

**Feature Branch**: `main` (owner works on main)
**Ticket**: LIRA-329
**Created**: 2026-10-16
**Status**: Draft
**Input**: Owner request (2026-10-16): every field a cashier can fill on screen must be kept on the transaction itself, so any transaction can be understood later on its own, when reviewing or correcting it. Gap list: `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md`.

## Background

A transaction today keeps its type, amounts, profit, rate, time, a summary line and a few extra details. Much of what the cashier typed lives only in the module's own records, in separate payment records, inside the summary text, or nowhere at all. The audit of 2026-10-16 found, for example:

- an OMT send keeps neither its OMT service type, its reference number, the sender and receiver phones, nor the OMT fee as a figure;
- a maintenance job keeps its device and issue only inside the summary, with the issue cut to 60 characters;
- a sale keeps item names and quantities, but not each item's price, serial number or warranty;
- the client's phone is missing on almost every type, and a walk-in client's name is missing on most Mobile Recharge and OMT/Whish types;
- notes typed on debts, suppliers, partners and Custom Services never reach the transaction.

Reviewing a past transaction therefore means digging through several screens, and some facts cannot be recovered at all.

## Clarifications

### Session 2026-10-16

- Owner: the missing details are kept in the transaction's own "details" (one structured set per transaction type), and the existing client name and client phone of the transaction are filled wherever they are known.
- Owner: new transactions only. Transactions saved before this change are not filled in.
- Owner: payment lines (method, currency and amount of each line, change returned, change kept) are copied into the transaction's details as they were at the moment of saving, in addition to the existing payment records.
- Owner: where the details are shown (summary text, a transaction details view) is decided in a later step. This feature saves them.
- The seven suspected bugs listed in the audit are being verified separately; fixing them is not part of this feature unless the owner adds them.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - An OMT / Whish transfer can be understood from its transaction alone (Priority: P1)

Weeks after an OMT send, the owner opens the transaction to answer a customer's question. Everything the cashier entered is there: OMT service type, reference number, sender and receiver names and phones, OMT fee, Whish fee, whether fees were included, the partner it went through, the non-cash payment fee, and how it was paid.

**Why this priority**: OMT/Whish system transfers had the largest gap and are the most frequently questioned transactions.

**Independent Test**: record an OMT send and a Whish receive with every field filled; read each transaction back on its own and find every value exactly as entered.

**Acceptance Scenarios**:

1. **Given** an OMT send with service type "Cash to Business", reference "R-123", sender and receiver names and phones, and an OMT fee, **When** it is saved, **Then** its transaction holds all of those values exactly as entered, plus the client's name and phone.
2. **Given** a Whish receive with a Whish fee and "including fees" ticked, **When** it is saved, **Then** its transaction holds the Whish fee as a figure and the including-fees choice.
3. **Given** a transfer through a partner, **When** it is saved, **Then** its transaction identifies that partner (not only by name) and how the partner was involved.

---

### User Story 2 - Every other transaction type keeps everything entered (Priority: P1)

The same holds for every type the audit covers: Mobile Recharge (MTC/Alfa, buy-back, Alfa Gift, Katsh, iPick, Whish App, OMT App, Binance, top-ups, basket, partner order, wrong number), Custom Services and Hold Money, POS sales, Maintenance, Exchange, Loto, warranty claims, expenses, debts and accounts, suppliers, partners, session checkout, voids and refunds.

**Why this priority**: the request covers all transactions; a reviewer must not need to know which types are complete.

**Independent Test**: for each type, fill every field on its screen, save, and compare the transaction with the list in the audit file: no field from the "missing" list is absent.

**Acceptance Scenarios**:

1. **Given** a POS sale of two items with serial numbers, unit prices and warranty months, **When** it is saved, **Then** its transaction lists each item with its product, quantity, unit price, serial number or unit, and warranty.
2. **Given** a maintenance job with a long issue description, status and repair cost, **When** it is paid, **Then** its transaction holds the full issue text (not cut short), device, status, cost, price before discount, discount and warranty months.
3. **Given** a debt repayment, supplier payment, partner settlement or Custom Service with a note, **When** it is saved, **Then** its transaction holds the note.
4. **Given** a void or refund, **When** it is saved, **Then** its transaction holds the original transaction's client name and phone.
5. **Given** a client was picked or typed (name and/or phone), **When** any transaction is saved for that client, **Then** the transaction's own client name and client phone are filled.

---

### User Story 3 - How the customer paid is kept with the transaction (Priority: P2)

The owner checks how a past transaction was paid: each payment line's method, currency and amount, the change returned and any change the shop kept, exactly as at the time of payment.

**Why this priority**: payment lines exist today in separate records; keeping a copy on the transaction makes it self-contained, as the owner decided.

**Independent Test**: pay a transaction with two lines (e.g. part USD cash, part LBP cash) and change returned; the transaction's details list both lines, the change returned and the change kept, matching the payment records.

**Acceptance Scenarios**:

1. **Given** a payment split over two methods and two currencies with change returned, **When** it is saved, **Then** the transaction's details list each line (method, currency, amount) and the change returned, and they match the payment records.
2. **Given** the customer leaves change with the shop, **When** it is saved, **Then** the kept amount and currency are in the transaction's details as their own figure.
3. **Given** a customer-session basket paid once for several items, **When** it is checked out, **Then** each item's transaction says it was paid as part of that session's payment, and the session's payment lines are kept with the basket.

---

### User Story 4 - Desktop and web save the same details (Priority: P2)

A transaction saved on the desktop app and the same transaction saved on the web app hold identical details.

**Independent Test**: save the same OMT send on desktop and on web; their details match field for field.

**Acceptance Scenarios**:

1. **Given** the same inputs on both apps, **When** each saves, **Then** the details are identical apart from ids and times.

### Edge Cases

- A field left empty on screen is simply absent from the details (not saved as a made-up value).
- A field the cashier cannot see on a given screen (e.g. Days has no phone) is not required.
- Very long text (issue descriptions, notes) is kept in full.
- A transaction saved before this change has no details; screens and reports must keep working for it exactly as today.
- A transaction written by the system on the cashier's behalf (automatic supplier payment, SMS fee expense, kept-change or waived rows) keeps what it knows and points to the transaction that caused it.
- Editing a transfer's names or phones later from History updates only what it updates today; changing that behaviour is not part of this feature (it is one of the suspected bugs being verified).
- Saving the extra details must never change any amount, balance, profit or drawer movement.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every new transaction MUST keep, in its details, every value the cashier entered or chose on its screen, per the field list in `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md` (sections 1 and 2) for its type.
- **FR-002**: Each transaction type MUST have one defined list of detail fields; the same type MUST produce the same fields whichever screen, session, basket or app saved it.
- **FR-003**: The transaction's own client name and client phone MUST be filled whenever a client name or phone is known for it (picked client, typed walk-in, session customer, original transaction for voids/refunds).
- **FR-004**: Where a partner is involved, the transaction MUST identify the partner and the partner's role (for, via, through), not only show the partner's name.
- **FR-005**: The transaction's details MUST include a copy of its payment lines as at the moment of saving: method, currency and amount of each line, change returned, and change kept (amount and currency).
- **FR-006**: Free text (notes, descriptions, issue text) MUST be kept in full.
- **FR-007**: Discounts MUST be kept as the cashier typed them (amount and currency), in addition to their effect on the amounts.
- **FR-008**: Saving the details MUST NOT change any amount, profit, balance, ledger or drawer movement that the same transaction produces today.
- **FR-009**: Transactions saved before this change MUST keep working everywhere exactly as today; they are not filled in.
- **FR-010**: The desktop app and the web app MUST save identical details for identical inputs.
- **FR-011**: How details are displayed (summary text, details view) is NOT changed by this feature; existing summaries stay as they are.
- **FR-012**: The feature MUST be delivered type by type (OMT/Whish system first), each step leaving every type either fully covered or unchanged.

### Key Entities

- **Transaction details**: the structured set of values kept on a transaction, specific to its type (e.g. for an OMT send: service type, reference, sender, receiver, fees, fee choice, partner, payment fee).
- **Payment snapshot**: the copy of the transaction's payment lines, change returned and change kept, as at saving time.
- **Client on the transaction**: the client name and phone the transaction itself carries.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For every transaction type in the audit, 100% of the fields on its "missing" list are present on a newly saved transaction when the cashier filled them.
- **SC-002**: The owner can answer "who, what, how much, how was it paid, and with what reference/note" for any new transaction from that transaction alone, without opening another screen.
- **SC-003**: Client phone is present on 100% of new transactions where the cashier entered or picked a client with a phone.
- **SC-004**: 0 differences in amounts, profits, balances and drawer movements before and after the change for the same inputs.
- **SC-005**: The same inputs on desktop and web produce identical details in 100% of tested cases.

## Assumptions

- The audit file is the source of truth for which fields each type is missing; fields found during implementation that the audit missed are added to the same list.
- Existing payment records stay the source of truth for drawers and balances; the payment snapshot is a copy for reading.
- Fields that are computed rather than entered (e.g. market rate, default price, per-leg profit) are included when the audit lists them as missing, since they explain the transaction.
- Display work (summary wording, a details view) follows in a separate ticket.
- The seven suspected bugs in section 3 of the audit are handled separately.
