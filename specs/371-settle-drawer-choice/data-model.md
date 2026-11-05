# Data model: LIRA-371

No migration. No new table or column (research R7).

## CashDrawerChoice (request value, not stored as its own entity)

| Field | Type | Where | Rule |
|---|---|---|---|
| value | `"SYSTEM" \| "GENERAL"` | `CASH_DRAWER_CHOICES` in `packages/core/src/constants/cashDrawerChoice.ts` (pure leaf, exported from `browser.ts`) | One definition (rule 14). `cashDrawerChoiceSchema = z.enum(CASH_DRAWER_CHOICES)` |
| absent | — | every payload | Equals `SYSTEM` (FR-008). Schema `.optional()`, never `.default()` |

**Where the choice ends up:**

- `payments.drawer_name` of each cash leg: `OMT_System` / `Whish_System` (SYSTEM) or `General` (GENERAL).
- Debts only: `routed.cash_drawer` inside the repayment's coverage record (`_recordRepaymentCoverage`), written only for `GENERAL`. `by_transfer` and `legs` are empty then.

## Applicability predicates

| Surface | Applies when | Shared by |
|---|---|---|
| Debts repayment | `repaymentRoutesToSystemDrawer(allocateRepayment(...))` (default allocation routes > 0) | `Debts/index.tsx` preview + `DebtRepository.addRepayment` (same function, same inputs) |
| Supplier settle / cashflow | `provider === baseSystem` AND some IN or OUT leg is General-bound drawer cash | `systemCashDrawerChoiceApplies` (pure leaf). The sheet and modals pass a method-list cash test; the server passes `resolveServiceCashDrawer(m, ctx) === primaryCashDrawerName(base)` |

**Server reaction:**

| Request | Applies | Result |
|---|---|---|
| absent / `SYSTEM` | any | today's posting |
| `GENERAL` | yes | every cash leg in or out of General; Debts: no RESERVE pair |
| `GENERAL` | no | refused, nothing written: "The drawer choice only applies when cash pays an {OMT\|Whish} system transfer. Nothing to choose here." |
| other value | — | refused by Zod |

## Invariants (tests)

- **I1:** default vs no field → identical `payments` rows and drawer balances (SC-001).
- **I2:** `GENERAL` vs default → identical `debt_ledger`, coverage, `supplier_ledger`, settled days, commission, profit. Drawer deltas differ only by moving the system-drawer amount to General (SC-002).
- **I3:** create(`GENERAL`) + void → every drawer and every ledger Δ = 0, per currency (SC-003, rule 20). The reversal owner is the existing `_reversePayments` mirror. No new reversal code.
