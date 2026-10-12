# Feature Specification: Waive on every payment page

**Feature Branch**: `310-waive-everywhere` (ticket LIRA-310; work happens on `main`)

**Created**: 2026-10-11

**Status**: Draft

**Input**: Owner request 2026-10-11: "set the waive button in all the pages", plus the owner's answers to the three follow-up questions (below).

## Background

POS checkout already has a **Waive** button next to "Remaining (Debt)". When the customer is a little short, one tap adds the gap to the sale discount, so the sale closes at the amount actually paid. Today it shows only for gaps under $1, and only on POS (and Maintenance, which reuses the POS checkout).

The other payment pages have no Waive button. A cashier who is a few dollars short must either type a discount by hand, put the gap on the customer's account, or cannot finish at all.

## Owner decisions (2026-10-11, binding)

1. **Every payment page.** Both groups ship together: the pages that only need a screen change (Group A) and the pages that need a new saved record (Group B).
2. **Limit: $5 or 450,000 LBP.** Waive shows only when the gap is at most $5 on a USD-priced total, or at most 450,000 LBP on an LBP-priced total. The limit is the same on every page and is checked again when the payment is saved, not only on the screen.
3. **Never below cost.** Where the discount already has a ceiling (recharge discount up to the shop's profit, partner discount up to the balance, maintenance discount up to the labour), Waive is **hidden** when the current discount plus the gap would go over that ceiling.
4. **Automatic kept change follows the same limit.** On payout pages (the shop hands money out), the shop already keeps a small shortfall automatically. That limit rises from $1 / 100,000 LBP to $5 / 450,000 LBP.
5. **The unsaved Discount field gets fixed.** Loto ticket sales and Custom Services show a Discount field whose value is never saved. It must be saved for real:
   - Loto: the discount comes out of the shop's commission. LOTO is still owed the full sale minus commission.
   - Custom Services: the discount lowers the selling price, and so the profit.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Waive a small gap on pages that already have a discount (Priority: P1)

A cashier sells a $16.50 Alfa card. The customer hands over $16. The page shows "Remaining $0.50" with a Waive button. One tap moves the $0.50 into the discount, Remaining reads $0.00, and the sale saves with $1.00 profit instead of $1.50.

The same works on every page that already has a discount: all recharge forms (Telecom, card grid, Katsh, Crypto, Financial, OMT/Whish App transfer), Debts repayment (into Discount/Forgive), Partners settle, Suppliers Pay, POS and Maintenance.

**Why this priority**: It covers the pages cashiers use most, and nothing new is saved: the discount these pages already save is used.

**Independent Test**: On any Group A page, leave a gap under the limit and tap Waive. The discount goes up by exactly the gap, Remaining goes to zero, and the saved transaction shows the discount and the lower profit.

**Acceptance Scenarios**:

1. **Given** a $16.50 card sale with $1.50 profit and $16 paid, **When** the cashier taps Waive, **Then** the discount becomes $0.50, Remaining becomes $0.00, and the saved profit is $1.00.
2. **Given** a card sale with $0.30 profit and $0.50 short, **When** the page shows Remaining, **Then** no Waive button appears, because $0.50 is more than the $0.30 discount ceiling.
3. **Given** a Debts repayment of $40.00 due, $38.00 paid, **When** the cashier taps Waive, **Then** Discount/Forgive shows $2.00 and the client's debt closes at zero after saving.
4. **Given** a POS sale $6.00 short, **When** the page shows Remaining, **Then** no Waive button appears, because $6.00 is over the $5 limit.
5. **Given** an LBP-priced sale 450,000 LBP short, **When** the page shows Remaining, **Then** Waive appears. At 450,001 LBP it does not.
6. **Given** a Maintenance job where the labour is $10 and the cashier has already typed an $8 discount, **When** the customer is $3 short, **Then** no Waive button appears, because $11 is over the $10 labour ceiling.

---

### User Story 2 - Waive on pages with no discount today: customer pays the shop (Priority: P1)

A cashier sells a Loto ticket for 500,000 LBP or closes a customer basket in Session checkout. The customer is a little short. Today the cashier cannot finish without putting the gap on the customer's account. With Waive, the shop absorbs the gap. It comes off the shop's profit on that transaction, and what the shop owes LOTO stays exactly the same.

**Why this priority**: These are everyday customer sales where being refused today strands the cashier with a customer waiting.

**Independent Test**: On each of these two pages, leave a gap under the limit, tap Waive, and save. The transaction saves. Its profit is lower by exactly the gap, per currency. The amount owed to LOTO is unchanged. Voiding or refunding the transaction afterwards brings profit, drawers and every ledger back to exactly where they were.

**Acceptance Scenarios**:

1. **Given** a Loto ticket of 500,000 LBP with 25,000 LBP commission, and 480,000 LBP paid, **When** the cashier taps Waive and saves, **Then** the ticket's profit is 5,000 LBP and LOTO is still owed 475,000 LBP.
2. **Given** a Loto ticket whose commission is 25,000 LBP, **When** the gap is 30,000 LBP, **Then** Waive is hidden, because it would go below cost.
3. **Given** a customer basket with three items, $3 short, **When** the cashier taps Waive and checks out, **Then** the basket saves and the shop's profit for the basket is $3 lower in total.
4. **Given** a saved waived transaction, **When** it is voided or refunded, **Then** drawers, profit and every ledger net to zero per currency.
5. **Given** a payment request whose waived amount differs from the real gap, or is over the limit, **When** it reaches the shop's server, **Then** it is refused with a plain message and nothing is saved.

---

### User Story 3 - Waive on settlements: the shop and a supplier or LOTO square up (Priority: P2)

The owner settles with OMT's open-credit account, settles a batch of supplier transactions, or settles with LOTO. The amounts differ by a few dollars. Today these settlements refuse anything but the exact amount. With Waive, the gap is recorded as a discount between the two sides, and the settlement closes:

- If the shop pays less, the supplier gave the shop a discount, and profit goes up by the gap.
- If the supplier or LOTO pays the shop less, the shop gave the discount, and profit goes down by the gap.

**Why this priority**: Settlements happen less often than sales, and the owner does them, not the cashier.

**Independent Test**: Settle with a gap under the limit and tap Waive. The settlement closes and the supplier or LOTO balance goes to zero. A discount line is recorded with the correct sign. Undoing the settlement, where undo is allowed, also removes the discount.

**Acceptance Scenarios**:

1. **Given** a supplier batch where the shop owes $503 and pays $500, **When** the owner taps Waive and settles, **Then** the batch is marked settled and a $3 "discount received" is recorded.
2. **Given** a LOTO settlement where LOTO owes the shop 1,200,000 LBP and pays 1,000,000 LBP, **When** the owner taps Waive, **Then** a 200,000 LBP "discount given" is recorded and the shop's profit drops by 200,000 LBP.
3. **Given** a waived supplier settlement that is later undone, **When** the undo completes, **Then** the bundled discount is removed as well, and the supplier balance and profit return to what they were before.
4. **Given** a waived LOTO settlement, **Then** it cannot be undone, the same as every LOTO settlement today.

---

### User Story 4 - Pages where the shop pays out keep the gap automatically, up to the new limit (Priority: P2)

On Exchange, OMT/Whish receive, Hold money pickup, Whish top-up from a client, Debts cash-out and refunds, the shop hands money out. When the shop hands out a round figure a little under what is owed, the leftover is already kept as profit automatically, with a green note saying so. That now works up to $5 / 450,000 LBP instead of $1 / 100,000 LBP. These pages get no Waive button.

**Independent Test**: On an OMT receive of $104.50, hand out $100. The green note shows "Keeping $4.50 as profit", the payout saves, and profit is $4.50 higher. With $105.50 owed and $100 handed out, the payout is refused as short.

**Acceptance Scenarios**:

1. **Given** a USD payout $4.50 short, **Then** the shortfall is kept as profit and the payout saves.
2. **Given** a USD payout $5.50 short, **Then** the payout is refused as short.

---

### User Story 5 - Loto and Custom Services Discount fields are saved (Priority: P2)

On a Loto ticket sale or a Custom Services sale, the cashier types a discount. Today the field changes the screen but is never saved, so the payment comes out short. Now the discount is saved:

- Loto: it comes out of the shop's commission, up to the commission.
- Custom Services: it lowers the selling price.

**Acceptance Scenarios**:

1. **Given** a Custom Services sale priced $30 with a $2 discount and $28 paid, **When** saved, **Then** the sale saves at $28 and profit is $2 lower.
2. **Given** a Loto ticket with 25,000 LBP commission, **When** the cashier types a 30,000 LBP discount, **Then** the discount is capped at 25,000 LBP.

---

### User Story 6 - Expenses: the vendor accepted less (Priority: P3)

The owner pays a $52 bill and hands over $50, and the vendor accepts it. One tap on Waive records the expense at $50.

**Acceptance Scenarios**:

1. **Given** a $52 expense with $50 handed, **When** the owner taps Waive and saves, **Then** the expense is recorded as $50.

### Edge Cases

- **Gap exactly at the limit**: $5.00 (USD total) or 450,000 LBP (LBP total) shows Waive; one cent or one LBP more does not.
- **Mixed-currency totals** (e.g. maintenance with USD parts on an LBP job): the limit is checked in the total's own currency.
- **Split payment**: Waive uses the gap after every payment line, and recalculates when a line changes.
- **Tap twice**: after one tap the gap is zero and Waive disappears, so a second tap is impossible.
- **Cashier then types a bigger amount**: Remaining turns into change as normal. The waived discount stays unless the cashier clears it.
- **Debts repayment with ticked items** (LIRA-308): adding the waive to Discount/Forgive refills the amount to the ticked sum minus the discount, as it does for a typed discount.
- **Customer account on the payment**: a Waive is never paid from the customer's account or a gift card. It only lowers what is due.
- **Waive follows Remaining** (owner, 2026-10-11): Waive sits in the Remaining row. Whenever Remaining is hidden, Waive is hidden too, including when the gap is put on a known client's account automatically.
- **Overpaid** (Remaining negative): no Waive. Change handling is unchanged.
- **Gap not under the limit but under the discount ceiling**: Waive stays hidden. The cashier may still type a discount by hand as today.
- **Transfer through a partner (For-Partner OMT/Whish)**: no Waive. The partner's amount must be exact, the same rule that already refuses kept change there.
- **Offline desktop**: a waive recorded while offline replays later exactly as it was saved.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST show a Waive button next to the Remaining figure on every customer-pays and settlement payment page listed in the Acceptance matrix, whenever the gap is greater than zero and at most the limit.
- **FR-002**: The limit MUST be one shared value, $5 for a USD-priced total and 450,000 LBP for an LBP-priced total, compared in the total's own currency. The screen and the server MUST use the same value.
- **FR-003**: Where the page's discount has a ceiling, Waive MUST be hidden when the current discount plus the gap would exceed it.
- **FR-004**: Tapping Waive MUST make Remaining exactly zero, with no rounding leftover, in the page's currency.
- **FR-005**: On Group A pages, Waive MUST add the gap to the page's existing discount, or lower the bill or price where that is the page's meaning (Custom Services, Expenses). Nothing new is saved.
- **FR-006**: On the customer-pays Group B pages (Loto ticket, Session checkout), the waived amount MUST be saved with the transaction. It MUST lower the shop's profit on that transaction by exactly the waived amount, per currency. It MUST NOT change what is owed to LOTO, a partner or a supplier.
- **FR-007**: On the settlement Group B pages (Supplier account settle, Supplier batch settle, LOTO settlement), the waived amount MUST be recorded as a discount between the shop and the counterparty, bundled with the settlement:
  - "received" (profit up) when the shop pays less;
  - "given" (profit down) when the counterparty pays less.
- **FR-008**: The server MUST refuse a waive that does not equal the real gap, that exceeds the limit, or that exceeds the discount ceiling. The refusal MUST have a plain message, and nothing may be saved.
- **FR-009**: Voiding or refunding a waived transaction MUST return drawers, profit and every ledger to their earlier values, per currency. A bundled settlement discount MUST be undone by its settlement's undo. LOTO settlements stay not undoable.
- **FR-010**: The automatic kept change on payout pages MUST use the new limit ($5 / 450,000 LBP), on screen and on the server. Payout pages MUST NOT show a Waive button.
- **FR-011**: Loto ticket and Custom Services Discount fields MUST be saved:
  - Loto: capped at the commission, lowers profit.
  - Custom Services: lowers the selling price and profit.
- **FR-012**: Every change MUST work the same in the desktop app and the web app, including desktop actions replayed after being offline.
- **FR-013**: Hold money drop-off and OMT system / Whish system transfers (the Services page, send and receive) MUST NOT show Waive. This does not cover OMT App / Whish App transfers, which are in Group A.
- **FR-014**: A transfer done for or through a partner MUST NOT offer Waive. The server MUST refuse a waive on it.

### Acceptance matrix

| Page                                                                                             | Who pays                  | Waive does                                                           | Group |
| ------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------- | ----- |
| POS checkout                                                                                     | customer → shop           | adds to sale discount (existing) + ceiling check                     | A     |
| Maintenance                                                                                      | customer → shop           | adds to discount (existing) + labour ceiling check                   | A     |
| Recharge: Telecom, card grid, Katsh, Crypto, Financial, OMT/Whish App                            | customer → shop           | adds to discount, ceiling = shop profit                              | A     |
| Debts repayment                                                                                  | customer → shop           | adds to Discount/Forgive                                             | A     |
| Partners settle                                                                                  | partner → shop            | adds to capped discount                                              | A     |
| Suppliers Pay                                                                                    | shop → supplier           | adds to discount (Pay only)                                          | A     |
| Custom Services                                                                                  | customer → shop           | lowers selling price                                                 | A     |
| Expenses                                                                                         | shop → vendor             | lowers bill to amount handed                                         | A     |
| Loto ticket                                                                                      | customer → shop           | saved waive/discount, lowers commission profit                       | B     |
| Session checkout                                                                                 | customer → shop           | saved waive, lowers basket profit                                    | B     |
| Supplier account settle                                                                          | shop ↔ OMT account        | bundled discount received / given                                    | B     |
| Supplier batch settle                                                                            | shop → supplier           | bundled discount received                                            | B     |
| LOTO settlement                                                                                  | shop ↔ LOTO               | bundled discount received / given                                    | B     |
| Exchange, OMT/Whish RECEIVE, Hold money pickup, Whish top-up from client, Debts cash-out, Refund | shop → customer           | no button; automatic kept change up to new limit                     | C     |
| Hold money drop-off                                                                              | customer → shop (deposit) | no button                                                            | —     |
| OMT system / Whish system SEND (Services page)                                                   | customer → shop           | no button — system transactions are never waived (owner, 2026-10-11) | —     |

### Key Entities

- **Waive limit**: one value per currency (USD 5, LBP 450,000). It is shared by the Waive button and by automatic kept change.
- **Waived amount** (on a customer sale): the gap the shop absorbs, per currency, saved with the transaction. It reduces that transaction's profit.
- **Settlement discount**: an existing kind of record between the shop and a supplier, partner or LOTO, signed "received" or "given". Here it is bundled with a settlement and undone with it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On each of the 18 customer-pays and settlement pages in the matrix (Group A: 13, counting the six recharge forms separately; Group B: 5), a gap up to the limit can be closed in one tap, with no typing.
- **SC-002**: For every Group B flow, creating then voiding a waived transaction leaves every drawer, every ledger and profit exactly unchanged, per currency.
- **SC-003**: No saved transaction ever records a waive above $5 / 450,000 LBP, or one that does not match the real gap, whatever the screen sends.
- **SC-004**: The amount owed to LOTO, OMT, Whish, partners and suppliers is identical with or without a customer-side waive.
- **SC-005**: Every page behaves the same in the desktop app and the web app.

## Assumptions

- Waive on a session basket lowers the basket's total profit once, not item by item. Reports show it as part of that checkout.
- OMT system / Whish system transfers get no Waive (owner, 2026-10-11). Their RECEIVE side still gets the higher automatic kept-change limit, as every payout does (decision 4).
- "At most the limit" includes the limit itself ($5.00 exactly shows Waive), confirmed by the owner 2026-10-11. The same "up to and including" applies to automatic kept change. Today's $1 rule uses "under".
- Euro-priced totals get no Waive, the same as automatic kept change today.
- Suppliers Receive stays without a discount, because the server already refuses one there. The owner did not ask to change that.
- Debts cash-out and refunds are payouts and use automatic kept change, not a button.

## As built (2026-10-11) — differences from the plan above

These were decided during the build and are what the code and tests do:

- **Customer-side cap** (Loto ticket, Session basket) is checked by the server in USD-equivalent at the cashier's rate, with each currency also under its own cap. A split claim therefore cannot double the allowance. The screen still compares in the total's own currency, and guard tests prove the two agree at the limit: exactly 450,000 LBP is accepted at rates 89,000–100,000, and exactly $5.00 is accepted.
- **Loto ticket discount is LBP only.** A USD discount is refused, because the Profits page cannot tell it apart from kept change. A typed Loto discount may come with change given back; a session Waive may not.
- **Session waive in Profits** (owner decision 2026-10-12, replacing the first build that netted it into Kept Change): a `WAIVED_SHORTFALL` row is its own "Waived" line — an Overview card, a "Waived" row in By Module with its own drill-down ("Waived at basket checkout"). "Kept Change" shows only kept change. Totals are unchanged (example: Sales $120, Kept Change $2, Waived −$3, Total $119); By Date, By Cashier and By Client show only totals, so they include it as before. Refunding a single item from a waived basket is refused; voiding or refunding the whole basket works.
- **Settlement waive** must be less than what is owed, per currency, so some cash always moves.
  - **Account settle**: the waive lands on the account member the settlement is anchored to. If it is bigger than that member's share, the server refuses it.
  - **LOTO settle**: a waive sent with no payment lines is refused.
  - **Settlement rows**: the `SUPPLIER_SETTLEMENT` / `LOTO_SETTLEMENT` row records the cash actually paid; the full amount stays in metadata (and in `loto_settlements.net_settlement`).
- **Debts — Waive covers only the ticked items** (owner decision 2026-10-12, after the build; replaces the first build, where Waive followed the whole-debt Remaining and so also forgave unticked items). When the item picker is shown, the gap Waive closes is measured against the ticked items' sum minus the discount (the same figure the amount fills to), passed to the payment input as `waiveTotals`. That gap gets its own "Remaining on ticked" line with Waive inside it; the "Remaining (Debt)" row keeps the whole-debt figure without a Waive. When the cashier has ticked everything, the two gaps are equal and there is one row, with Waive, as before. "Ticked" means the cashier's own ticks: items the amount ticks by itself (an amount above the ticked sum) do not count, so once the amount is above the cashier-ticked sum there is no Waive even if the whole remainder is under $5 (open owner question: should those auto-ticked items count?). Same $5 / 450,000 LBP cap, never on a cash-out. Example: $14 sale unticked + $20 Loto ticket ticked, $18.50 paid → Remaining on ticked $1.50 [Waive] → Discount / Forgive $1.50 → the Loto ticket ends at $0, the $14 sale stays owed, balance $14. The server needs no change: the bundled discount already walks the same ticked targets after the cash (LIRA-308 decision 8). It stays on the ticked items as long as it is no bigger than what the cash left open on them, which a Waive-sized discount is by construction; a discount typed by hand above that still spills onto unticked items (unchanged behaviour). A client with no itemised debt (no picker) keeps the whole-debt Waive. Tests: `MultiPaymentInput.waive.test.tsx` (waiveTotals), `Debts.lira310WaiveTicked.test.tsx`, `DebtRepository.lira308.test.ts` (owner example, characterization).
- **No Waive on the Suppliers page** (owner decision 2026-10-12, after the build). The OMT account settle sheet, the supplier batch settle and the Pay / Receive tab show no Waive button (`waiveDisabled` on their payment input). This replaces the Suppliers Pay row of the page table and the supplier half of User Story 3 / FR-007. The owner records a gap by typing it into the Pay tab's Discount field by hand, as before LIRA-310. The server is unchanged: batch and account settle still accept a bundled `discount` and void/refund still sweeps it, but the Suppliers screens never send one. The LOTO settlement (on the Loto page) keeps Waive.
- **Waive only on money IN** (owner rule 2026-10-12, binding, after the build): "Waive only when money comes IN to the shop and the payer hands over a little less than the total (up to $5 / 450,000 LBP, same cap for USD and LBP). Overpaying is never a waive — it is change or customer credit." Two screens changed to comply; every other page already did:
  - **Expenses: no Waive.** An expense is the shop paying a vendor (money OUT). The earlier "Waive lowers the bill to what was handed" (User Story 6) is removed; the payment input gets `waiveDisabled`. The cashier enters the bill at what was actually paid. Guards: `Expenses.lira310Waive.test.tsx`, `lira-web-057` Expenses test.
  - **LOTO settlement: Waive only when LOTO pays the shop** (net > 0). When the shop pays LOTO (net < 0) the dialog passes `waiveDisabled`, ignores any earlier waive, and never sends `discount_lbp`; the underpaid gate still blocks a short payment. The server still accepts `discount_lbp` in both directions (unchanged). Guard: `SettlementVerification.lira310Waive.test.tsx`.
