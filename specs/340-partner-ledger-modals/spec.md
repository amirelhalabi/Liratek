# Feature Specification: Partner Transactions and Payments in their own windows

**Feature Branch**: `main` (no feature branch; owner works on main)

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Partners page: show each partner's Transactions and Payments in modals, like the Suppliers page (LIRA-340). First verify what the partner ledger holds and whether it is enough to show Transactions and Payments; then show them the same way the Suppliers page does: two header buttons opening each list in its own window. Desktop and web. New UI gets a What's new card with a real screenshot."

## Findings before specifying (verified 2026-10-25)

- **The partner ledger already records every partner movement.** Each entry has a type, an amount, a currency (USD, LBP or USDT), a direction (the partner owes us / we owe the partner), notes, the user, a settlement method (Cash, OMT, Whish, Binance, client account or Split) and how much of it a later settlement covered.
- **Entry types fall into two groups:**
  - *Business with the partner*: For Partner orders (POS, Mobile Recharge, Katsh, iPick, OMT/Whish system and app transfers, Binance, Loto, Exchange, Custom Services), Via/Through transfers done on the partner's system, Whish top-ups through the partner, and manual credit/debt entries ("Add credit / debt").
  - *Money that settles the balance*: settlements (either direction, including Split) and write-offs/discounts (either side forgiving part of the balance).
- **The Partners page already shows this ledger**, as ONE mixed table inline on the partner's panel, with filters (dates, mode, provider, direction). So nothing new has to be stored; this feature reorganises how the existing ledger is shown, the way the Suppliers page was reorganised.

## Clarifications

### Session 2026-10-25

- Q: Where do manual "Add credit / debt" entries go? → A: Same as Suppliers: Payments.
- Q: Where do write-offs/discounts go? → A: Same as Suppliers (Pay-form discount shows in its ledger): Payments.
- Q: Payments window filters? → A: Dates only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a partner's transactions in their own window (Priority: P1)

The owner opens a partner on the Partners page and clicks "Transactions (N)". A window opens listing everything done with or for that partner: orders, transfers and top-ups, newest first, with date, type, amount and currency, who owes whom, notes, and the linked customer/reference details already shown today. The partner panel itself stays short.

**Why this priority**: This is most of the ledger and the main reason the panel is long today.

**Independent Test**: Open a partner that has For Partner orders and a settlement; the Transactions window lists the orders and not the settlement, and its count matches the button.

**Acceptance Scenarios**:

1. **Given** a partner with 12 business entries and 3 settlements, **When** the owner opens the partner, **Then** the header shows "Transactions (12)" and "Payments (3)" and no ledger table is on the panel.
2. **Given** the Transactions window is open, **When** the owner filters by date, mode, provider or direction, **Then** the list and its count follow the filters as today.
3. **Given** the window is open, **When** the owner presses Escape, clicks the close button or clicks outside it, **Then** it closes and the panel is unchanged.

---

### User Story 2 - See a partner's payments in their own window (Priority: P1)

The owner clicks "Payments (N)" and sees every settlement, write-off and manual credit/debt entry with that partner, in both directions: date, amount and currency, direction (partner paid us / we paid the partner / forgiven), method (including Split) and notes.

**Why this priority**: Answers "what have they paid me / what have I paid them" without scrolling through orders.

**Independent Test**: Settle a partner with $200 cash + $100 Whish and write off $15; the Payments window shows both, the settlement reading "Split".

**Acceptance Scenarios**:

1. **Given** a settlement paid in two methods, **When** the Payments window opens, **Then** that row shows the method as Split and the full amount.
2. **Given** a write-off of $15 by the partner and a discount given by the shop, **When** the Payments window opens, **Then** both appear and read as forgiven, each in its own direction.
3. **Given** a partner with no settlements, **When** the owner opens the partner, **Then** the button reads "Payments (0)" and the window shows a plain empty message.

---

### User Story 3 - Same look and behaviour as the Suppliers page (Priority: P2)

The two buttons and windows look and behave like the Suppliers page ones (same button style, window size, close behaviour, loading and error states), so cashiers learn one pattern.

**Why this priority**: Consistency; reuses the existing window instead of a second copy.

**Independent Test**: Put the Suppliers and Partners pages side by side; buttons and windows match.

**Acceptance Scenarios**:

1. **Given** the ledger fails to load, **When** the owner opens either window, **Then** it shows the error with a Retry, not an empty list.
2. **Given** the web app and the desktop app, **When** the same partner is opened, **Then** both show the same counts and rows.

### Edge Cases

- A partner with hundreds of entries: the window scrolls; the counts on the buttons are the full totals, not a page.
- A settlement that is later voided: it stays listed with a voided tag, the same as voided business entries today, and is not counted as money received.
- Mixed currencies (USD, LBP, USDT): each row keeps its own currency; nothing is converted.
- An entry of a type not listed above (future types): it goes under Transactions, so nothing is ever hidden.
- Recording a settlement, write-off or "Add credit / debt" while a window is open: the counts and lists refresh after saving.
- Staff (non-admin) users see exactly what they see in today's ledger table, no more.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The partner panel MUST show two header buttons, "Transactions (N)" and "Payments (N)", where N is the number of matching ledger entries for that partner.
- **FR-002**: The inline ledger table MUST be removed from the partner panel; its content moves into the two windows.
- **FR-003**: Payments MUST contain the settlement, write-off/discount and manual credit/debt (adjustment) entries, in both directions; Transactions MUST contain every other entry type (the business done with or for the partner), including any type added in the future. This mirrors the Suppliers page, whose Payments window is the supplier ledger (payments, paper adjustments, discounts) and whose Transactions window is the business done through the supplier.
- **FR-004**: Each window MUST show the same columns and details as today's ledger table (date, type, amount with currency, direction, method incl. Split, notes, customer/reference/provider details, voided state).
- **FR-005**: The existing ledger filters (dates, mode, provider, direction) MUST remain available inside the Transactions window and MUST NOT be lost; the Payments window MUST offer the date filter only.
- **FR-006**: The windows MUST use the same window component and look as the Suppliers page windows (one shared component, not a copy).
- **FR-007**: Windows MUST close on Escape, on the close button and on clicking outside, and MUST show loading, empty and error-with-Retry states.
- **FR-008**: Counts and lists MUST refresh after any partner money action on the page (settle, write-off, add credit/debt, void).
- **FR-009**: The feature MUST work identically on the desktop app and the web app, reading the same ledger through the existing partner ledger read.
- **FR-010**: No money, balance, ledger entry or settlement behaviour changes; this is display only.
- **FR-011**: The change MUST ship with a release-note line and a What's new card with a real landscape screenshot of the Partners page windows.

### Key Entities

- **Partner ledger entry**: one movement with a partner — type, amount, currency, direction, notes, user, settlement method, covered amount, link to the originating transaction, date, voided state. Classified for display as either a *Transaction* (business) or a *Payment* (settlement or write-off/discount).
- **Partner**: the shop's partner, with its balance; owns the ledger entries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any partner, Transactions count + Payments count equals the total number of ledger entries shown today (nothing lost, nothing double-listed).
- **SC-002**: The owner can find "what this partner paid me" in 2 clicks or fewer from opening the partner.
- **SC-003**: The partner panel without the inline table fits without scrolling on a 1280×800 screen for a partner with any number of entries.
- **SC-004**: Desktop and web show identical counts and rows for the same partner (checked by an automated web test and the desktop test over the web shim).

## Assumptions

- Owner decision 2026-10-25: follow the Suppliers page. There, manual "Add credit / debt" (paper adjustment) and the discount bundled into the Pay form both show in the Payments window (the supplier ledger); the standalone supplier "Write off" was removed earlier and the Pay-form discount replaced it. So partner adjustments and write-offs/discounts go under Payments.
- Owner decision 2026-10-25: the Payments window has the date filter only.
- Voided entries stay visible with their tag, as today.
- No new data needs to be stored; the existing ledger read and its filters are enough. If the plan finds the read cannot return counts per group cheaply, counting may be done on the screen from the same rows.
- Ticket LIRA-340 is added to current_sprint.md with a "What users will notice" line.
