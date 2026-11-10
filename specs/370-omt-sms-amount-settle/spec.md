# Feature Specification: Settle OMT from the SMS amount

**Feature Branch**: `370-omt-sms-amount-settle` (work happens on `main`; ticket LIRA-370)

**Created**: 2026-11-03

**Status**: Draft

**Input**: Owner, 2026-11-02/03: "we got extra commission from OMT … the system says we owe $5000, the SMS says $4900 including commission on Western Union". Then: "what if OMT owes us money, and the SMS says including Western commission but not how much?" The owner wants every input on the Settle Account sheet, not on the Suppliers page panel.

## Clarifications

### Session 2026-11-03 (owner decisions)

- Q: How should extra commission be entered? → A: The cashier types the amount on OMT's SMS. The commission is worked out from it, in both directions (we owe OMT / OMT owes us). The settlement closes every picked day at once.
- Q: Should the SMS box start empty? → A: No. It starts at the figure LiraTek expects on OMT's statement, so the expected commission is never lost when nobody types anything.
- Q: What does an SMS that says "including Western shares" cover? → A: The whole balance, with only Western Union's commission taken off. This is the rule the "Check against OMT's statement" panel already uses. The settle sheet must stop leaving out the other transfers.
- Q: What if OMT asks for more than LiraTek shows (pay $790 on $776.50, or OMT pays $210 on $223.50)? → A: Warn ("check for a missing transfer or fee"), allow saving, keep the difference on OMT's account. It is never booked as negative commission.
- Q: What happens to the "Check against OMT's statement" panel on the Suppliers page? → A: It stays, read-only, with no SMS box. All typing happens on Settle Account.
- Q: The SMS includes only some types' shares (e.g. Western Union). The other transfers close at full price. Where do their shares go until OMT pays them? → A: Option A (artifact Numfw4aRtXBDg6BgHk1D2P, "open question"). They stay as "shares OMT still owes us", per transfer and type. Profit counts only when a later SMS includes that type.
- Q: Can one SMS include several types? → A: Yes. "Including Western and Intra shares" happens, so the cashier ticks every type the SMS names.

### Evidence (test shop, 2026-11-03, all runs voided afterwards)

- We owe OMT $776.50, SMS says pay $762.30. Typing commission 14.20 alone still paid $776.50. Commission 14.20 plus a payment of 762.30 was right (drawer −762.30, profit +14.20), but it left Oct 27 part-paid with a $14.20 OMT credit, and a second settlement was needed to close it.
- OMT owes us $223.50, SMS says OMT pays $249.70. Receive 223.50 plus commission 26.20 recorded $223.50 in the drawer while $249.70 really came in, and left a $26.20 "OMT credit" that cannot be collected. Typing 249.70 asked the cashier to return $26.20 as change. Sending that change to "Account" gave the right totals but left two open credits (+26.20 / −26.20) with misleading labels.
- Settling with an empty commission box booked $0 profit. The $6.20 LiraTek expected was lost for good.
- With "Western Union" ticked, the statement panel said OMT pays $225.50 (whole balance, only WU commission off). The settle sheet dropped the other OMT transfers and said $600.00.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - We owe OMT: pay the SMS amount, commission worked out (Priority: P1)

OMT texts the shop what to pay, with the commission already taken off. The cashier types that figure on Settle Account. The sheet shows the commission it implies, the drawer pays exactly the SMS amount, and every picked day closes in this one settlement.

**Why this priority**: The owner's first scenario. Today it needs two settlements and an exact hand calculation, and a slip pays OMT too much.

**Independent Test**: OMT account owes $776.50 on Oct 16 – Oct 27 (expected commission $4.20, expected statement $772.30). Open Settle Account, type 762.30 in the SMS box, pay cash, confirm. The drawer moves −$762.30, the settlement's profit is $14.20 ("$4.20 expected + $10.00 extra"), the OMT balance is $0, and Oct 16 and Oct 27 both show settled. No OMT credit is left open.

**Acceptance Scenarios**:

1. **Given** we owe OMT $776.50 with $4.20 expected commission, **When** the cashier opens Settle Account, **Then** the SMS box shows 772.30, the commission line shows $4.20, and the payment starts at $772.30.
2. **Given** the same account, **When** the cashier types 762.30 in the SMS box, **Then** the sheet shows "Commission $14.20 (expected $4.20, $10.00 extra)", the payment changes to $762.30, and every picked transfer shows "Closes".
3. **Given** step 2, **When** the cashier confirms, **Then** the drawer moves exactly $762.30, profit is $14.20, the balance is $0, every picked day is settled, and no OMT credit remains.
4. **Given** the cashier changes the payment lines to less than the SMS amount (e.g. $700 cash), **When** they confirm, **Then** what is not paid stays owed on the newest picked transfers, as part-payments do today. The commission is still $14.20: OMT already deducted it for every picked transfer, so each ticked transfer takes its part now, closed or not, and no later settlement counts it again.

---

### User Story 2 - OMT owes us: receive the SMS amount, commission worked out (Priority: P1)

When OMT owes the shop (receives were bigger than sends), the SMS says what OMT pays, with the shop's commission already added. The cashier types that figure. The drawer receives exactly that amount, the commission is worked out, and nothing is treated as change or left as a credit.

**Why this priority**: The owner's second scenario. Today there is no correct way to record it, and the drawer or the account ends up wrong.

**Independent Test**: OMT owes us $223.50 (expected commission $6.20, expected statement −$229.70 in OMT's sign). Type −249.70 in the SMS box (OMT pays us $249.70) and receive cash. Confirm. The drawer moves +$249.70, profit is $26.20 ("$6.20 expected + $20.00 extra"), the balance is $0, every picked day is settled, there is no "change to return" line, and no OMT credit or overpayment row remains.

**Acceptance Scenarios**:

1. **Given** OMT owes us $223.50 with $6.20 expected commission, **When** the cashier opens Settle Account, **Then** the sheet says "OMT pays you", and the SMS box and the receive amount start at $229.70.
2. **Given** step 1, **When** the cashier types the SMS figure for OMT paying $249.70, **Then** the sheet shows "Commission $26.20 (expected $6.20, $20.00 extra)" and the receive amount becomes $249.70, with no change line.
3. **Given** step 2, **When** confirmed, **Then** the drawer moves +$249.70, profit is $26.20, the balance is $0, and no open account row is left by this settlement.

---

### User Story 3 - Nothing typed still books the expected commission (Priority: P1)

If the cashier settles without touching the SMS box, the settlement uses the expected statement figure, so the commission LiraTek expected is booked as profit instead of being lost.

**Why this priority**: Today an untouched commission box books $0 profit and loses the expected commission for good.

**Independent Test**: Same account as story 1. Open Settle Account and confirm without typing. The drawer moves −$772.30, profit is $4.20, the balance is $0, and every picked day is settled.

**Acceptance Scenarios**:

1. **Given** any OMT settlement, **When** the cashier confirms without editing the SMS box, **Then** the commission booked equals the expected commission of the picked transfers, and the money moved equals the expected statement figure.

---

### User Story 4 - "Including <type> shares" means the whole balance (Priority: P2)

When the cashier ticks the OMT share types the SMS mentions (e.g. Western Union only), the settle sheet keeps every picked transfer and takes off only those types' expected commission. This matches the statement panel.

**Why this priority**: The two screens disagree today ($225.50 vs $600.00 on the test shop), so one of them gives the wrong number.

**Independent Test**: OMT owes us $223.50 with commission Intra $0.20, Western Union $2.00, Cash to Business $1.00, Online Brokerage $3.00. Tick Western Union only. The sheet still lists all 7 picked transfers. The SMS box starts at −$225.50, the same as the statement panel with Western Union ticked. Confirm. Drawer +$225.50, profit +$2.00, OMT balance $0, every picked day settled, and "Shares OMT still owes us: $4.20" (Intra $0.20, Cash to Business $1.00, Online Brokerage $3.00).

**Acceptance Scenarios**:

1. **Given** one or more types ticked (e.g. Western Union and Intra), **When** the sheet is open, **Then** every open transfer on the picked days stays in the settlement and closes, and the expected commission counts only the ticked types.
2. **Given** a ticked-types settlement confirmed at the expected figure, **Then** the profit equals the ticked types' commission. Each closed transfer of an unticked type keeps its share as "owed by OMT", with no profit yet.
3. **Given** $4.20 of shares still owed (Intra $0.20, Cash to Business $1.00, Online Brokerage $3.00), **When** a later SMS says "including Intra and Cash to Business shares", **Then** the expected figure includes those $1.20 of owed shares on top of the picked transfers' ticked commission. Confirming at that figure books the $1.20 as profit then and clears those shares. The $3.00 Brokerage share stays owed.
4. **Given** shares still owed and no open transfers, **When** OMT sends an SMS that pays only those shares, **Then** the cashier can settle them alone: the SMS box starts at the owed shares of the ticked types, and the drawer and profit move by that amount.

---

### User Story 4b - See the shares OMT still owes (Priority: P3)

The Settle Account sheet and the statement panel both show "Shares OMT still owes us", with the total and a breakdown per type.

**Why this priority**: Without it the owed shares are invisible until a later SMS.

**Independent Test**: After story 4's settlement, open the OMT card on the Suppliers page and the Settle Account sheet. Both show "Shares OMT still owes us: $4.20", broken down by type.

**Acceptance Scenarios**:

1. **Given** owed shares exist, **Then** both screens show the total and the per-type amounts, per currency.

---

### User Story 5 - OMT asks for more than LiraTek shows (Priority: P2)

Sometimes the SMS is worse for the shop than LiraTek's own figure: OMT asks us to pay more, or pays us less. That difference is not commission. The sheet warns, still lets the cashier save, and keeps the difference on OMT's account so it can be found later.

**Why this priority**: Without a rule, the formula would book negative commission and hide a missing transfer or fee.

**Independent Test**: We owe OMT $776.50 (all types ticked, expected $772.30). Type 790.00. The sheet warns "OMT asks $13.50 more than LiraTek shows. Check for a missing transfer or fee." Commission shows $0.00. Confirm. The drawer moves −$790.00, profit is $0, every picked day is settled, and a $13.50 OMT credit stays open on the account.

**Acceptance Scenarios**:

1. **Given** an SMS figure worse for the shop than LiraTek's gross figure, **Then** the commission is $0, the sheet shows the warning with the exact difference, and saving is allowed.
2. **Given** an SMS figure between the gross figure and the expected statement figure (e.g. 774.50 on 776.50 with $4.20 expected), **Then** this is not a warning. The commission is the smaller amount ($2.00), and the sheet shows "less than expected ($4.20)".
3. **Given** OMT owes us $223.50 and the SMS says OMT pays $210.00, **Then** the same warning shows (OMT pays $13.50 less than LiraTek shows), the commission is $0, and $13.50 stays as an amount OMT still owes on the account.

---

### User Story 6 - Statement panel becomes read-only (Priority: P3)

The "Check against OMT's statement" panel on the Suppliers page keeps showing owed − expected commission = expected statement (with its type picker and "up to" day), but no longer has SMS boxes. The cashier types the SMS figure only on Settle Account.

**Why this priority**: The owner does not want to type the same figure in two places.

**Independent Test**: Open the OMT account on the Suppliers page. The panel shows the gross owed, the unsettled commission and the expected figure. There are no "OMT SMS says" inputs and no "Off by" line.

**Acceptance Scenarios**:

1. **Given** the Suppliers page OMT card, **Then** the statement panel shows its three figures per currency and has no input boxes.

---

### Edge Cases

- **Both currencies**: each currency has its own SMS box, prefill, commission and warning, worked out separately. A currency with nothing picked shows no box.
- **Picked days don't match the SMS**: the expected figure is always for the picked days, so the cashier can compare before typing. Any difference is allowed. The "extra" amount is always shown next to the SMS box, so a large one can't go unnoticed.
- **Today's transfers**: the default pick stays as it is (days before today), matching OMT's SMS, which covers up to the end of yesterday.
- **Old-style transfers** (booked net of commission before the commission-at-settlement change): none are open on cornertech (69 open, all new-style) or the test shop (measured 2026-11-03). LIRA-378: the ticked types scope commission only, and an old-style transfer carries none, so it is never held back by the choice (the earlier server refusal asking to tick "All types" is removed; the sheet never implemented it).
- **Commission received in parts**: each transfer's expected commission is its estimate minus what earlier settlements already booked for it. A transfer part-paid by one settlement and closed by another is never counted twice, and neither is an owed share.
- **Remembered ticked types**: nothing is remembered between openings, and the choice is shown prominently next to the SMS box. A stale "Western Union only" choice must never quietly create owed shares. **LIRA-378 (owner 2026-11-09) supersedes the "opens on All types" default:** the sheet opens with NOTHING ticked, which means OMT pays no commission in this SMS (every transfer's expected commission stays owed by OMT); "All types" is one tick. An SMS figure that still implies commission with nothing ticked blocks Settle (and the server refuses it) until the cashier ticks the types the SMS includes. Why: Cornertech saved the untouched "All types" prefill twice (4 Nov, 9 Nov) and the sheet deducted commission OMT had not paid.
- **Existing open OMT credits** on the account: they still net first, as today, and the expected figure includes them.
- **Undo / void of a settlement**: reverses the money, the commission profit and every closed transfer, as today. Nothing created by this change stays behind.
- **Typed figure equal to the gross figure**: commission $0, no warning.
- **Split payments and other payment methods** (OMT Wallet, Whish, Binance): still allowed. The total of the payment lines starts at the SMS amount.
- **Suppliers other than the OMT account** (Whish, Katsh, product suppliers): unchanged. They keep their current settle sheet.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The OMT account's Settle Account sheet MUST show one "OMT SMS amount" box per currency that has picked transfers. It uses OMT's sign (minus = OMT pays us).
- **FR-002**: The SMS box MUST start at the expected statement figure for the picked days and ticked share types: the owed figure minus the expected commission, as the statement panel computes it.
- **FR-003**: The commission MUST be worked out as: owed figure − SMS figure (in OMT's sign), floored at $0. Equivalently: expected commission + (expected figure − SMS figure). The expected commission counts the outstanding estimates (estimate minus anything already booked or left owed) of the ticked-type transfers in the settlement, closed by it or not, plus owed shares of ticked types. The sheet MUST show the total, the expected part and the extra part.
- **FR-004**: The money moved (payment lines) MUST start at the SMS amount, in the right direction (we pay / OMT pays us). The cashier may change methods or split as today.
- **FR-005**: The worked-out commission MUST count toward closing the picked transfers, so that SMS amount + commission closes every picked day in one settlement. No commission credit, change line or overpayment row is created for the commission.
- **FR-006**: The commission MUST be booked as the settlement's profit, spread over the commission-carrying transfers it closes, as today.
- **FR-007**: When the SMS figure is worse for the shop than the owed figure, the sheet MUST warn with the exact difference ("check for a missing transfer or fee"), book $0 commission, allow saving, and keep the difference open on OMT's account. The ticked types' expected commission is not dropped: it stays as owed shares (FR-009a), with no profit yet (owner 2026-11-03).
- **FR-008**: When the commission is lower than expected, the sheet MUST show "less than expected" with the expected amount. Saving is allowed.
- **FR-009**: Ticking share types on the settle sheet (one or several) MUST change only which types' commission counts as expected. It MUST NOT remove transfers of unticked types from the settlement.
- **FR-009a**: Each closed commission-carrying transfer of an unticked type MUST keep its share as "owed by OMT", without profit. A later settlement whose ticked types include that type MUST count those owed shares in its expected figure. If confirmed, it books them as profit and clears them. A settlement of owed shares alone (no open transfers) MUST be possible.
- **FR-009b**: The settle sheet and the statement panel MUST show the owed shares, per currency, by type. The statement panel's expected figure MUST include owed shares of the ticked types.
- **FR-009c**: Undoing the settlement that created owed shares removes them. Undoing a settlement that cleared owed shares makes them owed again and removes their profit. Undoing the creating settlement while a later settlement has cleared some of its shares MUST be allowed. What the later settlement received for those shares stays as an open amount on OMT's account (OMT paid us ahead), netted at the next settlement. This is the same relief pattern undo already uses when a later settlement used a credit (LIRA-343 R12; owner 2026-11-03).
- **FR-010**: A settlement made from the SMS box MUST reverse fully on undo or void: drawer, profit, transfer coverage and any open difference row. Create + reverse nets to 0 on every ledger, per currency.
- **FR-011**: The "Check against OMT's statement" panel on the Suppliers page MUST be read-only: no SMS inputs, no "Off by" line.
- **FR-012**: The settlement's record (summary and details) MUST show the SMS figure typed, the expected commission, the extra commission, and any difference warning, so the entry explains itself later.
- **FR-013**: All of the above MUST work the same in the desktop app and the web app.
- **FR-014**: The server MUST check the figures itself (commission ≥ 0, money + commission matches the picked transfers' owed figure, or else a difference row), and refuse a payload whose figures disagree with the current account, as it does today for a stale balance.

### Key Entities

- **OMT settlement**: one settle action on the OMT account. Picked transfers, ticked share types, SMS figure per currency, money moved, commission (expected + extra), any difference kept open.
- **Expected statement figure**: per currency, what OMT's SMS should say for the picked days: owed minus the expected commission of the ticked types. Same rule as the statement panel.
- **Difference row**: an open amount on the OMT account, created only when OMT asks for more (or pays less) than LiraTek shows.
- **Owed share**: the commission of one closed OMT transfer whose type the settling SMS did not include. It records the transfer, the type, the currency, the amount, the settlement that left it owed, and the later settlement that cleared it, if any. It is not part of the OMT balance and is not profit until cleared.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In both directions, one settlement records an OMT SMS with extra commission: the drawer equals the SMS amount, profit equals the worked-out commission, and the OMT balance is $0 with every picked day settled.
- **SC-002**: A settlement saved without typing anything books 100% of the expected commission (never $0).
- **SC-003**: For the same ticked types and picked days, the settle sheet's expected figure equals the statement panel's figure to the cent.
- **SC-004**: No settlement made through the SMS box leaves an open commission credit, change line or overpayment row, except the deliberate difference row in story 5.
- **SC-005**: Undoing any such settlement returns the OMT balance, the drawers and Profits to exactly their state before it.

## Assumptions

- Only the OMT account (OMT counter + iPick + OMT App) gets the SMS box. Other calendar suppliers keep the plain commission box (Whish) or none.
- The separate "Settlement commission" input is replaced on the OMT account sheet by the worked-out commission line. Cashiers no longer type the commission directly there.
- Settling only part of an SMS (paying less than it says) stays possible through the payment lines. What is not paid stays owed, as today.
- Owed shares need a new stored record, so one database migration is expected (plan confirms). Commission-as-coverage itself reuses the existing settlement coverage records.
- The statement panel's "up to" day and share-type choice stay as they are (remembered per device), and the settle sheet keeps sharing the type choice.
- Owner decision of 2026-10-15 ("the commission never changes what the money covers") is reversed for the OMT account by this ticket.
