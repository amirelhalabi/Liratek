# Feature Specification: Checkpoint open differences

**Feature Branch**: `335-checkpoint-open-differences` (ticket LIRA-335; work happens on `main`)

**Created**: 2026-10-18

**Status**: Clarified (owner answers 2026-10-18)

**Input**: User description: "Checkpoint open differences: every Over/Short found by a drawer checkpoint stays open per drawer and currency until resolved. A transaction saved with a custom time before a checkpoint of the same drawer resolves that checkpoint's open difference (same currency, same direction, capped at open amount) without moving the drawer a second time; partial resolution allowed; status Resolved / Partly resolved. Owner can close an unexplained difference by hand: Short books an automatic books-only "Drawer shortage" expense on the checkpoint day, Over records nothing; Reopen allowed. Open differences filter on the Checkpoints timeline; details window shows resolution and Close/Reopen; hint under Transaction time on forms with Set custom time. Desktop and web. See current_sprint.md LIRA-335 for owner decisions."

**Design references**: owner-approved pages https://claude.ai/artifact/VvoSEJNgZ4ACPaFygm6YjR (findings, proposal, current vs proposed screens) and https://claude.ai/artifact/VxqWjjdycf89oi87tZqvmd (how checkpoints work today). Owner decisions: `current_sprint.md` → LIRA-335.

## Clarifications

### Session 2026-10-18

- Q: A closed Short later explained by a back-timed transaction? → A: Resolve it and shrink the Drawer shortage expense (void it when fully explained).
- Q: Checkpoints saved before the update? → A: From now on only; old checkpoints stay as today.
- Q (design review): void vs refund of a resolving sale? → A: Void undoes the resolution; a refund does not (the counted cash was real; the refund is today's cash out). Follows from the owner's model, recorded here for review.
- Q: Run tests? → A: Affected jest only (explicit paths); e2e written but not run.

## Background

A checkpoint today records the counted money in a drawer and then corrects the system's expected balance to the counted amount. The difference ("Over $50.00" / "Short $3.00") is shown in amber on the Checkpoints timeline and then forgotten.

The owner's routine when a difference appears: find the missed transaction on the shop camera, re-enter it with **Set custom time** at its real time, and make a new checkpoint. Today that new checkpoint shows the opposite difference, because the first checkpoint already put the money into the expected balance and the re-entered transaction adds it a second time.

Worked example (General drawer, USD):

| When      | What happens                             | Cash  | Expected today    | Expected with this feature  |
| --------- | ---------------------------------------- | ----- | ----------------- | --------------------------- |
| Mon 14:10 | $50 sale not entered                     | 1,050 | 1,000             | 1,000                       |
| Mon 18:00 | Checkpoint: Over $50, expected corrected | 1,050 | 1,050             | 1,050 (difference Open)     |
| Tue 10:05 | Sale re-entered, custom time Mon 14:10   | 1,050 | **1,100**         | 1,050 (difference Resolved) |
| Tue 10:10 | New checkpoint                           | 1,050 | Short $50 (false) | **Balanced**                |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A re-entered missed transaction resolves the checkpoint difference (Priority: P1)

The owner sees "Over $50.00" on Monday's General checkpoint. They find the missed $50 sale on camera, enter it in POS with Set custom time = Monday 14:10, and save. The General expected balance stays at the counted amount, the sale appears in sales and profit, and Monday's checkpoint row now shows **Resolved**. A new checkpoint is Balanced.

**Why this priority**: This is the owner's daily routine and the defect that started the ticket. Without it every correction creates a false opposite difference.

**Independent Test**: Make a checkpoint with a difference, save a transaction with a custom time before it, make a second checkpoint; verify the second is Balanced and the first shows Resolved, with drawer totals matching the counted cash at every step.

**Acceptance Scenarios**:

1. **Given** General was counted Monday 18:00 with Over $50.00 open, **When** a $50 cash sale to General is saved with custom time Monday 14:10, **Then** General's expected balance does not change, the sale counts in sales and profit, and Monday's difference becomes Resolved.
2. **Given** the same Over $50.00 open, **When** a $60 cash sale to General is saved with custom time Monday 14:10, **Then** $50 resolves the difference and General's expected balance rises by $10 only.
3. **Given** the OMT Cash Drawer was counted Monday 18:00 with Short $20.00 open, **When** a $12 expense paid from that drawer is saved with custom time Monday 16:20, **Then** the difference becomes Partly resolved with $8.00 open, and the drawer's expected balance does not change.
4. **Given** General was counted Monday 18:00 and matched, **When** a sale is saved with custom time Monday 14:10, **Then** nothing is resolved and the expected balance rises as today.
5. **Given** an Over difference is open, **When** a transaction with an earlier custom time moves money OUT of that drawer, **Then** nothing is resolved (wrong direction) and the drawer moves as today.
6. **Given** a sale resolved a difference, **When** that sale is voided (it never happened), **Then** the resolution is undone: the difference reopens by the same amount and the drawer's expected balance ends where it was before the sale was entered.
7. **Given** a sale resolved a difference, **When** that sale is refunded (fully or partly), **Then** the resolution stays (the money was really in the counted drawer) and the refund moves the drawer by the cash handed back, as today.
8. **Given** a transaction is saved without a custom time, **When** it is saved, **Then** it behaves exactly as today.

---

### User Story 2 - See which differences are still open (Priority: P1)

The owner opens the Checkpoints timeline and sees, for every difference, whether it is Open, Partly resolved, Resolved or Closed, and what resolved or closed it. A filter shows only the differences still open, for any date range.

**Why this priority**: Without status the owner cannot tell a real loss from one already explained; the filter is how they find work left to do (no dashboard badge, owner decision).

**Independent Test**: With checkpoints in each state, open the timeline and the details window; turn the filter on and off.

**Acceptance Scenarios**:

1. **Given** checkpoints with Open, Partly resolved, Resolved and Closed differences, **When** the timeline loads, **Then** each row with a difference shows its status, and rows that resolved or closed show a short line naming the transaction or expense.
2. **Given** the "Open differences only" filter is on, **When** the timeline loads for a date range, **Then** only checkpoints with an Open or Partly resolved difference are listed, and the filter shows how many there are.
3. **Given** a checkpoint with a difference, **When** the owner opens its details, **Then** each currency with a difference lists what resolved it (transaction, who entered it, its custom time, amount) and what is still open.
4. **Given** a checkpoint with no difference, **When** it is shown, **Then** it looks exactly as today ("Balanced").

---

### User Story 3 - Close a difference nobody can explain (Priority: P2)

Nothing turns up on camera. From the checkpoint details the owner presses **Close difference…**. For a Short, the remaining amount is recorded as a "Drawer shortage" expense on the checkpoint's day, so net profit drops by it. For an Over, nothing is recorded. The row shows Closed · Short or Closed · Over. **Reopen** undoes it.

**Why this priority**: Makes drawer losses visible in profit and lets the owner finish the open list; useful only once Stories 1–2 exist.

**Independent Test**: Close a Short and an Over, check Expenses and Profits, then reopen both.

**Acceptance Scenarios**:

1. **Given** a Short $8.00 still open, **When** the owner closes it, **Then** a "Drawer shortage" expense of $8.00 dated the checkpoint's day appears on the Expenses page, net profit for that day drops by $8.00, no drawer balance changes, and the row shows Closed · Short.
2. **Given** an Over $15.00 still open, **When** the owner closes it, **Then** nothing is recorded in Expenses or Profits, no drawer balance changes, and the row shows Closed · Over.
3. **Given** a Closed · Short, **When** the owner reopens it, **Then** the Drawer shortage expense is voided, net profit returns, and the difference is open again with the same amount.
4. **Given** a non-admin user, **When** they try to close or reopen, **Then** it is refused.

---

### User Story 4 - Warning before saving a back-timed transaction (Priority: P3)

When a form's Transaction time is set, a line under the time lists each open checkpoint difference that money saved at that time could resolve: the drawer, the checkpoint's time, the direction and the amount still open, and which way the money must move. An Over is resolved by money **into** that drawer; a Short by money **out of** it. The hint is driven by the time only (research R9), so every form with Set custom time gets it with no per-form wiring.

**Why this priority**: Helps the cashier understand the outcome; the money result is correct without it.

**Independent Test**: In any form, set a custom time before a checkpoint with an open Over, then before one with an open Short, then after the last checkpoint; read the line each time.

**Acceptance Scenarios**:

1. **Given** General's Monday 18:00 checkpoint has Over $50.00 open, **When** a form's time is set to Monday 14:10, **Then** the line reads "This time is before General's checkpoint of Mon 06:00 PM (Over $50.00 open). Money into General saved at this time will resolve it instead of raising the balance."
2. **Given** OMT Cash Drawer's Monday 18:00 checkpoint has Short $8.00 open, **When** a form's time is set to Monday 14:10, **Then** the line says money **out of** OMT Cash Drawer saved at that time will resolve it instead of lowering the balance.
3. **Given** the time is after every checkpoint with an open difference, or no custom time is set, or the read fails, **When** the form is shown, **Then** no line is shown.

_Follow-up (logged, not built)_: a per-form preview naming this transaction's own drawer and how much of its amount resolves the difference (fully, partly, or not at all — e.g. "$50 of this $60 sale"). Most forms do not know their drawer before saving (research R9).

### Edge Cases

- A transaction that moves several drawers or currencies (split payment, change given back) resolves per drawer and per currency, using that transaction's net movement on each.
- A transaction whose movement is not in a drawer (customer account, partner, supplier credit) resolves nothing.
- Two checkpoints of the same drawer after the custom time: only the first checkpoint after the custom time is resolved; later ones are never touched.
- The first checkpoint after the custom time has no open difference in that currency and direction: nothing is resolved, the drawer moves as today, even if an older or newer checkpoint has an open difference.
- A difference already Closed · Short when a matching back-timed transaction arrives: it is resolved and the Drawer shortage expense shrinks (FR-016).
- A difference already Closed · Over when a matching back-timed sale arrives: the sale resolves it (the money was really there) and the drawer is not raised twice; the closed mark stays so a later void is symmetric, and the status reads Resolved once nothing is open.
- Refund (full or partial) of a resolving sale: the refund is a new movement now (cash handed back today) and moves the drawer by the cash returned; the resolution stays. Only a void undoes it.
- A voided transaction's resolution is undone even if the difference was later closed; a Closed · Short's shortage expense grows back by the same amount (FR-016).
- Rounding: amounts within one cent (USD) or one LBP of zero count as zero, as the checkpoint already does.
- An all-drawers checkpoint (initial setup or the all-drawers window) holds a separate difference per drawer and currency.
- MTC and Alfa drawers follow their SIM lines (drawer = sum of lines). Offsetting the drawer without the line would break that, so in this release a back-timed transaction resolves nothing on MTC/Alfa: their differences can only be closed by hand. Follow-up if the owner wants line-aware resolution.
- Offline sales replayed later with their original event time are treated like a custom time (see FR-006).

## Requirements _(mandatory)_

### Functional Requirements

**Open differences**

- **FR-001**: Every checkpoint saved after this feature ships MUST record, per drawer and currency, the difference it actually corrected (the amount it added to or removed from the expected balance). That recorded amount, not the expected figure shown on screen when the window opened, is the difference used everywhere below.
- **FR-002**: A difference MUST have a status derived from one calculation: **Open** (nothing resolved or closed), **Partly resolved** (some resolved, some open), **Resolved** (fully resolved), **Closed · Short** / **Closed · Over** (owner closed the rest). The amount still open MUST equal the difference minus everything resolved, never below zero.
- **FR-003**: A difference MUST stay open with no time limit until resolved or closed.

**Resolution by a back-timed transaction**

- **FR-004**: When a transaction is saved with a time earlier than the most recent checkpoint of a drawer it moves money in, the system MUST find the first checkpoint of that drawer after that time and, if that checkpoint has an open difference in the same currency and direction (Over ← money in, Short ← money out), resolve it by the smaller of the transaction's net movement on that drawer and currency and the amount still open.
- **FR-005**: The resolved amount MUST NOT change the drawer's expected balance a second time. Any movement above the resolved amount MUST move the drawer as today.
- **FR-006**: The rule MUST apply to every flow that saves a transaction with a custom time and moves a drawer (POS, services, recharge, financial services, expenses, debts, exchange, maintenance, custom services, loto, session checkout), and to offline transactions replayed with their original event time. **As built (2026-10-18)**: covered — POS sales, expenses, debts, exchange, financial services, recharge, custom services, maintenance, loto, hold money, and offline replays of these. Not covered, moving the drawer as today: session checkout's pooled customer payment (it belongs to no single transaction; each item's own legs still resolve), drawer top-up / cash-out / wallet exchange, and MTC/Alfa (above). Listed in the engine's exclusion list with reasons.
- **FR-007**: A transaction saved without an earlier time MUST behave exactly as today.
- **FR-008**: The resolving transaction MUST keep its normal sales, profit, client and history records; only the drawer movement is offset.
- **FR-009**: Voiding a resolving transaction MUST undo its resolution in the same step, so the drawer's expected balance and the difference return to what they were before the transaction was saved. Creating and then voiding a resolving transaction MUST net to zero on every drawer, per currency. Refunding it (fully or partly) MUST NOT undo the resolution: a refund is new money handed back now and moves the drawer by exactly the cash returned.
- **FR-010**: Each resolution MUST record which checkpoint, drawer, currency, transaction and amount it covers, who saved the transaction and when, so the timeline can show it.

**Close and reopen**

- **FR-011**: Admins MUST be able to close the amount still open on a difference. Closing a Short MUST create one automatic "Drawer shortage" expense for that amount, dated the checkpoint's day, that moves no drawer, is linked to the checkpoint, lowers net profit, appears on the Expenses page and is hidden by default in the Transactions table. Closing an Over MUST record nothing in Expenses or Profits.
- **FR-012**: Admins MUST be able to reopen a closed difference. Reopening MUST void its Drawer shortage expense (if any) and return the difference to Open or Partly resolved.
- **FR-013**: "Drawer shortage" MUST NOT be selectable in Add New Expense and MUST NOT be voidable on its own from the Expenses page; only Reopen removes it.
- **FR-014**: Close and reopen MUST be refused for non-admins and for a difference with nothing open (close) or not closed (reopen), with a clear message.
- **FR-015**: Closing MUST never change a drawer's expected balance; the checkpoint already set it.
- **FR-016**: If a back-timed transaction later explains a Closed · Short difference (same drawer, currency and direction), the system MUST resolve it as in FR-004 and shrink the Drawer shortage expense by the explained amount (voiding it when fully explained), so the loss is never counted twice and the drawer stays as counted. Voiding that transaction later MUST restore the shortage expense amount. (Owner decision 2026-10-18.)

**Screens**

- **FR-017**: The Checkpoints timeline MUST show the status of each difference and, for resolved or closed ones, a short line naming the transaction(s) or expense; matched checkpoints look as today.
- **FR-018**: The Checkpoints timeline MUST offer an "Open differences only" filter (Open or Partly resolved) that works with the existing search, drawer and date filters and shows how many rows match.
- **FR-019**: The checkpoint details window MUST list, under each currency with a difference, what resolved it and what is still open, and MUST offer Close difference… (while something is open) or Reopen (when closed) to admins.
- **FR-020**: Forms with Set custom time MUST show, under Transaction time, one line per open checkpoint difference that money saved at the chosen time could resolve, naming the drawer, the checkpoint's time, the direction and the open amount. An Over line MUST say money **into** that drawer resolves it; a Short line MUST say money **out of** that drawer resolves it (FR-004). No line when no time is set, no difference qualifies, or the read fails. (Per-form drawer/amount preview — fully, partly or not at all — is a logged follow-up, research R9.)
- **FR-021**: All of the above MUST work the same in the desktop app and the web app, and in English and Arabic. The type of a resolving transaction ("Sale #4821") is shown in Arabic using the Transactions table's own type words; a type those words do not cover stays in English.
- **FR-022**: Checkpoints saved before this feature ships MUST stay as today: amber, no status, not resolvable and not in the Open differences filter. Only checkpoints saved after the update get open differences. (Owner decision 2026-10-18.)

**Other fixes in scope**

- **FR-023**: The expected figure stored with a checkpoint MUST be the one the correction was calculated from at save time, so the timeline and the books always agree (fixes finding 4 of the review).

### Key Entities _(include if feature involves data)_

- **Checkpoint difference**: one per checkpoint, drawer and currency where the checkpoint corrected the balance. Holds the corrected amount and direction, plus the closed state (who, when, linked shortage expense).
- **Difference resolution**: one per transaction, drawer and currency that resolved part of a difference. Holds the amount, the transaction and the checkpoint difference; removed or reversed when the transaction is voided.
- **Drawer shortage expense**: an automatic expense owned by a closed Short difference, dated the checkpoint's day, moving no drawer.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the worked example, the second checkpoint is Balanced and the first shows Resolved, with zero false differences.
- **SC-002**: For every flow listed in FR-006, saving a back-timed transaction against an open difference and then voiding it leaves every drawer balance, per currency, exactly where it started (difference 0.00).
- **SC-003**: The owner can find every open difference in a month in one view (the filter) in under 30 seconds.
- **SC-004**: Every closed Short appears once in Expenses and in Profits for the checkpoint's day; every reopen removes it; no Over ever appears in Profits.
- **SC-005**: Transactions saved without a custom time produce identical drawer, profit and expense results to today.

## Assumptions

- Work is admin-only, like checkpoints today; cashiers see the hint line on forms but cannot close or reopen.
- "First checkpoint after the time" means the first checkpoint whose recorded time is later than the transaction's time, for that drawer (including all-drawers checkpoints that counted that drawer).
- Notes stay optional, there is no dashboard badge, and variance colours stay "any difference is amber" (owner decisions); the amber look remains for Open differences.
- Editing a transaction's time after saving is not supported for money transactions today and stays out of scope.
- The word "write off" is not used anywhere in this feature (it means dismissing a party's debt).
- The Close button lives in the checkpoint details window, not on each timeline row (shown in the approved design page; owner has not objected).
- Desktop e2e is not run on the owner's Mac; the desktop path is proven by unit tests and shared code.
