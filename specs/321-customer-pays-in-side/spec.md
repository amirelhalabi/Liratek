# Feature Specification: Customer pays — the money-in side of payout screens

**Feature Branch**: `321-customer-pays-in-side` (work happens on `main`; ticket LIRA-321)

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description (owner decisions, 2026-10-14): "On payout screens (the shop pays the customer), the payment box only lets the cashier edit what the shop pays out. The money-in side is fixed, or limited to a fee, so a customer who pays short cannot be recorded. Trigger case: Exchange — a customer buys $1,000 at 89,500 LBP/USD = 89,500,000 LBP, pays 87,600,000 LBP now and owes 1,900,000 LBP (≈ $21.23). Reuse the existing 'Customer pays' section of the shared payment box as the general money-in side of every payout screen — no second payment form."

**Design reference**: proposal with mock-ups — https://claude.ai/artifact/2EznUMNFMzPTC4inbQS7r4

**Builds on**: the customer-paid fee section shipped by the bidirectional payment legs work (Whish/OMT system receive, Whish/OMT App receive "fee paid separately", Binance cash-out "fee paid separately"). That section is generalised here; it is not replaced.

## Clarifications

### Session 2026-10-14 (owner decisions recorded with the request)

- Q: What does "Customer pays" hold? → A: Everything the customer owes for the transaction: the main amount and, when the fee is paid separately, the fee.
- Q: How is it pre-filled? → A: One line per owed thing, each with its usual method — a main-amount line and a fee line (two lines, never one combined line).
- Q: Single / split behaviour? → A: Exactly like the shop-pays section: single = one line, no "+ Add line", no remove ×; its own Split toggle that behaves like the shop-pays one; typing less than owed in single mode switches to split and adds the leftover line; opens in split mode when two things are owed.
- Q: Must it balance? → A: Yes. The leftover line defaults to Customer Account (the customer owes it) when a client is linked; Forgive is available within $5 / 450,000 LBP.
- Q: Naming? → A: The shop-pays section header changes from "Payment" to "Shop pays" with tag OUT (was "YOU PAY"); the customer section gets tag IN (was "CUSTOMER PAYS"). On Exchange the title is "Customer pays — <currency>" and its currency is locked to the currency being exchanged; on every other screen the title is plain "Customer pays" and the currency is free.
- Q: A shortfall on a USDT (Binance) or EUR (Exchange) line — client debts hold only USD and LBP? → A: The customer owes the USD equivalent, at the exchange's own rate to USD (the rate on the sheet). (Owner, 2026-10-14.)
- Q: EUR owing? → A: Blocked for now (owner 2026-10-14). On an exchange where the customer pays in anything other than USD or LBP, there is no Customer Account line and no Forgive — the customer pays in full. The exchange lot records the full amount as bought while the drawer only gets what was paid, so a later sale would oversell; the USD-equivalent rule above stays for USDT on Binance only.
- Q: Where is the client picked on Exchange? → A: Also inside the payment window: a client row under the Summary, sharing the page's client field, so "Still to settle … pick a client" is settled without closing the sheet. Hidden for a partner exchange. (Owner, 2026-10-14.)
- Q: Can "Customer pays" add up to more than is owed? → A: No, it is blocked. Extra money goes through the existing change box. (Owner, 2026-10-14.)
- Q: Customer session baskets? → A: Out of scope for now. (Owner, 2026-10-14.)
- Q: Whish ↓ header "Cashout" on payout screens with a customer section? → A: Becomes "Shop pays", like every payout screen. (Owner, 2026-10-14.)
- Q: How much does a customer owe when short on USDT? → A: 1 USDT = $1 (no USDT rate in the app; same convention as the Binance payout). (Owner, 2026-10-14.)
- Q: Whish ↓ system receive beyond the fee? → A: Nothing. The customer never takes more than was sent; a wanted advance is a separate debt on the Debts page. Whish ↓ stays fee-only. (Owner, 2026-10-14.)
- Q: Order of the two sections? → A: "Customer pays" (IN) on top, "Shop pays" (OUT) below it. Order on screen only: every amount, line, total, check and saved payload stays exactly as with the old order. (Owner, 2026-10-14.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange: customer pays part now, owes the rest (Priority: P1)

A customer buys $1,000 at 89,500 LBP per dollar, so they owe 89,500,000 LBP. They hand over 87,600,000 LBP. The cashier picks the customer as a client, types 87,600,000 in "Customer pays — LBP"; the box switches to split and adds a 1,900,000 LBP leftover line set to Customer Account. The cashier hands over $1,000 and saves. The customer now owes the shop 1,900,000 LBP (≈ $21.23), visible on the Debts page.

**Why this priority**: This is the case that triggered the request. Today the exchange can only be saved as if the customer paid in full, so the cash drawer is wrong and the debt is lost.

**Independent Test**: Run the exchange above with a linked client and check the three ledgers: LBP cash drawer, USD cash drawer, client debt.

**Acceptance Scenarios**:

1. **Given** an exchange of $1,000 at 89,500 (customer pays 89,500,000 LBP) and a linked client, **When** the customer pays 87,600,000 LBP cash and the leftover 1,900,000 LBP goes to Customer Account, **Then** the LBP cash drawer goes up by 87,600,000, the USD cash drawer goes down by 1,000, and the client owes 1,900,000 LBP, shown on Debts as an exchange debt.
2. **Given** the same exchange, **When** the customer pays the full 89,500,000 LBP, **Then** the result is exactly what Exchange records today: LBP cash +89,500,000, USD cash −1,000, no debt.
3. **Given** the same exchange with **no** client linked, **When** the cashier leaves 1,900,000 LBP unpaid, **Then** the exchange cannot be saved and the screen asks the cashier to pick a client (the shortfall is above the Forgive limit of 450,000 LBP).
4. **Given** the same exchange with no client linked, **When** the customer pays 89,200,000 LBP and the cashier forgives the 300,000 LBP left, **Then** the exchange saves with LBP cash +89,200,000, USD cash −1,000, no debt, and the 300,000 LBP recorded as forgiven.
5. **Given** an exchange where nothing is owed, **When** the cashier saves it without picking a client, **Then** it saves exactly as today — a client is only required when something is left on account.
6. **Given** the Exchange screen, **When** the cashier opens the currency menu of a "Customer pays" line, **Then** it is locked to the currency being exchanged (LBP in this example).
7. **Given** the exchange in scenario 1, **When** the shop exchange profit is reported, **Then** it is the same as for a fully paid exchange — owing does not change profit.

---

### User Story 2 - The money-in side works like the money-out side (Priority: P1)

On every payout screen the payment box shows two clearly named sections: "Shop pays" (OUT) and "Customer pays" (IN). The customer section is pre-filled with what the customer owes, one line per owed thing, and behaves exactly like the shop-pays section: single or split, the same Split toggle, automatic split when the cashier types less than owed, and a leftover line that must be settled (Customer Account or Forgive) before saving.

**Why this priority**: This is the shared foundation every screen in Stories 1, 3 and 4 stands on. Building it once keeps the screens consistent and is the only way the cashier learns one behaviour, not four.

**Independent Test**: On the existing Whish App receive with "fee paid separately" (fee line only until Story 3 adds the transfer line), check the section names, tags and order, single/split behaviour, the leftover line, and that Confirm stays disabled while the customer side does not balance.

**Acceptance Scenarios**:

1. **Given** a payout screen, **When** the payment box opens, **Then** the customer's section (tag IN) is on top and the shop's section, titled "Shop pays" with tag OUT, is below it.
2. **Given** a screen where the customer owes only one thing, **When** the box opens, **Then** "Customer pays" is in single mode with one line, no "+ Add line" and no remove ×.
3. **Given** a screen where the customer owes the amount and a separately paid fee, **When** the box opens, **Then** "Customer pays" opens in split mode with two lines — the amount with its usual method and the fee in Cash.
4. **Given** single mode and a linked client, **When** the cashier types less than owed, **Then** the section switches to split and adds a Customer Account leftover line for the difference.
5. **Given** single mode and **no** client, **When** the cashier types less than owed, **Then** no line is added, saving stays blocked, and the screen reads "Still to settle: <amount> — pick a client to put it on their account" (", or forgive it" when within $5 / 450,000 LBP); picking a client then adds the Customer Account leftover line.
6. **Given** the customer side does not add up to what is owed (after Customer Account and Forgive), **When** the cashier tries to save, **Then** saving is blocked with a message saying how much is still unaccounted for.
7. **Given** a money-in screen such as the POS checkout, **When** its payment box opens, **Then** its header and tags are unchanged — the "Shop pays / OUT" naming appears only on payout screens.

---

### User Story 3 - Whish App / OMT App cash-out: customer pays the transfer in several ways (Priority: P2)

A customer cashes out $100 through the shop's Whish App with a $5 fee paid separately. They might send all $100 by Whish, or split it across Whish and OMT, or pay part in cash, or owe part. The cashier records exactly what came in; the shop pays out $100 cash.

**Why this priority**: Second most common payout flow after Exchange. Delivered after the foundation and Exchange, Whish App first, then OMT App.

**Independent Test**: Run each scenario below and compare the Whish wallet, OMT wallet, USD cash drawer and client debt to the expected deltas.

**Acceptance Scenarios** (all: cash-out $100 paid to the customer in USD cash, $5 fee paid separately):

1. **Given** the box opens, **When** nothing is changed, **Then** "Customer pays" shows two lines: $100 · Whish wallet and $5 · Cash, and saving gives Whish wallet +100, USD cash −95.
2. **(a)** **Given** the customer pays Whish $90 + OMT $10 + Cash $5 fee, **When** saved, **Then** Whish wallet +90, OMT wallet +10, USD cash −95, no debt.
3. **(b)** **Given** the customer pays Whish $90 + Cash $10 + Cash $5 fee, **When** saved, **Then** Whish wallet +90, USD cash −85, no debt.
4. **(c)** **Given** a linked client who pays Whish $90 + Cash $5 fee and leaves $10 on Customer Account, **When** saved, **Then** Whish wallet +90, USD cash −95, and the client owes $10.
5. **Given** any of (a)–(c), **When** profit is reported, **Then** the $5 fee is shop profit, the same in every case — owing $10 does not change profit.
6. **Given** OMT App receive (which takes no fee — owner decision D1, still in force), **When** the transfer cases are run with OMT wallet as the usual method, **Then** the results mirror (a)–(c) with the wallets swapped and no fee line.

---

### User Story 4 - Binance cash-out: customer pays the USDT in several ways (Priority: P2)

A customer cashes out USDT through the shop's Binance account. "Customer pays" is pre-filled with the USDT amount · Binance (+ the fee · Cash when paid separately); the cashier can record a split or a shortfall the same way as Story 3.

**Why this priority**: Same shape as Story 3, lower volume. Delivered after Whish App and OMT App.

**Independent Test**: Cash out 100 USDT paid to the customer as $100 cash, $2 fee paid separately; the customer pays 80 USDT by Binance + $20 cash + $2 cash fee; check Binance wallet +80 USDT and USD cash −78 (−100 + 20 + 2).

**Acceptance Scenarios**:

1. **Given** a 100 USDT cash-out paid as $100 cash with a $2 fee paid separately, **When** nothing is changed, **Then** Binance wallet +100 USDT and USD cash −98.
2. **Given** the same, **When** the customer pays 80 USDT by Binance + $20 Cash for the transfer + $2 Cash fee, **Then** Binance wallet +80 USDT and USD cash −78.
3. **Given** a linked client, **When** the customer pays 80 USDT by Binance + $2 Cash fee and leaves $20 on Customer Account, **Then** Binance wallet +80 USDT, USD cash −98, client owes $20.
4. **Given** a linked client and a 100 USDT cash-out, **When** the customer sends 80 USDT by Binance and nothing else for the transfer, **Then** the leftover line is Customer Account for $20 (20 USDT counted as $20, 1 USDT = $1) and the client owes $20.

---

### User Story 5 - Undo any of these transactions (Priority: P1)

Any exchange or cash-out recorded with a split or a shortfall can be voided or fully refunded, and every drawer, wallet, debt and profit it touched goes back to where it was.

**Why this priority**: Money integrity. A debt that survives a refund was a real, owner-reported bug in a related feature.

**Independent Test**: For each acceptance scenario of Stories 1, 3 and 4, record it, refund it, and confirm every ledger nets to zero in each currency.

**Acceptance Scenarios**:

1. **Given** the Story 1 exchange with 1,900,000 LBP owed, **When** it is refunded, **Then** LBP cash −87,600,000, USD cash +1,000, and the client's 1,900,000 LBP debt is removed — each nets to 0.
2. **Given** each Whish App case (a), (b), (c), **When** refunded, **Then** Whish wallet, OMT wallet, USD cash, client debt and fee profit each net to 0.
3. **Given** a client who already paid back part of an exchange debt, **When** the exchange is refunded, **Then** the result follows the same rule the shop already uses for refunding other transactions charged to an account.

---

### User Story 6 - Whish ↓ system receive on the OMT/Whish page (Priority: none — no change)

Decided by the owner (2026-10-14): Whish ↓ stays fee-only. The customer collects money a sender paid through Whish; the shop's partner pays the shop the transfer later (Whish is the partner's system, not the shop's). The customer owes only the fee, which the existing "Customer pays" section already handles (with the prerequisite, the unpaid part of the fee goes on the client's account). A customer never takes more than was sent through this screen; if they want more, the cashier opens a separate debt on the Debts page. Nothing to build.

---

### Edge Cases

- **For-Partner exchange**: there is no walk-in customer handing over money, so the whole "Customer pays" section is hidden — not only Customer Account.
- **Exchange from a currency other than USD/LBP (e.g. EUR)**: the customer section is locked to EUR and the customer pays in full — no Customer Account line, no Forgive; Confirm stays off until the lines add up. The server refuses an account line or a forgiven amount with "Owing or forgiving isn't available yet when the customer pays in EUR — take the full amount." (Blocked for now, owner 2026-10-14: the exchange lot would record 100 EUR bought while the drawer got 95, so selling later would oversell.)
- **Overpaying**: the customer side cannot add up to more than is owed; giving change stays on the existing change flow.
- **Shortfall above the Forgive limit and no client**: saving is blocked until a client is picked or the customer pays more.
- **Client picked after typing less**: the Customer Account leftover line is added then. A line the cashier added with "+ Add line" keeps its method; removing the client removes the auto-added account line again (it never becomes cash).
- **Fee switched from "paid separately" to "deducted" or "sender pays"**: the fee line disappears and the section returns to single mode if only the amount is owed.
- **Customer session basket**: the separately-paid fee option is already hidden inside a session; this feature does not change session checkout, and Exchange is not a session item.
- **Desktop offline**: an exchange or cash-out with a debt recorded while offline gives the same drawers, wallets and debt after it syncs.
- **Web app and desktop app**: every scenario gives the same result on both.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On payout screens the payment box MUST show two sections, "Shop pays" (tag OUT) and "Customer pays" (tag IN), in one payment box — no second payment form.
- **FR-002**: The new naming MUST appear only on payout screens; payment boxes on money-in screens (POS checkout and others) keep their current header.
- **FR-003**: "Customer pays" MUST hold everything the customer owes for the transaction: the main amount and, when the fee is paid separately, the fee.
- **FR-004**: "Customer pays" MUST be pre-filled with one line per owed thing, each in its usual method (see FR-013), never one combined line.
- **FR-005**: "Customer pays" MUST behave like "Shop pays" for single/split: single = one line, no "+ Add line", no remove ×; the same Split toggle; opening in split when two things are owed.
- **FR-006**: Typing less than owed on the single line MUST switch to split and add a Customer Account leftover line for the difference when Customer Account is available (client linked). With no client it MUST NOT add any line — the shortfall stays unsettled and blocks saving.
- **FR-007**: The section MUST never fill a shortfall with Cash by itself. With no client, "Still to settle" MUST tell the cashier to pick a client (or forgive, when within the limit); Forgive MUST be available up to $5 / 450,000 LBP.
- **FR-008**: The transaction MUST NOT save unless the customer lines plus any amount owed plus any amount forgiven equal what the customer owes, per currency.
- **FR-009**: Customer Account MUST be offered only with a linked client and never in For-Partner mode. The debt is always booked in USD or LBP: a USDT shortfall (Binance) is booked as its USD equivalent at the exchange's own rate to USD (1 USDT = $1). **Note (owner 2026-10-14):** on Exchange, owing and forgiving are blocked when the customer pays in any currency other than USD or LBP (schemas and writer refuse it) until the exchange lot is booked at the amount actually received.
- **FR-010**: The shop-pays side MUST keep refusing Customer Account on an exchange payout (an exchange payout is always real money).
- **FR-011**: Each customer line MUST put its money in the drawer or wallet of its method and currency; a Customer Account line MUST record a debt for the linked client; a forgiven amount MUST be recorded as forgiven.
- **FR-012**: Owing MUST NOT change the transaction's profit amount; the fee stays shop profit. A forgiven shortfall is booked the same way forgiving is booked everywhere else (the existing "waived" profit line), so it lowers profit by the forgiven amount.
- **FR-013**: Pre-fill per screen: Exchange → price in the currency being exchanged · Cash, currency locked; Whish App receive → transfer amount · Whish wallet (+ fee · Cash when paid separately); OMT App receive → transfer amount · OMT wallet only (no fee, D1); Binance cash-out → USDT amount · Binance (+ fee · Cash when paid separately). Whish system receive: unchanged, fee only (User Story 6).
- **FR-014**: Exchange MUST let the cashier link a client; a client MUST be required only when something is left on Customer Account. The client MUST be saved with the exchange and shown wherever exchanges are listed.
- **FR-015**: An exchange debt MUST appear on the client's Debts page and be repayable like any other debt.
- **FR-016**: Voiding or refunding any transaction recorded this way MUST return every drawer, wallet, client debt and profit it changed to zero, per currency.
- **FR-017**: Every scenario MUST give the same result on the desktop app and the web app, including desktop actions recorded offline and synced later.
- **FR-018**: With no change made to the customer section, every screen MUST record exactly what it records today.
- **FR-019**: On payout screens the "Customer pays" (IN) section MUST appear above the "Shop pays" (OUT) section. Changing the order MUST NOT change any amount, default, total, validation or saved data.

### Key Entities

- **Customer line**: one thing the customer handed over — method, currency, amount. Belongs to one transaction.
- **Owed thing**: the main amount or the separately paid fee — what the customer lines must cover.
- **Client debt**: an amount the linked client owes the shop because of a Customer Account line, in USD or LBP, tied to the transaction so a refund can remove it.
- **Exchange**: now optionally linked to a client (today it keeps only a typed name).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The trigger exchange (89,500,000 LBP owed, 87,600,000 paid) can be recorded in one go, with the 1,900,000 LBP debt visible on the client's Debts page immediately.
- **SC-002**: For every acceptance scenario in Stories 1, 3 and 4, the drawer, wallet and debt changes match the stated amounts exactly, in each currency.
- **SC-003**: For every such scenario, a refund brings every drawer, wallet, debt and profit back to zero in each currency — 0 exceptions.
- **SC-004**: A transaction whose customer side does not balance can never be saved.
- **SC-005**: Cashiers record a split or short payment on any payout screen without leaving the payment box and without a second form.
- **SC-006**: Every scenario gives identical results on the desktop app and the web app.

## Delivery phases

- **Prerequisite (separate small change, not specified here)**: in the existing fee section, a leftover line added with "+ Add line" defaults to Customer Account when a client is linked.
- **Phase 1 — shared foundation**: Story 2 (naming, pre-fill, single/split, balance check against amount + fee, one shared way of booking customer lines).
- **Phase 2 — Exchange**: Story 1 and its refunds (Story 5).
- **Phase 3 — Whish App, then OMT App, then Binance**, one at a time: Stories 3 and 4 and their refunds. Moving the wallet inflow from a fixed amount onto the customer's lines is the riskiest step.

## What users will notice

On cash-out and exchange screens the payment box now shows "Shop pays" and "Customer pays". Cashiers can record a customer who pays part now and owes the rest, or pays across several methods (for example Whish and cash), and Exchange can now be linked to a client.

## Assumptions

- Client debts exist only in USD and LBP, so a shortfall on a USDT (Binance) line is owed as its USD equivalent at the exchange's own rate to USD (the rate on the sheet) (owner decision 2026-10-14). A EUR (or other non-USD/LBP) Exchange cannot be owed or forgiven for now (owner decision 2026-10-14).
- The customer side never exceeds what is owed; change is handled by the existing change flow.
- Session baskets are out of scope; session checkout is unchanged.
- The Forgive limit is the shop-wide one already used elsewhere ($5 / 450,000 LBP).
- Refund of a partly repaid exchange debt follows the existing rule for account-charged transactions.
- Today the Whish App, OMT App and Binance cash-outs put the full transfer amount into the wallet automatically; after this feature the wallet receives only what the customer lines say.
- The release note line is written when the feature is implemented (CLAUDE.md rule 30); this spec only drafts it above.
