# Feature Specification: OMT settlement by day

**Feature Branch**: `343-omt-settle-by-day` (work happens on `main`; ticket LIRA-343)

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description (owner, 2026-10-26, paraphrased): "When settling with the OMT supplier I need a new layer. When the user clicks Settle Account, he should first select the days he is settling from a calendar, and see the days he already settled. Sometimes a day is partially settled and an amount is kept for later. In most cases the user wants to settle the last unsettled days."

**Builds on**: LIRA-322 amount-first settlement (`specs/322-omt-amount-first-settle/spec.md`): one OMT account for the OMT counter, OMT App and iPick; $ settles $ only and LBP settles LBP only; oldest first; part-paid transfers with a stored "paid so far"; credits net first; commission counted only when a transfer fully closes; overpay becomes credit on the account.

**Design mock**: https://claude.ai/artifact/VWkboFyYcNH7ZcFzSLxdf4 (example figures only).

## Clarifications

### Session 2026-10-26 (owner decisions while designing the mock)

- Q: What is the calendar's scope? → A: One calendar for the whole OMT account. A day counts if it has at least one OMT counter, OMT App or iPick transaction, whatever the weekday. Only a day with no transaction of any type is greyed out.
- Q: Can the user settle a newer day while an older day is still open? → A: Yes, with a visible warning. The older day stays open. Amounts OMT owes the shop on days that are not selected are not used.
- Q: The user pays more than the selected days owe? → A: The selected days close and the extra becomes credit on the OMT account, used first by the next settlement. It does not roll into later days.
- Q: Can today be selected? → A: Yes, but never by default. Transfers made later today make it partly open again.
- Q: Which days are selected when the sheet opens? → A: Every unsettled or partly settled day before today, across months.
- Q: The user pays less than the selected days owe? → A: Oldest first within the selected days. The last transfer reached is part-paid and its day shows as partly paid.
- Q: A day with one currency settled and the other open? → A: One state per day (partly paid). The day shows what is left per currency.
- Q: How does a day look? → A: Every day is a circle. Settled: a soft filled green circle with a tick. A one-currency open day: a ring that is green for the paid share and red for the share still owed. A two-currency open day: the ring shows only the day's state (red = nothing paid, amber = something paid) with a "$" badge and an "L" badge on its bottom corners, each coloured by its own currency's state (red owed, amber part paid, green paid). Under an open circle, one line per open currency, LBP always labelled ("$200", "990k LBP"). Two concentric rings and a split ring were rejected.
- Q: Calendar layout details? → A: Month switcher with arrows on the calendar's own corners; legend (Settled · Partly paid · Unpaid · $ L badges) directly under the calendar; then "<$ amount> + <LBP amount> left this month"; then a selection bar (count, first → last day, total per currency, Clear). All week rows have the same height. Selected days sit on a neutral band with a white tick badge; an older open day left out gets an amber "!" badge.
- Q: Older months with something still unselected? → A: An amber link "N unselected day(s) in <Month> ›" appears near the selection bar while viewing a later month, and disappears once those days are selected or settled. Tapping it opens that month.
- Q: Is "left this month" stored? → A: No. It is worked out each time from what is still owed on the shown month's days.

### Session 2026-10-26 (owner interview)

- Q: A transfer is back-dated onto a day already settled? → A: The day reopens as partly paid. The new transfer is shown open, tagged "added after settlement".
- ~~Q: Undoing settlements? → A: In any order. Only the undone settlement's days go back to how they were before it. The undo is refused only when a later, still-active settlement shares a transfer with it. (This is LIRA-322 FR-018 unchanged: that rule already refuses only on shared transfers.)~~ *(superseded later the same day, see below)*
- Q: Transfers settled before LIRA-322 (no stored "paid so far") show as open? → A: A one-time "settled up to <date>" setting marks every day on or before that date as settled. No money moves.
- Q: Amounts OMT owes the shop on selected days (receives, OMT App cash-outs)? → A: They net inside the selected days, per currency, before the payment.
- ~~Q: Voiding or refunding a transfer that a settlement already covered? → A: Stays refused (as today), with a clearer message that names the settlement and its day and says to undo that settlement first.~~ *(superseded later the same day, see below)*
- Q: What should "settled up to <date>" do with old payments saved only as credit? → A: Option B, "close them for real". The old credits pay the old open transactions on or before the date, oldest first, with no new money, recorded like a settlement. Option A (only paint days green) was rejected because it can hide money still owed.
- Q: Where do "OMT owes the shop" amounts live? → A: Two kinds. **Day credits** are real transactions on a day (a counter receive, an OMT App cash-out); they are used only when their day is picked. **Account credits** are money left on the account (extra paid in an earlier settlement, the commission credit booked with each settlement, old Pay / Receive payments); they never sit on a day, never colour a day, and show as one "OMT credit" line on the sheet.
- ~~Q: How much account credit does a settlement use? → A: The amount paid decides; there is no switch. When the shop pays OMT, the credit covers any shortfall before a transfer is left part-paid (picked days owe $375, credit $8.70: paying $366.30 uses all of it, $370 uses $5 and leaves $3.70, $375 uses none, $380 uses none and adds $5 extra, $300 uses all of it and leaves 25 Oct part-paid with $66.30). When OMT pays the shop, its money first settles the picked days, then the old credit (picked days owe the shop $100, credit $8.70: OMT paying $108.70 uses all of it, $104 uses $4, $100 uses none). The payment box is pre-filled with all the credit used. Per currency, as always. (Owner confirmed both tables 2026-10-26.)~~ *(superseded later the same day, see below)*
- Q: Can the user see the transactions of a day outside the settle sheet? → A: Yes (owner 2026-10-26). The supplier Transactions window gets a from–to date filter (same day twice = one day; quick presets Today, Yesterday, This month), applied by the server on the shop's own day so old days are never cut off by the 200-row limit. A calendar day's details offer "See in Transactions ›", which opens the window filtered to that day. Part of LIRA-343, with day details.
- Q: Undo a settlement whose credit a later settlement already used? → A: Owner 2026-10-26 (changed from "refuse"): any settlement can be undone, with no exceptions. The later settlement and its days stay as they are; the part of the undone settlement's credit that later settlements already used shows on the account as "you owe OMT $X" (an account row, on no day). Example: #A left $8.70 credit, #B used it; undoing #A reopens #A's days, #B and 23–25 Oct stay settled, and the account shows "you owe OMT $8.70".
- Q: How is the day of an undo or void marked? → A: A small indigo ↺ badge on the top-left of the day the undo / void was done (owner 2026-10-26, option 1). Hovering (or tapping on a phone) shows what moved to the account, per currency: e.g. "Owed to OMT added: $8.70 (undo of #A)" or "OMT credit added: $35.00 (void of #440)". The badge never changes the day's colour, and goes away once a settlement uses that account amount. The account line names its origin with a link to that day.
- Q: Voiding or refunding a transfer that a settlement already paid? → A: Allowed (same principle, replaces the earlier "stays refused"). The settlement stays as it is; what it paid for that transfer becomes OMT credit on the account.
- Q: Who decides how much OMT credit a settlement uses? → A: The user (owner 2026-10-26, replaces "the amount paid decides"). The sheet shows "Use OMT credit [amount] of [total]", pre-filled with what is needed and never more than what the picked days owe. The user can lower it (0 when OMT rejects the credit). The payment box follows the credit set; a payment typed afterwards does not change the credit: less leaves a transfer part-paid, more becomes extra. A "Remove credit" action for credits OMT never accepts (booked as an expense, no drawer, undoable) is a separate follow-up ticket.
- Q: Keep October's "Pick transfers" (tick single transfers)? → A: Yes, inside a day's details. Tapping a picked day lets the user untick single transfers of that day; the day then shows as partly picked.
- Q: Should days be tracked? → A: No per-day record is kept, neither for open nor for closed days. Day states are worked out when the calendar is shown: days with open transactions are red or amber, days with transactions but none open are green. Only what each settlement paid per transaction is stored (it already is, since LIRA-322). (Owner: "we don't need to track the closed days".)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which days are settled (Priority: P1)

The operator opens Settle Account for the OMT account and sees the current month as a calendar. Each day shows whether it is settled, partly paid, unpaid, or had no OMT-account transactions, and how much is left on each open day per currency. A line under the calendar shows what is left for the whole month.

**Why this priority**: The owner's first need is to see at a glance what is settled and what is not. Every other story uses this view.

**Independent Test**: Seed an OMT account with transfers across a month, some fully settled, one part-paid, one with $ paid and LBP open, some unpaid, and one empty day. Open Settle Account and check each day's state, amounts and the month line.

**Acceptance Scenarios**:

1. **Given** 22 Oct has a $310 transfer fully paid and a 900,000 LBP transfer unpaid, **When** the calendar opens on October, **Then** 22 Oct shows an amber ring, a green "$" badge, a red "L" badge and "900k LBP" under it.
2. **Given** 21 Oct has $47 still owed of $277, **When** the calendar opens, **Then** 21 Oct shows a ring about 83% green and "$47" under it.
3. **Given** 14 Oct has no OMT counter, OMT App or iPick transaction, **When** the calendar opens, **Then** 14 Oct is greyed out and cannot be selected.
4. **Given** 25 Oct is a Sunday with a $200 iPick transfer and a 990,000 LBP bill payment, both unpaid, **When** the calendar opens, **Then** 25 Oct shows a red ring, red "$" and "L" badges, and "$200" and "990k LBP" on two lines.
5. **Given** the open days of October owe $482 and 1,890,000 LBP in total, **When** the calendar shows October, **Then** the line under the calendar reads "$482.00 + 1,890,000 LBP left this month".

---

### User Story 2 - Pick days and settle them (Priority: P1)

The operator settles the days they choose. The sheet opens with every open day before today already selected, and the payment box pre-filled with exactly what those days owe per currency. The operator can tap days to add or remove them, change the amounts, and confirm.

**Why this priority**: This is the feature. Most of the time the operator only checks the pre-filled amount and confirms.

**Independent Test**: With open days 21–25 Oct, open the sheet, confirm without changes, and check that exactly those days become settled and the payment matches their total per currency.

**Acceptance Scenarios**:

1. **Given** open days 30 Sep and 21–25 Oct and today is 26 Oct, **When** the sheet opens, **Then** 30 Sep and 21–25 Oct are selected, 26 Oct is not, and the payment box shows their total per currency.
2. **Given** 23, 24 and 25 Oct are selected and owe $120, $55 and $200 in $, **When** the operator pays $250 in $ and confirms, **Then** 23 and 24 Oct close, 25 Oct's $ transfer is part-paid with $125 left, and 25 Oct shows as partly paid.
3. **Given** the selected days owe $222, **When** the operator pays $230, **Then** the selected days close and $8 becomes credit on the OMT account, shown before confirming.
4. **Given** 24 Oct has an iPick transfer of $95 and a receive of $40 and is selected, **When** the payment is worked out, **Then** the $ owed for 24 Oct is $55.
5. **Given** a day with a receive is not selected, **When** the operator settles other days, **Then** that receive is not used.
6. **Given** the operator taps today, **When** they settle, **Then** today's transfers are included, and a transfer made later today leaves today partly open.
7. **Given** the operator pays $ only, **When** they confirm, **Then** LBP amounts on the selected days stay open.

---

### User Story 3 - Leave an older day open on purpose (Priority: P2)

The operator may skip an older open day (for example, a disputed transfer) and settle newer days. The calendar marks the skipped day, and the selection bar says how many older open days are left out.

**Why this priority**: Owner decision; needed for disputes. Less common than the default flow.

**Independent Test**: With open days 21–25 Oct, unselect 21 Oct, settle, and check that 21 Oct stays open and was flagged before confirming.

**Acceptance Scenarios**:

1. **Given** 21–25 Oct are selected, **When** the operator unselects 21 Oct, **Then** 21 Oct shows an amber "!" badge and the selection bar shows "1 left out".
2. **Given** 30 Sep is open and unselected while October is shown, **When** the operator looks under the calendar, **Then** a link reads "1 unselected day in September ›", and tapping it shows September.
3. **Given** that link is visible, **When** the operator selects 30 Sep, **Then** the link disappears.

---

### User Story 4 - See what is behind a day (Priority: P2)

Tapping any day with transactions shows its transfers: which part of the OMT account each belongs to (OMT, OMT App, iPick), its amount, how much of it is paid, and which settlement(s) paid it.

**Why this priority**: Needed to trust a partly paid day and to find which settlement to undo.

**Independent Test**: Tap a day closed by two settlements and check both are listed against the right transfers.

**Acceptance Scenarios**:

1. **Given** 21 Oct's $97 OMT App cash-out has $50 paid by settlement #10057, **When** the operator taps 21 Oct, **Then** it shows "$50 paid by #10057 · $47 left" with an "OMT App" tag.
2. **Given** a day was closed by two settlements, **When** the operator taps it, **Then** both settlements are listed.

---

### User Story 5 - Undo a settlement (Priority: P2)

The operator can undo any settlement, in any order, with no exception.

**Why this priority**: Owner decision. Mistakes happen; undo must stay safe for money.

**Independent Test**: Settle 21 Oct (#A), then 22–25 Oct (#B) with no shared transfer; undo #A and check only 21 Oct reopens.

**Acceptance Scenarios**:

1. **Given** #A covered only 21 Oct and #B covered only 22–25 Oct, **When** the operator undoes #A, **Then** 21 Oct goes back to its earlier state and 22–25 Oct stay settled.
2. **Given** #A left $8.70 credit and #B used it, **When** the operator undoes #A, **Then** #A's days reopen, #B and its days stay settled, and the account shows "you owe OMT $8.70".
3. **Given** any settlement and its undo, **Then** every ledger they touched nets to zero, per currency, except one balancing account row equal to what later settlements had already used (FR-018); the account balance always equals open amounts owed plus open credits.

---

### User Story 6 - Correct the calendar after the fact (Priority: P3)

Later changes keep the calendar honest: a back-dated transfer reopens its day; voiding a paid transfer turns what was paid for it into OMT credit.

**Why this priority**: Rare, but a wrong "settled" day would hide money owed.

**Independent Test**: Settle 18 Oct, then add a transfer dated 18 Oct; check 18 Oct reopens. Try to void a covered transfer; check the message.

**Acceptance Scenarios**:

1. **Given** 18 Oct is settled, **When** a $35 transfer dated 18 Oct is recorded, **Then** 18 Oct shows as partly paid and the transfer is tagged "added after settlement".
2. **Given** transfer #440 ($35) was paid in settlement #10061 on 18 Oct, **When** the operator voids it, **Then** the void goes through, settlement #10061 is unchanged, 18 Oct stays settled, and the account shows $35 of OMT credit.

---

### User Story 7 - Mark old history as settled (Priority: P3)

Days from before LIRA-322 have no stored "paid so far" and would show as open. The owner sets once "everything on or before <date> was settled with OMT", and those days show as settled.

**Why this priority**: One-time clean-up; without it old months look unpaid and invite paying twice.

**Independent Test**: Set the date to 30 Sep; check August and September show settled and October is unchanged.

**Acceptance Scenarios**:

1. **Given** the "settled up to" date is 30 Sep, **When** the calendar shows September, **Then** every day with transactions is settled and no older-month link appears.
2. **Given** that date, **Then** no drawer, ledger or balance changes.

---

### Edge Cases

- Month boundaries: the default selection spans months (30 Sep → 25 Oct). The selection bar shows the first and last day across months.
- A day whose only transactions are receives (OMT owes the shop): it can be selected; its amount nets inside the selection.
- All selected days net to zero in a currency: no payment line is needed for that currency.
- A transfer at 1:00 at night belongs to the shop's own day, on desktop and web alike.
- A transfer recorded while the sheet is open: it is not in the list the sheet sends, so it is neither settled nor refused; it stays open and shows on the calendar after the reload.
- Another settlement changes the selected days while the sheet is open: confirming is refused with a plain message (LIRA-322 FR-021), and the calendar refreshes.
- Future days and days with no transactions cannot be selected.
- A transfer type outside the OMT statement filter (LIRA-322 FR-009) does not make a day open.
- Nothing selected: the payment box is empty and Confirm is off.
- Commission is still counted only by the settlement that fully closes a transfer; a part-paid day earns no commission yet.

## Requirements *(mandatory)*

### Calendar

- **FR-001**: Settle Account for an OMT account MUST open on a month calendar covering the OMT counter, OMT App and iPick together, with previous / next month controls.
- **FR-002**: Each day MUST have exactly one state: settled (every transaction fully covered), partly paid (something covered, something still owed, in any currency), unpaid (nothing covered), or no transactions. A day with at least one transaction of any OMT-account type MUST be selectable unless it is in the future.
- **FR-003**: Each open day MUST show what is left per currency, one line per currency, with LBP labelled. Settled days show no amount.
- **FR-004**: A one-currency open day MUST show how much of it is paid as a proportion. A two-currency open day MUST show each currency's own state (owed, part paid, paid) separately from the day's overall state.
- **FR-005**: The calendar MUST show, under its days, the total still owed for the shown month per currency, worked out each time from current data (never stored).
- **FR-006**: When an earlier month has open days that are not selected, the sheet MUST say how many and in which month, and offer to open that month. The notice MUST disappear once those days are selected or settled.
- **FR-007**: Day boundaries MUST follow the shop's own calendar day and be identical in the desktop app and the web app. Known limit, as in every web report today: on web the browser's current time-zone offset is used, so a transaction from the other side of a daylight-saving change can land one hour off between 00:00 and 01:00.

### Selection and payment

- **FR-008**: On opening, every unsettled or partly paid day before today MUST be selected, across months. Today MUST NOT be selected by default but MUST be selectable.
- **FR-009**: The operator MUST be able to select and unselect any selectable day. The sheet MUST show the number of selected days, the first and last selected day, and the total they owe per currency.
- **FR-010**: The payment box MUST be pre-filled per currency as defined in FR-012b (what the selected days owe minus the credit set) and update when the selection or the credit set changes.
- **FR-011**: The settlement MUST apply only to transactions on the selected days: amounts OMT owes the shop on those days net first, per currency; then money applies oldest first; the last transfer reached may be part-paid. All LIRA-322 rules (per currency, partial coverage, commission on full closure only, statement-type filter) MUST still hold.
- **FR-012**: The sheet MUST show the account credit per currency as an amount the user sets ("Use OMT credit [x] of [total]"), pre-filled with min(what the selected days owe, total credit), editable from 0 up to that limit. The settlement MUST use exactly that amount of account credit (oldest credit first), never more. Money then covers the selected days oldest first; money short leaves a transfer part-paid; money beyond becomes extra credit (or change, as today). Nothing is applied to unselected days.
- **FR-012a**: When OMT pays the shop, its money MUST first settle the selected days' amounts in that currency, then up to the account credit amount the user set (oldest first); anything beyond follows the existing extra rule.
- **FR-012b**: Account credits (extra from earlier settlements, settlement commission credits, Pay / Receive payments recorded before LIRA-322) MUST NOT belong to any day: they never change a day's state and are shown on the sheet as one "OMT credit" amount per currency. The payment box MUST be pre-filled as what the selected days owe minus the credit amount set, per currency, and MUST follow changes to the credit amount.
- **FR-013**: Day credits (transactions where OMT owes the shop, such as a receive or an OMT App cash-out) on unselected days MUST NOT be used.
- **FR-014**: When an older open day is left out while a newer day is selected, the calendar MUST mark it and the selection summary MUST show how many are left out, before confirming.
- **FR-015**: The sheet MUST show, before confirming, any amount that will stay open and which transfer will be part-paid, or any extra that will become credit.

### Day details

- **FR-016**: Selecting a day MUST be able to show its transactions with their account part (OMT, OMT App, iPick), amount, amount paid, amount left, and the settlement(s) that paid them.
- **FR-016a**: In a picked day's details, the user MUST be able to untick and re-tick single open transactions. Unticked transactions are left out of the settlement like an unpicked day (no netting, no coverage). The day MUST show that it is only partly picked, and the selection totals and payment pre-fill MUST follow.
- **FR-016c**: The supplier Transactions window MUST offer a from–to date filter (presets Today, Yesterday, This month) applied on the server by the shop's own day, so any day can be shown regardless of how many rows exist. A calendar day's details MUST offer "See in Transactions ›" opening the window filtered to that day.
- **FR-016b**: The day an undo or void moved an amount to the account MUST show a ↺ badge (top-left) while that account amount is open. Hover / tap MUST show the amount per currency and its origin ("Owed to OMT added: $8.70 (undo of #A)", "OMT credit added: $35.00 (void of #440)"). The badge MUST NOT change the day's state or colour. The account line MUST name the origin and link to that day.

### Changes after settlement

- **FR-017**: A transaction recorded later with a date on a settled day MUST reopen that day as partly paid and MUST be marked as added after settlement.
- **FR-018**: Any settlement MUST be undoable, in any order, with no exception. Undoing restores the days it covered. Later settlements and their days MUST NOT change. Any amount of the undone settlement that later settlements already relied on (its credit they used, or transfers they also covered) MUST appear as an account row "you owe OMT $X" (or "OMT owes you $X"), on no day. (Replaces LIRA-322 FR-018 for OMT accounts.)
- **FR-019**: Voiding or refunding a transaction that a settlement covered MUST be allowed. The settlement stays unchanged; the amount it applied to that transaction MUST become OMT credit on the account (an account row, on no day).
- **FR-020**: A settlement and its undo MUST net to zero on every ledger they touch (drawers, OMT account balance, commission, profit), separately in $ and LBP, except the one balancing account row of FR-018 when later settlements had used part of it. After any create, undo or void, the OMT account balance MUST equal the open amounts owed plus the open credits, per currency.

### History

- **FR-021**: An authorised user MUST be able to run, for the OMT account, a one-time "settled up to <date>" step. It MUST use the account credits (whatever their date) to pay the open transactions dated on or before that date, oldest first and per currency, with no new money. It is recorded like a settlement: it can be viewed and undone under FR-018, and it nets to zero with its undo (FR-020). A day turns green only when its transactions are really covered. Anything the old credits do not cover stays open and visible (for example, 30 Sep stays partly paid with $20 left when only $280 of $300 was paid).
- **FR-021a**: The step MUST NOT change the OMT account balance. Credits and amounts owed are matched against each other; no drawer moves.

### Both apps

- **FR-022**: All of the above MUST behave identically in the desktop app and the web app.

### Key Entities

- **Settlement day**: a calendar day of the OMT account. It is never stored. Its state and amounts left per currency are worked out from the open transactions dated that day and from whether the day has any transactions at all.
- **Day selection**: the set of days chosen for one settlement. It limits which transactions that settlement may net, cover or part-pay.
- **"Settled up to" step**: a one-time, settlement-like record that applies old credits to old open transactions up to a date. It can be undone like any settlement.
- **Settlement coverage** (existing, LIRA-322): how much of each transaction each settlement paid. It is the source of every day's state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a normal day the operator settles the previous open days in 2 taps (open the sheet, Confirm), with no typing.
- **SC-002**: For any month, the calendar's "left this month" equals the sum of the amounts left on that month's days, per currency, in 100% of test cases.
- **SC-003**: Settling and then undoing any settlement leaves every ledger and every day exactly as before, per currency, in 100% of test cases when no later settlement relied on it; when one did, only the balancing account row of FR-018 remains, and the balance equals open owed plus open credits in 100% of test cases.
- **SC-004**: An operator can tell which days are settled, partly paid or unpaid, and which currency is still open on a two-currency day, in under 5 seconds without opening the day.
- **SC-005**: No settlement ever covers a transaction on an unselected day.
- **SC-006**: The same data shows the same day states and totals in the desktop app and the web app.

## Assumptions

- Only users who can settle the OMT account today can use the calendar and the "settled up to" setting (admin for the setting).
- The calendar shows one month at a time. The default selection still includes open days of earlier months.
- Commission entry on the sheet works as in LIRA-322.
- Release notes and a What's new card with a real screenshot are written with the change (rule 30).
