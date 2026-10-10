# API contracts: LIRA-296

Every endpoint exists twice, once per transport: IPC `warranty:*` (desktop) and REST `/api/warranty`
(web). Both call the same core service (rule 19).

- **Envelope:** `{ success, data?, error?, code? }`. REST answers HTTP 200 even when it refuses.
- **Schemas:** live in `packages/core/src/validators/warranty.ts`. They and their `*Input` types are exported from `index.ts` and `browser.ts`.
- **Actor and "today":** REST takes the actor from the JWT. "Today" comes from the client (`client_day`), with the server's day as fallback (rule 27).

## P1

### `warranty:search` / `GET /api/warranty/search`

- **Roles:** admin, staff.
- **Query:** `{ q?, from?, to?, state?: 'COVERED'|'EXPIRED'|'VOID', client_day, limit?: 1-200 = 50 }`.
- **`q` matches:**
  - a receipt number (`RCP-12`, `rcp12` or `12`);
  - the customer's name or phone;
  - the product's name or barcode;
  - a serial or IMEI.
- **Returns:** `WarrantySearchRow[]`, newest first. Repair warranties are added in P2.

### Category default (existing category routes, extended)

- `inventory:update-category` / `PUT /api/inventory/categories/:id` accepts `warranty_months: number | null` (0–60). Admin.
- `inventory:get-categories-full` / `GET /api/inventory/categories-full` returns `warranty_months`.

### Sale item (existing sale processing, extended)

- `sales:process` / `POST /api/sales/process`: each item may carry `warranty_months?: number | null` (0–60).
  - When present and different from the resolved default, the line is stamped with `warranty_set_by` = the actor.
- **Rule 23:** before the schema changes, diff three key sets: the sale item schema, the preload binding's type, and the handler's forwarded fields.

### Setting

- `warranty_terms_text`, through the existing settings update (`settings:update` / `PUT /api/settings`). Admin.

### Receipt number

- There is no new endpoint. Checkout prints `receiptNumberFor(sale.id)` from the sale-process response.

## P2

### `warranty:claim` / `POST /api/warranty/claims`

- **Body:**
  ```
  {
    sale_item_id? | maintenance_id?,   // exactly one
    unit_id?,                          // one unit per claim
    action: 'REPAIR'|'REPLACE'|'REFUND',
    notes?, override_reason?,
    refund?: { legs, exchange_rate, kept_change? },  // REFUND only, same shape as refund-item
    client_day
  }
  ```
- **Roles:** REPAIR is admin or staff; REPLACE and REFUND are admin. `override_reason` is required (admin only) when the state is EXPIRED. A VOID state is always refused (`NOT_COVERED`), override or not.
- **Refusals:**
  - `NOT_COVERED`
  - `ALREADY_CLAIMED` (the unit has an open claim)
  - `OUT_OF_STOCK` (REPLACE)
  - `NO_COVERED_UNIT_LEFT` (every covered unit of the line is already claimed)
  - `FORBIDDEN_ACTION`
- **Returns:** `{ claim, repairJobId?, replacementUnitId?, refundTransactionId? }`.

### `warranty:claims-for` / `GET /api/warranty/claims?sale_item_id=|maintenance_id=|unit_id=`

- Returns the claim history, newest first. Admin and staff.

### `warranty:void-claim` / `POST /api/warranty/claims/:id/void`

- Admin only. Reverses everything the claim wrote, then sets the claim to VOIDED.
- **Refusals:**
  - `ALREADY_VOIDED`
  - `DEFECTIVE_ALREADY_SENT` (P3: void the supplier return first)

### `warranty:defective` / `GET /api/warranty/defective?status=`

- Admin. Lists defective items.

### `warranty:defective-resolve` / `POST /api/warranty/defective/:id/resolve`

- **Body:** `{ outcome: 'WRITE_OFF'|'NOT_FAULTY' }`. Admin.
- `NOT_FAULTY` returns the item to stock and books a +cost `WARRANTY_COST` row.
- `WRITE_OFF` keeps the cost already booked.

### Maintenance (existing, extended)

- `maintenance:save` / `POST /api/maintenance/jobs` accepts `warranty_months?: number | null`.
- `warranty_until` is stamped at Delivered_Paid from `client_day`.

### Profits (existing, extended)

- `profits:by-module` / `GET /api/profits/by-module` gains the row `{ module: 'WARRANTY', label: 'Warranty cost' }`.
- `profits:module-detail` serves `WARRANTY`.
- `profits:summary` includes WARRANTY in gross profit.

## P3

### Supplier returns: `warranty:supplier-return-*` / `/api/warranty/supplier-returns`

All admin.

- `POST /` with `{ defective_item_id, supplier_id?, notes? }` creates a return with status SENT. The supplier defaults from the item's FIFO batch.
- `POST /:id/close` with `{ outcome: 'CREDITED'|'REPLACED'|'REJECTED', credit_usd?, credit_lbp?, notes? }` closes it.
- `GET /` lists returns.

### Categories (extended)

- `serial_label: 'IMEI'|'Serial'` and `serial_required: 'BLOCK'|'WARN'`.

### Sale processing (extended)

- A serial-tracked line without a unit gets `code: 'SERIAL_REQUIRED'` when the category is BLOCK. When it is WARN, the sale passes with `warnings[]`.

### `warranty:report` / `GET /api/warranty/report?from&to&client_day`

- Admin.
- **Returns:** `{ underWarranty: [{ category, count, items }], claims: { byAction, grossCostUsd, supplierRecoveredUsd, netCostUsd } }`.

## Frontend adapter (`backendApi.ts`, `ipcOrHttp`)

| Function | Payload type (rule 21) | Phase |
|---|---|---|
| `searchWarranties` | `WarrantySearchInput` | P1 |
| `createWarrantyClaim` | `CreateWarrantyClaimInput` | P2 |
| `getWarrantyClaims` | — | P2 |
| `voidWarrantyClaim` | — | P2 |
| `listDefectiveItems` | — | P2 |
| `resolveDefectiveItem` | — | P2 |
| `createSupplierReturn` | — | P3 |
| `closeSupplierReturn` | — | P3 |
| `listSupplierReturns` | — | P3 |
| `getWarrantyReport` | — | P3 |
