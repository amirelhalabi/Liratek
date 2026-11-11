# Feature Specification: Exchange as a customer-session basket item

**Feature Branch**: `380-exchange-basket-item` (work happens on `main`; ticket LIRA-380)

**Created**: 2026-11-11

**Status**: Draft

**Input**: Owner, 2026-11-11: "Exchange recorded in a customer session is directly appearing in the transaction table, although the customer session is not closed nor paid yet." Asked which behaviour: "The cash didn't really move when opening a customer session. This means that the customer wants this, this, this, etc. The cash should move only when we do the payment of the customer session."

## Today

Every other module (sales, recharges, OMT/Whish, loto, custom services, maintenance) adds a line to the basket. Nothing is booked and no drawer moves until the cashier checks the session out; the checkout replays each line and pays the whole basket once.

Exchange is the one exception (`FEATURE_GUIDE.md` §11, lira-094): on the Exchange page with a session open, Confirm books the exchange at once (drawer moves, lots consumed, profit stamped) and only *links* the finished transaction to the session. So:

- the exchange shows on the Transactions page immediately, with its own payment legs, while the rest of the basket is still open;
- the exchange's cash is not part of the basket's one payment: the cashier takes the customer's dollars at the exchange, then again collects the basket at checkout;
- "Refund item" is not offered on it (LIRA-381 covers refunds).

## Clarifications

### Session 2026-11-11 (owner decisions)

- Q: Hide the row until checkout, mark it "open session", or make it a basket line? → A: Basket line. The customer only *asks* for the exchange when it is added; the money moves at the basket's payment.

- Q: The session checkout rate is edited after the exchange was added; which rate books the exchange? → A: "The rate of the session should not affect the rate of the exchange transaction. We should see an exchange rate for the transaction item in the basket that doesn't change, which is not editable." The line shows its own rate (e.g. "@ 89,500"), read-only; the exchange books at that rate and those amounts. The checkout rate only converts the basket's own change and account maths, as today.

### Open questions (recommended answer first; the build follows it unless the owner overrules)

1. **Exchange-only options inside a basket.** The Exchange page has its own Discount line (LIRA-365), its own "on account" (LIRA-369), round-up and customer-adds-change (LIRA-334/336). → Recommended: inside a basket these are **hidden**, exactly as POS items hide theirs when added to a session (LIRA-334 US3 scenario 4). The basket's own Discount/Extra, account payment, round-up and added change apply to the whole basket.
2. **Old session-linked exchanges** (booked immediately, linked afterwards). → Recommended: untouched. They keep showing as today; the new behaviour applies to exchanges added from now on.
3. **For-partner exchange.** → Recommended: unchanged. It never enters a basket (every FOR_% form bypasses the session).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange waits in the basket like everything else (Priority: P1)

A customer opens a session, buys a $20 charger and asks to change $100 into lira at 89,500. The cashier adds both. Nothing is booked yet. At checkout the basket shows what the customer gives and what they get back; the cashier records one payment and the drawer moves once.

```
BEFORE (today)                              AFTER
Exchange page, session #12 open             Exchange page, session #12 open
  Confirm -> booked now                        Add to basket -> line only
  Drawer: +$100 / -8,950,000 LBP now           Drawer: unchanged
  Transactions: EXCHANGE row shows now         Transactions: nothing yet

Checkout #12                                Checkout #12
  Charge: $20 (charger)                        Charge: $20 + $100 = $120
  (exchange already paid separately)           Payout: 8,950,000 LBP
                                               Net: customer gives $120, gets 8,950,000 LBP
                                               Drawer: +$120 USD / -8,950,000 LBP, once
                                               Transactions: SALE + EXCHANGE under #12
```

**Why this priority**: It is the inconsistency the owner reported; every other module already works this way.

**Independent Test**: Start a session, add a sale and an exchange, check the Transactions page shows neither and the drawers are unchanged; check out with cash; check both rows appear under the session group with the basket's pooled legs, and the drawers moved by the net amounts once.

**Acceptance Scenarios**:

1. **Given** a session is open, **When** the cashier confirms an exchange on the Exchange page, **Then** a basket line "Exchange $100 → 8,950,000 LBP @ 89,500" is added (the rate shown, not editable), no transaction is written, no drawer moves, no lot is consumed, and the Exchange page returns to empty.
2. **Given** that line is in the basket, **When** the owner opens the Transactions page, **Then** no exchange row shows for it.
3. **Given** the basket holds the charger and the exchange, **When** the checkout opens, **Then** the customer side shows $120 to collect and 8,950,000 LBP to pay out, the payout going out as its own line of exactly 8,950,000 LBP (never netted against the charge at the checkout rate — see "Decisions taken unattended").
4. **Given** the cashier records the payment and confirms, **When** the checkout completes, **Then** one EXCHANGE transaction is booked with the line's own amounts and rate, linked to the session, with the basket's pooled legs (no legs of its own), its lots consumed at that moment, and its margin booked at that moment.
5. **Given** the cashier removes the exchange line before checkout, **When** the session is checked out, **Then** nothing about the exchange is booked anywhere.
6. **Given** the session is closed without checkout (cancelled), **When** the owner looks for the exchange, **Then** there is none.

---

### User Story 2 - Both directions and every currency pair (Priority: P1)

The customer may give lira and take dollars, or give dollars and take euros. The basket line carries whichever side the customer gives as a charge and whichever side they receive as a payout, in each side's own currency.

**Independent Test**: Add LBP→USD and USD→EUR exchanges to a session; check the checkout shows the right charge and payout buckets per currency, and the booked exchanges match the lines.

**Acceptance Scenarios**:

1. **Given** an LBP→USD exchange of 8,950,000 LBP, **When** it is in the basket, **Then** the charge is 8,950,000 LBP and the payout is $100.
2. **Given** a lot-tracked currency (EUR) is the side the customer receives, **When** the checkout books it, **Then** the lots are consumed then, FIFO, and the realised margin is the one stamped on the transaction and on the session line.
3. **Given** the basket's rate (edited at checkout) differs from the exchange's rate, **When** the checkout books it, **Then** the exchange amounts and margin are unchanged; only the basket's own conversions use the checkout rate.

---

### User Story 3 - Basket payment covers the exchange (Priority: P2)

The basket's one payment, account portion, change, kept change, round-up, discount and extra all apply to the exchange line like any other line. The exchange line keeps none of its own.

**Acceptance Scenarios**:

1. **Given** the basket is paid partly on account, **When** it is checked out, **Then** the exchange's share of the on-account portion is a member share of the one "Session Debt" row (LIRA-304), and its margin is held until repaid like other members.
2. **Given** the Exchange page is in session mode, **When** it renders, **Then** its own Discount, "on account", round-up and customer-adds-change controls are hidden, and the For-partner switch still bypasses the session.
3. **Given** the basket is voided or refunded as a whole after checkout, **When** the reversal runs, **Then** the exchange is reversed with its lots given back, together with the pooled legs, netting every ledger to 0.

---

### Edge Cases

- **Rate change between add and checkout.** The line keeps the agreed amounts. If the shop's rate moved, the exchange books at the agreed rate (that is the deal made with the customer).
- **Lot runs out between add and checkout.** Same as on the Exchange page today: a sale beyond the shop's lots is valued at the market rate (no refusal exists today); the realised margin is booked at checkout.
- **Exchange only, no other line.** A basket with one exchange checks out like any one-line basket: customer gives $100, gets 8,950,000 LBP, net handled by the existing payout netting.
- **Backdated session time (LIRA-335).** The exchange books at the basket's time like every other line.
- **Offline desktop.** A basket line recorded offline replays at checkout with the same amounts; no new offline path.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On the Exchange page with an active session (not For-partner), Confirm adds a basket line instead of booking: module `exchange`, the same payload the page sends today minus payment legs, discount, account, round-up and added-change fields.
- **FR-002**: The session checkout replays the exchange line through the existing exchange service with the basket's pooled payment deferred (same `deferPayment` mechanism as other modules), links it to the session with the customer-side amounts (given = positive, received = negative) and the booked margin, and never re-prices it with the checkout rate.
- **FR-003**: The basket's charge/payout split, netting, change, kept change, discount/extra, account share and whole-basket reversal treat the exchange line by the same rules as every other line, read through ONE shared rule for its two sides; the one exchange-specific point is that its payout is never netted against the charge at the checkout rate (owner: the session rate must not affect the exchange).
- **FR-004**: The Exchange page hides its own Discount, "on account", round-up and added-change controls in session mode.
- **FR-005**: Existing session-linked exchanges (booked before this change) are unchanged.
- **FR-006**: Both transports (desktop IPC and web REST) use one payload builder and one checkout path (rules 19, 22).
- **FR-007**: A release note and a What's new card with a real screenshot of the basket line (rule 30).

### Key Entities

- **Basket line (session_cart_items)**: `module = 'exchange'`, `ipc_channel = 'exchange:add-transaction'`, `form_data` = the exchange payload; `amount`/`currency` = the side the customer gives (or, when that side is not USD/LBP, the received side as a negative amount); the received side is read from `form_data` for the payout bucket.
- **customer_session_transactions**: the link written at checkout, `transaction_type = 'exchange'`, owed/covered shares like other members.

## Success Criteria *(mandatory)*

- **SC-001**: An exchange added to a session writes no row in `transactions`, `exchange_transactions`, `payments` or the lots until checkout (core test, failing first).
- **SC-002**: After checkout, Σ(drawer movements) for the basket equals the net of charges and payouts, posted once; the exchange row has no legs of its own and carries the pooled legs (core test).
- **SC-003**: Whole-basket refund of a basket containing an exchange nets to 0 on every ledger and gives the lots back (core test).
- **SC-004**: Web e2e: add sale + exchange to a session, check Transactions is empty for them, check out, check both rows in the group (`lira-web-0xx`).

## Assumptions

- The session checkout already supports per-currency payout legs and netting (`kind: "PAYOUT"`, `netCashPayoutAgainstCharge`); the exchange's received side reuses them.
- The exchange service already accepts a deferred-payment call (it does for the whole-basket path's reversal today; the forward path needs the same `deferPayment` the other modules take). If not, that is the first core task.

## Decisions taken unattended (2026-11-11 night)

- **Open questions 1–3**: the recommended answers are followed (exchange-only options hidden in a session; old linked exchanges untouched; For partner unchanged — it is already hidden while a session is open).
- **The exchange's payout is never netted against the basket charge** (FR-003 and scenario 1.3 were reworded to match; they first said "netted by the existing rule"): the existing netting converts across currencies at the checkout's editable rate, so it would let the session rate decide what the customer gets — the one thing the owner ruled out. The payout goes out as its own line of exactly the agreed amount; the drawer result is the spec's own figures (+$120 / −8,950,000 LBP). See research R1.
- **A side in a currency other than USD/LBP** (e.g. the euros in USD → EUR) is paid or taken by the exchange itself at checkout, as a cash line in General; only USD/LBP sides join the basket's one payment. The basket has no EUR column, and refusing euro exchanges during a session would block the cashier. Nothing still moves before checkout and lots are consumed at checkout (US2.2 holds). See research R2.
- **Lot runs out edge case reworded**: the spec said the checkout refuses as the Exchange page does, but the Exchange page does not refuse — it values a sale beyond the lots at the market rate. The basket follows the page.
- **In a session, Confirm adds the line without opening the payment window**: the window is where the exchange-only Discount, account, keep-change, round-up and added-change controls live, so hiding it hides all of them (FR-004). The loss warning for a lot sold below cost still shows first.

### Questions for the morning

- Should the exchange's payout be netted against the basket when it is in the SAME currency as a charge (e.g. LBP → USD exchange plus a $20 item: hand over $80 instead of taking $20 and handing $100)? The drawer ends the same either way; today the cashier records the two movements.
- Is the euro (non-USD/LBP) side being paid by the exchange itself at checkout acceptable, or should euro exchanges stay out of baskets?
- When the basket is settled on the customer's account, the checkout's payout method defaults to "Customer account" for every payout — including the exchange's lira, which would then go to store credit unless the cashier switches it to Cash. Should an exchange's payout always default to Cash?
