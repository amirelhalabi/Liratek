# Data model: LIRA-296

Every new table has `id`, `tenant_id`, `created_at` and `updated_at`, and is tenant-scoped (rule 5).
Each migration is mirrored in `electron-app/create_db.sql` with its ledger row (rule 10), and each
has a `down()`.

## P1 — migration v205 `warranty_category_default_and_line_audit`

| Table | Column | Type | Rule |
|---|---|---|---|
| `product_categories` | `warranty_months` | `INTEGER NULL` | Category default warranty in months; NULL means none. 0–60. |
| `sale_items` | `warranty_months` | `INTEGER NULL` | The length actually used for this line (resolved or edited); NULL means no warranty. |
| `sale_items` | `warranty_set_by` | `INTEGER NULL REFERENCES users(id)` | Set only when staff changed the length at the till. |

The length resolves as `line edit ?? products.warranty_months ?? category.warranty_months ?? NULL`.
`warranty_until` is unchanged: the sale day plus the resolved length, stamped on completed lines.

Setting `warranty_terms_text` (in `system_settings`): free text, at most 1,000 characters.

## P2 — migration v206 `warranty_claims_defective_items_repair_warranty`

### `warranty_claims`

| Column | Type | Rule |
|---|---|---|
| `sale_item_id` | `INTEGER NULL REFERENCES sale_items(id)` | Exactly one of `sale_item_id` and `maintenance_id` is set |
| `maintenance_id` | `INTEGER NULL REFERENCES maintenance(id)` | A claim on a repair warranty |
| `unit_id` | `INTEGER NULL REFERENCES product_units(id)` | The tracked unit being claimed |
| `quantity` | `INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1)` | One unit per claim (owner decision 2026-10-10); kept as a column so reports can sum it |
| `action` | `TEXT CHECK IN ('REPAIR','REPLACE','REFUND')` | |
| `status` | `TEXT CHECK IN ('OPEN','DONE','VOIDED')` | REPAIR stays OPEN until its job is delivered |
| `override_reason` | `TEXT NULL` | Required when the warranty was not COVERED; admin only |
| `notes` | `TEXT NULL` | |
| `user_id` | `INTEGER NOT NULL` | The staff member who started the claim |
| `repair_job_id` | `INTEGER NULL REFERENCES maintenance(id)` | Set for REPAIR |
| `replacement_unit_id` | `INTEGER NULL REFERENCES product_units(id)` | Set for REPLACE when the item is unit-tracked |
| `voided_at` | `TEXT NULL` | |

### `defective_items`

| Column | Type | Rule |
|---|---|---|
| `product_id` | `INTEGER NOT NULL` | |
| `unit_id` | `INTEGER NULL` | |
| `quantity` | `INTEGER NOT NULL` | |
| `unit_cost_usd` | `REAL NOT NULL` | The FIFO cost of the sold unit |
| `warranty_claim_id` | `INTEGER NOT NULL` | |
| `status` | `TEXT CHECK IN ('HELD','SENT_TO_SUPPLIER','WRITTEN_OFF','RETURNED_TO_STOCK')` | Starts HELD |

### Other P2 changes

- **`maintenance`:** adds `warranty_months INTEGER NULL`, `warranty_until TEXT NULL` and `warranty_claim_id INTEGER NULL` (a job opened by a claim; price 0).
- **`stock_batch_consumptions`:** adds `warranty_claim_id INTEGER NULL`, the consumption owner for a replacement unit.
- **`product_units`:** adds `warranty_claim_id INTEGER NULL`, set on a replacement unit given under a claim. The unit is SOLD and `warranty_override_until` is the original end date (D2).
- **New transaction type `WARRANTY_COST`:**
  - It has no payment legs and no drawer effect.
  - Its `profit_usd` is negative for costs and positive for recoveries.
  - It carries `metadata_json.is_auto = true`, derived from its `warranty_claim_id` link (rule 26).
  - It is listed in `NON_REVERSIBLE_TRANSACTION_TYPES`; it is reversed only by `voidClaim` (rule 20).

### Invariants

1. A unit may have at most one open (OPEN) claim. A claim covers exactly one unit; a line's open + done claims never exceed its covered quantity.
2. A REFUND claim never restocks; its item becomes a `defective_items` HELD row.
3. Voiding a claim brings stock, units, `defective_items`, the maintenance job, drawers, customer and supplier balances, and profit back to zero, per currency.
4. A warranty repair job's parts cost appears only in WARRANTY, never in MAINTENANCE profit. The exclusion uses one named fragment, `WARRANTY_JOB`.

## P3 — migration v207 `serial_categories_supplier_returns`

- **`product_categories`:**
  - `serial_label TEXT NOT NULL DEFAULT 'Serial'`, back-filled to `'IMEI'` where `tracks_imei_units = 1`;
  - `serial_required TEXT CHECK IN ('BLOCK','WARN') DEFAULT 'BLOCK'`.
- **`supplier_returns`** table:
  - `defective_item_id`, `supplier_id`;
  - `status`: SENT, CREDITED, REPLACED or REJECTED;
  - `credit_usd`, `credit_lbp`, `sent_at`, `closed_at`, `notes`.
  - **CREDITED** writes a supplier ledger ADJUSTMENT and a +credit `WARRANTY_COST` row.
  - **REPLACED** puts a unit IN_STOCK at its cost and writes a +cost row.
  - **REJECTED** writes nothing.

## Views and types (core, browser-safe)

- **`WarrantyState`:** `'COVERED' | 'EXPIRED' | 'VOID' | 'NONE'`, computed by `warrantyState(untilIso, todayIso, { overrideUntil?, fullyRefunded })`. This one helper replaces `computeWarrantyStatus` and the frontend `getWarrantyState`.
- **`WarrantySearchRow`:**
  - `source`: `'SALE' | 'REPAIR'`
  - `saleId`, `receiptNumber`, `saleItemId?`, `maintenanceId?`
  - `soldAt`
  - `customer` (name and phone, both nullable)
  - `product` (id and name)
  - `quantity`, `refundedQuantity`, `coveredQuantity`
  - `units` (id, serial and state, per unit)
  - `warrantyUntil`, `state`, `openClaimId?`
- **`receiptNumberFor(saleId)`** returns `RCP-<id>`; `parseReceiptNumber(input)` returns the id or null.
