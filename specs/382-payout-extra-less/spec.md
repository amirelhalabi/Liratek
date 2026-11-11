# Feature Specification: "+ Extra / − Less" line on every payout screen

**Feature Branch**: `382-payout-extra-less` (work happens on `main`; ticket LIRA-382)

**Created**: 2026-11-11

**Status**: Draft

**Input**: Owner, 2026-11-11: "We should be able to pay extra. In payment direction out, we should be able to pay a bit extra if we want to, similar to Discount and Extra in payment in; we should have them in payment out." Asked how it should book: "Visible line, same booking."

## Today

Pay-in screens (POS, Exchange customer side, OMT/Whish send, voucher sale, …) show one "− Discount | + Extra" line under the total (LIRA-318/319/365), capped at $5 / 450,000 LBP outside POS.

Payout screens have no such line. The same effects exist but are hidden behind the typed amount:

- type **more** than owed (up to $5 / 450,000 LBP) → accepted, booked as the automatic "Change rounding" expense (LIRA-334);
- type **less** than owed (same cap) → accepted, booked as "Change kept (profit)";
- above the cap → refused.

A cashier who wants to hand over a round note on purpose has to know this and type the final figure; nothing on screen says "pay $0.10 extra".

## Clarifications

### Session 2026-11-11 (owner decisions)

- Q: Visible line with today's booking and cap, no cap with its own expense, or off the module's profit? → A: Visible line, same booking (today's "Change rounding" expense for extra, "Change kept (profit)" for less, $5 / 450,000 LBP cap).

### Open questions (recommended answer first)

1. **Which screens.** → Recommended: every payout screen LIRA-334 covers: OMT/Whish system receive, OMT App / Whish App receive, Binance cash-out, Exchange payout side, Hold Money pickup, telecom credit buy-back, OMT/Whish App "From client" top-up; plus the loto cash prize payout. Debts Cash Out keeps "extra goes to the client's account" (LIRA-313) and gets no line. Settle sheets (suppliers, partners, loto) keep their own Discount line (LIRA-372) and get no Extra.
2. **Name of the "less" side.** → Recommended: "− Less" (the shop pays a little less, kept as profit), to avoid "Discount" which on a payout means something else (owner, 2026-10-31).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Pay a round note on purpose (Priority: P1)

An OMT receive owes the customer $102.90. The cashier wants to hand over $103. They type 0.10 in "+ Extra"; "You pay" becomes $103.00 and the payment lines follow.

```
OMT receive owed            $102.90
− Less | + Extra   [+ Extra]  $0.10      (cap $5)
You pay                     $103.00

Books: payout $103.00 from the drawer
       expense "Change rounding" $0.10, linked to the receive
       module profit unchanged; net profit −$0.10
```

**Why this priority**: The owner's ask; makes a hidden behaviour visible and intentional.

**Independent Test**: Record the receive above with 0.10 extra; drawer −$103.00; Expenses shows "Change rounding $0.10" naming the receive; OMT/Whish profit unchanged.

**Acceptance Scenarios**:

1. **Given** a payout screen, **When** it renders, **Then** a "− Less | + Extra" line sits under the total, in the same place and look as the pay-in Discount/Extra line, empty by default.
2. **Given** the cashier types 0.10 in "+ Extra", **When** the line updates, **Then** "You pay" reads $103.00, the payment lines target $103.00, and the note reads "$0.10 booked as change rounding".
3. **Given** the receive is saved, **When** the books are read, **Then** the drawer went down $103.00 and one "Change rounding" expense of $0.10 exists, auto and linked to the receive (hidden by default on the Transactions page, visible on Expenses).
4. **Given** the cashier types 6 in "+ Extra", **When** the line updates, **Then** it is held at 5 and says the most allowed is $5.
5. **Given** the cashier instead types more than owed in the payment line (today's path), **When** the box matches, **Then** "+ Extra" is filled with the difference automatically (mirror of the pay-in round-up, LIRA-334 US3), and clearing it restores the plain amount.

---

### User Story 2 - Pay a little less on purpose (Priority: P2)

The customer is owed 1,345,000 LBP and takes 1,340,000. The cashier types 5,000 in "− Less"; "You pay" becomes 1,340,000 LBP; 5,000 LBP is kept as profit.

```
Owed                      1,345,000 LBP
− Less                        5,000 LBP   (cap 450,000)
You pay                   1,340,000 LBP

Books: payout 1,340,000; "Change kept (profit)" 5,000 on the transaction
```

**Acceptance Scenarios**:

1. **Given** "− Less" 5,000, **When** saved, **Then** the drawer goes down 1,340,000 LBP and the row carries 5,000 LBP kept change, as typing 1,340,000 does today.
2. **Given** a value above the cap, **When** typed, **Then** it is held at the cap with the message.
3. **Given** a refund or void of the payout, **When** it runs, **Then** the kept profit is cancelled with it (existing path).

---

### User Story 3 - Void and refund net to zero (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a payout saved with $0.10 extra, **When** voided or refunded, **Then** $103.00 returns to the drawer and the "Change rounding" expense is voided with it (existing LIRA-334 path).

---

### Edge Cases

- **Extra and Less are one line.** A payment has one or the other; switching sides clears the other, like the pay-in line.
- **Mixed currencies.** Measured in the total's currency at the screen's rate; the cap applies in that currency (as today).
- **Debts Cash Out.** No line; excess still goes to the client's account (LIRA-313).
- **Customer adds change (LIRA-336).** Unchanged; the extra applies on top of the raised target, within the cap.
- **For-partner payouts.** No line (no walk-in customer; FOR\_% forms unchanged).
- **Session basket payouts.** The basket's checkout already has its own line; the module page hides it in session mode like the pay-in pages do.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `MultiPaymentInput` in payout mode renders the built-in "− Less | + Extra" line when the caller wires `onRoundUpChange` (extra) and `onKeptChange`/kept math (less); the same `DiscountLine` component and cap helper as pay-in (rule 14).
- **FR-002**: "+ Extra" writes to the existing `rounding_given_usd/lbp` payload fields; "− Less" writes to the existing `kept_change_*` fields. No new payload keys, no core booking change.
- **FR-003**: Typing an overpay/underpay in the payment lines fills the line automatically (mirror of `suggestRoundUpExtra`); clearing the line restores the plain target.
- **FR-004**: Every payout screen in open question 1 wires it; Debts Cash Out, settle sheets and For-partner forms do not.
- **FR-005**: One rule for the cap (`isWithinShortfallMax`), shared with the server as today.
- **FR-006**: Release note and a What's new card with a real screenshot of the line on the OMT receive sheet (rule 30).

## Success Criteria _(mandatory)_

- **SC-001**: Frontend test per screen (table-driven): extra 0.10 → payload `rounding_given_usd: 0.1` and legs total 103.00; less 5,000 → `kept_change_lbp: 5000` and legs total 1,340,000; names taken from the schema (rule 24), failing first.
- **SC-002**: Web e2e: OMT receive with "+ Extra" 0.10; drawer delta −103.00; Expenses shows "Change rounding 0.10".
- **SC-003**: No core change needed; core suites unchanged and green.

## Decisions taken unattended (2026-11-11 night)

- **Screens (open question 1)**: recommended answer taken. The line appears on every payout that already accepts the LIRA-334 round-up (OMT/Whish system receive, OMT/Whish App receive, Binance cash-out, Exchange payout, Hold Money pickup, telecom credit buy-back, OMT/Whish App "From client" top-up). Reason: those screens already limit the round-up to cash walk-in payouts outside a session and not For Partner, so one change in the shared payment box covers exactly them.
- **Loto cash prize payout: not included.** Reason: the Cash Prize tab has no payment box and the server has no change-rounding for prizes; adding it would be a new booking, against "same booking".
- **Name of the less side (open question 2)**: "− Less", as recommended.
- **"− Less" only where change can be kept today.** Reason: a screen that does not book kept change (e.g. a two-currency Hold Money pickup) shows "+ Extra" only, so the line never offers something the server would not book.
- **Screen tests**: real payment box on OMT/Whish system receive, Exchange, OMT/Whish App receive and the "From client" top-up. Binance cash-out, telecom buy-back and Hold Money pickup are covered by the payment-box test plus their existing round-up tests (the line only changes the payout amount, which those already prove reaches the payload). Reason: their screen harnesses stub the payment box.
- **Web e2e number**: 095 (094 is already used by the shop backup download spec).

### Questions for the morning

1. Should the loto cash prize payout also get "+ Extra" (needs a server change to book the rounding)?
2. Should "− Less" also appear on a two-currency Hold Money pickup (kept per currency, no cap today)?
3. On the OMT/Whish App receive and the Binance cash-out the fee "Discount" line (it raises what the customer gets) now sits just above "− Less | + Extra". Is two lines that move the payout in opposite directions clear enough for a cashier, or should one be relabelled?
4. Seen while testing (existing, not changed here): after a cash round-up, switching the payout away and back does not re-report "no round-up" to the page; the page's own guards decide what is sent. Worth a look?
