# Supplier Stock Intake — booked debt, FIFO cost batches, "old stock" opt-out

**Status:** SHIPPED 2026-09-07 (migration v164). See "As built" (§4) for what actually landed,
verified against the current repository source.
**Supersedes:** LIRA-087 / LIRA-090 draft ("record supplier debt first, attach inventory products
later" — `OWNER_NOTES_TASK_PLAN.md:410-432`). That ticket is marked SUPERSEDED, dated 2026-09-06.

---

## 0. Why — the two bugs the owner reported, and their single root cause

Owner report 2026-09-06:

1. Wants an **"old"** checkbox beside the Supplier field on Add Product; ticked = this entry must
   not affect the supplier balance. Their existing workaround was to add the product, then "Write
   off" on the Suppliers page — and they suggested removing write-off.
2. Added two products costing $200 linked to a supplier → Suppliers page showed **owe $200**. Sold
   ONE item at POS → shows **owe $100**. A sale must not move the supplier balance.
3. Screenshot: the Write-off modal shows `OWED $200.00` and submitting alerts **"Supplier has no
   outstanding balance to write off"**.

**Root cause (verified by a 9-agent adversarial workflow, executable SQL repro, and a read-only copy
of the live DB — 0 refutations across 9 independent checks):**

Product-supplier "owed" is **not a ledger**. `SupplierRepository.getProductSupplierBalances`
(`packages/core/src/repositories/SupplierRepository.ts:1018-1052`) recomputes on every read:

```sql
ROUND(  SUM(p.stock_quantity * p.cost_price_usd)      -- live inventory valuation
      + SUM(supplier_ledger.amount_usd), 2)           -- non-refunded ledger rows
```

joined `LOWER(p.supplier) = LOWER(product_suppliers.name)`, filtered `p.is_active = 1`.

Consequences, all confirmed:

| Event                                   | Effect on "owed" today                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| POS sale (`SalesRepository.ts:772-776`) | **falls** by qty × cost — owner bug (2)                                      |
| Sale refund (`:1537`)                   | **rises** again                                                              |
| Cost-price edit                         | retroactively **re-prices the debt**                                         |
| Product soft-delete                     | **no change** — the query filters `is_active` only, delete sets `is_deleted` |
| Adding stock (any path)                 | **no ledger row is ever written** — there is nothing to opt out of           |

And bug (3): the modal's `OWED` reads the stock-derived map
(`Suppliers/index.tsx:482-495, 2256-2257`) while `SupplierService.writeOffSupplierDebt:168` guards
against **ledger-only** `getSupplierBalance` (= 0 for a product supplier). The standalone supplier
write-off has **never** been able to succeed for a product supplier since it shipped in `a3d09e7b`
(2026-07-19). The _bundled_ Pay-form discount has no balance guard and does post — likely what the
owner actually used. A write-off also books **+profit** ("discount received",
`moneyPosting.ts:727-732`), which is right for real forgiveness and wrong for old stock.

Therefore the "old" checkbox **cannot** be built as "skip a ledger write" — no such write exists.
It requires moving to event-based booking, which fixes all three reports with one change.

---

## 1. Owner decisions (2026-09-06 interview) — ALL IMPLEMENTED (see §4 "As built")

| #       | Decision                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1**  | **Book debt when stock arrives.** One `supplier_ledger` row of qty × unit cost per delivery. Balance = Σ non-refunded ledger rows, the same formula company suppliers already use. Sales, refunds, deletes and cost edits never move it.                                                                     |
| **D2**  | **Booking events:** the **Add Product** form (including the POS quick-add, which embeds the same form) and the **restock action**. File import is not used by the owner — left on the Add Product path, so it books like any other create.                                                                   |
| **D3**  | **Keep the existing stock button** (name unchanged — owner: _"no need to change its name"_). It gains **quantity received**, **unit cost**, and the **old-stock checkbox**, with fields and layout mirroring the Add Product form.                                                                           |
| **D4**  | **Stored cost price becomes the newest purchase price** on a restock (display / pricing reference).                                                                                                                                                                                                          |
| **D5**  | **FIFO cost batches for profit.** Each delivery is a batch with its own quantity and unit cost; a sale consumes the **oldest batch first**. Invisible at POS — one product row, no batch picking anywhere. Owner explicitly rejected any "select from a list of items with a cost for each".                 |
| **D6**  | **"Old stock" checkbox is per-entry** and resets every time. Shown only when the Supplier field is filled. Creates a batch (so profit still works) with **no debt row**.                                                                                                                                     |
| **D7**  | **Permissions: admin + staff on BOTH transports.** Fixes the existing parity gap (desktop `admin\|staff` at `inventoryHandlers.ts:134-138` vs web `admin` only at `backend/src/api/inventory.ts:136-138`).                                                                                                   |
| **D8**  | **REMOVE the standalone supplier write-off** (button, modal, hook, adapter, preload, IPC handler, REST route, schema, service + repository method). **Keep** the bundled Pay-form discount, which is the remaining forgiveness path.                                                                         |
| **D9**  | **Purchases tab:** drop the guessed Paid/Status columns and the Outstanding footer (`Suppliers/index.tsx:576-598, 1487-1491`). Show the real received/paid history from actual records, plus a separate informational "Stock on hand" line (this page is the only per-supplier stock-value view in the app). |
| **D10** | **Undo:** every delivery appears in the Transactions page and an admin can void it — removing the debt and the batch. **Refuses** if any unit from that batch has already been sold, so a voided delivery can never leave sold units with no cost behind them.                                               |
| **D11** | **Existing stock:** one **opening batch per product** at its current cost, marked settled, **no debt**. Nothing on the Suppliers page starts out owed.                                                                                                                                                       |
| **D12** | **Live data:** the `amir` supplier ($100, one product) is **test data — ignore**. The web deployment is **owner-only testing**, no real tenants. So no balance-preservation migration is needed; only the opening-batch backfill.                                                                            |

### Deferred

```
//TODO (owner, deferred 2026-09-06): "Return to supplier" on a stock DECREASE.
//  Owner: "we can do this later." Until then a stock decrease NEVER touches the
//  supplier balance — breakage/loss/miscount is the shop's cost and the debt stands.
//  When built it needs a TYPED option, not the free-text reason box
//  (validators/inventory.ts:21 is z.string(), create_db.sql:1801 has no enum), and it
//  must reverse FIFO batches newest-first + write a negative ledger row (rule 20).
```

---

## 2. D13 — Edit-form Quantity is read-only (owner approved 2026-09-06)

The edit form's **Quantity becomes read-only**, with a pointer to the stock action, so there is
exactly ONE intake path and it always asks for the unit cost and the old-stock flag. Rationale: a
quantity typed into the edit form is an un-audited overwrite (`ProductRepository.ts:740`,
`stock_quantity = COALESCE(?, stock_quantity)`, no audit row) that would either silently book debt
at a stale cost or silently skip it. Quantity stays editable on **create** (the first entry of a
product is itself an intake).

---

## 3. Engineering items — decided by the rules, not owner questions

1. **Rule 20 (reversal symmetry).** The new intake row needs a named reversal owner: a new
   transaction type, soft-voidable by admin (the manual-`TOP_UP` → `SUPPLIER_PAYMENT` precedent —
   no drawer moved, so soft-void alone nets the ledger to 0). Must prove create + void nets to **0
   across ledger and batches, per currency**, failing-first (rule 17).
2. **FIFO batches** need: a batch table, consumption on sale, **restoration to the originating batch
   on refund**, and batch removal on intake void. Precedent in this repo: the exchange-lot FIFO
   settlement work.
3. **New `supplier_ledger` `entry_type`** requires a CHECK-rebuild migration (the v131 pattern) plus
   `create_db.sql` in the same change (rule 10). Read the last entry of
   `packages/core/src/db/migrations/index.ts` for the number — the live DB is at **161**.
4. **Rule 19b web-parity gap:** REST `POST`/`PUT /api/inventory/products` does **not** call
   `ProductSupplierRepository.getOrCreate`, unlike the IPC handler (`inventoryHandlers.ts:158, :213`).
   Web-created suppliers therefore never appear on the Suppliers page. Move `getOrCreate` into
   `InventoryService` so both transports share it.
5. **Rule 19a:** `ProductForm`'s supplier datalist uses raw `window.api`
   (`ProductForm.tsx:155-156`) — migrate to `useApi()` while in there.
6. **Book the intake inside the same DB transaction** as the product insert / stock change.
7. **Test-schema sweep** (known trap: a missing table makes every test in a file die in setup).
   Every hand-built fixture calling `createProduct` / the stock path needs `suppliers`,
   `product_suppliers`, `supplier_ledger`, the new batch table and `transactions`.
   `SupplierRepository.discount.test.ts`'s fixture has no `products` table at all.
8. **Rule 15 e2e trap:** specs that create a product with a supplier text (lira-143, lira-144,
   lira-web-024) will start writing extra ledger + transaction rows. Audit any spec that snapshots
   recent transactions or ledger totals around a product create.
9. **Docs:** add the new entry type and its reversal owner to `docs/COUNTERPARTY_LEDGERS.md` §4, and
   a product-supplier row to `docs/FEATURE_GUIDE.md` §8 (which today documents balance as "SUM of
   ledger rows" only and never mentions the stock-derived formula — a doc gap that helped hide this).

### Latent defects found on the way (both moot once §1 lands, recorded so they are not re-found)

- **Ledger fan-out:** `getProductSupplierBalances` joins `product_suppliers` without aggregating it,
  so two `product_suppliers` rows pointing at one supplier multiply `SUM(l.amount_usd)` by two.
  Reproduced: inventory 100 + one −40 payment with 2 link rows → `20.0` instead of `60`.
- **Rename breaks the join:** `ProductSupplierRepository.update:107-134` renames
  `product_suppliers.name` and `suppliers.name` but never rewrites `products.supplier`, so every
  product silently drops out of that supplier's figure. The join is by name text even though
  `products.supplier_id` exists.

### Removals D8 makes safe (verified — nothing else depends on them)

Standalone write-off has **zero e2e coverage** and no backend route test. Deleting it touches: the
button + modal + state in `Suppliers/index.tsx`, `useSupplierWriteOffMutation`, the adapter fn, the
`ApiAdapter` type, the preload binding and `electron.d.ts`, the IPC handler, the schema re-export,
the REST route, `supplierWriteOffSchema`, `SupplierService.writeOffSupplierDebt`,
`SupplierRepository.writeOffSupplierDebt`, and two jest describe blocks
(`SupplierRepository.discount.test.ts:299-388`), plus a `supplierWriteOff: jest.fn()` line in 7
frontend test mocks. **Must be kept:** `_postSupplierDiscount`, `_applyPurchaseFifoCoverage`,
`getSupplierBalance` (it is the nets-to-0 oracle in two core suites), the `COUNTERPARTY_DISCOUNT`
type, `buildCounterpartyDiscountPosting`, migration v131 + the CHECK, the Profits discounts bucket,
and the audit-viewer mapping — all shared with the bundled discount and with clients/partners.

`supplier_purchases` / "Log purchase" is **dead code**: no UI writer, no `product_id`, 0 rows in the
live DB, and it is not an input to any displayed balance. Leave it dormant; do not build the
LIRA-087 linking table.

---

## 4. As built (2026-09-07) — verified against source

Every claim below was checked against the current repository, not against the design intent above.

**Migration v164** (`packages/core/src/db/migrations/index.ts:9955`): creates
`product_stock_batches` + `stock_batch_consumptions`, rebuilds `supplier_ledger` to widen its
`entry_type` CHECK with `'STOCK_INTAKE'` (v131 table-rebuild technique), and backfills one
`is_opening=1, books_debt=0` batch per in-stock product (D11 — books no debt). `create_db.sql` was
updated in the same change (rule 10).

**`StockBatchRepository`** (`packages/core/src/repositories/StockBatchRepository.ts`) — FIFO cost
batches, `ORDER BY created_at ASC, id ASC` (`FIFO_ORDER`, defined once per rule 14).
`createBatch`/`listByProduct`/`listOpenByProduct`/`findByTransactionId`/`findByLedgerEntryId`/
`getStockValueBySupplier` all shipped as contracted. `consume()` never throws on insufficient
cover — it reports the shortfall in `uncoveredQuantity` and prices it at the caller's
`fallbackUnitCostUsd` (a sale must never fail on batch bookkeeping) — but a genuine write failure
still throws so the caller's transaction rolls back. `restoreForSaleItem` gives refunded units
back to the batches they came from, newest-consumption-first. `deleteBatchForVoid` returns `false`
(refuses) when any unit of the batch was already consumed.

**`SupplierRepository.recordStockIntake`** (`SupplierRepository.ts:958`) — writes the
`STOCK_INTAKE` supplier_ledger row (`+qty × unit_cost_usd`) and its own `SUPPLIER_STOCK_INTAKE`
transaction (`source_table 'supplier_ledger'`), links `transaction_id` back onto the ledger row,
all inside one `db.transaction()`. `created_by` is a **required, non-nullable** parameter — this
repository deliberately has no `|| 1` actor fallback; a missing actor is the caller's bug and must
fail there.

**`SupplierRepository.getProductSupplierBalances`** (`SupplierRepository.ts:1131`) — rewritten to
share the SAME extracted ledger-balance expression (`_ledgerBalanceQuery`) as
`getSupplierBalances`, restricted to `is_system = 0` suppliers with a linked `product_suppliers`
row. `total_lbp` now reflects real LBP legs instead of a hardcoded 0. This is the fix for both
owner-reported bugs in §0 — balance is ledger-sum only, and stock/sales/refunds/cost edits never
touch it.

**Sales / FIFO costing** — sales consume FIFO via `StockBatchRepository.consume` and stamp the
weighted unit cost into `sale_items.cost_price_snapshot_usd`, which every profit query already
reads. **No profit-query code changed**, as designed.

**`TransactionRepository._reverseSupplierStockIntake`** (`TransactionRepository.ts:3538`) — the
rule-20 reversal owner. The generic void/refund path soft-voids the `supplier_ledger` row for free
(`source_table = 'supplier_ledger'`); this method additionally calls
`StockBatchRepository.deleteBatchForVoid` and, on success, lowers `products.stock_quantity` by the
batch's original `quantity` (D10). It **throws** (refusing the whole void) when any unit from the
batch was already sold, naming how many units — this rolls back the reversal transaction and the
`_markSourceRefunded` step the same call already wrote, same pattern as
`_assertLotoTicketVoidable`. No payments row / drawer leg exists for this type, so nothing else to
reverse.

**Standalone supplier write-off REMOVED (D8)** — `SupplierService.writeOffSupplierDebt` and
`SupplierRepository.writeOffSupplierDebt` no longer exist. The button/modal, `useSupplierWriteOffMutation`,
the adapter fn, the `ApiAdapter` type, the preload binding, `electron.d.ts`, the IPC handler, the
schema re-export, the REST route, and `supplierWriteOffSchema` were all removed
(`electron-app/handlers/supplierHandlers.ts:186`, `backend/src/api/suppliers.ts:431` carry the
removal notes). The bundled Pay-form discount (`_postSupplierDiscount`, `DISCOUNT` entry type)
**stays** — it is the only forgiveness path left.

**Product form (`AdjustStockModal.tsx` / `ProductForm`)** — a per-entry "old stock" checkbox
(`isOldStock` state) is sent as `is_old_stock` on `receiveStock`; it resets every time and is shown
only when the Supplier field is filled (D6). The edit form's Quantity field is read-only (D13);
Quantity stays editable on create.

**Orchestration point** — `InventoryService.receiveStock` (`InventoryService.ts:641`) validates
and delegates the actual DB work to `ProductRepository.receiveStock`, which owns the single
`db.transaction()` that raises `stock_quantity`, sets `cost_price_usd = unit_cost_usd` (D4),
writes the `stock_adjustments` audit row, creates the FIFO batch, and calls
`SupplierRepository.recordStockIntake` unless `is_old_stock` or there is no supplier. This differs
slightly from the build contract's suggested shape (which sketched the transaction as owned
directly by `InventoryService`) — the actual transaction boundary is one level down, in the
repository, consistent with rule 13 (services never touch the DB).

### Still deferred — prominent, do not lose

```
//TODO (owner, deferred 2026-09-06): "Return to supplier" on a stock DECREASE.
//  Owner: "we can do this later." Until then a stock decrease NEVER touches the
//  supplier balance — breakage/loss/miscount is the shop's cost and the debt stands.
//  When built it needs a TYPED option, not the free-text reason box
//  (validators/inventory.ts:21 is z.string(), create_db.sql:1801 has no enum), and it
//  must reverse FIFO batches newest-first + write a negative ledger row (rule 20).
```

This remains **UNBUILT**. Nothing in the shipped code reverses a stock decrease against the
supplier ledger.
