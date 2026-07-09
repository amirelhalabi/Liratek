# LiraTek Feature Guide — money rules & cross-cutting invariants

**Read this before building or modifying ANY flow that writes money.** Every rule
below is enforced by at least one regression test; the *Guarded by* column names the
e2e spec (in `frontend/tests/e2e-electron/`) or code file that proves it. If your
feature violates a rule here, a test will fail — or worse, money will silently leak.

Companion docs: [CLAUDE.md](../CLAUDE.md) (non-negotiable rules 11–17),
[e2e suite index](../frontend/tests/e2e-electron/README.md),
[transactionTypes.ts](../packages/core/src/constants/transactionTypes.ts),
[payments.ts](../packages/core/src/utils/payments.ts).

---

## 1. Module taxonomy

**Customer-interaction modules** (each writes unified transactions):

| Section | Code identity | Notes |
| --- | --- | --- |
| POS | `sales`, `sale_items` | multi-item cart, drafts, refunds |
| Primary system send/receive | `financial_services`, service_type SEND/RECEIVE | the shop's **base system** (`system_settings.shop_base_system`, default OMT) |
| Secondary system send/receive | same table, routed **through a partner** | the non-base system (e.g. WHISH when base=OMT); obligation lives in `partner_ledger`, never `supplier_ledger` |
| Exchange | `exchange` | USD↔LBP, direction "both" |
| Maintenance | `maintenance_jobs` | statuses: Received / In_Progress / Ready / Delivered / Delivered_Paid (there is **no** "completed" status) |
| Custom services | `custom_services` | includes Hold Money (HOLD_MONEY / HOLD_MONEY_COLLECT) |
| Recharge — MTC | provider `MTC` | credits (CREDIT_TRANSFER), days |
| Recharge — Alfa | provider `ALFA` | credits, days, **Alfa Gift** (ALFA_GIFT — payload `{type, amount, cost, price}`) |
| Recharge — iPick | provider `IPICK` | bills + catalog items |
| Recharge — Katsh | provider `Katsh` | bills + catalog items |
| Whish App | provider `WHISH_APP` (drawer `Whish_App`) | transfers (send/receive) + bills/items section. Spelling is always `WHISH_APP` — the `WISH_APP` typo was migrated away in v105 |
| OMT App | provider `OMT_APP` (drawer `OMT_App`) | transfers (send/receive) |
| Binance | provider `BINANCE` | send + cashout (USDT wallet) |
| Loto | `loto_tickets`, `loto_cash_prizes` | ticket sales, cash prizes, monthly fees, settlements |

**Shop-only pages**: debts, inventory, clients, profits (admin-only), sessions,
partners, suppliers, vouchers/gift cards, expenses, closing.

**Logging/audit**: Transactions viewer (`/audit`), checkpoint timeline.

---

## 2. The unified `transactions` table

Every money action writes **at least one** row here. This is the accounting journal.

| Rule | Detail | Guarded by |
| --- | --- | --- |
| Identity | A row is identified by `source_table` + `source_id` (+ type). Never "newest row" — `created_at` is second-granular and ties are common. | lira-078, lira-092 |
| Multiple rows per action | One user action can write several rows: a cost/price SEND or supplier-credit op writes a `FINANCIAL_SERVICE`/`RECHARGE` row **and** an auto `SUPPLIER_PAYMENT` sibling. | lira-063 |
| Timestamp format | `created_at` must be SQLite `CURRENT_TIMESTAMP` format (`YYYY-MM-DD HH:MM:SS`). Never JS `toISOString()` — `'T' > ' '` in string ordering, so ISO rows sort permanently-newest for their whole day. | lira-079 |
| Timestamp zone | Stored marker-less **UTC**; render via `parseDbDate` (pins to UTC) so local wall-clock displays correctly. Raw `new Date(str)` shows hours-off times. | lira-transactions-timezone |
| Business date | `transaction_time` (operator-overridable) drives by-date reports (Cash Report). | lira-087 |
| Status & voiding | `status` ∈ ACTIVE / VOIDED. Deletion = a **reversal row** of the same type with `reverses_id` → original and negated amounts. No "DELETED" types. | transactionTypes.ts, lira-092 |
| Stamped fields | `client_id`, `session_id`, `exchange_rate`, `profit_usd` / `profit_lbp` must be set by the creating repository — reports read them from here. | lira-094, lira-session-exchange-rate, lira-session-profits |
| Hidden types | The viewer hides `CLIENT_CREATED` and non-credit `SUPPLIER_PAYMENT`. The `is_credit` variant ("Supplier Credit", commission revenue) stays visible. | lira-transactions-hidden-types |

---

## 3. IN/OUT semantics per transaction type

The green ↓ (in) / red ↑ (out) badge in the transactions table comes from
`getCashFlowDirection` in [frontend/src/features/audit/cashFlow.ts](../frontend/src/features/audit/cashFlow.ts).
**A new transaction type MUST add a case there — unmapped types render a blank badge**
(this was the B7 loto bug).

| Direction | Types |
| --- | --- |
| **in** (customer hands us cash) | SALE, RECHARGE, CUSTOM_SERVICE, MAINTENANCE, DEBT_REPAYMENT, SUPPLIER_PAYMENT, MTC_TOPUP, ALFA_TOPUP, LOTO, FINANCIAL_SERVICE with service_type SEND or BILL |
| **out** (shop pays out of drawers) | FINANCIAL_SERVICE with service_type RECEIVE, EXPENSE, LOTO_MONTHLY_FEE, LOTO_SETTLEMENT, LOTO_CASH_PRIZE, SUPPLIER_SETTLEMENT, CREDIT_CASH_OUT, RECHARGE_TOPUP (classic from-drawer) |
| **in** (special case) | RECHARGE_TOPUP with `partnerId` or `cashPaid` metadata (Whish credit acquisition — provider drawer inflow) |
| **both** | EXCHANGE |

On a system SEND the row reads as cash **in only**; on a RECEIVE as cash **out only**
with the per-currency payout legs shown in the payment-legs subtext (lira-075).
`isCashTransaction` (≥1 CASH leg) drives the "Cash only (till)" filter.

---

## 4. Payment legs (split payment, change, the ONE-loop rule)

Source of truth: [packages/core/src/utils/payments.ts](../packages/core/src/utils/payments.ts) + CLAUDE.md rule 16.

- The frontend sends **all legs in ONE IPC call**: split legs, change/return legs,
  cashout method. There is never a follow-up call — money fixes belong in the repository.
- A leg without `direction` is **IN** (customer-paid / payout funding). `direction: "OUT"`
  marks change/return legs. `partitionLegs` splits them.
- Each money repository has **ONE shared end-of-transaction loop** that debits every
  drawer-affecting OUT leg exactly once ("Change returned"). Flow-specific branches
  must build from the **IN set only** — iterating `returnLegs` in a branch double-debits
  the drawer (caught pre-merge in C1; guarded by lira-074).
- In the stored row, OUT legs carry **negative `signed_amount`**; `amount` is absolute.
  Same-currency IN legs are kept separate (no premature merge) — lira-064.
- Legs are returned structurally by `TransactionRepository.getRecent` (`payments[]`)
  and appended by the viewer — never baked into the stored `summary` text (lira-064).
- Internal legs (COMMISSION, PM_FEE, TRANSFER, CREDIT_RETURN, CREDIT_USED, SMS_COST,
  provider cost outflows) must **not** surface as customer-facing legs (lira-064, lira-078).
- **Every form that collects payment lines must forward its change legs.** Loto,
  Alfa Gift, and custom services each lost them once (page never wired Return/Change,
  component didn't forward `onReturnChange`, repository ignored `data.payments`) — lira-088.
- On a split RECEIVE payout, **each leg debits its own drawer in its own currency**
  (a $190 + 540,000 LBP payout debits both) — lira-074.
- `NON_DRAWER_METHODS` = { CUSTOMER_ACCOUNT, GIFT_CARD } — these legs never touch a drawer.
- **One payment covering N transactions**: legs must book against exactly ONE of
  them; the others are sent with `deferPayment: true` (skips the inflow and
  change-leg blocks, still books cost outflow + supplier commission). This is how
  session baskets and multi-bill checkouts work — attaching the same legs to two
  transactions double-books the drawer (lira-095, lira-session-basket-payment).

---

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
- Only **IN** CUSTOMER_ACCOUNT legs book debt; an OUT CUSTOMER_ACCOUNT leg is a
  store-credit deposit (payments.ts).
- GIFT_CARD is prepaid/collected value: debt-like for drawer purposes but **excluded
  from account debt** in session allocation, so a gift-card-paid sale realizes
  (lira-session-allocation).
- POS partial payment books a debt row only when `client_id` is present and the
  shortfall exceeds **$0.05** (SalesRepository).
- Debt repayment uses the smart-rounding algorithm (see README → Business Logic).
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
wallets (`OMT_App`, `Whish_App`, `Binance`), plus the base-system drawer (e.g. OMT).

| Rule | Detail | Guarded by |
| --- | --- | --- |
| App-wallet movement | SEND: app wallet −, General + · RECEIVE: app wallet +, General −. Binance is the reference implementation. | lira-077 |
| System drawer can go negative | A RECEIVE leaves the system drawer negative by the transfer amount (provider owes shop). | lira-074 |
| SMS cost | MTC/Alfa credit transfer debits provider drawer by amount **+ SMS cost** = `ceil(amount/3) × $0.16`; converted to LBP for LBP transfers. | recharge.spec, lira-090 |
| Currency of payment | Book what the customer actually paid — an LBP-priced ticket paid in USD credits General **USD**, no phantom LBP. | lira-082 |
| Read APIs | `dashboard.getDrawerBalances()` → general/omt only. `recharge.getDrawerBalances()` → all drawers, name-keyed. `closing.getSystemExpectedBalancesDynamic()` → expected balances. | fixtures/specs |

---

## 8. Supplier ledger

Balance = **SUM of ledger rows**; **> 0 = shop owes supplier** ("You owe", red).

| Rule | Detail | Guarded by |
| --- | --- | --- |
| Entry signs | `TOP_UP` positive; `PAYMENT` negative; `ADJUSTMENT` signed either way (opening balances); `SUPPLIER_PAYS_US` signed by direction of obligation (a Katsh BILL books −20,000 LBP commission = supplier owes us). | lira-056/059/062/084 |
| Amount = transfer only | The auto ledger entry for a system transaction equals the **transfer amount** — never customer-paid total, never amount ± fee/commission. | lira-076 |
| Prepaid-units model | Supplier debt is booked **ONCE at top-up**; sales only draw down the provider drawer — no per-sale SALE_COST. | lira-061, lira-078 |
| Loto exception | Standard convention since v119: a ticket sale books **+(sale − commission)**; a cash prize books **−prize**. | lira-091-loto-ledger-sign |
| Credit top-up | Supplier-credit top-up funds the provider drawer and touches **no** cash drawer; settle later via `PAYMENT` from a named drawer (General −). | lira-056 |
| Cash both ways | PAY (shop→supplier) and `SUPPLIER_PAYS_US` (supplier→shop) both move **General**, never the provider stock drawer. | lira-059 |
| Void restores everything | Voiding a SUPPLIER_PAYMENT restores supplier balance AND drawer, and soft-flags the ledger row (`is_refunded`, v120); aggregates exclude flagged rows. | lira-092 |
| Secondary system | Transactions through a partner write **partner_ledger**, never supplier_ledger; the Suppliers page hides the non-base provider. | lira-supplier-secondary-system |

Partner ledger: a Whish top-up **via partner** credits `Whish_App`, touches no cash
drawer, and books a partner CREDIT (we owe the partner); **from client** debits General
by cashPaid with no partner row (the margin exists only as a drawer delta) — lira-057.

---

## 9. Void / refund

- Journal pattern: void writes a same-type reversal row (`reverses_id` set, negated
  amounts); the original's status becomes VOIDED. Net drawer effect across
  create + void = 0. Match originals by `source_id` + `reverses_id IS NULL`.
- Void/refund actions live in the **Transactions table only** (owner decision 2026-07-04).
- `NON_REVERSIBLE_TRANSACTION_TYPES` (LOTO family, SUPPLIER_SETTLEMENT, RECHARGE_TOPUP,
  REFUND, …) are **gated in the repository** — raw IPC void returns
  `{ success: false, error: /cannot be voided/ }`. Blocking beats corrupting.
  A new type must decide: reversible (then prove drawer + ledger + profit all restore)
  or listed as non-reversible.
- Refund reverses profit — a refunded transaction's profit nets to 0; per-item refunds
  pro-rate the sale's discount (lira-090).
- Maintenance: an unpaid draft deletes cleanly (status change, no reversal row); a paid
  job's delete is **blocked** — go through refund/void (lira-081).
- **Known open gap** (LEFT_TO_DO): voiding a FINANCIAL_SERVICE/RECHARGE row leaves its
  auto SUPPLIER_PAYMENT sibling standing. Account for the sibling when touching voids.

---

## 10. Profits

- Source of truth: `transactions.profit_usd` / `profit_lbp`, aggregated per module by
  `profits.summary` — a flow that never stamps profit is invisible to the page (loto and
  maintenance both had this bug).
- Admin-only in **three layers**: nav (module `admin_only=1`), route (`<AdminRoute>`),
  and IPC (`requireRole(["admin"])`) — lira-071.
- Discounts reduce profit; per-item refund of a discounted sale nets to exactly 0.
- USD and LBP profits are tracked **separately** per module (an LBP maintenance job
  books `profit_lbp`; summing only `profit_usd` loses it).
- Recharge teshriji profit = (price − cost) − SMS cost, SMS converted for LBP transfers.
- Session-basket items must book the same profit as direct sales (lira-session-profits).
- Hold Money books zero profit. Whish top-up-from-client margin appears only as a
  drawer delta, never a profit row (lira-057).

---

## 11. Sessions (customer baskets)

- Start requires a name (auto-creates client with phone). Only an **ACTIVE** session
  blocks a duplicate; multiple sequential sessions per day are allowed
  (lira-session-multiple-per-day).
- Cart items are stored as `formData` and replayed **verbatim** at checkout (see §6).
- **ONE pooled payment** per basket: posted to the drawer exactly once, attached to
  every session-linked transaction row (lira-session-basket-payment).
- **ONE debt entry** per basket for the whole on-account portion — never per item
  (lira-session-basket-debt).
- Allocation (`SessionPaymentService.backfillSaleSettlement`): account debt is
  attributed to **sales first** (no cross-item cash bleed — cash paid for a service
  cannot settle an on-account sale); GIFT_CARD legs are excluded from account debt
  (lira-session-allocation).
- Payouts: a negative-amount financial item (e.g. Binance receive → cash payout)
  **self-posts** its drawer movement even in deferred mode; a loto cash prize instead
  **defers** and checkout emits ONE net cash-OUT leg — either way the payout posts
  exactly once (lira-session-payout).
- The operator-edited exchange rate in Session Checkout is stamped on **every**
  basket-created transaction, including custom-service and loto paths
  (lira-session-exchange-rate).
- Exchange has no basket branch: it executes immediately and links via
  `session.linkTransaction` (lira-094).

---

## 12. Checkpoints & closing

- The setup wizard writes an **initial checkpoint** row (the immutable timeline
  baseline) with distinct per-currency starting amounts — even when the operator
  entered nothing (lira-085).
- The Checkpoint Timeline flags **any** variance (no tolerance) on both the row badge
  and the detail modal, using a single amber "attention" style for overage and
  shortage alike — never green/red (lira-091-checkpoint-timeline-variance).

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
5. **Drawers** (§7): correct drawer per leg, per currency; app-wallet rule if a wallet
   is involved.
6. **Client propagation** (§6): UI → IPC → handler → repo → `createTransaction({client_id})`;
   plus the session branch putting the client into `formData`.
7. **CUSTOMER_ACCOUNT** (§5): open debt — books a `debt_ledger` row, no prior-balance
   precondition; gate on name+phone via `canChargeToCustomerAccount`; one debt row,
   correct threshold.
8. **Supplier/partner ledger** (§8): amount = transfer only; correct sign; prepaid-units
   model (debt at top-up, not per sale); secondary system → partner ledger.
9. **Void path** (§9): reversible or gated? If reversible, prove drawer + ledger +
   profit all restore, including any supplier sibling.
10. **Profits** (§10): stamp per-currency profit; refunds must net it to zero.
11. **Sessions** (§11): add a basket branch (defer, formData client, payout rules) or
    document why not.
12. **Audit viewer**: label, visibility (hidden types), cash-only filter behavior.
13. **E2E guard**: delta + identity assertions per CLAUDE.md rule 15; prove the test
    FAILS on the pre-fix code (rule 17). See the
    [e2e suite index](../frontend/tests/e2e-electron/README.md).
