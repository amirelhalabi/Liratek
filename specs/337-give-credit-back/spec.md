# Feature Specification: Give credit back from a line for sale

**Feature Branch**: `337-give-credit-back` (work happens on `main`)

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Give back part of a for-sale phone line's credit before selling it. On the Phone Lines page (For sale tab), a 'Give credit back' action moves part of the line's credit to one of the shop's own lines of the same carrier, so the buyer keeps only the credit they want." Owner decisions 2026-10-18 are folded into the requirements below.

## Background

The shop sometimes has to recharge a line it holds for sale (LIRA-309). Example: a line ends up with $15 of credit, but the buyer only wants $9. Today no single step covers this:

- The credit-buy-back flow on Mobile Recharge assumes the customer owns the credit. It pays cash out at the buy-back rate and needs a sale first, so the job takes two transactions.
- The manual route takes three unlinked edits: line details, product price, and the shop line's balance. That balance edit cannot be undone with Void, and the line's cost is left too high.

This feature mirrors LIRA-309's "Recharge from shop-line credit" in the other direction.

## Worked example (owner-confirmed, illustrative figures)

Line for sale: $15 credit, price $25, cost $20. The buyer keeps $9, so $6 comes off the line. Assumed rates for the example: credit selling price 100,000 LBP per $1, exchange rate 89,500, credit cost 89,500 LBP per $1 ($1.00).

| | Before | After | How |
|---|---|---|---|
| Line for sale credit | $15.00 | $9.00 | sends $5.68 and pays $0.32 SMS fee (2 messages × $0.16) |
| Shop line credit (and MTC drawer) | $40.00 | $45.68 | receives the $5.68 actually transferred |
| Line price | $25.00 | $18.30 | − 6 × 100,000 = 600,000 LBP = $6.70 |
| Line cost | $20.00 | $14.32 | − 5.68 × $1.00 |
| Profit when sold | $5.00 | $3.98 | −$0.70 credit margin, −$0.32 fee |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Give part of the credit back before selling (Priority: P1)

A buyer wants a line for sale but only part of its credit. The cashier opens Phone Lines → For sale and clicks "Give credit back" on that line. They type how much credit the buyer keeps, pick the shop line that receives the rest, and confirm or change the credit selling price. The screen then shows the new credit, price, cost and the SMS fee before saving. After saving, the line has the lower credit and price, and the cashier sells it at POS as usual.

**Why this priority**: This is the whole feature. Without it, the shop either overcharges the buyer or makes three manual edits that cannot be undone.

**Independent Test**: Use a line for sale with $15 credit, price $25 and cost $20, and an MTC shop line with $40. Give back so the buyer keeps $9. Check the line ($9, $18.30, $14.32), the shop line ($45.68) and the MTC drawer (+$5.68), with the example rates.

**Acceptance Scenarios**:

1. **Given** the example line and rates, **When** the cashier enters "keeps $9" and saves, **Then**:
   - the line's credit is $9.00, its price $18.30 and its cost $14.32;
   - the chosen shop line goes from $40.00 to $45.68;
   - the MTC drawer rises by $5.68;
   - one "Give credit back" entry appears in the Transactions list.
2. **Given** the form is open, **When** the cashier changes the credit selling price from 100,000 to 85,000 LBP per $1, **Then** the preview shows a price drop of 510,000 LBP, which is $5.70 at the 89,500 rate, so the new price is $19.30. Saving uses that value.
3. **Given** the line has been given back, **When** it is sold at POS, **Then** the sale uses the new price and the new cost, so profit is $3.98 in the example.

---

### User Story 2 - Undo a give-back with one Void (Priority: P1)

The cashier made a mistake, or the buyer changed their mind before paying. Voiding the "Give credit back" transaction puts everything back exactly as it was.

**Why this priority**: Money rule: every ledger change needs one named way to reverse it. Without Void, a mistake would need the same unlinked manual edits this feature replaces.

**Independent Test**: Give back as in Story 1, then void the transaction. Every figure returns to its "Before" value, and the MTC drawer nets to $0.00 over give-back plus void.

**Acceptance Scenarios**:

1. **Given** an unsold line after a give-back, **When** the transaction is voided, **Then**:
   - the line returns to $15.00 credit, $25.00 price and $20.00 cost;
   - the shop line returns to $40.00;
   - the MTC drawer movement nets to $0.00.
2. **Given** the line has been sold since the give-back, **When** the give-back is voided, **Then** it is refused with "Refund the sale of this line first."
3. **Given** a newer recharge or give-back exists on the same line, **When** the older give-back is voided, **Then** it is refused with "Undo the newer recharge of this line first." (the same rule as LIRA-309 recharges).

---

### User Story 3 - Same action on the web app (Priority: P2)

The same action, with the same figures and refusals, works on the web app and the desktop app.

**Why this priority**: Shops use both apps; every money feature must behave the same on both.

**Independent Test**: Run Story 1 and Story 2 on the web test tenant and get the same results.

**Acceptance Scenarios**:

1. **Given** the web app, **When** Story 1 and Story 2 are run, **Then** the results are identical to desktop.

### Edge Cases

- **Amount kept is not less than the current credit.** The action is refused: there is nothing to give back.
- **Amount kept is zero.** Allowed: the buyer takes the line with no credit, and all of it (less the fee) goes to the shop line.
- **SMS fee boundaries.** Each message carries at most $3 and costs $0.16, paid by the sender. Some amounts cannot leave the line at exactly the amount asked; for example, $3.17 cannot be split exactly. Then the system sends the largest transfer that leaves the line at **no less** than the amount the buyer keeps. The preview shows the exact resulting credit before saving.
- **The give-back is too small to cover one fee** (≤ $0.16). Refused: nothing would reach the shop line.
- **No active shop line for that carrier.** Refused with a message asking to add one (Phone Lines → Shop lines).
- **Line's carrier is not set.** Refused with a message asking to set it first (Edit line).
- **Line already sold, or written off.** The action is not offered.
- **New price below the new cost.** Allowed; the preview shows the expected loss in red.
- **Shop line has spent the credit before a void.** The void is still allowed and the shop line may go below zero, the same as LIRA-309 allows a credit recharge from a low shop line (owner, 2026-10-13). Decided at planning, see research R6.
- **Price or cost would go below zero.** Refused before saving.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Phone Lines page MUST offer "Give credit back" on every unsold, not-written-off line for sale that has a carrier and more than $0 credit.
- **FR-002**: The cashier MUST enter the credit the buyer keeps, and MUST pick the receiving shop line from the active shop lines of the same carrier. The shop's primary line MUST be chosen by default.
- **FR-003**: The cashier MUST be able to set the credit selling price in LBP per $1. It MUST default to the shop's credit selling rate setting (Settings → Shop Config, 100,000 when unset) and MUST be editable for this give-back only.
- **FR-004**: The system MUST compute the transfer so that the sender pays the SMS fees ($0.16 per message, at most $3 per message) out of the amount leaving the line. The line MUST be left at exactly the amount kept, or at the nearest amount above it when no exact split exists.
- **FR-005**: The line's selling price MUST drop by (credit given back × credit selling price), converted to USD at the shop's current exchange rate. "Credit given back" is the line's credit before minus the credit after.
- **FR-006**: The line's cost MUST drop by (credit transferred to the shop line × the shop's credit cost rate per $1), converted to USD at the same exchange rate. The SMS fee therefore stays inside the line's cost; no separate expense is booked.
- **FR-007**: The chosen shop line's credit, and with it that carrier's drawer, MUST rise by exactly the credit transferred.
- **FR-008**: The line's recorded credit MUST fall to the computed remainder.
- **FR-009**: All of FR-005 to FR-008 MUST happen together as ONE transaction, or not at all. The transaction appears in the Transactions list as "Give credit back", with the line number and the carrier.
- **FR-010**: Voiding that transaction MUST restore the line's credit, price, cost and stock-batch cost, and the shop line's credit, to their exact values before the give-back. It MUST net every touched balance to zero per currency.
- **FR-011**: The void MUST be refused when the line has been sold since, or when a newer recharge or give-back exists on the line. Each refusal MUST explain what to do.
- **FR-012**: Before saving, the screen MUST show a preview: the transfer, the fee, the new credit, the new price, the new cost and the profit change. The saved figures MUST come from the same calculation the preview uses.
- **FR-013**: Admins and cashiers (staff) MUST be able to use the action, the same roles as Recharge on this page.
- **FR-014**: The action MUST work the same on the desktop app and the web app, with the same refusals.
- **FR-015**: The day stamped on the transaction MUST be the shop's own day, not the server's.

### Key Entities

- **Line for sale**: an inventory product in a lines category, plus its line details: carrier, credit and expiry. Price and cost live on the product; cost also lives on its open stock batch.
- **Shop line**: one of the shop's own SIM lines. Its credit makes up the carrier's drawer.
- **Give-back record**: one transaction that links the line, the shop line, the credit before and after, the amount transferred, the fee, the price change and the cost change. It holds everything needed to reverse the change exactly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier completes a give-back in under 1 minute from the Phone Lines page, with no edits on other pages.
- **SC-002**: For the worked example, all five "After" figures match the table to the cent.
- **SC-003**: A give-back followed by its void leaves the line, the shop line and the carrier drawer exactly as before: zero difference to the cent.
- **SC-004**: The same scenario run on the web app and the desktop app gives identical figures.

## Assumptions

- The exchange rate used is the shop's current USD/LBP selling rate, the same one Recharge on this page uses.
- The credit cost rate is the shop's existing "credit cost" setting in Shop Config (85,000 LBP per $1 when unset), the same rate LIRA-309's credit recharge uses. The worked example assumes 89,500 for round figures.
- Only MTC and Alfa lines are in scope, matching LIRA-309.
- A give-back changes the open stock batch cost in the same way a LIRA-309 recharge does, in the opposite direction.
- The physical SMS transfer is done by the cashier on the SIM; the system records it and does not send it.
- Out of scope: giving credit back after the line is sold, which is the customer's credit and uses the existing buy-back; giving back validity days.
