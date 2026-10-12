# Feature Specification: Wrong-Number Card Recharge — Loss, Redo and Credits Received

**Feature Branch**: `312-wrong-number-recharge` (work happens on `main`; no branch)

**Created**: 2026-10-12

**Status**: Draft

**Ticket**: LIRA-312 (`current_sprint.md`)

**Input**: User description: "Wrong-number MTC/Alfa card recharge (iPick/Katsh/Whish App digital cards). A cashier sometimes recharges the wrong phone number with an MTC/Alfa card bought from the iPick/Katsh balance. Owner decisions 2026-10-12: (A) noticed before the sale is saved → record it via Expenses "use an iPick/Katsh item" (existing), cost leaves the provider balance as a loss; (B) noticed after the sale is saved → a new "Refund as wrong number" action on the sale: the wrong recharge becomes a loss, the customer's RIGHT number is recharged again from the provider balance with no new payment (the customer's original payment covers the correct recharge), and a panel lets the cashier enter the credits received back from the wrong-number holder and which shop line received them. Credits can arrive later: the panel can be saved with 0 received ("waiting for credits") and updated later, once or several times. The same "Credits received" action exists on the expense path's wrong-number row. The cashier types the credits that actually arrived (no SMS-fee math). Credits received raise the chosen shop line's credit and the MTC/Alfa drawer and reduce the loss; lost days are never priced separately (loss = card cost − credits recovered); nothing returned = full card cost loss. Every step reversible. Desktop and web."

**Owner decisions (2026-10-12, selectable interview)**:

1. Noticed **before** the sale is saved: record the wasted card through Expenses → "use an iPick/Katsh item" (exists today).
2. Noticed **after** the sale is saved: a new **Refund as wrong number** action on the sale.
3. After a wrong number, the shop **recharges the customer's right number again**. The customer does not pay again.
4. Credits sent back can be entered **now or later**. A wrong-number record can wait at 0 received and be updated, once or several times.
5. The same **Credits received** action exists on the expense-path record.
6. The cashier types the credits that **actually arrived**. The app does no SMS-fee math.
7. Lost days are **not priced separately**: loss = card cost − credits recovered.

## Background — what exists today

- An MTC/Alfa card from iPick, Katsh or Whish App is a **digital recharge**: the shop's balance in that app pays for it, and the app recharges the typed number. Nothing physical changes hands.
  - Example: an Alfa $7.58 card costs the shop **770,000 LBP**, carries **$7.58 credit + 30 days**, and the customer pays **800,000 LBP**.
- **Expenses → use an item** already books an iPick/Katsh/Whish App catalog item as an expense at its cost, paid from that provider's balance, and it can be undone.
- A normal **refund** of a card sale gives the customer's money back **and** puts the provider balance back. That is wrong for a wrong-number recharge: the card was really used, so the balance must stay spent.
- The shop's own MTC/Alfa lines (shop lines) hold credit. Their total is the MTC/Alfa drawer.
- Nothing today records credits that a stranger sends back, so the cashier has no clear next step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fix a wrong-number sale that was already saved (Priority: P1)

The cashier sold an Alfa $7.58 card and saved it, but the recharge went to the wrong number. On that sale they choose **Refund as wrong number**. The wrong recharge becomes a loss of the card's cost. The app then has the cashier recharge the **customer's right number** with the same card from the same provider, with no new payment. A **Credits received** panel opens, where the cashier can enter credits already sent back (often $0 at this point) and the shop line they arrived on.

**Why this priority**: This is the case the owner asked for. Today there is no correct way to record it: a normal refund puts the provider balance back for a card that was really used, and the cashier is left guessing.

**Independent Test**: Sell an Alfa $7.58 card for 800,000. Refund it as wrong number with $0 received. Check:
- iPick balance: −770,000 for the wrong recharge, then −770,000 for the redo.
- The customer's 800,000 stays.
- The day shows a 770,000 loss.
- The sale shows "Wrong number — waiting for credits".

**Acceptance Scenarios**:

1. **Given** a saved Alfa $7.58 card sale (customer paid 800,000, cost 770,000 from iPick), **When** the cashier chooses Refund as wrong number, enters the right number and saves with $0 received, **Then**:
   - the customer's 800,000 stays in the drawer;
   - the wrong recharge is booked as a loss of 770,000 LBP;
   - a second 770,000 is taken from the iPick balance for the recharge of the right number;
   - the sale's profit on the day is unchanged by the redo (the customer's payment now covers the correct recharge);
   - the record shows "waiting for credits".
2. **Given** the same refund, **When** the cashier enters $6.68 received on shop line 03222875 at that moment, **Then** that shop line's credit and the Alfa drawer each rise by $6.68, and the loss falls by the value of $6.68.
3. **Given** a sale that is not an MTC/Alfa card recharge (e.g. a phone accessory), **When** its actions are shown, **Then** Refund as wrong number is not offered.
4. **Given** a sale already refunded or already marked wrong number, **When** its actions are shown, **Then** Refund as wrong number is not offered again.

---

### User Story 2 - Enter credits sent back later (Priority: P1)

Hours or days later, the wrong-number holder sends back some of the credit. The cashier opens the wrong-number record (from the sale or from the expense) and uses **Credits received**: they type what actually arrived and pick the shop line it arrived on. They can do this more than once if credit comes back in parts. Each entry raises that shop line and the MTC/Alfa drawer, and reduces the loss.

**Why this priority**: This is the "clean next step" the owner wants. Without it, recovered credit either goes unrecorded or is typed onto a shop line by hand with no link to the loss.

**Independent Test**: On a wrong-number record waiting for credits, enter $6.68 on shop line 03222875. Check that the line and the Alfa drawer rose by $6.68, the record's loss fell to card cost − value of $6.68, and the record now shows what was recovered.

**Acceptance Scenarios**:

1. **Given** a wrong-number record with $0 received, **When** the cashier enters $6.68 on shop line 03222875, **Then** the shop line's credit rises by $6.68, the Alfa drawer rises by $6.68, the record shows "$6.68 recovered", and the loss falls by the same value.
2. **Given** $4.00 already entered, **When** another $2.68 is entered later, **Then** the total recovered is $6.68, each entry is listed with its date, and each can be undone on its own.
3. **Given** an Alfa card, **When** the cashier picks a shop line, **Then** only active Alfa shop lines are offered (an MTC line is not).
4. **Given** credits are never sent back, **When** nothing is entered, **Then** the loss stays at the full card cost.

---

### User Story 3 - Record a wrong number noticed before saving (Priority: P2)

The cashier notices the mistake before saving the sale. They record the wasted card through **Expenses → use an item** (iPick/Katsh/Whish App, the exact card), marked as a wrong-number card. Its cost leaves the provider balance as a loss, and they then sell the card to the right number as a normal sale. Later, the same **Credits received** action is available on that expense record.

**Why this priority**: Most of this already exists. The new part is marking the expense as a wrong-number card so credits received can be entered against it.

**Independent Test**: Record an Alfa $7.58 card as a wrong-number expense, then enter $6.68 received on it. Check that iPick −770,000, the expense shows a 770,000 loss, and after the entry the shop line and drawer rose by $6.68 and the loss fell.

**Acceptance Scenarios**:

1. **Given** the Expenses page, **When** the cashier uses the iPick Alfa $7.58 item and ticks "Wrong number", **Then** 770,000 LBP leaves the iPick balance and the expense shows as a wrong-number card, waiting for credits.
2. **Given** that expense, **When** Credits received is used, **Then** it behaves exactly as in User Story 2.

---

### User Story 4 - Undo any step (Priority: P2)

Any step can be undone from Transactions with nothing left over:
- a refund as wrong number (the loss, the redo recharge, any credits entries);
- a single credits-received entry;
- a wrong-number expense.

**Why this priority**: Money rule. Every record the flow writes must be reversible, netting to zero on every balance it touched.

**Independent Test**: Refund as wrong number with $6.68 received, then undo it. Check that the iPick balance, the shop line, the Alfa drawer, the customer's sale and the day's profit are exactly as before the refund.

**Acceptance Scenarios**:

1. **Given** a credits-received entry of $6.68, **When** it is undone, **Then** the shop line and Alfa drawer drop by $6.68 and the loss rises back by the same value.
2. **Given** a refund as wrong number with no credits entered, **When** it is undone, **Then** both iPick debits (wrong recharge and redo) are put back and the sale returns to a normal sale.
3. **Given** a refund as wrong number with credits entries, **When** the cashier tries to undo the refund, **Then** they are asked to undo the credits entries first (newest first), and nothing changes until they do.

---

### Edge Cases

- **Shop line short of credit on undo:** undoing a credits entry that would take the shop line below zero is allowed only if the existing shop-line rules allow it. Otherwise it is refused with a plain message.
- **More credit than the card:** entering credits above the card's credit (e.g. $9 on a $7.58 card) is refused: "That is more credit than the card carried ($7.58)."
- **Card from a different provider for the redo:** the redo uses the same provider and the same card by default. The cashier may pick another provider that has that card, and its balance is used instead.
- **Provider balance too low for the redo:** handled the same way a normal card sale is handled today, with no new refusal rule.
- **A session (basket) sale:** a card sold inside a customer session can be refunded as wrong number like any other card line.
- **Customer account / debt payments:** the customer's original payment method is not touched. The refund as wrong number never moves money to or from the customer.
- **Today vs another day:** the loss and any credits entries are booked on the day they are done, using the shop's own calendar day.

## Requirements *(mandatory)*

### Functional Requirements

**Refund as wrong number (saved sale)**

- **FR-001**: An MTC/Alfa card sale (iPick, Katsh or Whish App) that is not refunded MUST offer a **Refund as wrong number** action, on desktop and web. Other sales MUST NOT offer it.
- **FR-002**: Refund as wrong number MUST book the wrong recharge as a loss equal to the card's cost, and MUST NOT put the provider balance back for it.
- **FR-003**: It MUST record a recharge of the customer's right number with the same card, taking the card's cost from the chosen provider's balance (default: the original provider), with no new customer payment. The customer's original payment and the sale's profit stay as they were.
- **FR-004**: It MUST ask for the right number and MUST refuse to save if it equals the wrong number (compared in any format: spaces, dashes, +961).
- **FR-005**: It MUST open the Credits received panel at the same time. Saving with $0 received is allowed and leaves the record "waiting for credits".

**Credits received (both paths)**

- **FR-006**: A wrong-number record (refunded sale or wrong-number expense) MUST offer **Credits received** for as long as it exists, and allow any number of entries.
- **FR-007**: Each entry MUST take the amount that actually arrived (USD credit, > 0) and an active shop line of the card's carrier. The total entered MUST NOT exceed the card's credit.
- **FR-008**: Each entry MUST raise the chosen shop line's credit and that carrier's MTC/Alfa drawer by the amount, and reduce the record's loss by the same value. The app MUST NOT compute or deduct any SMS fee.
- **FR-009**: The record MUST show the card, the wrong number, the right number (sale path), the card cost, the total recovered, the remaining loss, each entry with its date and shop line, and a status: "waiting for credits" while nothing is recovered, otherwise "partly recovered".
- **FR-010**: Lost days MUST NOT be priced separately. Loss = card cost − value of credits recovered.

**Expense path**

- **FR-011**: Expenses → use an item (iPick/Katsh/Whish App) MUST offer a "Wrong number" option for MTC/Alfa cards that records the wrong number and makes the expense a wrong-number record (FR-006 to FR-010 apply).

**Reversal and parity**

- **FR-012**: Every step MUST be reversible from Transactions:
  - a credits entry, on its own (newest first);
  - the refund as wrong number, only once its credits entries are undone;
  - a wrong-number expense, only once its credits entries are undone.

  Each undo MUST net to zero on every balance it touched: provider balance, shop line, MTC/Alfa drawer, profit/loss, and the customer's sale.
- **FR-013**: The loss MUST appear in the day's profit (as an expense or loss line) and in the Transactions list with a clear label ("Wrong number", "Credits recovered").
- **FR-014**: Cashiers and admins MUST be able to record a wrong number (both paths) and enter credits received. Only admins can undo, as with every void today. The same roles apply on both transports (owner, 2026-10-12).
- **FR-015**: Every capability MUST work the same on the desktop app and the web app.

### Key Entities

- **Wrong-number record**: links a wasted card recharge to its source (a refunded sale or an expense). Holds the carrier, provider, card, card cost, card credit, wrong number, right number (sale path), status and total recovered.
- **Credits-received entry**: one amount of credit received back, with the date, the shop line it arrived on, and its reversal state.
- **Redo recharge** (sale path): the recharge of the customer's right number with the same card, paid from a provider balance, with no customer payment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can record a wrong-number sale and the redo in under 1 minute, with no other screen needed.
- **SC-002**: For the Alfa $7.58 example (cost 770,000, paid 800,000), after a refund as wrong number and $6.68 received:
  - the iPick balance is down 1,540,000 (wrong recharge + redo);
  - the drawer still holds the 800,000;
  - the shop line and Alfa drawer are up $6.68;
  - the day's result equals the normal 30,000 profit minus (770,000 − value of $6.68).
- **SC-003**: Undoing every step returns every balance (provider, shop line, MTC/Alfa drawer, cash drawer, profit) exactly to its value before the wrong number was recorded.
- **SC-004**: Credits can be entered against a wrong-number record days later without anyone having to adjust a shop line by hand.
- **SC-005**: Every story passes the same checks on desktop and web.

## Assumptions

- "Cards" are the MTC/Alfa prepaid catalog items sold through iPick, Katsh or Whish App, as today. Other catalog items (internet bundles, gift cards) are out of scope.
- Recovered credit counts against the loss at the shop's credit sell price, 100,000 LBP per $1 by default (owner, 2026-10-12): a 1,200,000 card with $6 back shows a 600,000 loss. The shop line and drawer still rise by the face USD amount.
- The redo recharge has no profit of its own. The original sale keeps its profit, so the only extra is the wrong recharge's loss.
- Sending the replacement recharge in the provider's app is done by the cashier outside LiraTek, as today. LiraTek records it.
- Recording who made the mistake is out of scope.
