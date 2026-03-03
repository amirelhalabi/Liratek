# Current Sprint — March 2026

> **Last Updated**: 2026-03-03  
> **Sprint Start**: 2026-03-01  
> **Focus**: Setup Wizard, Module-Linked UI, UX Polish

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
