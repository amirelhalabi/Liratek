# Current Sprint — March 2026

> **Last Updated**: 2026-03-05  
> **Sprint Start**: 2026-03-01  
> **Focus**: Setup Wizard, Module-Linked UI, UX Polish, CI/CD + Packaging, Auto-Update, Sales Reporting

---

## ✅ Done This Sprint (March 5, 2026 — Sales Reporting Tab + Shared DateRangeFilter)

### Shared DateRangeFilter Component

| Change                                    | Details                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`DateRangeFilter` in `@liratek/ui`**    | New reusable component: two date inputs (From/To) in a compact row. Props: `from`, `to`, `onFromChange`, `onToChange`, `className`                  |
| **`todayISO()` / `daysAgoISO()` helpers** | Exported from `@liratek/ui` — returns YYYY-MM-DD strings for today and N days ago. Replaces duplicate local implementations                         |
| **Profits page updated**                  | Removed local `todayISO()` and `daysAgoISO()` functions, replaced inline date inputs with `<DateRangeFilter>` component imported from `@liratek/ui` |
| **Reports page updated**                  | Same treatment — uses shared `DateRangeFilter` instead of inline date inputs for all report tabs                                                    |

### Sales Tab in Reports Page

| Change                         | Details                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sales tab added to Reports** | New "Sales" tab (ShoppingCart icon) alongside existing Daily Summaries, Revenue by Module, Overdue Debts tabs                                       |
| **4 summary cards**            | Total Sales (count), Total Revenue ($), Avg Sale Value ($), Total Discounts ($) — computed from fetched data                                        |
| **DataTable with 11 columns**  | Date/Time, Sale #, Client, Items, Total, Discount, Final, Paid USD, Paid LBP, Status, Drawer — with sorting, pagination (20/page), Excel/PDF export |
| **Status badges**              | Color-coded: green "completed", red "refunded" — consistent with POS styling                                                                        |
| **Footer totals row**          | Sums for Total, Discount, Final, Paid USD, Paid LBP across ALL data (not just current page)                                                         |
| **Date range filtering**       | Uses shared `DateRangeFilter`, defaults to last 30 days. Fetches via `window.api.sales.getByDateRange(from, to)`                                    |

### Backend: Sales by Date Range API

| Change                                           | Details                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **`SalesRepository.findByDateRange()` enhanced** | Now returns completed + refunded sales (was completed-only). Added `item_count` subquery (`SUM(quantity)` from `sale_items`) |
| **`SalesService.findByDateRange()` added**       | New pass-through method with error logging, returns empty array on failure                                                   |
| **`sales:get-by-date-range` IPC handler**        | New handler in `salesHandlers.ts` — delegates to `salesService.findByDateRange(startDate, endDate)`                          |
| **Preload binding**                              | `sales.getByDateRange(startDate, endDate)` added to `preload.ts` sales namespace                                             |
| **TypeScript types**                             | Full return type in `electron.d.ts` — includes all `SaleEntity` fields + `client_name`, `client_phone`, `item_count`         |

### Soft-Delete Barcode Reactivation Fix

| Change                                          | Details                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Root cause**                                  | `products.barcode` has a `UNIQUE` constraint. Soft-deleted products (`is_active = 0`) still hold their barcodes, so re-importing the same barcode (e.g. via `.toon` file after batch delete) fails with UNIQUE violation |
| **`ProductRepository.createProduct()` updated** | Catches `SQLITE_CONSTRAINT_UNIQUE` errors. When the collision is with a soft-deleted product, **reactivates** it (`is_active = 1`) and updates all fields instead of failing                                             |
| **`barcodeExists()` fixed**                     | Now filters by `AND is_active = 1` — soft-deleted barcodes fall through to `createProduct()` which handles reactivation. The DB-level UNIQUE constraint remains the real guard                                           |

### Files Modified

| File                                                  | Change                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/core/src/repositories/ProductRepository.ts` | `createProduct()` reactivates soft-deleted products on barcode collision |
| `packages/ui/src/components/ui/DateRangeFilter.tsx`   | **NEW** — Shared date range filter component                             |
| `packages/ui/src/components/ui/index.ts`              | Added DateRangeFilter exports                                            |
| `frontend/src/features/profits/pages/Profits.tsx`     | Uses shared DateRangeFilter from `@liratek/ui`                           |
| `frontend/src/features/reports/pages/Reports.tsx`     | Added Sales tab + uses shared DateRangeFilter                            |
| `packages/core/src/repositories/SalesRepository.ts`   | Enhanced `findByDateRange()` — all statuses + item_count                 |
| `packages/core/src/services/SalesService.ts`          | Added `findByDateRange()` pass-through                                   |
| `electron-app/handlers/salesHandlers.ts`              | Added `sales:get-by-date-range` IPC handler                              |
| `electron-app/preload.ts`                             | Added `getByDateRange` to sales namespace                                |
| `frontend/src/types/electron.d.ts`                    | Added `getByDateRange` type definition                                   |

---

## ✅ Done This Sprint (March 5, 2026 — Diagnostics/Settings Fixes + Auto-Update System)

### Diagnostics Quick Fixes

| Change                                        | Details                                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UpdatesPanel: removed auto-check on mount** | `useEffect` now only calls `getStatus()` — no longer triggers `check()` on page load. Users must click "Check for Updates" manually                                                                                                           |
| **FK check: removed inline result div**       | Removed the green "OK" div and violations table from `Diagnostics.tsx`. FK check results now only show via notification center (success/warning/error). Startup violation banner (yellow) retained for persistent visibility                  |
| **Feature toggle switches in ShopConfig**     | Added visible toggle switches for "Opening & Closing" (`sessionMgmt`) and "Customer Sessions" (`customerSessions`). State was already loaded/saved but had no UI controls. Toggles use violet/slate pill style consistent with other settings |

### Auto-Update Push Event System

| Change                                              | Details                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`wireAutoUpdaterEvents()` in updaterHandlers.ts** | Wires `autoUpdater` event listeners (`update-available`, `download-progress`, `update-downloaded`, `update-not-available`, `error`) that push to renderer via `BrowserWindow.getAllWindows().webContents.send()`. Only wires once (idempotent flag)                         |
| **`autoCheckForUpdates()` exported**                | Called from `main.ts` after `createWindow()`. Only runs in packaged mode. Gated by `auto_check_updates` DB setting (default: enabled). Sets `autoDownload = false` to prevent silent downloads                                                                              |
| **main.ts launch integration**                      | After `createWindow()`, dynamically imports and calls `autoCheckForUpdates()` with a DB setting reader function. Non-fatal — silently catches errors                                                                                                                        |
| **Preload push event listeners**                    | Added `onUpdateAvailable`, `onDownloadProgress`, `onUpdateDownloaded`, `onUpdateNotAvailable`, `onError` to `updater` namespace in `preload.ts`. Each returns an unsubscribe function for cleanup                                                                           |
| **TypeScript types**                                | Full types for all 5 push event callbacks in `electron.d.ts` — includes version, releaseDate, progress percent/bytes/total                                                                                                                                                  |
| **`UpdateNotifier` component**                      | New component in `App.tsx` — listens for push events, shows persistent top-of-screen action bar: "Update available v1.x.x [Download]" → "Downloading... N%" → "Update ready [Restart Now]". Dismissable with X button. Also emits notification center toasts for key events |
| **Auto-check for updates toggle**                   | New toggle in ShopConfig "Features" section: "Auto-check for Updates". Persists as `auto_check_updates` in `system_settings` (value `1`/`0`, default enabled). Read by backend on launch to gate auto-check behavior                                                        |

### Files Modified

| File                                                             | Change                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `frontend/src/features/settings/pages/Settings/UpdatesPanel.tsx` | Removed `check()` from `useEffect`                                               |
| `frontend/src/features/settings/pages/Settings/Diagnostics.tsx`  | Removed `fkRows` state + inline result divs                                      |
| `frontend/src/features/settings/pages/Settings/ShopConfig.tsx`   | Added 3 feature toggles (Opening/Closing, Customer Sessions, Auto-check Updates) |
| `electron-app/handlers/updaterHandlers.ts`                       | Added `wireAutoUpdaterEvents()`, `autoCheckForUpdates()`, push event wiring      |
| `electron-app/main.ts`                                           | Added auto-check call after `createWindow()`                                     |
| `electron-app/preload.ts`                                        | Added 5 `onXxx` push event listeners to updater namespace                        |
| `frontend/src/types/electron.d.ts`                               | Added types for 5 push event callbacks                                           |
| `frontend/src/app/App.tsx`                                       | Added `UpdateNotifier` component with persistent action bar                      |

---

## ✅ Done This Sprint (March 4, 2026 — Refund Fix, Cancel Button Removal)

### Refund System — ID Mismatch Fix

| Change                              | Details                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Root cause**                      | `SaleDetailModal` passed `saleId` (from `sales` table) to `transactions.refund()`, but `TransactionRepository.refundTransaction()` expects a `transactions.id`. These are different IDs — refund silently failed or hit wrong record |
| **`refundBySaleId()` — Repository** | New method on `TransactionRepository`. Looks up `SELECT id FROM transactions WHERE source_table='sales' AND source_id=? AND type='SALE'`, then delegates to existing `refundTransaction(txnId)`                                      |
| **`refundBySaleId()` — Service**    | New pass-through on `TransactionService` with error logging                                                                                                                                                                          |
| **`sales:refund` IPC handler**      | New handler in `salesHandlers.ts` — admin-only, calls `txnService.refundBySaleId(saleId, userId)`. Returns `{ success, refundId }` or `{ success: false, error }`                                                                    |
| **Preload + types**                 | `sales.refund(saleId)` bridge in `preload.ts` + typed in `electron.d.ts`                                                                                                                                                             |
| **`SaleDetailModal` updated**       | Changed from `window.api.transactions.refund(saleId)` to `window.api.sales.refund(saleId)` — now correctly routes through sale-aware refund path                                                                                     |

### Cancel Button Removed from CheckoutModal

| Change                          | Details                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Cancel button removed**       | Removed from footer buttons row. Click-outside-modal (`onMouseDown` on backdrop → `onClose()`) is the cancel mechanism |
| **`onClose` handler unchanged** | POS `onClose` already handles draft deletion + cart clearing — no behavior change, just UI simplification              |

---

## ✅ Done This Sprint (March 4, 2026 — POS Improvements: Sale Detail, Refund, Print, Receipt Layout)

### Sale Detail Modal + Refund from POS

| Change                    | Details                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SaleDetailModal.tsx`** | New component in `POS/components/`. Fetches sale + items via `window.api.sales.get()` and `window.api.sales.getItems()`. Displays customer info, itemized list, payment breakdown |
| **Refund button**         | Calls `window.api.sales.refund(saleId)` — backend resolves transaction ID internally, restores stock, reverses payments, marks sale refunded. Confirm dialog before execution     |
| **Print from detail**     | Print button generates receipt from sale data and opens print dialog directly                                                                                                     |
| **Refunded sale styling** | Items show line-through red text, total shows line-through, "Refunded" badge in header                                                                                            |
| **Wired into POS**        | `selectedSaleId` state + `onSaleClick` handler in `POS/index.tsx`. Clicking any sale card/row in today's sales opens the detail modal                                             |
| **Sales list refresh**    | `refreshSalesKey` counter incremented after sale completion and after refund — triggers ProductSearch to reload today's sales                                                     |
| **Notification system**   | Refund success/error uses `appEvents.emit("notification:show", ...)` instead of `alert()`                                                                                         |

### Direct Print Button in CheckoutModal

| Change                             | Details                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **New "Print" button**             | Added alongside existing "Preview" button in CheckoutModal footer. Green accent (emerald) to distinguish from blue Preview |
| **`handleDirectPrint()`**          | Generates receipt data and immediately opens print dialog — skips the preview modal entirely                               |
| **`printReceiptContent()` helper** | Extracted shared print-window logic used by both Preview-then-Print and Direct Print flows                                 |
| **Unified print CSS**              | Single `receiptPrintCSS` string used by all print paths — font-size reduced from 12px to 10px, line-height from 1.4 to 1.3 |

### Receipt Layout Overhaul (58mm)

| Change                       | Details                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Width reduced**            | 40 → 32 characters — better fit for actual 58mm thermal printers                                                           |
| **Date + time combined**     | Single line instead of separate Date: and Time: lines                                                                      |
| **1 line per item**          | Item name left-aligned, subtotal right-aligned on same line. Qty×price shown only when quantity > 1 (as indented sub-line) |
| **Removed "RECEIPT" header** | Shop name alone between `===` dividers — saves vertical space                                                              |
| **Receipt number compact**   | `#RCP-...` instead of `Receipt #: RCP-...`                                                                                 |
| **Conditional sections**     | Subtotal line only shown when there's a discount. Change lines only shown when > 0. LBP total only shown when > 0          |
| **Print CSS tightened**      | Font 12px → 10px, line-height 1.4 → 1.3 in all print windows (CheckoutModal + SaleDetailModal)                             |

### Batch Delete Fix (from earlier this session)

| Change                                    | Details                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **`ProductRepository.batchSoftDelete()`** | Single SQL `UPDATE ... SET is_active = 0 WHERE id IN (...)` — replaces 4010 sequential IPC calls |
| **`inventory:batch-delete` IPC handler**  | Admin auth check, returns `{ success, deleted }`                                                 |
| **Preload + types**                       | `batchDelete(ids)` bridge + `electron.d.ts` type                                                 |
| **ProductList rewrite**                   | `handleBatchDelete` uses bulk endpoint, checks `result.success`, shows notifications             |

### Search Prefill (from earlier this session)

| Change                             | Details                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Numeric → barcode, text → name** | `ProductSearch` detects if search term is numeric (routes to `prefillBarcode`) or text (routes to `prefillName`) when creating a product from POS |

### Migration Runner Gap-Fill Fix

| Change                       | Details                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **`getPendingMigrations()`** | Now checks ALL unapplied versions (not just `version > MAX`). Handles gaps from skipped migrations |
| **`runMigrations()` log**    | Fixed `currentVersion` reference error in log message                                              |

---

## ✅ Done This Sprint (March 4, 2026 — Schema Safety, Barcode Printing, Supplier Cleanup)

### Fix `is_settled` Missing from `create_db.sql`

| Change                           | Details                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`financial_services` columns** | Added `is_settled INTEGER NOT NULL DEFAULT 1`, `settled_at TEXT`, `settlement_id INTEGER` to table definition — matches what migration v31 adds for existing DBs |
| **Indexes**                      | Added `idx_financial_services_is_settled` and `idx_financial_services_provider_settled` indexes                                                                  |
| **`supplier_ledger` CHECK**      | Added `'SETTLEMENT'` to `entry_type` CHECK constraint — was missing despite v31 adding it for existing DBs                                                       |
| **Migration seed**               | Added `(31, 'add_settlement_tracking_to_financial_services')` to `schema_migrations` INSERT seed                                                                 |

### Fix Category Deletion Cascade (was destroying products)

| Change                            | Details                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **`create_db.sql` FK**            | Changed `products.category_id` from `ON DELETE CASCADE` to `ON DELETE SET NULL` — prevents accidental product deletion            |
| **Migration v41**                 | Full products table rebuild to change FK constraint from CASCADE to SET NULL. Recreates indexes. Includes `down()` rollback       |
| **`CategoryRepository.delete()`** | Now explicitly nullifies `category_id` and resets `category` to `'General'` on affected products before deleting the category row |
| **Migration seed**                | Added `(41, 'fix_category_cascade_to_set_null')` to `schema_migrations` INSERT seed                                               |

### Print Barcode Button in ProductForm

| Change                    | Details                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`jsbarcode` installed** | Added `jsbarcode@3.12.3` to `frontend/package.json` — CODE128 barcode generation                                                                                                        |
| **Print Barcode button**  | Appears in ProductForm footer (left side) when barcode field is non-empty. Generates CODE128 barcode on canvas, opens print window with 50mm x 30mm label layout including product name |
| **Print pattern**         | Uses same `window.open()` + `window.print()` pattern as CheckoutModal receipt printing                                                                                                  |

### Supplier Deletion Cleanup

| Change                                   | Details                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ProductSupplierRepository.delete()`** | Now looks up supplier name before deletion, then clears `products.supplier = NULL` for all products matching that supplier (case-insensitive). Prevents orphaned text references |

---

## ✅ Done This Sprint (March 4, 2026 — Product Suppliers System)

### Normalized Product Suppliers (`product_suppliers` table)

| Change                                    | Details                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migration v40**                         | Creates `product_suppliers` table (`id, name UNIQUE COLLATE NOCASE, sort_order, is_active, created_at`). Auto-imports existing unique supplier names from `products.supplier` column                    |
| **`ProductSupplierRepository`**           | New repository with `getAll()`, `getAllWithProductCount()`, `create()`, `update()`, `delete()`, `getOrCreate()`, `getNames()`. Singleton via `getProductSupplierRepository()`                           |
| **5 IPC handlers**                        | `inventory:get-product-suppliers`, `get-product-suppliers-full`, `create-product-supplier`, `update-product-supplier`, `delete-product-supplier` in `inventoryHandlers.ts`                              |
| **Auto-register on product save**         | `create-product` and `update-product` handlers call `supplierRepo.getOrCreate()` when a supplier name is provided — new suppliers are auto-added to `product_suppliers`                                 |
| **Preload + TypeScript types**            | 5 new IPC channel bindings in `preload.ts` + full types in `electron.d.ts`                                                                                                                              |
| **`create_db.sql` updated**               | `product_suppliers` table definition + migration marker `(40, 'create_product_suppliers')`                                                                                                              |
| **CategoriesManager — Suppliers section** | Second DataTable below categories showing Supplier Name + Products (count). Full CRUD: add, inline edit, delete, batch delete. Sky-blue accent to distinguish from categories                           |
| **Settings tab renamed**                  | "Categories" tab → "Categories & Suppliers"                                                                                                                                                             |
| **ProductForm — supplier combobox**       | Plain text input replaced with `<input>` + `<datalist>` combo. Loads supplier names from `getProductSuppliers()`. User can select existing or type new (auto-created on save via backend `getOrCreate`) |
| **`.toon` import fix**                    | `handleImportFile` in ProductList now passes `supplier: rec.supplier ?? null` to `createProduct()` — was omitted despite `parseToonFile` correctly parsing it                                           |
| **Build passes**                          | `yarn build` succeeds with zero errors                                                                                                                                                                  |

---

## ✅ Done This Sprint (March 4, 2026 — UI Scale / Zoom)

### Global UI Scale Feature

| Change                             | Details                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`webFrame` in preload.ts**       | Imported `webFrame` from `electron`. Exposed `display.setZoomFactor(factor)` and `display.getZoomFactor()` via `contextBridge` — synchronous calls, no IPC needed                              |
| **`electron.d.ts` types**          | Added `display: { setZoomFactor: (factor: number) => void; getZoomFactor: () => number }` to `ElectronAPI` interface                                                                           |
| **UI Scale setting in ShopConfig** | New "UI Scale" section below Navigation Style / POS Display. Preset buttons: 75%, 80%, 85%, 90%, 100%, 110%, 125%. Active scale highlighted in violet. Persisted to `localStorage("ui_scale")` |
| **Zoom applied on app startup**    | `App.tsx` reads `localStorage("ui_scale")` in `useEffect` on mount and calls `window.api.display.setZoomFactor()`. Scale persists across sessions and app restarts                             |
| **Non-Electron fallback**          | All `setZoomFactor` calls guarded with `window.api?.display?.setZoomFactor` — safe in browser dev mode                                                                                         |
| **Build passes**                   | `yarn build` succeeds with zero errors                                                                                                                                                         |

---

## ✅ Done This Sprint (March 4, 2026 — Private Repo Auto-Update)

### Auto-Update for Private GitHub Repo

| Change                                | Details                                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`private: true` in publish config** | Added `"private": true` to `build.publish` in `package.json` — tells `electron-updater` to use `PrivateGitHubProvider` which authenticates with GitHub API                                                                    |
| **`updater-config.ts` token file**    | New file `electron-app/updater-config.ts` exports `UPDATE_TOKEN` constant. Contains `__UPDATE_TOKEN__` placeholder that CI replaces with a real fine-grained PAT before TypeScript compilation                                |
| **`ensureUpdateToken()` helper**      | In `updaterHandlers.ts` — sets `process.env.GH_TOKEN` from the baked-in `UPDATE_TOKEN` if not already set by env. Called before every `autoUpdater` method (check, download, install)                                         |
| **CI token injection**                | All 3 build jobs (Windows, macOS ARM, macOS Intel) now have an "Inject update token" step that replaces `__UPDATE_TOKEN__` in `updater-config.ts` with the `UPDATE_TOKEN` repo secret before `yarn build`                     |
| **`getAppVersion()` path fix**        | Fixed dev-mode path from `../../package.json` to `../../../package.json` — at runtime `__dirname` is `electron-app/dist/handlers/` (3 levels from root, not 2). Diagnostics page now shows correct version instead of `1.0.0` |
| **Dev-mode token fallback**           | `fetchLatestRelease()` now also checks `UPDATE_TOKEN` as fallback when `GH_TOKEN`/`GITHUB_TOKEN` env vars are not set                                                                                                         |
| **Build passes**                      | `yarn build` succeeds with zero errors                                                                                                                                                                                        |

**Setup required**: Create a fine-grained GitHub PAT with read-only Contents scope, then add it as `UPDATE_TOKEN` repo secret in GitHub Settings > Secrets.

---

## ✅ Done This Sprint (March 4, 2026 — Diagnostics & Updater Dev Preview)

### Auto-Updater Dev Mode Preview

| Change                         | Details                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dev-mode GitHub API fetch**  | `updater:check` in dev mode fetches `https://api.github.com/repos/.../releases/latest` with `GH_TOKEN` Bearer auth instead of returning "disabled in dev mode" |
| **Structured release display** | `UpdatesPanel.tsx` shows tag name, published date, asset list with file sizes, color-coded icons per file type, "Up to date" / "Newer than local" badges       |
| **Dev-mode gating**            | Download/Install buttons hidden in dev mode; release info panel only shows in dev mode                                                                         |
| **`.env.example` updated**     | Added `GH_TOKEN` documentation for dev-mode updater preview                                                                                                    |

### Diagnostics Page Cleanup

| Change                             | Details                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Removed all refresh buttons**    | Removed Refresh buttons from UpdatesPanel, Backups section, and Sync Errors section                                        |
| **Auto-load on mount**             | UpdatesPanel auto-checks for updates on mount; Diagnostics loads sync errors and backups on mount                          |
| **Notification toasts for errors** | All UpdatesPanel errors (check/download/install) use `appEvents.emit("notification:show", ...)` instead of inline red divs |

### Additional Fixes

| Change                               | Details                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ElectronApiAdapter `deleteDraft`** | Added missing `deleteDraft` wiring in `ElectronApiAdapter.ts` — was the reason draft cancellation silently failed despite full stack being implemented |
| **POS search auto-focus on mount**   | `useEffect` focuses `searchInputRef` when POS component mounts — barcode scanner ready immediately                                                     |

---

## ✅ Done This Sprint (March 4, 2026 — POS UX Improvements)

### POS Receipt Printing, Auto-Add, Create-from-POS

| Change                                  | Details                                                                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Receipt print styling fix**           | `handlePrintReceipt()` now writes a full HTML document with `@page { size: 58mm auto; margin: 0 }` and zeroed body margins. Receipt prints at exact thermal receipt width with no browser chrome instead of filling 400px window                       |
| **Barcode scan auto-add to cart**       | When POS search is a barcode (6+ digit numeric string) and returns exactly 1 product, it is automatically added to cart. Search bar clears and re-focuses for rapid scanning. Text searches show results normally (no auto-add)                        |
| **"Create Item" button in empty state** | When POS search returns 0 results and the user has typed something, a "Create Item" button appears below "No products found". Clicking it opens `ProductForm` with the search text pre-filled as the product name                                      |
| **Create-from-POS flow**                | After saving a new product via the POS-embedded `ProductForm`, the product is automatically fetched and added to cart. `ProductForm` now accepts optional `prefillName` prop                                                                           |
| **Draft cancellation deletes from DB**  | Cancel button on CheckoutModal now deletes the draft from DB (not just closes the modal). New `deleteDraft` API added through full stack: Repository → Service → IPC Handler → Preload → Types → backendApi. Cart and `currentDraftId` reset on cancel |
| **Build passes**                        | `tsc --noEmit` + `yarn build` both succeed with zero errors                                                                                                                                                                                            |

---

## ✅ Done This Sprint (March 4, 2026 — Packaging Fixes)

### Electron Packaging — Production Path Resolution

| Change                                   | Details                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`loadFile` path fix**                  | `mainWindow.loadFile()` now uses `app.isPackaged` to resolve correct path: `../dist/index.html` in asar vs `../../frontend/dist/index.html` in dev. Previously always used dev path, causing packaged app to show blank/fail to launch |
| **`create_db.sql` path fix**             | `initializeDatabase()` uses `app.isPackaged` to find schema file: same directory in asar (`dist-electron/create_db.sql`) vs `../create_db.sql` in dev                                                                                  |
| **`create_db.sql` staging**              | `build-stage.cjs` now copies `electron-app/create_db.sql` into `dist-electron/` so it's included in the asar archive for fresh installs                                                                                                |
| **`@liratek/core` in root deps**         | Added `"@liratek/core": "workspace:*"` to root `package.json` dependencies so electron-builder includes it in asar (was only in `electron-app/package.json`)                                                                           |
| **`@liratek/core` symlink → real copy**  | `build-stage.cjs` replaces the workspace symlink with a real copy of `package.json` + `dist/` before packaging — electron-builder cannot follow symlinks into asar                                                                     |
| **Local launch test passed (macOS ARM)** | Unpacked app starts fully: DB init, migrations, all 27 IPC handler files registered, frontend loads correctly                                                                                                                          |
| **Version bump to 1.16.0**               | Fresh build with all path fixes included — v1.15.9 was built without these fixes due to uncommitted changes                                                                                                                            |

---

## ✅ Done This Sprint (March 3, 2026 — CI/CD session)

### Multi-Platform CI/CD Pipeline

| Change                                 | Details                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-platform workflow**            | Expanded `build.yml` from Windows-only to 5-job pipeline: `test → create-draft → [build-windows, build-mac-arm, build-mac-intel] → publish-release`                                                |
| **Draft release pattern**              | `create-draft` job pre-creates a draft GitHub Release before any build job runs. Eliminates race condition where parallel builds tried to create the same release simultaneously                   |
| **macOS ARM build**                    | `build-mac-arm` runs on `macos-15` (Apple Silicon runner), builds natively via `yarn ci:build:mac:arm`                                                                                             |
| **macOS Intel build**                  | `build-mac-intel` runs on `macos-15`, cross-compiles for x64 via `yarn ci:build:mac:intel` (`electron-builder --mac --x64`)                                                                        |
| **No artifact upload/download**        | electron-builder publishes directly to GitHub Release via `GH_TOKEN`. Bypasses `actions/upload-artifact` quota entirely. Each platform's channel file is separate (`latest.yml`, `latest-mac.yml`) |
| **Publish release job**                | Final `publish-release` job undrafts the release after all 3 build jobs succeed                                                                                                                    |
| **Tag handling for workflow_dispatch** | `create-draft` auto-determines tag from git ref or `package.json` version, targets `github.sha` for correct commit association                                                                     |
| **Deleted stale v1.15.5 release**      | Removed entire v1.15.5 release and tag (contained stale macOS artifacts from pre-icon-fix builds)                                                                                                  |
| **Version bump to 1.15.6**             | Fresh version for the new multi-platform release                                                                                                                                                   |

---

## ✅ Done This Sprint (March 3, 2026 — late session)

### DataTable & UX Polish

| Change                                         | Details                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DataTable `headerActions` prop**             | New `headerActions?: React.ReactNode` prop on `DataTable` — renders consumer-provided content on the left side of the header bar (same row as Excel/PDF export buttons). `ExportBar` layout changed from `justify-end` to `justify-between`                       |
| **Batch actions moved into DataTable header**  | Removed the standalone notification bar ("3 products selected") that appeared between the search toolbar and the table. Batch Edit and Delete buttons now live inside the DataTable header bar: `[ ✕ \| Batch Edit (N) \| Delete (N) .... Excel \| PDF ]`         |
| **Batch delete for products**                  | New `handleBatchDelete` in `ProductList.tsx` — loops over selected IDs, calls `api.deleteProduct()` for each, with confirmation prompt. "Delete (N)" button appears alongside "Batch Edit (N)" when items are selected                                            |
| **CategoriesManager same treatment**           | Removed standalone notification bar. "Delete Selected (N)" button moved into DataTable header via `headerActions`. Same `[ ✕ \| Delete Selected (N) ]` layout                                                                                                     |
| **DataTable export — Fragment handling**       | `extractCells` now handles `renderRow` implementations that return a React Fragment (e.g. Reports Daily Summary with expandable rows). Finds the first `<tr>` child inside the Fragment instead of assuming the top-level element is a `<tr>`                     |
| **DataTable export — all pages verified**      | Audited all 26 `renderRow` implementations across the codebase. 25/26 return `<tr>` directly (work as-is), 1 returns Fragment (Reports Daily Summary — now fixed). ProductList conditional `<td>` (admin cost column) confirmed safe (header is also conditional) |
| **CheckoutModal unified input styling**        | Payment USD/LBP inputs use same container-wrapper pattern as customer fields: `bg-slate-900` container, `p-1`, `rounded-xl`, `h-[52px]`, violet `focus-within` ring                                                                                               |
| **CheckoutModal pinned calculations**          | "Total Paid / Remaining / Change Due" section pinned to bottom of right panel (`shrink-0`), no longer scrolls away                                                                                                                                                |
| **CheckoutModal unified section labels**       | "Customer", payment method label, and "Payment Lines" all use identical `text-sm font-medium text-slate-400 uppercase tracking-wider`                                                                                                                             |
| **CheckoutModal customer field alignment**     | Changed from `flex gap-2` to `grid grid-cols-2 gap-2` with explicit `h-[52px]` for matching heights                                                                                                                                                               |
| **ShopConfig side-by-side settings**           | "Navigation Style" and "POS Product Display" merged into a single `grid grid-cols-2 gap-8` row                                                                                                                                                                    |
| **DataTable export excludes checkbox/actions** | `data-export-ignore` attribute on `<th>` for checkbox and action columns. Excel/PDF exports skip these columns automatically                                                                                                                                      |
| **DataTable export all pages**                 | Export now uses `table.getSortedRowModel().rows` (all data, ignoring pagination) instead of DOM scraping. `ExportBar` accepts `getExportData` callback; `tableExport.ts` functions accept `HTMLTableElement \| TableData`                                         |
| **Build passes**                               | `vite build` succeeds with zero TypeScript errors                                                                                                                                                                                                                 |

---

## ✅ Done This Sprint (March 3, 2026)

### Setup Wizard + Module-Linked UI

| Change                                           | Details                                                                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One-time Setup Wizard**                        | 4-step wizard (Account → Modules → Currencies → Users/WhatsApp) shown on first Electron launch. Skipped on subsequent launches via `setup_complete` setting key. Auto-logs in after completion                  |
| **`setupHandlers.ts`**                           | IPC handler `setup:isRequired` + `setup:complete` + `setup:reset`. Creates admin user, saves shop name, applies module/PM/currency/feature states, seeds `setup_complete = '1'` atomically                      |
| **`SetupContext`**                               | Wizard state persisted to `sessionStorage` — survives browser refresh mid-wizard                                                                                                                                |
| **`FeatureFlagContext`**                         | `feature_session_management` + `feature_customer_sessions` flags loaded from DB, refreshed via `feature-flags-changed` DOM event                                                                                |
| **Session Management toggle**                    | Opening/Closing modals + sidebar items + home grid cards hidden when `feature_session_management = disabled`. Configurable in Settings > Shop Config                                                            |
| **Customer Sessions toggle**                     | `MessengerStyleSessionButton` + `SessionFloatingWindow` hidden when `feature_customer_sessions = disabled`                                                                                                      |
| **Post-setup context refresh**                   | After wizard completes, both `modules-changed` + `feature-flags-changed` events fired so all contexts reload from fresh DB state                                                                                |
| **Module-aware Dashboard**                       | Total Debt card + Top Debtors panel hidden when `debts` disabled. Drawer cards filtered by module: OMT/Whish drawers → `ipec_katch`, Binance → `binance`, MTC/Alfa → `recharge`                                 |
| **Module-aware Closing/Opening**                 | Drawer list filtered per enabled modules — OMT_App, Whish_App, Binance, MTC/Alfa drawers hidden when their module is disabled                                                                                   |
| **Module-aware Profits**                         | Commissions tab hidden when no commission-generating module enabled                                                                                                                                             |
| **Module-aware TransactionHistory**              | Module filter dropdown shows only enabled module options                                                                                                                                                        |
| **Recharge sub-modules individually toggleable** | `recharge` (MTC/Alfa), `ipec_katch` (IPEC/Katch/OMT/Whish), `binance` — each individually enabled/disabled in ModulesManager and Setup Step 2. Group shows All Enabled / Partially Enabled / All Disabled badge |
| **DEBT payment method**                          | Default disabled, no longer mandatory. Blocks checkout when disabled (full payment required). Warning shown in checkout modal                                                                                   |
| **Recharge sub-modules default disabled**        | In setup wizard, all recharge sub-modules default to off                                                                                                                                                        |
| **`electron.d.ts` typed setup namespace**        | `window.api.setup.isRequired()`, `.complete()`, `.reset()` fully typed — removed all `as any` casts                                                                                                             |
| **Migration v38 fix**                            | Fixed `COLLATE NOCASE` syntax error in `add_category_id_fk_to_products` migration                                                                                                                               |
| **appEvents rename**                             | `openClosingModal` → `"closing:open"`, `openOpeningModal` → `"opening:open"` — consistent `noun:verb` convention across all 5 call sites                                                                        |
| **Notification center deduplication**            | Removed duplicate inline `window.notificationHistory` render — only `<NotificationHistory />` renders now                                                                                                       |
| **Import results → notifications**               | Inventory import results moved from in-page panel to notification center (success/warning/error per item)                                                                                                       |
| **DataTable shift-select**                       | Shift+click selects contiguous range in inventory table. Range replaces previous shift-range on subsequent shift-clicks. Works on both row click and checkbox click                                             |
| **Checkout single-PM simple mode**               | When only 1 payment method enabled: replaces payment-lines UI with clean USD + LBP field pair                                                                                                                   |
| **Batch edit modal alignment**                   | Field names/placeholders aligned to ProductForm. 2-col grid layout. "Unit" → "Quantity", "Min Stock Level" → "Min. Stock Alert"                                                                                 |
| **ProductForm 2-col layout**                     | Product Name no longer full-width — now half-width (col 1), Barcode in col 2, 2×4 grid layout                                                                                                                   |
| **`UINotification.id` type**                     | `string \| number` (was `string`) — single source of truth in `@liratek/ui`                                                                                                                                     |
| **329/329 tests pass**                           | All tests green; TypeScript zero errors across frontend, backend, core                                                                                                                                          |

---

## ✅ Done This Sprint (March 2, 2026 — late session)

### Inventory: Supplier Column + .toon File Import

| Change                     | Details                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Migration v34**          | `ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL` + index                                                                                                                                                    |
| **`ProductRepository`**    | `supplier_id` in `CreateProductData`, `UpdateProductData`, `ProductEntity`, `ProductDTO` (with `supplier_name` via LEFT JOIN). `findAllProducts()` does `LEFT JOIN suppliers` to resolve name. `createProduct()` + `updateProductFull()` store `supplier_id` |
| **`InventoryService`**     | `updateProduct()` signature extended with `supplier_id?`                                                                                                                                                                                                     |
| **`inventoryHandlers.ts`** | `ProductInput` + create/update calls pass `supplier_id` through                                                                                                                                                                                              |
| **`ProductForm`**          | Supplier `Select` dropdown added (full-width, first field). Loads all non-system suppliers via `api.getSuppliers()`. Edits pre-populate supplier                                                                                                             |
| **`ProductList`**          | **Supplier** column added (blue badge, `—` when none). **Import .toon** button (admin-only) triggers hidden file input                                                                                                                                       |
| **`.toon` parser**         | `parseToonFile()` handles `items[N,]{category,name,code,price,cost,supplier}:` header + CSV body. Imports each row via `api.createProduct()`, shows per-row success/error results panel                                                                      |
| **Import results UI**      | Dismissable panel showing ✅/❌ per row with count summary                                                                                                                                                                                                   |
| **TypeScript**             | `tsc --noEmit` passes on both `frontend` and `packages/core` (0 errors)                                                                                                                                                                                      |

---

## ✅ Done This Sprint (March 2, 2026 — evening session)

### [T-27] Payment Methods Everywhere — Debt Repayment + Expenses Cleanup

| Change                             | Details                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-payment debt repayment**   | `DebtRepository.addRepayment()` now accepts `payments?: RepaymentPaymentLine[]`. Each leg processed independently: drawer credit + per-leg RESERVE routing for Service Debt (WHISH leg → Whish_App → Whish_System, CASH leg → General → provider system drawer) |
| **Backward compatible**            | Legacy `paid_by_method` + `amount_usd`/`amount_lbp` path still works — legs are synthesised if `payments[]` not provided                                                                                                                                        |
| **`SPLIT` metadata**               | When multiple payment methods used, `transactions.metadata_json.paid_by` = `"SPLIT"` + full legs array stored                                                                                                                                                   |
| **FIFO attribution**               | `_markSalesPaidFIFO()` uses USD total from legs for accurate sale attribution                                                                                                                                                                                   |
| **`RepaymentPaymentLine` type**    | New interface exported from `DebtRepository` + `repositories/index.ts`                                                                                                                                                                                          |
| **`addRepaymentSchema` validator** | Added optional `payments[]` field; refine validates total > 0 from either classic fields or legs                                                                                                                                                                |
| **`DebtService.addRepayment()`**   | Accepts `payments?: RepaymentPaymentLine[]`, resolves `amountUSD`/`amountLBP` from legs when not explicit                                                                                                                                                       |
| **Electron `debtHandlers.ts`**     | `RepaymentPaymentLeg` interface + `payments?` field on `RepaymentData` — passes through to service                                                                                                                                                              |
| **`packages/ui` API types**        | `addRepayment` payload: `payments?` array added; `paid_amount_usd/lbp`, `drawer_name` made optional                                                                                                                                                             |
| **Debts repayment modal**          | Old USD/LBP dual-input + single `Select` replaced with `MultiPaymentInput`. Quick-fill "Full debt" ⚡ button autofills first CASH/USD line. Clean state reset on submit/cancel                                                                                  |
| **Expenses page**                  | `paid_by_method` dropdown hidden — replaced with static "💵 Cash" badge. Removed `usePaymentMethods` hook dependency. History table shows "Cash" directly                                                                                                       |
| **TypeScript**                     | `tsc --noEmit` passes on both `frontend` and `packages/core` (0 errors)                                                                                                                                                                                         |
| **13/13 DebtService tests pass**   | All existing tests green after changes                                                                                                                                                                                                                          |

---

## ✅ Done This Sprint (March 2, 2026)

### Split Payment Debt + Service Debt Routing + Profits Fixes (March 2)

| Change                                      | Details                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEBT leg in split payment**               | `FinancialServiceRepository` now inserts `debt_ledger` row for each DEBT leg in multi-payment SEND. Client auto-found-or-created from name+phone within same DB transaction |
| **Single payment DEBT**                     | DEBT option added to single-payment dropdown. Full DEBT handling: find/create client, insert `debt_ledger`, skip General RESERVE, skip OMT_System credit (unfunded)         |
| **Client validation**                       | Frontend blocks submit with toast if DEBT leg present but no client name or phone. Backend throws descriptive error as second safety net                                    |
| **`transactions.client_id` fix**            | After auto-creating client for debt, `UPDATE transactions SET client_id = ?` — fixes "Walk-in" bug in Profits by-client and Activity Log                                    |
| **System drawer for debt**                  | Single DEBT payment: `OMT_System` not credited (no funds received). Multi-payment with partial debt: `systemDrawerCredit = totalCollected - debtTotal`                      |
| **`perLegPmFee` scope fix**                 | Moved `totalNonCashPaid` + `perLegPmFee` to outer SEND scope so both payment-crediting and TRANSFER blocks can access them — fixed build error                              |
| **PM_FEE rows in multi-payment**            | Each non-cash multi-payment leg now gets a `PM_FEE` audit row proportional to its share of total non-cash paid. Used for Profits page PM_FEE reporting                      |
| **TRANSFER amount fix**                     | Multi-payment TRANSFER only sends `(legAmount - legPmFee)` to system drawer — PM fee stays in wallet as shop profit                                                         |
| **Profits by-cashier — Pending Profits**    | New column showing `⚠ $X.XX` amber for unsettled commissions per cashier                                                                                                    |
| **Profits by-client — Pending Profits**     | New column showing `⚠ $X.XX` amber for unsettled commissions per client                                                                                                     |
| **Profits by-client — correct client name** | Fixed "Walk-in" showing instead of real client name when DEBT auto-creates client                                                                                           |
| **Profits by-payment — No Profit status**   | Debt repayment CASH rows now show "No Profit" status + 0% share. Excluded from `totalAll` denominator                                                                       |
| **`is_debt_repayment_only` flag**           | SQL flag added to `getByPaymentMethod()` — detects when all entries for a method are `DEBT_REPAYMENT` transactions                                                          |
| **Debt repayment drawer routing**           | `DebtRepository.addRepayment()` now looks up originating provider (OMT/WHISH) and routes funds: `General +in → RESERVE out → OMT_System/Whish_System +credit`               |
| **`ServiceDebtDetailModal`**                | New component in `frontend/src/features/debts/components/` — shows full payment breakdown (provider, OMT fee, each payment leg, PM fee, debt amount)                        |
| **Eye button for Service Debt**             | `Debts/index.tsx` — sky-blue 👁 button on Service Debt rows. Fetches financial_service record + payment rows via `omt:get-by-id` + `omt:get-payments-by-transaction`        |
| **New IPC handlers**                        | `omt:get-by-id`, `omt:get-payments-by-transaction` — exposed in preload + typed in `electron.d.ts`                                                                          |
| **`getPaymentsByTransactionId()`**          | New public method on `TransactionRepository` + `PaymentRow` type — reads all payment legs for any transaction                                                               |
| **Commission Pending label**                | Shows `Commission Pending Settlement (OMT $X.XX)` with per-provider breakdown instead of generic "Commission (Pending)"                                                     |
| **Services UI — one-row toggle**            | Provider + service type combined into single 4-button tab row: `[OMT ↑] [OMT ↓] [WHISH ↑] [WHISH ↓]`                                                                        |
| **Services UI — History in stat row**       | History button moved into the stat cards row (pushed right with `ml-auto`)                                                                                                  |
| **Client/Phone/Reference one row**          | Three fields now in `grid-cols-3` single row in Services form                                                                                                               |
| **Provider fee in split payment total**     | `MultiPaymentInput` receives `totalAmount = sentAmount + providerFee` — payment lines must sum to full customer-pays amount                                                 |
| **Split payment summary**                   | Shows "Send Amount / Provider Fee / Total to Pay / Total Paid / Wallet Surcharge / Grand Total" breakdown                                                                   |
| **`MultiPaymentInput` infinite loop**       | Fixed `useEffect` deps: `pmFeesMap` → `JSON.stringify(pmFeesMap)`, `onExchangeRateChange` removed from deps                                                                 |
| **Phase 5 documented**                      | `docs/PAYMENT_METHOD_FEES_PLAN.md` — Debt repayment routing rules + profit share accuracy design                                                                            |
| **329/329 tests pass**                      | All backend tests green; TypeScript zero errors across frontend + core                                                                                                      |

---

## ✅ Done This Sprint (March 1, 2026)

### Payment Method Fees Feature + Services UI Overhaul (March 1 — evening session)

| Change                               | Details                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **General reserve routing bug fix**  | Non-cash SEND payments (OMT/WHISH/Binance wallet) no longer incorrectly debit `General`. Instead, a `TRANSFER` entry moves funds from the wallet drawer to the system drawer — `General` stays untouched    |
| **`isNonCashDrawerMethod()` helper** | New util in `payments.ts` — DB-driven with hardcoded fallback. Returns `true` for wallet methods, `false` for CASH/DEBT                                                                                     |
| **Migration v33**                    | Added `payment_method_fee REAL DEFAULT 0` and `payment_method_fee_rate REAL DEFAULT NULL` to `financial_services`                                                                                           |
| **PM fee drawer logic**              | SEND via non-cash: customer pays `amount + providerFee + pmFee`. Only `amount + providerFee` transfers to system drawer. `pmFee` stays in wallet drawer as **immediate realized profit**                    |
| **PM fee input**                     | Dollar input (not dropdown) auto-filled at 1% of amount, fully editable. Shown only for SEND + non-cash single payment                                                                                      |
| **Breakdown panel**                  | Shows PM fee line in both `includingFees` and normal modes with violet styling                                                                                                                              |
| **`includingFees` + PM fee**         | Back-calculates max sentAmount using tiered fee tables when both flags active                                                                                                                               |
| **History modal**                    | Transaction table moved out of right panel into a full-screen modal (CheckoutModal style). Opens via History button next to submit. Click outside or X to close                                             |
| **Services UI overhaul**             | Form redesigned — provider toggle as large colored cards, service type as icon tabs, streamlined layout                                                                                                     |
| **`PM_FEE` payments row**            | Inserted for audit/reporting — allows Profits page to filter PM fee income by `payments.method = 'PM_FEE'`                                                                                                  |
| **329/329 tests pass**               | All backend tests green; TypeScript zero errors                                                                                                                                                             |
| **Infinite loop fix**                | `MultiPaymentInput` — `useEffect` on `pmFeesMap` (new object ref every render) caused max-update-depth exceeded. Fixed by serialising to `JSON.stringify` key. Same fix for `onExchangeRateChange` dep.     |
| **Split payment PM fee**             | `MultiPaymentInput` gets `showPmFee`, `pmFeeRate`, `onPmFeesChange` props. Per non-cash leg: violet PM fee input, auto-filled 1%, editable, clears on CASH/DEBT. Summary shows Total PM Fees + Grand Total. |
| **Profits — PM_FEE row**             | "By Payment" tab: `PM_FEE` rows shown violet, labelled "Payment Method Fee (Wallet Surcharge)", status "Immediate Profit", note "In wallet drawer". Excluded from share % bar.                              |

---

### OMT/WHISH Commission & Drawer Bug Fixes (March 1 — late session)

| Fix                                               | Details                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEND commission no longer credited to General** | OMT/WHISH SEND commission is `is_settled = 0` at creation — no General credit until settlement                                               |
| **WHISH SEND General reserve**                    | Added `General -totalCollected` for WHISH SEND (was only doing it for OMT) — General now nets to $0                                          |
| **RECEIVE drawer**                                | OMT/WHISH RECEIVE only touches system drawer (`OMT_System -amount -commission`), General untouched                                           |
| **`is_settled` logic**                            | Both OMT/WHISH SEND and RECEIVE with commission → `is_settled = 0`; only non-OMT/WHISH or zero-commission → `is_settled = 1`                 |
| **Status badge**                                  | Services table shows `Profit Pending` for OMT/WHISH SEND rows too (not just RECEIVE)                                                         |
| **Including Fees breakdown**                      | Fixed stale `omtFee` showing wrong fee ($0.06 instead of $1) — now uses auto-looked-up fee as primary, user-entered only if explicitly valid |
| **By Payment tab**                                | Excluded internal system flows (OMT, WHISH, RESERVE, COMMISSION) — now shows real payment methods + two commission rows (Settled/Pending)    |
| **Profits page**                                  | All 5 financial_services SQL queries filter `is_settled = 1` only (overview, by module, by date, by user, by client)                         |
| **Pending tab**                                   | Shows unsettled commissions (both SEND and RECEIVE) grouped with totals + link to Supplier Ledger                                            |
| **Commissions tab**                               | Split realized vs pending; dual-ring pie chart (inner=realized, outer=amber pending); per-provider pending from `getUnsettledSummary()`      |
| **Dashboard**                                     | Amber pending settlement banner; earnings cards show `⚠ $X pending settlement` note                                                          |
| **Supplier Ledger**                               | Full settlement UI: unsettled txn list, checkbox select, live net calculation, confirmation modal                                            |
| **OMT RECEIVE**                                   | `OMT_System -= (amount + commission)` — OMT owes shop the full amount + commission                                                           |
| **Settlement net**                                | `netPayToOMT = totalOwed - commission` = correct formula in Supplier Ledger UI                                                               |
| **Lint/build/typecheck**                          | All 11 ESLint errors fixed; `yarn lint`, `yarn build`, `yarn typecheck` all pass                                                             |

---

### OMT Fee Tables & Auto-Calculation

- Corrected INTRA commission rate: `15%` → `10%` of OMT fee
- Added `INTRA_FEE_TIERS` and `WESTERN_UNION_FEE_TIERS` lookup tables to `omtFees.ts`
- Added `lookupOmtFee(serviceType, amount)` — auto-resolves fee from amount (no manual entry needed for INTRA/WU)
- `calculateCommission()` now uses 4 decimal places to preserve small profits (e.g. `$0.1000`)
- Backend auto-looks up fee when `omtFee` not provided in request
- Validator updated: `omtFee` optional for INTRA/WU (auto-looked up), still required for CASH_TO_BUSINESS, CASH_TO_GOV, OMT_CARD, OGERO_MECANIQUE
- All 44 FinancialService tests pass ✅

### Including Fees Flow (SEND Transactions)

- "Fee included in amount" checkbox in Services UI now shows a live breakdown panel:
  - **Checked**: Customer paid $100 → OMT sends $99 → fee $1 → profit $0.10
  - **Unchecked**: Sent amount $100 → fee $1 extra → customer pays $101 total
- Frontend deducts fee from amount before submitting when `includingFees = true`
- Backend receives the net `sentAmount` + the resolved `omtFee` separately
- `includingFees` field added to validator and `CreateFinancialServiceData` interface

### SEND Drawer Fix — OMT_System gets amount + fee

- Payment drawer (customer cash) now correctly receives `sentAmount + omtFee`
- `OMT_System` drawer correctly receives `sentAmount + omtFee` (full outflow to OMT)
- `General` reserve debited correctly with `-(sentAmount + omtFee)`
- Supplier ledger also records `amount + fee` for SEND transactions

### RECEIVE Drawer Fix — General no longer affected

- **Before**: OMT RECEIVE debited both `General -$100` AND `OMT_System -$100` ❌
- **After**: Only `OMT_System -$100`. General is completely untouched ✅
- Commission on RECEIVE is **not** posted to General at transaction time — it is tracked for settlement

### Commission Settlement Tracking (Drawer logic)

- SEND commission → credited to General immediately (shop earned it from customer) ✅
- RECEIVE commission → stored on the record for reporting, **no drawer movement** until settlement ✅

### Services UI Improvements

- Renamed "Money In" → **Send**, "Money Out" → **Receive**
- Swapped icons: Send uses `Send` icon (arrow out), Receive uses `ArrowDownToLine` (arrow down)
- OMT fee field shows auto-calculated fee as placeholder: `$1.00 (auto)`
- Live profit preview: `Your profit: $0.1000 (10% of $1.00 OMT fee)`
- Added **Fee column** in transaction history table (amber, shows OMT fee per row)
- Profit column now shows 4 decimal places (`$0.1000`)

---

## ✅ Completed This Sprint

### [T-60] OMT/WHISH Settlement System ✅

**Plan**: `docs/OMT_SETTLEMENT_PLAN.md`  
**Completed**: 2026-03-01

All 11 implementation phases completed:

| #   | Task                                                                                                                                              | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | DB migration v31: `is_settled`, `settled_at`, `settlement_id`, `SETTLEMENT` entry type                                                            | ✅     |
| 2   | Repository: `settleTransactions()`, `getUnsettledBySupplier()`, `getUnsettledSummaryByProvider()`, updated `getHistory()` + `createTransaction()` | ✅     |
| 3   | `ProfitService`: split `commission` (realized) vs `pending_commission`                                                                            | ✅     |
| 4   | `SupplierRepository.settleTransactions()` — atomic DB transaction                                                                                 | ✅     |
| 5   | `SupplierService.settleTransactions()`, `FinancialService.getUnsettledByProvider()`, `getUnsettledSummary()`                                      | ✅     |
| 6   | IPC handlers: `suppliers:unsettled-transactions`, `suppliers:unsettled-summary`, `suppliers:settle-transactions`                                  | ✅     |
| 7a  | Services history table: `⏳ Pending` / `✓ Settled` status badge                                                                                   | ✅     |
| 7b  | Services earnings cards: `⚠ $X.XXXX pending settlement` note                                                                                      | ✅     |
| 7c  | Dashboard: amber pending settlement banner with per-provider breakdown                                                                            | ✅     |
| 7d  | Supplier Ledger: full redesign with tabbed settlement UI + confirmation modal                                                                     | ✅     |
| 8   | Unit tests: `SupplierRepository.settlement.test.ts` (11 tests covering atomicity, guard, e2e)                                                     | ✅     |

**Key implementation details**:

- SEND commissions → `is_settled = 1` at creation (already in General)
- RECEIVE commissions → `is_settled = 0` until explicit settlement
- Dashboard shows amber banner when any provider has unsettled commissions
- Settlement is per-supplier, selecting individual transactions (no partial settlement)
- Net pay formula: `totalOwed − totalCommission = netPayToOMT`
- Atomic: if any step fails, entire settlement rolls back

---

## ✅ Completed — WHISH Fee System (2026-03-01)

### [T-34] WHISH Fee Calculation ✅

| Task                                                                                                                 | Status |
| -------------------------------------------------------------------------------------------------------------------- | ------ |
| Created `packages/core/src/utils/whishFees.ts` — `WHISH_FEE_TIERS`, `lookupWhishFee()`, `calculateWhishCommission()` | ✅     |
| DB migration v32 — `whish_fee` column on `financial_services`                                                        | ✅     |
| `FinancialServiceRepository` — auto-calc WHISH commission, store `whish_fee`, SEND drawer uses `whish_fee`           | ✅     |
| `CreateFinancialServiceData` — added `whishFee?` field                                                               | ✅     |
| Validator — `whishFee` optional (auto-looked up from table)                                                          | ✅     |
| Services UI — WHISH fee input with auto-placeholder, live profit preview (`Your profit: $0.1000`)                    | ✅     |
| Services UI — Including Fees checkbox works for WHISH (correct label "WHISH fee")                                    | ✅     |
| Services UI — Fee column shows `whish_fee` for WHISH, `omt_fee` for OMT                                              | ✅     |
| Services UI — Status badge (Profit Pending/Settled) works for WHISH RECEIVE                                          | ✅     |
| Supplier Ledger — WHISH settlement flow tied to same `is_settled` system                                             | ✅     |
| Profits page — WHISH pending commissions shown in Pending tab                                                        | ✅     |
| Dashboard — WHISH pending commissions shown in amber banner                                                          | ✅     |

**WHISH fee table**: $1–$100 → $1, $101–$200 → $2, $201–$300 → $3, $301–$1000 → $5, $1001–$2000 → $10, $2001–$3000 → $15, $3001–$4000 → $20, $4001–$5000 → $25  
**Commission rate**: 10% of WHISH fee (same as OMT INTRA/WU)

## 🟡 Medium Priority — After Settlement

### [T-27] Payment Methods Everywhere + Drawer Model Expansion

- Ensure all modules (Expenses, Debts, Exchange) support multi-payment input
- Drawer model: formalize which drawers exist per module

### [T-45] WhatsApp Cloud API Integration

- Send receipts, debt reminders, session summaries via WhatsApp
- Already has `WhatsAppService.ts` — needs API key wiring and UI triggers

### [T-28] Customer Visit Session + Cross-Module Linkage

- Link sessions to sales, services, custom services
- Session summary view per customer
- Already has `CustomerSessionRepository.ts` and `SessionContext.tsx`

---

## 🟢 Lower Priority — Backlog

### [T-22] Comprehensive E2E Test Coverage

- Playwright tests for: Services flow, Settlement flow, POS, Exchange
- Currently only `login`, `clients`, `debts`, `expenses`, `inventory`, `pos`, `exchange` specs exist

### [T-55] Payment Method Surcharge

- Optional surcharge % per payment method (e.g. card = +2%)
- Store in `payment_methods` table, apply at checkout

### [T-48] Profits Module Expansion

- Per-module profit breakdown charts (CommissionsChart, DashboardChart)
- Date range selector with export
- Commission analytics by OMT service type

### [T-51] Consolidated Reports Page

- Merge financial reports with exports
- PDF generation for closing, daily summaries, settlement receipts

### [T-03] Smart Barcode Duplicate Handler

- When scanning a barcode that already exists: show existing product, prompt to update stock

### [T-31] Expenses Simplification

- Remove "type" dropdown from expenses form (too granular for daily use)

### [T-50] Reusable Table Component

- Extract `DataTable` into a shared component with built-in sort, filter, export
- ✅ Shift-select already implemented (March 3)

---

## 🗄️ Completed in Previous Sprints (Reference)

| Sprint    | Task                                                       | Date         |
| --------- | ---------------------------------------------------------- | ------------ |
| Feb 19–28 | [T-25] Shared Core Backend Consolidation (`@liratek/core`) | Jan 25, 2026 |
| Feb 19–28 | [T-16] SQLCipher DB Encryption                             | Jan 25, 2026 |
| Feb 19–28 | [T-24] Unified Database Location                           | Jan 25, 2026 |
| Feb 19–28 | Phase 1: 3-Drawer Cash-Reserve Model (OMT SEND/RECEIVE)    | Feb 2026     |
| Feb 19–28 | Phase 2: OMT Service Types Update (8 types, INTRA/WU/etc.) | Feb 24, 2026 |
| Feb 19–28 | Phase 2a: OMT Fee Auto-Calculation (initial, 15% INTRA)    | Feb 27, 2026 |
| Feb 19–28 | Phase 3: Multi-Payment Method Support (MultiPaymentInput)  | Feb 27, 2026 |
| Feb 19–28 | Phase 4: Transaction History Page (`/transactions`)        | Feb 27, 2026 |
| Feb 19–28 | Phase 6: Services UI Redesign (compact layout)             | Feb 27, 2026 |
| Feb 19–28 | [T-53] Profit Audit & Pending Profit                       | Feb 28, 2026 |
| Feb 19–28 | [T-39] Recharge Consolidation                              | Feb 28, 2026 |
| Feb 19–28 | [T-36] Debts Page Redesign                                 | Feb 28, 2026 |

---

## 📋 What Comes After Settlement?

Once `[T-60] OMT Settlement System` is complete, the natural progression is:

1. **WHISH Fee Calculation [T-34]** — WHISH is the second biggest revenue provider after OMT. Once settlement exists, WHISH needs the same fee tables + settlement flow. The `is_settled` infrastructure will already be in place.

2. **Profits Module Expansion [T-48]** — With settlement tracking live, the Profits page can show rich analytics: realized vs pending per provider, settled-per-month charts, commission trend lines.

3. **WhatsApp Integration [T-45]** — Settlement receipts sent to the shop owner via WhatsApp after each OMT settlement. Also: debt reminders to clients. This is a high-value UX feature with existing service scaffolding.

4. **Customer Session Linkage [T-28]** — Link OMT/WHISH transactions to customer visit sessions for a complete per-customer financial history.

5. **Consolidated Reports [T-51]** — Generate PDF settlement receipts, closing reports, and daily summaries. The settlement data will make these reports much richer.

---

## 🧪 Test Health (as of 2026-03-01)

| Suite                       | Tests                                                     | Status      |
| --------------------------- | --------------------------------------------------------- | ----------- |
| Backend (Jest + ts-jest)    | 44 FinancialService                                       | ✅ All pass |
| Frontend (Jest)             | 101+                                                      | ✅ All pass |
| TypeScript (`tsc --noEmit`) | core, frontend                                            | ✅ 0 errors |
| E2E (Playwright)            | login, clients, debts, expenses, inventory, pos, exchange | Partial     |
