# Feature Specification: Extra charges

**Feature Branch**: `319-extra-charges` (work happens on `main`; ticket LIRA-319)

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Extra charges: let the cashier add a small extra amount on top of a sale's total in the payment box (the opposite of a discount), on every page where a customer pays for a sale or service (POS, Maintenance, Custom Services, Loto, Recharge / MTC-Alfa, OMT/Whish send, customer session checkout). The item's price and cost stay unchanged; the extra is saved as its own amount on the transaction, the money goes into the drawer of the payment method(s) used like any payment, and the Profits page shows it as its own category named "Extra charges". Owner context (2026-10-13): example — phone case cost $5, price $6, customer pays $7: the record must show cost $5, sold $6, extra $1, the $1 in the cash drawer, and Profits shows $1 item profit plus $1 under "Extra charges". UI: the existing Discount line in the payment box gets a "− Discount / + Extra" switch."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sell an item for a little more than its price (Priority: P1)

A walk-in customer buys a phone case priced $6 (cost $5). The cashier decides to charge $7. In the payment box the cashier switches the Discount line to "+ Extra", types 1, takes $7 cash and completes the sale. The sale record still shows the case at its normal price and cost; the $1 is recorded separately as an extra charge.

**Why this priority**: This is the request itself. Without it the cashier either changes nothing (loses the extra) or misuses another field (kept change, which goes to a picked client's account since LIRA-316, or editing the product price for everyone).

**Independent Test**: On the POS, sell one item priced $6 with an extra of $1 paid in cash, then check the sale: item price $6, item cost $5, extra $1, General cash drawer up by $7, profit $2 split as $1 from the item and $1 extra.

**Acceptance Scenarios**:

1. **Given** a cart with one item priced $6 (cost $5), **When** the cashier sets "+ Extra" to 1 and pays $7 cash, **Then** the sale is saved with the item at $6, an extra of $1, a total paid of $7, and the cash drawer goes up by $7.
2. **Given** the same sale, **When** the cashier opens it in Transactions, **Then** it shows the total $7 and states the $1 extra separately from the item.
3. **Given** the extra is set to 1, **When** the cashier pays only $6, **Then** the payment box shows $1 still owed, exactly as it does for any shortfall.
4. **Given** a sale paid by Whish wallet with an extra, **When** it is saved, **Then** the Whish drawer receives the whole amount, extra included.
5. **Given** a sale with an extra, **When** the receipt is printed, **Then** it lists the items at their normal prices, then "Extra +$1.00", then the total.

---

### User Story 2 - See extra charges on the Profits page (Priority: P1)

At the end of the day the owner opens Profits. Item profit is reported as before; all extra amounts appear together in their own category, "Extra charges", so item margins stay honest and the owner can see how much was earned by charging extra.

**Why this priority**: The owner's stated goal is to see cost, price and extra separately when reviewing; without this the extra is invisible or distorts item margins.

**Independent Test**: Make two sales with extras ($1 on an accessory, $2 on a repair), open Profits for the day, and check the category list: "Extra charges" shows $3 profit and the accessory and repair categories show only their own margins.

**Acceptance Scenarios**:

1. **Given** sales with extras of $1 and $2 today, **When** the owner opens Profits by category for today, **Then** "Extra charges" shows $3 and no item category includes those $3.
2. **Given** no sale had an extra in the period, **When** Profits is opened, **Then** "Extra charges" shows 0 or is not listed, following how other empty categories behave.
3. **Given** an extra in LBP, **When** Profits is opened, **Then** the extra is counted in LBP, like other LBP profit.

---

### User Story 3 - Undo a sale that had an extra (Priority: P1)

A sale with a $1 extra is voided or fully refunded. Everything it recorded is reversed, including the extra: the drawer, the profit and the "Extra charges" total all go back.

**Why this priority**: Money integrity (constitution IV): every amount a flow records must have a reversal owner, and create + reverse must net to zero.

**Independent Test**: Sell with a $1 extra, void it, and check that the drawer, the item profit and "Extra charges" each net to zero for that sale.

**Acceptance Scenarios**:

1. **Given** a $7 sale ($6 item + $1 extra) paid in cash, **When** it is voided, **Then** the cash drawer goes down by $7 and "Extra charges" no longer counts that $1.
2. **Given** the same sale, **When** it is fully refunded, **Then** the customer gets $7 back and "Extra charges" goes down by $1.
3. **Given** a sale of a $10 item and a $5 item with a $3 extra, **When** the $5 item is refunded, **Then** the customer gets $6.00 back ($5 + its $1.00 share of the extra), the drawer goes down by $6.00, and "Extra charges" goes down by $1.00.

---

### User Story 4 - Extra on every page where a customer pays (Priority: P2)

The same "+ Extra" switch works on Maintenance checkout, Custom Services, Loto ticket sales, Recharge / MTC-Alfa sales, OMT/Whish send and the customer session checkout, and each records the extra the same way.

**Why this priority**: The owner asked for every paying page. POS alone covers the main case, so the others follow.

**Independent Test**: On each listed page, complete one sale with a $1 extra paid in cash and confirm the extra is recorded separately, the drawer receives it, and Profits counts it under "Extra charges".

**Acceptance Scenarios**:

1. **Given** a Maintenance job with labour $20, **When** the cashier adds a $2 extra and takes $22, **Then** the job's labour stays $20 and the extra $2 is recorded and counted under "Extra charges".
2. **Given** an OMT send whose fee is set by the provider, **When** the cashier adds a $1 extra, **Then** the provider fee is unchanged and the $1 is recorded as an extra charge, not as fee.
3. **Given** a customer session basket, **When** the extra is added at the session checkout, **Then** it is recorded once for the basket, not once per item.

---

### User Story 5 - Extra on a sale charged to the client's account (Priority: P3)

A client buys on account (Customer Account payment). The cashier adds an extra. The client's debt includes the extra.

**Why this priority**: Less common, but the account path must stay consistent with the total.

**Independent Test**: Charge a $6 item plus $1 extra to a client's account and check the client's debt went up by $7, and that the extra counts under "Extra charges".

**Acceptance Scenarios**:

1. **Given** a client with no debt, **When** a $6 item with a $1 extra is charged to their account, **Then** their debt is $7.

### Edge Cases

- **Extra of 0 or empty**: nothing is recorded as extra; the sale behaves exactly as today.
- **Negative or non-numeric extra**: not accepted; the field shows the same kind of message as the discount field.
- **Very large extra** (for example more than the sale itself): accepted only up to a limit, and the field says so in the same way as "Capped to max" on a discount (limit in FR-006).
- **Currency of the extra**: the extra is entered in the sale's currency (USD sale → $, LBP sale → LBP); the customer can still pay it in any currency through the payment lines (owner decision 2026-10-13).
- **Overpayment with an extra**: change is worked out against the total including the extra; the change box behaves as today.
- **Session basket**: an extra typed on a page while the item goes into a basket is not recorded twice; only the session checkout's extra counts (FR-010).
- **For-partner sale** (a sale charged to a partner): no extra is offered, since there is no customer payment.
- **Payouts** (OMT/Whish receive, Binance cash-out, Exchange, refunds): no extra is offered; the shop is paying, not being paid.
- **Offline desktop work** replayed later: the extra travels with the sale and is recorded once.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The payment box's Discount line MUST offer a switch between "− Discount" and "+ Extra"; one amount field serves the active choice.
- **FR-002**: An extra MUST raise the total the customer pays by its amount and MUST NOT change any item's price, cost or quantity, any labour price, or any provider fee.
- **FR-003**: The extra MUST be stored as its own amount on the sale or service record, per currency (USD and LBP), so it can be reported on its own.
- **FR-004**: The money paid, extra included, MUST go into the drawer(s) of the payment method(s) used, exactly like any other payment; no separate drawer for extras.
- **FR-005**: The Profits page MUST show a category named "Extra charges" holding the sum of all extras in the period, per currency, and MUST NOT add any extra to an item or service category.
- **FR-006**: The extra MUST be capped at a limit and, when the cashier types more, the field MUST say "Capped to max (…)" like the discount. Default limit (assumption): the sale's own total before the extra.
- **FR-007**: A sale MUST have either a discount or an extra, never both (owner decision 2026-10-13).
- **FR-008**: Voiding or fully refunding a sale MUST reverse its extra, so drawer, profit and "Extra charges" each net to zero for that sale.
- **FR-009**: The receipt MUST list the items at their normal prices, then a separate "Extra +amount" line, then the total.
- **FR-010**: In a customer session basket, the extra MUST be set once at the session checkout and recorded once for the basket; pages that only add an item to the basket MUST NOT offer an extra.
- **FR-011**: The extra MUST be offered on: POS checkout, Maintenance checkout, Custom Services, Loto ticket sales, Recharge / MTC-Alfa sales, OMT/Whish send and the session checkout. It MUST NOT be offered on payouts, refunds, for-partner sales, or balance payments (Debts repayment, Supplier receive, Partner settle), which settle an existing balance and are not sales (owner decision 2026-10-13).
- **FR-012**: When one item of a multi-item sale is refunded, the customer MUST get back the item's price plus that item's share of the extra, in proportion to its price within the sale; the refunded share leaves the drawer and "Extra charges" by the same amount (owner decision 2026-10-13). Example: items $10 and $5 with a $3 extra; refunding the $5 item gives back $5 + $1.00.
- **FR-013**: The Transactions list and the sale's detail view MUST show the extra separately from the item amounts.
- **FR-014**: The feature MUST work the same way in the desktop app and the web app.
- **FR-015**: A sale charged fully or partly to the client's account MUST include the extra in what the client owes.

### Key Entities *(include if feature involves data)*

- **Extra charge**: an amount the cashier adds on top of a sale's total, in USD and/or LBP, belonging to exactly one sale or service transaction. It has no cost, so all of it is profit. It is reversed with its transaction.
- **Sale / service transaction** (existing): gains the extra amount alongside its existing total, discount and profit; items, labour and provider fees inside it are unchanged.
- **Profit category "Extra charges"** (new, reporting only): the sum of extras over a period, shown next to the existing item and service categories.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can add an extra and complete a sale in under 10 seconds more than a normal sale (one switch, one number).
- **SC-002**: For the owner's example (cost $5, price $6, paid $7), the saved record shows cost $5, price $6, extra $1, $7 in the drawer, and Profits shows $1 item profit plus $1 "Extra charges", with no manual correction.
- **SC-003**: After voiding any sale with an extra, the drawer, the profit and "Extra charges" each return to their value before the sale (net zero), in every currency.
- **SC-004**: On every page listed in FR-011, a sale with an extra appears under "Extra charges" in Profits for that day.
- **SC-005**: No item or service category's profit changes because of an extra (item margins stay exactly what they were without the extra).

## Clarifications

### Session 2026-10-13

- Q: Can one sale carry both a discount and an extra? → A: No, one or the other.
- Q: Should balance payments (Debts repayment, Supplier receive, Partner settle) allow an extra? → A: No, only sales and services.
- Q: On a partial item refund, what happens to the extra? → A: The customer gets the refunded item's share of the extra back, in proportion to its price.
- Q: What currency can the extra be in? → A: The sale's currency only.

## Assumptions

- The extra is all profit; it carries no cost and no supplier share.
- The default cap is the sale's own total before the extra (a 100% markup); the owner can lower it later.
- Only roles that can complete a sale today can add an extra; no new permission.
- The receipt and the "What's new" note describe it as "Extra" / "Extra charges", the owner's chosen name.
- The Discount line from LIRA-318 is where the switch lives; pages without a discount line today get the line for the extra.
- Kept change (customer overpays, cashier keeps the difference) stays as it is; it is a different case (unplanned, from change) from an extra (planned, part of the price).
- Partner-share and supplier ledgers are untouched by an extra.
- On OMT/Whish send, Katsh, crypto send and app transfer the discount is folded into the price before saving, so "discount or extra, not both" is enforced by the payment box there, not the server.
- Sales revenue figures (dashboard "Sales Revenue", daily closing) count item revenue only; the extra shows in Profits ("Extra charges") and in cash collected.
