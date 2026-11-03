# Data model — LIRA-370

## New table: `omt_owed_shares` (migration v229)

One row per closed OMT transfer whose share OMT has not paid yet. Created by a settlement whose SMS did not include the transfer's type, or by one where OMT asked for more (FR-007).

| Column | Type | Rule |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `tenant_id` | INTEGER NOT NULL → tenants | every query filters on it |
| `financial_service_id` | INTEGER NOT NULL → financial_services | the transfer |
| `omt_service_type` | TEXT NOT NULL | `omtRowCoveredType(row)` at creation, `'UNKNOWN'` when not recorded |
| `currency` | TEXT NOT NULL CHECK IN ('USD','LBP') | |
| `amount` | REAL NOT NULL CHECK(amount > 0) | snapshot of the outstanding estimate at creation (rule 31: "as at settlement") |
| `created_settlement_txn_id` | INTEGER NOT NULL → transactions | the SUPPLIER_SETTLEMENT that left it owed |
| `created_anchor_ledger_id` | INTEGER NOT NULL → supplier_ledger | that settlement's anchor |
| `cleared_settlement_txn_id` | INTEGER NULL → transactions | the settlement that collected it; NULL = still owed |
| `cleared_anchor_ledger_id` | INTEGER NULL → supplier_ledger | |
| `is_reversed` | INTEGER NOT NULL DEFAULT 0 | 1 when the creating settlement is voided |
| `relief_ledger_id` | INTEGER NULL → supplier_ledger | the "OMT paid shares ahead" row booked when the creating settlement was voided after a later one cleared this share; soft-voided if that later settlement is voided too |
| `created_at` / `updated_at` | TEXT NOT NULL DEFAULT datetime('now') | |

Indexes: `(tenant_id, is_reversed, cleared_settlement_txn_id)`, `(tenant_id, financial_service_id)`.

**Live owed** = `is_reversed = 0 AND cleared_settlement_txn_id IS NULL`. Named once as an SQL fragment (`OWED_SHARE_LIVE_SQL`, rule 14).

### States

```
            settlement leaves share owed
  (none) ─────────────────────────────────► OWED
                                             │  later settlement includes the type
                                             ▼
                                           CLEARED ──(void clearing settlement)──► OWED
  OWED / CLEARED ──(void creating settlement)──► REVERSED
     └ if CLEARED by a live settlement: relief row "OMT paid shares ahead"
       on the OMT account (R6)
```

## Existing tables, new use

- `supplier_settlement_coverage.source = 'COMMISSION'`: written again (allowed by the CHECK since v217, unused since 2026-10-15). The commission's coverage of rows when `commissionCoversOwed`. Reversed by `is_reversed` with the rest of a void (existing).
- `settlement_commission_allocations`: one row per transfer per settlement, for the commission booked. Also one row when an owed share is cleared (same `financial_service_id`, the clearing settlement's anchor). These rows, minus live owed shares, are the "commission received" marker (R3).
- `supplier_settlements`: unchanged. `commission_*` = the commission booked by this settlement (cleared shares included).
- `transactions.metadata_json.per_currency[c]` (SUPPLIER_SETTLEMENT): new keys `sms_amount`, `expected_commission`, `extra_commission`, `owed_shares_created`, `owed_shares_cleared`, `omt_asks_more` (bool), `difference`.
- `supplier_ledger`: no commission credit row (`SUPPLIER_PAYS_US` "Auto: commission credit") when `commissionCoversOwed`. Overpay credit (LIRA-315) still written when OMT asks for more. Relief row on a void (R6), `is_auto`, owned by the void.

## Derived values (pure, `utils/omtSmsSettlement.ts`)

- **Outstanding estimate** of a transfer = `financial_services.commission` − live allocations − live owed shares. Never below 0.
- **Expected figure** (per currency, OMT sign) = owed − expected commission (ticked types, transfers this settlement closes) − live owed shares of ticked types.
- **Commission** = max(0, owed − SMS). Expected part = min(commission, expected commission + owed shares included). Extra part = commission − expected part. When the commission is less than expected, owed shares clear first, then transfers pro rata.
- **OMT asks more** ⇔ SMS is worse for the shop than owed: pay SMS > owed, or collect |SMS| < |owed|.
