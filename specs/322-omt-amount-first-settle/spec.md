# Feature Specification: OMT settlement by amount, one currency at a time

**Feature Branch**: `322-omt-amount-first-settle` (work happens on `main`; ticket LIRA-322)

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description (owner, 2026-10-15, paraphrased): "In OMT settlement I want to be able to settle only the USD amount or only the LBP amount. Today I am obliged to settle both amounts. Most of the time the user will not select the list — he will just say 'I'm going to pay this amount' or 'OMT is going to pay me this amount', and the system should decide which transactions are settled based on the payment. This is currency-related: OMT does not accept settling LBP transactions in anything but LBP, so all LBP transactions are settled in LBP and all USD transactions in USD."

**Builds on**: the OMT open-credit account (one account for the OMT counter, OMT App and iPick), its Settle Account sheet, commission at settlement, "extra payment goes on the account" (LIRA-315) and the settlement Waive (LIRA-310).

## Clarifications

### Session 2026-10-15 (owner decisions recorded with the request)

- Q: Who decides which transactions a settlement closes? → A: The payment does. The operator enters what was paid (or received); the system closes transactions oldest first. Ticking transactions by hand stays available as an optional override.
- Q: Can money in one currency settle transactions in the other? → A: Never. USD money settles USD transactions only; LBP money settles LBP transactions only. A currency with no money entered leaves its transactions open.
- Q: Which transactions are in scope? → A: The whole OMT account — the counter, OMT App and iPick together, oldest first.
- Q: What if the payment does not cover a transaction fully? → A: Allowed. The transaction is partly paid; it stays open showing what is still owed, and a later settlement finishes it.
- Q: Amounts OMT owes the shop (receives, OMT App cash-outs, earlier extra payments) in the same currency? → A: Netted automatically against the oldest amounts the shop owes, before the payment is applied.
- Q: Commission on a partly paid transaction? → A: Counted only by the settlement that fully closes the transaction. A partly paid transaction waits.
- Q: Where does this live? → A: In the Settle Account sheet. For suppliers that belong to an OMT account, the Pay / Receive tab and the Commission settlement tick list are hidden, so Settle Account is the one way to pay OMT.
- Q: Extra money in a currency? → A: Unchanged (LIRA-315): it goes on the account as a credit in that currency.

### Session 2026-10-15 (owner answers to the two open points)

- Q: The shop owes OMT in one currency and OMT owes the shop in the other (shop owes $497, OMT owes 2,000,000 LBP) — one settlement? → A: Yes. Each currency carries its own direction; one confirmation pays $497 out and takes 2,000,000 LBP in.
- Q: How much money closes a transaction that carries commission? → A: Its full (gross) amount. The commission the operator enters at settlement counts toward coverage, as a separate amount next to the money. Paying the statement figure ($496.30) with the $0.70 commission entered closes all six transfers; paying $496.30 with no commission entered leaves the newest $21 transfer partly paid ($20.30) and $0.70 owed.

### Session 2026-10-15 (owner answers during planning)

- Q: Void an older settlement when a newer one paid the same transfers? → A: Refused. Settlements that share transfers are voided newest first ("Void the $100 settlement of 10/16 first"). Commission can never be counted twice.
- Q: One settlement that pays OMT in USD and takes LBP from OMT — how is it recorded? → A: One settlement entry with both currencies, each with its own direction. Change can come back in any currency, as today (LIRA-315).
- Q: A credit on one OMT line (OMT App) netted against a debt on another (counter) — what do the card's lines show? → A: The settlement moves the amount between the lines with a hidden pair of entries, so each line matches its own open transfers. The account total does not change.

## User Scenarios & Testing *(mandatory)*

Every example below uses the test shop's real OMT account: six USD transfers of $152, $101, $101, $101, $21 and $21 (oldest first, $497 owed), plus LBP transfers where stated.

### User Story 1 - Pay OMT in one currency only (Priority: P1)

The shop owes OMT $497 and 900,000 LBP. The operator opens Settle Account, enters Cash $497 and confirms. The six USD transfers close. The LBP transfer stays open, still owing 900,000 LBP. Nothing asks for LBP.

**Why this priority**: This is the reported defect. Today the sheet shows one merged figure ("Net you pay $507.11"), pre-fills one USD line, and the settlement is refused because LBP was not paid.

**Independent Test**: With USD and LBP both owed, settle with only a USD payment, then only an LBP payment. Check what closed and the account balance in each currency.

**Acceptance Scenarios**:

1. **Given** $497 and 900,000 LBP owed, **When** the operator pays Cash $497, **Then** all six USD transfers close, the LBP transfer stays open at 900,000 LBP, and the account shows $0 and 900,000 LBP owed.
2. **Given** the same account, **When** the operator pays Cash 900,000 LBP only, **Then** the LBP transfer closes and the six USD transfers stay open at $497.
3. **Given** the same account, **When** the operator pays Cash $497 and Cash 900,000 LBP, **Then** everything closes and nothing is owed in either currency.
4. **Given** the same account, **When** the operator pays $507.11 in USD only (the old merged figure), **Then** the USD transfers close, $10.11 is extra USD that goes on the account as credit (or is handed back as change), and the 900,000 LBP stays owed. USD money never reduces the LBP debt.
5. **Given** the sheet is open, **When** both currencies are owed, **Then** it shows two separate amounts ("$497.00" and "900,000 LBP"), never one figure converted into a single currency.

---

### User Story 2 - Pay part of what is owed; the system picks what closes (Priority: P1)

The operator pays Cash $300 against the $497 owed. The system applies it oldest first: $152 and $101 close ($253), the next $101 transfer gets $47 and stays open owing $54, and the rest stay untouched. Before confirming, the sheet shows exactly this.

**Why this priority**: The operator usually knows only how much they are handing OMT, not which transfers it covers. Without partial payment, any amount that does not match whole transfers is refused.

**Independent Test**: Pay $300 against the six transfers. Check which closed, which is partly paid and by how much, and what stays owed. Then pay $197 and check that everything is now closed.

**Acceptance Scenarios**:

1. **Given** $497 owed over six transfers, **When** the operator enters Cash $300, **Then** before confirming the sheet shows: 2 transfers close ($152, $101), 1 partly paid ($47 of $101, $54 still owed), 3 untouched, $197 still owed.
2. **Given** that settlement is confirmed, **When** the account is reopened, **Then** the partly paid transfer shows $54 still owed, the account shows $197 owed, and the two closed transfers no longer appear.
3. **Given** $197 still owed after scenario 2, **When** the operator pays Cash $197, **Then** the partly paid transfer and the three untouched ones close and nothing is owed.
4. **Given** the Transactions list for OMT, **When** a transfer is partly paid, **Then** it is labelled "Partial" with the amount paid, and the paid / partial / unpaid counts match what the settlements actually recorded.
5. **Given** a payment of $0.50 against $497 owed, **When** confirmed, **Then** it is accepted and the oldest transfer is partly paid by $0.50.

---

### User Story 3 - OMT owes the shop: credits net first (Priority: P2)

The shop owes OMT $497. OMT owes the shop $60 from an OMT App cash-out. The operator opens Settle Account. The sheet nets the two and shows "You pay OMT $437". Paying $437 closes everything, the cash-out included.

**Why this priority**: OMT's own statement is one net figure per currency. If credits are not netted automatically, the operator has to work the difference out by hand on every settlement.

**Independent Test**: Put a cash-out credit in the account, settle with the net amount only, and check that every debt and the credit close.

**Acceptance Scenarios**:

1. **Given** the shop owes $497 and OMT owes the shop 2,000,000 LBP, **When** the sheet opens, **Then** it shows "You pay OMT $497.00" and "OMT pays you 2,000,000 LBP"; paying $497 out and receiving 2,000,000 LBP in one confirmation closes everything in both currencies.
2. **Given** $497 owed and a $60 credit in USD, **When** the sheet opens, **Then** it shows $437 to pay in USD.
3. **Given** that state, **When** the operator pays Cash $437, **Then** all six transfers and the credit close, and the cash-out's deferred commission is recognised in that settlement.
4. **Given** $497 owed and a $60 credit, **When** the operator pays Cash $100, **Then** the credit is applied first ($60 of the $152 transfer), then the $100 is applied ($92 to finish the $152 transfer, $8 to the next one). The credit closes, the $152 transfer closes, and the next $101 transfer is partly paid ($8, $93 still owed).
5. **Given** OMT owes the shop more than the shop owes OMT in a currency (USD net is −$40), **When** the sheet opens, **Then** that currency shows "OMT pays you $40", and receiving $40 closes everything in USD.
6. **Given** a credit is in USD and the debt is in LBP only, **When** the sheet opens, **Then** the credit is not used against the LBP debt.

---

### User Story 4 - One place to pay OMT (Priority: P2)

For the OMT counter, OMT App and iPick, the Suppliers page offers Settle Account as the only way to pay or collect. The Pay / Receive tab and the Commission settlement tick list are gone for them. Suppliers outside an OMT account keep both.

**Why this priority**: Today there are three ways to pay OMT. Only one of them closes transactions, and the paid / unpaid labels come from another one. Operators end up with conflicting numbers.

**Independent Test**: Open the OMT counter, OMT App and iPick on the Suppliers page and confirm that only Settle Account is offered. Open Katsh and confirm that Pay / Receive still works.

**Acceptance Scenarios**:

1. **Given** a supplier inside an OMT account, **When** the operator opens it on the Suppliers page, **Then** there is no Pay / Receive tab and no Commission settlement tick list, and the Settle Account action is visible.
2. **Given** a supplier outside any account (e.g. Katsh, Whish App), **When** opened, **Then** Pay / Receive and its settle list work exactly as today.
3. **Given** an OMT account with payments recorded through Pay / Receive before this change, **When** Settle Account opens, **Then** those payments appear as credits and net against the oldest debt in their currency (Story 3). Nothing recorded before is lost or counted twice.
4. **Given** the Transactions list for OMT, **When** a transfer was settled, **Then** its Paid / Partial / Unpaid label comes from the settlements and not from a separate estimate.

---

### User Story 5 - Pick transactions by hand (optional override) (Priority: P3)

The operator wants this settlement to cover only certain transfers (for example, only Western Union, or one specific transfer OMT asked about). They tick those transfers. The payment is applied oldest first within the ticked ones only. Unticked transfers are not touched, whatever the amount.

**Why this priority**: This is rarely needed now that the amount drives the settlement, but it keeps today's control for statements that cover a specific set.

**Independent Test**: Tick two transfers, pay their total, and check that only those two closed.

**Acceptance Scenarios**:

1. **Given** six USD transfers, **When** the operator ticks the $21 and $21 transfers and pays $42, **Then** only those two close.
2. **Given** two ticked transfers totalling $42, **When** the operator pays $30, **Then** the older ticked transfer closes ($21) and the other is partly paid ($9). No unticked transfer is touched.
3. **Given** the "which OMT shares does this statement include" picker excludes a type, **When** the operator pays, **Then** transfers of that type are never closed or partly paid (unchanged rule).
4. **Given** the operator clears every tick, **When** they return to the default, **Then** the whole account is in scope again, oldest first.

---

### User Story 6 - Undo a settlement (Priority: P2)

A settlement made by mistake is voided from Transactions. Every transfer it closed or partly paid gets back exactly the amount this settlement applied to it. If a later settlement also paid any of the same transfers, the void is refused until that later settlement is voided first.

**Why this priority**: Partial payment adds "paid so far" to transfers. A void that misses this leaves the account wrong and invisible.

**Independent Test**: Settle $300, settle $100. Try to void the $300 settlement (refused), void the $100 one, then the $300 one. Check that every transfer and the account balance per currency are back to before.

**Acceptance Scenarios**:

1. **Given** a $300 settlement (2 closed, 1 partly paid by $47), **When** it is voided, **Then** all three owe their full amount again, the cash drawer gets $300 back, and the account owes $497 again.
2. **Given** settlements of $300 and then $100 that both paid the $101 transfer, **When** the operator voids the $300 one, **Then** it is refused with a message naming the $100 settlement to void first, and nothing changes. **When** the $100 one is voided and then the $300 one, **Then** the account owes $497 again and every transfer owes its full amount.
3. **Given** a settlement that recognised commission on the transfers it closed, **When** voided, **Then** that commission is reversed and none is booked for the partly paid transfer.
4. **Given** any settlement in either currency, **When** it is made and then voided, **Then** drawers, the OMT account balance, commission and profit all return to their previous values in each currency (net 0).

---

### Edge Cases

- **Commission without enough money**: $496.30 paid with no commission entered leaves the newest $21 transfer partly paid ($20.30) and $0.70 owed. Entering the $0.70 commission closes it, with no money moved.
- **Commission entered with no transfer closing**: refused with a plain message; commission is only recognised on a transfer this settlement closes (FR-012).

- **Paying more than owed in a currency**: the extra goes on the account as credit or is handed back as change, as today (LIRA-315). It never pays the other currency.
- **Waive**: a waived amount in a currency counts as covered for the oldest transfers in that currency, within today's limits ($5 / 450,000 LBP). A Waive cannot be combined with an extra payment in the same currency (unchanged).
- **A currency with nothing owed and nothing paid**: shown as settled or hidden, never as a line to fill.
- **Money entered in a currency where nothing is owed**: all of it is extra and goes on the account as credit. The sheet says so before confirming.
- **Transfer voided while partly paid**: the refund path gives back what was paid on it, and its "paid so far" no longer counts toward any balance.
- **Rounding**: USD coverage is kept to the cent, LBP to the unit. A remainder under $0.01 or 1 LBP counts as closed, so no transfer is left owing a fraction.
- **Same timestamp**: two transfers created in the same second are ordered by their creation order, so "oldest first" is the same every time.
- **Old-style transfers** (commission netted on the transfer itself): settled by amount like any other. They carry no commission to recognise at closing.
- **Statement-type picker** (only some OMT types covered): types outside the statement are never touched, even if the payment would reach them. Extra beyond the covered types goes on the account as credit.
- **Two operators settling at once**: the second settlement is computed on the state left by the first. It never closes or partly pays the same money twice.

## Requirements *(mandatory)*

### Functional Requirements

**Currency rule**

- **FR-001**: The system MUST apply money only to transactions in the same currency: USD money to USD amounts owed, LBP money to LBP amounts owed.
- **FR-002**: The system MUST accept a settlement that has money in only one currency, and MUST leave the other currency's transactions unchanged.
- **FR-003**: The Settle Account sheet MUST show what is owed per currency, as separate amounts. It MUST NOT show a figure converted from one currency into the other.

**Amount-first allocation**

- **FR-004**: The system MUST decide which transactions a settlement closes from the money entered, applying it oldest first across every supplier in the OMT account (counter, OMT App, iPick). The order MUST be the same every time for the same data.
- **FR-005**: Within one currency, before applying the money, the system MUST net amounts OMT owes the shop (receives, OMT App cash-outs, earlier extra payments or credits) against the oldest amounts the shop owes.
- **FR-006**: The system MUST allow a settlement that does not cover a transaction in full. The transaction keeps "paid so far" per currency, stays open showing what is still owed, and closes when later money covers the rest.
- **FR-007**: The sheet MUST show, before confirming and per currency: the transactions that will close, the transaction that will be partly paid with the amount applied and the amount still owed, the transactions left untouched, the total still owed after this settlement, and any extra that will go on the account.
- **FR-008**: The operator MUST be able to restrict a settlement to transactions they tick. The money is then applied oldest first within the ticked ones only. With nothing ticked, the whole account is in scope.
- **FR-009**: The OMT statement-type filter MUST still exclude transactions of types the statement does not cover from closing and from partial payment.
- **FR-010**: Money beyond what is owed in a currency MUST follow the existing rule: handed back as change, or booked on the account as a credit in that currency.
- **FR-011**: A Waive MUST reduce what is owed in its own currency only, within the existing limits. Supported by the server per currency; the Settle Account sheet keeps Waive off, as today.

**Commission and profit**

- **FR-012**: Commission entered at settlement, and the deferred commission of OMT App cash-outs, MUST be recognised only for transactions that this settlement fully closes. It MUST NOT be recognised for a transaction that is only partly paid.
- **FR-013**: A transaction partly paid by several settlements MUST have its commission recognised exactly once, by the settlement that closes it.
- **FR-013a**: A transaction closes when its full (gross) amount is covered. Commission entered at settlement counts toward coverage in its own currency, applied oldest first together with the money; it is not a payment and moves no drawer.
- **FR-013b**: One settlement MAY pay OMT in one currency and receive from OMT in the other. Each currency's direction comes from what is owed in it (shop owes OMT = pay; OMT owes the shop = receive), and the sheet shows the two side by side. It is recorded as one settlement entry carrying both currencies with their own directions; change may come back in either currency (LIRA-315).
- **FR-013c**: When a credit on one account line nets against a debt on another line, each line's balance MUST move by the netted amount (account total unchanged), so every line matches its own open transactions.

**One way to pay OMT**

- **FR-014**: For suppliers inside an OMT account, the Suppliers page MUST NOT offer the Pay / Receive tab or the Commission settlement tick list. Settle Account MUST be the way to pay or collect.
- **FR-015**: Suppliers outside any account MUST keep Pay / Receive and their settle list unchanged.
- **FR-016**: Payments recorded through Pay / Receive before this change MUST appear in Settle Account as credits in their own currency and be netted per FR-005. None may be lost or counted twice.
- **FR-017**: The Paid / Partial / Unpaid labels and the Outstanding total in the Transactions list for account suppliers MUST come from what settlements actually recorded, per currency.

**Undo and integrity**

- **FR-018**: Voiding a settlement MUST give back exactly what that settlement applied to each transaction. It MUST be refused while a later, still-active settlement applied money to any of the same transactions (newest first). It MUST reopen the transactions it closed, and MUST reverse the commission and profit it recognised.
- **FR-019**: A settlement and its void MUST net to zero on every ledger they touch (cash drawers, OMT account balance, commission, profit), separately in USD and in LBP.
- **FR-020**: The account balance shown on the Suppliers page MUST always equal the sum of what is still owed on open transactions plus open credits, per currency.
- **FR-021**: A settlement MUST be refused with a plain message if, when it is saved, the money it would apply no longer matches the transactions' state (another settlement changed them first). The operator then sees the updated amounts.
- **FR-022**: All of the above MUST behave identically in the desktop app and the web app.

### Key Entities

- **OMT account**: the OMT counter, OMT App and iPick treated as one counterparty, with one balance per currency.
- **Open transaction**: something owed between the shop and OMT in one currency (a transfer, a cash-out credit, a manual debt or credit, an earlier extra payment). It has an amount, a direction (shop owes OMT, or OMT owes the shop), a date, and now a "paid so far".
- **Settlement**: one payment event. It holds the money moved per currency, the transactions it closed, the amount it applied to a partly paid transaction, any extra booked on the account, any Waive, and the commission it recognised.
- **Coverage record**: how much a given settlement applied to a given transaction, per currency. This is what lets a void give back exactly its own share.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can settle only USD or only LBP when both are owed, without unticking any transaction, in a single confirmation.
- **SC-002**: Paying any amount between $0.01 and the amount owed in a currency is accepted on the first try. 0% of these settlements are refused for not matching whole transactions.
- **SC-003**: Paying exactly the figure on OMT's statement for a currency, with the statement's commission entered, leaves that currency at $0 / 0 LBP owed in the app.
- **SC-004**: For any sequence of settlements and voids, the OMT account balance per currency equals the sum still owed on open transactions plus open credits, to the cent and to the LBP unit.
- **SC-005**: A settlement followed by its void returns every drawer, the account balance, commission and profit to their previous values in both currencies, verified by an automated check.
- **SC-006**: Operators have exactly one place to pay OMT (down from three), and the paid / partial / unpaid labels agree with the account balance 100% of the time.

## Assumptions

- Scope is the OMT open-credit account (counter, OMT App, iPick). Other suppliers, including Whish App and product suppliers, keep their current settle flows. Extending amount-first settlement to them is a later ticket.
- "Oldest first" means by creation time, ties broken by creation order.
- Earlier Pay / Receive payments on OMT-account suppliers are treated as open credits, not re-allocated to old transfers retroactively. They net against the oldest debt at the next settlement (FR-016).
- Transfers already closed before this change stay closed. Their "paid so far" is their full amount.
- The existing tolerances stay: change rounding, and the Waive limits of $5 / 450,000 LBP.
- Exchange rates play no part in what closes. The rate on the sheet is used only for the change box, as today.
- Only admins settle the OMT account, as today.
