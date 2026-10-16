# Feature Specification: One Mobile Recharge basket across providers

**Feature Branch**: `main` (no feature branch; owner works on main)
**Ticket**: LIRA-326
**Created**: 2026-10-16
**Status**: Draft
**Input**: Owner request (2026-10-16): items picked on one provider's grid (Katsh, iPick, Whish App) are lost when the cashier switches to another provider tab; all picked items should appear together in the payment window and be paid once.

## Background

On Mobile Recharge, iPick and Katsh share one screen and one basket; Whish App has its own screen and basket; the MTC / Alfa card grid has its own. Switching to a tab with a different screen throws the previous basket away.

Worse, a basket that holds both iPick and Katsh items is booked today as **one sale under the tab the cashier pressed Pay on**: every item's cost leaves that provider's balance and is recorded against that provider's supplier, even for items bought from the other provider. A mixed basket therefore silently corrupts two balances and two supplier ledgers.

The payment window already lists picked items grouped by provider, with subtotals, and scrolls (built 2026-10-16). This feature makes the basket behind it real.

## Clarifications

### Session 2026-10-16

- Owner (2026-10-16): "one sale from iPick and Katsh together should be considered as a session … a walk-in customer session, without opening a session — automated." → A basket holding items from 2+ providers is recorded as an automatic **walk-in customer session** when it is paid (named "Walk-in", or the client's name), closed at once, linking one sale per provider; no one opens a session by hand. A single-provider basket stays a single sale as today.

- Q: Can one provider's part of a paid basket be voided or refunded on its own? → A: No — a paid basket is voided or refunded as a whole (same rule as a customer-session basket today: a single basket item's refund/void is refused and the cashier is pointed to the whole-basket reversal). Decided by the assistant under the owner's blanket delegation (2026-10-16); owner may overrule.
- Q: How long does an unpaid basket live? → A: Until it is paid or cleared, for as long as the app stays open — across tab switches and across moving to other pages and back. It is not kept after the app is closed or reloaded. Decided by the assistant under the owner's blanket delegation (2026-10-16); owner may overrule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick on several provider tabs, pay once (Priority: P1)

A customer wants a Katsh Alfa card, an iPick gaming card and a Whish App Netflix card. The cashier picks the Katsh card on the Katsh tab, the gaming card on the iPick tab and the Netflix card on Whish App → Bills, then presses Proceed to Pay on any of those tabs. One payment window lists all three items grouped under Katsh, iPick and Whish App with a subtotal each; the customer pays once.

**Why this priority**: it is the request, and it removes today's silent mis-booking of mixed baskets.

**Independent Test**: pick one item on each of three provider tabs, switch tabs back and forth, open the payment window from any tab, pay cash; check that three sales are recorded, one per provider, and each provider's balance went down by exactly its own items' cost.

**Acceptance Scenarios**:

1. **Given** two Katsh items are picked, **When** the cashier switches to Whish App and back, **Then** the two Katsh items are still picked and the Katsh tab still shows a count of 2.
2. **Given** items are picked on Katsh, iPick and Whish App, **When** the cashier presses Proceed to Pay on any of these tabs, **Then** the payment window lists every picked item, grouped by provider, with each provider's subtotal, and the total due is the sum of all items.
3. **Given** that window is paid in full in cash, **When** the payment is confirmed, **Then** one sale is recorded per provider, each item's cost is taken from its own provider's balance and recorded against its own provider's supplier, the cash drawer receives the full amount once, and the basket is emptied.
4. **Given** the basket holds only items from the tab the cashier is on, **When** it is paid, **Then** the result is identical to today's single-provider sale.

---

### User Story 2 - Today's mixed iPick + Katsh booking is fixed (Priority: P1)

A basket with iPick and Katsh items is paid from the Katsh tab.

**Why this priority**: today this books the iPick items under Katsh. It is a money defect independent of the new tab behaviour.

**Independent Test**: pick 1 iPick and 1 Katsh item, pay from the Katsh tab; the iPick balance drops by the iPick item's cost and the Katsh balance by the Katsh item's cost; supplier ledgers likewise.

**Acceptance Scenarios**:

1. **Given** a basket with one iPick item (cost A) and one Katsh item (cost B), **When** it is paid from either tab, **Then** iPick's balance changes by −A, Katsh's by −B, and neither provider is charged for the other's item.

---

### User Story 3 - The customer pays in mixed ways and currencies (Priority: P2)

The basket mixes LBP items (Katsh) with a Whish App item sold in USD. The customer pays part in dollars and part in pounds, gets change, or puts part on their account.

**Why this priority**: the payment window already supports split legs, discount, extra, kept change and client account; a combined basket must keep all of them working and reconciling per currency.

**Independent Test**: pay a mixed LBP + USD basket with a USD cash leg and an LBP cash leg plus change; the legs reconcile against the basket total and every drawer and balance moves exactly once.

**Acceptance Scenarios**:

1. **Given** a basket with LBP items and a USD Whish App item, **When** the customer pays with split legs in both currencies, **Then** the payment is accepted only if the legs cover the basket total at the till's rate, and each provider sale records its own amount in its own currency.
2. **Given** a discount or an extra is entered on the combined basket, **When** it is paid, **Then** the discount or extra is applied once to the basket and shared across the provider sales by a single published rule, and no provider sale goes below its cost because of the discount.
3. **Given** part of the basket goes on the customer's account, **When** it is paid, **Then** the customer owes exactly that part once, not once per provider.

---

### User Story 4 - Undo a paid basket correctly (Priority: P2)

A paid combined basket has to be voided or refunded.

**Why this priority**: a combined payment that cannot be reversed cleanly leaves money stuck in drawers or balances.

**Independent Test**: pay a 3-provider basket, then void/refund it; every provider balance, supplier ledger, drawer, client debt and profit returns to its value before the sale, per currency.

**Acceptance Scenarios**:

1. **Given** a paid 3-provider basket, **When** it is voided or refunded as a whole, **Then** every ledger it touched returns to its pre-sale value, per currency.
2. **Given** a paid combined basket, **When** the cashier tries to reverse one provider's sale on its own, **Then** the reversal is refused with a message pointing to reversing the whole basket, and nothing moves.

---

### User Story 5 - Manage the basket across tabs (Priority: P3)

The cashier changes their mind about an item picked on another tab.

**Acceptance Scenarios**:

1. **Given** items from several providers are picked, **When** the cashier opens any provider tab, **Then** that tab shows its own items as selected and the other tabs show their counts.
2. **Given** the payment window is open, **When** the cashier removes an item or empties a provider's group, **Then** the totals, subtotals and tab counts update and nothing is booked for it.
3. **Given** a customer session is open, **When** the cashier picks items, **Then** they go to the session basket exactly as today (this feature does not change session behaviour).

### Edge Cases

- A provider's item becomes unavailable (removed or deactivated in Settings) while it sits in the basket: it is flagged in the payment window and the basket cannot be paid until it is removed.
- The Whish App LBP | USD switch is changed while Whish App items are in the basket: today's "confirm, then clear" rule applies to the Whish App items only; other providers' items stay.
- For Partner checkouts: a partner order is per provider today; mixing partner and walk-in items in one basket is out of scope — For Partner keeps working per tab on that tab's items only.
- Bills added on the iPick / Katsh bill card belong to the provider they were added on and are booked with that provider's sale.
- A provider's balance is too low for its part: handled exactly as today for a single sale (no new rule).
- One provider's sale fails while booking: nothing is booked for any provider and no money moves (all-or-nothing).
- MTC / Alfa top-ups by phone number (not the card grid), money transfers (Whish / OMT send/receive) and Binance are not part of the basket.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Items picked on the iPick, Katsh, Whish App (Bills) and MTC / Alfa card grids MUST go into one shared basket that survives switching between Mobile Recharge tabs.
- **FR-002**: Each provider tab MUST show its own picked items as selected and a count of its items; counts for other providers remain visible on their tabs.
- **FR-003**: Proceed to Pay on any tab with a grid MUST open one payment window listing every item in the basket, grouped by provider, with a subtotal per provider and the basket total.
- **FR-004**: Paying the basket MUST record one sale per provider; each sale MUST take its items' cost from that provider's own balance and record it against that provider's own supplier — never against the tab the payment was started from.
- **FR-005**: The customer MUST pay the basket once: payment legs, discount, extra, kept change, waived remainder and client-account amounts apply to the basket as a whole, reconcile against the basket total per currency, and are booked to drawers and client debt exactly once.
- **FR-006**: A discount or extra on the basket MUST be shared across the provider sales by one documented rule, and a discount MUST NOT take any provider sale below its cost.
- **FR-007**: Recording a basket MUST be all-or-nothing: if any provider's sale cannot be recorded, nothing is recorded and no money moves.
- **FR-008**: Each provider sale's profit MUST be stamped on that sale, and the per-provider sales MUST be visibly linked as one basket in Transactions.
- **FR-009**: Reversing a paid basket MUST return every ledger it touched (provider balances, supplier ledgers, drawers, client debt, profit, carrier lines for Only Days items) to its pre-sale value, per currency, as a whole; reversing one provider's sale on its own MUST be refused.
- **FR-010**: A basket containing only one provider's items MUST be recorded exactly as a single-provider sale is today (same rows, same amounts).
- **FR-011**: Items can be removed from the basket from the payment window and from their provider's grid; totals, subtotals and tab counts update immediately.
- **FR-012**: Inside an open customer session, picks MUST keep going to the session basket as today.
- **FR-013**: The basket MUST work identically in the desktop app and the web app.
- **FR-014**: An unpaid basket MUST survive tab switches and leaving/returning to Mobile Recharge while the app stays open; it is NOT kept after the app is closed or reloaded.
- **FR-015**: Changing the Whish App currency with Whish App items in the basket MUST confirm and then clear only the Whish App items.

### Key Entities

- **Basket**: the picked-but-unpaid items across providers; each line has provider, item, quantity, unit price as charged (incl. Only Days price), currency, and optional Only Days details.
- **Basket payment**: the one set of payment legs, discount, extra, kept change and client-account amount the customer settles for the whole basket.
- **Provider sale**: one recorded sale per provider in a paid basket, carrying that provider's items, cost, price, profit and currency, linked to the basket payment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can pick items on three different provider tabs and complete one payment for all of them without re-picking anything.
- **SC-002**: For every paid basket, each provider's balance changes by exactly the cost of that provider's items — 0 mis-booked items across providers in testing.
- **SC-003**: Paying then reversing a basket returns every touched balance, ledger, drawer and debt to its starting value, per currency, in 100% of test cases (including mixed LBP + USD, split legs, change kept, account payment, discount, extra).
- **SC-004**: Single-provider baskets produce records identical to today's for the same inputs.
- **SC-005**: The same scenarios pass on desktop and web.

## Assumptions

- The existing customer-session basket checkout (one payment across several module entries, booked per module, reversed as a whole) is the model and, where possible, the implementation reused.
- Discount/extra sharing follows the rule the session basket checkout already uses (capped at each item's profit for discounts).
- Partner (For Partner) orders stay per tab and are not mixed into the shared basket.
- MTC / Alfa phone-number top-ups, money transfers and Binance are not part of the basket; only card grids are.
- Low provider balance handling is unchanged.
- The tab-count badges and the grouped, scrollable items list in the payment window already exist and are reused.
