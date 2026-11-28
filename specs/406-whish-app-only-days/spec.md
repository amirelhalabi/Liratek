# Feature Specification: Whish App "Only Days" for MTC / Alfa prepaid cards

**Feature Branch**: `406-whish-app-only-days` (work happens on `main`; ticket LIRA-406)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description (owner, 2026-11-28): "Whish App 'Only Days' for MTC / Alfa prepaid cards: on Mobile Recharge → Whish App (Bills), an MTC or Alfa prepaid card that carries both credit and validity days can be sold 'Only Days', exactly like Katsh and iPick already do: the customer keeps the days, pays the Only Days price, and the card's credit is SMSed back to the shop, landing in the shop's MTC / Alfa USD drawer and on the shop's primary line for that carrier; profit nets the returned credit off the card cost. Must work for walk-in sales, customer-session basket, cross-provider basket checkout, and For Partner orders, on desktop and web. Refund/void reverses drawer, line and profit. Whish App USD mode stays out (prepaid cards are LBP-only there)."

**Builds on**: LIRA-090 (Only Days on Katsh / iPick), LIRA-153 (profit nets the returned credit), LIRA-324 (Whish App LBP | USD switch; prepaid cards LBP-only), LIRA-326 / LIRA-327 (one Mobile Recharge basket, basket-wide For Partner), LIRA-405 (partner orders send the returned credit).

**Why now**: Whish App sells the same physical MTC and Alfa cards as Katsh and iPick, and its catalog already carries their credit, validity days, days cost and Only Days price. Only Days was built for "both reseller apps" (Katsh, iPick) in LIRA-090 and Whish App was never added: there is no Only Days option on the Whish App screen, and the system refuses to book returned credit for a Whish App sale. A cashier who wants to sell a Whish App card for its days only cannot.

## Clarifications

### Session 2026-11-28 (owner decisions recorded with the request)

- Q: Which sale modes? → A: All of them: walk-in, customer-session basket, cross-provider basket checkout and For Partner, on both the desktop and web apps.
- Q: Whish App USD mode? → A: Out. Prepaid cards stay LBP-only in Whish App (LIRA-324), so Only Days is LBP-only too.
- Q: How should it behave? → A: Exactly like Katsh and iPick: same Only Days price, same returned-credit amount and override, same drawer, line, profit and reversal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sell a Whish App card "Only Days" to a walk-in customer (Priority: P1)

A cashier opens Mobile Recharge → Whish App → Bills, picks the Alfa 7.58 card, opens its details and ticks "Only Days". The price drops to the Only Days price (for example 250,000 LBP) and the returned credit shows the amount the shop gets back ($7.00 for a 7.58 card). The customer pays and the sale is saved. The Whish App balance pays the full card cost, the shop's Alfa balance goes up by $7.00, the shop's main Alfa line gets $7.00 of credit, and the sale's profit counts the returned credit against the card cost.

**Why this priority**: This is the feature. Without it the shop either loses the card's credit or has to switch to Katsh / iPick for the same card.

**Independent Test**: Sell one Whish App Alfa card Only Days, paid in cash, and check the Whish App LBP balance, the Alfa USD balance, the main Alfa line's credit and the sale's profit; then refund it and check every one returns to where it was.

**Acceptance Scenarios**:

1. **Given** Whish App Bills in LBP mode with an Alfa or MTC prepaid card that has both credit and validity days, **When** the cashier opens the card's details, **Then** an "Only Days" option is shown, exactly as on Katsh and iPick.
2. **Given** "Only Days" is ticked, **When** the cashier looks at the price, **Then** it is the Only Days price (days price plus any credit the customer keeps), computed the same way Katsh and iPick compute it, and the returned credit defaults to the most credit the card can send back.
3. **Given** an Only Days Whish App sale of the Alfa 7.58 card (cost 765,007 LBP) saved with the default returned credit, **When** it is saved, **Then** the Whish App LBP balance goes down by 765,007, the Alfa USD balance goes up by $7.00, and the shop's main Alfa line gets $7.00 of credit.
4. **Given** the cashier typed a different returned credit (including 0), **When** the sale is saved, **Then** exactly the typed amount is returned.
5. **Given** an Only Days Whish App sale, **When** it is refunded or voided, **Then** the Whish App balance, the Alfa / MTC balance, the shop line's credit and the profit all return to their values before the sale.
6. **Given** an MTC card instead of Alfa, **When** it is sold Only Days, **Then** the credit goes to the MTC balance and the shop's main MTC line.

---

### User Story 2 - Only Days in the customer session and the cross-provider basket (Priority: P1)

A customer session is open. The cashier adds a Whish App MTC card Only Days to the session basket (or picks Whish App and Katsh cards together and pays once). At checkout, the Whish App card books exactly what a walk-in Only Days sale books.

**Why this priority**: Most sales in a busy shop go through the session basket or the one-payment basket; a feature that only works walk-in would be skipped by cashiers.

**Independent Test**: Add a Whish App Only Days card to a session basket, check out, and compare the drawers, line and profit with the walk-in sale from Story 1; do the same through a basket that also holds a Katsh card.

**Acceptance Scenarios**:

1. **Given** an open customer session, **When** a Whish App Only Days card is added and the session is checked out, **Then** the returned credit reaches the carrier balance and the main line, the same as walk-in.
2. **Given** a basket with Whish App and Katsh cards, both Only Days, **When** it is paid once, **Then** each card's credit reaches its own carrier balance and line, and each provider pays its own card cost.
3. **Given** a paid basket holding a Whish App Only Days card, **When** it is refunded as a whole, **Then** every balance, line and profit it touched returns to its value before the sale.

---

### User Story 3 - Only Days for a partner (Priority: P2)

The cashier turns on "For Partner", picks a partner, and adds a Whish App Alfa card Only Days. On submit, the partner owes the Only Days price, the Whish App balance pays the card cost, and the returned credit reaches the Alfa balance and the main Alfa line.

**Why this priority**: Partner sales are less frequent than walk-in and session sales, but they must not lose the credit (the exact defect LIRA-405 fixed for Katsh / iPick).

**Independent Test**: Submit a partner order with one Whish App Only Days card and check the partner's balance, the Whish App balance, the carrier balance and the line; void it and check everything returns to zero.

**Acceptance Scenarios**:

1. **Given** For Partner is on, **When** a Whish App Only Days card is submitted, **Then** the partner owes the Only Days price and the returned credit reaches the carrier balance and main line.
2. **Given** that partner sale, **When** it is voided, **Then** the partner balance, the Whish App balance, the carrier balance and the line all return to their values before the sale.

---

### Edge Cases

- **Card without both credit and days** (e.g. Alfa 1.22 / 3.03, MTC 1 / 1.67, data bundles, validity-only items): no Only Days option, as on Katsh / iPick.
- **USD mode**: prepaid cards are not shown in USD mode, so Only Days never appears there.
- **Card whose days cost is not set** (split incomplete): the option still shows and the cashier types the returned credit by hand, as on Katsh / iPick.
- **No main line set up for the carrier**: the carrier balance is still credited and the sale goes through; only the line movement is skipped, as on Katsh / iPick.
- **Several units of the same card, or Alfa and MTC cards together**: each unit returns its own credit to its own carrier.
- **Basket discount**: spread over the cards exactly as it is today; Only Days changes the unit price the discount is spread over, not the discount rules.
- **Wrong number, Charge to shop line**: unchanged; they do not use Only Days.
- **Older Whish App sales**: unchanged; nothing is recalculated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Whish App card details MUST offer "Only Days" for every MTC or Alfa card that Katsh and iPick would offer it for (same rule), and only in LBP mode.
- **FR-002**: The Only Days price, the default returned credit, the returned-credit override (including 0) and the editable days and credit prices MUST be computed by the same rules Katsh and iPick use, with no second copy of those rules.
- **FR-003**: Saving a Whish App Only Days sale MUST book the returned credit into the carrier's USD balance (Alfa or MTC) and onto the shop's main line for that carrier, and MUST net its value off the card cost in the sale's profit, exactly as a Katsh / iPick Only Days sale does.
- **FR-004**: The Whish App balance MUST still pay the full card cost; Only Days changes what the customer pays and what comes back, not what Whish charges.
- **FR-005**: FR-003 and FR-004 MUST hold for walk-in sales, the customer-session basket, the cross-provider basket checkout and For Partner orders.
- **FR-006**: FR-003 to FR-005 MUST hold on both the desktop app and the web app, through the same payload for each sale mode.
- **FR-007**: Refunding or voiding a Whish App Only Days sale (alone, or as part of a basket) MUST return the Whish App balance, the carrier balance, the shop line's credit, the profit and any partner balance to their values before the sale, per currency.
- **FR-008**: The sale's record MUST show it was sold Only Days and how much credit came back, the same way Katsh / iPick Only Days sales show it (note, transaction details, Profits drill-down).
- **FR-009**: Whish App sales that are not Only Days, and all Katsh / iPick behaviour, MUST stay exactly as they are.

### Key Entities

- **Prepaid card (catalog item)**: an MTC or Alfa card sold through Whish App, with cost, selling price, face credit, validity days, days cost, Only Days price and an optional maximum returned credit. Already present for Whish App cards; nothing new is stored.
- **Returned credit**: the USD credit the customer SMSes back on an Only Days sale; lands in the carrier's balance and on the shop's main line, tied to the sale so a refund can take it back.
- **Shop line**: the shop's own MTC or Alfa number whose credit goes up by the returned credit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can sell any of the 13 Whish App MTC / Alfa cards that carry both credit and days "Only Days" from the Whish App screen, in every sale mode, without switching to Katsh or iPick.
- **SC-002**: For the same card and the same returned credit, a Whish App Only Days sale and a Katsh Only Days sale move the carrier balance, the shop line and the profit offset by the same amounts (only the provider balance and the card cost differ).
- **SC-003**: Selling and then refunding a Whish App Only Days sale leaves every balance, line and partner account exactly where it started (zero difference per currency), in every sale mode.
- **SC-004**: No change to any Whish App sale that is not Only Days and no change to any Katsh / iPick sale (existing checks stay green).

## Assumptions

- Whish App cards already carry the Only Days catalog data (credit, validity days, days cost, Only Days price, maximum returned credit), mirrored from Katsh in earlier migrations; no data change is needed. Verified on the seeded screenshot shop: 13 Whish App cards (6 Alfa, 7 MTC), the same 13 as Katsh and iPick.
- Returned credit is valued at the shop's credit cost rate, the same per-shop setting Katsh and iPick use.
- Only the owner-requested sale modes are covered; Wrong number and Charge to shop line are unchanged.
- The deferred USD-mode question for prepaid cards (`docs/plans/todo_plans/WHISH_USD_PREPAID_CARDS.md`) stays open and out of scope.
