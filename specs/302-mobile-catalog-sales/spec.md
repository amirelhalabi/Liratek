# Feature Specification: Phone app Katsh / iPick catalog sales

**Feature Branch**: `302-mobile-catalog-sales` (work happens on `main`; ticket LIRA-302)

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Phone app Katsh / iPick catalog sales (vouchers and cards): the owner records Katsh and iPick catalog sales from the phone, including after closing, booked exactly like the web cart. Catalog items only (bills stay on web/desktop); a cart of several items booked as ONE sale like the web; MTC/Alfa cards sold as plain items, Only-Days stays web/desktop-only; payment on the customer's account or into the Whish/OMT wallet, no cash. Shared payload builder used by both web and phone. Follow-up of LIRA-289."

## Context

A shop owner gets requests after closing: a Whish App or OMT App transfer, or a Katsh / iPick voucher or card (a
gaming voucher, a gift card, an MTC/Alfa recharge card). The phone app (LIRA-289) already records the transfers. The
Katsh and iPick tiles on the phone's Sell tab say "Coming next".

At the counter, the web and desktop app sell these from a catalog: the cashier picks items into a cart, sets
quantities, and checks out. The whole cart is booked as one sale: the Katsh (or iPick) balance goes down by what the
items cost the shop, the customer pays the selling price, and the difference is profit.

This feature lets the owner do the same from the phone, with the same result in the books.

**Owner decisions (2026-10-10):**
- Catalog items only. Paying a customer's bill through Katsh/iPick stays on web/desktop for now.
- A cart of several items, booked as one sale, as on the web.
- MTC/Alfa cards are sold as ordinary items. The "Only Days" option (returning unused credits to the shop's own SIM
  line) stays web/desktop-only.
- The customer pays on their account, or into the shop's Whish or OMT wallet. No cash (the owner is not at the
  till).
- The customer can pay in LBP or USD; USD is converted at the day's rate, as on the web.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sell catalog items on the customer's account (Priority: P1)

At night a regular customer messages: "I need two Alfa $22 cards and a PUBG voucher, put it on my account." The owner
opens Sell → Katsh, finds the items, adds them with quantities, picks the customer, chooses "On account", and saves.

**Why this priority**: it is the after-hours case the feature exists for, and paying on account needs no money
movement the owner has to check.

**Independent Test**: record a two-item Katsh cart on a customer's account from the phone; check on the web that one
sale appears, the Katsh balance dropped by the items' cost, the customer's debt rose by the selling price, and the
profit equals price minus cost.

**Acceptance Scenarios**:

1. **Given** the Katsh catalog has items, **When** the owner opens Sell → Katsh, **Then** the items show grouped by
   category with their selling price, and can be searched by name.
2. **Given** the owner adds item A twice and item B once, **When** they review the cart, **Then** it lists both items
   with quantities and shows the total selling price.
3. **Given** a cart, a chosen customer and "On account", **When** the owner saves, **Then** one sale is booked: the
   Katsh balance drops by the total cost, the customer's debt rises by the total selling price, and the sale names the
   customer.
4. **Given** the same cart was just saved, **When** the owner taps Save again by mistake, **Then** no second sale is
   booked.
5. **Given** "On account" is chosen and no customer is picked, **When** the owner taps Save, **Then** the app asks for
   the customer and books nothing.

---

### User Story 2 - Customer pays into the Whish or OMT wallet (Priority: P1)

The customer sends the money to the shop's Whish (or OMT) wallet, then the owner records the sale as paid into that
wallet.

**Why this priority**: the other common way a night-time customer pays; without it the owner must fake a debt and
a repayment.

**Independent Test**: record an iPick cart paid into the Whish wallet; check that the iPick balance dropped by the
cost, the Whish App balance rose by the price, and no debt was created.

**Acceptance Scenarios**:

1. **Given** a cart and "Whish wallet" chosen, **When** the owner saves, **Then** the provider balance drops by the
   total cost and the Whish App balance rises by the total selling price.
2. **Given** "OMT wallet" chosen, **When** the owner saves, **Then** the OMT App balance rises instead.
3. **Given** a wallet payment, **When** no customer is picked, **Then** the sale is still saved (a customer is
   optional when the money is already received), and a customer can be added if known.

---

### User Story 3 - Same sale everywhere (Priority: P1)

A sale recorded on the phone looks and counts exactly like one recorded at the counter: same row in Transactions,
same wording, same profit, same "since the last count" entry, same refund behaviour.

**Why this priority**: two ways of booking the same thing would make the books disagree.

**Independent Test**: record the same cart once on the web and once on the phone; compare the two transactions
(amount, cost, profit, drawer movements, description). Then void the phone one and check every balance and the debt
return to where they were.

**Acceptance Scenarios**:

1. **Given** identical carts recorded on the web and on the phone, **When** the two sales are compared, **Then** their
   amounts, cost, profit, payment and description are the same.
2. **Given** a phone catalog sale, **When** it is voided or refunded on the web, **Then** the provider balance, the
   wallet and the customer's debt return to their earlier values.
3. **Given** a phone catalog sale, **When** the owner opens Activity on the phone or the Transactions page on the web,
   **Then** it reads the same way on both (for example "Katsh · Hassan", with the items listed).

---

### User Story 4 - The phone shows the result at once (Priority: P2)

After saving, the owner sees the new balances, the sale in Activity, and the customer's updated debt without
pulling to refresh.

**Why this priority**: confirms the sale went through; avoids a second booking out of doubt.

**Independent Test**: note the Katsh balance on Home, record a sale, return to Home and Activity.

**Acceptance Scenarios**:

1. **Given** a saved catalog sale, **When** the owner opens Home, **Then** the provider balance and "since the last
   count" include it.
2. **Given** a saved sale on account, **When** the owner opens Debts, **Then** the customer's debt includes it.

---

### Edge Cases

- The catalog is empty for that provider: the page says so and offers no cart.
- An item has no selling price or no cost set: it is not offered on the phone (it cannot be booked correctly).
- An item is switched off, removed, or re-priced on the web while it sits in the phone's cart: when the owner taps
  Save, the phone first re-checks the cart against the latest catalog; a line whose item is gone or whose price or
  cost changed blocks the save with a clear message naming it (the cart stays so the owner can remove or refresh
  it). Nothing is booked at a stale price.
- The provider balance is lower than the total cost: same behaviour as the counter (the shop's existing rule for that
  provider applies; the phone shows the server's message).
- No connection when saving: nothing is booked, the cart stays, and tapping Save again later does not double-book.
- A quantity of zero or a negative number cannot be entered.
- The day's exchange rate cannot be loaded: USD payment is unavailable (LBP still works) and the phone says why.
- Very large carts: the description still lists every item; the screen scrolls.
- MTC/Alfa cards appear as ordinary items; nothing on the phone mentions "Only Days".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The phone MUST offer Katsh and iPick catalog sales from the Sell tab (the two tiles that today say
  "Coming next").
- **FR-002**: The phone MUST list that provider's active catalog items, grouped by category, with name and selling
  price, searchable by name; items without a selling price or a cost are not offered.
- **FR-003**: The owner MUST be able to add several items with quantities (whole numbers ≥ 1), change quantities,
  remove items, and see the cart total before saving.
- **FR-004**: Payment MUST be one of: on the customer's account, into the Whish wallet, into the OMT wallet, in one
  currency (see FR-013). No cash, no split payment, no discount in this version.
- **FR-005**: "On account" MUST require a customer (picked from search or created with name and phone, as on the
  transfer form). For wallet payments the customer is optional.
- **FR-006**: Saving MUST book exactly one sale for the whole cart, identical in every booked figure to the same cart
  checked out on the web: total selling price, total cost, profit = price − cost, the provider balance lowered by
  the cost, the chosen wallet raised (or the customer's debt raised) by the selling price, the customer linked to
  the sale, and the item list in the description.
- **FR-007**: The sale details MUST be built by ONE shared definition used by both the web cart and the phone, so
  the two cannot drift.
- **FR-008**: A sale saved twice by accident (double tap, retry after a lost connection) MUST be booked once.
- **FR-009**: A phone catalog sale MUST be voidable and refundable through the existing web/desktop paths, and
  reversing it MUST bring every balance and the customer's debt back to zero change.
- **FR-010**: After saving, the phone MUST show the updated balances, "since the last count", Activity and (for
  account sales) the customer's debt when those pages are next seen.
- **FR-011**: MTC/Alfa cards MUST be sold as ordinary items; the "Only Days" option MUST NOT appear on the phone.
- **FR-012**: Bill payments MUST NOT appear on the phone in this version.
- **FR-013**: The customer MUST be able to pay in LBP or in USD. A USD payment is converted at the shop's exchange
  rate for the day (the same rate the web checkout uses), the phone shows the USD amount before saving, and the sale
  is booked exactly as the web books a USD payment for an LBP-priced cart (owner decision 2026-10-10).
- **FR-014**: Only admins can record these sales on the phone (as for every phone sale).

### Key Entities

- **Catalog item**: a sellable Katsh/iPick product: provider, category, sub-category, name, cost to the shop,
  selling price, active or not.
- **Cart line**: a catalog item and a quantity.
- **Catalog sale**: one booked sale for a whole cart: provider, total selling price, total cost, profit, payment
  method and currency (with the day's rate for USD), customer (optional except on account), description listing the
  items.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner records a three-item cart on a customer's account in under 60 seconds on the phone.
- **SC-002**: For the same cart, the web and the phone book identical amounts, cost, profit, payment and drawer
  movements in 100% of tested cases (each provider × each payment choice × LBP and USD).
- **SC-003**: Voiding a phone catalog sale returns every affected balance and the customer's debt to the value before
  the sale, in 100% of tested cases.
- **SC-004**: A double tap or a retry after a lost connection never books a second sale.
- **SC-005**: Every existing web Katsh/iPick checkout test still passes unchanged.

## Assumptions

- The catalog shown on the phone is the same catalog the web uses; editing it stays on web/desktop.
- Prices are the catalog's stored selling prices; the phone does not change prices or apply discounts.
- The owner is an admin; the phone app is admin-only (LIRA-289).
- The existing double-submission guard, client creation, and page-refresh behaviour of the phone app (LIRA-289,
  LIRA-300) are reused.
- Sale descriptions use the shared transaction wording (LIRA-301).
