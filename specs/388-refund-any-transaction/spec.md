# Feature Specification: Refund any transaction

**Feature Branch**: `388-refund-any-transaction` (work happens on `main`; ticket LIRA-388)

**Created**: 2026-11-11

**Status**: Draft

**Input**: Owner, 2026-11-11, after Corner Tech saw "Can't refund here" on a loto cash prize paid outside a session: "I need to be able to refund any transaction, except some types." On the proposed split between a refund with a payment window and a one-click undo for bookkeeping rows: "I prefer we stick to refund. No void/undo, it's a redundant feature to have." Follow-up decisions: the existing "Void" button on sales goes away (one "Refund" only, defaulting to the original method so a same-day case is one click); everyone may refund, bookkeeping rows included.

## Today

The Transactions page offers "Void" and "Refund" on sales, services, recharges, exchanges, transfers, repairs and loto tickets, and "Refund item" on members of a paid customer basket (LIRA-381). Thirty-one transaction types are on a non-reversible list; their rows show an italic "Can't refund here" with a tooltip that points elsewhere. Some of those "elsewhere" places exist (Hold Money page "Void pickup", Vouchers page "Cancel voucher", Warranty page "void claim"); some do not (a loto cash prize paid outside a session has no reversal anywhere — the tooltip's "or from the Loto page" is false).

Cashiers therefore meet three different words for the same intent (Void, Refund, Cancel/Undo on other pages) and a dead end on nineteen row types.

## Clarifications

### Session 2026-11-11 (owner decisions)

- Q: Which types stay non-refundable? → A: The twelve structural rows below. Everything else becomes refundable.
- Q: One "Refund" with a payment window for customer-money rows, and a separate one-click "Void/Undo" for bookkeeping rows? → A: **No.** One action, "Refund", on every refundable row. Behind it the money still differs (a customer is paid back, or an opposite book entry is written), but the cashier sees one button.
- Q: Keep the "Void" button on sales next to "Refund"? → A: **Remove it.** The refund window opens with the original payment method pre-selected, so the same-day "give it back the same way" case is one confirm.
- Q: Who may refund the bookkeeping rows (carrier top-ups, drawer moves, partner/supplier/account adjustments, monthly fee, line edits)? → A: **Everyone**, same as any refund.

### Open questions (recommended answer first; the build follows it unless the owner overrules)

1. **Hold Money and Vouchers already have their own reversal on their own pages.** → Recommended: the Transactions row's "Refund" triggers the SAME action those pages run (one rule, two entry points); the page buttons stay. Never a second reversal path.
2. **A bookkeeping row's refund (opposite entry) — confirm text.** → Recommended: a plain confirm naming the row and the opposite entry it will write ("Write the opposite entry: −$500 Alfa top-up?"), no reason field.
3. **A carrier line hand-edit (CARRIER_LINE_ADJUSTMENT) whose previous values were not stored.** → Recommended: refundable only when the row carries the before/after values; otherwise it keeps "Can't refund here" with a true reason ("this edit did not record the previous values").

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Refund a loto cash prize paid outside a session (Priority: P1)

A customer was paid a 500,000 LBP cash prize from the Loto page, no session. It was the wrong ticket. The cashier opens Transactions, clicks "Refund" on the prize row; the window opens as "Customer pays back" with Cash preselected; confirm. The Loto drawer gets 500,000 LBP back, the prize is marked refunded, the Loto day's prizes total drops by 500,000, and the row shows REFUNDED.

```
BEFORE                                   AFTER
Loto Prize 500,000 LBP  "Can't refund here"   Loto Prize 500,000 LBP  [Refund]
                                         → window: Customer pays back, Cash 500,000 LBP
                                         → Loto drawer +500,000; prize voided; row REFUNDED
                                         → REFUND row −500,000 linked to the prize
```

**Why this priority**: Corner Tech's report; the only reversal with no path at all today.

**Independent Test**: Pay a standalone prize, refund it from the row by cash; Loto drawer delta 0 net, prize excluded from the day's totals, both rows linked.

**Acceptance Scenarios**:

1. **Given** a standalone cash prize, **When** the cashier clicks Refund, **Then** the refund window opens titled "Customer pays back" with the prize's original method and currency preselected and the amount fixed to the prize.
2. **Given** the confirm, **When** it runs, **Then** the drawer that paid the prize receives the amount back, the prize is excluded from Loto totals and settlement, and a REFUND row linked to the prize is written; every ledger nets to 0 per currency.
3. **Given** the prize's day is already settled with the Loto supplier, **When** the cashier clicks Refund, **Then** it is refused with "already included in settlement of <day>" and nothing is written.
4. **Given** a prize paid INSIDE a session basket, **When** the row is viewed, **Then** it keeps the LIRA-381 "Refund item" behaviour (unchanged).

---

### User Story 2 - One "Refund" button, Void gone (Priority: P1)

On every refundable row the cashier sees one button, "Refund". On a sale the window opens with the original method and amount; confirming without changes does what "Void" did today (money back the same way, same day or not).

**Acceptance Scenarios**:

1. **Given** any sale, service, recharge, exchange, transfer, repair or loto ticket row, **When** rendered, **Then** exactly one action button "Refund" shows; no "Void".
2. **Given** the refund window on such a row, **When** it opens, **Then** the original payment method, currency and amount are preselected; the cashier can still change the method (wallet, account) as today.
3. **Given** a row refunded this way, **When** the books are read, **Then** the result equals today's Void for the same-method case and today's Refund for a changed method (no new booking shape).
4. **Given** a REFUND row, **When** rendered, **Then** "Undo refund" stays as today (admins), unchanged.

---

### User Story 3 - Refund customer-money rows that had no path from Transactions (Priority: P2)

Account cash-out (CREDIT_CASH_OUT / DEBT_CASH_OUT), account cash-in (CREDIT_CASH_IN), Hold Money drop-off and pickup, Voucher sale, Warranty claim cost.

```
Account cash-out $50 (shop paid cash from the client's credit)
  Refund → "Customer pays back" window, Cash $50 preselected
         → drawer +$50, client credit +$50 restored, row REFUNDED

Account cash-in $50 (client deposited cash to account)
  Refund → "Give back" window, Cash $50 preselected
         → drawer −$50, client credit −$50, row REFUNDED (refused if the credit was since spent below $50)

Hold Money drop-off / pickup, Voucher sale, Warranty cost
  Refund → runs the SAME reversal the Hold Money / Vouchers / Warranty page runs today
```

**Acceptance Scenarios**:

1. **Given** an account cash-out, **When** refunded by cash, **Then** the drawer and the client's credit both return to their prior balances; by account is not offered (it would be circular).
2. **Given** an account cash-in whose credit has since been partly spent, **When** refunded, **Then** it is refused with the remaining credit named, nothing written.
3. **Given** a Hold Money pickup, **When** refunded from the row, **Then** the result is identical to "Void pickup" on the Hold Money page, and the Hold Money page shows it voided.
4. **Given** a voucher sale, **When** refunded from the row, **Then** the result is identical to "Cancel voucher" on the Vouchers page (customer refunded per leg, voucher cancelled); a voucher already redeemed is refused as the Vouchers page refuses it.
5. **Given** a warranty claim cost, **When** refunded from the row, **Then** the claim is voided as from the Warranty page, with every ledger netting to 0.

---

### User Story 4 - Refund bookkeeping rows with an automatic opposite entry (Priority: P2)

Manual carrier top-ups (MTC/Alfa), Dashboard drawer top-up / cash-out, partner / account / supplier adjustments, counterparty discount, loto monthly fee, carrier line hand-edit. No customer paid or received anything, so no payment window: "Refund" asks for one confirm naming the opposite entry, then writes it.

```
Alfa manual top-up $500 (typed by mistake)
  Refund → confirm "Write the opposite entry: −$500 Alfa top-up from General?"
         → carrier credit −$500, drawer +$500, row REFUNDED, REFUND row linked

Partner adjustment +$30 credit
  Refund → confirm → opposite −$30 entry on the partner, row REFUNDED
```

**Acceptance Scenarios**:

1. **Given** a bookkeeping row, **When** the cashier clicks Refund, **Then** a confirm names the row and the exact opposite entry; no payment window.
2. **Given** the confirm, **When** it runs, **Then** every balance the row touched (drawer, carrier credit, partner/supplier/client ledger, loto fee ledger) returns to its prior value; the row shows REFUNDED and a REFUND row links to it.
3. **Given** a later row depends on it (an adjustment already included in a settlement; a top-up whose credit was since sold below the top-up amount), **When** Refund is clicked, **Then** it is refused with the dependency named.
4. **Given** a carrier line hand-edit with before/after values recorded, **When** refunded, **Then** the line returns to the before values; without recorded values it keeps "Can't refund here" with a true reason.

---

### User Story 5 - The twelve structural rows keep an honest "Can't refund here" (Priority: P3)

REFUND, REFUND_UNDO, VOUCHER_CANCEL, HOLD_MONEY_COLLECT_VOID (reversal rows: use Undo refund where it exists), KEPT_CHANGE, WAIVED_SHORTFALL, EXTRA_CHARGE, BASKET_DISCOUNT (basket lines: refund the basket), CHECKPOINT (a count), LOTO_SETTLEMENT (a settled day: correct with a new settlement), CLIENT_CREATED/UPDATED/DELETED (audit entries).

**Acceptance Scenarios**:

1. **Given** one of these rows, **When** rendered, **Then** "Can't refund here" shows with a tooltip whose pointer is TRUE (no reason may name an action that does not exist).

---

### Edge Cases

- **Already refunded / already a reversal**: never offered twice; a REFUNDED row shows the badge and the linked REFUND row.
- **Settlement dependency**: any row included in a supplier / partner / loto settlement is refused with the settlement named (today's rule for OMT rows, extended).
- **Session basket members**: unchanged — LIRA-381 "Refund item" and whole-basket actions stay; this ticket does not touch them.
- **Sale-line item refund**: unchanged ("Refund item" on sale lines stays).
- **Currency**: the opposite entry or payback is in the row's own currency; the window may change method but the amount is fixed.
- **Offline desktop**: refunds of bookkeeping rows replay like any write.
- **Reports**: Profits, drawers, supplier/partner/client balances and Loto day totals read net of the refund on the refund's day (today's rule for refunds).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The non-reversible list shrinks to the twelve structural types; every other type is refundable from its row with one action labelled "Refund".
- **FR-002**: The "Void" action is removed from the Transactions page; the refund window opens with the row's original method, currency and amount preselected, and a same-method confirm books exactly what Void booked.
- **FR-003**: Customer-money types (LOTO_CASH_PRIZE standalone, CREDIT_CASH_OUT, DEBT_CASH_OUT, CREDIT_CASH_IN, HOLD_MONEY, HOLD_MONEY_COLLECT, VOUCHER_SALE, WARRANTY_COST) open the refund window in the right direction ("Customer pays back" when the shop paid out, "Give back" when the customer paid in); where a page-owned reversal exists (Hold Money, Vouchers, Warranty) the row triggers that SAME reversal (rule 14), never a second one.
- **FR-004**: Bookkeeping types (MTC_TOPUP, ALFA_TOPUP, DRAWER_TOPUP, DRAWER_CASHOUT, PARTNER_ADJUSTMENT, ACCOUNT_ADJUSTMENT, SUPPLIER_ADJUSTMENT, COUNTERPARTY_DISCOUNT, LOTO_MONTHLY_FEE, CARRIER_LINE_ADJUSTMENT) refund through one confirm that names the opposite entry; the opposite entry is derived from the row's own stored figures, never retyped.
- **FR-005**: Every refund nets to 0 on every ledger it touches, per currency (rule 20), writes a REFUND row linked to the original, marks the original REFUNDED, and is refused when a later row depends on it (settlement, pickup, redemption, credit since spent, carrier credit since sold), with the dependency named.
- **FR-006**: One reversal rule per type, in the core, used by both transports (rule 19); the Transactions page decides what to show from the core's one classification (rule 14), never from a hand-copied list.
- **FR-007**: Everyone may refund; no admin gate on any of the nineteen types. "Undo refund" keeps its admin gate.
- **FR-008**: Every "Can't refund here" tooltip names only actions that exist.
- **FR-009**: Release notes and a What's new card with a real screenshot of the refund window on a loto prize row (rule 30).

### Key Entities

- **transactions**: `status` REFUNDED / `reversed_by_id` on the original; the REFUND row with `reverses_id`, `metadata_json.refundType` naming the kind (`standalone`, `bookkeeping`, …), `refundDirection`.
- **Module tables**: `loto_cash_prizes.voided`; client ledger rows for cash-in/out reversal; carrier credit, drawer and partner/supplier ledgers for opposite entries; `hold_money`, `vouchers`, warranty claims through their existing reversal.

## Success Criteria _(mandatory)_

- **SC-001**: Core table-driven test over all nineteen types: create → refund → every ledger touched nets to 0 per currency, the original is REFUNDED, the REFUND row links back (failing first on the twelve-plus-nineteen split).
- **SC-002**: Core test per dependency refusal (settled day, spent credit, redeemed voucher, picked-up hold, sold-down carrier credit): refused, nothing written.
- **SC-003**: Transactions page test: no "Void" button on any row; "Refund" on every refundable type; "Can't refund here" only on the twelve.
- **SC-004**: Web e2e: pay a standalone loto prize, refund it from the row, Loto drawer delta 0 net and the day's prizes total unchanged from before the prize (`lira-web-0xx`); a bookkeeping row (Alfa manual top-up) refunded with one confirm.
- **SC-005**: Rows and figures on Profits, drawers, Loto day, Hold Money, Vouchers and Warranty pages agree with the Transactions page after each refund.

## Assumptions

- A REFUND row already exists as the reversal carrier for all current refunds; this ticket reuses it for the new types (no new transaction type).
- The refund window used by LIRA-381 ("Customer pays back" / method choice) is reusable for the customer-money group.
- Hold Money, Vouchers and Warranty reversals already net to 0 and will be invoked, not reimplemented.
- The owner accepts that a refund of a bookkeeping row is visible in the Transactions table like any refund (not hidden as an auto row).

## Decisions taken unattended (2026-11-11)

Recorded by the build agent; the owner was not available. Open questions 1–3 are built as recommended.

- **Counts corrected**: the structural list named in User Story 5 has 13 types (not 12), and FR-003 + FR-004 name 18 refundable types (not 19); 13 + 18 = 31. The named lists win; tests iterate them.
- **MTC_TOPUP / ALFA_TOPUP stay "Can't refund here"**: nothing has written them since 2026-08-06 (the old "top-up from customer" was removed), their old rows recorded no payment lines, and taking credits off the carrier drawer with no line would show a false difference at the next checkpoint. The tooltip says so. The "Alfa manual top-up" of story 4 is today's Recharge page top-up, which is already refundable; it gets the single Refund like every other row.
- **Carrier line hand-edits**: from now on an edit records the credits before and after; only those edits are refundable, and only while the line still holds the edited credits. Older edits keep "Can't refund here" (open question 3 as recommended).
- **Same-method confirm**: books the same money as today's Void (every line back to the same drawer, currency and amount; every ledger the same) but as a refund (the original stays, a REFUND row reverses it on today's date). A back-timed row that settled a checkpoint difference keeps that settlement (today's refund rule).
- **FR-001 reading**: the list the cashier meets ("Can't refund here") shrinks to the 13 structural types plus the two old carrier top-ups; the internal safety list that stops a raw void stays as it is, so nothing can be voided behind the page's back.
- **Page-owned reversals keep their own row**: a Hold Money pickup, a voucher and a warranty claim are reversed by their page's own action, which writes that page's reversal row (pickup void, voucher cancel, claim void) instead of a second REFUND row; the Transactions row reads as reversed through it. The voucher cancel uses the shop's day from the request.
- **One entry point**: the existing refund channel; it now routes Hold Money pickups, vouchers and warranty claims to their pages' own reversal. "Void basket" and "Void checkout" (multi-unit) stay as they are (baskets untouched).
- **Hold Money drop-off**: no page reversal existed; the refund cancels the hold (it leaves the Hold Money list) and is refused while any pickup is still live.
- **Bookkeeping confirm text**: "Write the opposite entry: <the row's own amounts>?" — no reason field (open question 2 as recommended).
- **Who may refund**: admin and staff on the refund channel. The warranty claim keeps its own admin-only rule inside the warranty module; a staff refund of a warranty cost row gets the Warranty page's message.
- **Settled rows**: a loto prize whose day was settled is refused (story 1.3); a supplier adjustment or discount whose settlement kept no per-row coverage is refused; where a settlement kept coverage, the existing rule applies (the settled part goes back on the account).

- **"Alfa manual top-up" in the web test**: an Alfa top-up from a drawer is refused today ("Alfa credits are added on the phone line itself"), so the test refunds an Alfa line credits edit (+$500 typed by hand) with one confirm: the line and the Alfa drawer go back.
- **Carrier line edit refund puts back the credits only**: an expiry date changed in the same edit is not put back.
- **A settled loto prize**: refused only when refunded from its own row; a prize inside a customer basket keeps today's rule (the settled part goes back on the Loto account).
- **A counterparty discount** is refunded from its row only when it was given on its own (a write-off). One given with a repayment, payment or settlement is refused with the row to refund instead.

### Questions for the owner

1. Old customer carrier top-ups (MTC/Alfa, before August 2026): keep "Can't refund here", or take the credits back from the carrier's primary line?
2. Warranty cost rows: staff see Refund but the warranty module still allows only an admin to void a claim. Open it to staff too?
3. Vouchers page "Cancel voucher" is admin-only, yet the Transactions row refund (same action) is now open to staff. Open the page button to staff as well, or keep vouchers admin-only everywhere?
4. Should "Void basket" / "Void checkout" also become "Refund basket" / "Refund checkout" only?
5. The "Customer pays back" window's subtitle says the customer may pay "or their account". On a standalone prize or an account cash-out the account is not offered. Reword the subtitle for those rows?
6. A carrier line edit that also changed the expiry: should the refund put the old expiry back too?
