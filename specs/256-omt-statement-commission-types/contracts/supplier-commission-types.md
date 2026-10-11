# Contracts: OMT statement commission types (LIRA-256)

Every change is additive and optional. Omitting the new field reproduces today's *values* on
both transports; the statement read gains two always-present keys (`covered_omt_service_types`,
`commission_by_type`). Envelopes are unchanged (`{ success, … }`, HTTP 200 on a
business failure, rule 6).

Shared schema (core, `packages/core/src/validators/supplier.ts`, exported from both `index.ts`
and `browser.ts` via `validators/index.ts`):

```ts
// OMT_COVERED_TYPE_VALUES is imported from ../utils/omtCoveredTypes.js (defined there only)
export const omtCoveredTypesSchema = z.array(z.enum(OMT_COVERED_TYPE_VALUES)).min(1);
export type OmtCoveredTypesInput = z.input<typeof omtCoveredTypesSchema>;
```

## 1. Statement check read (display only)

| Transport | Before | After |
|-----------|--------|-------|
| IPC | `suppliers:account-expected-statement` `(accountSupplierId: number)` | `(accountSupplierId: number, coveredTypes?: OmtCoveredTypesInput)` |
| REST | `GET /api/suppliers/:id/account-expected-statement` | `GET /api/suppliers/:id/account-expected-statement?covered=INTRA,WESTERN_UNION` |
| Adapter | `getSupplierAccountExpectedStatement(id)` | `getSupplierAccountExpectedStatement(id, coveredTypes?)` |

Auth: unchanged (IPC: no role gate, as today; REST: `requireAuth`, as today).

Validation:

- IPC: when the 2nd argument is not `undefined`, it is parsed with `omtCoveredTypesSchema`; a
  failure THROWS (the invoke promise rejects). This read returns the raw statement shape, never an
  envelope, so it must not return `{ success: false }` where a statement is expected.
- REST: `covered` absent → no filter. Present (string or repeated → array) → flattened, split on
  `,`, trimmed, parsed with the same schema; failure → HTTP 200 `{ success: false, error }`. The
  adapter's REST branch throws on `success: false` so both transports surface the same error state.

Response (`statement`, REST wraps it as `{ success: true, statement }` as today):

```ts
type AccountExpectedStatement = {
  account_supplier_id: number;
  gross_owed_usd: number;
  gross_owed_lbp: number;
  unsettled_commission_usd: number;   // covered new-style OMT rows − uncovered old-style OMT rows (S9) + all non-OMT member rows
  unsettled_commission_lbp: number;
  expected_usd: number;               // gross − unsettled commission
  expected_lbp: number;
  covered_omt_service_types: OmtCoveredType[] | null;   // NEW, null = all types
  commission_by_type: Array<{                            // NEW
    omt_service_type: OmtCoveredType;
    commission_usd: number;
    commission_lbp: number;
    count: number;
  }>;
};
```

Example: queue holds INTRA (USD, commission 0.70) and WESTERN_UNION (USD, commission 1.20),
gross 500.00 USD; `covered=INTRA` →
`unsettled_commission_usd = 0.70`, `expected_usd = 499.30`, `commission_by_type` lists both.

## 2. Settle transactions (Settle tab)

| Transport | Endpoint (unchanged) |
|-----------|----------------------|
| IPC | `suppliers:settle-transactions` |
| REST | `POST /api/suppliers/:id/settle` |

Payload: `supplierSettleSchema` + `covered_omt_service_types: omtCoveredTypesSchema.optional()`.

Behaviour when present:

- Rows are resolved as today (`_resolveSettlementBatchModel`). If the batch is model 1 and any
  OMT row's type is not covered → refused before any write:
  `{ success: false, error: "Cannot settle transfer #<id>: its commission type <TYPE> is not included in this statement" }`
  (`<TYPE>` is `Type not recorded` for NULL). The first offending row (lowest id) is named;
  the message lists the count when more than one.
- Legacy (model 0) batches: the key is accepted and ignored for restriction, but still stamped.
- Accepted: `transactions.metadata_json.covered_omt_service_types` = the de-duplicated list in
  tuple order.

## 3. Settle account (OMT account settle sheet)

| Transport | Endpoint (unchanged) |
|-----------|----------------------|
| IPC | `suppliers:settle-account` |
| REST | `POST /api/suppliers/:id/settle-account` |

Payload: `supplierSettleAccountSchema` + `covered_omt_service_types: omtCoveredTypesSchema.optional()`.

Behaviour: same guard, applied right after the selections are re-validated, to EVERY selected
FINANCIAL_SERVICE row (only model-1 OMT rows can fail it), whatever the commission and however many
members the selection spans. LEDGER selections and non-OMT rows are never restricted. Same error text,
same metadata stamp. The LIRA-203 surplus fields are unchanged.

## 4. Account unsettled read (shape only)

`suppliers:account-unsettled` / `GET /api/suppliers/:id/account-unsettled`: each row gains
`omt_service_type: string | null` and `commission_model: number | null` (null for LEDGER rows).

## 5. Preload / type surfaces to widen (rule 12, rule 21)

- `electron-app/preload.ts`: `suppliers.getAccountExpectedStatement(accountSupplierId, coveredTypes?)`;
  `settleTransactions` and `settleAccount` `data` types gain `covered_omt_service_types?`.
- `frontend/src/types/electron.d.ts`: the same three signatures.
- `packages/ui/src/api/types.ts`: `ApiAdapter.getSupplierAccountExpectedStatement` signature,
  `AccountExpectedStatement` and `AccountUnsettledRow` mirrors. Settle payload types already
  derive from the core schema types.
