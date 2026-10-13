# Contract: write payloads — Extra charges

Every channel below keeps its IPC handler and REST route; both validate with the same core schema (rule 19, constitution III) and return `{ success, … }`. New optional fields on each payload: `extra_usd`, `extra_lbp` (numbers ≥ 0, optional, no default).

| Operation | IPC channel | REST route | Schema |
| --- | --- | --- | --- |
| POS sale | `sales:process` | `POST /api/sales/process` | `saleProcessSchema` |
| Maintenance checkout | `maintenance:save` | `POST /api/maintenance/jobs` | `saveMaintenanceJobSchema` |
| Custom service | `custom-services:add` | `POST /api/custom-services/` | custom service create schema |
| Loto ticket sale | `loto:sell` | `POST /api/loto/sell` | `lotoSellSchema` |
| Recharge / MTC-Alfa sale | `recharge:process` | `POST /api/recharge/process` | `createRechargeSchema` |
| OMT/Whish send, Katsh, crypto send, app transfer | `omt:add-transaction` | `POST /api/services/transactions` | `createFinancialServiceSchema` |
| Session checkout | `session:checkout` | `POST /api/sessions/checkout` | `sessionCheckoutSchema` (+ REST `checkoutSchema`) |

Preload `data` types and adapter types (`backendApi.ts`, `ElectronApiAdapter.ts`, `ApiAdapter`) derive from these schemas (rules 12, 21); rule 23 three-way key diff on each channel before shipping.

## Server responses

Unchanged envelope. Refusals (`success: false`, plain sentence):
- "A sale can have a discount or an extra, not both."
- "The extra can't be more than the sale itself."
- "Add the extra at the session checkout." (basket item)
- "No extra on a for-partner sale."

## Reporting

`profits:by-module` / `GET /api/profits/by-module` and `profits:summary` return the new `EXTRA_CHARGE` row and `extra_charges` totals (data-model.md).
