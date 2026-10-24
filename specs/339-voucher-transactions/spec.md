# Feature Specification: Voucher transactions (gift cards in the ledger)

**Feature Branch**: `main` (worked in place — ticket LIRA-339)
**Created**: 2026-10-24
**Status**: Draft
**Input**: "Vouchers (gift cards) get tracked in the unified transactions ledger: selling a voucher takes money through the normal payment legs and writes a transaction; cancelling an unredeemed voucher refunds the customer and writes a transaction; a Vouchers group in the Transactions Type filter shows voucher rows and rows paid with a voucher. Desktop and web."

## Context (as of 2026-10-24, verified by reading the code)

- Today a voucher is created on the Vouchers page with **no money taken**: no transaction row, no payment, no drawer movement. Cancelling only flips its status.
- Redeeming a voucher (the "Gift card" payment method) deposits its face value as credit on the owner's customer account, linked to the purchase it pays. That purchase already appears in Transactions. Refunding the purchase gives the voucher back.
- At **session checkout**, the redemption is linked to the basket, not to a single transaction. The basket's "Session Debt" account entry carries the session, so the basket already shows under the Debts filter. This feature changes nothing there. It also does not use that link for the new "paid with a voucher" tag (see FR-014).

## Clarifications

### Session 2026-10-24

All answers below were decided without asking the user. Each is marked as either an owner decision or a default.

- Q: Is a voucher sold for money? → A: Yes. The customer pays cash, wallet or a split through the normal payment form, the money lands in the drawers, and a transaction row is written. *(decided by owner 2026-10-24)*
- Q: Does a voucher sale earn profit? → A: No. Profit is 0, because the voucher is money owed to the customer. The later purchase it pays for carries the profit. The sale is not counted as revenue either. *(decided by owner 2026-10-24; "not revenue" is a default chosen (unverified) that follows from it)*
- Q: What does cancelling do? → A: Only an unredeemed voucher can be cancelled. Cancelling a **sold** voucher refunds the money it was sold for and writes a transaction. Expiry writes nothing. *(decided by owner 2026-10-24)*
- Q: How much does a cancel refund? → A: Exactly the face value the voucher was sold for, in the voucher's currency, paid out through the payment methods the operator picks. Vouchers created before this feature (no sale was ever recorded) are cancelled with **no refund** and a zero-amount "Voucher cancelled" row. *(decided by owner 2026-10-24)*
- Q: Can an expired, unredeemed sold voucher be cancelled and refunded? → A: Yes, by an admin, for the full face value. Whether a voucher counts as expired uses the shop's own day. *(decided by owner 2026-10-24)*
- Q: Which payment methods can buy a voucher? → A: Cash, wallets **and the customer's account** (buying on credit adds to the voucher owner's debt), in any split, with change given back. "Gift card" is refused. *(decided by owner 2026-10-24 — changed from the earlier drawer-only default)*
- Q: What does cancelling an on-account voucher do? → A: The refund follows what the sale took in, **leg by leg**. The part put on the account is taken off the account (its debt is cancelled, with no cash paid). Only the part paid in cash or wallets is paid back through the payout methods. If the customer already repaid some or all of that debt, the account still drops by the full on-account amount, so what they repaid becomes credit on their account. That credit can be cashed out from the Accounts page as usual. *(the leg-by-leg rule was decided by owner 2026-10-24; the partly-repaid rule was confirmed by owner 2026-10-24; it matches how every other refund of an on-account charge works today)*
- Q: Does an on-account voucher sale show under the Debts filter? → A: Yes. The "Voucher sold" row is linked to the customer's account, so it shows under the Debts options as well as under Vouchers. That is intended. *(decided by owner 2026-10-24)*
- Q: Which methods can the cash part of a refund be paid with? → A: Drawer methods only (the payout picker). The account part never becomes cash at cancel; it goes back to the account. *(default chosen (unverified))*
- Q: Can the sale or the cancel be voided from the Transactions page? → A: No. The Vouchers page owns the voucher's money. The sale is undone by cancelling the voucher. A cancel is final. The Transactions page shows the reason. *(default chosen (unverified); same model as Hold Money)*
- Q: Who is the customer on the sale row? → A: The voucher's owner, which is the client already required by the form. *(default chosen (unverified))*
- Q: Should the Vouchers filter also show purchases paid with a voucher? → A: Yes. Each Vouchers option also matches transactions paid with a gift card, the same way the Debts and wallet options do. *(decided by owner 2026-10-24, recommendation accepted)*
- Q: Are vouchers sold before this change back-filled? → A: No. They have no sale row, and a cancel refunds nothing (see above). *(default chosen (unverified))*
- Q: Can the shop keep the change or round up an overpay on a voucher sale or refund? → A: No. Change is given back in full; the voucher form does not offer kept change, round-up or "customer adds change". *(default chosen (unverified))*
- Q: Can a voucher be sold inside a customer session basket? → A: No. A voucher is sold only from the Vouchers page. *(default chosen (unverified))*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sell a voucher and take the money (Priority: P1)

A cashier sells a $50 gift card to a client. They pay through the usual payment form (cash, a wallet, or a split, with change given back). The drawer goes up by what was paid, and Transactions shows a "Voucher sold" row for that client.

**Why this priority**: Today the cash a shop takes for a gift card is not recorded anywhere. That breaks the drawer count and leaves no trail.

**Independent Test**: Sell a $50 voucher paid $60 cash with $10 change. The General USD drawer goes up by exactly $50. One "Voucher sold" row of $50 appears with the client's name and profit 0.

**Acceptance Scenarios**:

1. **Given** a client and a $50 USD voucher, **When** it is paid $50 cash, **Then** the drawer rises $50 and a "Voucher sold" row of $50 is shown with the client.
2. **Given** a $50 USD voucher, **When** it is paid in LBP at the shop's rate, or split cash plus wallet, **Then** each drawer moves by its leg and the legs add up to $50.
3. **Given** legs that do not add up to the face value, **When** the cashier saves, **Then** nothing is saved and an error explains why.
4. **Given** a "Gift card" leg, **When** the cashier saves, **Then** it is refused.
5. **Given** a client with a name and phone, **When** a $50 voucher is paid $20 cash plus $30 on the customer's account, **Then** the drawer rises $20, the client's debt rises $30, and the "Voucher sold" row shows under both the Vouchers and the Debts filters.

---

### User Story 2 - Cancel an unredeemed voucher and refund the customer (Priority: P1)

An admin cancels a sold voucher that was never used. They choose how to pay the money back, and the drawer goes down by the refund. Transactions shows a "Voucher cancelled" row.

**Why this priority**: Without it, the money taken in US1 can only leave the drawer off the books.

**Independent Test**: Sell a voucher for $50, then cancel it with a cash refund. The drawer change across both steps is 0 in each currency. Two rows exist: sold $50 and cancelled $50.

**Acceptance Scenarios**:

1. **Given** a sold, unredeemed voucher, **When** an admin cancels it with a cash refund, **Then** the voucher is cancelled, the drawer drops by its face value, and a "Voucher cancelled" row is shown.
2. **Given** a redeemed voucher, **When** cancel is attempted, **Then** it is refused.
3. **Given** a $50 voucher sold $20 cash plus $30 on account, **When** an admin cancels it, **Then** the client's debt drops $30 with no cash, $20 is paid out from the drawer, and both the drawers and the account net to 0 across the sale and the cancel.
4. **Given** that voucher's $30 debt was already repaid, **When** it is cancelled, **Then** the account drops $30 anyway, so the customer now has $30 of credit.
5. **Given** a voucher created before this feature, **When** it is cancelled, **Then** no money moves and a zero-amount "Voucher cancelled" row is written.
6. **Given** two cancels of the same voucher at the same time, **When** both are sent, **Then** only one refund is paid.
7. **Given** a "Voucher sold" or "Voucher cancelled" row on the Transactions page, **When** void or refund is attempted, **Then** it is refused and the message points to the Vouchers page.

---

### User Story 3 - Find voucher activity in Transactions (Priority: P2)

The owner opens the Transactions Type filter and picks the new "Vouchers" group. They see voucher sales and cancels, plus every purchase paid with a gift card.

**Independent Test**: Sell a voucher, then redeem it on a POS sale. Filter on "Voucher sold": both the sale row and the POS sale show. An unrelated cash sale does not show.

**Acceptance Scenarios**:

1. **Given** voucher rows and gift-card-paid purchases, **When** a Vouchers option is selected, **Then** both kinds show, and nothing else.
2. **Given** a basket checked out with a gift card from now on, **When** the filter is applied, **Then** the basket's rows show too.

### Edge Cases

- An LBP voucher paid in USD: the legs are reconciled at the shop's rate, as on every other form.
- An expired, unredeemed sold voucher: an admin can still refund it. Expiry on its own writes nothing.
- A purchase paid with a voucher is later refunded: the voucher comes back as today. That purchase may then stop showing under the Vouchers filter, because its gift-card link is cleared. This is accepted.
- Gift-card redemptions at session checkout that happened before this change cannot be detected for the tag.
- **Known open gap (out of scope)**: refunding a whole session basket does not give back a voucher redeemed in it, because basket redemptions are not linked to a transaction. This gap existed before this change, but it now involves real cash. It is tracked as a rule-20 follow-up, not fixed here; clearing the new session link on refund does not fix it.
- If a payment leg fails part-way, nothing is saved: the voucher, the row and the legs are written together or not at all.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Selling a voucher MUST take payment through the shop's standard payment form (drawer methods, split, change given back) and MUST be refused unless the legs reconcile to the face value in the voucher's currency at the shop's rate.
- **FR-002**: Selling a voucher MUST write one "Voucher sold" transaction (money in) with the voucher's owner as the client and profit 0, and MUST move each drawer by its leg.
- **FR-003**: The voucher, its transaction and its payments MUST be saved all together or not at all.
- **FR-004**: Gift-card legs MUST be refused when selling a voucher. Customer-account legs MUST be accepted when selling (only when the owner has a name and phone, the same gate as every other form) and MUST add the on-account part to the owner's debt, linked to the "Voucher sold" transaction. The cash part of a refund MUST use drawer methods only.
- **FR-005**: Only an admin MUST be able to cancel. Only a voucher that is not redeemed and not already cancelled can be cancelled.
- **FR-006**: Cancelling a sold voucher MUST refund what the sale took in, leg by leg. The on-account part MUST be taken off the owner's account in full (no cash), whether or not it was repaid. The cash/wallet part MUST be paid back through the payout methods the operator picks. Cancelling MUST write one "Voucher cancelled" transaction (money out, profit 0) and MUST move each drawer by its payout leg.
- **FR-007**: Cancelling a voucher with no recorded sale MUST move no money and MUST write a zero-amount "Voucher cancelled" row.
- **FR-008**: A voucher MUST NOT be refunded twice, even when two cancels arrive at once.
- **FR-009**: "Voucher sold" and "Voucher cancelled" rows MUST NOT be voidable or refundable from the Transactions page. The refusal message MUST say to use the Vouchers page.
- **FR-010**: Voucher sales and cancels MUST NOT count as revenue or profit on the Profits page.
- **FR-011**: Expiry MUST NOT write any transaction.
- **FR-012**: The Transactions page MUST show the right label and in/out arrow for both new rows.
- **FR-013**: The Transactions Type filter MUST have a "Vouchers" group with options "Voucher sold" and "Voucher cancelled".
- **FR-014**: Each Vouchers option MUST also match transactions paid with a gift card. That covers single transactions now and in the past, and session baskets from now on.
- **FR-015**: Everything above MUST behave the same in the desktop app and the web app.
- **FR-016**: The shop's own day MUST decide whether a voucher counts as expired when it is cancelled.
- **FR-017**: The on-account part of a voucher sale MUST be counted by customer repayments like any other on-account charge. A sell-then-cancel pair MUST leave the owner's account unchanged in every currency.

### Key Entities

- **Voucher**: code, owner, face value and currency, expiry, status. New: the session where it was redeemed.
- **Voucher sold** transaction: money in, linked to the voucher, client is the owner, profit 0. When part was put on the account, it also has a "Voucher Debt" entry on the owner's account.
- **Voucher cancelled** transaction: money out (or zero for older vouchers), linked to the voucher, profit 0.

## Success Criteria *(mandatory)*

- **SC-001**: For every sell-then-cancel pair refunded by the same method and currency it was paid with, each drawer's net change AND the owner's account balance change are exactly 0 in every currency. When the refund uses a different method or currency, the total across all drawers is 0 in US-dollar value at the rates stamped on the two rows.
- **SC-002**: Every voucher sold from now on has exactly one "Voucher sold" row, and its drawer movement equals its face value.
- **SC-003**: Profits totals do not change at all when vouchers are sold or cancelled.
- **SC-004**: A cancel of a voucher created before this feature pays out $0 in 100% of cases.
- **SC-005**: Both the desktop app and the web app pass the same sell, cancel and filter scenarios.

## Assumptions

- The voucher's owner is the buyer.
- The admin-only cancel rule stays as it is today.
- The existing payment form and payout picker are reused. No new money control is designed.
