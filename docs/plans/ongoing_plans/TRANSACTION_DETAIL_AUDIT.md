# Transaction detail audit — fields the cashier fills that never reach the transaction

Owner request (2026-10-16): every field a cashier can fill on screen should be
kept on the transaction itself, so a transaction can be understood later on
its own. Step 1 (this file) only lists what is missing. Deciding what to show
in the summary comes later.

**How this was checked:** four read-only code traces (form → payload →
validator → repository → `TransactionRepository.createTransaction`). "On the
transaction" means the `transactions` row: its columns (`client_id`,
`client_name`, `client_phone`, amounts, `exchange_rate`, `created_at`), its
`summary` text, or a `metadata_json` key. Nothing was run; items marked
UNVERIFIED were not traced to the end.

"Where it lives now" uses:

- **module** — only in the module's own table (`financial_services`,
  `recharges`, `maintenance`, `sale_items`, `debt_ledger`, …)
- **payments** — only in `payments` rows linked to the transaction
- **summary** — only as free text inside the summary (not a structured key)
- **profit** — only folded into `profit_usd` / `profit_lbp`
- **nowhere** — not saved at all

---

> **Status (2026-10-16): sections 1 and 2 are covered by LIRA-329** (`specs/329-transaction-full-details`) for new transactions: every listed field is saved in `metadata_json.details` (per-kind schema), payment lines in `metadata_json.payment_snapshot`, and client name/phone in the row's columns. Display (summary / details view) is a later ticket; it must hide item and part costs from staff.

## 1. Gaps that apply to many types

| Missing                                                            | Types affected                                                                                                                | Where it lives now                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Client phone (`client_phone` empty)                                | All Mobile Recharge, OMT/Whish system, Exchange, Loto, debts, session extra/kept/waived rows, voids, refunds                  | module or client record only                        |
| Client name for a walk-in (`client_name` empty)                    | Katsh, iPick, Whish App, OMT App, Binance, OMT/Whish system (non-partner), debts, basket item rows                            | summary (some types) or module                      |
| Picked client's name and phone (only `client_id` kept)             | POS sale                                                                                                                      | client record                                       |
| Partner id (only the label "<name> [partner]")                     | Every For Partner sale: POS, Exchange, Loto, MTC/Alfa, Katsh/iPick, Whish/OMT App, Binance, OMT/Whish system, Custom Services | module / partner ledger                             |
| Payment lines (method, currency, amount per line), change returned | Almost every type                                                                                                             | payments                                            |
| Kept change as its own figure                                      | POS, Maintenance, Loto, all Mobile Recharge, OMT/Whish system, Custom Services, Expenses                                      | profit (Exchange and repayments are the exceptions) |
| Discount exactly as typed                                          | Katsh/iPick, Whish/OMT App, Binance, basket, Maintenance (LBP discount saved nowhere)                                         | folded into amount/commission                       |
| Note / notes                                                       | Debts (all), suppliers (pay, adjust, settle), partners (settle, payment), Custom Services, Hold Money, Exchange               | module / ledger / payments.note                     |

---

## 2. By transaction type

### POS sale (`SALE`)

- Per item: product id, unit price, unit cost, serial/IMEI or picked unit, warranty months — module (`sale_items`). Only item names and quantities are kept.
- Picked client's name and phone — client record.
- Gift card code used — voucher table only.
- Payment currency choice — dropped by the validator.

### Maintenance (`MAINTENANCE`)

- Job status — module.
- Repair cost — profit.
- Gross price before discount — module.
- Discount — module (USD); **LBP discount saved nowhere**.
- Warranty months — module (only the end date is kept).
- Part product ids and part costs — module.
- Device name and issue — summary only; issue cut at 60 characters.

### Exchange (`EXCHANGE`)

- Market rate per leg — module.
- Whether the rate was overridden — **nowhere**.
- Profit per leg — module (only the total is kept).
- Payout rate — **nowhere**.
- Client phone — not sent.
- Note — payments.note.

### Loto (`LOTO`, `LOTO_CASH_PRIZE`)

- Client phone — not sent; client name missing when no client was matched.
- Prize date (cash prize) — module.

### Warranty claim (`WARRANTY_COST`, refund)

- Unit, replacement unit, notes, override reason — module (`warranty_claims`).
- Refund row: unit id, client name and phone.

### OMT / Whish system — Services page (`FINANCIAL_SERVICE` send/receive)

- OMT service type (Intra, Western Union, Cash to Business, Cash to Government, OMT Wallet, OMT Card, Ogero/Mecanique, Online Brokerage) — module.
- Reference number — module.
- Sender name, sender phone, receiver name, receiver phone — module (the customer's name appears only in the summary; the other party is missing, fully on a receive).
- OMT fee — summary text on a plain send only; receive: module.
- Whish fee (receive) — profit.
- "Including fees" choice — **nowhere** (not even the module table).
- Partner the transfer goes through (id and mode) — module.
- Fee for paying by a non-cash method, and its rate — module and a payment note.
- Online Brokerage "charge Binance fee to customer" — module.
- **Online Brokerage "Binance fee" — dropped before it is sent (saved nowhere).**
- Editing a name or phone from History updates the module only; the transaction keeps the old name.

### Custom Services (`CUSTOM_SERVICE`)

- Category, note, product picked, insurance fulfilment status — module.
- Partner mode (For / Via) and partner id — module / partner ledger. **Via Partner leaves no trace on the transaction.**

### Hold Money

- Notes — module.

### MTC / Alfa recharge (`RECHARGE`: credit, days, shop-line use)

- Shop line used (`carrier_line_id`) — line movements only.
- Suggested (default) price — module.
- Days: cost and price in USD as typed — only the LBP conversions are kept.
- SMS cost — on a separate expense transaction (by design).

### Credit buy-back

- Payout method — module.
- Shop line — line movements only.

### Alfa Gift

- Gift tier chosen — **not sent** (only its amounts).

### Katsh / iPick cards and bills

- Item key and category — not sent on the combined items call.
- Items and quantities — summary text only (no structured list).
- Only Days flag — summary text only.
- Credits returned per line — line movements / payments.

### Whish App / OMT App bills (catalog)

- Item category — not stored (no column).

### Whish App / OMT App transfers

- Sender/receiver name — module (not `client_name`).
- Provider fee (OMT fee / Whish fee) — module.
- Who pays the fee (sender / deducted / separately) — **nowhere**.

### Binance

- Wallet / reference — module.
- Who pays the fee — **nowhere**.

### Whish top-up from a client

- "Including fees" choice — not sent.

### Mobile Recharge basket and partner order

- Client name and phone on each item's transaction — kept on the session only.
- Partner id — module.

### Wrong number

- Right number — module.
- Link to the original sale — module.

### Expenses (`EXPENSE`)

- Bill amount as typed (when the vendor kept change) — **nowhere**; only the cost is kept.
- Description — summary only.

### Debts / Accounts (repayment, credit cash-out, add credit/debt, adjustment)

- Note — debt ledger and payments.note.
- Client name and phone columns — empty (name only in metadata `counterparty`).

### Suppliers (pay/receive, adjustment, batch settle, account settle)

- Note — supplier ledger and payments.note.
- Batch settle: commission rate and unit count — module (`supplier_settlements`).

### Partners (settle, payment, write-off)

- Notes — partner ledger.
- Partner payment: the transaction type picked — partner ledger.
- Discount / write-off reason — partner ledger (missing on the discount transaction).

### Session checkout (customer session basket)

- Payment method sent by the checkout window — **ignored by the server**.
- Basket payment lines — on the session, on no transaction (by design).
- Client phone on the extra / kept-change / waived rows.

### Void and refund

- Client name and phone — not copied from the original.
- Reason — no field in either flow.
- Refund: per-unit flags — product units only.

### Complete already (nothing missing)

Drawer top-up, top-up from drawer, drawer transfer, drawer cash-out,
checkpoint (UI not traced), Mobile Recharge top-ups other than "from a
client", Cash Out to OMT, Record Debt (suppliers), partner paper entry,
Katsh/iPick self-charge.

---

## 3. Suspected bugs — verified on the test tenant (2026-10-16)

| #   | Suspicion                                      | Verdict              | Evidence / consequence                                                                                                                                                                                                                          |
| --- | ---------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Online Brokerage "Binance fee" never sent      | **CONFIRMED, worse** | Request has no `omtFee`; payment line includes the fee, so the server refuses the send ("payment is more than the total … diff $0.37"). Any Online Brokerage send with a fee fails. Same send over REST with `omtFee` is accepted.              |
| 2   | Maintenance LBP discount lost                  | NOT A BUG            | Sent as price 500,000 → final 450,000; money and profit right; discount = price − final.                                                                                                                                                        |
| 3   | Binance fee missing from USD profit            | NOT A BUG            | Row profit 0 by design (LIRA-268); profit reports add the fee back (void moved 30-day net profit by exactly $0.43).                                                                                                                             |
| 4   | Session drops backdated time                   | **PARTLY**           | Binance in a session: the custom time is silently ignored (stamped at checkout). MTC/Alfa: no time/extra/rate in session mode by design (taken once at checkout) — but basket checkout itself has no time, so no session item can be backdated. |
| 5   | Session checkout ignores payment method        | **PARTLY**           | Money goes to the right drawer (per payment line), but each item's record says `paid_by: CASH` (e.g. Binance History shows Cash for a Whish-wallet payment).                                                                                    |
| 6   | History name edit not reflected on transaction | **CONFIRMED**        | Module record shows the new name; the transaction summary keeps the old one.                                                                                                                                                                    |
| 7   | Partner write-off reason not on transaction    | **CONFIRMED**        | Reason only on the partner statement; the write-off transaction has no reason.                                                                                                                                                                  |

Also noticed (not investigated): `/api/services/analytics` `today.commission` adds LBP and USDT amounts together.

## 4. Not traced (UNVERIFIED)

Supplier stock intake / purchase; the legacy account-settle path; session
item refund; where a gift-card code ends up on Custom Services and session
checkout; the Warranty page form; the checkpoint form fields.
