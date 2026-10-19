# Feature Specification: Customer adds change on payouts

**Feature Branch**: `336-customer-adds-change` (work happens on `main`; ticket LIRA-336)

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Shop owes a customer a $197 payout; the cashier asks the customer for $3 (or 268,500 LBP) and hands out $200. Today this can't be recorded. On every payout screen the IN section can take money the customer adds on top of its target; that amount raises what the shop pays out by the same amount. Both drawers record what really moved, no rounding expense, profit unchanged. Desktop and web."

## Why

When a shop owes a customer a payout and has no small notes, the cashier often asks the customer for a few dollars or some Lebanese pounds and hands over a round amount. Example: $197 owed, the customer gives $3, the shop gives $200. Today the payment window cannot record this:

- The "Customer pays" section on payout screens accepts exactly its own amount and refuses anything above it.
- What the shop pays out never takes the customer's money into account.
- Typing $200 as the payout is accepted as a $3 "round-up" and booked as a "Change rounding" expense, which is wrong because the $3 came from the customer.
- OMT/Whish system receive, Hold Money pickup, credit buy-back and Whish/OMT App "From client" have no "Customer pays" section at all.

When the customer's money is in Lebanese pounds and the payout is in dollars, the only workaround (typing $197) leaves both drawers wrong.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - OMT receive: customer gives $3, shop gives $200 (Priority: P1)

A customer collects an OMT transfer of $197. The cashier has no $1 notes, so they ask the customer for $3 and hand over two $100 notes. In the payment window the cashier opens "Customer gives change" and enters Cash USD 3. "Shop pays" now expects $200. The cashier enters Cash USD 200 and confirms.

**Why this priority**: It is the owner's case, on the busiest payout screen, which has no customer section today.

**Independent Test**: On the Services page, record the OMT receive of $197 as above. Check:
- the General USD drawer moves by −$197 in total (+3 in, −200 out, both lines saved);
- no "Change rounding" expense is booked;
- the receive's own amount and profit are the same as for a plain $197 payout.

**Acceptance Scenarios**:

1. **Given** an OMT receive of $197, **When** the cashier enters "Customer gives" Cash USD 3, **Then** "Shop pays" shows $200 to pay out ($197 owed + $3 given by the customer).
2. **Given** that, **When** the cashier enters Cash USD 200 and confirms, **Then** the transaction saves with one IN line of $3 and one OUT line of $200, and no rounding expense or kept change is recorded.
3. **Given** a saved receive like this, **When** it is voided, **Then** both lines are reversed and the drawer returns to its earlier balance.
4. **Given** "Customer gives" Cash USD 3, **When** the cashier pays out only $197, **Then** the payment window shows $3 still to pay out, as for any shortfall (and the existing "Change kept" rule applies if the cashier keeps it).

---

### User Story 2 - Customer gives Lebanese pounds, shop pays dollars (Priority: P1)

Same payout of $197, but the customer gives 268,500 LBP (the $3 at the cashier's rate of 89,500) and the cashier hands over $200.

**Why this priority**: This is the case no workaround can record today. Typing $197 leaves the USD drawer $3 high and the LBP drawer 268,500 low.

**Independent Test**: Record it. Check that the General USD drawer moves by −$200, the General LBP drawer moves by +268,500, and nothing is booked as rounding.

**Acceptance Scenarios**:

1. **Given** a $197 payout, **When** the cashier enters "Customer gives" Cash LBP 268,500 at the rate of 89,500, **Then** "Shop pays" shows $200.
2. **Given** that, **When** the cashier pays out $200 and confirms, **Then** the USD drawer is −200 and the LBP drawer is +268,500.
3. **Given** the cashier changes the rate in the window, **When** "Customer gives" is in LBP, **Then** "Shop pays" follows the new rate.

---

### User Story 3 - The same on every payout screen (Priority: P1)

The same works on Whish system receive, Binance cash-out, Whish App / OMT App receive, "From client" top-up, Exchange, Hold Money pickup and credit buy-back.

- On screens that already have a "Customer pays" section (Exchange, Binance cash-out, Whish App / OMT App receive), money above what the customer owes counts as change the customer adds.
- On the others, a "Customer gives change" section is available but starts empty.

**Why this priority**: The owner asked for all payout screens. A screen that behaves differently would confuse cashiers.

**Independent Test**: On each screen, add $3 (or an LBP amount) from the customer and pay out the owed amount plus that. It saves with both drawers right and no rounding expense.

**Acceptance Scenarios**:

1. **Given** a Whish App receive where the customer sends $100 by Whish and is owed $97 in cash, **When** the cashier adds a second customer line, Cash USD 3, **Then** "Shop pays" expects $100.
2. **Given** an Exchange of 100 USD to LBP, **When** the customer also gives $1 so the shop can hand out a round LBP amount, **Then** "Shop pays" expects the LBP payout plus $1 at the exchange rate.
3. **Given** a Hold Money pickup or a credit buy-back, **When** the cashier opens "Customer gives change" and enters an amount, **Then** the payout target rises by that amount.
4. **Given** Debts cash-out or a refund, **Then** there is no "Customer gives change" section (these keep their own rules).

---

### Edge Cases

- **Customer gives change and the shop also rounds up.** Owed $197, customer gives $3, shop hands $201: the $1 above $200 is a round-up, under the existing round-up rule (cap $5 / 450,000 LBP).
- **Customer gives change and the shop keeps a little.** Owed $197, customer gives $3, shop hands $199.90: the $0.10 is kept change under the existing rule.
- **The customer's lines are below what they owe** on screens where the customer owes money (Exchange, app receive). The existing shortfall rules apply: the client's account, or a small Forgive. Only money above what is owed counts as added change.
- **Customer account or forgiven amounts** never count as added change. Only money that really came in (cash or a wallet) can raise the payout.
- **Above the cap**: a customer handing over more than $5 / 450,000 LBP of added change is refused. Use the Exchange page for a bigger swap.
- **Partner payouts made for a partner (FOR)**, and payouts inside a customer session, behave as today (no added change).
- **Offline desktop**: a payout recorded with added change replays the same way when it syncs. Older recorded payouts replay unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every payout screen in User Story 3 MUST let the cashier enter money the customer hands over in addition to what the customer owes (zero on screens where the customer owes nothing), in any cash or wallet method the screen offers for incoming money, in USD or LBP.
- **FR-002**: The money the customer adds, converted into the payout's currency at the rate the cashier uses, MUST raise the amount the shop is expected to pay out by the same value.
- **FR-003**: The round-up and kept-change rules MUST be applied after that raise, so money the customer added is never booked as a round-up expense or as kept change.
- **FR-004**: Each incoming line MUST go into its own drawer, and each outgoing line MUST come out of its own, so every drawer moves by what really moved.
- **FR-005**: The transaction's own amount and profit MUST equal those of the same payout without added change.
- **FR-006**: Voiding or refunding the payout MUST reverse every incoming and outgoing line, so each drawer nets to zero.
- **FR-007**: The server MUST check that the outgoing lines equal what is owed plus the added change, minus kept change, plus any round-up. If they don't, it MUST refuse the payout.
- **FR-008**: Added change MUST be accepted only when the request says it carries added change. A request without that, including any recorded before this feature, MUST behave exactly as today.
- **FR-009**: Customer-account and forgiven amounts MUST NOT count as added change.
- **FR-010**: There MUST be no added change on Debts cash-out, refunds, payouts made for a partner (FOR), or payouts inside a customer session (sessions: separate ticket, owner 2026-10-19).
- **FR-013 (phase 2, owner 2026-10-19)**: Added change MUST also work on an OMT/Whish system receive made THROUGH a partner. The customer's lines and the payout go in and out of the same drawer as today (General for the partner system), and the partner ledger is unchanged (it depends only on the transfer amount).
- **FR-014 (phase 2)**: Added change MUST also work when the payout is made by wallet (for example the shop pays $200 from Whish_App and the customer gives $3 cash): the wallet line comes out of its wallet drawer and the customer's lines go into their own drawers. On OMT/Whish system receive the wallet payout is posted line by line only when added change is claimed, so existing wallet payouts are unchanged.
- **FR-011**: The added change MUST be at most $5 (USD payouts) or 450,000 LBP (LBP payouts), measured in the payout's currency. This is the same cap as round-up and kept change. A larger swap goes through the Exchange page. Above the cap, the payment window and the server refuse it.
- **FR-012**: Desktop and web MUST behave identically.

### Key Entities

- **Added change**: money the customer hands over on top of what they owe, during a payout, so the shop can pay out a round amount. It has a method, a currency and an amount. It is saved as an incoming line of the payout and raises the expected payout total. It has no profit effect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can record "customer gives $3, shop gives $200" on any listed payout screen in one window, with no workaround and no retyping.
- **SC-002**: After such payouts, the closing count of each drawer (USD and LBP) matches the expected balance, with zero variance caused by them.
- **SC-003**: No "Change rounding" expense is booked for money the customer added.
- **SC-004**: Voiding such a payout returns every drawer to its earlier balance.

## Clarifications

### Session 2026-10-18

- Q: Should added change have a ceiling? → A: $5 / 450,000 LBP, the same cap as round-up and kept change (owner).

### Session 2026-10-19 (phase 2)

- Q: Through a partner, by wallet, inside a session? → A: Through a partner and by wallet now (phase 2); sessions in a separate ticket.

## Assumptions

- "Payout screens" follows LIRA-334: OMT/Whish system receive, Binance cash-out, OMT App / Whish App receive, "From client" top-up, Exchange, Hold Money pickup (one-currency pickups first, matching the round-up) and credit buy-back.
- On screens with no customer section today, the section is hidden behind a small "+ Customer gives change" link, so the normal payout looks exactly as it does now.
- The rate used to convert added change is the rate the cashier uses in the window, the same rate the payment box already uses for the payout.
- Added change uses the existing incoming payment lines, so receipts and the Transactions details list it like any other incoming line.
- Profit is unchanged because the customer's money and the extra paid out cancel exactly.
