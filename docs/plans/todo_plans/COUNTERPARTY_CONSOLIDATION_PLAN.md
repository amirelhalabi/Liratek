# Counterparty Consolidation — Accounts / Suppliers / Partners

> **Created**: 2026-07-14
> **Origin**: Owner observation — "accounts, suppliers, partners have a lot in
> common; what do you suggest from a software-engineering perspective?"
> **Status**: PLAN (no code changed yet). Tickets: CQ-0 … CQ-6.

## The shared concept

All three subsystems are the SAME machine with different names — a
**counterparty ledger**:

```
accrue (module txns charge the counterparty)
  → balance (net what they owe us / we owe them, per currency)
    → settle (money physically moves; drawer + audit txn)
      → recognize (profit becomes real only when money is real)
        → reverse (void/refund nets every ledger to 0)
```

|                  | Accounts (clients)                                        | Partners                                          | Suppliers                                      |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Ledger table     | `debt_ledger`                                             | `partner_ledger`                                  | `supplier_ledger`                              |
| Sign convention  | signed rows (+charge/−repayment), 2 amount cols (usd/lbp) | `direction` DEBIT/CREDIT + single amount+currency | typed rows (TOP_UP/PAYMENT/…)                  |
| Accrual types    | `'<Module> Debt'` strings (guarded whitelist)             | `FOR_%` / `THROUGH_%` prefixes                    | TOP_UP / SALE_COST / …                         |
| Coverage (FIFO)  | `covered_usd/lbp` (v129) + `sales.paid_usd` bump          | `covered_amount` (v128)                           | `purchases.paid_usd` coverage                  |
| Settlement money | repayment drawer routing + CREDIT_CASH_IN/DEBT_CASH_OUT   | PARTNER_SETTLEMENT / PARTNER_PAYMENT (PFT-6b/7b)  | recordCashflow PAY/RECEIVE                     |
| Recognition gate | `saleFullyPaid` + `notDebtPending`                        | `notPartnerPending` / `salePaidOrPartnerSettled`  | `fs.is_settled`                                |
| Reversal owner   | `_cancelDebt` (MODULE_DEBT_TRANSACTION_TYPES)             | `_reversePartnerLedger` (type-agnostic)           | soft-void + `_unapplySupplierPurchaseCoverage` |

Three storage schemas, ONE behavior family. The behavior is where the
duplication (and the bugs) live; the storage differences are stable and
battle-tested.

## Duplication inventory (measured 2026-07-14)

| What                                                                         | Count                        | Where                                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Drawer-balance upsert (`ON CONFLICT(tenant_id, drawer_name, currency_code)`) | **35 copies / 19 files**     | every money repo (Recharge alone: 8)                                                                     |
| `INSERT INTO payments` writer                                                | **19 repositories**          | each with its own prepared stmt + arg order                                                              |
| FIFO coverage algorithm                                                      | **5 implementations**        | `_markSalesPaidFIFO`, `_coverServiceDebtsFIFO`, `applySettlementCoverage`, supplier purchase coverage ×2 |
| "For Partner" checkbox+picker+notice block                                   | **7 frontend copies**        | CheckoutModal, TelecomForm, Loto, FinancialForm, OmtWhishApp, Crypto, Katch                              |
| Counter-payment reject guard                                                 | **6 copies / 4 repos**       | Sales/Recharge/Loto/FS FOR branches                                                                      |
| Charge-routing branch (CUSTOMER_ACCOUNT vs FOR-partner)                      | **5 repos × 2 destinations** | hand-rolled inserts + guards per repo                                                                    |
| Profit "pending" fragments                                                   | 6 named fragments            | ProfitRepository (good — but only there by convention, not construction)                                 |
| Settlement→txn+payment+drawer writer                                         | 3 implementations            | partner/accounts/supplier                                                                                |

Every one of these is a place where the NEXT change must be made N times —
exactly how the bugs this sprint fixed were born (the partner auto-record
provider collapse, the loto double-book, the USDT settle direction).

## Principles (what to do — and NOT do)

1. **Consolidate BEHAVIOR, not STORAGE.** Do NOT merge the three ledger
   tables into a `party_ledger` (party_type discriminator). The schemas are
   stable, migration is a table rebuild ×3 on live money data (the v104 scar),
   and the win is almost entirely in shared _code_, not shared _rows_.
   Revisit only if a 4th counterparty type ever appears. **Non-goal.**
2. **Strangler-fig, one extraction per PR/commit**, each behavior-identical
   and gated by the existing wall: 49 e2e (lira-113…121 + money suites),
   628 core jest, 447 backend jest. A refactor commit that changes any
   assertion is a failed refactor.
3. **Pure logic first** (unit-testable helpers), SQL-owning helpers second,
   frontend components third. Rule 13 stays intact: repositories keep owning
   their SQL; shared helpers are _called by_ repos, never reach around them.
4. **Docs are part of the deliverable** — the canonical model must live in
   the repo, not in commit messages.

## Phases

| Ticket   | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Risk                                                                 | Value                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **CQ-0** | **Documentation**: `docs/COUNTERPARTY_LEDGERS.md` — the canonical model (the table above, expanded): sign/direction conventions per ledger, every transaction_type, coverage semantics (`covered_amount` vs `covered_usd/lbp` vs `paid_usd`), the recognition-gate table, reversal owners, settlement money-movement contract, and the "profit is real when money is real" rule. Extend `FEATURE_GUIDE.md` §13 with the counterparty checklist (charge routing mutually exclusive; counterparty selected; coverage applied on settlement; recognition gated; reversal owner named). | none                                                                 | high — this session's knowledge currently lives in commit messages + plan docs |
| **CQ-1** | **Drift guards** (cheap tests before any refactor): a jest guard that every `FOR_[A-Z_]+` string literal written in `packages/core/src` appears in the `PartnerRepository` union (mirror of the existing `moduleDebtTypes.guard`); a guard that every ProfitRepository module query containing `profit` references the recognition fragments (regex-level heuristic, keeps new queries from shipping ungated).                                                                                                                                                                      | none                                                                 | catches the exact drift class that caused this sprint's bugs                   |
| **CQ-2** | **`utils/fifoCoverage.ts`** — ONE pure allocator: `allocateFifo(open: {id, outstanding}[], budget) → {id, take}[]` + shared epsilon constants (0.005 USD / 1 LBP). The 5 call sites keep their own SQL (SELECT open rows / UPDATE covered cols) but share the allocation math + tolerances. Unit-tested exhaustively (partials, over/under budget, epsilon edges).                                                                                                                                                                                                                  | low                                                                  | kills the subtlest duplicate — allocation math with 5 chances to diverge       |
| **CQ-3** | **`repositories/moneyPosting.ts`** — the shared posting helpers every repo calls instead of hand-rolling: `insertPaymentRow(db, tenantId, {...})` and `applyDrawerDelta(db, tenantId, drawer, currency, delta)` (the ONE `ON CONFLICT` upsert). Migrate the 19 repos call-site-by-call-site (mechanical; e2e wall proves each). Ends the 35-copy upsert.                                                                                                                                                                                                                            | low-med (mechanical, high count)                                     | one place to fix drawer semantics forever; prerequisite for CQ-4               |
| **CQ-4** | **Charge-routing helper** — `bookCounterpartyCharge(db, {kind: 'client'\|'partner', counterpartyId, txnId/sourceRef, amounts, currency, chargeType})` + the canonical guards (mutual exclusivity, counterparty-required, reject-counter-payment with the ONE message). The 5 money repos' CUSTOMER_ACCOUNT + FOR-partner branches shrink to a call each.                                                                                                                                                                                                                            | med (money paths — full failing-first-style e2e re-run per repo)     | the 5×2 duplicated branch is where routing bugs breed                          |
| **CQ-5** | **Settlement money-movement unification** — one `postCounterpartySettlement(...)` used by partner settle/payment, accounts cash-in/out + repayment drawer routing, supplier cashflow: ledger row + unified txn + payment row + drawer delta + coverage hook, parameterized by party kind. Builds on CQ-3.                                                                                                                                                                                                                                                                           | med                                                                  | 3 implementations → 1; new counterparty features become config, not code       |
| **CQ-6** | **Frontend extraction** — `packages/ui`: `<ForPartnerToggle>` (checkbox + PartnerSelector + no-payment notice + submit-guard hook) replacing the 7 copies; a shared `<CounterpartyLedgerTable>` + `<BalanceCard>` + `<SettleModal>` family for the Accounts/Partners/Suppliers pages (they render the same shapes with different labels); the Add-credit/debt modal (accounts + partners variants) parameterized.                                                                                                                                                                   | low-med (UI; typecheck + the UI e2e specs lira-114 guard the toggle) | 7 copies → 1; consistent UX across the three pages for free                    |

Suggested order: CQ-0 → CQ-1 (guards first), then CQ-2 → CQ-3 → CQ-4 → CQ-5
(each builds on the previous), CQ-6 anytime after CQ-0 (independent).

## Guard strategy per phase

- CQ-2..5 are **behavior-identical refactors**: the proof is the FULL existing
  gate green before AND after each phase (e2e lira-113…121 + money suites,
  core jest, backend jest, typecheck/lint) — plus new unit tests for each pure
  helper. No assertion may change; a needed assertion change means the
  refactor altered behavior and must be reverted and rethought.
- CQ-3/CQ-4 migrate call sites in small batches (one repo per commit) so a
  regression bisects to one repo.
- Jest fixture drift is expected each time a shared helper references a new
  column — fix fixtures, not queries (standing rule), and budget for it.

## Explicit non-goals

- No `party_ledger` table merge / no schema unification (see Principles #1).
- No renaming of existing transaction_type strings (they are load-bearing in
  reports, guards, and historical rows).
- No service-layer "GenericCounterpartyService" abstraction — the three
  domains keep their own services (rule 13 orchestration); only the shared
  mechanics move into helpers.
