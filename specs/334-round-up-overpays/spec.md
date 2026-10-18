# Feature Specification: Round-up overpays

**Feature Branch**: `334-round-up-overpays` (work happens on `main`; ticket LIRA-334)

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "When the cashier rounds a payment up to the notes at hand (total 102.90, paid 103.00), stop refusing it with 'payment is more than the total'. Payouts (every payout screen): accept an overpay up to $5 / 450,000 LBP and book the difference as the existing automatic 'Change rounding' expense. It shows on the Expenses page, lowers net profit and leaves the module margin unchanged; above the cap the payout stays blocked. Debts Cash Out keeps its 'extra goes to the client's account' behaviour. Customer pays: when the payment is more than the total by up to the same cap, fill the '+ Extra' side of the Discount/Extra line with the difference; the cashier can clear it to hand the change back. Only on pages where Extra is allowed. Owner decisions 2026-10-18. Desktop and web."

## Owner decisions (2026-10-18)

- **Payout round-up** is booked as the existing automatic expense "Change rounding", the same one POS and Maintenance write today for LBP change rounding. The owner considered and rejected two other options: taking it off the shop's fee (that only exists on two screens and cannot go above the fee) and lowering the payout's own profit (no reason shown anywhere, and the row can show a loss).
- **Customer-pays round-up** fills "+ Extra" automatically. The owner accepts that Waive will be used less often.
- **Cap** is $5 / 450,000 LBP in both directions. This is the same cap the payout "Change kept (profit)" uses today.
- **Order**: payouts first, then customer-pays.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pay out a round amount on an OMT receive (Priority: P1)

A customer comes to collect an OMT transfer of $102.90. The drawer has no 10-cent coins, so the cashier hands over $103.00 and types 103 in the payment box. Today this is refused with "The payment is more than the total." The cashier types 102.90 to get past it, hands out $103 anyway, and the drawer ends the day 10 cents short with no explanation. With this feature the payment box accepts 103.00, says the extra $0.10 is booked as change rounding, and the transaction saves.

**Why this priority**: It is the case the owner raised, and today it leaves an unexplained drawer shortage on every round-up.

**Independent Test**: On the Services page, record an OMT receive of $102.90 paid out as $103.00 cash. Check that the General USD drawer goes down by $103.00. Check that the Expenses page lists "Change rounding $0.10" for this receive. Check that the OMT receive's own profit is unchanged and that net profit for the day is $0.10 lower.

**Acceptance Scenarios**:

1. **Given** an OMT receive with $102.90 to pay out, **When** the cashier enters $103.00 cash, **Then** the payment box shows no error, shows a note that $0.10 is booked as change rounding, and Confirm is enabled.
2. **Given** that receive is saved, **When** the owner opens the Expenses page, **Then** it shows one "Change rounding" expense of $0.10 that names the receive.
3. **Given** that receive is saved, **When** the owner opens the Transactions list with default filters, **Then** only the receive shows, and the rounding row appears only when the list is filtered to expenses.
4. **Given** that receive is saved, **When** the owner opens Profits for the day, **Then** the OMT/Whish module profit is unchanged, and expenses deducted and net profit move by $0.10.
5. **Given** an LBP payout of 1,345,000 LBP, **When** the cashier enters 1,350,000 LBP, **Then** the payout saves and a "Change rounding" expense of 5,000 LBP is booked.
6. **Given** a payout of $102.90, **When** the cashier enters $108.00 (over the $5 cap), **Then** the payout is refused exactly as today.
7. **Given** a saved round-up payout, **When** it is voided or refunded, **Then** the $103.00 goes back to the drawer and the "Change rounding" expense is voided with it, so the day nets to zero.

---

### User Story 2 - Round-up on every other payout screen (Priority: P1)

The same round-up works wherever the shop hands money out: Binance cash-out, OMT App / Whish App receive, Exchange, Hold Money pickup, telecom credit buy-back and the OMT/Whish App "From client" top-up.

**Why this priority**: The owner asked for all payout screens. One screen behaving differently from the others would confuse cashiers.

**Independent Test**: On each listed screen, pay out a few cents or one note more than owed and check that it saves with one "Change rounding" expense for the difference.

**Acceptance Scenarios**:

1. **Given** any listed payout screen, **When** the cashier pays out more than owed by an amount within the cap, **Then** the payment saves and a "Change rounding" expense equal to the difference is booked.
2. **Given** a Debts cash-out, **When** the cashier pays out more than owed, **Then** the extra still goes on the client's account as today, and no rounding expense is booked.
3. **Given** a payout where the cashier paid out less than owed (within the cap), **When** it is saved, **Then** "Change kept (profit)" works as today.

---

### User Story 3 - Customer rounds up and the shop keeps the extra (Priority: P2)

A sale totals $102.90. The customer hands over $103.00 and tells the cashier to keep the change. The cashier enters 103. Instead of opening the change box, the Discount/Extra line switches to "+ Extra" with $0.10 filled in. The total becomes $103.00, matches what was paid, and the $0.10 is recorded as an extra charge.

**Why this priority**: Second in the owner's order. Customer-pays round-ups already have a working path today (the change box's Keep / Account), so this is a speed-up, not a fix.

**Independent Test**: On the POS, sell items totalling $102.90 and enter $103.00 cash. Check that "+ Extra" shows $0.10 and the sale saves with an extra of $0.10. Check that Profits shows $0.10 under "Extra charges".

**Acceptance Scenarios**:

1. **Given** a total of $102.90 on a page where Extra is allowed, **When** the cashier enters $103.00, **Then** the line switches to "+ Extra" with 0.10 filled in, "After Extra" shows $103.00, and no change box is shown.
2. **Given** that extra was filled in automatically, **When** the cashier clears it or switches back to "− Discount", **Then** the change box opens as today (hand back, Keep or Account), and the extra is not filled in again unless the payment amounts change.
3. **Given** a discount is already typed, **When** the cashier overpays, **Then** nothing is filled in automatically and the change box opens as today.
4. **Given** a page where Extra is not allowed (for-partner sale, item added to a session basket, Debts/Partners settle), **When** the cashier overpays, **Then** the change box opens as today.
5. **Given** the overpay is above the cap, **When** the cashier enters it, **Then** nothing is filled in and the change box opens as today.

---

### Edge Cases

- **A typo inside the cap.** A payout of $102.90 typed as $107.00 is accepted as $4.10 of rounding. The payment box note states the amount, so the cashier sees it before confirming.
- **Mixed currencies.** For a payout or payment split across USD and LBP, the difference is measured in the total's currency at the transaction's exchange rate. The cap applies in that currency.
- **Payout already has kept change.** Paying out less than owed and more than owed cannot both happen on one payment, so the two never mix.
- **Wallet legs.** A payout paid partly from a wallet (e.g. Whish) and partly in cash books one rounding expense for the total difference.
- **Offline replay.** A round-up recorded offline on desktop replays with the same rounding when it syncs.
- **For-partner payouts.** A payout made for a partner (FOR) refuses kept change today, and it refuses a round-up too. A payout made through a partner hands out real cash, so it allows a round-up.

## Requirements *(mandatory)*

### Functional Requirements

**Payouts**

- **FR-001**: On every payout screen listed in User Stories 1 and 2, the payment box MUST accept a total paid out that exceeds what is owed by no more than $5 (USD totals) or 450,000 LBP (LBP totals).
- **FR-002**: The payment box MUST show the round-up amount before Confirm, labelled as change rounding.
- **FR-003**: Above the cap, the payment box and the server MUST refuse the payout as they do today.
- **FR-004**: The server MUST decide the round-up amount itself from what is owed and the payout amounts entered, MUST check it against the cap, and MUST refuse a payout whose stated round-up does not match.
- **FR-005**: For each accepted round-up the system MUST book exactly one "Change rounding" expense, in the payout's currency, linked to the payout.
- **FR-006**: The round-up expense MUST move no drawer money of its own, because the payout amount already took it out of the drawer.
- **FR-007**: The round-up expense MUST be hidden from the default Transactions list, shown when filtering to expenses, and always listed on the Expenses page.
- **FR-008**: Voiding or refunding the payout MUST void its round-up expense, so the drawer, expenses and profit net to zero in each currency.
- **FR-009**: The payout's own profit MUST NOT change because of a round-up.
- **FR-010**: Debts cash-out MUST keep sending any overpaid amount to the client's account and MUST NOT book a round-up expense.
- **FR-011**: Desktop and web MUST behave identically.

**Customer pays**

- **FR-012**: On pages where Extra is allowed, when the amount paid exceeds the total by no more than the cap and no discount is entered, the payment box MUST switch the line to "+ Extra" and fill in the difference.
- **FR-013**: The filled-in extra MUST be saved exactly like a typed extra (an extra charge, under "Extra charges" in Profits).
- **FR-014**: If the cashier clears the filled-in extra or switches to "− Discount", the payment box MUST show the change box as today and MUST NOT fill the extra in again until the payment amounts change.
- **FR-015**: On pages where Extra is not allowed, or above the cap, overpaying MUST behave as today.

### Key Entities

- **Round-up (payout)**: the amount paid out above what was owed, within the cap. It is recorded as a "Change rounding" expense linked to the payout. It has the payout's currency, amount and date, and it is voided together with the payout.
- **Extra charge (customer pays)**: unchanged from LIRA-319. This feature only fills it in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can complete a payout rounded up to the next note in one try on every listed payout screen, with no error and no retyping.
- **SC-002**: After a day that includes round-up payouts, the drawer count matches the expected balance with zero variance caused by round-ups.
- **SC-003**: Every round-up payout appears as exactly one "Change rounding" expense on the Expenses page, with the right amount.
- **SC-004**: Voiding a round-up payout returns the drawer, expenses and net profit to their values before the payout, in each currency.
- **SC-005**: On a customer-pays page, a round-up of up to $5 / 450,000 LBP needs no extra taps when the shop keeps the difference, and one tap to clear it when handing change back.

## Assumptions

- "Payout screen" means a screen whose payment box is in payout mode: OMT/Whish system receive (Services), Binance cash-out, OMT App / Whish App receive, Exchange, Hold Money pickup (one-currency pickups), telecom credit buy-back and OMT/Whish App "From client" top-up. The refund window is not included, because a refund pays back a known amount and should not round.
- The round-up uses the same cap rule as payout "Change kept (profit)", so the two can never disagree about the limit.
- The "Change rounding" expense category already exists (LBP change rounding, 2026-10-16). Using it for payouts puts all rounding costs in one place on the Expenses page.
- Items added to a session basket are not payouts and are not affected.
- Customer-pays autofill only acts on the overpay as a whole. It does not change how LBP change is rounded up to the next note in the change box.
- A partner-owned payout that refuses kept change today also refuses a round-up.

## Clarifications

### Session 2026-10-18

- Q: With a $5 cap on the customer-pays side, a genuine change case ($100 on $96) fills in a $4 extra unless the cashier clears it. Full cap or smaller? → A: Full $5 / 450,000 LBP cap, as the owner chose for both directions. The cashier clears the extra to hand change back (FR-014). The "+ Extra" line is highlighted while it is filled in automatically, so it is not missed.
