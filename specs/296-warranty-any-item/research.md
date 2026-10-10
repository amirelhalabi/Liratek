# Research: LIRA-296 — warranty for any item

The file:line references are as of 2026-10-10, HEAD `8aa19d59`, with the latest migration v204.
Each entry gives the decision, why it was chosen, and the alternatives considered.

## R0. What already exists (LIRA-143, v157)

- **Columns:**
  - `products.warranty_months`
  - `sale_items.warranty_until`, stamped for every completed line, unit-tracked or not (`SalesRepository.ts:848-855`)
  - `product_units` (IMEI units: `status IN_STOCK|SOLD`, `sale_item_id`, `is_defective`, `warranty_override_until`)
  - `product_categories.tracks_imei_units`
- **Warranty state:** `ProductUnitService.computeWarrantyStatus` (:68) gives COVERED, EXPIRED, VOID or NONE, with precedence OVERRIDE > REFUND > SALE > NONE.
- **Frontend helper:** `warrantyStatus.ts` (ignores overrides).
- **Receipt:** prints "Warranty until" (`receiptFormatter.ts:29`).
- **SaleDetailModal** already shows the warranty hint on **every** line that has `warranty_until` (:795-808), not only IMEI lines. So user story 2 is mostly done; what is left is the per-unit void for partly refunded lines (R5).

## R1. Receipt number (prerequisite for "find by receipt")

**Finding:** no receipt number is stored.
- Checkout prints `RCP-${Date.now()}` (`CheckoutModal.tsx:128`).
- A reprint prints `RCP-${sale.id}` (`SaleDetailModal.tsx:555`).

So the same sale carries two different numbers, and neither can be searched.

**Decision:** the receipt number is `RCP-<sale id>`, defined once (`receiptNumberFor(saleId)` in core, browser-safe).
- Checkout prints it from the id the sale returns.
- The search accepts `RCP-123`, `rcp123` or `123`.
- No migration is needed.

**Alternatives considered:** a stored, per-shop sequential counter column. Rejected: it adds a migration and a counter for no gain, since the sale id is already unique per database and short.

## R2. Warranty lookup (user story 1)

**Decision:** a new `WarrantyRepository` (core, tenant-scoped) with one method, `search(filters)`, over `sale_items` where `warranty_until IS NOT NULL`, joined to:
- `sales`;
- `clients` (name, phone) or, for walk-ins, the transaction's `client_name` / `client_phone` (same source as `getSaleWithCustomer`, `SalesRepository.ts:3888`);
- `products`;
- `product_units` (serial/IMEI).

The filters are `q` (name, phone, receipt number, product name/barcode, serial/IMEI), `from`/`to`, `status` and `limit`.

The result has one row per sale line, with:
- `quantity`, `refunded_quantity`, `covered_quantity`;
- `warranty_until` and `status`;
- the unit list when units are tracked.

The status is computed once, in a pure core helper `warrantyState(untilIso, todayIso, flags)`. That helper replaces both `computeWarrantyStatus` and the frontend `getWarrantyState` (rule 14), and `today` comes from the client (rule 27). In P2 the same search also returns repair warranties.

**Alternatives considered:**
- Extending `TransactionRepository.getRecent`. Rejected: it searches summaries, not lines.
- Reusing the unused `searchSalesSchema`. It is reused as a starting point only.

## R3. Category default and per-line edit (user story 3)

**Decision:**
- **Migration v205** adds `product_categories.warranty_months INTEGER NULL`.
- At sale time, the length resolves as `line override ?? products.warranty_months ?? category.warranty_months ?? null`. It is resolved in `SalesRepository` where `warranty_months` is read today (:683), joining the category by `products.category`.
- `sale_items` gets two new columns:
  - `warranty_months` (the length actually used, for audit);
  - `warranty_set_by` (a user id, only when staff changed it at the till).
- The sale item schema gains an optional `warranty_months` (0–60). **Rule 23:** a three-way key diff of the sale schema, the preload binding and the handler before adding it.

**Alternatives considered:** storing only the date. Rejected: then nothing records that staff changed the length.

## R4. Warranty terms on the receipt

**Decision:**
- A new setting `warranty_terms_text` (`system_settings`), edited in Settings → Shop Config.
- `receiptFormatter` and the service receipt (for repairs) print it below the items when at least one line has a warranty.
- It reaches the formatter through `useShopInfo`, alongside `shop_name`.

**Side finding (out of scope, filed separately):** `receipt_header_text` is saved but no formatter reads it.

## R5. Per-unit void on partly refunded lines

**Decision:** for a line with `refunded_quantity > 0`:
- `covered_quantity = quantity − refunded_quantity`;
- status is VOID only when everything was refunded;
- otherwise it shows "1 of 3 refunded".

For unit-tracked lines, the refunded units are the ones `_applySaleItemReversal` put back IN_STOCK; those are VOID, and the others are covered.

## R6. Claims, defective holding and Warranty cost (user story 4, P2) — owner decision D1, 2026-10-10

**Today:** every refund restocks unconditionally (`_restoreStock` `TransactionRepository.ts:7849`, `_applySaleItemReversal` `SalesRepository.ts:2758`). `product_units.status` can only be IN_STOCK or SOLD; `is_defective` is just a flag.

**Decision:**
- **`warranty_claims` table:** sale line or maintenance job, unit, action (REPAIR, REPLACE, REFUND), status, outcome, notes, user, and timestamps.
- **`defective_items` table:** product, unit, quantity, `unit_cost_usd`, claim, and status (HELD, SENT_TO_SUPPLIER, WRITTEN_OFF, RETURNED_TO_STOCK).
- **Refund claim:** calls the existing `refundSaleItem` with a new option `restock: false`. The reversal then skips `stock_quantity +=` and batch restore, and adds a `defective_items` HELD row at the line's FIFO cost. It also writes a **`WARRANTY_COST` transaction** with no payment legs and `profit_usd = −cost`. The sale's own profit reversal is unchanged.
- **Replace claim:** consumes one unit from stock with the existing FIFO `StockBatchRepository.consume`, using a new consumption owner `warranty_claim_id`.
  - For unit-tracked items, the replacement unit is marked SOLD with `warranty_claim_id` and `warranty_override_until` set to the original end date (D2).
  - It writes a `WARRANTY_COST` transaction for the replacement's cost.
  - The faulty item becomes a HELD defective item. The sale itself is untouched.
- **Repair claim:** creates a maintenance job with price 0 and `warranty_claim_id`.
  - When the job is delivered, its parts cost is booked as `WARRANTY_COST`, not as Maintenance profit.
  - The job's MAINTENANCE profit for warranty jobs is therefore 0. This uses ONE named predicate, `WARRANTY_JOB` (rule 14), which excludes these jobs from the Maintenance module totals.
- **Supplier outcome (P3):**
  - A credit writes a supplier `ADJUSTMENT` and a `WARRANTY_COST` transaction with `profit_usd = +credit`.
  - A replacement unit puts the item back IN_STOCK at its cost and writes a +cost `WARRANTY_COST` row.
  - "Not faulty" puts the item back to stock and writes a +cost row.
- **Profits:** a new by-module row WARRANTY ("Warranty cost", usually negative), summed from `WARRANTY_COST` transactions, plus a module detail list.
- **Reversal owner (rule 20):** `WARRANTY_COST` is a module-owned type, listed in `NON_REVERSIBLE_TRANSACTION_TYPES` for the generic path. `WarrantyClaimService.voidClaim` reverses everything the claim wrote: stock or consumption, the unit, the defective row, the maintenance job and the cost rows. A failing-first test proves it nets to zero across every ledger, per currency.
- **`is_auto` (rule 26):** `WARRANTY_COST` rows are system-written siblings of an operator action, so they are stamped `is_auto` from their `warranty_claim_id` link.

**Alternatives considered:**
- Booking warranty cost as an `EXPENSE`. Rejected: expenses move a drawer, and here no cash moves.
- A $0 "warranty sale". Rejected: it would show as a loss in Sales and need an exclusion predicate on every sales query.

## R7. Repair warranty (user story 5, P2)

**Decision:** `maintenance.warranty_months` and `maintenance.warranty_until`. The end date is stamped when the job reaches Delivered_Paid, using the client's day. It is printed by `buildServiceReceiptText` and included in the R2 search.

## R8. Serials for any category (user story 6, P3)

**Decision:**
- Reuse `product_units`. Its `imei` column holds any serial, so no rename and no table rebuild is needed.
- `product_categories` gains `serial_label` ('IMEI' or 'Serial', default derived from the phone category) and `serial_required` (block or warn at sale; D3).
- The UI labels follow `serial_label`.

**Alternatives considered:** a separate `serials` table. Rejected: it would duplicate all of LIRA-143's unit machinery.

## R9. Supplier returns (user story 7, P3)

**Decision:**
- A `supplier_returns` table: defective item, supplier (defaulted from the FIFO batch's `supplier_id` via `stock_batch_consumptions.sale_item_id`), status (SENT, CREDITED, REPLACED, REJECTED), amounts and dates.
- The outcomes post as in R6.
- The supplier ledger write uses `SupplierRepository.addLedgerEntry` ADJUSTMENT.

## R10. Report (user story 8, P3)

**Decision:** a warranty report page with two parts:
- items under warranty (the R2 search with status = COVERED, grouped by category);
- claims in a period (count by action, and gross cost, supplier recovered and net, from `WARRANTY_COST`).

It reuses the `@liratek/ui` DataTable and ExportBar.

## R11. Dual transport

**Decision:** every new read and write goes through three layers:
- **Core service and repository**, with a Zod schema in `packages/core/src/validators/warranty.ts` exported from both `index.ts` and `browser.ts` along with its Input types.
- **IPC:** a `warranty:*` handler using `requireRole` and `validatePayload`.
- **REST:** `/api/warranty` using `authenticateJWT`, then `requireRole`, then `validateRequest`.

Plus the `backendApi.ts` `ipcOrHttp` adapter, `ElectronApiAdapter.ts` and the `ApiAdapter` type.

Roles:
- search: admin and staff;
- repair claim: admin and staff;
- replace and refund claims: admin, the same as refunds today;
- void claim, supplier returns and report: admin.

## R12. Side findings — folded into P1 (owner decision 2026-10-10)

- **SF-1:** `GET /api/sales/today` (`sales.ts:83`) and `/api/dashboard/todays-sales` (`dashboard.ts:88`) ignore the `date` param that `backendApi.getTodaysSales` (:2122) sends.
  - **Decision:** both routes pass a validated `date` (YYYY-MM-DD) to `SalesRepository.getTodaysSales(limit, date)`, as IPC already does.
  - Test: web and IPC return the same rows for a past day.
- **SF-2:** `sales:get-by-date-range` has no REST route or adapter function.
  - **Decision:** `GET /api/sales/by-date-range?from&to` (admin and staff, same roles as IPC), calling `SalesService.findByDateRange`, plus a `backendApi.getSalesByDateRange` `ipcOrHttp` function, typed from a core schema (rule 21).
- **SF-3:** `receipt_header_text` is saved (`ShopConfig.tsx`) but no formatter reads it.
  - **Decision:** carry it through `useShopInfo` with `warranty_terms_text`. Print it under the shop name on the 58mm and 80mm sale receipts and on the service (repair) receipt, only when it is not empty.
