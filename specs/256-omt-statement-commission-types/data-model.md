# Data Model: OMT statement commission types (LIRA-256)

**No migration.** No table, column or index is added or changed. Latest migration stays v209.

## Existing data this feature reads

### `financial_services` (unchanged)

| Column | Use here |
|--------|----------|
| `provider` | Only `'OMT'` rows are ever filtered by type. |
| `omt_service_type` | The commission type: one of the 8 values, or NULL (→ `UNSPECIFIED`). |
| `commission_model` | 1 = commission at settlement (restricted at settlement); 0 = legacy (never restricted at settlement). |
| `commission` | Creation-time estimate; summed per type by the statement check only. Never used for money. |
| `currency`, `supplier_owed` (computed `SUPPLIER_OWED_EXPR`) | Unchanged roles. |
| `settlement_id`, `is_settled`, `is_refunded` | Unchanged; the queue is still `getUnsettledBySupplier`. |

### `transactions.metadata_json` of a `SUPPLIER_SETTLEMENT` row (shape extended, no schema change)

Adds one optional key, written only when the payload carried it:

```json
{ "covered_omt_service_types": ["INTRA", "WESTERN_UNION"] }
```

Informational / audit only. Nothing reads it for money or reversal. Absent = "all types" (every
settlement made before this feature, and every settlement made without a choice).

### `supplier_settlements`, `settlement_commission_allocations`, `supplier_ledger` (unchanged)

Written exactly as today by `_bookCommissionAtSettlement`. Because uncovered rows are refused
rather than given 0, every allocation row still belongs to a row that was actually settled.

## New value types (code only)

### `OMT_SERVICE_TYPES` (core, `utils/omtFees.ts`)

Readonly tuple of the 8 existing values; `OmtServiceType` becomes `typeof OMT_SERVICE_TYPES[number]`.

### `OmtCoveredType` (core, `utils/omtCoveredTypes.ts`)

`OmtServiceType | "UNSPECIFIED"`. `"UNSPECIFIED"` matches `omt_service_type IS NULL`; it is never
stored.

### `omtCoveredTypesSchema` (core, `validators/supplier.ts`)

`z.array(z.enum([...OMT_SERVICE_TYPES, "UNSPECIFIED"])).min(1)`. Used `.optional()` on both settle
schemas and parsed for the statement read on both transports. Duplicates are allowed and ignored
(set semantics).

### `isOmtRowCovered(row, covered)` (core, `utils/omtCoveredTypes.ts`, pure)

```
covered === undefined           → true   (all types — today's behaviour)
row.provider !== "OMT"          → true   (only OMT counter rows have types)
row.omt_service_type == null    → covered includes "UNSPECIFIED"
otherwise                       → covered includes row.omt_service_type
```

Settlement guard applies it only to model-1 rows (S5); the check applies it to every OMT row, with the S9 sign rule for model-0 rows (see `AccountExpectedStatement` below).

## Read model changes

### `AccountExpectedStatement` (core + `packages/ui` mirror)

| Field | Change |
|-------|--------|
| `unsettled_commission_usd/_lbp` | The commission still to take off the app's balance. Per OMT counter row: new-style (model 1) → its commission when covered, 0 when not; old-style (model 0, booked net) → 0 when covered, MINUS its commission when not (S9). Non-OMT member rows: their commission, always (unchanged). Can be negative only when an uncovered old-style row is queued. |
| `expected_usd/_lbp` | Unchanged formula: gross − unsettled commission. |
| `covered_omt_service_types` | NEW. Echo of the choice used, `null` = all types. |
| `commission_by_type` | NEW. `Array<{ omt_service_type: OmtCoveredType; commission_usd; commission_lbp; count }>` for every OMT counter row in the queue (covered or not), sorted by the tuple order then `UNSPECIFIED`. |

### `AccountUnsettledRow` (core + `packages/ui` mirror)

| Field | Change |
|-------|--------|
| `omt_service_type` | NEW. `string \| null`. Set for FINANCIAL_SERVICE rows, `null` for LEDGER rows. |
| `commission_model` | NEW. `number \| null`. Set for FINANCIAL_SERVICE rows, `null` for LEDGER rows. |

### `EligibleSettlementRow` (core, private)

Adds `omt_service_type: string | null` to the `_resolveSettlementBatchModel` SELECT.

## Write model changes

`SettleTransactionsData` and `SettleAccountData` each gain
`covered_omt_service_types?: OmtCoveredType[]`, inferred from the shared schema.

## State transitions (one transfer)

```
created (model 1, unsettled, estimate stored)
   │  settlement WITHOUT covered types, or WITH a list that covers its type
   ▼
settled (allocation row written with its share of the typed commission)
   │  void the settlement
   ▼
unsettled again (allocation deleted)          ← unchanged

created (model 1, unsettled)
   │  settlement WITH a list that does NOT cover its type, and it is selected
   ▼
REFUSED — nothing written; stays unsettled    ← NEW
```

There is no "settled for principal, commission awaiting" state (rejected alternative B, research R1).
