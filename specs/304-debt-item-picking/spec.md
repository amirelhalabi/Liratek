# Feature Specification: Debt Repayment Item Picking and Primary-System Drawer Routing

**Feature Branch**: `304-debt-item-picking` (work happens on `main`; no branch)

**Created**: 2026-10-10

**Status**: Draft

**Ticket**: LIRA-304 (`current_sprint.md`)

**Input**: User description: "Debt repayment item picking and consistent primary-system drawer routing. Customer debt can come from (A) a customer session basket checked out on Customer Account (stored today as ONE 'Session Debt' row for the whole basket) or (B) separate visits each on debt (one typed row per item). Today repayment routes the OMT/Whish service-debt share into the OMT/Whish cash drawer only for (B); (A) puts everything in General; and the current routing ignores which system is primary. Owner decisions 2026-10-10: (1) routing applies to BOTH paths; (2) only the shop's PRIMARY system is routed — never the secondary system, never the wallet apps (OMT App / Whish App) or Binance; (3) the Accounts page shows the items of a session basket under its session row; (4) on repayment the cashier can pick which open debt items, including single items inside a basket, the payment is for; picked items are paid first, the rest oldest-first; nothing picked = oldest-first as today; the share applied to a picked primary-system transaction goes to the primary-system cash drawer; (5) profit is released for the items actually paid. Desktop and web."

## Context

- A customer can owe the shop in two ways, and the two are stored differently today:
  - **(A) A customer session paid on account.** The whole basket (for example an OMT send of $101, a cable of $14 and a Loto ticket of 200,000 LBP) becomes **one** debt line, "Session #36 basket".
  - **(B) Separate visits on account.** Each visit becomes its own debt line (the OMT send on Monday, the cable on Tuesday, …).
- When the customer later pays, the cash lands in the drawer of the payment method (General for cash). For (B) only, the system then moves the OMT/Whish share into the OMT/Whish **cash drawer at the money-transfer counter**. For (A) nothing is moved. Same customer, same items, same cash: different drawers. A live run on the test shop on 2026-10-10 confirmed this: a basket paid on account and then settled in cash put $115 + 200,000 LBP in General and nothing in the OMT drawer.
- Today's move also ignores which system the shop runs on: an OMT-based shop would move a Whish debt into the Whish cash drawer, which that shop does not use.
- Repayments today are always applied to the oldest debt first. The cashier cannot say "this money is for the OMT transfer".
- What the shop owes OMT/Whish (the supplier side) is booked when the transfer is made, whatever the customer paid with. This feature does not change it. Only where the customer's repayment cash is put changes.
- The cash drawer at the counter is what the shop uses to pay OMT/Whish when settling, so it matters that money for transfers ends up there.

## Terms

- **Primary system**: the money-transfer system the shop runs on, set per shop (OMT or Whish). Its cash drawer is "OMT Cash Drawer" or "Whish Cash Drawer".
- **Secondary system**: the other one. A transfer on it goes to General, as today.
- **Wallet apps**: OMT App, Whish App and Binance. They are separate from the systems above. **Whish (system) is not Whish App.** Wallet-app transactions are never moved to a system cash drawer.
- **Debt item**: one thing the customer owes for: a whole visit line from (B), or a single item inside a basket from (A).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Same drawers whichever way the debt was made (Priority: P1)

A customer owes for a primary-system transfer and other items, either from one session basket on account or from separate visits on account. They pay everything in cash. In both cases, the transfer's share goes to the primary system's cash drawer and the rest goes to General.

**Why this priority**: the two paths giving different drawer results means drawer counts disagree with what the cashier was told to do. Fixing it touches no new screen and makes every later story consistent.

**Independent Test**: create the same three items once as one basket on account and once as three separate visits on account, settle each in full in cash, and compare the drawer changes. They must be identical.

**Acceptance Scenarios**:

1. **Given** an OMT-based shop and a basket on account containing an OMT send of $101, a cable of $14 and a Loto ticket of 200,000 LBP, **When** the customer settles the full debt in cash, **Then** the OMT Cash Drawer gains $101 and General gains $14 and 200,000 LBP.
2. **Given** the same three items as three separate visits on account, **When** the customer settles the full debt in cash, **Then** the drawer changes are exactly the same as in scenario 1.
3. **Given** a Whish-based shop and a basket on account containing a Whish send of $50 and a cable of $14, **When** the customer settles in cash, **Then** the Whish Cash Drawer gains $50 and General gains $14.
4. **Given** an OMT-based shop and a debt for a Whish (system) send of $50, **When** the customer settles in cash, **Then** General gains $50 and no system cash drawer changes.
5. **Given** a debt for a Whish App (wallet) transfer of $30 in a Whish-based shop, **When** the customer settles in cash, **Then** General gains $30 and the Whish Cash Drawer does not change.

---

### User Story 2 - The cashier picks what the payment is for (Priority: P1)

A customer with several debts pays only part of them and says what the money is for, for example "this is for the OMT transfer". The cashier ticks that item on the repayment screen. The money pays that item first. If the transfer is on the primary system, that money goes to its cash drawer.

**Why this priority**: the owner's decision on partial payments depends on it, and it is the only way the cashier can match the drawers to what the customer said.

**Independent Test**: give a customer several debts, pay part with one item ticked, and check which item is reduced, where the cash went, and that the other items are untouched.

**Acceptance Scenarios**:

1. **Given** a customer owing an OMT send of $101 (primary system), a cable of $14 and a Loto ticket of 200,000 LBP, **When** the cashier ticks the OMT send and the customer pays $50 in cash, **Then** the OMT send has $51 left to pay, the cable and the Loto ticket are unchanged, and the OMT Cash Drawer gains $50.
2. **Given** the same debts, **When** the cashier ticks only the OMT send and the customer pays $120 in cash, **Then** the OMT send is fully paid ($101 to the OMT Cash Drawer) and the remaining $19 is applied in today's order (sales first, then oldest first) to the other items and goes to General.
3. **Given** the same debts, **When** the cashier ticks nothing and the customer pays $50 in cash, **Then** the payment is applied to the items exactly as it is today (sales first, then oldest first), and the OMT Cash Drawer gains the full $50 (OMT drawer first, as today).
4. **Given** a basket on account, **When** the cashier opens the repayment screen, **Then** each item inside the basket can be ticked on its own.
4a. **Given** a customer with NO basket, who owes from three separate visits (an OMT send of $101 on Monday, a cable of $14 on Tuesday, a Loto ticket of 200,000 LBP on Wednesday), **When** the cashier opens the repayment screen, **Then** each visit's line can be ticked on its own, and ticking the OMT send and paying $50 behaves exactly as in scenario 1.
4b. **Given** a customer who owes from both a basket and separate visits, **When** the cashier opens the repayment screen, **Then** the basket's items and the separate lines are all listed together and any mix of them can be ticked.
4c. **Given** the same debts, **When** the cashier ticks only the cable and the customer pays $14 in cash, **Then** the cable is paid and General gains $14; the OMT Cash Drawer does not change.
4d. **Given** the same debts, **When** the cashier ticks only the cable and the customer pays $60 in cash, **Then** the cable is paid ($14 to General) and the $46 left goes to the OMT Cash Drawer first and pays the OMT send in today's order.
5. **Given** several ticked items, **When** the payment is smaller than their total, **Then** the ticked items are paid oldest first among themselves.
6. **Given** a ticked item, **When** the screen shows the payment summary before confirming, **Then** it shows how much will go to each drawer.

---

### User Story 3 - The Accounts page shows what is inside a basket (Priority: P2)

On the Accounts page, a basket that was put on account still appears as one line, and it can be expanded to show each item with its amount and how much of it is still open.

**Why this priority**: the cashier must see the items to pick one, and the owner must see what a basket line is made of. It changes no money.

**Independent Test**: open a customer with a basket on account and expand the basket line; check that every item is listed with its amount, and that the list matches the basket total.

**Acceptance Scenarios**:

1. **Given** a basket on account of $115 + 200,000 LBP, **When** the basket line is expanded, **Then** it lists the OMT send ($101), the cable ($14) and the Loto ticket (200,000 LBP).
2. **Given** an item in the basket that has been partly paid, **When** the line is expanded, **Then** that item shows how much is still open.
3. **Given** an item in the basket that was refunded, **When** the line is expanded, **Then** the item is shown as refunded and is not counted as open.

---

### User Story 4 - Profit follows what was actually paid (Priority: P2)

Profit on items sold on account is held until the customer pays. When the cashier picks items, the profit of those items is released, not the profit of whichever item was oldest.

**Why this priority**: without it, the Profits page shows profit for items that are still unpaid and hides profit for items that were paid.

**Independent Test**: sell two items with profit on account, pay one in full with it ticked, and check on the Profits page that only that item's profit appears.

**Acceptance Scenarios**:

1. **Given** a cable (profit $8) and a phone case (profit $5) on account, **When** the cashier ticks the phone case and the customer pays its full price, **Then** the $5 profit is released and the $8 profit stays held.
2. **Given** a payment with nothing ticked, **When** it is confirmed, **Then** profit is released in the same order as today.

---

### User Story 5 - Undoing a repayment undoes exactly what it did (Priority: P1)

If a repayment is voided or refunded, every item it paid is open again by exactly the amount it paid, every drawer it moved goes back, and every profit it released is held again.

**Why this priority**: money integrity. A void that restores the wrong items or leaves a drawer moved creates an imbalance nobody sees.

**Independent Test**: make a repayment with picked items, void it, and check that every item, drawer and profit figure is back where it was before the repayment.

**Acceptance Scenarios**:

1. **Given** a repayment of $50 that paid part of a ticked OMT send and moved $50 to the OMT Cash Drawer, **When** it is voided, **Then** the OMT send is open by $50 more, the OMT Cash Drawer goes back by $50, and General is unchanged.
2. **Given** a repayment that paid items inside a basket, **When** it is voided, **Then** those basket items are open again by exactly the amounts paid.

---

### User Story 6 - Payment details show which drawer got the money (Priority: P2)

On the Transactions page, the payment details of a repayment show one line per payment method and direction, with both currencies on the same line. When the money of a line was split between drawers, the line also shows how much went to each drawer.

**Why this priority**: the owner checks drawer counts against the Transactions page. Today the move into the system cash drawer is invisible there, and four lines say what two lines could.

**Independent Test**: settle a debt that includes a primary-system transfer in cash, open its payment details, and compare the per-drawer amounts with the drawer balances before and after.

**Acceptance Scenarios**:

1. **Given** a repayment of $115 + 200,000 LBP in cash for a debt of OMT send $101 + cable $14 + Loto 200,000 LBP in an OMT-based shop, **When** the payment details are opened, **Then** they read:
   ```
   In  — Cash: $115 + 200,000 LBP  {$101 OMT Cash Drawer · $14 + 200,000 LBP General}
   Out — Customer Account: $115 + 200,000 LBP
   ```
2. **Given** a repayment whose cash all went to General, **When** the payment details are opened, **Then** the cash line shows the amounts with no drawer breakdown.
3. **Given** any other transaction with payments in two currencies of the same method (for example a sale paid $10 + 100,000 LBP in cash), **When** its payment details are opened, **Then** they show one cash line with both currencies.

---

### User Story 7 - LBP paid for a USD transfer, and the checkpoint (Priority: P3)

A customer pays in LBP for a USD OMT transfer they owe. The LBP goes into the OMT Cash Drawer. At the next checkpoint, the OMT Cash Drawer is still checked per currency, and an information-only total in USD helps the owner see the drawer's overall value.

**Why this priority**: it completes the routing rules for mixed currencies. The checkpoint total is a convenience, not a control.

**Independent Test**: owe an OMT send of $101 in an OMT-based shop, pay 8,989,000 LBP at 89,000, then open the checkpoint for the OMT Cash Drawer.

**Acceptance Scenarios**:

1. **Given** an OMT send of $101 on debt and a rate of 89,000, **When** the customer pays 8,989,000 LBP in cash, **Then** the OMT Cash Drawer gains 8,989,000 LBP and General does not change.
2. **Given** that drawer, **When** the cashier counts exactly 8,989,000 LBP more than before, **Then** the checkpoint shows LBP as a match, and also shows the drawer's total in USD for information.
3. **Given** a drawer whose USD total matches but whose currencies do not (for example $100 counted where 8,900,000 LBP was expected), **When** the checkpoint is checked, **Then** it is NOT balanced.

---

### Edge Cases

- **Payment in a different currency from the item** (for example LBP cash for a USD transfer): the payment is converted at the rate shown on the repayment screen, as today, to work out how much of the item it pays. The money moved to the system cash drawer stays in the currency that was actually paid (owner decision 2026-10-10: LBP paid for a USD OMT debt goes into the OMT Cash Drawer as LBP). Today such a payment is not moved at all.
- **Non-cash payment methods** (for example paying an OMT debt from Whish App or by card): only the cash part is moved to the system cash drawer. Money paid with another method stays in that method's drawer. A Customer Account or gift card payment moves no drawer at all, as today.
- **Change given back, or change kept by the shop**: only the amount actually applied to the debt is moved to the system cash drawer, never the change and never the kept extra.
- **A ticked item that is already fully paid or refunded**: it cannot be ticked.
- **A basket partly paid in cash at checkout and the rest on account** (owner decision 2026-10-10: OMT first): the cash paid at checkout covers the primary-system transfers first, and goes to the system cash drawer; whatever is left covers the other items. Example: OMT $101 + cable $14, $50 cash now, $65 on account → OMT Cash Drawer +$50, OMT still owes $51, cable still owes $14. Today the checkout splits the cash by each item's share of the basket; this changes it. There is no tick box at checkout.
- **The shop changes its primary system later**: routing follows the primary system at the time of the repayment, and only for transfers made on that system.
- **The customer has a store credit (negative balance)**: repayment is not offered, as today.
- **Old debts made before this change**: basket lines made before this change can also be expanded and their items picked. Old repayments are not changed, and voiding them still undoes exactly what they did.
- **A discount or write-off on the repayment screen**: still applied oldest-first, as today. Picking does not apply to the discount.
- **Two cashiers settling the same customer at once**: the second payment sees what is still open after the first and cannot pay an item twice.

## Requirements *(mandatory)*

### Functional Requirements

**Routing**

- **FR-001**: When a customer repays a debt that includes open primary-system transfers, the system MUST move cash into that system's cash drawer, whether the debt came from a basket on account or from a separate visit, by this rule: (1) when items are ticked, the money follows the ticked items — a ticked primary-system transfer's share goes to its cash drawer, a ticked item of any other kind goes to the payment method's drawer (General for cash); (2) money left after the ticked items, or all of it when nothing is ticked, goes to the system cash drawer first (owner decision "OMT drawer first"); (3) always within the limit in FR-004.
- **FR-002**: The system MUST NOT move any repayment money into a system cash drawer for a transfer made on the **secondary** system, or for any wallet-app transaction (OMT App, Whish App, Binance). That money stays in the payment method's drawer.
- **FR-003**: The system MUST move only money paid in **cash** into a system cash drawer. Money paid with another drawer-affecting method stays in that method's drawer; Customer Account and gift card payments move no drawer.
- **FR-003a**: Cash paid in a different currency from the transfer MUST still be moved to the system cash drawer, in the currency it was paid in. Its value against what is owed is worked out at the rate used for the repayment.
- **FR-004**: The amount moved for a transfer MUST NOT exceed the transfer's amount minus what earlier repayments already moved to the system cash drawer for it (each earlier move valued, in the transfer's own currency, at the rate of its own repayment), and MUST NOT exceed the amount actually applied to the debt (after change given back and change kept).
- **FR-005**: The move MUST be recorded so that the Transactions page shows where the money went, in the payment details of the repayment (see FR-019 to FR-021).

**Item picking**

- **FR-006**: The repayment screen MUST list every open debt item of the customer, with its amount still open: every line from a separate visit, AND each item inside a basket on account. Item picking MUST work for any debt, whether or not it came from a basket.
- **FR-007**: The cashier MUST be able to tick one or more items before confirming a repayment. Ticking is optional.
- **FR-008**: When items are ticked, the payment MUST be applied to the ticked items first (oldest first among them). Any amount left MUST be applied to the other open items in today's order: sales first, then the rest oldest first.
- **FR-009**: When nothing is ticked, the payment MUST be applied exactly as today, and the money sent to the system cash drawer MUST fill from the open primary-system transfers first (owner decision 2026-10-10: "OMT drawer first"), even where the item marked paid first is a sale.
- **FR-009a**: At checkout of a basket partly paid now and partly on account, the cash paid now MUST cover the primary-system transfers first (and go to the system cash drawer), then the other items. What is left owed on each item MUST be recorded so it can be ticked later.
- **FR-010**: Before confirming, when part of the payment will go to a system cash drawer, the repayment screen MUST show how much of the payment will go to each drawer. When all of it goes to the payment method's own drawer, no breakdown is shown.
- **FR-010a**: The customer-session checkout screen MUST show the same "Goes to" drawer split before confirming, when the basket contains a primary-system transfer paid at least partly in cash (owner decision 2026-10-11), computed by the same calculation the checkout posting uses.
- **FR-011**: The system MUST refuse a repayment that ticks an item that is not open (fully paid, refunded or voided), or an item that belongs to another customer, and MUST leave nothing changed when it refuses.
- **FR-012**: The ticked items MUST be decided by the cashier but checked by the system: the system works out the amounts per item and per drawer itself and never trusts amounts sent by the screen.

**Accounts page**

- **FR-013**: A basket on account MUST stay one line on the Accounts page, and the line MUST expand to list each item with its amount, its open amount, and whether it was refunded.
- **FR-014**: The items listed under a basket line MUST add up to the basket line's amount (refunded items shown separately).

**Profit**

- **FR-015**: Profit held for items sold on account MUST be released for the items the repayment actually paid, including items inside a basket.

**Reversal**

- **FR-016**: Voiding or refunding a repayment MUST reopen each item by exactly the amount that repayment paid, reverse every drawer movement it made (including moves into a system cash drawer), and hold again every profit it released. Creating and then voiding a repayment MUST leave every drawer, every debt item and every profit figure unchanged, per currency.

**Payment details on the Transactions page**

- **FR-019**: The payment details of a transaction MUST show one line per payment method and direction, with all its currencies on that line (for example `In — Cash: $115 + 200,000 LBP`), instead of one line per currency.
- **FR-020**: When the money of one payment line went to more than one drawer, that line MUST also show the amount per drawer, per currency (for example `In — Cash: $115 + 200,000 LBP {$101 OMT Cash Drawer · $14 + 200,000 LBP General}`). When it all went to one drawer, no breakdown is shown.
- **FR-021**: The amounts shown per drawer MUST add up to the line's amount, per currency, and MUST match the drawer changes the transaction actually made.

**Checkpoint**

- **FR-022**: The drawer checkpoint MUST keep comparing each currency separately (pass/fail per drawer, per currency), as today.
- **FR-023**: For each drawer that holds more than one currency, the checkpoint MUST also show an information-only total in USD, for the expected and the counted amounts, converted at the current rate. This total MUST NOT affect whether the drawer is balanced.

**Both apps**

- **FR-017**: All of the above MUST work the same in the desktop app and the web app.
- **FR-018**: The release notes MUST describe the change for shop owners and cashiers.

### Key Entities

- **Debt item**: something the customer owes for. Either a whole line from a separate visit, or one item inside a basket on account. Has an amount owed per currency, an amount paid so far, a type (transfer, sale, Loto, recharge, …), and for transfers the system it was made on (OMT, Whish, OMT App, Whish App, Binance).
- **Basket on account**: one debt line made by checking out a customer session on account. Contains several debt items.
- **Repayment**: money the customer hands over to reduce their debt. Has payment lines (method, currency, amount), optionally a list of ticked debt items, and a record of exactly which items it paid and by how much, which a void uses to undo it.
- **System cash drawer**: the primary system's cash drawer at the money-transfer counter (OMT Cash Drawer or Whish Cash Drawer).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the same items and the same cash, a basket on account and separate visits on account produce identical drawer changes in 100% of tested cases (full and partial payments, both primary systems).
- **SC-002**: In 0 tested cases does repayment money reach a system cash drawer for a secondary-system transfer, a wallet-app transaction, or a non-cash payment.
- **SC-003**: A cashier can tick an item and confirm a partial repayment in under 30 seconds on a customer with up to 20 open items.
- **SC-004**: Creating and then voiding a repayment (with and without ticked items) returns every drawer, every debt item and every held profit to its exact previous value, per currency, in 100% of tested cases.
- **SC-005**: For every basket line on the Accounts page, the listed items add up to the line's amount.
- **SC-006**: The same scenarios pass in both the desktop app and the web app.
- **SC-007**: For every tested repayment, the per-drawer amounts in the payment details equal the actual drawer changes, per currency.

## Assumptions

- The cashier's word decides what a payment is for. The system does not suggest items.
- A repayment with nothing ticked keeps today's order: sales first, then other items, oldest first. Only the drawer routing changes, so that it also covers baskets and only the primary system.
- Only cash is moved to a system cash drawer. This follows the owner's statement "make the money only go into OMT drawer if it is cash". Today, wallet payments of a transfer debt are also moved, so that part is a deliberate change.
- When nothing is ticked, the drawer move fills from the primary-system transfers first while the paid-item order stays as today (sales first). The two orders can differ on a partial payment; the owner accepted this (2026-10-10). Among several open transfers, the oldest is filled first.
- What the shop owes OMT/Whish, settlement with OMT/Whish, and any transaction paid in full at the time it was made are out of scope and unchanged.
- Changing how a basket is stored (one line per item instead of one per basket) is out of scope. The basket stays one line, made readable by expanding it.
- Picking items for a discount or write-off is out of scope.
- A debt added by hand on the Accounts page ("Add Credit / Debt") is listed as today but cannot be ticked: it is not linked to any item, so a payment simply lowers the balance (found in planning, research D7).
- A separate-visit line is picked as a whole. For example, one POS sale of three products on account is one line, not three; only a basket's items can be picked one by one.
- The roles allowed to take a repayment are unchanged.
- The merged one-line-per-method display (FR-019) applies to the payment details of every transaction on the Transactions page, not only repayments, because they share one display. The per-drawer breakdown (FR-020) appears wherever a line's money was split between drawers.
- The "Out — Customer Account" line on a repayment shows the debt the payment cleared. It moves no drawer and gets no breakdown.
