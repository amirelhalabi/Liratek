# "Allow out-of-stock sales" — Shop Config toggle

**Created:** 2026-07-11
**Status:** 🟡 IN PROGRESS
**Type:** money/inventory config. Follow-up to the POS stock-oversell guard
(`docs/plans/POS_STOCK_OVERSELL_GUARD_PLAN.md`, §8 carve-out).

## Why
The stock-oversell guard blocks a completed sale when stock is insufficient
(`Sale failed: not enough stock for "…" (0 available)`). That is correct for
shops that maintain accurate counts, but a live client does **not** track stock
and needs to sell regardless. This adds a per-shop toggle to relax the guard.

## Decisions (from the interview)
- **Name / shape:** "Allow out-of-stock sales" — a single ON/OFF toggle.
- **Scope:** global per-shop (one `system_settings` row per tenant). Not per-product.
- **Default:** hybrid — **existing** shops relaxed (via migration), **new** shops
  enforce (via `create_db.sql` seed).
- **When allowed:** let `stock_quantity` go **negative** (blind decrement), so the
  shortfall stays visible in the Negative-Stock report and can be reconciled.

## The setting
`system_settings` key **`allow_out_of_stock_sales`** (per-tenant):
- `'1'` = allow (relaxed) — sale completes even at 0/negative stock.
- `'0'` = enforce — the current guard blocks it.

## Default handling (hybrid)
- `electron-app/create_db.sql` seeds `allow_out_of_stock_sales = '0'` for the
  fresh-install tenant → new shops enforce.
- A migration (next version) inserts `'1'` for **every existing tenant** that
  lacks the key → existing shops are unblocked on upgrade with no setting to
  touch. Migrations only run on upgrading DBs (fresh installs are stamped by
  `create_db.sql`), so the two paths give the hybrid default automatically.

## Sale-path logic (shared core → desktop IPC + web REST both covered)
- `SalesService.processSale` reads the flag once
  (`getSettingsService().getSettingValue('allow_out_of_stock_sales')`,
  tenant-scoped) and passes `allowOutOfStock: boolean` into
  `salesRepo.processSale(sale, userId, { allowOutOfStock })`.
- `SalesRepository.processSale`:
  - **enforce (default):** the current guarded decrement
    (`… WHERE stock_quantity >= ?` + `changes === 0` → `BusinessRuleError`).
  - **allow:** blind decrement (`stock_quantity - qty`, no guard, negative
    permitted, no throw).
  - `BEGIN IMMEDIATE` + `busy_timeout` stay in both branches — the write is still
    atomic and serialized; only the stock precondition is relaxed.
- Read fresh per sale → the toggle takes effect immediately, no restart.

## UI — Settings → Shop Config (`ShopConfig.tsx`)
An "Allow out-of-stock sales" toggle:
- reads current value via `window.api.settings.getAll()`
- writes via `api.updateSetting('allow_out_of_stock_sales', on ? '1' : '0')`

This reuses the **existing** settings read/write plumbing (already works over both
IPC and REST), so there is **no new IPC/REST endpoint** — and therefore no
collision with the parallel web-parity work. Admin-only (Settings is admin-only).
Helper text: "When on, a sale completes even if an item is out of stock (stock
may go negative). When off, a sale is blocked if stock is insufficient."

## Files
1. `packages/core/src/db/migrations/index.ts` — migration: `allow_out_of_stock_sales='1'` for existing tenants
2. `electron-app/create_db.sql` — seed `'0'` for new installs + register the migration
3. `packages/core/src/services/SalesService.ts` — read setting, pass flag
4. `packages/core/src/repositories/SalesRepository.ts` — conditional decrement via `processSale` opts
5. `frontend/src/features/settings/pages/Settings/ShopConfig.tsx` — the toggle

## Verify
- Extend `SalesRepository.stockGuard.test.ts`:
  - `allowOutOfStock: true` → completed sale of 2 at stock 1 succeeds, `stock_quantity = -1`, no throw.
  - `allowOutOfStock: false` (default) → existing guard behavior still holds (rule-17 proof unchanged).
- `cd packages/core && npm run build` + sync; `yarn typecheck`; `yarn lint`; core jest (ABI dance).
- Manual: Shop Config toggle → sell an out-of-stock item → succeeds when ON, blocked when OFF; verify it shows up in the Negative-Stock report when ON.

## Notes
- The Negative-Stock report/Diagnostics panel already built surfaces the negatives that accrue while this is ON — the reconciliation path.
- Not included (deliberately, per interview): a POS confirm prompt on oversell — the chosen behavior is silent negative.
