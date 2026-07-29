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
| **in** (customer hands us cash)    | SALE, RECHARGE, CUSTOM_SERVICE, MAINTENANCE, DEBT_REPAYMENT, MTC_TOPUP, ALFA_TOPUP, LOTO, FINANCIAL_SERVICE with service_type SEND or BILL                                            |
| **out** (shop pays out of drawers) | FINANCIAL_SERVICE with service_type RECEIVE, EXPENSE, LOTO_MONTHLY_FEE, LOTO_SETTLEMENT, LOTO_CASH_PRIZE, SUPPLIER_SETTLEMENT, CREDIT_CASH_OUT, RECHARGE_TOPUP (classic from-drawer) |
| **in** (special case)              | RECHARGE_TOPUP with `partnerId` or `cashPaid` metadata (Whish credit acquisition — provider drawer inflow)                                                                           |
| **metadata-resolved**              | SUPPLIER_PAYMENT, PARTNER_SETTLEMENT, PARTNER_PAYMENT — direction from `metadata.counterparty.flow` (OUT→out, IN→in); SUPPLIER_PAYMENT also accepts `metadata.direction` PAY/RECEIVE |
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
  assumed tender = service currency (docs/plans/todo_plans/PAYMENT_LEGS_INTEGRITY_PLAN.md).
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
  (KatchForm bills, FinancialForm catalog items) submits one transaction per
  unit but books ALL legs against exactly ONE of them — the **carrier**; see
  "One payment covering N transactions" below. The carrier's own `price` is
  only that one unit's share of the cart, so reconciling legs against `price`
  would hard-reject every legitimate multi-unit checkout — the caller instead
  supplies `checkoutTotal: { usd, lbp }` (the full cart total, in whichever
  currencies it was denominated) and the repository reconciles against THAT.
  Omitted → unchecked (single-unit checkouts, scripted callers). The void-path
  gap this per-unit/carrier split still leaves open is tracked in
  docs/plans/todo_plans/CARRIER_LEGS_VOID_ASYMMETRY.md.
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
- **One payment covering N transactions**: legs must book against exactly ONE of
  them (the carrier); the others are sent with `deferPayment: true` (skips the
  inflow and change-leg blocks, still books cost outflow + supplier commission).
  This is how session baskets and multi-bill checkouts work — attaching the same
  legs to two transactions double-books the drawer (lira-095,
  lira-session-basket-payment). See "Carrier `checkoutTotal`" above for how the
  carrier's required total is computed in a multi-unit cart.

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

| Rule                          | Detail                                                                                                                                                                          | Guarded by              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| App-wallet movement           | SEND: app wallet −, General + · RECEIVE: app wallet +, General −. Binance is the reference implementation.                                                                      | lira-077                |
| System drawer is a spendable float (float model, 2026-07-29) | `OMT_System`/`Whish_System` holds the principal `x` the shop keeps **inside the provider's own system** — it is not a settlement holding pen. SEND draws it down (`−x`, or `−(x−f)` when the customer's fee is already included in what they handed over); RECEIVE fills it up (`+x`, bare principal — the fee never touches this leg, see §8). A CUSTOMER_ACCOUNT-funded SEND still draws it down **immediately**, since the transfer physically happened even though the shop collects the cash later. **It MAY go negative, by design**: that means the shop sent out more than it had put into the float and is temporarily spending the provider's money — an overdraft, not an error. The periodic fee-settlement in §8 does NOT clear it; only a real top-up or another RECEIVE does. Do not "fix" a negative balance back to zero — that was the job of the old (wrong) gross-reserve model this replaced. | `OmtSystemFeeCharacterization.test.ts` |
| SMS cost                      | MTC/Alfa credit transfer debits provider drawer by amount **+ SMS cost** = `ceil(amount/3) × $0.16`; converted to LBP for LBP transfers.                                        | recharge.spec, lira-090 |
| Currency of payment           | Book what the customer actually paid — an LBP-priced ticket paid in USD credits General **USD**, no phantom LBP.                                                                | lira-082                |
| Read APIs                     | `dashboard.getDrawerBalances()` → general/omt only. `recharge.getDrawerBalances()` → all drawers, name-keyed. `closing.getSystemExpectedBalancesDynamic()` → expected balances. | fixtures/specs          |

> **Float-model migration status as of 2026-07-30.** All core-jest specs listed here as
> stale in an earlier draft of this box (`crossCurrencyTender`, `legReconciliation`,
> `sessionCashoutGuard`, `partner`, `receiveSplitPayout`, `supplierLedgerAmount`) HAVE been
> migrated to the float-model numbers, along with `PostRefactorVerification`, `saleCost` and
> `CounterpartyMetadataContract` (three files no enumeration caught — they surfaced only when
> the suite was actually run). The RECEIVE customer-fee UI now exists: `Services/index.tsx`
> passes `includingFees` unconditionally and sends `omtFee`/`whishFee` on RECEIVE, so the
> `serviceType === "SEND" ? includingFees : false` hardcode that suppressed it is gone.
>
> **Executed:** `packages/core` jest 1190/1190 (112 suites), `yarn typecheck` clean across all
> workspaces, `scripts/check-tenant-scoping.mjs` 0 violations / 629 statements.
> **NOT executed:** desktop e2e, web e2e (incl. the new
> `frontend/tests/e2e-web/lira-web-016-omt-system-float-fee.spec.ts`), frontend/backend jest,
> `yarn lint`. Desktop e2e needs the Electron better-sqlite3 ABI; the numbers above were
> produced under the Node ABI.
>
> **Rule 17 debt — read this before trusting a guard here.** Most float-model assertions were
> hand-derived from the target table rather than proven failing-first, because that pass ran
> under a no-execution constraint. Every such guard carries a `// TODO(rule-17)` comment
> naming exactly what to break to make it red. A guard that has never failed proves nothing —
> clear that debt before treating this section as fully guarded.
>
> **Cutover:** the owner settles all OMT/Whish balances to zero before this ships, then
> re-seeds the true float via Initial Drawer Amounts. That is what makes the fee-only
> `supplier_ledger` change need no data migration.

---

## 8. Supplier ledger

Balance = **SUM of ledger rows**; **> 0 = shop owes supplier** ("You owe", red).

| Rule                     | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Guarded by                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Entry signs              | `TOP_UP` positive; `PAYMENT` negative; `ADJUSTMENT` signed either way (opening balances); `SUPPLIER_PAYS_US` signed by direction of obligation (a Katsh BILL books −20,000 LBP commission = supplier owes us).                                                                                                                                                                                                                                                                                                             | lira-056/059/062/084                                                  |
| Amount = **fee-only**, not gross (float model, 2026-07-29) | The auto ledger entry for an OMT/WHISH system **SEND or RECEIVE** — both directions book the SAME shape now — is `\|fee\| − \|commission\|` (the provider's fee, net of the shop's own cut), via the ONE `feeOwedDelta()` function (`FinancialServiceRepository.ts`, next to its SQL mirror `SUPPLIER_OWED_EXPR` — rule 14, single definition, both consumed by every owed read: Settle tab, Suppliers "Total Owed", `getUnsettledSummaryByProvider`). The **principal `x` never appears here** — it already moved through the system-drawer float (§7). Both directions write `entry_type: TOP_UP` (unsigned) — RECEIVE deliberately does NOT use `PAYMENT`, because `addLedgerEntry` force-negates `PAYMENT` amounts, which would make a RECEIVE's fee obligation silently *reduce* what's owed instead of increasing it like a SEND's does. **Wallet providers (OMT_APP/WHISH_APP/BINANCE) book NOTHING** — prepaid balance, no supplier debt (`WALLET_PROVIDERS`). Legacy cost/price-flow SEND (prepaid-units model, row below) is unaffected — it still books the sale `cost`, not a fee. | `OmtSystemFeeCharacterization.test.ts`, `SupplierRepository.settlement.test.ts` |
| Prepaid-units model      | Supplier debt is booked **ONCE at top-up**; sales only draw down the provider drawer — no per-sale SALE_COST.                                                                                                                                                                                                                                                                                                                                                                                                              | lira-061, lira-078                                                    |
| Loto exception           | Standard convention since v119: a ticket sale books **+(sale − commission)**; a cash prize books **−prize**. Checkpoint settlement's payment leg is the **NET** (commission kept back) — no separate commission drawer credit (a full sale→settle cycle nets drawers **+commission exactly once**).                                                                                                                                                                                                                        | lira-091-loto-ledger-sign, LotoCheckpointRepository.settleDrawer.test |
| Credit top-up            | Supplier-credit top-up funds the provider drawer and touches **no** cash drawer; settle later via `PAYMENT` from a named drawer (General −).                                                                                                                                                                                                                                                                                                                                                                               | lira-056                                                              |
| Cash both ways           | PAY (shop→supplier) and `SUPPLIER_PAYS_US` (supplier→shop) both move **General**, never the provider stock drawer.                                                                                                                                                                                                                                                                                                                                                                                                         | lira-059                                                              |
| Void restores everything | Voiding a SUPPLIER_PAYMENT restores supplier balance AND drawer, and soft-flags the ledger row (`is_refunded`, v120); aggregates exclude flagged rows.                                                                                                                                                                                                                                                                                                                                                                     | lira-092                                                              |
| Secondary system         | Transactions through a partner write **partner_ledger**, never supplier_ledger; the Suppliers page hides the non-base provider.                                                                                                                                                                                                                                                                                                                                                                                            | lira-supplier-secondary-system                                        |
| Walk-in on the secondary system is rejected | A transaction on the non-base provider (e.g. WHISH when `shop_base_system = OMT`) with no `partnerId` **throws** instead of silently booking nothing — the old behavior lost the obligation into no ledger at all. Route it through a partner (`partnerId` set → THROUGH/FOR partner flow, §1). | `OmtSystemFeeCharacterization.test.ts` CASE 8/8b |

Partner ledger: a Whish top-up **via partner** credits `Whish_App`, touches no cash
drawer, and books a partner CREDIT (we owe the partner); **from client** debits General
by cashPaid with no partner row (the margin exists only as a drawer delta) — lira-057.

### 8.1 THE invariant — quote this whenever you touch OMT/WHISH money

Three distinct quantities, never conflate them — that conflation is exactly what made
the old gross-reserve bug hard to see:

- **`x`** — the principal (what actually transfers, customer-to-shop or shop-to-customer).
  Lives in the **system-drawer float** (§7) only. Never in `supplier_ledger`.
- **`f`** — the customer-facing fee the provider charges for the transfer. Read from
  `data.omtFee`/`storedWhishFee`; defaults to 0 on RECEIVE if omitted.
- **`c`** — the shop's commission, its cut of `f` (`c ≤ f`; `c` is always 0 for WHISH).
  `f − c` is what the shop actually owes the provider — this is the ONLY thing
  `supplier_ledger` tracks for OMT/WHISH (§8 table, "Amount = fee-only" row).

**The rule, quotable as-is:**

> `Σ(drawer deltas) − Δ(owed to provider) = c + kept_change`

stated per currency for single-currency legs, at the stamped exchange rate where a
split payment is multi-currency. `kept_change` is named explicitly — never folded into
`c` — because it is a customer-facing rounding leftover the shop keeps, not commission
revenue.

Target drawer table (owner-specified, four rows — every SEND/RECEIVE case reduces to
one of these):

| Case                   | Customer/payout leg      | System-drawer leg | Σ (drawer deltas) |
| ---------------------- | ------------------------- | ------------------ | ------------------ |
| SEND, fee on top       | payment drawer(s) `+(x+f)` | `−x`               | `+f`                |
| SEND, fee included     | payment drawer(s) `+x`     | `−(x−f)`            | `+f`                |
| RECEIVE, fee on top    | payment `+f`, payout `−x`  | `+x`                | `+f`                |
| RECEIVE, fee included  | payout `−(x−f)`            | `+x`                | `+f`                |

`f` defaults to 0 on RECEIVE (no fee entered) — both RECEIVE rows then collapse to
"payout `−x`, system `+x`, Σ 0". Guarded end-to-end by `OmtSystemFeeCharacterization.test.ts`
(CASE 1–8b), which asserts this exact invariant after every case via its own
`assertInvariant` helper.

**The settlement identity** — why a periodic fee-only settlement zeroes the ledger
cleanly instead of double-counting the principal (the bug this whole rewrite fixes):

> `TOP_UP(f) − SETTLEMENT(f−c) − SUPPLIER_PAYS_US(c) = 0`

In practice `SUPPLIER_PAYS_US(c)` drops out for OMT/WHISH settlement specifically: the
customer already handed over the full fee `f` in cash at transaction time, so paying the
provider only the net `f − c` naturally leaves `c` sitting in General as realized
commission — there is nothing left to separately fund or credit. `settleTransactions`
pays the outstanding `f − c` through real payment-method legs (never a fixed
`drawer_name`, never `OMT_System`/`Whish_System` — the float already moved at
transaction time, not at settlement) and the ledger nets to exactly 0. Guarded by
`SupplierRepository.settlement.test.ts` ("MIXED SEND+RECEIVE batch: supplier_ledger nets
to EXACTLY 0, OMT_System sees ZERO delta from settlement" — the exact scenario the
original bug report measured driving the ledger to −120.5 and the float to −121 when
both should return to 0) and its reversal, `TransactionRepository.supplierSettlementReversal.test.ts`.

**Cutover, no data migration**: the owner will settle all OMT/Whish balances to **zero**
before this release and re-seed the true float via Initial Drawer Amounts (setup wizard).
Do not write a `supplier_ledger`/system-drawer backfill migration for the sign/model
change — there is nothing to migrate, by the owner's own decision.

**Historical record — `OmtSystemFeeCharacterization.test.ts`**: this file started as a
*diagnostic* (no assertions beyond logging the pre-fix numbers) and was rewritten into a
real guard once the owner confirmed the domain model (2026-07-29). The six pre-fix
numbers it measured, for provider OMT / USD / x=100 / fee=5 (every case's Σ should have
been +5):

| Case                              | Pre-fix General | Pre-fix OMT_System | Pre-fix Σ |
| ---------------------------------- | ---------------- | -------------------- | ---------- |
| RECEIVE fee-on-top, single CASH    | −100              | −105                  | −205       |
| RECEIVE operator typed gross 105   | −105              | −110                  | −215       |
| SEND single CASH                   | 0                 | +105                  | +105       |
| SEND `includingFees: true`         | 0                 | +105                  | +105       |
| RECEIVE split CASH60+wallet40      | −60 (+App −40)    | −105                  | −205       |
| SEND split CASH60+wallet45         | +60 (+App 0)      | +105                  | +165       |

Both RECEIVE rows moved cash **out of both** General and the float for the same
transfer (double-debit); SEND's "cash reserve" branch zeroed General straight back out
after crediting it, and the split case (CASE 6) leaked an unaccounted `+60` because the
reserve was skipped for any non-cash leg while the system credit still ran unconditionally.

---

## 9. Void / refund

- Journal pattern: void writes a same-type reversal row (`reverses_id` set, negated
  amounts); the original's status becomes VOIDED. Net drawer effect across
  create + void = 0. Match originals by `source_id` + `reverses_id IS NULL`.
- Void/refund actions live in the **Transactions table only** (owner decision 2026-07-04).
- `NON_REVERSIBLE_TRANSACTION_TYPES` (LOTO family, RECHARGE_TOPUP, REFUND, the paper
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
  tied to the already-non-reversible RECHARGE_TOPUP type) — the cascade's genericity is
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
8. **Supplier/partner ledger** (§8): correct sign; amount = whatever quantity is actually
   OWED to the counterparty — for a spendable float (OMT/WHISH, §8.1) that's the
   fee-net `f − c`, NOT the principal `x`, which already moved through the drawer;
   prepaid-units model (debt at top-up, not per sale) still applies where there is no
   float; secondary system → partner ledger, never supplier ledger.
9. **Void path** (§9): reversible or gated? If reversible, prove drawer + ledger +
   profit all restore, including any supplier sibling.
10. **Profits** (§10): stamp per-currency profit; refunds must net it to zero.
11. **Sessions** (§11): add a basket branch (defer, formData client, payout rules) or
    document why not.
12. **Audit viewer**: label, visibility (hidden types), cash-only filter behavior.
13. **E2E guard**: delta + identity assertions per CLAUDE.md rule 15; prove the test
    FAILS on the pre-fix code (rule 17). See the
    [e2e suite index](../frontend/tests/e2e-electron/README.md).
14. **One obligation, one owner — never both** (added 2026-07-29, from the OMT/WHISH
    float-model bug): whenever a flow moves money into a provider/counterparty
    container (a system float drawer, a wallet, an escrow), write down in the PR/task
    which ledger owns the obligation (`supplier_ledger`? `partner_ledger`? nothing —
    it's fully realized?) and then confirm it is not ALSO encoded in a drawer balance.
    The OMT/WHISH bug was exactly this: the
    principal `x` was tracked BOTH by the `OMT_System` drawer (gross reserve) AND by
    `supplier_ledger` (gross owed) AND settlement re-debited it a third time — three
    bookings of one number. Write the invariant for your flow (§8.1's
    `Σ(drawer deltas) − Δ(owed) = c + kept_change` is the template) and prove it holds,
    per currency, failing-first (rule 17), before merging.

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
