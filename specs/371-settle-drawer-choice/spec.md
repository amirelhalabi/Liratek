# Feature Specification: Choose the cash drawer when settling OMT system items

**Feature Branch**: `371-settle-drawer-choice` (work happens on `main`; ticket LIRA-371)

**Created**: 2026-11-05

**Status**: Draft

**Input**: Owner, 2026-11-05: "Selecting which cash drawer the payment goes into when doing any settling … Only in cases we are settling OMT system transactions which are eligible to put cash or take cash out of the OMT system cash drawer. Else, it's always in the general cash drawer, which is the case. So, this needs no change. We just need to verify that if a transaction we are settling is OMT system transaction, then we can showcase an option for the user to select from general cash drawer or OMT system cash drawer."

## Clarifications

### Session 2026-11-05 (owner decisions)

- Q: Which screens get the choice? → A: Settle screens, and only when the items being settled include OMT system transactions. Everything else stays on General with no choice, as today.
- Q: Which drawers can be picked? → A: Cash drawers only: the OMT Cash Drawer and General.
- Q: What is selected by default? → A: OMT Cash Drawer, which is what happens today. The cashier switches to General only when the cash really went there.
- Q: Partners? → A: No. The Partners settle screens keep General with no choice.
- Q: On Debts, a $250 cash payment for a $200 OMT send plus a $50 sale: what does "OMT Cash Drawer" do? → A: Today's split: OMT Cash Drawer +$200, General +$50. "General" puts all $250 in General.

### Session 2026-11-05 (owner decisions after planning)

- Q: On an OMT-main shop, OMT's batch Settle and Pay / Receive tabs are hidden (OMT settles by day). Is the choice on OMT Settle Account (plus Debts Repay) enough? → A: Yes. Batch Settle and Pay / Receive show it only where those screens exist for the main system's supplier (a Whish-main shop).
- Q: Customer owes $200 for one OMT send, pays $100 into General, then $100 with the default. → A (for information, unchanged rule): the second $100 goes to the OMT Cash Drawer ("OMT drawer first").
- Q: Change returned in cash on Debts Repay (customer hands $250 for a $200 OMT send and gets $50 back): which drawer pays the change? → A: Today's behaviour, unchanged: change on Debts always comes out of General, whatever the choice. On the Suppliers screens, change follows the choice.

### What happens today (read from the code, 2026-11-05)

- **Debts, Repay (item picker and calendar):** cash paid against open OMT system transfers on the customer's account goes to the OMT Cash Drawer automatically, up to what each transfer still owes. The rest goes to General. The "Goes to" line shows the split. The cashier cannot change it.
- **Suppliers, OMT account (Settle Account sheet, including the SMS amount):** cash always goes to or comes from the OMT Cash Drawer. The cashier cannot change it. On an OMT-main shop, OMT's batch Settle and Pay / Receive tabs are hidden (OMT settles by day).
- **Suppliers, Whish on a Whish-main shop:** the same, on the Settle Account sheet, and on batch Settle (bills commission) and Pay / Receive where those tabs are shown.
- **Partners:** cash always goes to General, even for OMT items. Unchanged by this feature.
- On a shop whose main system is Whish, the same rules apply to the Whish system and its cash drawer instead of OMT.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Debt repayment: cash put in General (Priority: P1)

A customer owes $200 for an OMT send booked on their account. They pay $200 cash, but the cashier puts it in the General drawer, not the OMT drawer. The cashier switches "Goes to" to General before confirming, so the books match the real drawers.

**Why this priority**: Today the app always books that cash in the OMT Cash Drawer. When the cash really went into General, both drawers' counts are wrong at closing.

**Independent Test**: Customer owes $200 for one OMT send. On Debts, Repay, pay $200 cash. "Goes to" shows a choice, set to OMT Cash Drawer. Switch it to General and confirm. General +$200, OMT Cash Drawer unchanged, debt $0.

**Acceptance Scenarios**:

1. **Given** a customer whose open items include an OMT system transfer, **When** the cashier pays cash on Repay, **Then** "Goes to" shows a choice between OMT Cash Drawer and General, with OMT Cash Drawer selected.
2. **Given** the choice left on OMT Cash Drawer, **When** confirmed, **Then** the money goes exactly where it goes today (OMT share to the OMT Cash Drawer, the rest to General).
3. **Given** the choice switched to General, **When** confirmed, **Then** all the cash goes to General, nothing goes to the OMT Cash Drawer, and the debt is reduced by the same amount as with the default.
4. **Given** a customer whose open items contain no OMT system transfer (e.g. a sale and a recharge), **When** they pay cash, **Then** no choice is shown and the cash goes to General, as today.
5. **Given** a payment made only with non-cash methods (e.g. Whish App), **Then** no choice is shown, as today.

---

### User Story 2 - OMT account settlement: cash taken from General (Priority: P1)

The shop pays OMT $772.30, but the cash comes out of the General drawer. On the Suppliers page, Settle Account for OMT, the cashier switches "Goes to" (or "Comes from") to General before confirming.

**Why this priority**: Same reason as story 1, for the larger OMT settlements.

**Independent Test**: OMT account owes $772.30 on the picked days. Open Settle Account, keep the payment as cash $772.30, switch the drawer to General, confirm. General −$772.30, OMT Cash Drawer unchanged, OMT balance $0, picked days settled.

**Acceptance Scenarios**:

1. **Given** the OMT Settle Account sheet with a cash payment, **Then** the sheet shows a drawer choice with OMT Cash Drawer selected.
2. **Given** the choice switched to General, **When** confirmed, **Then** the cash moves in or out of General instead of the OMT Cash Drawer. Commission, coverage, balance and settled days are identical to the same settlement with the default.
3. **Given** a settlement that collects in one currency and pays in the other (e.g. +$7,492.70, −60,000,000 LBP), **When** the choice is General, **Then** both cash lines use General.
4. The same choice appears on batch Settle and on Pay / Receive for the main system's supplier, paid in cash, wherever those screens exist (in practice a Whish-main shop; an OMT-main shop does not show them for OMT).

---

### User Story 3 - Void or refund puts the cash back in the drawer that was chosen (Priority: P1)

If a repayment or settlement booked in General is voided or refunded, the cash goes back out of General, not the OMT Cash Drawer.

**Why this priority**: Otherwise the reversal moves the wrong drawer and the drawers stop balancing.

**Independent Test**: Do story 1 with General, then void it. General back to where it started, OMT Cash Drawer unchanged throughout, debt back to $200. Same for story 2.

**Acceptance Scenarios**:

1. **Given** a repayment or settlement made with General, **When** it is voided or refunded, **Then** every drawer, ledger and balance returns to where it was before, in every currency.

---

### Edge Cases

- A repayment ticks both an OMT transfer and a sale: with OMT Cash Drawer, the OMT share goes there and the rest to General (today). With General, everything goes to General.
- Payment split across cash and another method: the choice only affects the cash lines.
- Change returned in cash: on Debts Repay, change always comes out of General, as today, whatever the choice. On the Suppliers screens, change comes out of (or goes into) the drawer the choice names.
- A $200 OMT send paid $100 into General, then $100 with the default: the second $100 goes to the OMT Cash Drawer ("OMT drawer first", unchanged). Debt $0, OMT Cash Drawer +$100, General +$100.
- A shop whose main system is Whish: the choice reads "Whish Cash Drawer / General" and applies to Whish system items.
- The secondary system, OMT App, Whish App and Binance items never show the choice (they never use a system cash drawer today).
- Offline or old desktop clients that send no choice: the server keeps today's behaviour (OMT Cash Drawer).
- Settling a supplier other than OMT (or the main system's supplier): no choice, unchanged.
- Partners settle screens: no choice, unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Debts Repay screen (item picker and calendar) MUST show a drawer choice when at least one cash line is paid and the customer's items being paid include a main-system transfer that today routes cash to the system cash drawer.
- **FR-002**: The Suppliers screens for the main system's supplier MUST show the same drawer choice when the payment includes a cash line: the Settle Account sheet always, and batch Settle and Pay / Receive wherever those screens exist for that supplier (today a Whish-main shop; no OMT batch Settle or Pay / Receive is added on an OMT-main shop).
- **FR-003**: The choice MUST offer exactly two options: the main system's cash drawer (labelled as today, e.g. "OMT Cash Drawer") and "General".
- **FR-004**: The main system's cash drawer MUST be selected by default, and leaving it untouched MUST produce exactly today's drawer movements.
- **FR-005**: Choosing General MUST move every cash line of that payment into or out of General, and MUST NOT change any amount, debt, supplier balance, commission, coverage, settled day or profit compared with the default.
- **FR-006**: Screens and items not covered by FR-001/FR-002 MUST NOT show the choice and MUST behave exactly as today, including all Partners settle screens.
- **FR-007**: The server MUST validate the choice: only the two allowed values are accepted, and "General" is refused with a clear message on any payment where FR-001/FR-002 do not apply. Sending the default (system drawer) where the choice does not apply is accepted and behaves exactly as today (same as sending nothing, FR-008).
- **FR-008**: A request that sends no choice MUST be treated as the default (FR-004), so older clients and offline replays keep working.
- **FR-009**: Void and refund of a payment made with General MUST reverse the cash out of General, and net to zero across every drawer and ledger, per currency.
- **FR-010**: The transaction details and the payment lines MUST show which drawer the cash went to, as they do today.
- **FR-011**: The feature MUST work the same on the desktop app and the web app.

### Key Entities

- **Drawer choice**: a per-payment setting with two values (main system cash drawer, General). It decides only where the cash lines of that payment are recorded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every covered screen, a payment confirmed with the default produces exactly the same drawer movements as before this feature (0 difference in every drawer, per currency).
- **SC-002**: A payment confirmed with General produces the same debt, supplier balance and profit as the default, with the cash moved in General and 0 in the system cash drawer.
- **SC-003**: Creating then voiding (or refunding) a General payment leaves every drawer and ledger at 0 net change, per currency.
- **SC-004**: The choice takes the cashier one tap and never appears on a screen where it has no effect.

## Assumptions

- "OMT system transactions" means transfers on the shop's main system (OMT, or Whish when Whish is the main system), the same set that already routes cash to the system cash drawer today.
- On Debts, "OMT Cash Drawer" keeps today's split (OMT share to the system drawer, the rest to General). The choice does not let the cashier send non-OMT items' cash to the OMT drawer.
- One choice per payment, not per line or per item.
- No new permission: anyone who can make the payment can pick the drawer.
- The choice is not remembered between payments; it resets to the default each time.
