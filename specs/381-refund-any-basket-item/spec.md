# Feature Specification: Refund any item of a customer-session basket

**Feature Branch**: `381-refund-any-basket-item` (work happens on `main`; ticket LIRA-381)

**Created**: 2026-11-11

**Status**: Draft

**Input**: Owner, 2026-11-11: "We should enable refunding an item from a customer session (currently unable to do so)." Asked which case: "What I'm sure of is the loto, but we need to be able to refund any item from session."

## Today

"Refund item" on a checked-out basket (LIRA-232) works for **sold items only**: products (sale lines), custom services and recharges (`SESSION_ITEM_REFUNDABLE_TYPES`). It reduces the customer's account first, then hands back the remainder through the refund window. Everything else is refused with "… cannot be refunded on its own from a session basket — only sold items (products, services, recharges) can be":

| Basket member                                         | Refund item today |
| ----------------------------------------------------- | ----------------- |
| Product, custom service, recharge                     | Yes               |
| Loto ticket                                           | No                |
| Loto cash prize (payout)                              | No                |
| OMT / Whish / iPick / Katsh send (charge)             | No                |
| OMT / Whish / Binance receive (payout)                | No                |
| Exchange (linked today; a basket line after LIRA-380) | No                |
| Maintenance job                                       | No                |
| Custom service booked as a payout                     | No                |

A second rule hides the button on **every** item of a basket that contains a netted payout (a loto prize, a Binance cash-out, a custom-service payout): the whole basket must be refunded instead (`_assertNoNettedPayoutMembers`, LIRA-232 decision 10).

The owner's case: a customer bought a loto ticket in a basket with other things and wants that ticket refunded. Both rules block it.

## Clarifications

### Session 2026-11-11 (owner decisions)

- Q: Which members? → A: Any item of a checked-out basket can be refunded on its own. Loto for sure.
- Q: A payout member (prize, cash-out, receive) — the customer gives the money back; how is it recorded? → A: The cashier chooses among the normal payment methods: cash, the customer's account, OMT wallet, Whish wallet — whatever payment methods the shop has. Account-first does not apply: nothing is owed to the customer here.

### Open questions (recommended answer first; the build follows it unless the owner overrules)

2. **Basket that contained a payout, refunding a sold item.** Today refused (decision 10) because the basket's cash was netted. → Recommended: allowed. The customer gets the item's own amount back. The "never hand back more than the basket received" cap is measured against the basket's **gross charge** (what the customer owed before payouts were netted), counting prior refunds, not against the cash that physically came in.
3. **Loto ticket already settled with Loto.** Standalone refund is refused today ("This ticket was already settled with Loto on <date>. Fix it from the Loto page."). → Recommended: same refusal in the basket.
4. **Exchange member.** → Recommended: mirror reversal of its two sides (the customer gives back the lira, gets the dollars back) with its lots given back, as the standalone exchange refund does. No tender-method override (it is a swap type).
5. **Maintenance job member.** → Recommended: same as a custom service (a sold service).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Refund one loto ticket from a basket (Priority: P1)

A basket had a $20 charger, a 300,000 LBP loto ticket and a 500,000 LBP loto prize, paid in cash. The customer returns the ticket. The cashier presses "Refund item" on the ticket row and hands back 300,000 LBP.

```
BASKET #12 at checkout                       REFUND the ticket
  Charger          +$20                        Ticket reversed (loto ticket cancelled)
  Loto ticket      +300,000 LBP                Customer gets 300,000 LBP
  Loto prize       -500,000 LBP                Drawer LBP: -300,000
  Net: customer gives $20, gets 200,000 LBP    Basket left: charger + prize
  Drawer: +$20 USD / -200,000 LBP              Profit: ticket's margin cancelled
```

**Why this priority**: The owner's case. Today both rules refuse it.

**Independent Test**: Check out the basket above, refund the ticket, check the drawer moved by 300,000 LBP, the ticket is cancelled in Loto, the REFUND row sits under the session group, and the day's loto profit drops by the ticket's margin.

**Acceptance Scenarios**:

1. **Given** the basket above, **When** the owner opens the Transactions page, **Then** "Refund item" is offered on the ticket row (and on the charger row).
2. **Given** the owner presses it on the ticket, **When** the refund window opens, **Then** it offers 300,000 LBP back, by the method the basket was paid with first, editable.
3. **Given** the refund is confirmed, **When** the books are read, **Then** the ticket is cancelled in Loto, 300,000 LBP left the drawer, a REFUND row linked to the session and to the ticket exists, and the ticket's margin is removed from profits.
4. **Given** the ticket was already settled with Loto, **When** the owner presses "Refund item", **Then** the refusal names the settlement date and points to the Loto page.

---

### User Story 2 - Refund a payout member (prize, cash-out, receive) (Priority: P2)

The customer was paid a 500,000 LBP loto prize in the basket; the prize turns out to be wrong. The cashier refunds the prize row: the customer gives 500,000 LBP back.

```
REFUND the prize
  Prize reversed (Loto prize row voided, checkpoint adjusted)
  Customer gives back 500,000 LBP   -> cash, or added to the customer's account as owed
  Drawer LBP: +500,000 (if cash)
```

**Acceptance Scenarios**:

1. **Given** a basket with a prize, **When** "Refund item" is pressed on the prize row, **Then** the refund window opens in the "customer pays" direction with 500,000 LBP and offers the shop's normal payment methods (cash, customer account, OMT wallet, Whish wallet, …).
2. **Given** the cashier records it as cash, **When** confirmed, **Then** the drawer goes up 500,000 LBP, the prize is voided in Loto with its checkpoint adjusted (same owner as the whole-basket path), and a REFUND row linked to the session exists.
3. **Given** the cashier records it on the customer's account, **When** confirmed, **Then** the customer owes 500,000 LBP more and no drawer moves.
   3b. **Given** the cashier records it on a wallet method (OMT wallet, Whish wallet), **When** confirmed, **Then** that wallet's balance goes up by the amount, like a wallet-paid sale.
4. **Given** a Binance / OMT App cash-out member, **When** refunded, **Then** the same flow applies; the wallet/supplier side is reversed by that type's existing reversal owner.
5. **Given** a prize already settled with Loto, **When** refunded, **Then** the existing refusal applies.

---

### User Story 3 - Sold item in a basket that had a payout (Priority: P2)

Same basket as story 1; the customer returns the charger instead. Today refused because the basket contained a prize.

**Acceptance Scenarios**:

1. **Given** the basket above, **When** the charger is refunded, **Then** the customer gets $20 back (account first if any of the basket was on account, remainder by the refund window), the sale line is reversed and stock returns.
2. **Given** every item of the basket is refunded one by one, **When** the last one completes, **Then** the basket is closed as fully refunded (existing rule) and nothing is left to reverse.
3. **Given** prior item refunds, **When** another refund would hand back more than the basket's gross charge in that currency counting those refunds, **Then** it is refused with the existing message.

---

### User Story 4 - Send, exchange and maintenance members (Priority: P3)

**Acceptance Scenarios**:

1. **Given** an OMT/Whish/iPick/Katsh send in a basket, **When** refunded, **Then** the customer gets the amount + fee back (account first), and the supplier/partner ledger side is reversed by the existing financial-service reversal (soft void, auto sibling).
2. **Given** an exchange member, **When** refunded, **Then** both sides are mirrored (the customer returns what they received and gets back what they gave), lots are given back, no tender override is offered.
3. **Given** a maintenance job member, **When** refunded, **Then** it behaves like a custom service (parts back to stock per the existing maintenance reversal).

---

### Edge Cases

- **Account first across currencies.** Unchanged: converted at the refund popup's rate, defaulting to the basket's paid rate (LIRA-236).
- **Basket with an extra, waived shortfall or discount.** Unchanged: the item takes its share of the extra (LIRA-319); a basket with a waived shortfall still refuses an item refund (LIRA-310 rule).
- **Refund of a payout member when the basket was on account.** The returned amount reduces nothing automatically; the cashier chooses cash or "owed on account" in the window.
- **Undo refund (admin).** Works for every new member type like today, through the same REFUND_UNDO path.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `refundSessionBasketItem` accepts every member type of a checked-out basket; the type-whitelist refusal is removed. Each type's reversal is its existing reversal owner (rule 20): sale line, custom service, recharge, loto ticket, loto cash prize, financial service (charge or payout), exchange, maintenance.
- **FR-002**: Direction follows the member's customer-side sign: positive (charge) → money back to the customer, account first then remainder; negative (payout) → money back from the customer, cash or on account, no account-first step.
- **FR-003**: The netted-payout refusal (`_assertNoNettedPayoutMembers`) is removed; the per-currency "never more than received" cap is measured against the basket's gross charge counting prior refunds.
- **FR-004**: Existing refusals stay: settled loto ticket/prize, waived-shortfall basket, already-reversed member, fully refunded basket.
- **FR-005**: "Refund item" shows on every live basket member row on the Transactions page; `hideRefundItem` (payout basket) is dropped; the frontend reads the member type list from core (rule 14).
- **FR-006**: Both transports; one payload shape; web e2e for stories 1–3.
- **FR-007**: Release note; What's new card only if the window visibly changes (the direction switch is new UI → card with screenshot).

### Key Entities

- **REFUND row** linked by `customer_session_transactions.transaction_type = 'session_item_refund'`, as today; `metadata_json.refundType = "sessionItem"` and a new `refundDirection` field (`"to_customer" | "from_customer"`; `direction` was already taken by the custom-service copy).
- **`collectedUsd/Lbp`** (REFUND row metadata, from_customer only): what the customer gave back, read by the whole-basket reversal so it nets to 0.
- **`Session Refund Debt`** (debt_ledger type): a payout given back "on the customer's account" — the customer owes it. Linked to the REFUND row; a module charge like the others (repayments cover it).

## Success Criteria _(mandatory)_

- **SC-001**: For every member type, create + item refund nets to 0 on every ledger it touched, per currency (core table-driven test, one row per type, failing first for the newly allowed types).
- **SC-002**: Story 1 and 2 as web e2e; drawer deltas asserted, never absolute totals (rule 15).
- **SC-003**: The Loto page shows the ticket cancelled / the prize voided, and its checkpoint totals move by the amounts.

## Decisions taken unattended (2026-11-11 night)

Recorded by the build agent; the owner was not available. Each follows the spec's recommended answer or the most conservative reading.

- **Open questions 2–5**: built as recommended (gross-charge cap; settled-loto refusal kept; exchange = mirror reversal, no method choice; maintenance = like a custom service).
- **Which rows get "Refund item"**: every live basket member EXCEPT the basket's own checkout lines (kept change, waived amount, extra charge, basket discount) — those belong to the whole basket, and no owner answer covers refunding them alone. They keep their whole-basket refusal.
- **Amount of a non-product member**: what the customer actually paid or received for it in the basket (the session line), not the module's own figure — a send refunds amount + fee, a For-Partner item refunds nothing to the walk-in customer.
- **Currency of the hand-back in a basket that had a payout**: the item's own currency (story 1: 300,000 LBP), capped per currency by what the basket charged minus earlier refunds.
- **Payout given back on the customer's account**: booked as a new account charge "Session Refund Debt" that repayments cover like any other module charge.
- **Items paid on their own** (an exchange or transfer linked to the session from its own page): refunded exactly as they were paid (their own payment lines reversed), with no refund window — same as a standalone exchange refund.
- **Kept change / customer-gives-change on a payout refund**: refused (the customer is the one paying).
- **Undo refund (admin)**: unchanged — still product (sale) members only; other members' item refunds cannot be undone yet. The spec edge case "works for every new member type like today" is read as "as today" (SALE only).
- **Web e2e coverage**: stories 1 and 2 (the brief); story 3 and 4 are proven by the core table-driven test only.
- **Release note / sprint line**: written by the main session, not this build (brief).

### Questions for the morning

1. Should "Undo refund" be extended to non-product members (ticket, prize, transfer, payout)?
2. Should kept change, a waived amount, an extra or a basket discount ever be refundable on their own?
3. A payout given back on account: is "Session Refund Debt" the right name on the Debts page, or should it read as the original module (e.g. "Loto Debt")?
4. After LIRA-380 makes an exchange a basket line paid from the basket's pool, should its item refund hand money back through the refund window (like other items) instead of the exact mirror?
