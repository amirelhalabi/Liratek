# Current Sprint — March 2026

> **Last Updated**: 2026-04-09  
> **Sprint Start**: 2026-03-01  
> **Focus**: Setup Wizard, Module-Linked UI, UX Polish, CI/CD + Packaging, Auto-Update, Sales Reporting, Recharge Page Overhaul, IPEC/KATCH/OMT App Implementation, Exchange Rate System

---

## 🚨 URGENT — Hardcoded `user_id: 1` System-Wide [T-57]

**Priority**: 🔴 CRITICAL — Affects audit trail integrity  
**Status**: Ready  
**Discovered**: 2026-04-09 during Dashboard stats bug investigation  
**Estimate**: 1–2 days

### Problem

14 occurrences across 7 files hardcode `user_id: 1` instead of using the authenticated user's ID. This means:

- All transactions appear to be created by user #1 (admin) regardless of who is logged in
- Audit trail is unreliable — cannot determine which cashier performed which action
- Multi-user environments have no accountability

### Reference Implementation

`electron-app/handlers/transactionHandlers.ts` (lines 54, 70) already does this correctly:

```typescript
const auth = requireRole(e.sender.id, ["admin"]);
if (!auth.ok) throw new Error(auth.error);
const userId = auth.userId ?? 1; // fallback only
```

### Files Requiring Changes

| #   | File                                                  | Occurrences | Methods                                                     | Layer      |
| --- | ----------------------------------------------------- | ----------- | ----------------------------------------------------------- | ---------- |
| 1   | `packages/core/src/repositories/SalesRepository.ts`   | 1           | `processSale()`                                             | Repository |
| 2   | `packages/core/src/repositories/LotoRepository.ts`    | 6           | `createTicket()`, `settleCheckpoint()`, `createCashPrize()` | Repository |
| 3   | `packages/core/src/repositories/ExpenseRepository.ts` | 1           | `createExpense()`                                           | Repository |
| 4   | `packages/core/src/repositories/ClosingRepository.ts` | 1           | `createDailyClosing()`                                      | Repository |
| 5   | `packages/core/src/repositories/ClientRepository.ts`  | 3           | `createClient()`, `updateClientFull()`, `deleteClient()`    | Repository |
| 6   | `electron-app/handlers/supplierHandlers.ts`           | 2           | `suppliers:add-ledger`, `suppliers:settle-transactions`     | Handler    |

### Implementation Plan

**Phase 1: Repository layer** (thread `userId` through method signatures)

1. Add `userId: number` parameter to all 12 affected repository methods
2. Replace hardcoded `1` with the parameter
3. Update service layer methods to accept and pass `userId`
4. Update all unit tests

**Phase 2: Handler layer** (extract `userId` from auth)

1. In each IPC handler, extract `userId` from `requireRole()` result: `const userId = auth.userId ?? 1;`
2. Pass `userId` to the service/repository call
3. Fix the 2 supplier handler occurrences directly (they bypass service layer)

**Phase 3: Verify**

1. Run full test suite
2. Test in dev mode with multiple users
3. Verify audit trail shows correct user IDs

### Acceptance Criteria

- [ ] All 14 hardcoded `user_id: 1` replaced with authenticated user's ID
- [ ] All repository methods accept `userId` as a parameter
- [ ] All IPC handlers extract `userId` from `requireRole()` result
- [ ] Fallback `?? 1` used only as safety net, not primary value
- [ ] All existing tests updated and passing
- [ ] New test: verify correct `userId` is stored in transaction records

---

## ✅ Done (April 9, 2026 — Dashboard Stats Bug Fix & Drawer Balance Recalculation)

### Dashboard Revenue Showing Tendered Amount Instead of Sale Value

| Change                    | Details                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root cause**            | `getDashboardStats()` in `SalesRepository.ts` used `SUM(paid_usd)` (the amount the customer hands over) instead of `SUM(final_amount_usd)` (the actual sale value). Example: Sale #372 had `final_amount_usd = 12` but `paid_usd = 50` — customer paid $50, got $33 USD + 450,000 LBP change |
| **Sales Revenue fix**     | Changed `SUM(paid_usd)` → `SUM(final_amount_usd)` in `getDashboardStats()`                                                                                                                                                                                                                   |
| **Sales Revenue LBP fix** | Changed `SUM(paid_lbp)` → `SUM(paid_lbp - COALESCE(change_given_lbp, 0))`                                                                                                                                                                                                                    |
| **Cash Collected fix**    | Split into separate query using `SUM(paid_usd - COALESCE(change_given_usd, 0))`                                                                                                                                                                                                              |
| **Chart data fix**        | Same `SUM(paid_usd)` → `SUM(final_amount_usd)` fix in `getChartData("Sales")`                                                                                                                                                                                                                |

### Drawer Balance Drift — One-Time Recalculation

| Change         | Details                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root cause** | Historical drift of +$10 USD and -85,000 LBP between `drawer_balances` table and `SUM(amount)` from `payments` journal. The incremental `upsertBalanceDelta` logic is correct — drift was from historical data |
| **Fix**        | Added one-time `getClosingRepository().recalculateDrawerBalances()` call in `initializeBackend()` on app startup                                                                                               |
| **Cleanup**    | Marked with `TODO: Remove this block in the next release` — runs once then should be removed                                                                                                                   |

### Pre-existing Loto Typecheck Errors Fixed

| Change                           | Details                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **`SettlementVerification.tsx`** | Removed 3 unused imports (`TrendingDown`, `TrendingUp`, `Trophy`). Fixed wrong API call: `getUnreimbursed()` → `getTotalUnreimbursed()` |

### Files Modified

| File                                                               | Change                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/core/src/repositories/SalesRepository.ts`                | Fixed `getDashboardStats()` and `getChartData()` to use `final_amount_usd` |
| `electron-app/main.ts`                                             | Added one-time `recalculateDrawerBalances()` on startup                    |
| `frontend/src/features/loto/components/SettlementVerification.tsx` | Fixed unused imports and wrong API call                                    |

---

## 🔥 High Priority — Next Tasks

### Exchange Rate System & OMT/Whish SEND/RECEIVE

| Task                               | Details                                                                                                                                                                              | Priority    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| **Fix exchange rate logic**        | Currently backwards! Customer pays 90,000 LBP/$ (higher rate), We pay 89,000 LBP/$ (lower rate). Update KatchForm, FinancialForm, TelecomForm to use correct rates                   | 🔴 CRITICAL |
| **OMT App SEND/RECEIVE feature**   | Add SEND/RECEIVE toggle to OMT App in Mobile Recharge module (similar to IPEC). SEND = customer sends abroad, RECEIVE = customer receives from abroad. High priority revenue feature | 🔴 HIGH     |
| **Whish App SEND/RECEIVE feature** | Add SEND/RECEIVE toggle to Whish App in Mobile Recharge module. Same logic as OMT App                                                                                                | 🔴 HIGH     |
| **OMT System Rate settings**       | Add dynamic rate configuration in Settings → OMT System Rate (separate from regular exchange rates). Used for OMT App SEND/RECEIVE transactions                                      | 🔴 HIGH     |
| **Whish System Rate settings**     | Add dynamic rate configuration in Settings → Whish System Rate (separate from regular exchange rates). Used for Whish App SEND/RECEIVE transactions                                  | 🔴 HIGH     |
| **Multi-currency payment logic**   | When customer pays in LBP → use 90,000 rate. When customer pays in USD → base price. When shop pays customer (refund/receive) in LBP → use 89,000 rate                               | 🔴 HIGH     |

**Files to modify**:

- `frontend/src/features/recharge/components/KatchForm.tsx` — Fix rate logic
- `frontend/src/features/recharge/components/FinancialForm.tsx` — Fix rate logic, add SEND/RECEIVE for OMT/Whish
- `frontend/src/features/recharge/components/TelecomForm.tsx` — Fix rate logic
- `frontend/src/features/settings/pages/Settings/` — Add OMT/Whish System Rate settings
- `packages/core/src/db/migrations/` — Add migration for OMT/Whish system rates

**Acceptance criteria**:

- [ ] Customer pays LBP → 90,000 LBP/$ rate applied
- [ ] Customer pays USD → No conversion (base price)
- [ ] Shop pays customer (refund/receive) in LBP → 89,000 LBP/$ rate applied
- [ ] OMT App has SEND/RECEIVE toggle
- [ ] Whish App has SEND/RECEIVE toggle
- [ ] OMT System Rate configurable in Settings
- [ ] Whish System Rate configurable in Settings
- [ ] All rates dynamically loaded from Settings/Database

---

### Sell Prices Update & Dev Mode Testing

| Task                              | Details                                                                                                                                                                             | Priority    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Update sell prices**            | Replace all `"sell": "0"` placeholders in `mobileServices.ts` with real selling prices for KATCH, IPEC, and OMT App items. Focus on positive margins (cost < sell)                  | 🔴 High     |
| **Dev mode testing**              | Run `yarn dev` and test full transaction flow for IPEC, KATCH, and OMT App. Verify database records, metadata_json structure, and history modal                                     | 🔴 High     |
| **IPEC predefined items catalog** | Already added to `mobileServices.ts` under `iPick` key with 150+ items across Alfa, MTC, Internet, and Gaming categories                                                            | ✅ Complete |
| **IPEC UI display**               | IPEC tab now shows correctly using KatchForm card grid UI. Search feature implemented with 100% test coverage (16/16 tests)                                                         | ✅ Complete |
| **KATCH selling prices**          | Pending — update all KATCH items in `mobileServices.ts` — replace placeholder `"sell": "0"` with actual selling prices. Focus: Alfa vouchers, MTC vouchers, gaming cards, DSL cards | 🔴 High     |
| **Alfa/MTC voucher sell prices**  | Critical for "Only Days" feature — accurate sell prices needed for profit calculation. Denominations: 3.6, 5.24, 8.65, 11.32, 17.06, 25.47, 86 USD                                  | 🔴 High     |
| **Price validation**              | Ensure all items have `cost < sell` (positive margin). Flag any items with zero or negative margin for review                                                                       | 🟠 Medium   |

**Files to modify**:

- `frontend/src/data/mobileServices.ts` — Update KATCH, IPEC, OMT App sell prices
- Manual testing in dev mode — verify transaction flow

**Acceptance criteria**:

- [ ] All KATCH, IPEC, OMT App items have realistic sell prices (no "0" placeholders)
- [ ] Profit calculations accurate for all items
- [ ] Dev mode test: IPEC, KATCH, OMT App transactions save correctly
- [ ] No TypeScript errors after price updates

---

## ✅ Done This Sprint (March 22, 2026 — IPEC/KATCH/OMT App Implementation & Search Feature)

### Recharge Page — Major Refactoring

| Change                                     | Details                                                                                                                                                                                   | Status  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **3300-line file split into 8 components** | Extracted `FinancialForm`, `KatchForm`, `TelecomForm`, `CryptoForm`, `ProviderTabs`, `ProviderStats`, `HistoryModal`, `CompactStats` into separate files. Main orchestrator now 586 lines | ✅ Done |
| **KATCH card grid UI**                     | New card-based layout replacing form dropdowns. Quantity controls on cards, accordion details for "Only Days" + returned credits. Category collapse headers                               | ✅ Done |
| **Alfa/MTC logos**                         | Downloaded/embedded SVG logos. Cards show brand logos instead of text subcategories. Logos inline in JS bundle via `vite-plugin-svgr`                                                     | ✅ Done |
| **Split payment integration**              | MultiPaymentInput added to KATCH sticky bottom bar. Toggle between single/split payment. Submits `payments` array to backend                                                              | ✅ Done |
| **Compact stats in header**                | Moved large stat cards to compact inline stats next to provider tabs. Three cards: Provider commission, All providers commission, Transaction count. Matching tab styling                 | ✅ Done |
| **Telecom voucher detection fix**          | Fixed `isTelecomVoucher()` to match flattened subcategory structure. "Only Days" checkbox + returned credits field now appear correctly                                                   | ✅ Done |
| **Flattened mobile topups structure**      | Removed unnecessary `voucher` nesting layer. `Katsh.alfa` and `Katsh.mtc` directly contain items instead of `Katsh.alfa.voucher`                                                          | ✅ Done |

### Voice Bot — Relocated to TopBar

| Change                      | Details                                                                                                                                                      | Status  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **Removed floating button** | Deleted bottom-right floating FAB entirely from codebase                                                                                                     | ✅ Done |
| **TopBar integration**      | Voice Bot button now in TopBar left section (replacing non-functional global search). Inline button style with icon + "Voice Bot" text                       | ✅ Done |
| **Panel repositioned**      | Chat panel now appears directly below TopBar button (absolute positioning) instead of fixed bottom-right. Shifted right with `-right-4` for better alignment | ✅ Done |

### Files Modified

| File                                                            | Change                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `frontend/src/features/recharge/pages/Recharge/index.tsx`       | Refactored to 586 lines, imports 8 components                      |
| `frontend/src/features/recharge/components/*.tsx` (8 new files) | Extracted form components, stats, tabs, history modal              |
| `frontend/src/features/recharge/types/index.ts`                 | Shared types and constants (ProviderConfig, ALFA_GIFT_TIERS, etc.) |
| `frontend/src/data/mobileServices.ts`                           | Flattened KATCH mobile topups structure, removed `voucher` nesting |
| `frontend/src/assets/logos/*.svg` (2 new files)                 | Alfa (red) and MTC Touch (blue) brand logos                        |
| `frontend/src/components/VoiceBotButton.tsx`                    | Removed floating button variant, only inline TopBar button         |
| `frontend/src/shared/components/layouts/TopBar.tsx`             | Removed global search, added VoiceBotButton                        |
| `frontend/src/app/App.tsx`                                      | Removed global VoiceBotButton render                               |
| `frontend/vite.config.ts`                                       | Added `vite-plugin-svgr` for SVG imports                           |
| `package.json`                                                  | Added `vite-plugin-svgr` dependency                                |

---

## ✅ Done This Sprint (March 5, 2026 — Receipt Branding, Barcode Print Overhaul)

### Receipt Branding Footer

| Change                                              | Details                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`Powered by LiraTek • 81077357` on all receipts** | Added centered branding line after "Thank You!" (58mm) and "THANK YOU FOR YOUR BUSINESS" (80mm), before the final `===` row |

### Barcode Print Overhaul

| Change                      | Details                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product name removed**    | Barcode label no longer shows the product name — only the barcode image with `displayValue: true` rendering the number below the bars                                      |
| **Direct print pattern**    | Replaced inline `<script>` polling with direct `document.write → close → focus → print()` — same proven pattern as receipt printing                                        |
| **Multi-copy printing**     | New copy count input (number field) next to "Print Barcode" button. Each copy renders as a separate `<div>` with `page-break-after: always` CSS — printer outputs N labels |
| **Auto-fill from quantity** | Copy count auto-fills from `product.stock_quantity` when editing an existing product. Defaults to 1 for new products. Clamped to 1–999                                     |

### Version Bump

| Change               | Details                  |
| -------------------- | ------------------------ |
| **1.18.9 → 1.18.10** | Bumped in `package.json` |

### Files Modified

| File                                                              | Change                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `package.json`                                                    | Version bump to 1.18.10                                                        |
| `frontend/src/features/sales/utils/receiptFormatter.ts`           | Added branding footer to both `formatReceipt58mm()` and `formatReceipt80mm()`  |
| `frontend/src/features/inventory/pages/Inventory/ProductForm.tsx` | Barcode print: removed product name, direct print, multi-copy with count input |

---

## ✅ Done This Sprint (March 5, 2026 — Bug Fixes, POS UX, .toon Import Fix)

### Test Fix After PageHeader Standardization

| Change                                     | Details                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`CustomServices.test.tsx` mock updated** | Added `PageHeader` to `@liratek/ui` mock, changed assertion from `"Custom Services"` to `"Services"` to match new PageHeader title. All 431 tests pass |

### POS Search Bar — Clear on Checkout Close

| Change                           | Details                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **`checkout:closed` event**      | New `appEvent` emitted from all 3 close paths in `POS/index.tsx`: complete sale, save draft, cancel                     |
| **`ProductSearch.tsx` listener** | Listens for `checkout:closed` and calls `setSearch("")` — clears the search bar when checkout modal closes by any means |

### Product Stock Quantity Update Fix

| Change                                 | Details                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Root cause**                         | `stock_quantity` was sent by the frontend but silently dropped at 3 backend layers: handler, service, and repository |
| **`UpdateProductData` interface**      | Added `stock_quantity?: number` to `ProductRepository.ts`                                                            |
| **`updateProductFull()` SQL**          | Added `stock_quantity = COALESCE(?, stock_quantity)` — `undefined` preserves existing value, `0` sets to zero        |
| **`InventoryService.updateProduct()`** | Added `stock_quantity` to type signature and forwarded to repo                                                       |
| **`inventoryHandlers.ts`**             | Added `stock_quantity: product.stock_quantity` to service call                                                       |

### .toon File Corruption Fix (21 Products)

| Change                             | Details                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root cause**                     | `extract_items.py` encoder wrapped comma-containing fields in `"..."` but did not escape `"` (inch marks) inside values. Product names like `10"` produced `"10\" Tainbow..."` — breaking the parser |
| **`parseCsvLine` fix**             | Added `\"` (backslash-quote) handling in `ProductList.tsx` for forward compatibility with escaped quotes                                                                                             |
| **`extract_items.py` encoder fix** | `escape()` now escapes `"` → `\"` inside values, and wraps in double quotes if value contains commas or had quote chars — prevents future corruption                                                 |
| **Sanitize script**                | Created `scripts/sanitize_toon.py` — replaces `\"` with `'` inside quoted fields, unwraps quotes if no commas remain. Produced `item.sanitized.toon` with all 21 corrupted lines fixed               |

### Version Bump

| Change              | Details                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **1.18.6 → 1.18.7** | Bumped in `package.json`. Committed as `ff340f7` but push failed (cached credential auth issue — needs re-auth) |

### Files Modified

| File                                                                                           | Change                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `package.json`                                                                                 | Version bump to 1.18.7                                |
| `frontend/src/features/custom-services/pages/CustomServices/__tests__/CustomServices.test.tsx` | Added PageHeader mock, fixed assertion                |
| `frontend/src/features/sales/pages/POS/index.tsx`                                              | Emit `checkout:closed` from 3 close paths             |
| `frontend/src/features/sales/pages/POS/components/ProductSearch.tsx`                           | Listen `checkout:closed` → clear search               |
| `packages/core/src/repositories/ProductRepository.ts`                                          | Added `stock_quantity` to `UpdateProductData` and SQL |
| `packages/core/src/services/InventoryService.ts`                                               | Added `stock_quantity` to `updateProduct`             |
| `electron-app/handlers/inventoryHandlers.ts`                                                   | Pass `stock_quantity` to service                      |
| `frontend/src/features/inventory/pages/Inventory/ProductList.tsx`                              | `parseCsvLine` handles `\"` escaping                  |
| `scripts/extract_items.py`                                                                     | Fixed `escape()` to handle `"` in values              |
| `scripts/sanitize_toon.py`                                                                     | **NEW** — One-off toon file sanitizer                 |

---

## ✅ Done This Sprint (March 5, 2026 — PageHeader Standardization)

### Unified Page Headings with `PageHeader` Component

All pages now use the shared `PageHeader` component from `@liratek/ui` with the correct icon and label matching the sidebar module entries.

| Page            | Old Heading                                 | New `PageHeader`                                                          | Icon Change             | Has Actions?          |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------- | ----------------------- | --------------------- |
| Exchange        | Raw `<h1>` "Currency Exchange"              | `<PageHeader icon={RefreshCw} title="Exchange" />`                        | — (already RefreshCw)   | No                    |
| OMT/Whish       | `<PageHeader title="Financial Services">`   | `<PageHeader icon={Send} title="OMT/Whish" />`                            | — (already Send)        | No                    |
| Maintenance     | Raw `<h1>` "Maintenance & Repairs"          | `<PageHeader icon={Wrench} title="Maintenance" actions={...} />`          | Wrench (kept)           | Yes: "New Job" button |
| Custom Services | Raw `<h1>` "Custom Services"                | `<PageHeader icon={Briefcase} title="Services" actions={...} />`          | Briefcase (kept)        | Yes: refresh button   |
| Expenses        | Raw `<h1>` "Expenses & Losses"              | `<PageHeader icon={Banknote} title="Expenses" />`                         | DollarSign → Banknote   | No                    |
| Settings        | Raw `<h1>` "Application Settings"           | `<PageHeader icon={SettingsIcon} title="Settings" />`                     | Settings (kept)         | No                    |
| Transactions    | Inline custom heading "Transaction History" | `<PageHeader icon={ClipboardList} title="Transactions" subtitle="..." />` | History → ClipboardList | No (has subtitle)     |

Previously completed in same session: Dashboard (LayoutDashboard), Debts (BookOpen), Reports (BarChart2).

### Files Modified

| File                                                                   | Change                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `frontend/src/features/exchange/pages/Exchange/index.tsx`              | Added `PageHeader` import, replaced raw `<h1>`                                  |
| `frontend/src/features/services/pages/Services/index.tsx`              | Changed title "Financial Services" → "OMT/Whish"                                |
| `frontend/src/features/maintenance/pages/Maintenance/index.tsx`        | Added `PageHeader` import, replaced heading block with `PageHeader` + `actions` |
| `frontend/src/features/custom-services/pages/CustomServices/index.tsx` | Added `PageHeader` import, replaced heading block with `PageHeader` + `actions` |
| `frontend/src/features/expenses/pages/Expenses/index.tsx`              | Added `PageHeader` + `Banknote` imports, replaced `DollarSign` heading          |
| `frontend/src/features/settings/pages/Settings/index.tsx`              | Added `PageHeader` import, replaced raw `<h1>`                                  |
| `frontend/src/features/transactions/pages/TransactionHistory.tsx`      | Added `PageHeader` + `ClipboardList` imports, replaced inline heading block     |

---

## ✅ Done This Sprint (March 5, 2026 — Gradient Background on All Pages)

### Unified Page Background — Gradient Theme

| Change                               | Details                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`<main>` wrapper simplified**      | Removed `p-6` and `bg-slate-950` from `<main>` in both `LeftPanelLayout` and `HomeViewLayout`. Each page now owns its own padding and background                                           |
| **Gradient background on all pages** | All 15 page components now use `min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6` as part of their outermost wrapper — consistent dark gradient across the app |
| **TransactionHistory unchanged**     | Already had the target gradient styling — served as the reference for all other pages                                                                                                      |

### Files Modified

| File                                                                   | Change                                   |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| `frontend/src/shared/components/layouts/LeftPanelLayout.tsx`           | Removed `p-6 bg-slate-950` from `<main>` |
| `frontend/src/shared/components/layouts/HomeViewLayout.tsx`            | Removed `p-6 bg-slate-950` from `<main>` |
| `frontend/src/features/dashboard/pages/Dashboard.tsx`                  | Added gradient bg + p-6                  |
| `frontend/src/shared/components/layouts/HomeGrid.tsx`                  | Added gradient bg + p-6                  |
| `frontend/src/features/inventory/pages/Inventory/ProductList.tsx`      | Added gradient bg + p-6                  |
| `frontend/src/features/clients/pages/Clients/ClientList.tsx`           | Added gradient bg + p-6                  |
| `frontend/src/features/sales/pages/POS/index.tsx`                      | Added gradient bg + p-6                  |
| `frontend/src/features/debts/pages/Debts/index.tsx`                    | Added gradient bg + p-6                  |
| `frontend/src/features/exchange/pages/Exchange/index.tsx`              | Added gradient bg + p-6                  |
| `frontend/src/features/services/pages/Services/index.tsx`              | Added gradient bg + p-6                  |
| `frontend/src/features/recharge/pages/Recharge/index.tsx`              | Added gradient bg + p-6                  |
| `frontend/src/features/maintenance/pages/Maintenance/index.tsx`        | Added gradient bg + p-6                  |
| `frontend/src/features/custom-services/pages/CustomServices/index.tsx` | Added gradient bg + p-6                  |
| `frontend/src/features/expenses/pages/Expenses/index.tsx`              | Added gradient bg + p-6                  |
| `frontend/src/features/settings/pages/Settings/index.tsx`              | Added gradient bg + p-6                  |
| `frontend/src/features/reports/pages/Reports.tsx`                      | Replaced `p-6` with gradient bg          |
| `frontend/src/features/profits/pages/Profits.tsx`                      | Replaced `p-6` with gradient bg          |

---

## ✅ Done This Sprint (March 5, 2026 — Barcode Print Fix, Reports & Transactions Sidebar)

### Barcode Print Dialog Fix

| Change                                 | Details                                                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Removed `printWindow.close()` call** | `handlePrintBarcode` in `ProductForm.tsx` was calling `printWindow.close()` immediately after `printWindow.print()`. In Electron, this cancels the print dialog before it renders. Now the window stays open and the user closes it after printing |

### Reports & Transactions Added to Sidebar

| Change                                       | Details                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`reports` module in `create_db.sql`**      | `INSERT OR IGNORE INTO modules` — key `reports`, label "Reports", icon `BarChart2`, route `/reports`, sort_order 14, admin-only. Fresh installs now include it |
| **`transactions` module in `create_db.sql`** | Key `transactions`, label "Transactions", icon `ClipboardList`, route `/transactions`, sort_order 15, admin-only                                               |
| **Migration v42**                            | `add_reports_and_transactions_modules` — inserts both modules for existing databases via `INSERT OR IGNORE`. Includes `down()` rollback                        |
| **Sidebar icon map**                         | Added `ClipboardList` import and iconMap entry in `Sidebar.tsx` (`BarChart2` was already present)                                                              |

### Files Modified

| File                                                              | Change                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `frontend/src/features/inventory/pages/Inventory/ProductForm.tsx` | Removed `printWindow.close()` after `printWindow.print()`      |
| `electron-app/create_db.sql`                                      | Added `reports` and `transactions` module rows + migration v42 |
| `packages/core/src/db/migrations/index.ts`                        | Added migration v42 (insert reports + transactions modules)    |
| `frontend/src/shared/components/layouts/Sidebar.tsx`              | Added `ClipboardList` icon import and iconMap entry            |

---

## ✅ Done This Sprint (March 5, 2026 — Shop Info on Receipts, Update UX Cleanup)

### Shop Phone & Location in Settings and Receipts

| Change                                  | Details                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ShopConfig: phone & location fields** | Two new fields in Settings > Shop Config: "Phone Number" and "Location", side by side below Shop Name. Saved as `shop_phone` and `shop_location` in `system_settings`. Empty by default    |
| **Receipt header: phone & location**    | `formatReceipt58mm()` and `formatReceipt80mm()` now print location and phone centered below the shop name in the header (only if non-empty)                                                |
| **`useShopInfo` hook**                  | New `useShopInfo()` hook returns `{ name, phone, location }`. Fetches all three from `system_settings` with global cache. `useShopName()` is now a thin wrapper for backward compatibility |
| **Cache invalidation on save**          | `invalidateShopInfo()` called after saving ShopConfig — receipts immediately pick up new values                                                                                            |

### Update Notification Bar Removed

| Change                           | Details                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`UpdateNotifier` removed**     | Deleted the violet top-of-screen notification bar from `App.tsx`. Update status is now only visible in Settings > Diagnostics > Updates                                                                                   |
| **`UpdatesPanel` fixes**         | Fixed push event listener signatures (was `(data)`, now `(_event, data)`) — download progress now updates correctly. Added immediate downloading state on click and indeterminate pulsing bar before first progress event |
| **Version guard in push events** | `onUpdateAvailable` listener in `UpdatesPanel` now skips if remote version matches current — prevents false "update available" notifications                                                                              |

### Files Modified

| File                                                                   | Change                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `package.json`                                                         | Version bump 1.18.5 -> 1.18.6                                             |
| `frontend/src/hooks/useShopName.ts`                                    | New `useShopInfo()` hook, `invalidateShopInfo()`, `useShopName()` wrapper |
| `frontend/src/features/settings/pages/Settings/ShopConfig.tsx`         | Added phone/location fields, save/load, cache invalidation                |
| `frontend/src/features/sales/utils/receiptFormatter.ts`                | `ReceiptData` + header: shop_phone, shop_location (58mm & 80mm)           |
| `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx`   | Pass shopInfo phone/location to receipt                                   |
| `frontend/src/features/sales/pages/POS/components/SaleDetailModal.tsx` | Pass shopInfo phone/location to receipt                                   |
| `frontend/src/app/App.tsx`                                             | Removed `UpdateNotifier` component entirely                               |
| `frontend/src/features/settings/pages/Settings/UpdatesPanel.tsx`       | Fixed event signatures, immediate download state, version guard           |

---

## ✅ Done This Sprint (March 5, 2026 — Updater Version Fix, Menu Bar Removal)

### Updater Version Comparison Fix (Showing "Update Available" When Already on Latest)

| Change                                     | Details                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root cause**                             | `electron-updater` fires `update-available` even when remote version equals local version. Combined with stale closure in `useCallback`, the frontend always saw `status?.version` as `null` |
| **`UpdatesPanel.tsx` — stale closure fix** | Added `status?.version` to `useCallback` dependency array for `check()` — version comparison at line 79 now uses fresh state instead of always-null stale value                              |
| **`App.tsx` — `UpdateNotifier` guard**     | Fetches `currentVersion` from `updater.getStatus()` on mount. `onUpdateAvailable` listener skips notification if `info.version === currentVersion`                                           |
| **`updaterHandlers.ts` — backend guard**   | After `autoUpdater.checkForUpdates()`, compares `remoteVersion === localVersion`. Returns `{ updateInfo: null, upToDate: true }` when versions match — prevents unnecessary frontend events  |

### Hide Default Electron Menu Bar

| Change                              | Details                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`autoHideMenuBar: true`**         | Added to `BrowserWindow` options in `createWindow()` — menu bar hidden by default (can still be toggled with Alt key on Windows)                       |
| **`Menu.setApplicationMenu(null)`** | Called in `app.whenReady()` for production builds only — completely removes File/Edit/View/Window/Help menu. Dev mode retains menu for DevTools access |

### Files Modified

| File                                                             | Change                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `electron-app/main.ts`                                           | `Menu` import, `autoHideMenuBar: true`, `Menu.setApplicationMenu(null)` in production |
| `electron-app/handlers/updaterHandlers.ts`                       | Version comparison guard in `updater:check` handler                                   |
| `frontend/src/app/App.tsx`                                       | `UpdateNotifier` fetches currentVersion, filters same-version updates                 |
| `frontend/src/features/settings/pages/Settings/UpdatesPanel.tsx` | Fixed `useCallback` dependency for `check()`                                          |

---

## ✅ Done This Sprint (March 5, 2026 — Three Bug Fixes: Updater, Barcode Print, Receipt Print)

### Download Progress Bar Fix

| Change                          | Details                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immediate downloading state** | `handleDownload()` now sets `phase: "downloading"` immediately on click, before awaiting the IPC response. Previously relied solely on `download-progress` events which may not fire with full downloads |
| **Visual progress bar**         | Added a 32px-wide progress bar in the update notification banner. Shows animated fill when percent > 0, or a pulsing indeterminate state when no progress events received yet                            |
| **Error recovery**              | On download failure, state reverts to "available" instead of staying stuck on "downloading 0%"                                                                                                           |

### Barcode Printing Fix (5 Empty Pages)

| Change                                  | Details                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wait for image load before printing** | `printWindow.print()` was called synchronously before the barcode `<img>` data URL loaded. Now waits for `onload` event via polling (`setTimeout` loop checking `_barcodeReady` flag) |
| **Fixed `min-height: 100vh` in print**  | Print `@media` block now sets `min-height: 30mm; overflow: hidden` — prevents the 100vh body from creating multiple pages at the tiny 50mm x 30mm label page size                     |

### Receipt Printing — Bolder & Wider

| Change                                | Details                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Font weight: bold**                 | Added `font-weight: bold` to `pre` element in both `CheckoutModal` and `SaleDetailModal` print CSS — text is now clearly readable on thermal receipts |
| **Paper width: 58mm -> 72mm**         | Increased `@page size` and `body width` from `58mm` to `72mm` in both print locations — fills more of the thermal paper width                         |
| **Font size: 10px -> 11px**           | Slightly larger font for better readability on thermal paper                                                                                          |
| **Line height: 1.3 -> 1.4**           | Increased line spacing for clearer separation                                                                                                         |
| **Receipt formatter width: 32 -> 38** | `formatReceipt58mm()` char width increased from 32 to 38 characters — utilizes the wider paper properly                                               |

### Files Modified

| File                                                                   | Change                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `frontend/src/app/App.tsx`                                             | Download progress: immediate state + visual progress bar |
| `frontend/src/features/inventory/pages/Inventory/ProductForm.tsx`      | Barcode print: wait for img load + fix min-height        |
| `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx`   | Receipt CSS: bold, wider, larger font                    |
| `frontend/src/features/sales/pages/POS/components/SaleDetailModal.tsx` | Receipt CSS: bold, wider, larger font (duplicated)       |
| `frontend/src/features/sales/utils/receiptFormatter.ts`                | Receipt width: 32 -> 38 characters                       |

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

## 🔴 High Priority — Next Sprint

### [T-61] Loto Module Implementation

**Priority**: HIGH | **Estimated Time**: 2-3 days | **Status**: Not started

Add a lottery ticket sales module with the following features:

- **Ticket Sales**: Record individual loto ticket sales with ticket number, amount (LBP), payment method/currency
- **Commission Tracking**: 4.45% commission on each sale (configurable) — shop profit
- **Prize Payouts**: Mark tickets as won, record prize amount, pay customer from General drawer, supplier reimburses (reduces debt)
- **Monthly Fee**: Auto-record 1,400,000 LBP "ajar makana" machine rental fee on 1st Monday of each month (configurable start date, fee amount, commission rate)
- **Supplier Integration**: Loto supplier appears in Settings > Suppliers with full ledger history and balance tracking (owed in LBP)
- **Reporting**: On Loto page — total sales, commission earned, monthly fees, prizes paid, net owed to supplier (with date range filters)
- **Module Toggle**: Enable/disable from Settings > Modules; hidden from sidebar/HomeGrid when disabled
- **Drawer**: Uses General drawer only (no separate loto drawer)

**Files**: See `docs/LOTO_IMPLEMENTATION_PLAN.md` for full technical specification

---

## 🟡 Medium Priority — After Loto

### [T-62] Accessory Sales & Profit Reporting Module

**Priority**: MEDIUM | **Estimated Time**: 1-2 days | **Status**: Not started

Create a dedicated reporting module for accessory sales analytics:

- **Top Selling Accessories**: Ranked list of accessories by units sold and revenue
- **Profit per Category**: Breakdown of profit margins by accessory category
- **Daily Accessory Sales**: Day-by-day sales volume with trend visualization
- **Date Range Filters**: Custom date ranges, comparison with previous period
- **Export**: Excel/PDF export of all reports
- **Dashboard Widgets**: Summary cards showing top performers on main dashboard

**Integration Points**:

- Links to existing inventory module (accessory products)
- Uses existing sales/transactions data
- Integrates with Profits module for margin calculations

---

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

1. **Loto Module [T-61]** — NEW high-priority module for lottery ticket sales with commission tracking, prize payouts, and auto-recorded monthly machine fees. See `docs/LOTO_IMPLEMENTATION_PLAN.md`.

2. **Alfa Gift Card [T-63]** — NEW feature in Recharge module for selling Alfa data gift cards. 8 predefined tiers, LBP-based profit from exchange rate spread. See `docs/ALFA_GIFT_IMPLEMENTATION_PLAN.md`.

3. **Accessory Reporting [T-62]** — NEW dedicated reporting for accessory sales analytics: top sellers, profit per category, daily trends.

4. **WHISH Fee Calculation [T-34]** — WHISH is the second biggest revenue provider after OMT. Once settlement exists, WHISH needs the same fee tables + settlement flow. The `is_settled` infrastructure will already be in place.

5. **Profits Module Expansion [T-48]** — With settlement tracking live, the Profits page can show rich analytics: realized vs pending per provider, settled-per-month charts, commission trend lines.

6. **WhatsApp Integration [T-45]** — Settlement receipts sent to the shop owner via WhatsApp after each OMT settlement. Also: debt reminders to clients. This is a high-value UX feature with existing service scaffolding.

7. **Customer Session Linkage [T-28]** — Link OMT/WHISH transactions to customer visit sessions for a complete per-customer financial history.

8. **Consolidated Reports [T-51]** — Generate PDF settlement receipts, closing reports, and daily summaries. The settlement data will make these reports much richer.

---

## 🧪 Test Health (as of 2026-03-01)

| Suite                       | Tests                                                     | Status      |
| --------------------------- | --------------------------------------------------------- | ----------- |
| Backend (Jest + ts-jest)    | 44 FinancialService                                       | ✅ All pass |
| Frontend (Jest)             | 101+                                                      | ✅ All pass |
| TypeScript (`tsc --noEmit`) | core, frontend                                            | ✅ 0 errors |
| E2E (Playwright)            | login, clients, debts, expenses, inventory, pos, exchange | Partial     |

---

## ✅ Sprint Update — March 10, 2026

### Completed Today

#### Item-Level Refunds with Partial Quantity

- ✅ Full implementation with partial quantity support
- ✅ All 440 tests passing
- ✅ See: `.opencode/plans/item-level-refund.md` (archived)

#### Dashboard Accumulated Drawer Balances

- ✅ Now reads from drawer_balances table (not date-filtered)
- ✅ Balances verified correct ($3.00 General USD)
- ✅ Matches Opening/Closing page amounts

#### Code Quality Audit

- ✅ All improvements from `improvements-plan.md` verified as already implemented
- ✅ Plan file deleted (no action needed)

#### [T-27] Payment Methods Audit

- ✅ All modules have appropriate payment support
- ✅ Multi-payment where needed, single-payment where appropriate
- ✅ **Status: COMPLETE**

#### [T-45] WhatsApp Integration

- ✅ ClientForm send button added
- ✅ **Status: PARTIALLY COMPLETE (deferred for later)**

### Backlog Items

| Task                            | Priority | Estimated Time | Status      |
| ------------------------------- | -------- | -------------- | ----------- |
| [T-61] Loto Module              | HIGH     | 2-3 days       | Not started |
| [T-63] Alfa Gift Card Feature   | HIGH     | 0.5-1 day      | Not started |
| [T-62] Accessory Reporting      | MEDIUM   | 1-2 days       | Not started |
| [T-45] WhatsApp receipt sending | Medium   | 2-3 hours      | Deferred    |
| [T-45] WhatsApp debt reminder   | Medium   | 1 hour         | Deferred    |
| [T-28] Customer Visit Sessions  | Low      | TBD            | Not started |
| [T-22] E2E Test Coverage        | Low      | TBD            | Not started |

---

**Sprint Status: NEW SPRINT PLANNED** 🎯

March 2026 goals achieved. New high-priority tasks added:

- [T-61] Loto Module Implementation (HIGH priority)
- [T-63] Alfa Gift Card Feature (HIGH priority) — Documentation complete
- [T-62] Accessory Sales & Profit Reporting (MEDIUM priority)

The codebase is production-ready for loto module and Alfa gift card development.
