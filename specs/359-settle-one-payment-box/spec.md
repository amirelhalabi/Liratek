# Feature Specification: One payment box on Settle (pay dollars in lira and lira in dollars)

**Feature Branch**: `359-settle-one-payment-box` (work happens on `main`; ticket LIRA-359)

**Created**: 2026-10-29

**Status**: Draft

**Input**: Owner, 2026-10-29: "by default I want to allow settlements to pay USD in LBP, so by default we will have only one payment component, for example 'You pay RAWAD HMAIDI $8.00 + 700,000 LBP', with two rows in the payment, USD and LBP. The only edge case is settling with OMT, because we always give them USD and LBP exact amounts."

**Found on**: Cornertech, 2026-10-29. Rayan owed partner RAWAD HMAIDI $8 and paid everything in LBP. The partner settle sheet shows one payment box per currency and the dollar box takes only dollars, so he worked around it with a hand-added credit and an expense, which left the books wrong.

## Clarifications

### Session 2026-10-29 (owner decisions)

- First design (one payment box for both currencies, oldest-first across currencies, netting across currencies) was **dropped by the owner the same day** for a simpler one: "we can fix this simply by letting the user switch the currency".
- Q: What changes? → A: Each settle box keeps paying only its own currency's amount, but its currency list offers USD and LBP. A line in the other currency is converted at the box rate. The drawer moves in the currency actually paid.
- Q: Which sheets? → A: Partners and every calendar supplier (product suppliers, Katsh, Whish, Loto) except the OMT account, which keeps exact USD and LBP amounts.
- Q: A line in the other currency pays more than the box? → A: The extra stays as credit in the box's currency.
- Q: Rounding? → A: Converted amounts round to the cent (USD) and the whole lira (LBP); the difference (under 100 LBP) is ignored.
- Q: Anything else on the sheet? → A: One "Total" line under the boxes: what every box is paid, added up by the currency it is paid in ("Total $2,984.00 + 710,000 LBP").
- On the supplier sheet, where one box already settles both currencies: each currency is paid first by its own lines; what one currency's lines pay beyond its amount covers the other, converted at the box rate; leftover stays in its own currency.

## User Scenarios & Testing

### User Story 1 - Pay a dollar amount in lira (Priority: P1)

**Independent Test**: Partner owed $8 + 700,000 LBP on one day, rate 89,000. The $ box is paid 712,000 LBP cash, the LBP box 700,000 LBP. The partner shows $0 and 0 LBP; the drawer moved −1,412,000 LBP and $0. Voiding puts everything back.

### User Story 2 - Part-pay in the other currency (Priority: P1)

**Independent Test**: The $8 box paid 356,000 LBP pays $4.00; the rest stays open.

### User Story 3 - Total line (Priority: P2)

**Independent Test**: With the boxes above, the Total line reads "1,412,000 LBP".

### User Story 4 - OMT unchanged (Priority: P1)

**Independent Test**: An LBP line in the OMT $ box is refused by the server; OMT boxes offer only their own currency.

### Edge Cases

- An older app sends every line in its box's currency: unchanged.
- A line in the other currency without a rate is refused.
- Change handed back is converted at the box rate like any other line.

## Requirements

- **FR-001**: Partner and non-OMT supplier settle boxes MUST offer USD and LBP lines; a line in the other currency pays the box converted at the box rate.
- **FR-002**: Each ledger entry still closes in its own currency; only the drawer moves in the currency actually paid.
- **FR-003**: Extra paid in the other currency stays as credit in the box's currency.
- **FR-004**: Converted amounts round to the cent / whole lira.
- **FR-005**: The OMT account MUST keep each currency on its own; the server refuses a line in the other currency.
- **FR-006**: A line in the other currency without the rate MUST be refused.
- **FR-007**: A "Total" line under the boxes adds every box's lines by the currency paid in.
- **FR-008**: Voiding MUST put every drawer, ledger entry and credit back, per currency.
- **FR-009**: Release notes; a "What's new" card with a real screenshot (pending: e2e `lira-web-083` written, not yet run — another session's work in progress blocked the web server).

## Success Criteria

- **SC-001**: Rayan's case leaves the partner at $0 / 0 LBP and the drawer at −1,412,000 LBP / $0 with no hand-added entry; void nets to zero.
- **SC-002**: OMT settlements are unchanged.
