# LiraTek Feature Guide — money rules & cross-cutting invariants

**Read this before building or modifying ANY flow that writes money.** Every rule
below is enforced by at least one regression test; the _Guarded by_ column names the
e2e spec (in `frontend/tests/e2e-electron/`) or code file that proves it. If your
feature violates a rule here, a test will fail — or worse, money will silently leak.

Companion docs: [CLAUDE.md](../CLAUDE.md) (non-negotiable rules 11–17),
[e2e suite index](../frontend/tests/e2e-electron/README.md),
[transactionTypes.ts](../packages/core/src/constants/transactionTypes.ts),
[payments.ts](../packages/core/src/utils/payments.ts).

---

## 1. Module taxonomy

**Customer-interaction modules** (each writes unified transactions):

| Section                       | Code identity                                   | Notes                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS                           | `sales`, `sale_items`                           | multi-item cart, drafts, refunds                                                                                                                                                                              |
| Primary system send/receive   | `financial_services`, service_type SEND/RECEIVE | the shop's **base system** (`system_settings.shop_base_system`, default OMT)                                                                                                                                  |
| Secondary system send/receive | same table, routed **through a partner**        | the non-base system (e.g. WHISH when base=OMT); obligation lives in `partner_ledger`, never `supplier_ledger`                                                                                                 |
| Exchange                      | `exchange`                                      | USD↔LBP, direction "both"                                                                                                                                                                                     |
| Maintenance                   | `maintenance_jobs`                              | statuses: Received / In_Progress / Ready / Delivered / Delivered_Paid (there is **no** "completed" status)                                                                                                    |
| Custom services               | `custom_services`                               | includes Hold Money (HOLD_MONEY / HOLD_MONEY_COLLECT)                                                                                                                                                         |
| Recharge — MTC                | provider `MTC`                                  | credits (CREDIT_TRANSFER), days                                                                                                                                                                               |
| Recharge — Alfa               | provider `ALFA`                                 | credits, days, **Alfa Gift** (ALFA_GIFT — payload `{type, amount, cost, price}`)                                                                                                                              |
| Recharge — iPick              | provider `iPick`                                | bills + catalog items                                                                                                                                                                                         |
| Recharge — Katsh              | provider `Katsh`                                | bills + catalog items. Casing is load-bearing: the schema CHECK allows only `Katsh`/`iPick`, and SQLite compares case-sensitively — a `'KATCH'` filter in ProfitRepository once hid every Katsh sale's profit |
| Whish App                     | provider `WHISH_APP` (drawer `Whish_App`)       | transfers (send/receive) + bills/items section. Spelling is always `WHISH_APP` — the `WISH_APP` typo was migrated away in v105                                                                                |
| OMT App                       | provider `OMT_APP` (drawer `OMT_App`)           | transfers (send/receive)                                                                                                                                                                                      |
| Binance                       | provider `BINANCE`                              | send + cashout (USDT wallet)                                                                                                                                                                                  |
| Loto                          | `loto_tickets`, `loto_cash_prizes`              | ticket sales, cash prizes, monthly fees, settlements                                                                                                                                                          |

**Shop-only pages**: debts, inventory, clients, profits (admin-only), sessions,
partners, suppliers, vouchers/gift cards, expenses, closing.

**Logging/audit**: Transactions viewer (`/audit`), checkpoint timeline.

---

## 2. The unified `transactions` table

Every money action writes **at least one** row here. This is the accounting journal.

| Rule                     | Detail                                                                                                                                                                                              | Guarded by                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Identity                 | A row is identified by `source_table` + `source_id` (+ type). Never "newest row" — `created_at` is second-granular and ties are common.                                                             | lira-078, lira-092                                         |
| Multiple rows per action | One user action can write several rows: a cost/price SEND or supplier-credit op writes a `FINANCIAL_SERVICE`/`RECHARGE` row **and** an auto `SUPPLIER_PAYMENT` sibling.                             | lira-063                                                   |
| Timestamp format         | `created_at` must be SQLite `CURRENT_TIMESTAMP` format (`YYYY-MM-DD HH:MM:SS`). Never JS `toISOString()` — `'T' > ' '` in string ordering, so ISO rows sort permanently-newest for their whole day. | lira-079                                                   |
| Timestamp zone           | Stored marker-less **UTC**; render via `parseDbDate` (pins to UTC) so local wall-clock displays correctly. Raw `new Date(str)` shows hours-off times.                                               | lira-transactions-timezone                                 |
| Business date            | `transaction_time` (operator-overridable) drives by-date reports (Cash Report).                                                                                                                     | lira-087                                                   |
| Status & voiding         | `status` ∈ ACTIVE / VOIDED. Deletion = a **reversal row** of the same type with `reverses_id` → original and negated amounts. No "DELETED" types.                                                   | transactionTypes.ts, lira-092                              |
| Stamped fields           | `client_id`, `session_id`, `exchange_rate`, `profit_usd` / `profit_lbp` must be set by the creating repository — reports read them from here.                                                       | lira-094, lira-session-exchange-rate, lira-session-profits |
| Hidden types             | The viewer hides `CLIENT_CREATED` and non-credit `SUPPLIER_PAYMENT`. The `is_credit` variant ("Supplier Credit", commission revenue) stays visible.                                                 | lira-transactions-hidden-types                             |

---

## 3. IN/OUT semantics per transaction type

The green ↓ (in) / red ↑ (out) badge in the transactions table comes from
`getCashFlowDirection` in [frontend/src/features/audit/cashFlow.ts](../frontend/src/features/audit/cashFlow.ts).
**A new transaction type MUST add a case there — unmapped types render a blank badge**
(this was the B7 loto bug).

| Direction                          | Types                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **in** (customer hands us cash)    | SALE, RECHARGE, MAINTENANCE, DEBT_REPAYMENT, MTC_TOPUP, ALFA_TOPUP, LOTO, FINANCIAL_SERVICE with service_type SEND or BILL                                           |
| **out** (shop pays out of drawers) | FINANCIAL_SERVICE with service_type RECEIVE, EXPENSE, LOTO_MONTHLY_FEE, LOTO_SETTLEMENT, LOTO_CASH_PRIZE, SUPPLIER_SETTLEMENT, CREDIT_CASH_OUT, RECHARGE_TOPUP (classic from-drawer) |
| **in** (customer hands us cash)    | VOUCHER_SALE (LIRA-339 — selling a gift card; drawer legs in, an account leg books a `'Voucher Debt'`, profit 0) |
| **out** (shop pays out of drawers) | VOUCHER_CANCEL (LIRA-339 — cancelling an unused gift card; payout legs out, profit 0) |
| **in** (special case)              | RECHARGE_TOPUP with `partnerId` or `cashPaid` metadata (Whish credit acquisition — provider drawer inflow)                                                                           |
| **metadata-resolved**              | SUPPLIER_PAYMENT, PARTNER_SETTLEMENT, PARTNER_PAYMENT — direction from `metadata.counterparty.flow` (OUT→out, IN→in); SUPPLIER_PAYMENT also accepts `metadata.direction` PAY/RECEIVE; CUSTOM_SERVICE (migration v185) — `metadata.direction` "OUT" is a Via-Partner payout (the Syria transfer OUT), everything else (no partner, For-Partner, or the ordinary Via-Partner IN flow, including every pre-v185 row) is "in" |
| **both**                           | EXCHANGE                                                                                                                                                                             |

On a system SEND the row reads as cash **in only**; on a RECEIVE as cash **out only**
with the per-currency payout legs shown in the payment-legs subtext (lira-075).
**A type that can move cash either way MUST resolve its direction from metadata,
never from a fixed mapping** — SUPPLIER_PAYMENT sat in the "in" list and painted a
green ↓ on every "paid to <supplier>" row, contradicting that same row's own
"out: $2,000" legs subtext (owner-reported 2026-07-28). If the badge and the legs
line can disagree, the badge is the one that's guessing.
`isCashTransaction` (≥1 CASH leg) drives the "Cash only (till)" filter.

---

## 4. Payment legs (split payment, change, the ONE-loop rule)

Source of truth: [packages/core/src/utils/payments.ts](../packages/core/src/utils/payments.ts) +
[moneyPosting.ts](../packages/core/src/repositories/moneyPosting.ts) (`reconcileLegs`) +
CLAUDE.md rule 16.

- **The law (S1, Payment-Legs Integrity plan): a form forwards ALL legs whenever
  ANY payment line exists — never gate on split.** A single-line cash payment
  sends its one IN leg exactly the same way a split payment sends several;
  "only send legs when the payment is split" (or "only when there's a
  voucher/change leg") is the bug class itself — four forms silently dropped
  amount+currency on the common single-line case, and backend fallbacks then
  assumed tender = service currency (docs/plans/done_plans/PAYMENT_LEGS_INTEGRITY_PLAN.md).
  Read "the frontend sends all legs in ONE IPC call" below as **every line,
  every time** — not "all legs, on the occasions there happen to be several."
  There is never a follow-up call — money fixes belong in the repository.
- A leg without `direction` is **IN** (customer-paid / payout funding). `direction: "OUT"`
  marks change/return legs. `partitionLegs` splits them.
- Each money repository has **ONE shared end-of-transaction loop** that debits every
  drawer-affecting OUT leg exactly once ("Change returned"). Flow-specific branches
  must build from the **IN set only** — iterating `returnLegs` in a branch double-debits
  the drawer (caught pre-merge in C1; guarded by lira-074).
- **Reconciliation is hard-reject (S2, `reconcileLegs`).** Whenever a flow
  receives legs, it verifies — at the transaction's stamped exchange rate,
  epsilon $0.05 USD-equivalent (~5,000 LBP) — `sum(IN legs incl.
CUSTOMER_ACCOUNT) − sum(OUT change legs) − kept_change = required total`.
  A mismatch throws BEFORE any row is written, inside the flow's
  `db.transaction(...)`, so a rejected write leaves nothing partial behind.
  CUSTOMER_ACCOUNT legs count as IN — an on-account remainder is still
  "paid," just on credit (the name+phone identity requirement for account
  legs is enforced elsewhere, not by this check). No legs at all (a legacy/
  scripted caller using a bare `paidByMethod`/`cashoutMethod`) → no check;
  this is the one legitimate no-op, not a precedent for gating on anything
  else.
- **Carrier `checkoutTotal` (multi-unit cart checkouts).** A cart checkout
  (KatshForm bills, FinancialForm catalog items) submits one transaction per
  unit but books ALL legs against exactly ONE of them — the **carrier**; see
  "One payment covering N transactions" below. The carrier's own `price` is
  only that one unit's share of the cart, so reconciling legs against `price`
  would hard-reject every legitimate multi-unit checkout — the caller instead
  supplies `checkoutTotal: { usd, lbp }` (the full cart total, in whichever
  currencies it was denominated) and the repository reconciles against THAT.
  Omitted → unchecked (single-unit checkouts, scripted callers). The void-path
  gap this per-unit/carrier split still leaves open is tracked in
  docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md.
- In the stored row, OUT legs carry **negative `signed_amount`**; `amount` is absolute.
  Same-currency IN legs are kept separate (no premature merge) — lira-064.
- Legs are returned structurally by `TransactionRepository.getRecent` (`payments[]`)
  and appended by the viewer — never baked into the stored `summary` text (lira-064).
- Internal legs (COMMISSION, PM_FEE, TRANSFER, CREDIT_RETURN, CREDIT_USED, SMS_COST,
  provider cost outflows) must **not** surface as customer-facing legs (lira-064, lira-078).
- **Every form that collects a payment line must forward its change legs —
  regardless of whether the payment was split.** Loto, Alfa Gift, and custom
  services each lost them once (page never wired Return/Change, component
  didn't forward `onReturnChange`, repository ignored `data.payments`) —
  lira-088.
- On a split RECEIVE payout, **each leg debits its own drawer in its own currency**
  (a $190 + 540,000 LBP payout debits both) — lira-074.
- `NON_DRAWER_METHODS` = { CUSTOMER_ACCOUNT, GIFT_CARD } — these legs never touch a drawer.
- **Counterparty overpayment goes to the account (LIRA-313, owner 2026-10-12).** On
  Supplier Pay / Receive (`recordSupplierCashflow`) and Partner settle, an OUT leg is
  change handed back and moves the drawer OPPOSITE to the flow; the ledger books the
  NET (paid − change, per currency for suppliers; `partnerSettlementNet` for
  partners). Change NOT handed back emits no leg (`MultiPaymentInput`
  `unreturnedChangeTo="ACCOUNT_BALANCE"`) and simply stays on the balance, which may
  cross zero. Debts → Cash Out above the credit books the excess as a `'Manual Debt'`
  row in the same (non-reversible) CREDIT_CASH_OUT transaction. Guards:
  `SupplierRepository.cashflowChangeLegs`, `PartnerSettlement.changeLegs`,
  `DebtRepository.cashOutBeyondCredit` (core jest). Voiding a supplier PAY gives back
  purchase coverage by the same SIGNED net (`_unapplySupplierPurchaseCoverage`), never
  `|usd| + |lbp|`, which would over-unwind when the change came back in the other currency.
  **Supplier settlements too (LIRA-315, owner 2026-10-13):** `settleTransactions` and
  `settleAccount` share `_resolveSettlementLegs` — CASH-only change legs (a wallet IN leg
  "returned" through another wallet would wash money between drawers, Finding A), no
  underpay, change ≤ overpay — and `_bookSettlementOverpay` books the extra as one
  `supplier_ledger` row per currency (PAY → −extra `PAYMENT`, COLLECT → +extra
  `SUPPLIER_PAYS_US`), linked to the settlement's transaction so its void removes it.
- **One payment covering N transactions**: legs must book against exactly ONE of
  them (the carrier); the others are sent with `deferPayment: true` (skips the
  inflow and change-leg blocks, still books cost outflow + supplier commission).
  This is how session baskets and multi-bill checkouts work — attaching the same
  legs to two transactions double-books the drawer (lira-095,
  lira-session-basket-payment). See "Carrier `checkoutTotal`" above for how the
  carrier's required total is computed in a multi-unit cart.

### 4.1 Kept change — one prop, one helper (owner decisions 2026-10-07)

Kept change = the cash handed back (or handed out) is **less than due**, and
the difference stays with someone. It is built ONCE: module pages declare who
pays, module repositories call one helper. Never re-implement the math in a
page or a repository.

**UI — `MultiPaymentInput`'s `payer` prop** (`@liratek/ui`;
`PaymentSheet` and `CounterpartySettleModal` forward it). One declaration
decides whether the change fields show, the kept math, the note copy, what
`onKeptChange` reports, and whether OUT legs can exist. Kept change stays
opt-in: nothing is reported unless the page wires `onKeptChange`.
`direction="payout"` is a deprecated alias of `payer="payout"`; `payer` wins.

| `payer` | Who pays | Change fields | Kept change means | Note copy |
| --- | --- | --- | --- | --- |
| `"customer"` (default) | customer → shop (POS, recharge sale, OMT SEND, debts, …) | on overpay; change back = OUT legs | shop **profit**, uncapped | "Keeping X as profit" / "Change kept (profit)" |
| `"payout"` | shop → customer (OMT/Whish RECEIVE, Binance cash-out, app RECEIVE, credit buy-back, Debts credit cash-out, Exchange) | never; **no OUT legs ever** | shop **profit**, only a shortfall up to and including `PAYOUT_KEEP_CHANGE_MAX` = `SHORTFALL_MAX` ($5 / 450,000 LBP, compared in the payout's own currency via `isWithinShortfallMax`; LIRA-310 owner decision 2026-10-11), payout currency only | "Keeping X as profit." |
| `"shop"` | shop → outsider (Expenses) | on overpay; change the outsider hands back = OUT legs (cash coming INTO the drawer) | **added to the cost**, never profit | "Not returned: X — added to the cost." |

**Server — `resolveKeptChange`** (`packages/core/src/repositories/keptChange.ts`,
Node-only, not exported from `browser.ts`). Same three payer kinds. It
replaces the flow's own `reconcileLegs` call (it runs the same S2
equation), checks the client's claim, and returns what to book:

- customer: `IN − OUT − kept = due`; returns `keptUsd/keptLbp` → ADD to the
  transaction's own `profit_usd`/`profit_lbp` stamp (per currency, never
  converted, never a separate field — so the generic void/refund negates it).
- payout: refuses any OUT leg; `paid = owed − kept`; kept at most the cap
  ($5 / 450,000 LBP inclusive, `isWithinShortfallMax`), in
  the payout currency, only when the lines are really short. Same
  `keptUsd/keptLbp` → profit stamp. `postPayoutLegs` takes the validated
  kept as an optional `keptChange` (default 0).
- shop: `handed − returned − notReturned = bill`; returns `costUsd/costLbp`
  (= handed − returned per currency) and `notReturned*`; `keptUsd/keptLbp`
  are always 0.
- every kind: refuses kept on a FOR-partner transaction; refuses a claim
  above the real excess even when it fits inside the $0.05 reconcile
  epsilon; reconciles at the client's tender rate when sent (rule 27).

Exchange uses `resolveKeptChange` (payer "payout") for the CHECK and keeps its own `kept_profit_usd` booking. Hold Money's two-currency pickup uses the payout variant `perCurrencyNoCap: true` (kept per currency, no cap, claim must equal owed − handed). Refusal text comes from `reconcileLegs` itself (plain sentence, then the technical detail in parentheses) — never wrap it again.

**Funding rule** (owner decision 2026-10-07). Kept change must be real drawer
money the shop is holding back — cash or wallet (OMT, WHISH, Binance, …;
`isDrawerAffectingMethod`) — never the customer's own account debt, store
credit or gift card. It applies only when something is kept. Customer pays:
`kept ≤ (drawer IN − drawer OUT) − max(0, expected − (non-drawer IN − non-drawer OUT))`,
all USD-equivalent at the tender rate — non-drawer legs are applied to the
total first, so only drawer money beyond what the total still needs can be
kept (cash $20 for $10 with $5 credited back to the account, keep $5 ✔;
WHISH $25 for $20, $3 cash back, keep $2 ✔; account $15 for $10, keep $5 ✘;
account $15 + cash $5 for $10, $5 back, keep $5 ✘). Shop pays (Expenses): the
same formula on handed/returned/bill, and any returned leg must be a drawer
method. Payout: every payout leg must be a drawer method. Refusals open with
one plain sentence for the cashier, followed by the technical detail in
parentheses.

**Change to the account (POS + Maintenance, 2026-10-13):** the shared
CheckoutModal sends change the cashier did not hand back as one OUT
`CUSTOMER_ACCOUNT` leg per currency (cash change stays `change_given_usd/lbp`).
`SalesRepository` and `MaintenanceRepository.processPayments` book it as a
`CREDIT_DEPOSIT` "Change returned" linked to the transaction (reversed by the
generic void/refund), include it in the reconciliation's OUT side, refuse any
other OUT leg method, and drop it on a session-basket (deferred) checkout.
Guard: `MaintenanceRepository.changeToAccount.test.ts`.

**Where it applies today:** customer — POS, Maintenance, session checkout,
Custom Services (Debts repayment no longer keeps change: unreturned change is
the customer's account credit — LIRA-308 owner answer 1, 2026-10-11; since
LIRA-313 the return fields start full, "Return change" being the default, and
"To account" empties them), recharge/OMT sales; payout — OMT/Whish
RECEIVE, Binance cash-out, app RECEIVE, credit buy-back, Whish top-up from a
client, Debts credit cash-out, Hold Money pickup (one currency: capped at
$5 / 450,000 LBP inclusive as above; both currencies: kept per currency with NO cap — handed ≤ held in each
currency and the claim must equal held − handed; owner decision 2026-10-07),
refunds of SALE, DEBT_REPAYMENT, FINANCIAL_SERVICE, RECHARGE, CUSTOM_SERVICE,
MAINTENANCE and LOTO (one currency, cash or wallet return lines, kept up to
and including $5 / 450,000 LBP; the five module
types record the kept part as `metadata_json.refund_kept_change_usd/lbp`, read by
`ProfitRepository.getRefundKeptChangeProfit`); shop — Expenses. Kept change is
refused on partner transactions — except a customer session basket, which may
keep change even when it holds a For-Partner item (owner decision 2026-10-07);
a For-Partner item contributes 0 to the basket's customer charge
(`utils/sessionForPartnerItem.ts`) and its own partner posting is unchanged.

**Migration checklist for a module** (one module per change):

1. Page: pass `payer` (and drop any `direction="payout"`); wire `onKeptChange`
   only if the repository is migrated in the same change. Build the payload
   once (rule 22) with `kept_change_usd`/`kept_change_lbp`.
2. Schema: kept fields present in the shared core validator AND the desktop
   preload type (rules 12, 23) — three-way key diff before wiring.
3. Repository: call `resolveKeptChange` inside the `db.transaction(...)`
   before any write, in place of `reconcileLegs`; pass `isForPartner` and
   the client's `tender_exchange_rate`; add `keptUsd/keptLbp` to the
   transaction's profit stamp (or `costUsd/costLbp` to the expense amount for
   `payer="shop"`). Never trust `data.kept_change_*` directly.
4. Payouts: stop sending OUT legs from the page (the helper refuses them) —
   fix the page and the repository in the SAME change (POSTING_MAP G43).
5. Tests: failing-first (rule 17) — accepted kept books profit/cost; tampered
   kept rejected; void nets drawer + profit + ledger to 0 per currency
   (rule 20); a web-mode run (rule 19).

---

### 4.2 Extra charges (LIRA-319, owner decisions 2026-10-13)

An extra is an amount the cashier adds ON TOP of a sale's total — the
opposite of a discount ("− Discount | + Extra" switch on the payment box's
Discount line, `DiscountLine` / MultiPaymentInput `onExtraChange`). It is
stored on the unified row as `transactions.extra_usd` / `extra_lbp` (v212):

- **In the amount, out of the profit stamp.** The row's `amount_*` includes
  the extra (what the customer owes and pays), so payment legs, drawers,
  client debt and the generic void move it with no extra code. `profit_*`
  never includes it, so item / service margins stay honest. Profits reports
  it as its own "Extra charges" row from `extra_*` through ONE fragment
  (`extraChargeProfit` in ProfitRepository) — never read
  `metadata_json.extra_*` for money (a full refund copies the original's
  metadata).
- **Module tables are unchanged** (`sales.final_amount_usd`, labour, loto
  face value, recharge price, provider fee, commission, supplier / partner /
  LOTO ledgers): the extra is shop money in the drawer of the customer's
  payment method, never supplier money.
- **Server rules** (shared messages in `validators/common.ts`): a discount OR
  an extra, never both; not above the pre-extra total; not on for/via-partner
  or payout rows, balance payments (Debts / Supplier / Partner settles) or a
  session-basket ITEM (`deferPayment`); in the sale's currency. Schema fields
  are optional with NO `.default()` (offline replay).
- **Session basket:** one `EXTRA_CHARGE` row per basket (no-money, amount =
  extra, profit 0, in `NON_REVERSIBLE_TRANSACTION_TYPES`), linked like
  `KEPT_CHANGE`; reversed with the basket.
- **Reversal (rule 20):** void — the original leaves profit queries; full
  refund — the REFUND row carries `−extra`; item refund — the share by the
  line's share of the sale (server-computed, `_computeSaleItemRefundAmounts`),
  REFUND row `−share`; undo re-adds it. A refunded share lands on the refund's
  own day.

### 4.2.1 Round-up overpays (LIRA-334, owner decisions 2026-10-18)

The cashier rounds to the notes in the drawer: 102.90 owed, 103.00 handed.

- **Payout (shop hands money out).**
  - The payment box accepts an overpay up to the shared cap (`isWithinShortfallMax`, $5 / 450,000 LBP in the payout's own currency). It shows it ("Rounded up … — booked as change rounding", `payout-roundup-summary`) and reports it through MultiPaymentInput's opt-in `onRoundUpChange`.
  - The page sends `rounding_given_usd` / `rounding_given_lbp` (schema `roundingGivenFields`, optional, no default).
  - The repository verifies it with `resolveRoundingGiven` (legs = owed + rounding). It is refused together with kept change, on FOR-partner, session-basket, account and wallet payouts, and on two-currency Hold Money pickups.
  - It then books the rounding with `bookPayoutRoundingExpense`: one books-only "Change rounding" expense linked to the payout. That expense is hidden in Transactions by default (rule 26), shown on Expenses, and counts in Expenses Deducted.
  - The module's profit stamp never moves.
  - Reversal: the generic expense cascade. Hold Money is the exception: `voidPickup` calls `voidLinkedExpenses`.
  - Debts cash-out is excluded (`payoutExcessToAccount` sends the excess to the account).
- **Customer pays.**
  - When the legs exceed the total by up to the same cap and no discount is typed, the "+ Extra" side of the Discount line is filled in with the difference (`suggestRoundUpExtra`, one helper for MultiPaymentInput and CheckoutModal). It is then saved as an ordinary extra charge (§4.2).
  - Clearing the extra, or switching to "− Discount", stops the autofill until the legs change, and the change box returns.
  - The autofill only runs where Extra is allowed (no partner sale, session-basket item or settle).

### 4.2.2 Customer adds change on payouts (LIRA-336, owner decisions 2026-10-18)

Example: $197 owed. The customer hands $3 (or 268,500 LBP) and the shop hands out $200.

- **Screen.** The payout's IN section (`counterFlow`, `useLinesSection`) takes money above its target when `counterFlow.allowAddedChange` is set. Screens with no customer section use `counterFlow.optional` (target 0, hidden behind "+ Customer gives change").
  - MultiPaymentInput folds that amount, converted into the payout currency at the sheet rate, into the payout target. This happens BEFORE kept change and the LIRA-334 round-up, so the customer's money is never booked as rounding.
  - The amount is reported through `onAddedChange` and shown as "Owed … + customer gave … = …".
  - Only money that really came in (cash or wallet) counts. Account and forgiven amounts never do.
- **Server.**
  - The screen sends the customer's lines (`customerPayments`, or `feePayments` on WHISH system receive with the fee on top) plus the claim `added_change_usd/lbp` (payout currency, ≤ $5 / 450,000 LBP).
  - `resolveAddedChange` (repositories/addedChange.ts) measures the lines with `measureCustomerLegs` (`allowAddedChange`), converts at the payout rate, and checks the cap and that the claim matches.
  - The flow then reconciles the payout legs against owed + added (− kept + round-up) and writes the customer's lines as incoming `payments` rows into their own drawers.
  - Amount, profit, `cashPaid` and the hold portion never change. No claim means exactly today's behaviour.
  - Refused for payouts made for a partner (FOR), in sessions, to the customer's account or a wallet, and on two-currency Hold Money pickups.
  - Exchange allows it only when both currencies are USD/LBP.
- **Reversal.** The customer's lines are ordinary payment rows on the payout's transaction, mirrored by `_reversePayments` (Hold Money: `voidPickup`). No new reversal owner.
- **Phase 2 (owner 2026-10-19).**
  - **Through a partner.** On an OMT/Whish system receive through a partner (THROUGH), added change works the same way. The customer's lines and the payout use the partner system's cash drawer (General), and the partner ledger is unchanged because it depends only on the transfer amount.
  - **Wallet payout.** When the payout is made by wallet (e.g. Whish_App −200), the customer's cash lines go into their own drawer. On OMT/Whish system receive the wallet payout posts line by line only when added change is claimed; without a claim, the legacy single wallet debit is unchanged.
  - **Sessions:** separate ticket.

### 4.3 "Customer pays" — the money-in side of payout screens (LIRA-321)

Exchange, Whish App / OMT App receive and Binance cash-out pay money OUT
(`payments[]`, `cashoutMethod`, kept change — all unchanged). What the customer
hands over is the IN side, sent as **`customerPayments[]`** — every "Customer
pays" line, the fee line included (`{ method, currencyCode, amount }`, no
`direction`). One fragment, `customerPaymentsField` / `customerLegSchema`
(`validators/customerLegs.ts`), spread into both exchange schemas and
`createFinancialServiceSchema`; it also carries `customer_waived_amount` ("Forgive"
on screen = "waived" in code).

- **Never together with `feePayments[]`** (schema refine). `feePayments` stays
  accepted, untouched, for old clients and offline replay; on financial services
  `customerPayments` is RECEIVE-only on `WHISH_APP` / `OMT_APP` / `BINANCE`, not
  For-Partner, not in a session basket. `feeCollectedSeparately: true` states
  that the fee is one of the lines (expected = transfer + fee); OMT App never
  takes a fee (D1), so its expected total is the transfer. Exchange: every line
  is in `fromCurrency`, refused in For-Partner mode, and carries `clientId`
  (v215 `exchange_transactions.client_id`, also stamped on the unified row).
- **One writer: `bookCustomerLegs`** (`moneyPosting.ts`), the same predicate for
  the check and the posting (§13 item 15). It refuses **before any write**:
  an OUT leg, a non-drawer method other than `CUSTOMER_ACCOUNT` (e.g. GIFT_CARD),
  an account line with no client, mixing two non-USD currencies, **overpay**
  (lines above the total are never accepted), a shortfall not covered by an
  account line or forgive, and a forgive above `SHORTFALL_MAX` ($5 / 450,000 LBP,
  `isWithinShortfallMax`). Then each drawer line posts its own drawer/wallet
  (`drawerFor`), and the account lines book once as `'<Module> Debt'` via
  `bookClientDebtCharge` — **`'Exchange Debt'`** (new, in
  `MODULE_DEBT_TRANSACTION_TYPES`) or `'Service Debt'`. **USDT counts 1:1 as USD;
  any other currency (EUR…) is owed as its USD equivalent** at the screen's rate.
- **Provider's own wallet stays internal.** On an app/Binance receive a line paid
  into the provider's own wallet is stored with the provider code
  (`storedMethodFor`: WHISH → `WHISH_APP`, OMT → `OMT_APP`, `BINANCE`) so it
  remains an `INTERNAL_LEG_METHODS` leg, exactly like the single inflow row it
  replaces. Other lines (Cash, another wallet) keep their own method and drawer.
- **Forgive** is recorded by the shared `bookForgivenShortfallSibling`
  (`forgivenShortfall.ts`): one LIRA-310 `WAIVED_SHORTFALL` row, amount 0, profit
  −forgiven, linked to the parent unified row, `is_auto` (rule 26).
- **Reversal owners (rule 20):** drawer lines — generic `_reversePayments`; account
  lines — generic `_cancelDebt` (both debt types are whitelisted); the forgive
  sibling — `TransactionRepository._cascadeWaivedShortfallSiblingVoid` on the
  parent's void AND refund. Create + refund nets to 0 per currency.
- **Profit:** amounts never change because something is owed. An exchange counts
  at once; a receive with a `'Service Debt'` waits for repayment (DBT-1).
- **UI rule — no automatic cash leftover without a client** (`useLinesSection`,
  packages/ui). Typing less than the total adds an account leftover line ONLY
  when the account is offered (client picked); otherwise no line is added (a
  cash one would balance on money never handed over), the gap stays unaccounted
  and Confirm stays off. Overpay is never auto-corrected; the server stays
  authoritative.
- **Guards:** core — `validators/__tests__/{customerLegs,exchange.customerPayments,financial.customerPayments}.test.ts`,
  `moneyPosting.bookCustomerLegs`, `ExchangeRepository.customerPayments`,
  `FinancialServiceRepository.{receiveCustomerPayments,binanceCustomerPayments}`,
  `TransactionRepository.{exchangeCustomerPaysReversal,receiveCustomerPaysReversal}`,
  `DebtRepository.exchangeDebtRepayment`, `ProfitRepository.exchangeDebt`,
  `v215.exchangeClientId`, `moduleDebtTypes.guard`; frontend —
  `Exchange.customerPays`, `HistoryModal.linkedClient`,
  `OmtWhishAppTransferForm.customerPays`, `Recharge.binanceCustomerPays`; web e2e —
  `lira-web-061` (exchange), `lira-web-062` (Whish App receive), `lira-web-064`
  (Binance receive).

## 5. Payment methods & CUSTOMER_ACCOUNT

- The account gate requires **client name + phone** — use `canChargeToCustomerAccount`
  from `@liratek/ui` (`packages/ui/src/utils/customerAccount.ts`) in every payment form.
- **One account model: OPEN DEBT, everywhere** (lira-093, revised 2026-07-09) — every
  module that takes a payment (POS, custom services, loto, telecom recharge,
  maintenance, sessions, **and financial services**: OMT/WHISH system, iPick/Katsh
  catalog+bills, OMT_APP/WHISH_APP, Binance) treats CUSTOMER_ACCOUNT as **on-account
  debt**: the transaction is processed in full — provider/system drawers move exactly
  as they would for any other payment method — and the unpaid portion books a
  `debt_ledger` row (client's debt **increases**); collection happens later. A fresh
  client with **no prior balance** may charge to account — there is no balance
  precondition to satisfy first.
  - Previously (until 2026-07-09) financial services used a separate PREPAID CREDIT
    model that validated CUSTOMER_ACCOUNT against the client's existing negative
    balance and rejected a fresh client outright ("Not enough balance…"). That model
    is retired — `DebtService.validateCustomerAccountAvailability` was removed; the
    repository-level debt booking (`FinancialServiceRepository.createTransaction`,
    `debt_ledger.transaction_type = 'Service Debt'`) already did the right thing and
    is now unconditional.
  - `DebtService.useCredit` / `DebtService.cashOut` are unrelated, separate manual
    Debts-page actions that genuinely spend/withdraw a client's existing prepaid
    credit (`debt_ledger.transaction_type = 'CREDIT_USED'`) — not touched by this
    change and not reachable from any payment form.
- **Gift card sales on account (LIRA-339):** a voucher sale's CUSTOMER_ACCOUNT leg
  books ONE `'Voucher Debt'` per currency on the VOUCHER_SALE id (in
  `MODULE_DEBT_TRANSACTION_TYPES`); the owner needs a name + phone like any account charge.
- Only **IN** CUSTOMER_ACCOUNT legs book debt; an OUT CUSTOMER_ACCOUNT leg is a
  store-credit deposit (payments.ts).
- GIFT_CARD is prepaid/collected value: debt-like for drawer purposes but **excluded
  from account debt** in session allocation, so a gift-card-paid sale realizes
  (lira-session-allocation).
- POS partial payment books a debt row only when `client_id` is present and the
  shortfall exceeds **$0.05** (SalesRepository).
- Debt repayment uses the smart-rounding algorithm (see README → Business Logic).
- **Repayment modal — ticks and amount in step (LIRA-308, owner decisions 2026-10-11):** every
  open item opens ticked; the amount fills to the ticked sum minus any discount, capped at the
  ledger due (MultiPaymentInput `fillTotals`, while `totals` stays the whole due so a bigger amount
  is a payment, not change); a tick change resets the amount (`fillKey`), typing never unticks;
  nothing ticked disables Confirm (only when items are listed — a Manual-Debt-only client has no
  picker and stays payable). **Owner answers 2026-10-11 (binding):**
  (1) **Unreturned change is account credit, never profit.** An amount above the whole due is
  change; the cashier types what is handed back (the return fields start EMPTY) and whatever is
  NOT entered becomes the customer's account credit (MPI `unreturnedChangeTo: "CUSTOMER_ACCOUNT"`
  → one more OUT CUSTOMER_ACCOUNT leg → `CREDIT_DEPOSIT` "Change returned" linked to the
  repayment, reversed by its void/refund — no second credit path). Small rounding overpays
  (an LBP note above a USD due) follow the same rule, in the tender's currency. Debt repayments
  therefore no longer keep change as profit (§4.1's customer row no longer applies to the
  Debts page; cash-out keeps its payout keep). (2) **Earlier balance line.** The part of the
  balance no listed item accounts for (Manual / imported / opening debt) is listed as its own
  line, `kind: "balance"` ("Earlier balance (no items)", `DebtRepository._earlierBalanceItem` =
  ledger balance − Σ open items per currency, cross-netted at the sell rate, ignored below
  5¢ / 5,000 LBP; only next to listed items). Ticked, the allocation pays it as the OLDEST
  item (after cash-drawer items); it is never routed and has no row to cover (the repayment's
  own ledger row is the whole effect, so its void/refund is the reversal owner — rule 20);
  unticked it stays the implicit remainder after every item, so untargeted callers and
  write-offs are unchanged. `addRepayment` measures it WITHOUT its own just-inserted Repayment
  row; a bundled discount gets the remainder after the cash. (3) **Lines are kept on a tick
  change**: only the total changes and the LAST payment line absorbs the difference (removed
  if it would drop to ≤ 0, the previous line then absorbs; never below zero) — MPI `fillKey`.
  Guards: `debtRepaymentAllocation.lira308.test.ts`, `debtRepaymentAllocation.lira308balance.test.ts`,
  `DebtRepository.lira308.test.ts`, `DebtRepository.lira308balance.test.ts`,
  `MultiPaymentInput.lira308OwnerAnswers.test.tsx`, `Debts.lira308TicksAmount.test.tsx`, lira-web-051.
- Debts Excel import is idempotent — re-importing the same file books nothing (lira-080).
- **Mixed per-currency balances** (lira-097): the client balance is the raw
  per-currency `debt_ledger` sum (`debt:client-balance`) — a client can hold a
  USD **credit** and an LBP **debt** at once (they may even net to ~0
  converted). NEVER branch UI or validation on the converted net or the USD
  sign alone: the Debts panel gates **Settle Debt** and **Cash Out** each on
  its own side (both render for a mixed account, tables get combined
  "Purchases & Charges" / "Payments & Deposits" labels), the post-repayment
  keep-selected check is per-currency, and `DebtService.cashOut` caps the
  payout per currency. Backend corollaries (DebtRepository, guarded by
  `DebtRepository.serviceDebtRouting.test.ts`): Service-Debt provider routing
  moves repayment money into `OMT_System`/`Whish_System` only up to the
  client's **outstanding** service debt (per-provider total minus previously
  routed), and a cash-out with no explicit legs emits default CASH legs **per
  currency** — a USD-only default silently skipped the LBP drawer debit.

---

## 6. Client propagation (CLAUDE.md rule 11)

Any form with a client name/phone field must thread `client_id` through
**UI state → IPC payload → handler → service/repository → `createTransaction({ client_id })`**.
One missing link and the transactions table shows "—".

- `financial_services.client_id` (+ sender/receiver fields) is written **once at INSERT**
  and never back-stamped; the resolved primary client lands on the **unified transactions
  row** (lira-063).
- Providing an unknown name+phone **auto-creates** the client.
- OMT App / Whish App transfers allow a fully null client (optional fields) — lira-063.
- **Session flavor**: the checkout replay (`sessionHandlers.processCartItem`) spreads
  each cart item's stored `formData` **verbatim** and never injects the session client.
  Propagation therefore depends on each page's session branch putting the client into
  `formData`. All 23 sessionable flows are swept by lira-094. (Alfa Gift has no session
  branch and no client UI — known gap.)

---

## 7. Drawers

Drawers: `General` (till), provider stock drawers (MTC, Alfa, Katsh, iPick), app
wallets (`OMT_App`, `Whish_App`, `Binance`), plus the **primary cash drawer (PCD)** —
`OMT_System` when `shop_base_system = 'OMT'`, `Whish_System` when `'WHISH'`
(`PRIMARY_CASH_DRAWER_NAMES` / `primaryCashDrawerName()`,
`packages/core/src/constants/systemFloatDrawers.ts`).

| Rule                                                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Guarded by                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| App-wallet movement                                                       | SEND: app wallet −, General + · RECEIVE: app wallet +, General −. Binance is the reference implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | lira-077                                                                                    |
| PCD is physical cash, not a float (primary-cash-drawer model, 2026-07-30) | `OMT_System`/`Whish_System` holds the **banknotes physically inside the dedicated money-transfer drawer at the counter** — the same kind of countable cash as `General`, counted at closing the same way (no dormant/hidden special-case; the non-primary system's drawer just sees no traffic). There is no in-system provider balance to track. The owner rejected that idea the day after describing it, on review: _"we dont have omt system balance.. no need for another drawer. we can use our omt system drawer"_ and _"I don't really care about this float model … I think the float model is something wrongly implemented"_ (2026-07-30) — superseding the spendable-float semantics PR #66 shipped the day before (history box below). Every cash leg of a primary-system SEND/RECEIVE — customer payment `(x+f)`, RECEIVE payout `x`, change/return legs, the customer fee — routes to the PCD via `resolveServiceCashDrawer(method, ctx)` (`packages/core/src/utils/payments.ts`) whenever the transaction runs on the primary system (`ctx.provider === ctx.baseSystem`, string equality; partner-or-not is **not** part of the predicate). App wallets/Binance fall through untouched (`"OMT_APP" !== "OMT"`). A FOR-partner OMT/WHISH RECEIVE **or SEND** (runs on the primary system, on a partner's behalf) moves **no drawer at transaction time** — obligations only (a gross supplier-ledger entry, §8, plus a partner-ledger entry; SEND since owner decision 2026-10-06, LIRA-258, §8.1.0); the partner's later collection/settlement pays out of or into the PCD. | `OmtSystemFeeCharacterization.test.ts` — being re-derived to the §8.1 table (rule 17)       |
| PCD may go negative — nothing is blocked (owner, 2026-08-01)              | **No drawer operation anywhere refuses**: not a RECEIVE payout, not a drawer↔drawer transfer. Every drawer in this system could already go negative, and blocking a live payout strands the operator mid-sale with a customer waiting. A negative PCD is not an error — a physical cash box cannot hold one, so it means cash was taken from another drawer and the transfer was never recorded. It is an **unrecorded transfer**, surfaced where it can be fixed: `DrawerTopUpModal` lists every negative drawer per currency with a "Cover it" button that aims the transfer at it and pre-fills the clearing amount. The earlier `InsufficientDrawerFundsError` guard (plan §8.5) is DELETED — do not reintroduce a balance check here. Note this is NOT the float model's "spendable overdraft" either: that meant spending the provider's money, this means the app is one unrecorded move behind the cash box.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `DrawerTransfer.test.ts` (e), (e2) — overdraw posts AND conserves money across the pair     |
| PCD legs are customer-facing cash                                         | The float model's `TransactionRepository` predicates that folded `OMT_System`/`Whish_System` legs OUT of customer-facing cash-flow (an `endsWith("_System")` check + a `NOT LIKE '%\_System'` filter) are dropped — a PCD leg is real till cash now, so it MUST appear in the in/out cash-flow summary (§3), D1 cash-flow, receipts, and the refund-override candidate set, exactly like a `General` CASH leg. `INTERNAL_LEG_METHODS` (method-based, e.g. COMMISSION/PM_FEE/TRANSFER) and `PROVIDER_STOCK_DRAWERS` (MTC/Alfa/Katsh/iPick) are unrelated and unchanged — this row is only about the two drawer-NAME predicates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `TransactionRepository` specs — WILL be re-derived; `PRIMARY_CASH_DRAWER_PLAN.md` §2 item 4 |
| Debt repayment → PCD (LIRA-304, owner decisions 2026-10-10)              | A repayment's cash moves into the PCD for open **primary-system** transfers only (never the secondary system, never OMT App / Whish App / Binance), for basket members and separate visits alike. ONE calculation, `allocateRepayment` (`utils/debtRepaymentAllocation.ts`, shared with the repayment screen's "Goes to" preview): ticked items first (a ticked transfer's share is routed, any other ticked item is not), then "OMT drawer first". **LIRA-308 (owner decisions 2026-10-11):** inside the ticked items, cash-drawer items (`isCashDrawerItem` = an open primary-system transfer, the same predicate as the picker's badge) are paid first, then oldest; the cashier's ticks come before `auto` targets (items an amount above the ticked sum reached, `planRepaymentTargets`), and a bundled discount covers the same targets in the same order. The no-target order (sales first, then oldest) is unchanged for write-offs and untargeted callers; capped per transfer at its amount minus what earlier still-standing repayments routed, stored per transfer in its own currency (`metadata_json.routed.by_transfer`) so a rate move never reopens the cap; only cash-family legs are routed, in the currency paid (LBP for a USD transfer goes in as LBP). Written as an internal `RESERVE` pair (paying drawer −x, PCD +x) — internal legs are mirrored exactly by any void/refund, even a method-override refund. A refunded repayment stops counting as routed. | `DebtRepository.lira304Routing.test.ts`, `DebtRepository.lira304Reversal.test.ts` |
| SMS cost                                                                  | MTC/Alfa credit transfer debits provider drawer by amount **+ SMS cost** = `ceil(amount/3) × $0.16`; converted to LBP for LBP transfers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | recharge.spec, lira-090                                                                     |
| Currency of payment                                                       | Book what the customer actually paid — an LBP-priced ticket paid in USD credits General **USD**, no phantom LBP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | lira-082                                                                                    |
| Read APIs                                                                 | `dashboard.getDrawerBalances()` → general/omt only. `recharge.getDrawerBalances()` → all drawers, name-keyed. `closing.getSystemExpectedBalancesDynamic()` → expected balances.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | fixtures/specs                                                                              |

> **Model status as of 2026-07-30.** The authoritative spec for the current model is
> `docs/plans/done_plans/PRIMARY_CASH_DRAWER_PLAN.md`; this section and §8/§8.1 describe
> its target shape. PR #66's _structural_ fixes are kept, unchanged: no double-debits,
> drawer-name-agnostic reversal, settlement that nets to zero, the invariant-asserting
> test harness. Only the _semantics_ changed — where the cash lands (a real drawer, not a
> provider-side balance) and what the supplier ledger tracks (gross again, §8). Every
> number in the historical box below is being re-derived failing-first (rule 17) as the
> plan's phases land — check `PRIMARY_CASH_DRAWER_PLAN.md` §4 for the current gate status
> before trusting a specific figure over what is actually in the repository.

<details>
<summary><strong>Historical — PR #66 float-model execution status (superseded 2026-07-30, kept for record)</strong></summary>

> The float model — `OMT_System`/`Whish_System` as a spendable in-system balance, SEND
> `−x`/RECEIVE `+x` legs, fee-only supplier ledger — shipped in PR #66 and was fully
> executed and verified before the owner rejected its semantics the next day. Recorded as
> of 2026-07-29/30, for the historical record only; none of the specifics below describe
> current code.
>
> All core-jest specs listed as stale in an earlier draft of this box
> (`crossCurrencyTender`, `legReconciliation`, `sessionCashoutGuard`, `partner`,
> `receiveSplitPayout`, `supplierLedgerAmount`) were migrated to the float-model numbers,
> along with `PostRefactorVerification`, `saleCost` and `CounterpartyMetadataContract`
> (three files no enumeration caught — they surfaced only when the suite was actually
> run). The RECEIVE customer-fee UI existed: `Services/index.tsx` passed `includingFees`
> unconditionally and sent `omtFee`/`whishFee` on RECEIVE.
>
> **Executed:** `packages/core` jest 1190/1190 (112 suites), `yarn typecheck` clean across
> all workspaces, `scripts/check-tenant-scoping.mjs` 0 violations / 629 statements.
> **NOT executed:** desktop e2e, web e2e, frontend/backend jest, `yarn lint`.
>
> **Rule 17 — debt cleared 2026-07-30 for the float model.** All 18 `TODO(rule-17)`
> markers on the float-model assertions were proven failing-first (production change
> reverted one at a time, guard confirmed red for the right reason). That discipline —
> not the specific numbers — is what survives into the current model's own re-derivation.
>
> **Cutover as planned for the float model (superseded):** settle all OMT/Whish balances
> to zero, then re-seed via Initial Drawer Amounts. **Superseded by decision #14 in
> `PRIMARY_CASH_DRAWER_PLAN.md`**: the owner instead wipes the database and starts fresh;
> opening PCD balance is set by physical count via Initial Drawer Amounts / the setup
> wizard. No balance/data migration is needed for that install; schema migrations
> (`create_db.sql` + `migrations/index.ts`, rule 10) still ship for the upgrade path and
> multi-tenant web.

</details>

**Commission never moves a drawer at transaction time** (COMMISSION_AT_SETTLEMENT_PLAN.md D9). Supplier
commission (OMT/WHISH transfers, Katsh bills) is entered at settlement (§8.1) and
reaches the books as a supplier-ledger credit or, for a bills-only batch, as the
provider's own drawer top-up. No form or repository adds a "commission" drawer leg at
transaction time — the PCD already holds the gross cash, and an extra leg re-creates
the Loto 2× mint.

---

## 8. Supplier and partner ledgers

Balance = **SUM of ledger rows**; **> 0 = shop owes supplier** ("You owe", red).

| Rule                                                                     | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Guarded by                                                                                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry signs                                                              | `TOP_UP` positive; `PAYMENT` negative; `ADJUSTMENT` signed either way (opening balances); `SUPPLIER_PAYS_US` signed by direction of obligation (a Katsh BILL books −20,000 LBP commission = supplier owes us).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | lira-056/059/062/084                                                                                                                                                           |
| Amount = **GROSS**, not fee-only (primary-cash-drawer model, 2026-07-30) | The auto ledger entry for an OMT/WHISH **SEND or RECEIVE** books the **gross** amount owed the provider. **LIRA-095 Phase 2 (2026-08-30) removed the commission term:** SEND `+(x + f)`, RECEIVE `−(x − f)` — the whole fee is owed to the provider and the shop’s cut `c` is settled separately, not netted at creation. **Gated per row on `commission_model`** (D3): rows written before the cutover (`0`) are still READ with the old netted formula, because that is how they were written — reading a legacy row as gross overpays the provider by exactly `c` at settlement. Both the JS and the SQL twin carry that gate. Via the ONE `grossOwedDelta()` function (`FinancialServiceRepository.ts`, next to its SQL mirror `SUPPLIER_OWED_EXPR` — rule 14, single definition, both consumed by every owed read: Settle tab, Suppliers "Total Owed", `getUnsettledSummaryByProvider`). **This inverts the fee-only design from 2026-07-29 (PR #66, §7's superseded float row).** Fee-only was correct only because the principal `x` was ALSO tracked elsewhere — inside the system-drawer float — so booking it again here would have double-counted the same number. With no float, the PCD (§7) is the shop's own physical cash, not a provider-side balance: `x` genuinely lives in exactly one place (the drawer), and "what's owed the provider" is a separate fact about the outside world with nowhere else to live except `supplier_ledger`. Both directions still write `entry_type: TOP_UP` (unsigned) — `addLedgerEntry` force-negates only `PAYMENT`, so a RECEIVE's negative gross entry books correctly signed. **Wallet providers (OMT_APP/WHISH_APP/BINANCE) book NOTHING** — prepaid balance, no supplier debt (`WALLET_PROVIDERS`). Legacy cost/price-flow SEND (prepaid-units model, row below) is unaffected — it still books the sale `cost`, not a fee.               | `OmtSystemFeeCharacterization.test.ts`, `SupplierRepository.settlement.test.ts` — WILL be re-derived to the gross formula (rule 17); see `PRIMARY_CASH_DRAWER_PLAN.md` §4/§8.3 |
| Prepaid-units model                                                      | Supplier debt is booked **ONCE at top-up**; sales only draw down the provider drawer — no per-sale SALE_COST.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | lira-061, lira-078                                                                                                                                                             |
| Loto exception                                                           | Standard convention since v119: a ticket sale books **+(sale − commission)**; a cash prize books **−prize**. Checkpoint settlement's payment leg is the **NET** (commission kept back) — no separate commission drawer credit (a full sale→settle cycle nets drawers **+commission exactly once**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | lira-091-loto-ledger-sign, LotoCheckpointRepository.settleDrawer.test                                                                                                          |
| Credit top-up                                                            | Supplier-credit top-up funds the provider drawer and touches **no** cash drawer; settle later via `PAYMENT` from a named drawer (General −).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | lira-056                                                                                                                                                                       |
| Cash both ways                                                           | PAY (shop→supplier) and `SUPPLIER_PAYS_US` (supplier→shop) both move **General**, never the provider stock drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | lira-059                                                                                                                                                                       |
| Void restores everything                                                 | Voiding a SUPPLIER_PAYMENT restores supplier balance AND drawer, and soft-flags the ledger row (`is_refunded`, v120); aggregates exclude flagged rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | lira-092                                                                                                                                                                       |
| Secondary system                                                         | Transactions through a partner write **partner_ledger**, never supplier_ledger; the Suppliers page hides the non-base provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | lira-supplier-secondary-system                                                                                                                                                 |
| **Product suppliers — event-based (v164)**                               | `getProductSupplierBalances` **used to** recompute "owed" on every read as `SUM(live stock × live cost) + SUM(ledger)` — a POS sale silently lowered the debt, a refund raised it, a cost edit re-priced already-settled history, and no intake path ever wrote a ledger row at all (`SupplierRepository.ts:1018-1052`, pre-v164). **SUPPLIER_STOCK_INTAKE_PLAN.md (owner decision D1)** replaced this with the same **ledger-sum-only** model company suppliers already use: `getProductSupplierBalances` now shares the SAME extracted ledger-balance expression as `getSupplierBalances`, over every non-system supplier (LIRA-313 dropped the old `product_suppliers`-link requirement, which showed a recorded-debt supplier with no linked product as "$0.00 / Settled"). `entry_type` **`STOCK_INTAKE`** (migration v164) is written ONCE per delivery by `SupplierRepository.recordStockIntake`: **+qty × unit cost**, same sign convention as `TOP_UP` (shop owes more). Stock-quantity changes, sales, refunds, deletes, and cost-price edits **never** touch this ledger row — only a new intake (or a restock) does. An **"old stock"** per-entry checkbox on the Add Product / restock forms creates a FIFO cost batch (`StockBatchRepository`) but deliberately **skips** the ledger write (D6) — the batch still exists for profit costing, there is simply no debt to book. Reversal owner (rule 20): voiding the `SUPPLIER_STOCK_INTAKE` transaction is `TransactionRepository._reverseSupplierStockIntake` — the generic void path soft-voids the `supplier_ledger` row for free (`source_table = 'supplier_ledger'`), and this method additionally deletes the linked stock batch and lowers `products.stock_quantity` by the batch's original quantity; it **REFUSES** the whole void if any unit from that batch was already sold. Standalone supplier write-off was **REMOVED** (D8) — the bundled Pay-form discount (`DISCOUNT` entry type, above) is the only forgiveness path left. | `docs/plans/todo_plans/SUPPLIER_STOCK_INTAKE_PLAN.md`, `docs/COUNTERPARTY_LEDGERS.md` §4                                                                                       |
| Walk-in on the secondary system is rejected                              | A transaction on the non-base provider (e.g. WHISH when `shop_base_system = OMT`) with no `partnerId` **throws** instead of silently booking nothing — the old behavior lost the obligation into no ledger at all. Route it through a partner (`partnerId` set → THROUGH/FOR partner flow, §1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `OmtSystemFeeCharacterization.test.ts` CASE 8/8b — being re-derived alongside the rest of the file (rule 17)                                                                   |
| Through-partner on the secondary system is not supplier-pending (D7, 2026-10-06, LIRA-258) | A THROUGH-partner OMT/WHISH transfer on the non-base provider writes no supplier-ledger entry (see "Secondary system" above), so it is **not** left in the supplier unsettled/Settle set, and the shop fee is stamped as **profit at creation** (100% of the fee, no waiting for a supplier settlement that never happens). Closes POSTING_MAP G3 / G32. The partner side is tracked on the Dashboard "Pending Settlement" banner's partner lines. |

Partner ledger: a Whish top-up **via partner** credits `Whish_App`, touches no cash
drawer, and books a partner CREDIT (we owe the partner); **from client** debits General
by cashPaid with no partner row (the margin exists only as a drawer delta) — lira-057.

### 8.1 THE invariant — quote this whenever you touch OMT/WHISH money

#### 8.1.0 On-behalf (FOR-partner) RECEIVE and SEND move no drawer — and that is CORRECT

**Owner-confirmed 2026-08-10** (LIRA-128). The partner phones in: _"receive this OMT
transaction and hold the money."_ Asked whether any cash physically moves at that moment, the
owner's answer was **no** — _"cash doesn't move ... but an OMT transaction should be recorded,
and this should appear in the OMT supplier page."_

So a FOR-partner OMT/WHISH RECEIVE books **obligations only**:

| What              | Where                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| the provider side | a `supplier_ledger` `TOP_UP` entry, amount from `grossOwedDelta` (**signed NEGATIVE** for a RECEIVE — it _reduces_ what the shop owes the provider) |
| the partner side  | a `partner_ledger` **CREDIT** (the shop owes the partner)                                                                                           |
| any drawer        | **nothing** — no cash moved, so no till movement. The partner's later collection pays out of the PCD.                                               |

The books balance without a drawer leg: the provider obligation falls by `x`, the partner
obligation rises by `x`, the till is untouched.

**SEND follows the same rule — owner decision D1, 2026-10-06 (LIRA-258).** The partner phones
in: _"send this OMT/Whish transfer for my customer."_ The shop runs it on its own provider
account, so the provider is owed, and the partner owes the shop — but no cash crosses the shop
counter at that moment. A FOR-partner OMT/WHISH SEND therefore also books **obligations only**:

| What              | Where                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the provider side | a `supplier_ledger` `TOP_UP` entry **+(x + f)** from `grossOwedDelta` (POSITIVE — the shop owes the provider more), back-linked to the `financial_services` row so the generic void cascade reverses it |
| the partner side  | a `partner_ledger` `FOR_OMT_SEND` / `FOR_WHISH_SEND` **DEBIT** of the **same** `x + f` (from `grossOwedDelta`, not Σ payment legs — the two sides can no longer disagree)              |
| any drawer        | **nothing.** OUT (disbursement) payment legs are **rejected**; the partner's later settlement brings the cash in.                                                                 |

Before LIRA-258 this branch wrote no supplier entry at all, debited the shop's disbursement OUT
legs from the PCD, and took the partner amount from Σ legs (POSTING_MAP G1, G24, and the FOR-SEND
case of G2). `OMT_APP` / `WHISH_APP` / `BINANCE` FOR-partner SEND are **unchanged** (same
asset-wallet reasoning as the RECEIVE paragraph below). The FOR RECEIVE supplier booking now goes
through the same helper and no longer swallows a booking failure — the transaction fails instead
of committing without its supplier entry. Guarded by `FinancialServiceRepository.partner.test.ts`,
"LIRA-258" block (proven failing-first on the pre-fix code).

**Why app-wallet/Binance FOR-partner RECEIVE differs, and is ALSO correct.** Those branches DO
credit their wallet drawer (`+amountAbs`). This asymmetry is deliberate, not drift: an
app-wallet or Binance balance is an asset the shop actually **holds**, so receiving into it
genuinely increases it. An OMT/WHISH cash receive is an agent-network operation — nothing lands
in a wallet the shop holds; the transfer is merely marked collected. **Do not "unify" these two
branches.** They model two different physical realities, and a previous investigation already
wasted effort by reading the difference as a bug.

Guarded by `FinancialServiceRepository.partner.test.ts` (USD and LBP currency-column variants,
asserting the row's existence, `entry_type`, sign and reversal-to-zero).

⚠ **Known display defect on this row — see LIRA-129.** `EntryTypeBadge` renders `TOP_UP` in RED
(reads as "debt going up") while a negative amount renders GREEN (reads as "debt going down"),
so the badge and the number contradict each other. The money is right; the screen is
misleading. Not partner-specific — a walk-in OMT/WHISH RECEIVE produces the identical row.

Four distinct quantities, never conflate them — conflating the first three is exactly
what made the original (pre-#66) gross-reserve bug hard to see:

- **`x`** — the principal (what actually transfers, customer-to-shop or shop-to-customer).
  Lives in the **PCD** (§7) — real physical cash — and nowhere else as a balance.
- **`f`** — the customer-facing fee the provider charges for the transfer. Read from
  `data.omtFee`/`storedWhishFee`; defaults to 0 on RECEIVE if omitted.
- **`c`** — the shop's commission, its cut of `f` (`c ≤ f`; `c` is always 0 for WHISH).
- **receivable** — the CUSTOMER_ACCOUNT-funded share of any leg (booked to `debt_ledger`,
  not a drawer). Added to the invariant by contract §8.4 below; the existing
  `assertInvariant` helper in `OmtSystemFeeCharacterization.test.ts` already modeled this
  and that handling is preserved as-is.

`supplier_ledger` tracks the **gross** `x + f` (SEND) / `−(x − f)` (RECEIVE) for `commission_model = 1` rows, and the pre-cutover `x + f − c` / `−(x − (f − c))`
(RECEIVE) owed the provider — §8's "Amount = GROSS" row. This is **not** a return of the
original gross-reserve bug: that bug double-counted `x` because the drawer ALSO carried
it as a provider-side balance. Here the PCD holds `x` as the shop's own cash — a
different fact from "what the shop owes the provider" — so tracking both is not tracking
the same number twice; §13 item 14 ("one obligation, one owner") is about not encoding
the SAME obligation in two places, and the PCD balance and the supplier-ledger
obligation are, again, two different things that merely move together.

**The rule, quotable as-is (contract §8.4):**

> `Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed to provider) = kept_change`
>
> **(LIRA-095 Phase 2: the right-hand side lost its `c`.)** Under the netted payable every transfer resolved to the shop’s own commission at CREATION time. With a gross payable it resolves to **zero** — nothing is earned at transaction time. The commission now appears once, at SETTLEMENT, as the real figure the operator enters, so `Σc` accrues to the PCD across the settlement cycle rather than per transfer.

stated per currency for single-currency legs, at the stamped exchange rate where a
split payment is multi-currency. `kept_change` is named explicitly — never folded into
`c` — because it is a customer-facing rounding leftover the shop keeps, not commission
revenue.

Per-case table (replaces the old float model's four-row target-drawer table — every
SEND/RECEIVE case reduces to one of these; `PRIMARY_CASH_DRAWER_PLAN.md` §1):

| Case                                                     | PCD legs   | Δ owed to provider (`supplier_ledger`) | PCD Σ − Δowed |
| -------------------------------------------------------- | ---------- | -------------------------------------- | ------------- |
| SEND, fee on top (customer hands `x+f` cash)             | `+(x+f)`   | `+(x + f)`                             | `0`           |
| SEND, fee included (customer hands `x`; principal `x−f`) | `+x`       | `+((x−f) + f) = +x`                    | `0`           |
| RECEIVE, fee on top (payout `x`, fee `f` collected)      | `−x`, `+f` | `−(x − f)`                             | `0`           |
| RECEIVE, fee included (payout `x−f`)                     | `−(x−f)`   | `−(x − f)`                             | `0`           |

Every case nets to exactly the shop's own commission `c`, per transaction — not `f` like
the (now-superseded) float model's table did, because the ledger now carries the whole
`f − c` split rather than just it. **Worked example** (USD, `x=100`, `f=5`, `c=0.5`):
SEND books `+104.5` owed; RECEIVE books `−95.5` owed. A full SEND+RECEIVE cycle: PCD
`+105 − 95 = +10`, owed `+104.5 − 95.5 = +9`, difference `1 = 2c` ✅ (one `c` per
transaction). Guarded end-to-end by `OmtSystemFeeCharacterization.test.ts` (CASE 1–8b) —
**WILL be re-derived** to these exact numbers (rule 17); do not trust the file's current
contents against this table without checking `PRIMARY_CASH_DRAWER_PLAN.md` §4 first.

**The settlement identity** — why settlement nets the ledger to zero and leaves the PCD
holding exactly the shop's commission:

`settleTransactions` pays the outstanding **gross** `Σ owed` through real payment-method
legs whose CASH leg resolves to the **PCD** (decision #10 — the opposite of the float
model, which deliberately kept settlement OUT of the system drawer because the float had
already moved at transaction time; under this model the PCD is exactly where settlement
cash belongs, same as it's where every other primary-system cash leg belongs). After a
full transactions+settlement cycle the ledger nets to exactly **0** and the PCD retains
`Σc + kept_change` (plus any seeds or manual General↔PCD transfers) — a drawer that only
ever held provider-related cash ends up holding exactly the shop's commission, matching
the owner's physical reality. Guarded by `SupplierRepository.settlement.test.ts` — **WILL
be re-derived**: the old assertion ("OMT_System sees ZERO delta from settlement") inverts
to "PCD delta at settlement = −(net owed)"; its reversal counterpart,
`TransactionRepository.supplierSettlementReversal.test.ts`, re-derives alongside it.

**Cutover, no balance migration** (decision #14): the owner wipes the database and
starts fresh — no settle-to-zero step, no backfill. Opening PCD balance is set by
physical count via Initial Drawer Amounts / the setup wizard. Schema migrations
(`create_db.sql` + `migrations/index.ts`, rule 10) still ship, for the upgrade path and
multi-tenant web installs that hold real data (those need their own wipe-or-count
decision before upgrading — flag at release time).

**Historical record — `OmtSystemFeeCharacterization.test.ts`**: this file started as a
_diagnostic_ (no assertions beyond logging the pre-fix numbers) and was rewritten into a
real guard once the owner first confirmed a domain model, on 2026-07-29 — the spendable
float. That model was itself superseded the next day (§7) by the primary-cash-drawer
model this section now documents; the file's assertions are being re-derived to the
table above, but the STRUCTURAL property it exists to guard — one invariant, asserted
after every case, so a double-debit or a dropped leg can't hide — is unchanged and is
exactly why the file survives this rewrite rather than being replaced. The six
ORIGINAL pre-fix numbers it measured (i.e. before PR #66 existed at all), for provider
OMT / USD / x=100 / fee=5 (every case's Σ should have been +5 — the float model's target
value at the time it was measured; today's equivalent correctness check is the per-case
`+c` column in the table above):

| Case                             | Pre-fix General | Pre-fix OMT_System | Pre-fix Σ |
| -------------------------------- | --------------- | ------------------ | --------- |
| RECEIVE fee-on-top, single CASH  | −100            | −105               | −205      |
| RECEIVE operator typed gross 105 | −105            | −110               | −215      |
| SEND single CASH                 | 0               | +105               | +105      |
| SEND `includingFees: true`       | 0               | +105               | +105      |
| RECEIVE split CASH60+wallet40    | −60 (+App −40)  | −105               | −205      |
| SEND split CASH60+wallet45       | +60 (+App 0)    | +105               | +165      |

Both RECEIVE rows moved cash **out of both** General and the system drawer for the same
transfer (double-debit); SEND's "cash reserve" branch zeroed General straight back out
after crediting it, and the split case (CASE 6) leaked an unaccounted `+60` because the
reserve was skipped for any non-cash leg while the system credit still ran unconditionally.
This is the ORIGINAL bug — predates the float model and predates this model too; both
later designs exist to fix it, by different means.

---

### 8.2 Supplier ACCOUNTS — several suppliers, one balance (LIRA-187→192, 2026-09-15)

A supplier may be a **child of another supplier**, via the nullable self-FK
`suppliers.account_supplier_id` (migration v176). Today `iPick` and `'OMT App'` are children of
`'OMT'`, because the shop holds ONE open-credit account with OMT that all three draw on.

**Ledger rows NEVER move.** Each child keeps writing its own `supplier_ledger` rows under its own
`supplier_id`; the account is a **read-time rollup** (`getAccountBalances` / `getAccountLedger` /
`getAccountUnsettled`). That is what keeps every existing void path working — a reversal still finds
its row exactly where the flow wrote it.

| Fact | Detail |
| ---- | ------ |
| Membership predicate | ONE fragment, `accountMemberOf` — never re-derive it (rule 14) |
| Page | The parent renders as an account card; children are sub-rows with their own drawer badge and contribution, and have **no settle button** of their own |
| Balance vs ledger list | The rollup BALANCE excludes refunded rows; the ledger LIST includes them so the UI can badge them "Voided". Two different questions — do not unify them |
| Settlement | `settleAccount` writes **one ledger row per child touched**, so each child nets to 0 individually. A single lump row on the parent would leave one child overpaid and another unpaid |
| Direction | Settlement supports **PAY and COLLECT** — cashouts (§8.2) can make the account net negative |
| Deferred commission | An OMT App cashout's commission is stored in `transactions.metadata_json.commission` (there is no column) and recognised as profit **at settlement**, summed server-side. Never ask the operator to total it |
| OUT legs | **Rejected outright** in the legacy whole-row `settleAccount` payload. A supplier settlement has no customer, so there is no change to return — and an equal-and-opposite pair was a way to wash money between two drawers. The amount-first payload (below) allows CASH change legs only, capped by the extra (`_resolveSettlementLegs`, LIRA-315) |

#### Amount-first account settlement (LIRA-322, `specs/322-omt-amount-first-settle/`)

The Settle Account sheet sends the **amount-first** payload: the operator types what was paid or
received per currency, and the server decides what closes. It is the ONLY way to pay an
account member — OMT, OMT App and iPick have no Pay / Receive tab and no Commission settlement list
(non-members such as Katsh keep both). The old whole-row payload (`direction` + `selections` +
`amount_*`) is still accepted by the server as a regression net, but refuses a part-paid row.

| Fact | Detail |
| ---- | ------ |
| Payload | `per_currency: { USD?, LBP? }`, each `{ direction, payments, commission?, waive? }`, plus `expected_owed: { usd, lbp }` (the signed in-scope remaining the sheet previewed) and an optional `selections` scope. Schema `supplierSettleAccountSchema`; one payload for both transports (rules 21/22) |
| Per-currency rule | USD money settles USD rows only, LBP money LBP rows only. An IN leg must be in its section's currency; a change (OUT) leg may be in either currency, CASH only (LIRA-315). A currency with no section is untouched |
| Direction | Per section, from the sign of what is owed in that currency (PAY when the shop owes, COLLECT when OMT owes). One settlement may PAY one currency and COLLECT the other; drawers, ledger rows and change legs are signed per section |
| Allocation | ONE pure allocator, `allocateAccountSettlement` (core `utils/accountSettleAllocation.ts`), runs in the sheet preview AND on the server. Credits net first in their currency, then money + commission close rows oldest first (`compareAccountSettleRows`: `created_at`, kind, id); at most one row is part-paid; anything above what is owed is an extra booked on the account (LIRA-315 overpay rows) |
| Stale refusal | The server re-reads the queue inside the transaction and refuses when the in-scope remaining differs from `expected_owed` ("OMT's balance changed since you opened this sheet…"); the sheet refetches and keeps the typed lines |
| Coverage table | `supplier_settlement_coverage` (v217): one row per (settlement, queue row, currency, source `PAYMENT`/`NETTING`/`COMMISSION`/`WAIVE`), `closes_row=1` on the row it fully paid. Remaining = gross − active coverage (`ACCOUNT_ROW_COVERED_SQL`, the one fragment — rule 14). A row is stamped `settlement_id = anchor` only when it closes; a part-paid row stays in the queue with `remaining_*` |
| Ledger rows | One anchor + one `supplier_ledger` row per member **per currency** with a nonzero money share, sign from its own section. Closed rows of every member share the ONE anchor `settlement_id`. The call returns the anchor ledger id; the transaction is the `SUPPLIER_SETTLEMENT` with `source_id = anchor` and `metadata_json.per_currency` |
| Netting pair (`is_auto`) | A credit on one member netting a debt on another writes an auto pair (debtor −x `PAYMENT`, creditor +x `SUPPLIER_PAYS_US`, `is_auto=1`, `transaction_id` = settlement, stamped `settlement_id = anchor` at write time so it never re-enters the queue). Rule 26: its lifecycle belongs to the settlement |
| Commission | **Owner decision 2026-10-15:** the entered commission NEVER covers a row and never changes the legs, box totals or extra — only money (and a waive) closes rows. Profit: allocated (`settlement_commission_allocations`) only over model-1 rows this settlement CLOSES; refused when none closes. The amount itself is booked as ONE OPEN credit per currency on the commission member (`SUPPLIER_PAYS_US`, −c, `is_auto`, link-mode `transaction_id` = the settlement, no `source_ref_*`, `settlement_id` NULL), so it appears in the queue and nets first at the next settlement. `isSettlementCommissionCredit` still hides only the back-linked LEGACY credits (already netted into their payment). A cash-out's deferred commission is recognised only by the settlement that closes its credit row |
| Status on the Suppliers page | For account members, `getAllByProvider` takes `fifo_status` / `fifo_paid_usd` / `fifo_paid_lbp` from coverage ("Partial · $47.00"), never from the manual-payment pool estimate |
| Void (reversal owner) | Generic void/refund → `_reverseSupplierSettlement`, which also soft-voids the coverage rows (`is_reversed=1`), the netting pair and the overpay / commission siblings. **Newest first:** `_assertSettlementIsNewestOnItsRows` refuses, before any write, a settlement when a later active one covered any of the same rows ("A later settlement … Void it first."). `_assertNoActiveSettlementCoverage` refuses voiding a part-paid or netted row's own transaction while a settlement still covers it — including a settlement whose overpay or commission credit a later settlement already netted ("It is partly paid by settlement #N — void that settlement first.") |

Guards: core jest `SupplierRepository.lira322AmountFirst` / `.lira322Netting` / `.lira322Invariant`
(seeded property test of invariants 1–3) / `.lira322ExpectedStatement`,
`TransactionRepository.lira322AmountFirstVoid`, `FinancialService.lira322CoverageStatus`; sheet
suites `AccountSettleSheet.lira322*`; page `Suppliers.lira322AccountOnly`; badge
`CashFlowBadge.lira322MixedSettlement`; web e2e `lira-web-065-omt-amount-first-settle` (plus
lira-web-035/053 and the shared desktop lira-189/lira-158 on the new sheet).

### 8.3 OMT App wallet — credit in, cashout out

Loading the OMT App wallet and cashing it back out are **mirror images**, and neither moves physical
cash. Both leave the **PCD at delta exactly 0**.

| Flow | Wallet drawer | `'OMT App'` ledger | Profit |
| ---- | ------------- | ------------------ | ------ |
| Credit top-up of `X` | `+X` | `+X` (shop owes OMT) | — |
| Cashout of `X` | `−X` | `−(X + commission)` at 0.1% | **0 at creation**; recognised at settlement |

The cashout books `entry_type: 'PAYMENT'` (which `addLedgerEntry` force-negates) — **never**
`SUPPLIER_PAYS_US`, which carries the opposite sign. Over-drawing the wallet is blocked. A credit
top-up **is voidable** since LIRA-194 (`RECHARGE_TOPUP` goes through the generic void; its
link-mode `TOP_UP` ledger row is reversed by `_reverseSupplierLedgerByTransactionLink`). A **cashout IS voidable**, deliberately, because it
stamps a commission and an unfixable mistake would leave phantom earnings.

Wallet SEND/RECEIVE still book **no** supplier ledger row ("Fix B") — correct, because the debt is
booked once, at load time. Do not "fix" that.

### 8.4 Remittance corridor (Syria) — Custom Services → Via Partner

A money-transfer corridor through a partner (the owner's "7welet souria" for Syria, but nothing is Syria-specific — any
partner, any corridor) is booked in **Custom Services**, not on the OMT/Whish page (owner notes #16 Route A, v185;
LIRA-305 decisions Y1–Y14). The old "Syria provider on the OMT/Whish page" plan is archived as superseded.

| Direction | How it is booked | Cash drawer | Partner row | Commission |
| --- | --- | --- | --- | --- |
| SEND | Services → **Via Partner** → partner; Cost = what the partner delivers, Price = what the customer pays | General **+price** (any normal payment method) | `THROUGH_CUSTOM_SERVICE` **CREDIT** of the cost (shop owes partner; not an obligation) | price − cost, counted **at once** |
| RECEIVE | Services → **Via Partner** → **Pay out**; Arrived = what the partner sent, Paid out = what the customer gets | General **−paid out**, cash only | `THROUGH_CUSTOM_SERVICE` **DEBIT** of the arrived amount (partner owes shop; an obligation head since LIRA-258 D5) | arrived − paid out, stamped at once, **counted when the partner's account covers it** |

- A partner is always required (both apps refuse a Pay out without one).
- General only — never the OMT/Whish cash drawers, no new drawer.
- USD and LBP each stand alone; nothing is converted, and netting only matches a currency with itself.
- A Pay out never joins a session basket (it is recorded straight away).
- **Netting counts as the partner paying (LIRA-305, Y6/Y13/Y14).** A Pay out's commission counts once the partner's
  account in that currency no longer owes that money — by a cash settlement **or** by what the shop owes the same partner
  for SENDs. If the partner still owes part of it, the newest Pay outs wait and the oldest count first. Paper credits
  (manual entries with "Cash moved" off) never count. Read-time only (`partnerEffectiveCoveredSql`,
  `constants/partnerObligation.ts`) — nothing is stored, so voids re-derive on the next read, and past days' figures
  can rise. Measured before → after: SEND 150/155 + Pay out 100/97, shop settles 50 → 5 → **8**; SEND 100/103 +
  Pay out 100/97 → 3 → **6**; SEND 40/42 + Pay out 100/97, partner settles 60 → 3.8 → **5**. For Partner rows keep
  the cash-only rule (Y7). Guard: `ProfitRepository.syriaCorridorNetting.test.ts`; REST: lira-web-054; desktop:
  lira-305-syria-corridor-netting.

## 9. Void / refund

- Journal pattern: void writes a same-type reversal row (`reverses_id` set, negated
  amounts); the original's status becomes VOIDED. Net drawer effect across
  create + void = 0. Match originals by `source_id` + `reverses_id IS NULL`.
- Void/refund actions live in the **Transactions table only** (owner decision 2026-07-04).
- `NON_REVERSIBLE_TRANSACTION_TYPES` (LOTO_SETTLEMENT, LOTO_CASH_PRIZE outside a basket, REFUND, the paper
  ADJUSTMENT types, standalone COUNTERPARTY_DISCOUNT, …) are **gated in the repository** —
  raw IPC void returns `{ success: false, error: /cannot be voided/ }`. Blocking beats
  corrupting. A new type must decide: reversible (then prove drawer + ledger + profit all
  restore) or listed as non-reversible. LIRA-085 (2026-07-21) moved
  `PARTNER_SETTLEMENT`/`PARTNER_PAYMENT`/`SUPPLIER_SETTLEMENT` OUT of the gate with
  module-owned reversals (`_reversePartnerSettlementLedger` + coverage unwind,
  `_reverseSupplierSettlement` incl. commission funding + `settlement_id` un-stamping).
- Refund reverses profit — a refunded transaction's profit nets to 0; per-item refunds
  pro-rate the sale's discount (lira-090).
- **Reversal symmetry (CLAUDE.md rule 20)**: every ledger row a flow writes must have a
  named reversal owner — the generic path reverses drawers (`_reversePayments`),
  module-charge debt (`_cancelDebt` over `MODULE_DEBT_TRANSACTION_TYPES`, BOTH
  currencies, on EVERY void/refund), profit, sale stock, and the supplier soft-void.
  A new side-effect row (new debt `transaction_type`, new ledger, auto sibling) must in
  the same change either join the generic reversal or gate its type non-reversible —
  and prove create+reverse nets to 0 across every ledger, per currency, failing-first.
  **Extending a capability to more modules re-triggers this** (the lira-093
  "CUSTOMER_ACCOUNT everywhere" sweep never revisited refunds → account-charged
  recharge/service refunds kept the customer's debt, owner-reported 2026-07-12;
  lira-104 + lira-web-012). An account-charged leg took NO cash, so its reversal is
  ledger-only — never a cash payout. Charge types are named `'<Module> Debt'`;
  the `moduleDebtTypes.guard.test.ts` jest guard forces classification of any new one.
  Corollary the same fix covered: refunding a `'Service Debt'` must also stop the
  provider routing — the outstanding computation nets `'Refund Reversal'` rows
  (DebtRepository.serviceDebtRouting.test.ts).
- Maintenance: an unpaid draft deletes cleanly (status change, no reversal row); a paid
  job's delete is **blocked** while its transaction is still ACTIVE-and-unreversed — go
  through refund/void (lira-081). Refund/void is the **unlock**, not a second lock: once
  `maintenance.is_refunded` is set, both delete AND the amount-edit gate (`updateJob`)
  re-open, because the historical transaction/payment/profit rows are frozen on
  `transactions` and never re-read from `maintenance` (owner report 2026-07-28 — a
  refunded job used to stay permanently locked, since `getBySourceId` still finds an
  ACTIVE sibling/REFUND row for the same `source_id` even after refund/void; the real
  gate is `jobHasActiveTransaction(id) && !is_refunded`, shared as
  `MaintenanceRepository.isJobMoneyLocked`, mirrored on the frontend as `isAmountLocked`).
- **LIRA-091 (DONE, 2026-07-21)**: voiding/refunding a FINANCIAL_SERVICE (or, generically,
  any source table) row now cascades to its auto supplier-ledger sibling.
  `supplier_ledger.source_ref_table`/`source_ref_id` (v136) back-links an `is_auto:1`
  sibling to the parent's own `source_table`/`source_id` — stamped by
  `FinancialServiceRepository`'s BILL-commission and SEND/RECEIVE TOP_UP/PAYMENT sites.
  `TransactionRepository._cascadeSupplierSiblingVoid` finds unrefunded siblings and reuses
  `_voidTransactionInternal` per sibling (soft-void via the existing `_markSourceRefunded`
  step) — `voidCheckoutGroup` inherits it for free since it delegates to the same internal
  method. `_assertSupplierSiblingsVoidable` blocks the whole void/refund up-front, naming the
  settlement, when the parent's `financial_services.settlement_id` is already stamped
  (owner-flagged decision: block, not compensate). RechargeRepository has no LIVE
  `is_auto:true` separate-hidden-transaction site today (`topUpFromSupplier` is link-mode,
  reversed by `_reverseSupplierLedgerByTransactionLink`, not the sibling cascade) — the cascade's genericity is
  proved with a synthetic `recharges`-sourced fixture instead
  (`TransactionRepository.supplierSiblingVoidCascade.test.ts`). Legacy (pre-v136) rows are
  undetectable by design — no heuristic backfill, same limitation as LIRA-094's split_group
  marker.
- **Known open gap**: Aging/overdue views are charge-only and keep showing reversed charges
  until due_date passes.
- **D3 (DONE, 2026-07-19)**: voiding/refunding a DEBT_REPAYMENT now restores the debt,
  not just the cash. `TransactionRepository._restoreRepaymentDebt` fires when the
  reversed transaction IS the repayment itself (a different trigger from `_cancelDebt`,
  which explicitly excludes `'Repayment'` rows) and (a) inserts a compensating
  `'Repayment Reversal'` ledger row — named to stay outside the rule-20 guard's
  `'<Module> Debt'` scan by construction, same shape as the existing `'Refund Reversal'`
  precedent — and (b) unwinds the FIFO coverage the repayment applied
  (`sales.paid_usd`, `debt_ledger.covered_usd/lbp`) via newest-first reverse-FIFO
  helpers that mirror `_markSalesPaidFIFO`/`_coverServiceDebtsFIFO`. A bundled CQ-10
  discount rides a SEPARATE transaction and — for DEBT_REPAYMENT reversals — is never
  touched: only the cash repayment's own coverage share unwinds. See
  `TransactionRepository.repaymentReversal.test.ts`. Contrast LIRA-085: a PARTNER
  settlement's reversal DOES sweep its bundled discount (ledger + profit negated), since
  "undo the settlement" must net the whole bundle to 0 — the two behaviors are deliberate,
  per-flow decisions, not an inconsistency.
- **LIRA-310 bundled settlement discounts (Waive).** Voiding or refunding a `SUPPLIER_SETTLEMENT` (batch or account settle) now sweeps a supplier `DISCOUNT` row bundled with it (a settlement `discount`; the Suppliers page itself shows no Waive since 2026-10-12) (`_linkedSupplierDiscount` accepts settlement parents; ledger soft-void + negated profit; no purchase-coverage give-back). A LOTO settlement's waived discount is non-reversible like `LOTO_SETTLEMENT` itself — correct it with an opposite supplier adjustment. A session basket's `WAIVED_SHORTFALL` is swept by `voidSessionBasket`/`refundSessionBasket`; a single-item refund of a waived basket is refused.
- **LIRA-312 wrong-number card (`wrong_number_cards`, `WRONG_NUMBER_CREDITS`).** "Wrong number" is **not a refund**: the card sale stays untouched (it becomes the recharge of the right number) and the wasted card is a stock-use expense of the same card (`EXPENSE_IPICK/KATSH/WHISH_APP`, category "Wrong number card") — the loss, reversed by the generic void like any stock-use expense. Credits sent back are `WRONG_NUMBER_CREDITS` rows (`source_table='wrong_number_cards'`): `+X` on the chosen shop line (`carrier_line_movements`) and `+X` USD on the carrier drawer (plus a separate `_LINE_DRIFT` leg if the drawer had drifted), `profit_lbp = X × telecom_credit_sell_price_lbp` with the rate kept in metadata. Reversal owners: `_reversePayments` + `_reverseCarrierLineMovements` (generic, void or refund); the profit stamp drops with `status='VOIDED'` / the REFUND row. Undo order is enforced: `_assertReversible` refuses the expense ("Undo the credits received first.") while any entry is active — this also covers deleting it from the Expenses page, which voids through the same path. The "active entry" predicate is `activeWrongNumberCreditsSql` (`repositories/wrongNumberSql.ts`); a void's reversal row has the same type and source, so the predicate excludes `reverses_id IS NOT NULL` rows. Guards: `WrongNumberService.credits.test.ts`, `TransactionRepository.wrongNumberGuard.test.ts`, `ProfitService.wrongNumberRecovery.test.ts`, `lira-web-060`.

- **LIRA-339 voucher lifecycle (`VOUCHER_SALE` / `VOUCHER_CANCEL`, `source_table='vouchers'`).** Selling a gift card writes a `VOUCHER_SALE` (in, profit 0): drawer legs through the shared loop, a CUSTOMER_ACCOUNT leg as a `'Voucher Debt'` on the sale id, a GIFT_CARD leg refused; a back-dated sale (`transaction_time`) back-dates the voucher row too. **Reversal owner: the Vouchers page cancel** (`VoucherRepository.cancelVoucher`), never the generic void — both types sit in `NON_REVERSIBLE_TRANSACTION_TYPES` ("Cancel the voucher from the Vouchers page" / "A voucher cancel is final"). Cancel refunds leg by leg: the cash/wallet part is paid back through payout legs on ONE `VOUCHER_CANCEL` (out, profit 0); every `'Voucher Debt'` row of the sale gets a `'Refund Reversal'` (`insertDebtRefundReversal`), selected by the SAME predicate the page sums (`saleVoucherDebtWhere`), so the account drops by the full on-account amount — a part the customer already repaid becomes credit, cashed out from Accounts as usual. A **legacy** voucher (created before LIRA-339, no sale row) refunds 0 and writes a 0-amount `VOUCHER_CANCEL` with `metadata.legacy = true`. Redemption stamps `redeemed_transaction_id` (POS) or `redeemed_session_id` (session checkout), which the Transactions "Vouchers" filter (`paid_via_voucher`) uses to show purchases paid with a gift card. Create + cancel nets 0 per currency across drawers and `debt_ledger`. Guards: `VoucherRepository.sale/cancelRefund/reversalGate/sessionLink.test.ts`, `TransactionRepository.paidViaVoucher.test.ts`, `lira-web-079`.

---

## 10. Profits

- Source of truth: `transactions.profit_usd` / `profit_lbp`, aggregated per module by
  `profits.summary` — a flow that never stamps profit is invisible to the page (loto and
  maintenance both had this bug).
- **Password-gated, NOT admin-only** (LIRA-177). This SUPERSEDES the old three-layer
  admin gate: the `profits` module row is `admin_only=0` (both roles see the nav item,
  migration v163), the route is `<ProtectedRoute>` wrapped in `ProfitsPasswordGate`, and
  the 7 profit IPC channels / REST routes require a live **password unlock** instead of
  the admin role — admin is prompted too, on every visit. Fail-closed: with no password
  set, nobody enters. The unlock is server-side (per-webContents on desktop, per
  tenant+user on web) with a 15-minute TTL via the shared `isProfitsUnlockLive`;
  navigating away from /profits revokes it. An admin sets the password in
  Settings › Profits Password.
- The scrypt hash lives in `system_settings` under `profits_password_hash`, and
  `SettingsService` redacts that key from every read AND refuses to write it. That
  redaction is **load-bearing, not defensive**: `GET /api/settings` is deliberately
  unauthenticated (the web login screen reads the shop name pre-auth) and the
  `settings:get-all` / `db:get-setting` IPC channels carry no role check, so an
  unguarded secret in that table is world-readable. `PUT /api/settings/:key` also has
  `authenticateJWT` but no `requireRole` (LIRA-178), which is why the write guard exists.
- Guards: lira-071 (desktop gate), lira-web-029 (web), `profitsGate.api.test.ts` (REST
  incl. TTL expiry), `SettingsService.profitsRedaction.test.ts`, `profitsAccess.test.ts`.
- The 7 profit channels double as a profit **oracle** for 12 unrelated money specs. Those
  must call `ensureProfitsUnlocked()` first — and per-IPC-read rather than once per test
  if the spec also visits /profits, because the gate's unmount revokes the unlock.
- **Commission at settlement** (LIRA-095 + LIRA-089, `COMMISSION_AT_SETTLEMENT_PLAN.md`,
  model in `COUNTERPARTY_LEDGERS.md` §4.1). The operator enters the supplier's commission
  when settling a batch on the Suppliers page — **LUMP** (one total) or **RATE** × count
  (e.g. 20,000 LBP × Katsh bills), preselected per supplier — and it is split across the
  settled rows in proportion to what each owed (`settlement_commission_allocations`,
  largest remainder, adds up exactly). Profits and Closing count it on the **settlement
  day**. Rows from before the cutover (`commission_model = 0`) keep the old commission
  already embedded in the row, read by `embeddedCommission`; nothing was restated.
  While a new-model row waits, Profits shows a COUNT ("N awaiting settlement"), never a
  dollar estimate.
  **OMT statement types (LIRA-256):** a settlement may name the OMT commission types its
  statement covers (`covered_omt_service_types`). A new-model OMT transfer of another type is
  then **refused** from that batch (the error names it) and stays queued at gross with its
  commission pending until a statement covers its type — never settled with a zero share.
  Legacy rows and non-OMT rows are never restricted; absent = all types. The statement check
  (LIRA-255) subtracts only covered types' commission, and an old-style row (already booked
  net) is subtracted nothing more when covered and added back when not (S9).
- **"Commission" means supplier-paid only** (owner decision D11). Every REALIZED Profits
  commission figure filters on `COMMISSION_PROVIDERS` (OMT, WHISH, OMT_APP, WHISH_APP, BINANCE)
  or comes from settlement commission. An iPick/Katsh/BOB card margin (price − cost) is
  **Mobile Services profit**, even though the row also stores it in
  `financial_services.commission` — each figure has exactly one home
  (`ProfitRepository.commissionProviderSet.test.ts`). The PENDING commission queries have no
  provider filter; they only ever hold OMT/WHISH rows and commission-eligible bills because
  only those are born unsettled (`pendingSettlementSql`).
- Discounts reduce profit; per-item refund of a discounted sale nets to exactly 0.
- **Waive (LIRA-310, owner decisions 2026-10-11).** **Owner rule 2026-10-12 (binding): Waive only when money comes IN to the shop and the payer hands over a little less than the total; overpaying is never a waive — it is change or customer credit.** A Waive button sits in MultiPaymentInput's Remaining row and follows it: hidden whenever Remaining is hidden, never on a payout or any other money-OUT payment (the page passes `waiveDisabled`), only for a gap up to and including `SHORTFALL_MAX` ($5 / 450,000 LBP, in the total's own currency, `isWithinShortfallMax` — the same predicate payout kept change uses). It never pushes a discount past its ceiling (`maxDiscount` / `waiveRemainingMax`). What it books depends on the page: pages with a discount add the gap to it (POS, Maintenance, recharge, Debts, Partners, Custom Services); **Expenses has no Waive** (the shop pays the vendor — `waiveDisabled`; the earlier "Waive lowers the bill" was removed 2026-10-12); Loto ticket sends `discount_lbp` (profit only, ≤ commission, LOTO still owed sale − commission); a session basket sends `waived_usd/lbp`, verified by `resolveKeptChange`'s customer reduction and booked as a `WAIVED_SHORTFALL` sibling (amount 0, profit −waived, swept by the basket void/refund; a single-item refund of a waived basket is refused). On the Profits page it is its OWN "Waived" line (owner decision 2026-10-12) — summary `waived`, By Module row `WAIVED` with its drill-down, an Overview card — never folded into Kept Change; one predicate, `waivedShortfallSource` (the row or its basket-refund REFUND), and `keptChangeSource` no longer matches it. By Date / By Cashier / By Client have no Kept Change line, so they fold both through `keptChangeOrWaivedSource` and their totals are unchanged; a LOTO settlement waive is offered only when LOTO pays the shop (net > 0) and books a bundled supplier `DISCOUNT` (forgiven — LOTO paid less); when the shop pays LOTO (net < 0) the dialog passes `waiveDisabled` and never sends `discount_lbp` (the server still accepts `discount_lbp` in both directions, but the UI no longer sends it on the shop-pays side). OMT system / Whish system transfers never get Waive. **No Waive anywhere on the Suppliers page** (owner decision 2026-10-12): the OMT/Whish account settle sheet, the batch settle modal and the Pay / Receive tab pass `waiveDisabled`; the owner records a gap by typing it into the Pay tab's Discount field. The server still accepts a bundled settlement `discount` on batch and account settle (and still sweeps it on void/refund), but the UI never sends one.
- USD and LBP profits are tracked **separately** per module (an LBP maintenance job
  books `profit_lbp`; summing only `profit_usd` loses it).
- Recharge teshriji profit = (price − cost) − SMS cost, SMS converted for LBP transfers.
- Session-basket items must book the same profit as direct sales (lira-session-profits).
- Hold Money books zero profit. Whish top-up-from-client margin appears only as a
  drawer delta, never a profit row (lira-057).
- **Warranty cost** (LIRA-296, owner decision D1): the cost of honouring a warranty is ONE
  "Warranty cost" line, summed from `WARRANTY_COST` rows — never a change to the past sale.
  Posting: no payment legs, no drawer, `source_table='warranty_claims'`, `metadata.is_auto`
  derived from the claim link (rule 26, hidden in Transactions by default). Profit: REPLACE
  −replacement FIFO cost; REFUND −the line's cost (the refund itself is the ordinary
  refund-item row, `restock: false`, the faulty unit held in `defective_items`); REPAIR
  −(labour + parts) once at delivery (a warranty job is free and never Maintenance profit —
  `notWarrantyJob`); NOT_FAULTY +cost. Reversal owner (rule 20): `WarrantyService.voidClaim`,
  type in `NON_REVERSIBLE_TRANSACTION_TYPES`. Guard: `WarrantyService.voidNetsZero.test.ts`,
  `ProfitService.warrantyCost.test.ts`, lira-web-048.
- **Supplier returns** (LIRA-296 P3): a HELD defective item goes back to its supplier
  (`supplier_returns`, SENT). CREDITED writes a paper supplier ADJUSTMENT of −credit (USD
  and/or LBP, no drawer) plus a +credit `WARRANTY_COST` row (`kind: SUPPLIER_CREDIT`);
  REPLACED puts the unit back in stock at its cost (a fresh batch from that supplier) with a
  +cost row (`kind: SUPPLIER_REPLACED`); REJECTED moves nothing and the item is HELD again.
  Each closed return keeps its links (`ledger_entry_id`, `cost_transaction_id`,
  `restock_batch_id`). Reversal owner: `WarrantyService.voidClaim` → `undoSupplierReturns`
  (refused while a return is SENT). Guard: the P3 block of `WarrantyService.voidNetsZero.test.ts`
  (REFUND and REPLACE × every outcome, both currencies), lira-web-049. The warranty report's net
  equals minus the Profits "Warranty cost" line for the same days (same rows, same bound —
  `WarrantyService.report.test.ts`).
- **Partner netting (LIRA-305):** a Custom Services Pay out's commission is released by cash coverage **or** netting
  against what the shop owes the same partner — `partnerEffectiveCoveredSql` (`constants/partnerObligation.ts`), used
  by both partner-coverage fragments, so every Profits view agrees. See §8.4.

---

## 11. Sessions (customer baskets)

> **Basket rules added 2026-10-07 (LIRA-270/271/274):** a customer payment on a
> basket with nothing left to collect is refused (`basketNetCharge` /
> `basketHasNothingToCollect`, one shared rule in `utils/sessionNothingToCollect.ts` used by the modal and the server;
> the server's guard reads legs via `basketCollectNet`, where an OUT leg without `kind` counts as a payout, not change). Fee-on-top RECEIVE:
> only a WHISH system RECEIVE adds its fee to the charge, by the one rule in
> `utils/sessionFeeOnTop.ts` used by both the modal and the server. A For-Partner
> item contributes 0 to the customer charge (`utils/sessionForPartnerItem.ts`).

- Start requires a name (auto-creates client with phone). Only an **ACTIVE** session
  blocks a duplicate; multiple sequential sessions per day are allowed
  (lira-session-multiple-per-day).
- Cart items are stored as `formData` and replayed **verbatim** at checkout (see §6).
- **ONE pooled payment** per basket: posted to the drawer exactly once, attached to
  every session-linked transaction row (lira-session-basket-payment).
- **ONE debt entry** per basket for the whole on-account portion — never per item
  (lira-session-basket-debt). **LIRA-304:** each non-sale member carries its own
  share of that row (`customer_session_transactions.owed_*`, migration v209,
  back-filled) and its own coverage (`covered_*`); invariant I1 — Σ members'
  (owed − covered − refund credit) = the row's `coverageOutstandingSql`. Only
  `basketMemberCoverage.ts` writes member coverage (it moves the row in step),
  so a repayment can be aimed at one basket item (`targets`) and its void gives
  back exactly that. The profit hold is per member (`notDebtPending`).
- **Cash split, OMT first (LIRA-304, owner decision 2026-10-10):** a basket's cash
  pays its primary-system transfers first (`splitBasketCashOmtFirst`, shared with
  the checkout's "Goes to" preview); change always comes out of General; the
  member shares are written OMT-first too (the debt lands on the other items
  first). Replaces the by-share split of decision #7 on the charge side; the
  payout side is unchanged.
- Allocation (`SessionPaymentService.backfillSaleSettlement`): account debt is
  attributed to **sales first** (no cross-item cash bleed — cash paid for a service
  cannot settle an on-account sale); GIFT_CARD legs are excluded from account debt
  (lira-session-allocation).
- Payouts: a negative-amount financial item (e.g. Binance receive → cash payout)
  and a loto cash prize both **defer** in a session basket — no item posts its own
  drawer movement; `SessionPaymentService.recordBasketPayment` is the only place
  that pays out (lira-session-payout).
  - **Netted checkout** (owner decision #11-A, 2026-09-24). A CASH-routed
    GENERAL-drawer payout (loto prize, wallet/Binance cash-out) is netted
    against the basket's charge before it ever reaches MultiPaymentInput:
    `netCashPayoutAgainstCharge` (`frontend/src/features/sessions/utils/binanceCart.ts`)
    reduces the charge total by the payout, and change is computed on that
    NET — only the physical difference is recorded. If the payout is bigger
    than the charge, the excess still posts as a real PAYOUT leg (money that
    actually has to leave the drawer); if it's smaller or equal, **no PAYOUT
    leg is sent at all** — that money was absorbed into what the customer
    still owed and never physically moved.
  - **OMT/Whish SYSTEM payouts stay SEPARATE, always.** A negative-amount
    `omt_system`/`whish_system` item's payout is NEVER netted, regardless of
    the chosen method — it always posts its own GROSS PAYOUT leg, tagged
    `payoutOrigin: "SYSTEM"` so `SessionPaymentService` routes it 100% to the
    primary cash drawer instead of the session's blended item-value ratio
    (which would otherwise mis-split it once the General portion no longer
    equals the full gross payout total). A General-drawer leg is tagged
    `payoutOrigin: "GENERAL"` and routes 100% to General. Example: a $100 OMT
    payout plus a $20 unrelated charge books OMT_System −$100 and General
    +$20 — two separate legs, never one netted −$80.
  - **Non-cash payouts stay gross.** A payout routed to CUSTOMER_ACCOUNT or a
    wallet method is never netted, whichever module it came from.
- The operator-edited exchange rate in Session Checkout is stamped on **every**
  basket-created transaction, including custom-service and loto paths
  (lira-session-exchange-rate).
- Exchange has no basket branch: it executes immediately and links via
  `session.linkTransaction` (lira-094).
- **Whole-basket void/refund** (owner decision #11-C, LIRA-201c, 2026-09-24).
  A session-linked row's pooled customer money can never be reversed alone —
  `TransactionRepository._assertReversible` hard-refuses a bare void/refund
  on it. `TransactionRepository.voidSessionBasket`/`refundSessionBasket`
  (wired end to end: `TransactionService`, IPC `transactions:void-session-
  basket`/`transactions:refund-session-basket`, REST `POST /api/transactions/
  session-basket/:sessionId/void`/`.../refund`, `backendApi.ts`) reverse
  every item plus the basket's pooled leg(s)/debt in ONE db transaction,
  replacing the old "Basket item — see admin to reverse" dead end.
  - **Kept change goes back to the customer.** `_reverseSessionPooledPayments`
    negates every pooled `payments` row (session_id set, transaction_id
    NULL) regardless of direction, so the drawer returns exactly what the
    customer handed over. `KEPT_CHANGE` itself posts no drawer leg of its
    own (T3, §11 above) — voiding it flips `status` to VOIDED, which is
    enough to cancel its profit (every profit query already gates on
    `status = 'ACTIVE'`).
  - **A basket-member loto cash prize** gets a dedicated reversal owner,
    `_reverseLotoCashPrize` (rule 20 — `LOTO_CASH_PRIZE` stays
    `NON_REVERSIBLE` standalone, but is bypassed for a basket member via
    `SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES`): it soft-voids the
    prize's `supplier_ledger` CASH_PRIZE row, marks `loto_cash_prizes.voided
    = 1` (migration v181), and delta-adjusts an still-open checkpoint's
    totals. `LotoCashPrizeRepository`'s prize-total/checkpoint queries all
    filter `NOT_VOIDED_CASH_PRIZE_SQL` (rule 14 — one predicate, reused).
    `_assertLotoCashPrizeVoidable` refuses up-front, with the message "This
    prize was already settled with Loto on \<date\>. Fix it from the Loto
    page.", when the prize is already reimbursed or its checkpoint has
    already settled — mirrors `_assertLotoTicketVoidable`.
  - **A pooled session `CREDIT_DEPOSIT`** (a basket payout/change sent to
    the customer's account) is reversed by `_cancelSessionDebt` alongside
    the pre-existing pooled `'Session Debt'` charge (rule 20 — the gap the
    owner named directly: without this, refunding a basket left the
    customer's credit behind).
  - Idempotency: `_assertSessionBasketReversible` refuses a second
    void/refund call on an already-reversed basket up front, before any
    write.

---

## 12. Checkpoints & closing

- The setup wizard writes an **initial checkpoint** row (the immutable timeline
  baseline) with distinct per-currency starting amounts — even when the operator
  entered nothing (lira-085).
- The Checkpoint Timeline flags **any** variance (no tolerance) on both the row badge
  and the detail modal, using a single amber "attention" style for overage and
  shortage alike — never green/red (lira-091-checkpoint-timeline-variance).
  Since LIRA-335 an amber difference is also an **open difference** with a status
  (Open, Partly resolved, Resolved, Closed · Short, Closed · Over). Open keeps
  the amber look; see §12.2.
- **Closing profit = the Profits Overview's GROSS profit for the client's day**
  (LIRA-219). `ClosingService.getDailyStatsSnapshot` computes NO profit SQL of its
  own — `ClosingRepository.getDailyActivityStats` returns only activity stats
  (sales count/total, debt payments, expenses); the service composes profit by
  calling `ProfitService.getSummary(day, day).totals.gross_profit_usd/_lbp`, the
  ONE definition of gross profit (rule 14) the Profits page's own headline card
  reads. This means closing now inherits every Profits-page recognition rule for
  free: per-unit-×-quantity-minus-discount sales, kept change in every module (not
  just loto), LBP for every module (not just loto), proportional partner
  recognition (owner decision E-Q2, 2026-09-24 — a partner row recognises the
  FRACTION the partner has actually covered, not an all-or-nothing gate), and
  client-debt deferral (a module-debt charge withholds its profit until the
  client's repayment FIFO-covers it). The day is `input?.day ?? clientDay()`
  (rule 27) — the caller's day wins; the server's own calendar day is only a
  fallback for a caller that sends none.
  - **Gated, not always shown.** `includeProfit` defaults to **false** (fail
    closed). The caller must pass it explicitly, and even then the transport
    layer decides it via `canIncludeProfit`/`hasProfitsUnlock` (E-Q6): admin, or a
    caller that has unlocked the Profits page. A gated caller still gets activity
    stats and expenses — only the profit fields are withheld, and the snapshot
    carries `profitHidden: true` instead.
  - **Never a silent $0.00 on failure** (E-Q7). If `getSummary` throws, the
    service catches it, logs it, and returns the activity stats with
    `profitUnavailable: true` — the PDF prints "unavailable", never a confident
    zero.
  - **A snapshot, not a restatement** (E-Q3). Profit recognised on a LATER day (a
    debt repaid tomorrow, a partner covering later, a refund of an older sale)
    changes that ORIGIN day on the Profits page and never appears in any already-
    printed closing. The PDF prints an "as of HH:MM" line to make this explicit —
    this is expected, not a bug, and it was already true before LIRA-219.
  - **No stored history / no migration.** `daily_closings`/`daily_closing_amounts`
    carry no profit column; profit exists only inside the PDF generated at print
    time. Old PDFs keep their old (pre-LIRA-219) figures — history is not
    restated.

### 12.1 Carrier-line sold-ahead days (#28, LIRA-218, v184)

A DAYS sale can ask for more days than the shop's own line currently holds —
the sale still happens in ONE transaction, seamlessly, per LIRA-157's "sell:
never refused." `carrier_lines.days_owed` is the running balance of days
promised that the line's real remaining days couldn't cover yet:
selling never pushes the real `validity_expires_at` below today — it consumes
at most what is actually available and banks the shortfall into `days_owed`
instead (a line is **never** classified BURNED because of days sold ahead).
The **next charge** pays off `days_owed` first, at 1:1 and never refused,
before any of that charge's days reach the ordinary VALID/GRACE/BURNED
stacking rule. All of this is ONE shared rule
(`utils/carrierLineValidity.ts`'s `projectValidityExpiry`, rule 14) — the
Recharge page, the self-charge dialog, the dashboard banner and the server
write path all read the same projection, never a second copy.

`carrier_line_owed_deliveries` ("days still to send") is a SEPARATE,
purely operational table: one row per sale that sold ahead, tracking the
customer until the operator "Mark sent"s it once the line is recharged.
Marking sent never books a second sale, a second charge, or touches
`days_owed` — that balance is settled independently by the next charge's
payoff. No reversal owner needed for this table's row itself: voiding/
refunding the original DAYS sale reverses the `carrier_line_movements` row
(which restores `days_owed`) through the existing generic path, and leaves
the delivery row untouched. That dangling row is cosmetic only because
`getAllPending` — the ONLY read the "days still to send" action list uses —
excludes any delivery whose source transaction was voided or refunded (a
`LEFT JOIN transactions` check, `CarrierLineOwedDeliveryRepository`'s M5
fix); `getByCarrierLineId`, the per-line HISTORY view, still shows it.

A charge's `days_owed` payoff is never refused even on a line that would
otherwise classify BURNED (M4 fix): a debt-carrying line can age past the
grace window purely by the calendar while nobody recharges it, and the
owner's "never burned because of days sold ahead" rule extends to that
remainder too — only a burn with **zero** `days_owed` in play still refuses
the whole charge.

### 12.2 Open differences and back-timed resolution (LIRA-335, v222)

Spec Kit: `specs/335-checkpoint-open-differences/` (owner decisions 2026-10-18).

**The problem it solves.** A checkpoint corrects the drawer's expected balance
to the counted cash at once (a `CHECKPOINT_ADJUSTMENT` leg for the delta).
When the owner later finds the missed transaction and re-enters it with
**Set custom time**, the re-entered money used to move the drawer a second
time, so the next checkpoint showed the opposite difference. Now the
re-entered transaction **resolves** the difference instead.

**Open differences.**
- `createCheckpoint` writes one `checkpoint_differences` row per drawer and
  currency it actually corrected (|delta| > the checkpoint's epsilon). `amount`
  is the posted delta, signed: > 0 is Over, < 0 is Short. It is the figure the
  checkpoint posted, not the expected figure the window showed (FR-001). The
  expected figure stored on the checkpoint is now the one the delta was computed
  from (FR-023).
- An all-drawers checkpoint gets one row per drawer and currency, keyed on the
  real drawer name, never `AGGREGATED`.
- Status comes from ONE pure helper, `describeCheckpointDifference`
  (`utils/checkpointDifference.ts`, browser-safe, shared by core and UI):
  `open = max(0, |amount| − Σ active resolutions)`; Resolved when open is
  within epsilon, Closed when `closed_at` is set, Partly resolved when some is
  resolved, otherwise Open. A difference never expires.
- **From now on only** (FR-022, owner decision). Checkpoints saved before v222
  have no difference rows. They stay amber with no status, are never resolved,
  and never appear in the "Open differences only" filter.

**Resolution by a back-timed transaction.**
- The effective time of a transaction is `transactions.created_at`. That is the
  Set custom time when one was given, and the original event time for an
  offline transaction replayed later. `payments.created_at` never carries it.
- Each flow calls `resolveBackTimedDrawerMovement(db, { transactionId, userId })`
  (`repositories/checkpointResolution.ts`, server-only) at the end of its own db
  transaction, after all its legs are posted. It does nothing unless a
  checkpoint of a touched drawer exists after the effective time.
- For each drawer and currency the transaction moved, it nets the transaction's
  drawer-affecting legs (IN and change legs together, once). It then looks at
  the **first** checkpoint of that drawer after the effective time only. When
  that checkpoint has an open difference in the same currency and direction
  (money in resolves an Over, money out resolves a Short), it resolves
  `resolved = min(|net movement|, open)`, carrying the movement's sign (a $30
  expense against a $20 open Short resolves $20). An older or newer checkpoint is never touched,
  even if it has an open difference.
- The resolved part is cancelled on the drawer by an offset leg on the SAME
  transaction: `method = 'CHECKPOINT_RESOLUTION'`, same drawer and currency,
  amount = −resolved, plus the matching `applyDrawerDelta`. Anything above
  the resolved part moves the drawer as before. A
  `checkpoint_difference_resolutions` row links the transaction to the
  difference.
- The transaction keeps its sales, profit, client and history records. Only the
  drawer movement is offset (FR-008). `CHECKPOINT_RESOLUTION` is an internal leg
  (`INTERNAL_LEG_METHODS`): hidden from customer-facing legs, cash flow and
  Profits "By payment", but counted in drawer balances.
- A transaction saved without an earlier time behaves exactly as before.
- **Coverage.** Every flow that saves with `transaction_time` must call the
  resolution step. A source-scan guard
  (`src/__tests__/checkpointResolution.wiring.guard.test.ts`) fails any
  repository that passes `transaction_time` to `createTransaction` without the
  call, unless it is on the guard's exclusion list with a reason. Read that
  list before assuming a flow is covered (session checkout is decided there,
  research R7).

**Void undoes, refund keeps.**
- **Void** means the transaction never happened. The generic void mirrors every
  payments row, so it mirrors the offset leg too. A resolution is active only
  while its transaction is not voided (one named fragment,
  `ACTIVE_RESOLUTION_SQL`), so the difference reopens by the same amount.
  Create + void nets to 0 on every drawer, per currency.
- **Refund** (full, partial or item) keeps the resolution. The counted cash was
  real, and the refund is new cash handed back today. `_reversePayments` runs
  in `refund` mode and skips `CHECKPOINT_RESOLUTION` legs, and item-refund
  scaling filters them out, so the drawer moves by exactly the cash returned.

**Close and Reopen (admin only).**
- **Close** settles what is still open. A Short books one automatic
  **"Drawer shortage"** expense for the open amount:
  - books-only (no payments row, no drawer movement; the checkpoint already set
    the drawer);
  - dated the checkpoint's `closing_date`;
  - linked by `source_ref_table = 'checkpoint_differences'` and
    `source_ref_id = difference id`, so it is `is_auto` (rule 26): hidden in
    Transactions by default, shown on the Expenses page;
  - lowers net profit for that day.

  An Over records nothing in Expenses or Profits. Expenses hold USD and LBP
  only, so closing a Short in another currency records the closed state with
  no expense, and the Close window says so.
- **Reopen** voids the shortage expense and returns the difference to Open or
  Partly resolved.
- "Drawer shortage" is not offered in Add New Expense, and the Expenses page
  cannot void or edit it on its own. Only Reopen (or a resolution) changes it.
- A resolution that arrives after a Short was closed still resolves it, and the
  shortage expense shrinks by the explained amount (voided when fully
  explained). Voiding that transaction grows it back (FR-016). All of this
  goes through one idempotent `syncShortageExpense(differenceId)` (void +
  recreate at the derived target), called after close, reopen, a new
  resolution and a void of a resolver.
- A Closed · Over that a back-timed sale later explains is reopened and
  resolved, so the drawer is not raised twice.
- Never call this "write off": that word means dismissing a party's debt.

**Reversal owners (rule 20).**

| Row written | Reversal owner |
| --- | --- |
| `CHECKPOINT_RESOLUTION` payments leg + drawer delta | generic void (`_reversePayments`, mode `void`); refund skips it by design |
| `checkpoint_difference_resolutions` row | none needed: inactive once its transaction is voided (derived) |
| Drawer shortage expense | `syncShortageExpense` (Reopen, new resolution, void of a resolver); manual void refused |
| `checkpoint_differences` row | none: belongs to its checkpoint, which is non-reversible |

**Screens.** The Checkpoints timeline shows each difference's status, a short
"resolved by" or "closed" line, and an "Open differences only" filter with a
count. The details window lists what resolved each currency, what is still
open, and offers Close difference… or Reopen to admins. Forms with Set custom
time show one hint line under Transaction time when the chosen time is before
a checkpoint with an open difference (`getOpenDifferencesAfter({ at })`, the
time comes from the client, rule 27).

**Guards.** Core: `checkpointResolution.test.ts`,
`checkpointResolution.flows.test.ts` (create + void nets to 0 per flow),
`checkpointResolution.reversal.test.ts`, `CheckpointDifferenceRepository.test.ts`,
the wiring guard above. Web e2e: `lira-web-075-checkpoint-open-differences`.

---

## 13. New-feature checklist

Copy this into your task when building any flow that moves money:

1. **Schema/plumbing** (CLAUDE.md): migration in BOTH `migrations/index.ts` and
   `create_db.sql`; repository → service → handler (+ Zod, `requireRole`, envelope);
   preload binding with ALL fields typed; `electron.d.ts`; core build & sync.
2. **Transactions row**: type constant in `transactionTypes.ts`; `source_table`/`source_id`;
   SQLite timestamp format; stamp `client_id`, `session_id`, `exchange_rate`,
   `profit_usd`/`profit_lbp`. Check whether an auto supplier sibling row is needed.
3. **IN/OUT badge**: add the type to `getCashFlowDirection` (§3) — else blank badge.
4. **Payment legs** (§4): accept split + change legs in ONE IPC payload; branches use
   IN legs only; OUT legs debited once by the shared loop; wire the form's
   Return/Change output end-to-end.
   Kept change: declare `payer` on the form and call `resolveKeptChange` in the
   repository (§4.1) — never hand-roll it.
   Payout screen with a money-in side: send it as `customerPayments[]` (never with
   `feePayments`) and book it with `bookCustomerLegs` (§4.3) — never a lump inflow.
5. **Drawers** (§7): correct drawer per leg, per currency; app-wallet rule if a wallet
   is involved.
6. **Client propagation** (§6): UI → IPC → handler → repo → `createTransaction({client_id})`;
   plus the session branch putting the client into `formData`.
7. **CUSTOMER_ACCOUNT** (§5): open debt — books a `debt_ledger` row, no prior-balance
   precondition; gate on name+phone via `canChargeToCustomerAccount`; one debt row,
   correct threshold.
8. **Supplier/partner ledger** (§8): correct sign; amount = whatever quantity is actually
   OWED to the counterparty — for the primary cash drawer (OMT/WHISH, §8.1) that's the
   **GROSS** `x + f` (SEND) / `−(x − f)` (RECEIVE) since LIRA-095 Phase 2 — the whole
   fee is owed and the commission settles separately (pre-cutover rows, `commission_model
= 0`, keep the old netted form); the principal `x` is real
   cash sitting in the PCD, a different fact from what's owed the provider, so both are
   tracked — that is not the "one obligation, two owners" bug (item 14), it's two
   distinct obligations; prepaid-units model (debt at top-up, not per sale) still applies
   where there is no provider-fee relationship (MTC/Alfa/Katsh/iPick); secondary
   (partner-routed) system → partner ledger, never supplier ledger.
9. **Void path** (§9): reversible or gated? If reversible, prove drawer + ledger +
   profit all restore, including any supplier sibling.
10. **Profits** (§10): stamp per-currency profit; refunds must net it to zero. A
    supplier-paid commission is NOT stamped at transaction time on a new-model row — it is
    entered at settlement (§8.1, §10); a card margin goes to Mobile Services, never to
    "Commission". A partner obligation's profit counts cash coverage — and, for a Custom
    Services Pay out only, netting against what the shop owes the same partner (one
    fragment, `constants/partnerObligation.ts`).
11. **Sessions** (§11): add a basket branch (defer, formData client, payout rules) or
    document why not.
12. **Audit viewer**: label, visibility (hidden types), cash-only filter behavior.
13. **E2E guard**: delta + identity assertions per CLAUDE.md rule 15; prove the test
    FAILS on the pre-fix code (rule 17). See the
    [e2e suite index](../frontend/tests/e2e-electron/README.md).
14. **One obligation, one owner — never both** (added 2026-07-29, from the ORIGINAL
    OMT/WHISH gross-reserve bug — predates both the float model and the current
    primary-cash-drawer model): whenever a flow moves money into a provider/counterparty
    container (a drawer, a wallet, an escrow), write down in the PR/task which ledger
    owns the obligation (`supplier_ledger`? `partner_ledger`? nothing — it's fully
    realized?) and then confirm the SAME obligation is not ALSO encoded in a drawer
    balance. The original bug was exactly this: the principal `x` was tracked BOTH by
    the `OMT_System` drawer (as a provider-side gross reserve) AND by `supplier_ledger`
    (gross owed) AND settlement re-debited it a third time — three bookings of one
    number. This is NOT what the current model does even though its ledger is gross
    again (§8.1) — the PCD holds `x` as the shop's own physical cash, a different fact
    from "what's owed the provider," so tracking both is tracking two numbers, not one
    (§8.1's explainer). Write the invariant for your flow (§8.1's
    `Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed) = c + kept_change` is the
    template) and prove it holds, per currency, failing-first (rule 17), before merging.

15. **Reconcile the payment legs against the amount, and make ONE rule decide which legs count**
    (added 2026-09-15, from LIRA-189's four hardening rounds — see
    `OMT_OPEN_CREDIT_ACCOUNT_PLAN.md` §11). Any flow that accepts `payments[]` and moves a drawer
    must answer two questions, and the second is the one that gets missed:
    **(a) Does anything compare the legs to the amount being recorded?** If not, an overpay silently
    drains the drawer and an underpay silently settles a debt nobody paid — with no ledger row, no
    profit stamp and no error. It surfaces weeks later as a drawer that will not reconcile.
    **(b) Do the guard and the posting loop agree on which legs count?** They drift. Four separate
    leaks in one method came from exactly this: the guard summed every leg while the posting loop
    `continue`d past non-drawer-affecting methods (`CUSTOMER_ACCOUNT`, `GIFT_CARD`), so a batch paid
    entirely in those was stamped fully settled with **zero dollars moving**. Derive both sides from
    ONE predicate; never write `isDrawerAffectingMethod` in two places.
    Two more from the same family: an **equal-and-opposite IN/OUT pair** nets to zero in a guard that
    only checks the net, yet routes to two DIFFERENT drawers and washes money between them unaudited
    (`settleAccount` closed this by rejecting OUT legs outright — a supplier settlement has no
    customer, so there is no change to return); and any read taken **before** the write transaction
    and acted on inside it is a race — move it in, and check `.run().changes`, because a stamp that
    silently affects zero rows must never count as success.
    **This bug class is LIVE in shipped code** (`settleTransactions`, `recordSupplierCashflow`) —
    LIRA-193.

16. **Back-timed transactions resolve checkpoint differences** (LIRA-335, §12.2). A flow that
    accepts `transaction_time` (Set custom time) and moves a drawer must call
    `resolveBackTimedDrawerMovement` at the end of its db transaction, after all legs are posted.
    Otherwise a re-entered missed transaction moves the drawer a second time and the next
    checkpoint shows a false opposite difference. The wiring guard
    (`checkpointResolution.wiring.guard.test.ts`) fails a repository that skips it, unless the
    exclusion list names it with a reason. Prove create + void nets to 0 per drawer and currency.

### Offline replay (LIRA-306)

Desktop PCs record write actions offline as events. The server replays each one later through the channel's
binding (`packages/core/src/offline/bindings/`), at the time it happened. Any new or changed write channel must:

1. **Classify the channel** in `offline/channelPolicy.ts` as `offline`, `checkpoint`, `online_only`, `read` or
   `local`. An offline or checkpoint channel needs a core schema, a binding that calls the SAME service its REST
   route calls, and a fixture (`offline/testHelpers/fixtures/`). `channelPolicy.complete` and `bindings.complete`
   fail otherwise.
2. **Keep ids id-named** (`id`, `*_id`, `*Id`, declared `{kind, id}` pairs). Offline ids are rewritten only in id
   positions. A money field that looks like an id is never touched, and an id under another name is never rewritten.
3. **Write every business timestamp through `requestNow()`**, or a time the user typed. Name `created_at` in
   inserts instead of relying on the column default. Read rates through `getUsdLbpSellRate()` /
   `getEffectiveRate()`. The `requestNow.guard` ratchet catches the server clock. A writer reached only by online-only
   channels may stay on the clock if it is listed in `offline/testHelpers/onlineOnlyExempt.ts`, which
   `onlineOnlyExemptions.guard` checks.
4. **No write outside the service.** A handler-side write the binding would not repeat must be in
   `MAP_EXCLUDED_TABLES` (`handlerBindingParity` checks it). Bindings await microtasks only: a replay never yields
   to the event loop.

### Counterparty checklist

Touching a client (`debt_ledger`), partner (`partner_ledger`), or supplier
(`supplier_ledger`) ledger? Read
**[docs/COUNTERPARTY_LEDGERS.md](./COUNTERPARTY_LEDGERS.md)** first — the
canonical model (lifecycle, per-ledger transaction-type catalog + reversal
owner, coverage/epsilon conventions, the full profit-recognition gate table,
and the current known gaps). Five things every new charge/settlement type
must nail:

1. **Routing is mutually exclusive** — a transaction charges the client's
   debt ledger **or** a selected partner's ledger, never both on one row.
2. **Counterparty is actually selected** — a client via `canChargeToCustomerAccount`
   (name + phone); a partner via a real `partnerId`, never auto-selected.
3. **Coverage is applied on settlement** — FIFO, oldest-first, through the
   named coverage mechanism for that ledger (never a fresh copy-pasted loop).
4. **Recognition is gated** — a new charge/accrual type must be inside the
   relevant profit-recognition scan (`notPartnerPending`/`txnNotPartnerPending`
   for partners, `notDebtPending` for client-account service debt, or the
   sale/FS-specific gate) — silently outside the scan means accidental
   immediate recognition, not a decision.
5. **Reversal owner is named** — whitelisted in the generic path
   (`MODULE_DEBT_TRANSACTION_TYPES` / type-agnostic `_reversePartnerLedger`)
   or explicitly gated non-reversible with a documented correction path
   (rule 20).
