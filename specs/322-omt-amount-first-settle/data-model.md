# Data Model: LIRA-322

## New table — `supplier_settlement_coverage` (migration v217)

One row = what one settlement applied to one OMT-account queue row, in one currency, from one source.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `tenant_id` | INTEGER NOT NULL | every query filters it (tenant-scoping check) |
| `transaction_id` | INTEGER NOT NULL | the `SUPPLIER_SETTLEMENT` transaction |
| `anchor_ledger_id` | INTEGER NOT NULL | the settlement's anchor `supplier_ledger` row |
| `row_kind` | TEXT NOT NULL CHECK IN ('FINANCIAL_SERVICE','LEDGER') | queue row kind |
| `row_id` | INTEGER NOT NULL | `financial_services.id` or `supplier_ledger.id` |
| `member_supplier_id` | INTEGER NOT NULL | account member that owns the row |
| `currency` | TEXT NOT NULL CHECK IN ('USD','LBP') | |
| `amount` | REAL NOT NULL CHECK (amount > 0) | magnitude applied; always reduces the row's \|remaining\| |
| `source` | TEXT NOT NULL CHECK IN ('PAYMENT','NETTING','COMMISSION','WAIVE') | what paid it |
| `closes_row` | INTEGER NOT NULL DEFAULT 0 | 1 when this settlement fully covered the row (it stamped `settlement_id`) |
| `is_reversed` | INTEGER NOT NULL DEFAULT 0 | set by the void, never deleted |
| `created_at`, `updated_at` | TEXT NOT NULL DEFAULT datetime('now') | schema rule 5 |

Indexes: `(tenant_id, row_kind, row_id, is_reversed)` for remaining-amount reads; `(tenant_id, transaction_id)` for void.

`down()` drops the table and indexes. Add the same table to `electron-app/create_db.sql` (rule 10).

## Terms

"Transaction" / "transfer" in the spec, "row" in the contracts and "queue row" here all mean one entry in the OMT account's unsettled list (`getAccountUnsettled`).

## Derived values (one named SQL fragment, rule 14)

- **Covered so far** (row, currency) = `SUM(amount) WHERE row_kind=? AND row_id=? AND currency=? AND is_reversed=0 AND tenant_id=?`. Exported as `ACCOUNT_ROW_COVERED_SQL` and used by `getAccountUnsettled`, `getAccountExpectedStatement` and `getAllByProvider`.
- **Remaining** = `|row amount in currency| − covered so far`. Sign is kept from the row (debt +, credit −).
- **Queue row** (`AccountUnsettledRow`) gains `covered_usd`, `covered_lbp`, `remaining_usd`, `remaining_lbp`. `amount_*` stays the full gross, so existing readers keep working.

## Existing rows — what changes

| Row | Today | With LIRA-322 |
| --- | --- | --- |
| `financial_services` queue row | settled whole: `settlement_id`, `is_settled=1` | stamped only when remaining ≤ epsilon; until then it stays open with coverage |
| `supplier_ledger` queue row (credit/manual) | settled whole: `settlement_id` | same as above |
| Member settlement row | one per member, both currencies, refused if they point opposite ways | **one per member per currency with a nonzero money share**; entry type from its own sign (`PAYMENT` / `SUPPLIER_PAYS_US`) |
| Netting transfer pair (new) | — | written when a credit on member A nets a debt on member B: B −x `PAYMENT`, A +x `SUPPLIER_PAYS_US`, `is_auto=1`, `transaction_id`=settlement, stamped `settlement_id = anchor` at write time (never open, so never re-netted) |
| Commission credit row | `settlement_id` NULL, shows in queue (F3) | stamped `settlement_id = anchor`; old ones excluded from the queue by `isSettlementCommissionCredit` |
| Overpay rows (LIRA-315) | one per currency, open credit | unchanged |
| `SUPPLIER_SETTLEMENT` transaction | one direction | one transaction; `metadata_json.per_currency` holds each currency's direction / paid / commission / waive / extra |
| `settlement_commission_allocations` | split across all selected model-1 rows | split across the model-1 rows **this settlement closes**, in proportion to what each still owed |

## State of a queue row

```
open (covered 0) ──partial payment──▶ part-paid (0 < covered < gross)
      │                                   │
      └──────── full coverage ────────────┴──▶ settled (settlement_id = closing anchor)

void of the closing settlement ──▶ coverage reversed ──▶ part-paid or open
void of a non-newest settlement ──▶ refused (R8)
```

## Invariants (each one gets a test)

1. **Per member, per currency**: ledger balance = Σ remaining on that member's open queue rows (debts + credits; overpay credits are queue rows too). This covers FR-020, and SC-004 by property test.
2. **Every settlement**: Σ coverage by source PAYMENT = Σ IN − Σ OUT legs counted toward rows (extra excluded). Σ NETTING on debts = Σ NETTING on credits, per currency.
3. **Create + void** nets to 0 per currency on drawers, member balances, profit and commission allocations (rule 20).
4. A row has at most one `closes_row=1` coverage among active coverage.
