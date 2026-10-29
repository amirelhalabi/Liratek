# Feature Specification: Loto on Settle Account (day calendar)

**Feature Branch**: `351-loto-settle-calendar` (work happens on `main`; ticket LIRA-351)

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description (owner, 2026-10-29): "Loto on Settle Account with the day calendar, like every other supplier." Loto is the last supplier still paid through the old Pay / Receive tab and the Loto page's checkpoint settling, which record payments that are not tied to a shop day.

**Builds on**: LIRA-343 (OMT settlement by day), LIRA-345 (settle calendar for the other suppliers), LIRA-310 (waive), LIRA-322 (amount-first settlement, one currency at a time).

## Clarifications

### Session 2026-10-29 (owner decisions)

- Q: How are Loto's past sales closed so the calendar starts clean? → A: Every ticket and cash prize inside a checkpoint that was already settled is marked paid on the calendar automatically. Only sales and prizes not yet settled show. The Loto balance does not change.
- Q: What happens to checkpoints on the Loto page? → A: Loto is settled only on the calendar (Suppliers → Loto → Settle Account). The Loto page keeps its sales and prizes report but loses its settle buttons.
- Q: How do cash prizes count on the calendar? → A: They net within their shop day, like OMT receives against sends.
- Q: What happens to the Pay / Receive tab for Loto? → A: It is removed. The waive (up to 450,000 LBP) stays, inside Settle Account.
- Aligned with the house rule (LIRA-343 owner decision, option 3): a ticket paid through the calendar can still be voided; its paid share becomes Loto credit. Tickets in checkpoints settled before this feature stay non-voidable.
- Settled from the code map (no question needed): the shop earns its Loto commission at the sale, so the Loto calendar takes no commission at settlement; the Loto "Settle" tick list on the Suppliers page is always empty and is removed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pay Loto for the days owed (Priority: P1)

The shop owner opens Suppliers → Loto → Settle Account, sees a calendar of the days with Loto tickets and prizes not yet paid, picks the days being settled and records the payment. Those days turn settled and the Loto balance goes down by the amount paid.

**Why this priority**: This is the feature. Without it Loto keeps being paid through screens that do not say which days a payment covers, which is how a payment ends up paying the wrong day (found on Cornertech with a product supplier, 2026-10-29).

**Independent Test**: On a shop with Loto sales on two days and nothing settled, settle the older day only and check that it shows settled, the newer day stays open, and the balance dropped by exactly that day's amount.

**Acceptance Scenarios**:

1. **Given** Monday has 3 tickets of 120,000 LBP (commission 4.45%, so 114,660 owed each) and nothing else, **When** the owner opens Settle Account for Loto, **Then** Monday shows 343,980 LBP owed to Loto and is picked by default.
2. **Given** that Monday, **When** the owner pays 343,980 LBP in cash for Monday, **Then** Monday shows settled, the cash leaves the drawer, and the Loto balance goes down by 343,980 LBP.
3. **Given** two open days, **When** the owner pays less than both owe, **Then** the oldest tickets close first and the last one reached is part-paid, the same as for other suppliers.
4. **Given** the owner pays more than the picked days owe, **When** the payment is saved, **Then** the picked days close and the extra becomes credit with Loto, used first next time.

---

### User Story 2 - Prizes reduce the day they were paid (Priority: P1)

When the shop pays out a cash prize, Loto owes the shop that amount. On the calendar the prize nets against that day's sales, so a day can end with Loto owing the shop.

**Why this priority**: Prizes are part of every Loto day; without netting, the calendar shows the wrong amount and direction.

**Independent Test**: A day with 343,980 LBP of sales owed and one 500,000 LBP prize shows Loto owing the shop 156,020 LBP; settling it as "Loto pays the shop" closes the day.

**Acceptance Scenarios**:

1. **Given** Monday with 343,980 LBP owed for tickets and a 500,000 LBP prize paid by the shop, **When** the calendar opens, **Then** Monday shows Loto owes the shop 156,020 LBP.
2. **Given** that Monday, **When** the owner records Loto paying the shop 156,020 LBP, **Then** Monday shows settled and the money enters the drawer.

---

### User Story 3 - The past is already settled (Priority: P1)

When the feature arrives, every ticket and prize that the shop already settled through a Loto checkpoint shows as paid on the calendar. Only what was never settled shows as open. The Loto balance is the same before and after.

**Why this priority**: Without it the calendar would show every Loto sale ever made as unpaid on the first day, and the owner could pay them twice.

**Independent Test**: On a shop with two settled checkpoints and some tickets after the last one, open the calendar: only the tickets after the last settled checkpoint show open, and the Loto balance equals what it was before the update.

**Acceptance Scenarios**:

1. **Given** checkpoints settled through Friday and new tickets on Saturday, **When** the calendar opens after the update, **Then** days up to Friday show settled and Saturday shows open.
2. **Given** a checkpoint that was created but never settled, **When** the calendar opens, **Then** its tickets and prizes show open on their own days.
3. **Given** past Pay / Receive payments to Loto that were never tied to a checkpoint, **When** the calendar opens, **Then** they show as Loto credit (or a debt the shop owes), so the balance shown matches the Loto balance.

---

### User Story 4 - One place to settle Loto (Priority: P2)

The owner pays Loto only from Settle Account. The Loto page still shows sales and prizes per period, but no longer offers to settle a checkpoint, and the Suppliers page no longer shows a Pay / Receive tab or an empty "Settle" list for Loto.

**Why this priority**: Two places to pay the same supplier is how payments land on the wrong days. Removing the old paths keeps every Loto payment tied to days.

**Independent Test**: Open the Loto page and the Suppliers page for Loto: no checkpoint settle button, no Pay / Receive tab, no Settle tick list; a Settle Account button is present.

**Acceptance Scenarios**:

1. **Given** the Suppliers page with Loto selected, **When** it loads, **Then** it shows a Settle Account button and no tab bar.
2. **Given** the Loto page, **When** the owner views checkpoints, **Then** they can see the sales and prize totals but there is no way to settle a checkpoint there.

---

### User Story 5 - Waive a small difference (Priority: P3)

When settling Loto, the owner can waive a small leftover (up to 450,000 LBP), the same waive the Pay / Receive tab offered.

**Why this priority**: Keeps an existing capability after the old tab is removed; rarely needed.

**Independent Test**: Settle a day owing 343,980 LBP by paying 340,000 and waiving 3,980; the day shows settled and the waive is recorded.

**Acceptance Scenarios**:

1. **Given** a day owing 343,980 LBP, **When** the owner pays 340,000 LBP and waives 3,980 LBP, **Then** the day closes and the waive appears in the settlement's details.
2. **Given** a waive above 450,000 LBP, **When** the owner tries to save, **Then** it is refused with the cap in the message.

### Edge Cases

- A ticket is voided after its day was settled on the calendar: allowed, like a paid transfer on every other calendar supplier (LIRA-343); its paid share becomes Loto credit (↺). A ticket inside a checkpoint settled before this feature stays refused, as today.
- A ticket is voided while its day is still open: allowed; its day's amount drops.
- A settlement is voided: its days reopen, the drawer movement is reversed, and the days' tickets become voidable again.
- A day with only a prize (no sales): Loto owes the shop the prize amount that day.
- A Loto sale sold through a customer session basket or on a customer's account: it still counts on its own shop day (the supplier side does not depend on how the customer paid).
- A Loto sale for a partner (For Partner): counts on the Loto calendar like any other sale; the partner side is unchanged.
- Loto in USD: Loto is LBP-only today; a USD amount, if any exists, settles in USD on its own, like other suppliers.
- Settling with a custom time ("Set custom time") works as on every other supplier's Settle Account.
- A shop with no Loto history: the calendar is empty; nothing to backfill.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Loto MUST use the same Settle Account day calendar as the other suppliers, on desktop and web.
- **FR-002**: The calendar MUST show each shop day's Loto amount as tickets owed (sale minus commission) minus prizes paid, netted per day.
- **FR-003**: Settling MUST follow the existing rules: pick days, oldest first within the picked days, one currency at a time, overpay becomes Loto credit, credit can be used, custom time allowed.
- **FR-004**: Settling Loto MUST NOT book a commission; the commission is already earned at the sale.
- **FR-005**: The waive (up to 450,000 LBP) MUST be available in Loto's Settle Account.
- **FR-006**: When the feature arrives, every ticket and prize inside an already-settled checkpoint MUST count as paid on the calendar, without changing the Loto balance or any drawer.
- **FR-007**: Tickets and prizes not inside a settled checkpoint MUST show as open on their own shop day.
- **FR-008**: Past Loto payments not tied to a checkpoint (old Pay / Receive) MUST appear on the calendar as Loto credit or debt so the calendar agrees with the Loto balance.
- **FR-009**: A ticket inside a checkpoint settled before this feature MUST stay refused for void or refund (as today). A ticket paid through the calendar MAY be voided; its paid share MUST become Loto credit, the same rule as every other calendar supplier.
- **FR-010**: Voiding a Loto settlement MUST reopen its days and reverse its drawer movement and waive.
- **FR-011**: The Suppliers page MUST NOT show the Pay / Receive tab or the Settle tick list for Loto, and MUST show the Settle Account button.
- **FR-012**: The Loto page MUST keep showing checkpoint sales, commission and prize totals but MUST NOT offer to settle a checkpoint.
- **FR-013**: The server MUST refuse the old checkpoint-settle and Pay / Receive paths for Loto on both transports, so an old screen or app version cannot record an untied Loto payment.
- **FR-014**: Every user-visible change MUST get release notes, and the new Settle Account for Loto a "What's new" card with a real screenshot.

### Key Entities

- **Loto ticket**: a sale; owes Loto the sale amount minus the shop's commission, on the shop day it was sold.
- **Cash prize**: paid out by the shop; Loto owes the shop the prize amount, on the shop day it was paid.
- **Loto checkpoint**: a past bundle of tickets and prizes; settled ones are history that counts as paid.
- **Loto settlement**: a Settle Account payment to or from Loto, covering picked days.
- **Loto credit**: money Loto holds for the shop (overpay, old untied payments), used by the next settlement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On every existing shop, the Loto balance shown before the update equals the balance after it, to the last LBP.
- **SC-002**: Right after the update, no ticket or prize from a settled checkpoint shows as open on the calendar.
- **SC-003**: An owner can settle a Loto day in under a minute from the Suppliers page, without opening the Loto page.
- **SC-004**: Zero Loto payments recorded after the update are untied to days (every one covers picked days or becomes credit).
- **SC-005**: Recording a ticket, prize, settlement and their voids leaves the drawer, the Loto balance and profit netting to zero per currency.

## Assumptions

- Loto is LBP-only in practice; the rules still handle USD like other suppliers.
- "Shop day" is the existing one-shop-day rule used by every calendar (the shop's local day).
- The Loto page's checkpoint creation (counting what was sold since the last count) can stay as a report; only settling moves.
- The history step runs once per shop when the update is installed, on desktop and on the web server.
- The existing settle calendar, credits, custom time and waive behave for Loto exactly as for other suppliers; no Loto-specific look is needed.
