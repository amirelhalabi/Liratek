# POS Stock-Oversell Guard — Implementation Plan

**Created:** 2026-07-11
**Status:** 🔴 OPEN — the bug is live in v1.29.4. Revived from a 1.27.2-era session plan that never shipped.
**Type:** money/inventory correctness (concurrency). Guarded by CLAUDE.md rules 13/15/17/18 and `docs/FEATURE_GUIDE.md` §2 (transactions), §7 (drawers).

## 1. The bug

A completed POS sale decrements stock with a **blind** subtract:

```
packages/core/src/repositories/SalesRepository.ts:566
  UPDATE products SET stock_quantity = stock_quantity - ?
  WHERE id = ? AND tenant_id = ?          -- run at :588, inside `if (status === "completed")`
```

Two sales that grab the last unit(s) concurrently both subtract → `stock_quantity` goes **negative** (inventory sold that doesn't exist). Triggers:

- **Two app instances on one shared/network DB** (the original "WAL work" scenario), or
- rapid double-submit on a single machine, or
- (now also) **two browser tabs / web + desktop** hitting the same tenant DB — the core path is shared by IPC `sales:process` and REST `POST /api/sales/process`, so the fix covers both transports in one place.

Current transaction wiring: `const processTransaction = db.transaction(() => {…})` (:219) invoked as `processTransaction()` (:622) — **default (DEFERRED) mode**, so the write lock is acquired lazily on first write, leaving a read→write upgrade window under contention.

## 2. Answers to the §13-style checklist (only the relevant items)

- **Transaction row / drawers / legs / debt / profit / ledger / void / sessions / audit badge:** _no change_ — this fix only hardens the existing stock decrement inside the already-existing sale transaction. No new transaction type, no new money movement.
- **Multi-tenant:** the decrement already carries `tenant_id` (from the tenant-scoping work). The guard preserves it; the `changes === 0` check then also (correctly) catches a wrong-tenant/missing row as "not enough stock / not found". The name+stock lookup for the error message MUST be tenant-scoped too.
- **Draft exclusion:** already correct — the decrement is inside `if (status === "completed")`, and `deferPayment` (session basket) still decrements per item (unchanged).
- **Rollback:** the throw happens inside `db.transaction(...)`, which auto-rolls-back the whole sale (row + sale_items + any drawer/debt writes already done in the closure). No partial sale.

## 3. Changes

### 3.1 `packages/core/src/repositories/SalesRepository.ts` — the core fix

Replace the blind decrement + call site with a guarded conditional write and a rows-affected check.

- Statement:
  ```
  UPDATE products SET stock_quantity = stock_quantity - ?
  WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?
  ```
- Call site (inside the `status === "completed"` block, ~:588):
  ```ts
  const r = stockStmt.run(
    item.quantity,
    item.product_id,
    tenantId,
    item.quantity,
  );
  if (r.changes === 0) {
    const row = db
      .prepare(
        `SELECT name, stock_quantity FROM products WHERE id = ? AND tenant_id = ?`,
      )
      .get(item.product_id, tenantId) as
      | { name?: string; stock_quantity?: number }
      | undefined;
    throw new BusinessRuleError(
      `Not enough stock for "${row?.name ?? `product #${item.product_id}`}" ` +
        `(${row?.stock_quantity ?? 0} available)`,
    );
  }
  ```
- Import: `import { BusinessRuleError } from "../utils/errors.js";` (class exists at `errors.ts:130`; imported relatively — no barrel export needed).
- Make the transaction **BEGIN IMMEDIATE** so the write lock is taken up front (avoids `SQLITE_BUSY_SNAPSHOT` from a read-then-upgrade): change the invocation at :622 from `processTransaction()` to `processTransaction.immediate()`.

### 3.2 `electron-app/main.ts` — let the loser wait (Layer 1)

`busy_timeout = 5000` is currently **network-only** (:277-278, inside `if (isNetworkPath)`). Move it out so it applies unconditionally (harmless on local DBs); keep `cache_size` network-only.

```
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");        // <- unconditional
if (isNetworkPath) { db.pragma("cache_size = -2000"); logger.info(...); }
```

Effect: a second instance hitting the held write lock **waits** (button stays loading) instead of erroring instantly, then runs and gets the clean out-of-stock error.

- **Parallel to check (web):** `backend/src/database/connection.ts` — confirm the web/backend connection also sets `busy_timeout` (multi-tenant web has concurrent requests on one DB). If not, add it there too. _(verify during impl)_

### 3.3 `electron-app/handlers/salesHandlers.ts` — audit only on success

The `sales:process` audit (:34) runs unconditionally, logging "Processed sale" even on a failed/rolled-back sale. Gate it: `if (result.success) audit(...)`. (The REST route already returns the error envelope; the parallel REST audit, if any, gets the same treatment.)

### 3.4 No change needed

- `SalesService.processSale` — already try/catches and returns `{ success:false, error: err.message }`, so the `BusinessRuleError` message flows to both IPC and REST envelopes.
- Frontend POS — already renders `"Sale failed: " + result.error`.

### 3.5 Optional (decision below)

Frontend: after an out-of-stock failure, refetch the product's stock so the card flips (e.g. 1→0) without a manual refresh. Small QoL; not required for correctness.

### 3.6 `packages/core/src/repositories/ProductRepository.ts` — the OTHER (dead) decrement path

`deductStockForSale(saleId)` (:510) is a **second blind subtract** — it deducts each `sale_items.quantity` via a subquery with no `>= quantity` guard and no rows-affected check. It is currently **dead**: its only caller is `InventoryService.deductStockForSale` (:361), which itself has **no live caller** (not wired to any IPC handler or REST route — the real sale decrements inline in `SalesRepository`). So it is NOT a live oversell path today, but it is documented "used when finalizing a sale," i.e. a latent footgun the moment someone wires it up. Action: at minimum add a `// UNGUARDED — do not use to finalize sales; see SalesRepository guarded decrement` comment on both methods. (A full guard here is awkward — the single-statement subquery form can't express a per-row `>= qty` check, so it would have to iterate items like the sale path; only worth doing if it ever becomes live.)

## 4. Proof (rule 15 + rule 17)

Add a repository-level guard test (alongside `SalesRepository.discountProfit.test.ts` / `tenantIsolation.test.ts`):

- Seed one product with `stock_quantity = 1`.
- Process a completed sale of qty 1 → succeeds, stock = 0.
- Process a second completed sale of qty 1 → **asserts it throws/returns the out-of-stock error AND `stock_quantity` is still 0 (never negative)**, and no orphan sale/sale_items row was written (rollback).
- Delta + identity assertions (rule 15): match the product by id, assert the stock delta, not absolute table state.
- **Rule 17:** temporarily revert the guard (blind decrement), run the new test, watch it FAIL (stock goes to -1), then restore. Only then does the test count.
- **Test scope (don't over-claim):** this proves the **guard** (Layer 2) — the second sale sees stock=0 and errors. It does NOT exercise SQLite write **serialization** (Layer 1): that is OS-level file locking between two separate connections/processes and is not reproducible with a single in-process jest connection. The serialization / `busy_timeout` "loser waits then errors" behavior is only validated by the manual 2-instance run in §5.
- Core jest ABI: `npm rebuild better-sqlite3` (node ABI) before running; `npm run rebuild:native` after (restore Electron ABI) — see the `backend-jest-abi-rebuild` note.

## 5. Build / verify sequence

1. `cd packages/core && npm run build` → sync `node_modules/@liratek/core/dist`.
2. `cd electron-app && npm run build` (main.ts + handler changed).
3. `yarn typecheck` + `yarn lint`.
4. Core jest guard test (ABI dance above).
5. Desktop e2e sanity: existing POS specs still green (`yarn rebuild:native` first). Web: `yarn test:e2e:web` POS checkout still green.
6. **Manual 2-instance oversell check** (validates Layer 1 — jest can't): two desktop instances pointed at one shared DB, one unit in stock, both click _Complete Sale_ ~together → one succeeds, the other's button stays loading (`busy_timeout`) then shows the out-of-stock error; final `stock_quantity` is 0, never negative.

## 6. Open decisions (from the original session)

- **(a) Frontend stock-refetch on failure** — recommend **skip** for now (correctness doesn't need it; can add later as QoL).
- **(b) Global `busy_timeout`** — recommend **yes** (harmless locally, necessary for the multi-instance UX).

## 7. Scope note

This is a self-contained correctness fix, independent of the web/multi-tenant thread. It is naturally tenant-safe (the decrement already scopes by `tenant_id`). It does NOT require the larger original-1.27.2 effort (shared-mode flag, rollback-journal, retry helper, debt/voucher/settlement guards) — those remain separate if ever pursued.

## 8. Pre-existing data + product-type risks (confirm BEFORE shipping)

The guard changes real behavior for two cases the blind decrement silently tolerated today. Both need a decision before release.

- **Negative stock already in the wild.** The bug is live in v1.29.4, so tenant DBs likely already contain `stock_quantity < 0` rows. Once the guard ships, those products can no longer be sold (stock < qty) until reconciled. Prefer a **read-only report** (list products with negative stock, per tenant) over a silent clamp — negative stock is a genuine count discrepancy the shop should reconcile, not hide. If a clamp to 0 is wanted, do it as an explicit, logged one-off (not a silent migration).
- **No "service / non-stock-tracked" product flag.** `products.stock_quantity` is `INTEGER DEFAULT 0` with no `is_service` / `track_stock` column, so the guard blocks selling **any** product whose `stock_quantity < qty` — including any item the shop sells at/below 0 on purpose (e.g. a service billed as a product, which today just goes negative unnoticed). **Confirm no such items exist.** If they do, they need a carve-out: add a `track_stock` (or `is_service`) flag and skip the `>= qty` guard when it's off — otherwise this fix starts rejecting their sales. This is the one thing that could turn a correctness fix into a regression, so verify it first.
