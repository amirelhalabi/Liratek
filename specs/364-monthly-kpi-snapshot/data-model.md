# Data model: Monthly KPI snapshot (LIRA-364)

Migration **v228** (last applied: v227; re-check the last entry of `packages/core/src/db/migrations/index.ts` when implementing). Both `migrations/index.ts` and `electron-app/create_db.sql` change (rule 10), with `down()` dropping both tables.

## `kpi_snapshots`: one per shop per month

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER NOT NULL REFERENCES tenants(id) | |
| month | TEXT NOT NULL | `YYYY-MM`, the Beirut month described |
| taken_at | TEXT NOT NULL | UTC `YYYY-MM-DD HH:MM:SS` |
| is_late | INTEGER NOT NULL DEFAULT 0 CHECK (0/1) | R6 |
| usd_lbp_buy_rate | REAL NULL | R7, display only |
| usd_lbp_sell_rate | REAL NULL | R7, display only |
| created_at / updated_at | DATETIME DEFAULT CURRENT_TIMESTAMP | rule 5 |

`UNIQUE (tenant_id, month)` is what makes the capture idempotent (FR-008).

## `kpi_snapshot_values`: one per KPI per snapshot

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER NOT NULL REFERENCES tenants(id) | |
| snapshot_id | INTEGER NOT NULL REFERENCES kpi_snapshots(id) ON DELETE CASCADE | |
| kpi_key | TEXT NOT NULL | a key from the KPI definitions |
| amount_usd | REAL NOT NULL DEFAULT 0 | ≥ 0 (sides are split, never negative) |
| amount_lbp | REAL NOT NULL DEFAULT 0 | ≥ 0 |
| created_at / updated_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

`UNIQUE (snapshot_id, kpi_key)`. A key-value row per KPI means a new KPI needs no migration (FR-014). A month saved before a KPI existed simply has no row for it, and the page shows "not recorded".

## KPI definitions (code, not table): `packages/core/src/constants/kpiDefinitions.ts`

Browser-safe leaf module (rule 29): no imports beyond types.

| key | group | requiresModule | order |
|---|---|---|---|
| `customers_owe_shop` | generic | — | 1 |
| `suppliers_owe_shop` | generic | — | 2 |
| `partners_owe_shop` | generic | — | 3 |
| `shop_owes_customers` | generic | — | 4 |
| `shop_owes_suppliers` | generic | — | 5 |
| `shop_owes_partners` | generic | — | 6 |
| `stock_value` | generic | — | 7 |
| `carrier_credits` | phone_shop | `recharge` | 8 |

Display names come from i18n (`kpi.<key>`), not from the definitions.

## Start marker

`system_settings` row `key_name = 'kpi_snapshots_since'`, value `YYYY-MM` (R5). It is written once per shop, by the first capture run.

## Lifecycle

There is no state machine. A snapshot is inserted once with all its values in one transaction and never updated or deleted by the app (FR-010). A tenant cascade delete (`TenantRepository.deleteTenantCascade`) must include both tables, so the plan adds them to its table list.
