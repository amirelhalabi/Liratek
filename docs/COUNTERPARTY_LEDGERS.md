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
(CQ-0…CQ-6) and [PARTNER_FOR_TRANSACTIONS_PLAN.md](./plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md)
(PFT-1…PFT-7b, DBT-1, DBT-2).

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
(CQ-1…CQ-6) is the plan to consolidate the _behavior_ (shared FIFO allocator,
posting helpers, charge-routing helper) without touching the schemas — **not
yet built** as of this writing; the sections below describe what exists today.

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

| Type                    | Written by                                                                                                                                                          | Linked via                                      | Reversal owner                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'Sale Debt'`           | `SalesRepository` (partial-payment shortfall > $0.05, or full CUSTOMER_ACCOUNT)                                                                                     | `transaction_id` → SALE txn                     | `_cancelDebt` (whitelisted) — **but** the profit gate is `saleFullyPaid`/`sales.paid_usd`, not this row's `covered_usd/lbp` (excluded from `notDebtPending` on purpose)                                                                                                                                                      |
| `'Recharge Debt'`       | `RechargeRepository` (CUSTOMER_ACCOUNT leg, MTC/Alfa)                                                                                                               | `transaction_id` → RECHARGE txn                 | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                |
| `'Service Debt'`        | `FinancialServiceRepository` (CUSTOMER_ACCOUNT leg — OMT/WHISH, OMT_APP/WHISH_APP, Binance, **and** the iPick/Katsh cost/price flow — one code path, all providers) | `transaction_id` → FINANCIAL_SERVICE txn        | `_cancelDebt` (whitelisted); provider-specific routing on repayment (see below); profit gated by `notDebtPending`                                                                                                                                                                                                            |
| `'Custom Service Debt'` | `CustomServiceRepository`                                                                                                                                           | `transaction_id` → CUSTOM_SERVICE txn           | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                |
| `'Loto Debt'`           | `LotoTicketRepository`                                                                                                                                              | `transaction_id` → LOTO txn                     | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                |
| `'Maintenance Debt'`    | `MaintenanceRepository`                                                                                                                                             | `transaction_id` → MAINTENANCE txn              | `_cancelDebt` (whitelisted); profit gated by `notDebtPending`                                                                                                                                                                                                                                                                |
| `'Session Debt'`        | `SessionPaymentRepository` (one row per basket)                                                                                                                     | `session_id` (transaction_id is NULL)           | **Excluded** from `_cancelDebt` by design — reversed by the session flow, not the generic path (`moduleDebtTypes.guard.test.ts` `EXCLUDED_DEBT_TYPES`)                                                                                                                                                                       |
| `'Repayment'`           | `DebtRepository.addRepayment`                                                                                                                                       | `transaction_id` → DEBT_REPAYMENT txn           | **Known gap** (FEATURE_GUIDE §9): voiding/refunding a DEBT_REPAYMENT reverses the cash (`_reversePayments`) but does **not** touch this ledger row — a rule-20 violation, not yet fixed. `'Repayment'` is deliberately kept OUT of `MODULE_DEBT_TRANSACTION_TYPES` (negating it would un-pay a debt via the wrong mechanism) |
| `'CREDIT_DEPOSIT'`      | `DebtRepository.depositCredit` / manual Add-Credit                                                                                                                  | none (manual entry)                             | Excluded — reversed by the opposite manual entry (`EXCLUDED_DEBT_TYPES`)                                                                                                                                                                                                                                                     |
| `'CREDIT_USED'`         | `DebtService.useCredit` / `DebtService.cashOut`                                                                                                                     | none (manual entry)                             | Excluded — `CREDIT_CASH_OUT` (the transaction type wrapping a cash-out) is separately gated `NON_REVERSIBLE_TRANSACTION_TYPES`                                                                                                                                                                                               |
| `'Manual Debt'`         | Manual Add-Debt (Debts page)                                                                                                                                        | none (manual entry)                             | Excluded — reversed by the opposite manual entry; `DEBT_CASH_OUT` is `NON_REVERSIBLE_TRANSACTION_TYPES`                                                                                                                                                                                                                      |
| `'Imported Debt'`       | Excel import (`insertRawEntry`)                                                                                                                                     | none                                            | Excluded — corrected by re-import or manual entry (idempotent re-import, FEATURE_GUIDE §5)                                                                                                                                                                                                                                   |
| `'Refund Reversal'`     | `TransactionRepository._cancelDebt` itself                                                                                                                          | `transaction_id` → the voided/refunded original | This IS the reversal row (a journal entry); it is also counted **into** the "outstanding Service Debt" computation on repayment routing (see below) so a refunded service debt stops re-routing repayments forever                                                                                                           |

Every `'<Module> Debt'` string literal in `packages/core/src` is scanned by
`constants/__tests__/moduleDebtTypes.guard.test.ts` at build time: it must be
either in `MODULE_DEBT_TRANSACTION_TYPES` (generic reversal owns it) or in
that test's `EXCLUDED_DEBT_TYPES` map with a named owner — an unclassified
`'X Debt'` literal fails the suite. There is **no equivalent guard yet** for
`partner_ledger`'s `FOR_*` literals (see §7 below); that guard is
CQ-1 (**planned, not built**).

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

| Type                                                                                                          | Direction                                         | Written by                                                                                                                                                                                    | Reversal owner                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOR_POS`                                                                                                     | DEBIT (full sale price, no counter cash)          | `SalesRepository` (`sale.partnerMode === "FOR"`)                                                                                                                                              | `_reversePartnerLedger` (type-agnostic, keyed by `reference_table='sales'`/`reference_id`)                                                                                                                                         |
| `FOR_RECHARGE`                                                                                                | DEBIT                                             | `RechargeRepository`                                                                                                                                                                          | `_reversePartnerLedger`                                                                                                                                                                                                            |
| `FOR_LOTO`                                                                                                    | DEBIT                                             | `LotoTicketRepository`                                                                                                                                                                        | `_reversePartnerLedger` — but the LOTO transaction itself is `NON_REVERSIBLE_TRANSACTION_TYPES`, so in practice this row is corrected only via a settlement/adjustment, never a void                                               |
| `FOR_IPICK`, `FOR_KATSH`                                                                                      | DEBIT                                             | `FinancialServiceRepository` (cost/price catalog+bill flow)                                                                                                                                   | `_reversePartnerLedger`; defers profit via the partner-pending gate like every other `FOR_%` type (see §6 — no carve-out)                                                                                                          |
| `FOR_OMT_SEND`, `FOR_WHISH_SEND`, `FOR_OMT_APP_SEND`, `FOR_WHISH_APP_SEND`, `FOR_BINANCE_SEND`                | DEBIT                                             | `FinancialServiceRepository` (SEND, "For Partner" checkbox)                                                                                                                                   | `_reversePartnerLedger`                                                                                                                                                                                                            |
| `FOR_OMT_RECEIVE`, `FOR_WHISH_RECEIVE`, `FOR_OMT_APP_RECEIVE`, `FOR_WHISH_APP_RECEIVE`, `FOR_BINANCE_RECEIVE` | CREDIT (shop owes partner)                        | `FinancialServiceRepository` (RECEIVE, "For Partner" checkbox)                                                                                                                                | `_reversePartnerLedger`                                                                                                                                                                                                            |
| `THROUGH_OMT_SEND` / `THROUGH_WHISH_SEND`                                                                     | CREDIT                                            | `FinancialServiceRepository` (`ledgerType = \`THROUGH*${OMT\|WHISH}*${SEND\|RECEIVE}\``, template-composed, not a literal — only OMT/OMT_APP→OMT and WHISH/WHISH_APP→WHISH map)               | `_reversePartnerLedger`                                                                                                                                                                                                            |
| `THROUGH_OMT_RECEIVE` / `THROUGH_WHISH_RECEIVE`                                                               | DEBIT                                             | same as above                                                                                                                                                                                 | `_reversePartnerLedger`                                                                                                                                                                                                            |
| `WHISH_TOPUP`                                                                                                 | CREDIT (shop owes partner for funding the wallet) | `RechargeRepository` (Whish App top-up via partner; touches no cash drawer)                                                                                                                   | The wrapping transaction is `RECHARGE_TOPUP`, which is `NON_REVERSIBLE` — this row has no practical void path (matches the "no payments row" rationale for RECHARGE_TOPUP)                                                         |
| `SETTLEMENT`                                                                                                  | Either (computed from the current balance)        | `PartnerRepository.recordSettlementMoneyMovement` via `addLedgerEntry` (Partners-page settlement)                                                                                             | `PARTNER_SETTLEMENT`/`PARTNER_PAYMENT` transactions are **`NON_REVERSIBLE_TRANSACTION_TYPES`** — the FIFO `covered_amount` stamps this row applied cannot be un-applied generically; corrections are an opposite manual settlement |
| `ADJUSTMENT`                                                                                                  | Either                                            | Manual Add-credit/debt (PFT-7/7b, `applyCoverage` optional)                                                                                                                                   | Same as SETTLEMENT if `applyCoverage`/cash-moved (wrapped in `PARTNER_PAYMENT`, non-reversible); a paper (non-cash) `ADJUSTMENT` has no transaction wrapper at all, so it's a plain manual ledger edit                             |
| `OMT_SEND`/`OMT_RECEIVE`/`WHISH_SEND`/`WHISH_RECEIVE`/`CUSTOM_SERVICE`                                        | —                                                 | **Legacy** — declared in `CreateLedgerEntryData`'s type union and in historical migration CHECK constraints; no current repository writes them. Superseded by the `FOR_*`/`THROUGH_*` system. | n/a (dead code path, kept for backward-compat reads of old rows)                                                                                                                                                                   |

`FOR_%`/`THROUGH_%` rows **never act as coverage sources** — only `SETTLEMENT`
(always) or a `applyCoverage: true` `ADJUSTMENT` (PFT-7b, "cash moved"
checkbox) run `applySettlementCoverage`. This is deliberate: a void's negating
`FOR_%` row (opposite direction, same type) must never look like a real
settlement of its own original.

**No `FOR_*`/`THROUGH_*` literal guard exists yet.** Unlike `debt_ledger`'s
`moduleDebtTypes.guard.test.ts`, there is no jest test scanning
`partner_ledger` string literals — CQ-1 in the consolidation plan proposes a
mirror guard but it is **not built**. Today, adding a new `FOR_*` type is
enforced only at compile time (the `CreateLedgerEntryData["transaction_type"]`
union in `PartnerRepository.ts`); the reversal path is automatic (type-agnostic
`_reversePartnerLedger`), but the profit-recognition decision (immediate like
iPick/Katsh, or gated like everything else) is a manual edit to
`notPartnerPending`/`txnNotPartnerPending`'s exclusion list and is easy to
forget.

---

## 4. Supplier ledger — `supplier_ledger` (+ `supplier_purchases`)

Schema (`electron-app/create_db.sql`): `id, tenant_id, supplier_id, entry_type
TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT',
'ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')), amount_usd,
amount_lbp, note, created_by, transaction_id, is_auto, is_refunded,
refunded_at, created_at`. This is the **only** one of the three ledgers that
still has a live CHECK constraint on its type column.

**Sign convention**: **+ = shop owes supplier** ("You owe", red); **− = we've
paid / they owe us less**. `addLedgerEntry` force-normalizes `PAYMENT` rows to
negative regardless of what the caller passed in.

### Every `entry_type` in use

| Type               | Written by                                                                                                                                                                                                                                                                                                                                                          | Reversal owner                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOP_UP`           | **Automatic**: `RechargeRepository` (prepaid-units top-up — raw INSERT, no `transaction_id` link back), `FinancialServiceRepository` (cost/price provider top-up, via `addLedgerEntry`), `LotoTicketRepository` (ticket-sale float draw). **Manual**: Suppliers page → `supplierHandlers.ts` / `backend/src/api/suppliers.ts` → `SupplierRepository.addLedgerEntry` | The `RechargeRepository` automatic path rides on `RECHARGE_TOPUP` (`NON_REVERSIBLE`) — no practical reversal. The `FinancialServiceRepository`/manual paths get a `SUPPLIER_PAYMENT`-type transaction (reversible generically: soft-void via `is_refunded`; no drawer moved at TOP_UP time so nothing to unwind)                                                 |
| `SALE_COST`        | Manual only (Suppliers page `addLedgerEntry`) — documented in code as "cost/price-flow SEND", but no automatic repository call site was found; declared for reconciling a sale cost distinctly from a manual top-up                                                                                                                                                 | Generic (soft-void via `is_refunded`, `SUPPLIER_PAYMENT` transaction type)                                                                                                                                                                                                                                                                                       |
| `PAYMENT`          | `SupplierRepository.addLedgerEntry` (drawer-based, legacy) and `recordSupplierCashflow` (`direction: "PAY"`, real payment-method legs)                                                                                                                                                                                                                              | Generic void/refund: `_markSourceRefunded` soft-voids the row, `_reversePayments` reverses the drawer leg, **and** `_unapplySupplierPurchaseCoverage` gives back the FIFO purchase coverage the payment consumed (newest-covered-first, capped per purchase) — this is the one ledger with a full 3-part reversal ("Void restores everything", FEATURE_GUIDE §8) |
| `SUPPLIER_PAYS_US` | `recordSupplierCashflow` (`direction: "RECEIVE"`) and a cashless-credit path in `FinancialServiceRepository` (fixed commission on an iPick/Katsh bill — no drawer moves)                                                                                                                                                                                            | Generic (soft-void + drawer reversal); `_unapplySupplierPurchaseCoverage` is a no-op here (`entry_type !== "PAYMENT"` guard) — correct, since RECEIVE never applied purchase coverage in the first place                                                                                                                                                         |
| `ADJUSTMENT`       | Manual only (Suppliers page, e.g. opening balances)                                                                                                                                                                                                                                                                                                                 | Generic (soft-void + drawer reversal if any)                                                                                                                                                                                                                                                                                                                     |
| `SETTLEMENT`       | `SupplierRepository.settleTransactions` (batch-settle pending `financial_services` rows)                                                                                                                                                                                                                                                                            | The wrapping transaction is `SUPPLIER_SETTLEMENT`, which is **`NON_REVERSIBLE`** — the `financial_services.settlement_id`/`is_settled` stamps stay in place, and the commission credit to General has no payments row to reverse                                                                                                                                 |
| `CASH_PRIZE`       | `LotoCashPrizeRepository`                                                                                                                                                                                                                                                                                                                                           | The wrapping transaction is `LOTO_CASH_PRIZE`, **`NON_REVERSIBLE`** (loto family; settle-to-zero reconciliation would break)                                                                                                                                                                                                                                     |

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
repeated three times (the CQ-2 ticket in the consolidation plan is exactly
"extract this once").

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
| `notPartnerPending(refTable, idExpr)` | FS (`getFinancialSettledByCurrency`), recharge, loto — module-level queries keyed by the source row                                            | `NOT EXISTS` an uncovered `FOR_%` row for this source — **all providers, no carve-out** (iPick/Katsh defer like the rest)                                                                                                                                   |
| `txnNotPartnerPending(alias)`         | `getByUser`, `getByClient`, `getDeferredProfit`                                                                                                | Same as `notPartnerPending` but keyed by the **transaction's own** `source_table`/`source_id` (these views iterate unified transactions, not module rows)                                                                                                   |
| `notDebtPending(txnIdExpr)`           | FS (all providers, including iPick/Katsh), recharge, custom service, loto, maintenance, `getByUser`/`getByClient`                              | `NOT EXISTS` an uncovered `'Recharge Debt'`/`'Service Debt'`/`'Custom Service Debt'`/`'Loto Debt'`/`'Maintenance Debt'` row for this transaction. **`'Sale Debt'` is deliberately excluded** — sales recognize via `saleFullyPaid`/`sales.paid_usd` instead |
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

- `getPaymentMethodRows` (Profits → by-payment-method view) — no
  `notPartnerPending`/`notDebtPending` gate at all; a for-partner or
  account-charged transaction's payment-method total is not deferred.
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

**Known, currently-unowned gaps (do not claim these net to 0):**

- Voiding a `FINANCIAL_SERVICE`/`RECHARGE` transaction leaves its auto
  `SUPPLIER_PAYMENT` sibling row standing — nobody reverses the sibling.
- Refunding a `DEBT_REPAYMENT` reverses the cash (`_reversePayments`) but
  **not** the `'Repayment'` `debt_ledger` row itself — a rule-20 violation
  with no assigned owner yet (either whitelist `'Repayment'` after a routing
  analysis, or gate `DEBT_REPAYMENT` non-reversible like `CREDIT_CASH_OUT`).
- `PARTNER_SETTLEMENT`/`PARTNER_PAYMENT` are flatly non-reversible — their
  FIFO `covered_amount` stamps have no unwind mechanism; correction is an
  opposite manual settlement/adjustment, never a void.
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
     **today**. For a new partner `FOR_*`/`THROUGH_*` type, the equivalent
     guard (CQ-1) is **not built yet** — enforcement is compile-time-only via
     the `CreateLedgerEntryData` union; don't assume a test will catch a
     forgotten one.
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
