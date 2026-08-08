# Counterparty Ledgers — Clients / Partners / Suppliers

**Canonical reference for the three counterparty ledgers.** Every fact below
was checked against the current repository source (not against older plan
docs) as of 2026-07-14: `packages/core/src/repositories/DebtRepository.ts`,
`PartnerRepository.ts`, `SupplierRepository.ts`, `SupplierPurchaseRepository.ts`,
`TransactionRepository.ts`, `ProfitRepository.ts`,
`constants/transactionTypes.ts`, and `db/migrations/index.ts` (current head:
v129). Companion docs: [FEATURE_GUIDE.md](./FEATURE_GUIDE.md) §8/§9/§10 (the
money-rules version of this material, kept short), the origin tickets
[COUNTERPARTY_CONSOLIDATION_PLAN.md](./plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md)
(CQ-0…CQ-11) and [PARTNER_FOR_TRANSACTIONS_PLAN.md](./plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md)
(PFT-1…PFT-7b, DBT-1, DBT-2).

> **Update (2026-07-19)** — additive pass: CQ-1 through CQ-11 of the
> consolidation plan landed since this doc's 2026-07-14 baseline. In brief:
> CQ-1 drift guards (a partner-ledger mirror of `moduleDebtTypes.guard.test.ts`
> now exists), CQ-2 (`utils/fifoCoverage.ts::allocateFifo`) and CQ-3
> (`repositories/moneyPosting.ts`'s `applyDrawerDelta`/`insertPaymentRow`) and
> CQ-4 (the same file's charge-routing guards + `bookClientDebtCharge`) — see
> new §9 below for all three files. CQ-7 funneled Supplier's settlement writes
> through `createTransaction`. CQ-8 added the `counterparty` metadata contract
> (`validators/counterparty.ts`, also §9) stamped by every counterparty money
> transaction. CQ-9 landed the REST/web-parity routes for suppliers + debt.
> CQ-10 added discounts/write-offs (`COUNTERPARTY_DISCOUNT` transactions,
> `'Debt Discount'`/`DISCOUNT` ledger types — folded into §2/§3/§4's type
> tables below, plus `moneyPosting.ts::buildCounterpartyDiscountPosting` in
> §9). CQ-11 gave Partner settlements split-leg payments (§3, §9). This pass
> does **not** touch the `DEBT_REPAYMENT` void-gap note in §7 — that's tracked
> and owned separately.

---

## 1. The shared lifecycle model

All three subsystems are the same machine wearing different labels — a
**counterparty ledger**:

```
accrue (a module transaction charges the counterparty)
  → balance (net what they owe us / we owe them, per currency)
    → settle (money physically moves; drawer + audit transaction row)
      → recognize (profit becomes real only when the money is real)
        → reverse (void/refund nets the ledger back to 0 — where an owner exists)
```

|                           | **Clients** (`debt_ledger`)                                                                                                                                                                                                                | **Partners** (`partner_ledger`)                                                                                                                                                                         | **Suppliers** (`supplier_ledger`)                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign / direction          | Signed `amount_usd`/`amount_lbp` columns: **+ = charge (they owe us)**, **− = repayment/credit (we owe them / balance reduced)**. Balance = raw `SUM(amount_usd)`, `SUM(amount_lbp)` — no clamping, can be negative (client is in credit). | Explicit `direction` column (`DEBIT`/`CREDIT`) + one signed `amount` + `currency`. Balance = `SUM(DEBIT) − SUM(CREDIT)`, bucketed by `FOR_%` / `THROUGH_%` / other prefix, per currency (USD/LBP/USDT). | `entry_type` enum (CHECK-constrained) + **two** amount columns (`amount_usd`, `amount_lbp`), sign baked into the row at insert (`PAYMENT` forced negative). Balance = `SUM(amount_usd)`, `SUM(amount_lbp)` (**+ = shop owes supplier**, "You owe", red). |
| Amount columns            | `amount_usd` **and** `amount_lbp` (two currency-specific columns on one row)                                                                                                                                                               | One `amount` + one `currency` per row (USD/LBP/USDT are separate rows)                                                                                                                                  | `amount_usd` **and** `amount_lbp` (same two-column shape as debt_ledger)                                                                                                                                                                                 |
| Accrual types             | `'<Module> Debt'` string convention, whitelisted (`MODULE_DEBT_TRANSACTION_TYPES`) or excluded-with-owner (`moduleDebtTypes.guard.test.ts`)                                                                                                | `FOR_*` (partner owes shop — DEBIT) / `THROUGH_*` (shop owes partner — CREDIT) prefixes, plus legacy plain types and `WHISH_TOPUP`                                                                      | `TOP_UP` / `SALE_COST` / `PAYMENT` / `ADJUSTMENT` / `SETTLEMENT` / `CASH_PRIZE` / `SUPPLIER_PAYS_US` (fixed CHECK enum — **not** free-form, unlike partner_ledger)                                                                                       |
| Coverage (FIFO)           | `covered_usd` / `covered_lbp` (v129) — repayments cover module-debt charge rows after `_markSalesPaidFIFO` absorbs into `sales.paid_usd` first                                                                                             | `covered_amount` (v128) — `SETTLEMENT` (always) or a cash-moved `ADJUSTMENT` (`applyCoverage: true`, PFT-7b) covers opposite-direction `FOR_%` rows                                                     | `supplier_purchases.paid_usd` — a `PAY`-direction cashflow or manual `PAYMENT` FIFO-covers open purchase batches (USD-only; no LBP column)                                                                                                               |
| Settlement money movement | `DebtRepository.addRepayment` (drawer routing to General or the provider system drawer for Service Debt) + manual `CREDIT_CASH_IN`/`DEBT_CASH_OUT`                                                                                         | `PartnerRepository.recordSettlementMoneyMovement` — writes `PARTNER_SETTLEMENT`/`PARTNER_PAYMENT` + a real payment leg (PFT-6b/7b)                                                                      | `SupplierRepository.settleTransactions` (batch settle) / `recordSupplierCashflow` (PAY/RECEIVE)                                                                                                                                                          |
| Recognition gate          | `notDebtPending` (module services) / `saleFullyPaid` (sales, via `sales.paid_usd`, NOT the debt-ledger coverage columns)                                                                                                                   | `notPartnerPending` / `txnNotPartnerPending` / `salePaidOrPartnerSettled`                                                                                                                               | `financial_services.is_settled` (FS commission only — supplier ledger itself isn't profit-gating for anything but FS)                                                                                                                                    |
| Reversal owner            | `TransactionRepository._cancelDebt` over `MODULE_DEBT_TRANSACTION_TYPES` (both currencies, ledger-only — no drawer touched)                                                                                                                | `TransactionRepository._reversePartnerLedger` — type-agnostic, keyed by `reference_table`/`reference_id` (no `transaction_id` FK on this table)                                                         | Generic void/refund (soft-void via `is_refunded`) + `_unapplySupplierPurchaseCoverage` (PAY-direction FIFO unwind only)                                                                                                                                  |

Three storage schemas, one behavior family. `docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md`
(CQ-1…CQ-11) is the plan to consolidate the _behavior_ (shared FIFO allocator,
posting helpers, charge-routing helper) without touching the schemas —
**CQ-1 through CQ-11 have landed** (see the "Update (2026-07-19)" note above
and §9 below for the shared helper layer); the sections below describe what
exists today, including that landed work.

---

## 2. Client ledger — `debt_ledger`

Schema (`electron-app/create_db.sql`): `id, tenant_id, client_id,
transaction_type TEXT, amount_usd, amount_lbp, transaction_id, due_date, note,
created_at, created_by, edited_by, edited_at, is_refunded, refunded_at,
session_id, covered_usd, covered_lbp` — no CHECK on `transaction_type` (free
text; the _only_ enforcement is the jest guard below).

**Sign convention**: charges are stored **positive** (client owes more);
repayments and `CREDIT_DEPOSIT` are stored **negative** (client owes less /
shop owes client). Balance is the raw per-currency `SUM` — a client can hold a
USD credit and an LBP debt simultaneously (FEATURE_GUIDE §5).

### Every `transaction_type` in use

| Type                    | Written by                                                                                                                                                          | Linked via                                      | Reversal owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'Sale Debt'`           | `SalesRepository` (partial-payment shortfall > $0.05, or full CUSTOMER_ACCOUNT)                                                                                     | `transaction_id` → SALE txn                     | `_cancelDebt` (whitelisted) — **but** the profit gate is `saleFullyPaid`/`sales.paid_usd`, not this row's `covered_usd/lbp` (excluded from `notDebtPending` on purpose)                                                                                                                                                                                                                                                                                                                                                            |
| `'Recharge Debt'`       | `RechargeRepository` (CUSTOMER_ACCOUNT leg, MTC/Alfa)                                                                                                               | `transaction_id` → RECHARGE txn                 | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `'Service Debt'`        | `FinancialServiceRepository` (CUSTOMER_ACCOUNT leg — OMT/WHISH, OMT_APP/WHISH_APP, Binance, **and** the iPick/Katsh cost/price flow — one code path, all providers) | `transaction_id` → FINANCIAL_SERVICE txn        | `_cancelDebt` (whitelisted); provider-specific routing on repayment (see below); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `'Custom Service Debt'` | `CustomServiceRepository`                                                                                                                                           | `transaction_id` → CUSTOM_SERVICE txn           | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `'Loto Debt'`           | `LotoTicketRepository`                                                                                                                                              | `transaction_id` → LOTO txn                     | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `'Maintenance Debt'`    | `MaintenanceRepository`                                                                                                                                             | `transaction_id` → MAINTENANCE txn              | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `'Session Debt'`        | `SessionPaymentRepository` (one row per basket)                                                                                                                     | `session_id` (transaction_id is NULL)           | **Excluded** from `_cancelDebt` by design — reversed by the session flow, not the generic path (`moduleDebtTypes.guard.test.ts` `EXCLUDED_DEBT_TYPES`)                                                                                                                                                                                                                                                                                                                                                                             |
| `'Repayment'`           | `DebtRepository.addRepayment`                                                                                                                                       | `transaction_id` → DEBT_REPAYMENT txn           | **D3 (DONE, 2026-07-19)**: `TransactionRepository._restoreRepaymentDebt` — fires when the transaction BEING voided/refunded IS the DEBT_REPAYMENT itself (a different trigger from `_cancelDebt`), inserts a compensating `'Repayment Reversal'` row and unwinds the FIFO coverage the repayment applied (see §7). `'Repayment'` stays deliberately OUT of `MODULE_DEBT_TRANSACTION_TYPES` (negating it via `_cancelDebt` would un-pay a debt via the wrong mechanism — pinned by `debtReversal.test.ts`'s "whitelist guard" case) |
| `'CREDIT_DEPOSIT'`      | `DebtRepository.depositCredit` / manual Add-Credit                                                                                                                  | none (manual entry)                             | Excluded — reversed by the opposite manual entry (`EXCLUDED_DEBT_TYPES`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `'CREDIT_USED'`         | `DebtService.useCredit` / `DebtService.cashOut`                                                                                                                     | none (manual entry)                             | Excluded — `CREDIT_CASH_OUT` (the transaction type wrapping a cash-out) is separately gated `NON_REVERSIBLE_TRANSACTION_TYPES`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `'Manual Debt'`         | Manual Add-Debt (Debts page)                                                                                                                                        | none (manual entry)                             | Excluded — reversed by the opposite manual entry; `DEBT_CASH_OUT` is `NON_REVERSIBLE_TRANSACTION_TYPES`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `'Imported Debt'`       | Excel import (`insertRawEntry`)                                                                                                                                     | none                                            | Excluded — corrected by re-import or manual entry (idempotent re-import, FEATURE_GUIDE §5)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `'Refund Reversal'`     | `TransactionRepository._cancelDebt` itself                                                                                                                          | `transaction_id` → the voided/refunded original | This IS the reversal row (a journal entry); it is also counted **into** the "outstanding Service Debt" computation on repayment routing (see below) so a refunded service debt stops re-routing repayments forever                                                                                                                                                                                                                                                                                                                 |
| `'Debt Discount'`       | `DebtRepository._postDebtDiscount` (CQ-10 — standalone client write-off, or bundled with a repayment; see §9's `buildCounterpartyDiscountPosting`)                  | `transaction_id` → COUNTERPARTY_DISCOUNT txn    | Not a `_cancelDebt` target — `COUNTERPARTY_DISCOUNT` is `NON_REVERSIBLE_TRANSACTION_TYPES` (§7); correction is an opposite manual discount, never a void. FIFO-covers open module-debt rows via `_coverServiceDebtsFIFO` like a real repayment would (a paper-only ADJUSTMENT would leave them stuck deferred forever)                                                                                                                                                                                                             |

Every `'<Module> Debt'` string literal in `packages/core/src` is scanned by
`constants/__tests__/moduleDebtTypes.guard.test.ts` at build time: it must be
either in `MODULE_DEBT_TRANSACTION_TYPES` (generic reversal owns it) or in
that test's `EXCLUDED_DEBT_TYPES` map with a named owner — an unclassified
`'X Debt'` literal fails the suite. `partner_ledger`'s `FOR_*`/`THROUGH_*`
literals get the same treatment now — **CQ-1, landed**:
`constants/__tests__/partnerLedgerTypes.guard.test.ts` (see §3 below) is the
mirror guard.

**Service-Debt repayment routing** (`DebtRepository.addRepayment`): when a
repayment settles a `'Service Debt'`, funds are routed to the originating
provider's system drawer (e.g. a WHISH leg → `Whish_App` → `Whish_System`),
capped at the client's **outstanding** Service Debt per currency
(`SUM('Service Debt') − SUM(already routed)`, over ACTIVE rows, `'Refund
Reversal'` rows netted in) — guarded by
`DebtRepository.serviceDebtRouting.test.ts`.

---

## 3. Partner ledger — `partner_ledger`

Schema (`electron-app/create_db.sql`): `id, tenant_id, partner_id,
transaction_type TEXT NOT NULL, reference_table, reference_id, amount REAL NOT
NULL, currency TEXT DEFAULT 'USD', direction CHECK(DEBIT|CREDIT), notes,
user_id, settlement_method CHECK(CASH|OMT|WHISH|BINANCE|CLIENT_ACCOUNT),
created_at, covered_amount REAL DEFAULT 0`. **No CHECK on `transaction_type`**
— PFT-1 (2026-07-13) deliberately dropped it in favor of free-form, because
the balance logic only ever depended on the `FOR_%`/`THROUGH_%` **prefix
convention in code**, never the DB enum.

**Sign convention**: `direction = 'DEBIT'` means the **partner owes the
shop**; `direction = 'CREDIT'` means the **shop owes the partner**. Balance
per bucket = `SUM(DEBIT) − SUM(CREDIT)`, computed separately for USD, LBP, and
USDT, and separately for the `FOR_%` / `THROUGH_%` / "other" prefix buckets
(`getBalanceBreakdown`). Owner decision (2026-07-14, "validated flow
catalog"): **a partner never actually carries a USDT balance** — Binance
partner debt is tracked in USD even though the drawer moves in USDT; the USDT
bucket (added in PFT-1) is now dead-but-harmless plumbing.

### Every `transaction_type` in use

| Type                                                                                                          | Direction                                                                                                                 | Written by                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reversal owner                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FOR_POS`                                                                                                     | DEBIT (full sale price, no counter cash)                                                                                  | `SalesRepository` (`sale.partnerMode === "FOR"`)                                                                                                                                                                                                                                                                                                                                                                                                | `_reversePartnerLedger` (type-agnostic, keyed by `reference_table='sales'`/`reference_id`)                                                                                                                                                                                                                                                                                     |
| `FOR_RECHARGE`                                                                                                | DEBIT                                                                                                                     | `RechargeRepository`                                                                                                                                                                                                                                                                                                                                                                                                                            | `_reversePartnerLedger`                                                                                                                                                                                                                                                                                                                                                        |
| `FOR_LOTO`                                                                                                    | DEBIT                                                                                                                     | `LotoTicketRepository`                                                                                                                                                                                                                                                                                                                                                                                                                          | `_reversePartnerLedger` — but the LOTO transaction itself is `NON_REVERSIBLE_TRANSACTION_TYPES`, so in practice this row is corrected only via a settlement/adjustment, never a void                                                                                                                                                                                           |
| `FOR_IPICK`, `FOR_KATSH`                                                                                      | DEBIT                                                                                                                     | `FinancialServiceRepository` (cost/price catalog+bill flow)                                                                                                                                                                                                                                                                                                                                                                                     | `_reversePartnerLedger`; defers profit via the partner-pending gate like every other `FOR_%` type (see §6 — no carve-out)                                                                                                                                                                                                                                                      |
| `FOR_OMT_SEND`, `FOR_WHISH_SEND`, `FOR_OMT_APP_SEND`, `FOR_WHISH_APP_SEND`, `FOR_BINANCE_SEND`                | DEBIT                                                                                                                     | `FinancialServiceRepository` (SEND, "For Partner" checkbox)                                                                                                                                                                                                                                                                                                                                                                                     | `_reversePartnerLedger`                                                                                                                                                                                                                                                                                                                                                        |
| `FOR_OMT_RECEIVE`, `FOR_WHISH_RECEIVE`, `FOR_OMT_APP_RECEIVE`, `FOR_WHISH_APP_RECEIVE`, `FOR_BINANCE_RECEIVE` | CREDIT (shop owes partner)                                                                                                | `FinancialServiceRepository` (RECEIVE, "For Partner" checkbox)                                                                                                                                                                                                                                                                                                                                                                                  | `_reversePartnerLedger`                                                                                                                                                                                                                                                                                                                                                        |
| `THROUGH_OMT_SEND` / `THROUGH_WHISH_SEND`                                                                     | CREDIT                                                                                                                    | `FinancialServiceRepository` (`ledgerType = \`THROUGH*${OMT\|WHISH}*${SEND\|RECEIVE}\``, template-composed, not a literal — only OMT/OMT_APP→OMT and WHISH/WHISH_APP→WHISH map)                                                                                                                                                                                                                                                                 | `_reversePartnerLedger`                                                                                                                                                                                                                                                                                                                                                        |
| `THROUGH_OMT_RECEIVE` / `THROUGH_WHISH_RECEIVE`                                                               | DEBIT                                                                                                                     | same as above                                                                                                                                                                                                                                                                                                                                                                                                                                   | `_reversePartnerLedger`                                                                                                                                                                                                                                                                                                                                                        |
| `WHISH_TOPUP`                                                                                                 | CREDIT (shop owes partner for funding the wallet)                                                                         | `RechargeRepository` (Whish App top-up via partner; touches no cash drawer)                                                                                                                                                                                                                                                                                                                                                                     | The wrapping transaction is `RECHARGE_TOPUP`, which is `NON_REVERSIBLE` — this row has no practical void path (matches the "no payments row" rationale for RECHARGE_TOPUP)                                                                                                                                                                                                     |
| `SETTLEMENT`                                                                                                  | Either (computed from the current balance)                                                                                | `PartnerRepository.recordSettlementMoneyMovement` via `addLedgerEntry` (Partners-page settlement — **CQ-11**: an optional `legs` array (`partnerSettleSchema.payments`) lets a settlement split across payment methods, e.g. "$60 CASH + $40 OMT"; each leg writes its own `payments` row + drawer delta, `settlementMethod` still stamps the ledger row for display, omitting `legs` keeps the legacy single-leg path byte-identical — see §9) | **Reversible since LIRA-085 (2026-07-21)**: void/refund posts a compensating opposite-direction ledger row, unwinds the FIFO `covered_amount` stamps newest-first, sweeps any bundled DISCOUNT (ledger + profit negated), and the generic `_reversePayments` restores drawers per leg                                                                                          |
| `ADJUSTMENT`                                                                                                  | Either                                                                                                                    | Manual Add-credit/debt (PFT-7/7b, `applyCoverage` optional)                                                                                                                                                                                                                                                                                                                                                                                     | Same as SETTLEMENT if `applyCoverage`/cash-moved (wrapped in `PARTNER_PAYMENT` — reversible since LIRA-085); a paper (non-cash) `ADJUSTMENT` is wrapped in a `PARTNER_ADJUSTMENT` transaction since LIRA-066 (visible, no legs/drawer, `NON_REVERSIBLE` — correction is the opposite manual entry)                                                                             |
| `DISCOUNT`                                                                                                    | Either (mirrors the settlement's own `entry.direction` — CREDIT → "forgiven"/IN, DEBIT → "received"/OUT; the D1 axis, §9) | `PartnerRepository.recordDiscount` (CQ-10 — bundled with a settlement, or a standalone write-off)                                                                                                                                                                                                                                                                                                                                               | Wrapped in `COUNTERPARTY_DISCOUNT`: a STANDALONE discount stays `NON_REVERSIBLE` (correction = opposite manual discount), but a discount BUNDLED with a settlement is swept by that settlement's LIRA-085 reversal (ledger + profit negated, nets to 0). Runs `applySettlementCoverage` like a real settlement (a paper-only discount would leave `FOR_%` rows stuck deferred) |
| `OMT_SEND`/`OMT_RECEIVE`/`WHISH_SEND`/`WHISH_RECEIVE`/`CUSTOM_SERVICE`                                        | —                                                                                                                         | **Legacy** — declared in `CreateLedgerEntryData`'s type union and in historical migration CHECK constraints; no current repository writes them. Superseded by the `FOR_*`/`THROUGH_*` system.                                                                                                                                                                                                                                                   | n/a (dead code path, kept for backward-compat reads of old rows)                                                                                                                                                                                                                                                                                                               |

`FOR_%`/`THROUGH_%` rows **never act as coverage sources** — only `SETTLEMENT`
(always) or a `applyCoverage: true` `ADJUSTMENT` (PFT-7b, "cash moved"
checkbox) run `applySettlementCoverage`. This is deliberate: a void's negating
`FOR_%` row (opposite direction, same type) must never look like a real
settlement of its own original.

**`FOR_*`/`THROUGH_*` literal guard — CQ-1, landed.** Mirroring `debt_ledger`'s
`moduleDebtTypes.guard.test.ts`,
`constants/__tests__/partnerLedgerTypes.guard.test.ts` scans core source for
every `"FOR_..."`/`"THROUGH_..."` string literal and fails the suite unless it
is a member of `CreateLedgerEntryData["transaction_type"]` (or the test's own
`UNUSED_ALLOWLIST`, for a declared-but-not-yet-used union member) — the same
drift class `moduleDebtTypes.guard.test.ts` already caught for `debt_ledger`.
Adding a new `FOR_*`/`THROUGH_*` type is still a compile-time union edit
(`PartnerRepository.ts`) plus this guard catching an unclassified literal; the
reversal path stays automatic (type-agnostic `_reversePartnerLedger`), but the
profit-recognition decision (immediate like iPick/Katsh, or gated like
everything else) is still a manual edit to
`notPartnerPending`/`txnNotPartnerPending`'s exclusion list — the guard
enforces the TYPE is classified, not that the profit gate was wired, so that
part is still easy to forget.

---

## 4. Supplier ledger — `supplier_ledger` (+ `supplier_purchases`)

Schema (`electron-app/create_db.sql`): `id, tenant_id, supplier_id, entry_type
TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT',
'ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US','DISCOUNT')), amount_usd,
amount_lbp, note, created_by, transaction_id, is_auto, is_refunded,
refunded_at, created_at`. This is the **only** one of the three ledgers that
still has a live CHECK constraint on its type column — v131 (CQ-10) widened it
to add `'DISCOUNT'` (a supplier forgiving part of what the shop owes); SQLite
can't `ALTER` a CHECK, so the migration is a full table rebuild preserving
every row (same 12-step pattern as v83/v98/v99/v127).

**Sign convention**: **+ = shop owes supplier** ("You owe", red); **− = we've
paid / they owe us less**. `addLedgerEntry` force-normalizes `PAYMENT` rows to
negative regardless of what the caller passed in.

### Every `entry_type` in use

| Type               | Written by                                                                                                                                                                                                                                                                                                                                                          | Reversal owner                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOP_UP`           | **Automatic**: `RechargeRepository` (prepaid-units top-up — raw INSERT, no `transaction_id` link back), `FinancialServiceRepository` (cost/price provider top-up, via `addLedgerEntry`), `LotoTicketRepository` (ticket-sale float draw). **Manual**: Suppliers page → `supplierHandlers.ts` / `backend/src/api/suppliers.ts` → `SupplierRepository.addLedgerEntry` | The `RechargeRepository` automatic path rides on `RECHARGE_TOPUP` (`NON_REVERSIBLE`) — no practical reversal. The `FinancialServiceRepository`/manual paths get a `SUPPLIER_PAYMENT`-type transaction (reversible generically: soft-void via `is_refunded`; no drawer moved at TOP_UP time so nothing to unwind)                                                                                                             |
| `SALE_COST`        | Manual only (Suppliers page `addLedgerEntry`) — documented in code as "cost/price-flow SEND", but no automatic repository call site was found; declared for reconciling a sale cost distinctly from a manual top-up                                                                                                                                                 | Generic (soft-void via `is_refunded`, `SUPPLIER_PAYMENT` transaction type)                                                                                                                                                                                                                                                                                                                                                   |
| `PAYMENT`          | `SupplierRepository.addLedgerEntry` (drawer-based, legacy) and `recordSupplierCashflow` (`direction: "PAY"`, real payment-method legs)                                                                                                                                                                                                                              | Generic void/refund: `_markSourceRefunded` soft-voids the row, `_reversePayments` reverses the drawer leg, **and** `_unapplySupplierPurchaseCoverage` gives back the FIFO purchase coverage the payment consumed (newest-covered-first, capped per purchase) — this is the one ledger with a full 3-part reversal ("Void restores everything", FEATURE_GUIDE §8)                                                             |
| `SUPPLIER_PAYS_US` | `recordSupplierCashflow` (`direction: "RECEIVE"`) and a cashless-credit path in `FinancialServiceRepository` (fixed commission on an iPick/Katsh bill — no drawer moves)                                                                                                                                                                                            | Generic (soft-void + drawer reversal); `_unapplySupplierPurchaseCoverage` is a no-op here (`entry_type !== "PAYMENT"` guard) — correct, since RECEIVE never applied purchase coverage in the first place                                                                                                                                                                                                                     |
| `ADJUSTMENT`       | Manual only (Suppliers page — opening balances, and the LIRA-080 "Add Credit / Debt" action). Two variants split by the "Cash moved" toggle: **cash-moved** posts through `recordSupplierCashflow` (→ `SUPPLIER_PAYMENT`, real drawer legs); **paper** posts through `addLedgerEntry`'s no-drawer branch (→ `SUPPLIER_ADJUSTMENT`, no payments row / no drawer)     | **Split by variant.** Cash-moved (`SUPPLIER_PAYMENT`): generic (soft-void via `is_refunded` + drawer reversal). Paper (`SUPPLIER_ADJUSTMENT`, LIRA-080): **`NON_REVERSIBLE`** — no payments row / drawer to reverse and no generic supplier_ledger reversal owner for a bare ADJUSTMENT; rule-20 owner is an opposite manual Add Credit/Debt entry on the Suppliers page (mirrors `PARTNER_ADJUSTMENT`/`ACCOUNT_ADJUSTMENT`) |
| `SETTLEMENT`       | `SupplierRepository.settleTransactions` (batch-settle pending `financial_services` rows)                                                                                                                                                                                                                                                                            | The wrapping transaction is `SUPPLIER_SETTLEMENT`, which is **`NON_REVERSIBLE`** — the `financial_services.settlement_id`/`is_settled` stamps stay in place, and the commission credit to General has no payments row to reverse                                                                                                                                                                                             |
| `CASH_PRIZE`       | `LotoCashPrizeRepository`                                                                                                                                                                                                                                                                                                                                           | The wrapping transaction is `LOTO_CASH_PRIZE`, **`NON_REVERSIBLE`** (loto family; settle-to-zero reconciliation would break)                                                                                                                                                                                                                                                                                                 |
| `DISCOUNT`         | `SupplierRepository._postSupplierDiscount` (CQ-10 — bundled with a PAY-direction cashflow, or a standalone write-off; RECEIVE-direction rejects a bundled discount at the data layer — a supplier can't simultaneously pay the shop and forgive what the shop owes them, see §9)                                                                                    | The wrapping transaction is `COUNTERPARTY_DISCOUNT`, **`NON_REVERSIBLE`**; correction is an opposite manual discount. Runs the same FIFO purchase-coverage pass a real `PAY` cashflow does (`allocateFifo`, §9) so open `supplier_purchases` rows don't stay stuck deferred                                                                                                                                                  |

**Coverage — `supplier_purchases`** (delivery batches, USD-only:
`total_usd`, `paid_usd`; no LBP column): a `PAY`-direction cashflow or a
manual `PAYMENT` converts any LBP legs to USD at the transaction's exchange
rate and FIFO-covers the oldest open purchases
(`SupplierPurchaseRepository.applyFifoPayment` / the inline duplicate in
`SupplierRepository.recordSupplierCashflow` — this is exactly the kind of
duplicated FIFO math CQ-2 in the consolidation plan targets). Status is
derived, not stored: `paid_usd >= total_usd − 0.005` → `PAID`; `> 0.005` →
`PARTIAL`; else `UNPAID`.

---

## 5. Coverage semantics — the three FIFO mechanisms

|                       | Column(s)                                                                                                    | Applied by                                                                                                                                                                                                      | Trigger                                                                                                                        | Epsilon                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Partner**           | `partner_ledger.covered_amount` (v128)                                                                       | `PartnerRepository.applySettlementCoverage`                                                                                                                                                                     | A `SETTLEMENT` row (always) or a cash-moved `ADJUSTMENT` (`applyCoverage: true`, PFT-7b) — **never** a `FOR_%`/`THROUGH_%` row | `0.005` (single currency amount column; stop condition `remaining <= 0.005`, source-row filter `covered_amount < amount - 0.005`)                    |
| **Debt**              | `debt_ledger.covered_usd` / `covered_lbp` (v129)                                                             | `DebtRepository._coverServiceDebtsFIFO`, called from `addRepayment` **after** `_markSalesPaidFIFO` has taken its share of the same repayment budget (sales absorb first; the remainder covers module-debt rows) | Any repayment                                                                                                                  | `0.005` USD, `1` LBP (two independent thresholds — a repayment can fully cover the USD side of a row while leaving the LBP side open, or vice versa) |
| **Supplier purchase** | `supplier_purchases.paid_usd` (no covered column — `paid_usd`/`total_usd` themselves are the running totals) | `SupplierPurchaseRepository.applyFifoPayment` / inline duplicate in `SupplierRepository.recordSupplierCashflow` (PAY direction only)                                                                            | A `PAY`-direction cashflow or manual `PAYMENT` (LBP legs converted to USD at the payment's exchange rate, default 89 000)      | `0.005` USD (USD-only ledger; no LBP epsilon needed)                                                                                                 |

All three are **oldest-first FIFO**, walk their open rows in a single pass,
and clamp `take = min(remaining, row's outstanding)` — the same shape
repeated three times. **CQ-2, landed**: `utils/fifoCoverage.ts::allocateFifo(open,
budget, epsilon)` extracts exactly this — pure math, no DB access. Each call
site above keeps its own SQL for selecting open rows and applying the UPDATE
(rule 13 — consolidate behavior, not storage) and passes its own pre-existing
epsilon from the table above, so no site's tolerance changed. See §9.

Reversal of coverage exists in **one** direction: `_unapplySupplierPurchaseCoverage`
un-applies purchase coverage on a voided/refunded supplier `PAYMENT`
(newest-covered-first). **Partner and debt coverage have no unwind path** —
voiding an already-covered `FOR_%`/module-debt row does not roll back the
`covered_amount`/`covered_usd`/`covered_lbp` stamps (documented v1 behavior:
the void's profit negation still nets the P&L to the correct total, so the
coverage stamp being "stale" doesn't misstate money — it just means a
re-inspection of that specific row's coverage state post-void is not
meaningful).

---

## 6. Profit recognition

Every gate below is a **named SQL fragment defined once** in
`ProfitRepository.ts` (rule 14) and reused verbatim across every query that
needs it — never copy-pasted.

| Fragment                              | Gates                                                                                                                                          | Meaning                                                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saleFullyPaid(alias)`                | Sales revenue/cost/profit (`getSalesRevCost`, `getSalesProfit`) via `salePaidOrPartnerSettled`                                                 | `paid_usd + paid_lbp / exchange_rate_snapshot >= final_amount_usd − 0.05`                                                                                                                                                                                   |
| `salePaidOrPartnerSettled(alias)`     | All SALE-sourced profit queries                                                                                                                | `saleFullyPaid` **OR** (the sale has a `FOR_%` partner row **AND** `notPartnerPending` says it's fully settled) — a for-partner sale carries `paid_usd = 0` (no counter cash), so without this OR-arm it would never realize                                |
| `notPartnerPending(refTable, idExpr)` | FS (`getFinancialSettledByCurrency`, `getRealizedCommissionTotals` — LIRA-108), recharge, loto — module-level queries keyed by the source row  | `NOT EXISTS` an uncovered `FOR_%` row for this source — **all providers, no carve-out** (iPick/Katsh defer like the rest)                                                                                                                                   |
| `txnNotPartnerPending(alias)`         | `getByUser`, `getByClient`, `getDeferredProfit`                                                                                                | Same as `notPartnerPending` but keyed by the **transaction's own** `source_table`/`source_id` (these views iterate unified transactions, not module rows)                                                                                                   |
| `notDebtPending(txnIdExpr)`           | FS (all providers, including iPick/Katsh; incl. `getRealizedCommissionTotals` — LIRA-108), recharge, custom service, loto, maintenance, `getByUser`/`getByClient` | `NOT EXISTS` an uncovered `'Recharge Debt'`/`'Service Debt'`/`'Custom Service Debt'`/`'Loto Debt'`/`'Maintenance Debt'` row for this transaction. **`'Sale Debt'` is deliberately excluded** — sales recognize via `saleFullyPaid`/`sales.paid_usd` instead |
| `fs.is_settled`                       | FS commission (`getFinancialSettledByCurrency` / `getFinancialPendingByCurrency`, `getRealizedCommissionTotals`, `getPendingCommissionTotals`) | The OMT/WHISH-style commission is realized only once the supplier settlement batch (`SupplierRepository.settleTransactions`) stamps `is_settled = 1`                                                                                                        |

**iPick/Katsh — one rule, no carve-out (former exception removed 2026-07-14):**

Both profit gates now treat iPick/Katsh exactly like every other provider:
profit defers until the money comes in.

- **Partner-pending** (`notPartnerPending`/`txnNotPartnerPending`): every
  `FOR_%` type — `FOR_IPICK`/`FOR_KATSH` included — stays in the uncovered-row
  scan. A for-partner iPick/Katsh margin is realized only when the partner
  settles, same as `FOR_POS`/`FOR_RECHARGE`/etc. (The earlier explicit
  `NOT IN ('FOR_IPICK','FOR_KATSH')` carve-out was deleted; owner decision — one
  rule, "profit shows in the report when the money comes in.")
- **Debt-pending** (`notDebtPending`): unchanged — never had a provider
  carve-out. The fragment matches on `debt_ledger.transaction_type`, so a
  CUSTOMER_ACCOUNT-charged iPick/Katsh bill defers until the client repays,
  exactly like every other module.

Both gates are now symmetric: an unpaid receivable is unpaid regardless of
provider, whether the counterparty is a partner or a client account. The
PFT-6/DBT-1 plan-doc language that once described an "immediate" iPick/Katsh
partner exception is superseded by this — there is no exception anywhere.

**Documented v1 gaps** (profit views that do **not** apply the partner/debt
gates, as of this writing):

- `getPaymentMethodRows` (Profits → by-payment-method view, the per-method
  payment rows) — no `notPartnerPending`/`notDebtPending` gate at all; a
  for-partner or account-charged transaction's payment-method total is not
  deferred. The same view's **"Commission (Settled)" row is no longer part
  of this gap** — `getRealizedCommissionTotals` gained both gates (+ the
  ACTIVE-transaction join) under LIRA-108, 2026-08-08; its pending sibling
  `getPendingCommissionTotals` deliberately stays ungated (pre-recognition
  bucket keyed on `is_settled = 0`, mirroring
  `getFinancialPendingByCurrency` — a settled but partner-/debt-pending
  commission appears in neither row and surfaces in `getDeferredProfit`).
- `getByUser` and `getByClient` (by-employee / top-clients) **are** gated
  (`txnNotPartnerPending` + `notDebtPending`, added in DBT-2, 2026-07-14) —
  this was a genuine gap until that date; it is closed now. Don't assume any
  older doc calling these "ungated" is still current.

**Visibility of stranded profit**: `getDeferredProfit` re-runs the exact
negation of `txnNotPartnerPending`/`notDebtPending` over the same
`PROFIT_TXN_TYPES` window, so a transaction's profit is always in exactly one
bucket — realized (summary/by-user/by-client) or deferred (this query) —
never both, never neither. `getPendingSaleProfit` gives the sales-specific
view of the same idea (outstanding sale-level detail, not just a total).

---

## 7. Reversal symmetry — what nets to 0 today, and what doesn't

**Covered paths (create + reverse nets to 0, per currency):**

- Module-charge debt (`'Sale Debt'`, `'Recharge Debt'`, `'Service Debt'`,
  `'Custom Service Debt'`, `'Loto Debt'`, `'Maintenance Debt'`) via
  `TransactionRepository._cancelDebt` — ledger-only, both currencies, no
  drawer touched (the original charge took no cash).
- Partner ledger `FOR_*`/`THROUGH_*` rows tied to a **reversible** transaction,
  via `_reversePartnerLedger` — type-agnostic, same `transaction_type`,
  opposite `direction`, so the specific `FOR_%`/`THROUGH_%` bucket nets to 0,
  not just the partner's grand total. (This also retroactively fixed a
  pre-existing gap: before PFT-2, void/refund never touched `partner_ledger`
  at all.)
- Supplier `PAYMENT` rows via the generic reversal + `_unapplySupplierPurchaseCoverage`
  (drawer + ledger + FIFO purchase coverage all restored).
- **D3 (DONE, 2026-07-19)**: `DEBT_REPAYMENT` void/refund via
  `TransactionRepository._restoreRepaymentDebt` — the generic `_reversePayments`
  already restored the cash; this step restores the LEDGER side too: inserts a
  compensating `'Repayment Reversal'` row (drives `debt_ledger` back to its
  pre-repayment total, both currencies) AND unwinds the FIFO coverage the
  repayment applied (`sales.paid_usd` via `_unwindSalesPaidFifo`,
  `debt_ledger.covered_usd/lbp` via `_unwindServiceDebtCoverageFifo` — exact
  mirrors of `_markSalesPaidFIFO`/`_coverServiceDebtsFIFO`, run newest-first
  instead of oldest-first, INCLUDING the `s.status = 'completed'` filter on
  the sales join — a sale that's since been voided/refunded carries a SECOND
  `transactions` row at the same `source_id`, and dropping that filter
  double-matches the sale and double-subtracts its `paid_usd`; caught by a
  dedicated regression test before this landed). **Approximation** (same shape as the supplier
  unwind above): nothing records which specific sale/charge rows a given
  repayment's coverage landed on, so the give-back budget is re-derived from
  the `'Repayment'` row's own absolute amounts and applied newest-covered-first
  capped at each row's current coverage — exact when reversed in LIFO order
  (the common case), imprecise under interleaved repayments on the same
  client (same accepted imprecision as the supplier analog). **Boundary**: a
  bundled CQ-10 `'Debt Discount'`/`COUNTERPARTY_DISCOUNT` transaction is a
  SEPARATE transaction_id and is never touched by this step — it stays
  `NON_REVERSIBLE` by design; only the cash repayment's own share of any
  shared coverage unwinds. See `TransactionRepository.repaymentReversal.test.ts`.
- `PARTNER_SETTLEMENT`/`PARTNER_PAYMENT` are flatly non-reversible — their
  FIFO `covered_amount` stamps have no unwind mechanism; correction is an
  opposite manual settlement/adjustment, never a void.
- `COUNTERPARTY_DISCOUNT` rows (CQ-10 — all three ledgers' `'Debt
Discount'`/`DISCOUNT` entries, §2/§3/§4) are **by design** non-reversible
  (`NON_REVERSIBLE_TRANSACTION_TYPES`), the same posture as the settlement
  rows just above — not a gap, a decision: their FIFO coverage pass has no
  generic unwind, so correction is an opposite manual discount, never a void.
- Aging/overdue debt views are charge-only and keep showing a charge as
  outstanding until its `due_date` passes, even after it's been
  voided/refunded.

---

## 8. Rules of thumb

1. **Profit is real when money is real.** A stamped `profit_usd`/`profit_lbp`
   on a transaction is not automatically "realized" — every profit query
   re-checks the counterparty gate (`saleFullyPaid`/`salePaidOrPartnerSettled`,
   `notPartnerPending`, `notDebtPending`, `fs.is_settled`) before counting it.
   Stamping happens once, at creation; recognition can happen much later, or
   (until settled/repaid) sits visibly in `getDeferredProfit`/`getPendingSaleProfit`
   instead of vanishing.
2. **Charge routing is mutually exclusive and counterparty-gated.** A
   transaction charges the client's `debt_ledger` **or** a selected partner's
   `partner_ledger` — never both (`SalesRepository` throws explicitly if a
   FOR-partner sale also carries a `CUSTOMER_ACCOUNT` leg). Routing to a
   partner requires an actual selected partner (`partnerId`), the same way
   `CUSTOMER_ACCOUNT` requires `canChargeToCustomerAccount` (name + phone).
3. **Every new `FOR_*`/`THROUGH_*` or `'<Module> Debt'` type needs three
   things decided at the same time it's introduced:**
   - **Union / whitelist**: add the debt-ledger type to
     `MODULE_DEBT_TRANSACTION_TYPES` (or `EXCLUDED_DEBT_TYPES` with a named
     owner) — `moduleDebtTypes.guard.test.ts` enforces this at build time
     **today**. For a new partner `FOR_*`/`THROUGH_*` type, add it to the
     `CreateLedgerEntryData` union — `partnerLedgerTypes.guard.test.ts` (CQ-1,
     landed, §3) now enforces at build time that the literal is a member of
     that union, mirroring the debt-ledger guard.
   - **Reversal owner**: debt types get `_cancelDebt` for free once
     whitelisted; partner types get `_reversePartnerLedger` for free
     (type-agnostic) **as long as the wrapping transaction type is not** in
     `NON_REVERSIBLE_TRANSACTION_TYPES` — if it is, the reversal owner is "an
     opposite manual entry," not a void, and that must be stated explicitly.
   - **Profit gate**: decide immediate vs. deferred, and if deferred, confirm
     the new type is actually inside `notPartnerPending`/`notDebtPending`'s
     scan (partner: `LIKE 'FOR\_%'`, excluding `FOR_IPICK`/`FOR_KATSH`; debt:
     the fixed 5-type `IN (...)` list). A type that's silently outside both
     scans recognizes its profit immediately by accident, not by decision.

---

## 9. Shared helper layer (CQ-2 / CQ-3 / CQ-4 / CQ-5 / CQ-8 / CQ-11 — landed)

The consolidation plan's CQ-2 through CQ-5 extracted the genuinely shared
_behavior_ referenced throughout this doc into three files. Repositories keep
owning their SQL (rule 13) — these are called BY repos, never reach around
them.

**`utils/fifoCoverage.ts`** — `allocateFifo(open: {id, outstanding}[], budget,
epsilon = 0.005): {id, take}[]`. Pure math, no DB access, no imports. Walks
`open` oldest-first (the caller orders it), clamps each take at the row's
outstanding balance, stops once the remaining budget drops to `epsilon` or
below, and skips (without consuming budget) any row whose take would be at or
below `epsilon` — that also covers rows with zero/negative outstanding. Backs
all three FIFO mechanisms in §5 (§5's table lists which call site uses which
epsilon — each kept its own pre-existing tolerance, nothing changed
underneath any of them).

**`repositories/moneyPosting.ts`** — the shared posting primitives:

- `applyDrawerDelta(db, {drawerName, currencyCode, delta, tenantId})` — the
  ONE `drawer_balances` upsert (`INSERT … ON CONFLICT(tenant_id, drawer_name,
currency_code) DO UPDATE SET balance = balance + excluded.balance`),
  replacing 35 hand-rolled copies. Always create-on-first-write (net balance =
  `delta` if the row doesn't exist yet). A handful of sites that must NOT
  silently create a missing drawer (CustomServiceRepository's refund
  reversal, RechargeRepository's provider-transfer source-drawer debit,
  DrawerTopUpRepository's transfer-out leg) were surveyed for CQ-3 and
  deliberately left on their own plain `UPDATE`.
- `insertPaymentRow(db, {transactionId?, sessionId?, method, drawerName,
currencyCode, amount, note?, createdBy?, tenantId, createdAt?})` — the ONE
  `payments` row INSERT, replacing ~19 hand-rolled prepared statements. A row
  belongs to EITHER a transaction OR a session, never both.
- `reconcileLegs({inLegs, outLegs?, keptChange?, expectedTotals, exchangeRate,
context})` — the payment-legs hard-reject check (Payment-Legs Integrity
  plan, owner decision S2, seeded into this file one wave before CQ-3):
  `sum(IN legs) − sum(OUT legs) − kept_change === expectedTotals`, evaluated
  at the transaction's stamped exchange rate (or the till's own conversion
  rate when it legitimately differs), epsilon $0.05 USD-equivalent. Throws
  BEFORE any row is written, provided the caller invokes it inside the same
  `db.transaction(...)` the flow runs in — the throw then unwinds everything
  written so far. No-ops on an empty/undefined `inLegs` (legacy/scripted
  callers with no structured legs at all never reach this check).
- `bookClientDebtCharge(db, {clientId, transactionType, amountUsd?, amountLbp?,
transactionId, note?, createdBy?, tenantId})` — the ONE `debt_ledger` charge
  INSERT (CQ-4), collapsing 12 hand-rolled call sites across
  SalesRepository/RechargeRepository/FinancialServiceRepository/
  MaintenanceRepository/CustomServiceRepository/LotoTicketRepository. Bakes in
  the `due_date = datetime('now', '+30 days')` every site already used
  identically. `transactionType` must stay a literal string AT THE CALL SITE
  (not inside this helper) — `moduleDebtTypes.guard.test.ts` scans quoted
  `'<Module> Debt'` literals anywhere in core source, function-argument
  position included.
- `assertPartnerIdRequired` / `assertNoCounterPayment` /
  `assertNoCustomerAccountLeg` (CQ-4) — the three FOR-partner charge-routing
  guards (counterparty required; no counter cash from a walk-in customer,
  PFT-R; no CUSTOMER_ACCOUNT leg alongside a partner route) factored out of
  Sales/Recharge/Loto/FinancialService's near-duplicate copies (6 copies
  across 4 repos for the counter-payment guard alone). Error wording is
  reproduced byte-identical per call site (several e2e specs assert
  substrings of it) — there is deliberately no `bookPartnerCharge` companion
  wrapping `PartnerRepository.addLedgerEntry` here: that would require
  importing `PartnerRepository`, which already imports THIS file, a cycle for
  zero duplication removed (every `addLedgerEntry` call's parameters are
  irreducibly bespoke per provider/flow, not a repeated shape).
- `buildCounterpartyDiscountPosting({kind, ledgerEntryId, counterpartyId,
counterpartyName, amountUsd, amountLbp, discountDirection, reason?,
extraMetadata?})` (CQ-5/CQ-10) — the signed-profit + `counterparty`
  metadata shape shared by `DebtRepository._postDebtDiscount`,
  `SupplierRepository._postSupplierDiscount`, and
  `PartnerRepository.recordDiscount`. The **D1 sign/flow axis**
  (`discountDirection: "forgiven" | "received"`): "forgiven" = the shop
  forgives a receivable (a real cost, profit negative, flow IN) — always
  Debt's case; "received" = a counterparty forgives a payable (a real gain,
  profit positive, flow OUT) — always Supplier's case; Partner's direction
  depends on `entry.direction` (CREDIT, partner owed the shop → "forgiven";
  DEBIT, shop owed the partner → "received"). Does NOT call `createTransaction`
  itself — importing `TransactionRepository` here would cycle back through
  this same file (it already imports `applyDrawerDelta`/`insertPaymentRow`
  from it) — so the caller still owns the transaction write, its own
  ledger-row INSERT (`'Debt Discount'`/`'DISCOUNT'` stay literal at the call
  site for the guard tests), the `transaction_id` link, and its own FIFO
  coverage pass.

**`validators/counterparty.ts`** — the counterparty transaction metadata
contract (CQ-8). Every counterparty money transaction — client
repayment/credit cash-in-out, supplier payment/settlement, partner
settlement/payment — stamps ONE additional, namespaced `counterparty` object
into `transactions.metadata_json`, additive to whatever flow-specific keys the
site already wrote (`paid_by`, `legs`, `supplier_id`, `direction`,
`entry_type`, `partner_id`, `settlement_method`, `is_credit` — all untouched):

```
metadata_json.counterparty = {
  kind: 'client' | 'supplier' | 'partner',
  id: number,
  name: string,
  flow: 'IN' | 'OUT',        // money into the shop vs out of the shop
  method: string,             // payment/settlement method actually used, or
                               // 'LEDGER' for a journal-only row with no
                               // payments leg (e.g. a supplier TOP_UP accrual)
  ledger_entry_id: number | null,
  discount?: { amount_usd, amount_lbp, reason? },  // CQ-10
}
```

Built by `buildCounterpartyMetadata(input)` so every write site produces the
identical key shape (camelCase `ledgerEntryId` in, snake_case
`ledger_entry_id` out — the mapping can't drift between call sites).
`counterpartyMetadataSchema` validates the STORED shape (loose `z.number()`
amounts — it's built server-side from already-normalized values);
`counterpartyDiscountInputSchema` is the stricter INPUT-validation sibling
(nonnegative amounts, at least one currency > 0) reused by
`debt.ts`/`supplier.ts`/`partner.ts`'s write-off and bundled-discount schemas
(rule 14 — defined once, never copy-pasted per subsystem).

**CQ-11 — Partner split-leg settlement.** `partnerSettleSchema.payments`
(optional; each leg's `amount` is `z.number().positive()`) lets a
Partners-page settlement split across payment methods — e.g. "$100 owed,
settle as $60 CASH + $40 OMT" — the same shape Accounts/Suppliers'
`MultiPaymentInput` already sends. `PartnerRepository.recordSettlementMoneyMovement`'s
optional `legs` param, when present, writes ONE `payments` row + one drawer
delta PER leg (superseding the single legacy leg); `settlementMethod` is still
required and still stamped on the `partner_ledger` row itself for display;
omitting `legs` entirely keeps the legacy single-leg path byte-identical.
Schema-level guards on `partnerSettleSchema`: every leg's `currency_code` must
match the settlement's top-level `currency` (`partner_ledger` is
one-currency-per-row — no cross-currency split inside one settle call), legs
must sum to the settlement `amount` within a 0.005 tolerance, and
`CLIENT_ACCOUNT` may never appear as a split leg (it settles no money, so it
can only be the sole `settlementMethod`, never mixed into `payments`).
