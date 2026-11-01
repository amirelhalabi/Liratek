# Feature Specification: Exchange — customer account both ways, payment window for every currency

**Feature Branch**: `369-exchange-account-all-currencies` (work happens on `main`; ticket LIRA-369)

**Created**: 2026-11-01

**Status**: Draft

**Input**: Owner, 2026-10-31: "Exchange: enable customer account payment method for exchange; when exchanging in currencies other than USD and LBP, the drawer payment form is not opening."

## Clarifications

### Session 2026-11-01 (owner decisions)

- Q: Customer account in which direction? → A: Both. **OUT to customer account** (the shop pays the customer by crediting their account instead of handing cash) and **IN from customer account** (the customer pays the shop by owing it), for every currency.
- Q: IN from customer account was limited to USD/LBP on 2026-10-14. Keep that? → A: No. Allowed for every currency.
- Q: The account only holds USD and LBP. What happens to an EUR (or other) amount put on the account? → A: It is converted to USD and the account is credited or charged in USD. The original amount (e.g. "10 EUR") is kept in the note / summary.
- Q: Which rate converts it? → A: A rate typed on the payment form, seeded and editable. Today the form's rate box only handles USD↔LBP; it must work for any currency against USD.
- Q: How can the shop pay out an EUR (or other) result? → A: Cash in that currency and/or the customer account. No other methods.
- Q: Partner mode? → A: Unchanged.
- Q: Does a later rate change affect a converted account entry? → A: No. Once recorded, the account entry is a fixed USD amount; no later rate touches it. The original amount, currency and rate go into the note/summary so anyone looking at the USD entry can see where it came from (e.g. "100 EUR @ 1.10 = $110").
- Q (Q1): How does a tracked currency (EUR…) count an account line, where the EUR never physically moves? → A: Option A — the account part is treated as if no EUR moved. The EUR drawer and EUR position change only for EUR that physically crosses the counter. Later, if the customer brings EUR to repay or asks for EUR against their credit, that is a normal exchange (EUR→USD paid OUT to account, or USD→EUR paid IN from account) with its own rate, position and profit at that moment. Derived from the owner's 2026-11-01 answer (the debt is a fixed USD value), after walking through the repay/spend scenarios.
- Q: Where does the typed rate box start? → A: At the exchange's own rate (e.g. $110 for 100 EUR → 1.10), so putting the result on the account gives the customer exactly what they paid. If the cashier types another rate, the difference is part of this exchange's margin.
- Q: When does an exchange's margin count as profit? → A: When the money is received. Paid in full at the exchange → counted then. Anything paid on the customer's account → the WHOLE margin of that exchange waits until the account entry is fully paid (option A, "all waits" — same rule POS, Recharge and OMT/Whish already use). This also fixes today's USD/LBP exchanges paid on account, which count their margin at once. Shown to the owner on the comparison page (artifact 2htYg9L6uuaqPhgUHEEGxm).
- Q: Once paid, under which day does the margin show? → A: The exchange's own date (same as the other modules).

## Today

| Exchange | Payment window | OUT (shop pays customer) | IN (customer pays shop) |
|---|---|---|---|
| Into USD or LBP | Opens | Cash / drawer methods only | Drawer methods + account, **only when paying in USD/LBP** |
| Into EUR or other | **Never opens** — Confirm saves straight away | One cash lump, no choice | One cash lump, no choice |
| For Partner | No window | — | — |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Payment window opens for every currency (Priority: P1)

The cashier exchanges $110 into 100 EUR. Pressing the button opens the same payment window as a USD/LBP exchange: the "Customer pays" box (USD here), the payout box (EUR), and the client picker.

```
BEFORE                         AFTER
$110 → 100 EUR                 $110 → 100 EUR
[Confirm] → saved at once      [Pay customer] → payment window
  drawer USD +110                Customer pays  USD  110   (Cash / Account)
  drawer EUR −100                Shop pays      EUR  100   (Cash / Account)
                                 [Confirm]
```

**Why this priority**: This is the reported bug, and every other story needs the window.

**Independent Test**: Exchange $110 into 100 EUR, pay cash both ways. The window opens; after Confirm the USD drawer is up $110 and the EUR drawer down 100, same as today's direct save.

**Acceptance Scenarios**:

1. **Given** an exchange from USD into EUR, **When** the cashier presses the main button, **Then** the payment window opens with the payout in EUR and the customer side in USD.
2. **Given** an exchange from EUR into LBP, **When** the button is pressed, **Then** the window opens as today (it already opens for an LBP target) and the customer side is in EUR.
3. **Given** an exchange from EUR into GBP (neither side USD/LBP), **When** the button is pressed, **Then** the window opens; both sides offer only cash in their own currency and the customer account.
4. **Given** the window is open for an EUR payout, **When** the cashier looks at the payout methods, **Then** only Cash (EUR) and Customer account are offered.
5. **Given** For Partner mode, **When** the button is pressed, **Then** the exchange saves directly as today.
6. **Given** an exchange that would book a loss on a tracked currency, **When** the window is confirmed, **Then** the loss confirmation still appears before saving, as it does today on the direct path.

---

### User Story 2 - OUT to customer account (Priority: P1)

A regular customer exchanges and wants the result kept on their account instead of in cash.

```
USD/LBP example                     EUR example
200,000,000 LBP → $2,235            $110 → 100 EUR
Shop pays  $2,235 → Account         Shop pays  100 EUR → Account
                                      rate EUR→USD  1.10 (typed, seeded)
Client account  +$2,235 credit      Client account  +$110 credit
Drawer USD       0                  Drawer EUR       0
Drawer LBP  +200,000,000            Drawer USD    +110
                                    Note: "100 EUR on account"
```

**Why this priority**: The owner's main ask; there is no way to do this today.

**Independent Test**: Exchange $110 into 100 EUR, put all 100 EUR on a picked client's account at 1.10. The client's account shows $110 in credit, no EUR leaves the drawer, the note keeps "100 EUR".

**Acceptance Scenarios**:

1. **Given** a USD-target exchange of $2,235 and a picked client, **When** the whole payout goes to Customer account, **Then** the client's account is credited $2,235 and no USD leaves any drawer.
2. **Given** an LBP-target exchange, **When** the payout goes to the account, **Then** the client is credited in LBP.
3. **Given** an EUR-target exchange of 100 EUR, **When** the payout goes to the account at a typed rate of 1.10, **Then** the client is credited $110 and the entry keeps "100 EUR" in its note/summary.
4. **Given** a split payout of 60 EUR cash + 40 EUR to account at 1.10, **When** confirmed, **Then** the EUR drawer goes down 60 and the client is credited $44.
5. **Given** an account line and no client picked, **When** the cashier tries to confirm, **Then** Confirm stays off with the same "pick a client" message as the customer side today.
6. **Given** a saved exchange whose payout went to the account, **When** it is voided or refunded, **Then** the credit is taken off the client's account and every drawer and account nets to 0 per currency.

---

### User Story 3 - IN from customer account in every currency (Priority: P2)

A customer wants EUR but pays by owing the shop, in a currency other than USD/LBP.

```
Customer gives 50 GBP worth, on account → 55 EUR out
Customer pays  GBP 50 → Account   rate GBP→USD 1.27 (typed)
Client owes  +$63.50   ("50 GBP on account")
Drawer EUR   −55
```

**Why this priority**: Reverses the 2026-10-14 limit; rarer than paying out to the account.

**Independent Test**: Exchange 50 GBP into EUR with the GBP side on account at 1.27. The client owes $63.50; the GBP drawer does not move; the note keeps "50 GBP".

**Acceptance Scenarios**:

1. **Given** the customer side is in EUR, **When** the cashier picks Customer account, **Then** it is offered (today it is not) with a typed rate seeded from the shop's rates.
2. **Given** an EUR customer-side account line of 100 EUR at 1.10, **When** confirmed, **Then** the client owes $110 more, recorded like today's exchange debt.
3. **Given** USD or LBP on the customer side, **When** the account is used, **Then** behaviour is unchanged from today (owed in that currency, no rate needed).
4. **Given** a saved exchange with an EUR account line, **When** it is voided or refunded, **Then** the debt is cancelled and everything nets to 0.

---

### User Story 4 - One rate box for any currency (Priority: P2)

Whenever an account line holds a currency other than USD/LBP, the payment window shows a rate box for that currency against USD (e.g. "1 EUR = 1.10 USD"), seeded and editable. USD↔LBP behaviour stays as it is.

**Independent Test**: Open the window on an EUR-target exchange, choose Account: a "1 EUR = … USD" box appears, seeded; change it to 1.12 and the credited USD follows.

**Acceptance Scenarios**:

1. **Given** an EUR account line on a $110 → 100 EUR exchange, **When** the window opens, **Then** the rate box shows 1 EUR = 1.10 USD (the exchange's own rate).
2. **Given** the cashier types a new rate, **When** confirmed, **Then** the saved credit/debt uses the typed rate and the rate is kept on the entry.
3. **Given** a USD/LBP exchange, **When** the window opens, **Then** the existing USD↔LBP rate box looks and works as today.
4. **Given** no rate is known and none typed, **When** the cashier tries to confirm, **Then** Confirm stays off until a rate above 0 is typed.

### Edge Cases

- Account line with a rate of 0, empty or negative: refused, Confirm off; the server refuses it too.
- Payout fully to the account AND the customer side fully on the account (nothing moves in any drawer): allowed; the client is credited on one side and charged on the other, both recorded. [Assumption: allowed as long as the client is picked.]
- Both sides non-USD/LBP and both on the account: each side converted with its own typed rate.
- Rounding: USD equivalent rounded to cents; LBP rounded as today.
- Change box (LIRA-316), keep-change, round-up and "customer adds change" stay USD/LBP-only as today; on a non-USD/LBP payout they are not shown.
- Discount (LIRA-365, replacing Forgive) keeps its USD/LBP-only cap; not offered on a non-USD/LBP customer side.
- Session exchanges: the window and account work inside a customer session the same way.
- **Tracked currencies (EUR etc.)**: the part of an exchange that goes to or comes from the account does not move the EUR drawer or the EUR position (Q1, option A). The rate box starts at the exchange's own rate; a different typed rate changes this exchange's margin by the difference.
- **Later repayment in EUR**: the Debts page takes USD/LBP; a customer who brings EUR records an Exchange EUR→USD with the payout OUT to account, which pays the USD debt down. Whatever USD the EUR fetches that day is what is credited — the debt itself never changes with the rate.
- **Later collection of EUR against credit**: Exchange USD→EUR with the customer paying IN from account; the EUR handed out is a normal sale at that day's rate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Exchange payment window MUST open for every walk-in exchange, whatever the two currencies. For Partner mode keeps its direct save.
- **FR-002**: The payout side MUST offer Customer account as a method, in every currency.
- **FR-003**: For a USD or LBP payout, the payout side MUST keep its current drawer methods and add Customer account; the account is credited in that currency.
- **FR-004**: For any other payout currency, the payout side MUST offer only Cash in that currency and Customer account.
- **FR-005**: The customer side MUST offer Customer account for every currency (lifts the 2026-10-14 USD/LBP-only limit).
- **FR-006**: An account line in a currency other than USD/LBP MUST be converted to USD at the rate on the form and credited/charged to the client in USD.
- **FR-007**: The payment window MUST show a rate box "1 <currency> = … USD" for each non-USD/LBP account line, seeded per FR-017, editable; Confirm stays off without a rate above 0.
- **FR-008**: The saved entry MUST keep the original amount and currency of every converted account line and the rate used, visible in the note/summary and in the transaction details (e.g. "100 EUR on account @ 1.10").
- **FR-009**: Any account line (either side) MUST require a picked client; Confirm stays off otherwise. The server MUST refuse it too.
- **FR-010**: Void and refund MUST reverse every account credit and debt this feature creates; each drawer and each client account nets to 0 per currency (rule 20).
- **FR-011**: The server MUST validate the same rules as the window (methods per currency, client required, positive rate, legs add up to the amounts), on desktop and web alike.
- **FR-012**: USD/LBP exchanges MUST behave exactly as today, apart from the new payout account option.
- **FR-014**: A converted account entry MUST be a fixed USD amount from the moment it is saved; no later rate change, rate setting or re-calculation may change it.
- **FR-015**: The part of an exchange paid to or from the account MUST NOT move the drawer or the tracked position of the converted currency; only physically paid/received amounts do.
- **FR-016**: An exchange's margin MUST count on the Profits page only once nothing paid on the customer's account for it is still owed; while any of it is owed, the whole margin waits. Applies to every exchange with a customer-side account line, including USD/LBP ones recorded before this change.
- **FR-017**: The typed rate box MUST start at the exchange's own per-unit rate for that currency.
- **FR-013**: The Transactions list and client statement MUST show the exchange's account credit/debt like other account entries (client column filled).

### Key Entities

- **Exchange**: from currency/amount, to currency/amount, rate, client; now may carry account lines on either side.
- **Payment line**: method (Cash, drawer method, Customer account), currency, amount; for a converted account line also the original currency, original amount, and the rate to USD.
- **Client account entry**: credit (shop owes the client) or debt (client owes the shop) in USD or LBP, linked to the exchange.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An exchange into any currency the shop trades can be confirmed through the payment window (0 currencies skip it, For Partner aside).
- **SC-002**: The cashier can put an EUR payout on a client's account in one window, without a second entry anywhere.
- **SC-003**: For every exchange with an account line, void/refund leaves every drawer and every client account at its starting balance, per currency.
- **SC-004**: The same exchange gives the same drawers, account balances and profit on the desktop app and on the web app.
- **SC-005**: Every converted account entry shows the original amount, currency and rate.

## Assumptions

- Accounts hold USD and LBP only; no EUR account balance is introduced.
- "Customer account" is the same method and the same client account used by POS, Debts and the change box today.
- The margin amount is unchanged by how the customer pays; only WHEN it counts changes (FR-016).
- Works on desktop and web, same rules.
- The LIRA-365 change (Forgive becomes Discount in the customer-pays box) may land first; this feature works with whichever one is live.

## Worked example (Q1 = A)

```
Day 1  Customer gives $110, takes 100 EUR, leaves it on account @1.10
       Drawer USD +110 · Drawer EUR 0 · EUR position 0
       Client credit +$110   note "100 EUR @ 1.10 = $110"
Day 8  Rate now 1.15. Customer spends the credit at POS → $110 used. Done.
   or  Customer wants EUR: Exchange USD→EUR, IN from account $110 @1.15
       → 95.65 EUR out, normal sale, credit 0. The $110 never changed.
```
