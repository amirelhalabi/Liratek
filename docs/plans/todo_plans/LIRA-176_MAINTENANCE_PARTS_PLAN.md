# LIRA-176 — Maintenance Parts, Parts Profit, and Job Detail Panel

**Status:** PLANNED — not implemented. Awaiting owner approval of this document.
**Author:** Fable 5.1 orchestrator, 2026-09-07.
**Owner decisions:** captured in §1 (interview held 2026-09-06/07, all four rounds answered).
**Ticket:** LIRA-176. Migrations reserved: **v170** (parts) and **v171** (status history) — verified as the next free versions (last entry in `packages/core/src/db/migrations/index.ts` is v166 at line 10271).
**Renumber note (2026-09-08):** originally reserved as v167/v168; a parallel-session commit (`a83d99d8`) landed migration v169 while these two were still uncommitted and, in doing so, wiped them from `migrations/index.ts` (the file it committed was byte-identical to HEAD). Reinstated as v170/v171 rather than v167/v168 because the migration runner selects pending work by version against the database's current version — any database that already reached v169 would skip v167/v168 permanently. All references below are updated to the new numbers.

---

## 0. One-paragraph summary

A maintenance job may consume inventory items. Each attached part draws stock the moment the
job is saved, snapshots its cost and price, adds its price to what the customer is charged,
and adds its margin to the profit stamped on the `MAINTENANCE` transaction. Labour cost and
labour price keep their current meaning and are never mixed with parts. Every ledger row the
feature writes — the stock draw-down and its FIFO batch consumption — gets a named reversal
owner (rule 20). The maintenance page gains a part picker, a per-job parts summary in the jobs
list, a read-only status timeline, and a cancel-edit control.

---

## 1. Owner decisions (locked)

| #   | Question                       | Decision                                                                                                                                                                   |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | When does stock decrement?     | **On save/attach**, at any status. Removing a part or voiding the job restores it.                                                                                         |
| D2  | Discount scope                 | **Labour only.** Part margins stay exactly `price − cost`.                                                                                                                 |
| D3  | Part price override            | **Editable, product `selling_price_usd` pre-filled.** Snapshot stored either way.                                                                                          |
| D4  | Which items can be picked      | **Default to the `Parts` category, with a toggle to search all categories.**                                                                                               |
| D5  | LBP jobs                       | **Option 4 - no conversion.** Parts stay in USD; a pound-priced job with parts bills in both currencies. Decided 2026-09-07, superseding the earlier float-at-rate answer. |
| D6  | Status timeline                | **Yes, in this ticket.** New `maintenance_status_history` table.                                                                                                           |
| D7  | Refund/void stock              | **Always restore.** Damaged parts are corrected by a manual stock adjustment.                                                                                              |
| D8  | Profit visibility in the panel | **Admins only.**                                                                                                                                                           |
| D9  | Profits page                   | **One Maintenance row, detail splits labour margin from parts margin.**                                                                                                    |
| D10 | Click behaviour                | **Unchanged** — a row click still loads the job into the left form. Parts summary goes on the row; the parts editor and a read-only timeline live under the form.          |
| D11 | Cancel edit                    | **New X in the top right of the form.** Exits Edit Job, or clears a New Repair Job. Confirms only when fields are non-empty.                                               |
| D12 | Post-refund editability        | **Parts unlock together with the amounts**, mirroring lira-130.                                                                                                            |
| D13 | Cost snapshot                  | **Attach time.**                                                                                                                                                           |
| D14 | Receipt                        | **Itemised** — labour line plus one line per part.                                                                                                                         |

---

## 2. What exists today (verified, with citations)

- The table is `maintenance` (not `maintenance_jobs`), `electron-app/create_db.sql:561-588`. Columns of
  interest: `cost_usd/lbp`, `price_usd/lbp`, `discount_usd` (USD only — there is no `discount_lbp`),
  `final_amount_usd/lbp`, `currency`, `exchange_rate`, `status`, `is_refunded`.
- Statuses: validator enum `Received | In_Progress | Ready | Delivered | Delivered_Paid`
  (`packages/core/src/validators/maintenance.ts:36-38`), plus repository-only `Deleted`/`Voided`.
- Profit is computed **once**, in `MaintenanceService.saveJob` as `final_amount − cost` in the job's
  currency (`packages/core/src/services/MaintenanceService.ts:119-121`), and stamped by
  `MaintenanceRepository.processPayments` onto the `MAINTENANCE` transaction
  (`packages/core/src/repositories/MaintenanceRepository.ts:370-388`). It is never recomputed from
  the job row afterwards — which is precisely why the amount lock exists.
- Amount lock: `isJobMoneyLocked` = has an ACTIVE transaction **and** `!is_refunded`
  (`MaintenanceRepository.ts:70-77`), enforced over `MAINTENANCE_AMOUNT_FIELDS`
  (`MaintenanceRepository.ts:89-99`), mirrored in the frontend as `isAmountLocked`
  (`frontend/src/features/maintenance/pages/Maintenance/index.tsx:485`).
- A `Parts` category is already seeded (`electron-app/create_db.sql:282-288`).
- Products carry USD prices only: `cost_price_usd`, `selling_price_usd` (`create_db.sql:249-250`).
  **There are no LBP price columns on products.** This is the reason for D5.
- Stock has two layers: the scalar `products.stock_quantity`, and the FIFO costing ledger
  `product_stock_batches` / `stock_batch_consumptions` (`create_db.sql:1383-1399`). A consumption row
  is owned by exactly one source, currently `sale_item_id` **or** `custom_service_id`
  (`StockBatchRepository.ts:104`).
- The closest existing precedent is `custom_services.product_id` (migration v152), which decrements
  exactly one unit on completion (`CustomServiceRepository.ts:188-241`) and is restored by
  `TransactionRepository._restoreCustomServiceStock` from **both** the void path (line 1492-1494) and
  the refund path (line 1734-1736). Maintenance needs quantity and multiple lines, so the shape is a
  child table rather than a nullable column.
- The service receipt is built entirely from the **persisted transaction and its `metadata_json`**
  (`frontend/src/shared/utils/serviceReceipt.ts:1-18`), never from live form state. Itemising parts on
  the receipt therefore means putting the breakdown into `metadata_json`, not adding an IPC call.
- Product listing is already dual-transport with a server-side category filter:
  `getProducts(search, { categories })` in `frontend/src/api/backendApi.ts:279-310`.

### 2.1 Two pre-existing defects this work must not inherit

1. **`createJob` defaults `status` to `"In Progress"` with a space** (`MaintenanceRepository.ts:214`),
   and `MaintenanceService` repeats the same literal (line 108). Neither matches the `In_Progress`
   enum, so such a row would never match a status tab. It is currently dead code because the
   validator supplies `.default("Received")` on every validated path. Fix both literals to
   `"Received"` while we are in these files, and add a jest guard.
2. **`handleStatusTransition` clobbers the discount**
   (`frontend/src/features/maintenance/pages/Maintenance/index.tsx:265-266`): it resends
   `final_amount_usd: job.price_usd`, discarding any stored discount. With parts in play this would
   also discard the parts total, so it must be fixed as part of this ticket — see §6.3.

---

## 3. Money model

**This section was rewritten on 2026-09-07 when the owner chose option 4 (no conversion).** The
earlier draft converted USD parts into the job's currency at a floating rate and needed a four-column
denormalisation plus an injected rate provider. None of that survives. Option 4 turned out to be
_less_ backend work, not more, because the parts figures never leave USD.

### 3.1 The one rule

> `final_amount_<currency>` means **what the customer owes in that currency**, and both columns may
> be non-zero at once.

Today exactly one of the pair is ever populated, because `buildPricing` zeroes the currency the job
is not priced in. That invariant is retired. Labour is owed in the job's currency; parts are always
owed in USD, because that is the only currency a product has a price in.

### 3.2 Column meanings after this change

| Column                    | Meaning                                                                     | Changed?              |
| ------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `cost_usd` / `cost_lbp`   | **Labour cost only**                                                        | unchanged             |
| `price_usd` / `price_lbp` | **Labour price only**                                                       | unchanged             |
| `discount_usd`            | Discount on labour only (D2)                                                | unchanged             |
| `parts_cost_usd`          | Denormalised parts cost, **always USD**                                     | NEW                   |
| `parts_price_usd`         | Denormalised parts price, **always USD**                                    | NEW                   |
| `final_amount_usd`        | Owed in USD = parts price, **plus** labour final when the job is USD-priced | meaning widened       |
| `final_amount_lbp`        | Owed in LBP = labour final when the job is LBP-priced, else 0               | unchanged in practice |

Only **two** new columns, not four. Historical rows get `0` in both, so every existing job behaves
exactly as before, and no money backfill is performed.

### 3.3 The derived quantities

```
labourFinal  = labour price − labour discount          [job currency]
labourMargin = labourFinal − labour cost               [job currency]
partsPrice   = SUM(quantity × unit_price_usd)          [USD]
partsCost    = SUM(quantity × unit_cost_usd)           [USD]
partsMargin  = partsPrice − partsCost                  [USD]
```

Stored on the job row:

```
final_amount_usd = partsPrice + (job is USD ? labourFinal : 0)
final_amount_lbp =              (job is LBP ? labourFinal : 0)
parts_price_usd  = partsPrice
parts_cost_usd   = partsCost
```

Stamped on the `MAINTENANCE` transaction by `processPayments`:

```
amount_usd = partsPrice   + (job is USD ? labourFinal  : 0)
amount_lbp =                (job is LBP ? labourFinal  : 0)
profit_usd = partsMargin  + (job is USD ? labourMargin : 0) + keptChangeUsd
profit_lbp =                (job is LBP ? labourMargin : 0) + keptChangeLbp
```

Parts always land in the USD buckets. There is no rate anywhere in this section, and
`MaintenanceService` needs **no** injected rate provider — that item is struck from the plan.

The labour-versus-parts split the Profits detail needs (D9) reads straight off stored columns:
`partsMargin = parts_price_usd − parts_cost_usd`, and labour margin is whatever is left.

### 3.4 The discount reconstruction still works

`computeFinalAmount` rebuilds an LBP job's discount as `price_lbp − final_amount_lbp`
(`frontend/src/features/maintenance/pages/Maintenance/index.tsx:296-311`). Because the discount is
labour-only (D2) and labour is the only thing in `final_amount_lbp`, that reconstruction is
**unaffected** by parts. Verified by inspection; it must also be asserted by a test, because it is
the kind of thing a later refactor quietly breaks.

### 3.5 Partial payment and debt

The residual keeps today's single-blended-number behaviour rather than growing a per-currency debt.
Total owed in USD-equivalent is `partsPrice + (isLbp ? labourFinal / rate : labourFinal)`; total paid
is `paidUsd + paidLbp / rate`, using the checkout rate already on the payload. The shortfall books as
one `Maintenance Debt` charge in the job's currency, exactly as it does now.

This is a deliberate simplification and it is the right one: the payment sheet already nets across
currencies on its own side, so splitting the residual into two ledger charges would create a debt the
customer never perceived as two debts. **No new debt transaction type is introduced**, so the
existing `MODULE_DEBT_TRANSACTION_TYPES` reversal owner keeps working untouched (rule 20).

### 3.6 Profits page (D9)

Revenue needs **no change at all**. `revenue_usd` already sums `final_amount_usd`, which now carries
the parts for both job types, and `revenue_lbp` already sums `final_amount_lbp`, which stays
labour-only. This falls out of the §3.1 rule and is the main reason option 4 is cheap.

Cost needs one named fragment, USD side only. Add next to `maintenanceCompleted` in
`packages/core/src/repositories/ProfitRepository.ts`:

```ts
/** Total maintenance USD cost = labour USD cost + parts cost. ONE definition (rule 14). */
export function maintenanceCostUsd(alias: string): string {
  return `(${alias}.cost_usd + ${alias}.parts_cost_usd)`;
}
```

`cost_lbp` is untouched — parts never contribute to it.

Call sites to update, none of which may hand-roll the expression:

- `ProfitRepository.getMaintenanceTotals` — `ProfitRepository.ts:1751-1776`
- the `daily_maint` CTE — `ProfitRepository.ts:2405-2422`
- `ClosingRepository` — **`ClosingRepository.ts:1226` and `1238`**, see the warning below.

The Maintenance row's detail split adds `parts_revenue_usd` and `parts_cost_usd` to `MaintTotalsRow`
in the first two queries, surfaced by `ProfitService` on the existing `MAINTENANCE` module row.

> ⚠ **`ClosingRepository` is a correctness blocker, not a tidy-up.** Both queries hand-roll the
> profit formula inline as `COALESCE(SUM(final_amount_usd - cost_usd), 0)`, a second copy of a
> fragment that should exist once. The moment `final_amount_usd` starts carrying parts price while
> `cost_usd` still means labour cost only, **the daily closing snapshot overstates maintenance profit
> by exactly the parts cost.** Both lines must become
> `SUM(final_amount_usd - ${maintenanceCostUsd("maintenance")})` in the same commit as the schema
> change, and the netting test of §8.1 must cover the closing snapshot, not just the Profits page.
> Separately and pre-existing: both queries read USD columns only, so LBP maintenance labour profit
> has never appeared in a closing snapshot. Out of scope here, noted so it is not mistaken for
> something this ticket introduced.

### 3.7 Reversal-symmetry matrix (rule 20 — mandatory)

| Row written                                   | Written by                                                 | Reversal owner                                                      |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `maintenance_parts` line                      | `MaintenanceRepository.syncParts`                          | line removal in `syncParts`; job delete; void; refund               |
| `products.stock_quantity -= qty`              | `syncParts`                                                | `syncParts` delta on edit; `_restoreJobParts` on delete/void/refund |
| `stock_batch_consumptions` row                | `StockBatchRepository.consume(..., { maintenancePartId })` | `StockBatchRepository.restoreForMaintenancePart`                    |
| `transactions` profit stamp (both currencies) | `processPayments`                                          | the existing generic REFUND/VOID negation                           |
| `debt_ledger` `Maintenance Debt`              | `bookClientDebtCharge`, residual now spans parts           | already owned by `_cancelDebt` via `MODULE_DEBT_TRANSACTION_TYPES`  |

Double-restore protection: `maintenance_parts.stock_restored` (0/1). Every restore path filters on
`stock_restored = 0` and sets it to 1, exactly as `stock_batch_consumptions.is_restored` already
works. This is what makes "refund, then edit the parts of the refunded job" (D12) safe.

**Verification requirement:** create-then-reverse must net to **0** on `products.stock_quantity`,
`product_stock_batches.quantity_remaining`, every drawer, and profit **per currency** — the
per-currency part matters more under option 4, because a single job now stamps both.

---

## 4. Database

### 4.1 Migration v170 — `maintenance_parts_and_stock_link`

```sql
CREATE TABLE IF NOT EXISTS maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  -- Snapshot so a renamed / deactivated product still prints correctly.
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  -- USD only, always. Under option 4 (§3.1) parts are never converted, so
  -- there is no job-currency twin of these anywhere in the schema.
  unit_cost_usd  DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Idempotency guard for the reversal owners in plan §3.7.
  stock_restored INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_maintenance_parts_tenant_job
  ON maintenance_parts(tenant_id, maintenance_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_parts_tenant_product
  ON maintenance_parts(tenant_id, product_id);

-- Two columns, not four: parts never leave USD (§3.1).
ALTER TABLE maintenance ADD COLUMN parts_cost_usd  DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE maintenance ADD COLUMN parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE stock_batch_consumptions ADD COLUMN maintenance_part_id INTEGER
  REFERENCES maintenance_parts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_batch_consumptions_tenant_maint_part
  ON stock_batch_consumptions(tenant_id, maintenance_part_id);
```

Each `ALTER` is guarded by a `PRAGMA table_info` check, matching the v152 template.

**`reason` stays `'SERVICE'`.** SQLite cannot alter a `CHECK` constraint without rebuilding the table,
and `stock_batch_consumptions.reason` is constrained to `('SALE','ADJUSTMENT','SERVICE')`
(`create_db.sql:1392`). A maintenance part is a service consumption; introducing a `'MAINTENANCE'`
value would force a full table rebuild for zero reporting benefit, since `maintenance_part_id` already
identifies the source unambiguously. This is a deliberate decision, recorded here so it is not
"fixed" later.

`down()`: drop the index and table, drop the two `maintenance` columns and the consumption column
(SQLite 3.35+ `DROP COLUMN`, same as v152's down).

### 4.2 Migration v171 — `maintenance_status_history`

```sql
CREATE TABLE IF NOT EXISTS maintenance_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  from_status TEXT,            -- NULL on the creation row
  to_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_maintenance_status_history_tenant_job
  ON maintenance_status_history(tenant_id, maintenance_id, id);
```

`up()` backfills one row per existing job — `from_status` NULL, `to_status` = the job's current
status, `created_at` = the job's `created_at` — so no existing job shows an empty timeline.

### 4.3 `create_db.sql` (rule 10)

Both tables, all indexes, the four `maintenance` columns, and the `stock_batch_consumptions` column
must be added to `electron-app/create_db.sql` in the same commit as the migrations. A fresh database
and a migrated database must produce identical schemas.

### 4.4 Test schemas

Per the recorded lesson on test schemas silently voiding whole files: every in-memory schema used by
core and backend jest that inserts into `maintenance`, `products`, or `stock_batch_consumptions` must
gain the new tables and columns. Sweep exhaustively with
`grep -rln "CREATE TABLE.*maintenance" packages/core/src backend/src` before declaring the phase done.

---

## 5. Backend (`packages/core`)

### 5.1 `MaintenanceRepository`

New types:

```ts
export interface MaintenancePartInput {
  id?: number; // present when editing an existing line
  product_id: number;
  quantity: number;
  unit_price_usd?: number; // omitted -> product's selling_price_usd (D3)
}

export interface MaintenancePartRow {
  id: number;
  maintenance_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost_usd: number;
  unit_price_usd: number;
  stock_restored: number;
  created_at: string;
  updated_at: string;
}
```

New methods:

- **`getParts(jobId): MaintenancePartRow[]`**
- **`getPartsForJobs(jobIds: number[]): Map<number, MaintenancePartRow[]>`** — ONE query with an
  `IN (...)` list, so the jobs list never issues N+1.
- **`syncParts(jobId, parts: MaintenancePartInput[], opts): void`** — the single mutation entry point.
  - **`parts === undefined` means "leave unchanged".** Only an explicit array reconciles. This is
    load-bearing: the status-transition resave and any partial update must not wipe the parts list.
  - Reconciles stored rows against the incoming array: matched line whose quantity rose draws the
    delta; quantity fell restores the delta; a line absent from the incoming array is deleted and
    fully restored; a new line draws its full quantity.
  - Draw uses the exact `SalesRepository` / `CustomServiceRepository` guard verbatim:
    `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?`,
    and a `BusinessRuleError` naming the product and its available quantity when `changes === 0`.
    `allowOutOfStock` drops the `>=` clause, same escape hatch as the other two.
  - Draw also calls `getStockBatchRepository().consume(product_id, qty, { reason: 'SERVICE',
fallbackUnitCostUsd: product.cost_price_usd, maintenancePartId })`.
  - `unit_cost_usd` snapshot = the weighted FIFO cost returned by `consume` when it covered the draw,
    else the product's `cost_price_usd`. This is the one place maintenance differs from custom
    services, which discard the FIFO cost because they have no cost column to fill. Here we do.
  - Recomputes and writes the two denormalised `maintenance.parts_*` columns as plain USD sums over
    the job's part rows. **No rate is consulted and none is passed in** — under option 4 parts never
    leave USD (§3.1).
  - Rejects any change when `isJobMoneyLocked(existing, jobId)` is true, with a message parallel to
    `MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR`.
- **`_restoreJobParts(jobId): void`** — restores every `stock_restored = 0` line: bumps
  `products.stock_quantity`, calls `StockBatchRepository.restoreForMaintenancePart(partId)`, sets
  `stock_restored = 1`. Idempotent by construction. Called by `deleteJob` and by the two
  `TransactionRepository` reversal sites.
- **`recordStatusChange(jobId, fromStatus, toStatus, userId, note?)`** and
  **`getStatusHistory(jobId)`**.

Changes to existing methods:

- `getColumns()` gains the four `parts_*` columns.
- `MAINTENANCE_AMOUNT_FIELDS` gains the four `parts_*` columns, so the existing lock covers them
  with no new predicate.
- `createJob` / `updateJob` write the `parts_*` columns; the `"In Progress"` literal becomes
  `"Received"` (§2.1).
- `createJob` writes the initial status-history row; `updateJob` writes one whenever the status
  actually changes.
- `deleteJob` calls `_restoreJobParts(id)` before flipping the status to `Deleted`.
- `processPayments` adds a `parts` array to `metadata_json` — `[{ name, quantity, unit_price_usd }]`,
  **price only, never cost** — which is what the itemised receipt (D14) reads. It also appends a
  `— N part(s)` fragment to the summary when parts exist.

### 5.2 `StockBatchRepository`

- `ConsumptionOwnerColumn` gains `"maintenance_part_id"` (line 104).
- `consume`'s `opts` gains `maintenancePartId?: number | null`, persisted on the consumption row.
- New public `restoreForMaintenancePart(partId, quantity?)`, a two-line delegation to the existing
  private `_restoreConsumptions` — the FIFO walk is not duplicated (rule 14).

### 5.3 `TransactionRepository`

Add `_restoreMaintenancePartsStock(maintenanceId)`, a sibling of `_restoreCustomServiceStock`, which
delegates to `MaintenanceRepository._restoreJobParts`. Call it from **both** reversal paths, beside
the existing custom-service calls:

- `voidTransaction`, next to line 1492-1494
- `_refundTransactionInternal`, next to line 1734-1736

Guarded on `original.source_table === "maintenance" && original.source_id`. Placing it here rather
than in `MaintenanceService` is deliberate and matches the custom-service precedent: a maintenance
job voided directly from the Transactions page bypasses the maintenance module entirely and must
still return its parts.

**To verify during implementation:** confirm that the generic REFUND path negates the **full** profit
stamp for a non-sale source table. The sale path pro-rates by refunded quantity
(`TransactionRepository.ts:1482`); maintenance has no partial refund, so the full negation is
expected — but this must be asserted, not assumed, in the netting test.

### 5.4 `MaintenanceService`

- **No rate provider and no constructor change.** The earlier draft injected one; option 4 removes
  the need entirely.
- `SaveJobParams` gains `parts?: MaintenancePartInput[]` and `allowOutOfStock?: boolean`.
- Inside the existing `withTransaction`, in this order:
  1. create or update the job row,
  2. call `repo.syncParts(...)` — **before** the totals are computed, so the denormalised columns
     are current,
  3. re-read `parts_price_usd` / `parts_cost_usd` and compute the four stamped figures per §3.3,
  4. `processPayments`, which now takes `partsPriceUsd` and `partsMarginUsd` alongside the existing
     job-currency `finalAmount` / `profit`, and applies the amount/profit shape of §3.3. This is the
     one genuinely new behaviour in the repository: a MAINTENANCE transaction may now be
     two-currency, where before exactly one side was always zero.
- The `"In Progress"` literal at line 108 becomes `"Received"`.
- A stock shortfall must abort the whole save. It already will: `syncParts` throws inside
  `withTransaction`, which rolls back the job row too.

### 5.5 Validators — `packages/core/src/validators/maintenance.ts`

```ts
const maintenancePartSchema = z.object({
  id: positiveIntegerSchema.optional(),
  product_id: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
  unit_price_usd: z.number().min(0).optional(),
});
```

Added to `saveMaintenanceJobSchema` as `parts: z.array(maintenancePartSchema).optional()`. **It must
stay `.optional()` with no `.default([])`** — a default would turn every legacy payload into "delete
all parts". A comment saying exactly that goes on the line.

New `getMaintenanceStatusHistorySchema = z.object({ id: positiveIntegerSchema })`.

Both are re-exported from `electron-app/schemas/index.ts` with the zod-major cast, and imported
directly by `backend/`.

---

## 6. Transports and frontend

### 6.1 IPC — `electron-app/handlers/maintenanceHandlers.ts`

- `maintenance:save` — no new channel; the existing handler passes `parts` through. Its preload
  binding's `data` parameter type must list `parts` (rule 12).
- `maintenance:getStatusHistory` — new, `requireRole` matching the existing read channels,
  `validatePayload(getMaintenanceStatusHistorySchema)`, returns `{ success, data }`.
- `maintenance:getJobs` already returns the rows; the repository now attaches `parts` to each
  (§5.1 `getPartsForJobs`), so no channel change.

Register any new handler in `main.ts` and add the type to `frontend/src/types/electron.d.ts`.

### 6.2 REST — `backend/src/api/maintenance.ts` (rule 19)

- `POST /api/maintenance/jobs` — same shared schema, so `parts` validates for free. Confirm the route
  forwards `parts` into the service call and does not enumerate fields by hand.
- `GET /api/maintenance/jobs/:id/history` — new, `authenticateJWT` then `requireRole` matching the IPC
  channel, IPC-identical envelope, HTTP 200 even on failure. Mounted **after** any static path.

### 6.3 Adapter — `frontend/src/api/backendApi.ts`

- `saveMaintenanceJob` — pass `parts` through on both transports.
- `getMaintenanceStatusHistory(jobId)` — new dual-mode fn via `ipcOrHttp`; reads return the RAW array.
- Expose on `ElectronApiAdapter.ts`; type in `packages/ui/src/api/types.ts`.
- The part picker reuses the existing `getProducts(search, { categories: ["Parts"] })` — no new
  inventory endpoint is needed.

### 6.4 Maintenance page

**Extract a single payload builder.** Today the page builds a save payload in three places —
`handleSaveDraft`, `handleCheckoutComplete`, and `handleStatusTransition` — and the third one
computes `final_amount` differently, which is the discount-clobber defect of §2.1. Extract
`buildJobPayload({ status, parts, clientOverride, checkout })` and route all three through it
(rule 14). This is what makes the parts total and the discount correct on a status transition, and
it is a prerequisite for the rest of the UI work, not an optional cleanup.

`handleStatusTransition` passes `parts: undefined` so the transition is a pure status change.

**Part picker** (new component `components/PartPicker.tsx`): a searchable list of products, defaulting
to the `Parts` category with an "all categories" toggle (D4). Each row shows name, stock on hand, and
`selling_price_usd`. Adding a part appends a line with a quantity stepper and an editable price that
pre-fills from the product (D3). Out-of-stock products are shown, visually flagged, and selectable —
the backend guard is the authority, and the user sees its error message on save.

**Totals block** under the labour fields, live. On a USD job it reads Labour, Parts, Total, all in
dollars. On an LBP job it reads Labour in pounds, Parts in dollars, and a two-line Due — the shape
the customer will actually be billed (§3.1). It never converts and never shows a rate.

```
USD job                         LBP job
Labour          $30.00          Labour        500,000 LBP
Parts           $20.00          Parts              $20.00
Total           $50.00          Due           500,000 LBP + $20.00
```

**Checkout, the one genuinely new piece of UI work.** `CheckoutModal` currently hardcodes a single
total: `totals={[{ amount: finalAmount, currency: totalCurrency }]}`
(`frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx:982`). The payment engine
underneath it already speaks per-currency natively — `MultiPaymentInputProps.totals?: Money[]`,
documented as "each entry is what is owed in that currency NATIVELY; a rate is only ever consulted
when a payment crosses currencies" (`packages/ui/src/components/ui/MultiPaymentInput.tsx:56-62`) —
and `SessionCheckoutModal.tsx:971-978` **already passes a two-entry USD+LBP array in production**.
So the engine, the change/return legs, the keep-change toggle, and the cross-currency netting all
work as-is.

The work is confined to `CheckoutModal`:

- Accept an optional `extraTotals?: Money[]` prop, merged into the array it builds. Absent on every
  existing caller, so POS and every other module are untouched.
- The subtotal/total rows (`lines 885-914`) render each currency on its own line when more than one
  is owed. The existing single-currency path must be byte-identical when `extraTotals` is empty.
- `discount` and `maxDiscount` stay scoped to `totalCurrency`, which is correct under D2: the
  discount is a labour discount and labour is single-currency.
- `onComplete` already emits `payments`, `change_given_*` and `exchange_rate`; it gains
  `parts_price_usd` so the caller does not have to recompute it.

Maintenance passes `extraTotals={[{ amount: partsPriceUsd, currency: "USD" }]}` when the job is
LBP-priced and there are parts. A USD job passes nothing and behaves exactly as today.

**Jobs list rows** gain one summary line — `Screen ×1, Battery ×1 · $45` — and show the grand total
rather than the labour price. Click behaviour is unchanged (D10).

**Status timeline**: read-only, rendered under the form for the loaded job, fetched lazily by
`getMaintenanceStatusHistory` when a job is loaded.

**Profit block**: labour margin, parts margin, total. Rendered only when the current user is an admin
(D8), using the app's existing role hook — not a raw role-string comparison.

**Cancel X** in the top right of the form (D11): exits Edit Job or clears a New Repair Job, with a
confirm only when at least one field is non-empty. It reuses the existing `handleNewJob` reset and
must also clear the parts draft.

**Lock**: `isAmountLocked` already mirrors the backend predicate; the parts editor becomes read-only
under the same flag, and unlocks after a refund (D12) because `isRefundedOrVoided` already feeds it.

**Session basket**: `handleCheckoutComplete` pushes `formData: jobData` into the session cart, so
`parts` rides along automatically once it is in the payload builder. Stock is drawn when the basket
replays `maintenance:save` at session checkout — consistent with D1, because the job row does not
exist before that point. Add an assertion for this in the session e2e spec.

### 6.5 Receipt (D14)

`serviceReceipt.ts` reads `metadata.parts` (written in §5.1) and prints one line per part between the
service line and the amount, as `name ×qty` with the line price. Cost and margin are never printed —
the builder's existing contract. Falls back silently to today's output when `parts` is absent, which
keeps every historical receipt byte-identical.

---

## 7. Implementation phases

Each phase ends with a reviewed diff and a commit. Per the standing check cadence, **no test, e2e,
typecheck, lint, or format run happens between phases** — the full gate runs once, after Phase 7.

| Phase | Scope                                                                                                                          | Agent                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 1     | Migrations v170 + v171, `create_db.sql`, all test schemas                                                                      | `database`                 |
| 2     | `StockBatchRepository` owner column + `restoreForMaintenancePart`                                                              | `backend`                  |
| 3     | `MaintenanceRepository`: parts CRUD, `syncParts`, `_restoreJobParts`, status history, lock fields, metadata                    | `backend`                  |
| 4     | `MaintenanceService` totals + rate injection; `TransactionRepository` reversal hooks; validators                               | `backend`                  |
| 5     | `ProfitRepository` USD cost fragment at all three call sites; `ClosingRepository` (blocker, §3.6); `ProfitService` parts split | `backend`                  |
| 6     | IPC handler, preload, `electron.d.ts`, REST route, adapter, `ApiAdapter` type                                                  | `electron` then `frontend` |
| 7     | Maintenance page: payload builder extraction, PartPicker, totals, row summary, timeline, profit block, cancel X; receipt       | `frontend`                 |
| 8     | Tests (§8)                                                                                                                     | `backend` + `frontend`     |

Phases 2 and 5 are independent of each other and may run in parallel once Phase 1 lands.

---

## 8. Tests

### 8.1 Failing-first proofs (rule 17 — mandatory, each must be shown to fail on pre-fix code)

1. **Stock netting.** Create a job with two parts, deliver and pay it, then refund. Assert
   `products.stock_quantity`, `product_stock_batches.quantity_remaining`, every drawer, and profit per
   currency all net to exactly their pre-job values.
2. **No double restore.** Refund the job, then delete it. Stock must move once, not twice.
3. **`parts: undefined` is not "delete all".** Save a job with parts, then resend the payload a status
   transition produces (no `parts` key). The parts must survive and stock must not move.
4. **Profit includes parts margin.** A job with labour 10→25 and one part costing 4 priced 9 stamps
   profit 20, not 15.
5. **Amount lock covers parts.** Editing the parts list of a paid, unrefunded job is rejected; after a
   refund the same edit succeeds (mirrors lira-130).
6. **Stock guard.** Attaching more units than are on hand fails the whole save, leaving no job row and
   no stock movement.

### 8.2 Other coverage

- Core jest: `syncParts` reconciliation matrix (add, increase, decrease, remove, no-op resend);
  the two-currency stamp shape of §3.3 on an LBP job with parts; the profits fragments; the discount
  reconstruction of §3.4.
- Backend jest: the REST route with the shared schema, including tenant scoping. Per the standing
  rule, the **full** `yarn test` is the gate, not the core workspace alone — backend mocks
  better-sqlite3 and reaches paths core's suite structurally cannot.
- Frontend jsdom: PartPicker filter default and toggle; totals arithmetic; the cancel-X confirm;
  the admin-only profit block.
- Desktop e2e `frontend/tests/e2e-electron/lira-176-maintenance-parts.spec.ts`: drive the **real form**
  end to end, not a hand-built IPC payload — the recorded layer-seam lesson is that half the desktop
  suite never touches the UI and therefore cannot catch a frontend-to-repository mismatch, and this
  feature does arithmetic in the frontend. Assert by **identity and delta** (rule 15): match the
  transaction by `source_table`/`source_id`, snapshot stock and drawers immediately before the action,
  never use `getRecent(...)[0]` or `tbody tr.first()`.
- Web e2e `frontend/tests/e2e-web/lira-web-030-maintenance-parts.spec.ts`: the same flow over REST.
- A jest guard that no `"In Progress"` (space form) string literal remains in
  `packages/core/src`, mirroring the existing module-debt-types guard.

### 8.3 Final gate (run once, at the end)

`yarn typecheck`, `yarn lint`, full `yarn test`, `yarn check:tenant-scoping`, then desktop e2e
**before** web e2e (web's `rebuild:node` breaks the desktop ABI), each through the owner's own run
cycle.

---

## 9. Risks and open items

1. **Highest-cost error: double-counted or lost stock.** Parts move stock outside the POS path for the
   first time, and the reversal is spread across four owners. §3.5 and test 8.1.1/8.1.2 exist
   specifically for this. If any part of the plan is cut, this is not the part to cut.
2. **The closing snapshot silently overstates profit** if §3.4's `ClosingRepository` warning is not
   acted on in the same commit as the schema change. This is the one place where a partial
   implementation produces wrong money on a report the owner reads daily.
3. **`parts: undefined` semantics** are load-bearing across three call sites. A single `.default([])`
   in the validator would silently delete every part on a status transition. Guarded by test 8.1.3
   and an explicit comment in the schema.
4. **`CheckoutModal` is shared with POS and every other money module.** The `extraTotals` prop must
   be strictly additive: with it absent the rendered output and the emitted payload must be
   unchanged. Prove that with a jsdom snapshot of the existing single-currency path before touching
   it, not only with the new two-currency case.
5. **A pound job with parts now bills in two currencies at the counter.** That is the point of
   option 4, but it is a visible change for operators: the Due line shows two figures and the
   customer may tender either. The payment sheet already handles the netting; the training note is
   the owner's to make.
6. **The `reason` column stays `'SERVICE'`** for maintenance consumptions (§4.1). Deliberate, to avoid
   a SQLite table rebuild. Any future report that needs to separate the two sources must key off
   `maintenance_part_id`, not `reason`.
7. **The generic REFUND negation for non-sale sources is asserted, not assumed** (§5.3). It matters
   more here: a single maintenance REFUND must negate BOTH `profit_usd` and `profit_lbp`.
8. **Not in scope:** partial refund of individual parts; parts on the closing sheet as a separate
   line; a parts-usage report; returning a part to a different product than it came from.
