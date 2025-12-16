# Liratek: Phases 4–7 Implementation Plan

## Overview
Phase 4 (Financials) is largely complete. Phase 5 needs the End-of-Day Closing Shift wizard and reporting. Phases 6–7 focus on data sync, cloud backup, security & distribution. Each phase is organized into 4–6 focused tasks to keep the app lean and functional.

---

## Phase 4: Financials & Specialized Services (REVIEW & POLISH)
**Status:** Core modules built; need final validation and Expenses UI.

### [x] 4.1 Build Expenses Module UI
- Create `src/pages/Expenses/index.tsx` with entry form (category, type, amount, note).
- Add IPC handler `expenses:add` and `expenses:get-today` in `electron/handlers/dbHandlers.ts`.
- Expose `addExpense` and `getTodayExpenses` in `electron/preload.ts`.
- Update Sidebar to include Expenses link.
- **Files:** `src/pages/Expenses/index.tsx`, `electron/handlers/dbHandlers.ts`, `electron/preload.ts`

### [x] 4.2 Validate All Financials Handlers
- Test all exchange, OMT, recharge, maintenance handlers for correct ledger entries.
- Verify drawer balance logic (Drawer A vs B) is enforced in sales handler.
- Add logging to track which drawer each transaction affects.
- **Files:** `electron/handlers/*.ts` (exchange, omtHandlers, rechargeHandlers, maintenanceHandlers, salesHandlers)
### [x] 4.3 Receipt & Printing Support
- Extend `src/pages/POS/components/CheckoutModal.tsx` to generate receipt JSON (client, items, totals, change).
- Create utility `src/utils/receiptFormatter.ts` for thermal printer layout (58mm/80mm width).
- Add a "Print Receipt" button (placeholder or mock printer API for now).
- **Files:** `src/pages/POS/components/CheckoutModal.tsx`, `src/utils/receiptFormatter.ts`

### [x] 4.4 Draft Fields Restoration Fix
- Fix `handleResumeDraft()` in CheckoutModal to restore all payment fields when resuming a draft.
- Currently: cart items restored, but client name, paid USD, paid LBP, secondary field, discount, and change fields are lost.
- Restore: `selectedClient`, `clientSearchSecondary`, `discount`, `paidUSD`, `paidLBP`, `changeGivenUSD`, `changeGivenLBP`, `exchangeRate`.
- **Files:** `src/pages/POS/components/CheckoutModal.tsx`

### [x] 4.5 Multi-Drawer Enforcement
- Update sales handler to respect drawer rules: OMT transactions → Drawer A, all others → Drawer B.
- Add validation in CheckoutModal to show which drawer a payment will affect.
- **Files:** `electron/handlers/salesHandlers.ts`, `src/pages/POS/components/CheckoutModal.tsx`

---

## Phase 5: Dashboard & Reporting (CRITICAL)
**Status:** Dashboard cards done; need End-of-Day closing and variance reporting.

### [x] 5.1 Build End-of-Day Closing Shift UI
- Create `src/pages/Closing/index.tsx` as a **wizard** (4 steps):
  1. Select drawer (General or OMT).
  2. Enter physical count (USD, LBP, EUR if Exchange active).
  3. View system expected vs actual variance.
  4. Review & confirm closing entry.
- Style as modal overlay on Dashboard to prevent accidental bypass.
- **Files:** `src/pages/Closing/index.tsx`

### [x] 5.2 Implement Closing Logic Backend
- Add IPC handler `closing:create-daily-closing` in `electron/handlers/dbHandlers.ts`.
- Handler calculates system expected balance from sales, debts, expenses for the day.
- Stores physical count + variance in `daily_closings` table.
- Logs closing action to activity_logs.
- **Files:** `electron/handlers/dbHandlers.ts`

### [x] 5.3 Generate Variance Report
- Create `src/utils/closingReportGenerator.ts` to produce variance summary (expected vs actual, difference %, missing $ amount).
- Add "Generate PDF" button in closing wizard (use `html2pdf` or similar).
- Include daily stats snapshot: sales count, debt payments, expenses, profit.
- **Files:** `src/utils/closingReportGenerator.ts`, `src/pages/Closing/index.tsx`

### [ ] 5.4 Settings Module UI
- Create `src/pages/Settings/index.tsx` (admin only):
  - Exchange rate input (persists to system_settings).
  - Shop name, receipt header text, drawer limits.
  - WhatsApp API key placeholder (future feature).
- Add IPC handlers `settings:get-all`, `settings:update` in `electron/handlers/dbHandlers.ts`.
- Expose in `electron/preload.ts`.
- **Files:** `src/pages/Settings/index.tsx`, `electron/handlers/dbHandlers.ts`, `electron/preload.ts`

### [ ] 5.5 Notifications & Status Alerts UI
- Create `src/components/NotificationCenter.tsx` toast/banner system.
- Display low stock warnings, high drawer balance alerts, sync status, upcoming maintenance appointments.
- Use a simple event emitter (extend `src/utils/appEvents.ts`) for cross-component notifications.
- **Files:** `src/components/NotificationCenter.tsx`, `src/utils/appEvents.ts`, `src/components/Layout/TopBar.tsx` (integrate)

### [ ] 5.6 Enhance Dashboard with Closing History
- Add a "Recent Closings" card to Dashboard showing last 7 days' closing summaries.
- Link to view variance details for any day.
- **Files:** `src/pages/Dashboard.tsx`

---

## Phase 6: Sync & Cloud (DATA RESILIENCE)
**Status:** Tables exist (sync_queue); need sync engine and backup.

### [ ] 6.1 Implement Local Backup Strategy
- Add IPC handler `db:backup-local` in `electron/handlers/dbHandlers.ts`.
- On "End of Day" closing, auto-backup DB to `~/Liratek_Backups/phone_shop.db.{date}.backup`.
- Add manual "Backup Now" button in Settings.
- **Files:** `electron/handlers/dbHandlers.ts`, `src/pages/Settings/index.tsx`

### [ ] 6.2 Build Sync Queue Watcher (Main Process)
- Create `electron/sync/syncQueue.ts` to watch for new entries in sync_queue table.
- Every 5 minutes, batch pending items and prepare for cloud upload.
- Log sync attempts and failures to activity_logs.
- (Cloud endpoint implementation deferred to Phase 7 infrastructure setup.)
- **Files:** `electron/sync/syncQueue.ts`, `electron/main.ts` (integrate watcher)

### [ ] 6.3 Add Offline Indicator & Manual Sync
- Create `src/components/SyncStatus.tsx` (show in TopBar).
  - Displays: "Online", "Offline", "Syncing..." status.
  - Add "Sync Now" button in Settings.
- Sync status emitted from `electron/sync/syncQueue.ts` to renderer via IPC.
- **Files:** `src/components/SyncStatus.tsx`, `src/components/Layout/TopBar.tsx` (integrate), `electron/preload.ts`, `electron/sync/syncQueue.ts`

### [ ] 6.4 Multi-PC Sync Protocol (Skeleton)
- Document (in README) the future cloud schema and multi-PC conflict resolution rules.
- Prepare `electron/sync/mergeStrategy.ts` (empty skeleton) for handling concurrent edits.
- **Files:** `electron/sync/mergeStrategy.ts`, `README.md`

---

## Phase 7: Polish & Distribution (RELEASE-READY)
**Status:** Code functional; need security, obfuscation, and installer.

### [ ] 7.1 Security Audit & Activity Logging
- Review all IPC handlers; ensure staff cannot call admin endpoints (role check in each handler).
- Verify activity_logs captures user, action, timestamp, details for all financial transactions.
- Add granular permission checks (e.g., only admin can change exchange rate, refund, or view cost price).
- **Files:** All `electron/handlers/*.ts`, `electron/preload.ts`

### [ ] 7.2 Code Obfuscation & ASAR Packaging
- Configure `vite.config.ts` to minify and bundle renderer code.
- Update `electron/main.ts` to load app from ASAR archive (set asarUnpack rules for native modules).
- (Obfuscation tool: `javascript-obfuscator` npm package, optional.)
- **Files:** `vite.config.ts`, `electron/main.ts`, `package.json`

### [ ] 7.3 Build Electron Installer (Windows)
- Configure `electron-builder` in package.json for NSIS installer (.exe).
- Set app icon, file associations (*.receipt, *.backup), auto-update via GitHub Releases.
- Create installer branding (splash screen, license agreement placeholder).
- **Files:** `package.json`, `electron/main.ts` (auto-updater integration)

### [ ] 7.4 DRM & License Check (Heartbeat)
- Create `electron/services/licenseCheck.ts` to ping a license server on app startup.
- If license invalid/expired, switch app to "Read-Only" mode (disable sales, debts, edits).
- Log license check result to activity_logs.
- (License server endpoint: placeholder for future backend.)
- **Files:** `electron/services/licenseCheck.ts`, `electron/main.ts` (call on startup)

### [ ] 7.5 Manual Testing & QA Checklist
- Document full day-in-the-life scenario (Opening → Sales → Debt → Closing) with test data.
- Create `docs/QA_CHECKLIST.md` for all critical paths.
- Test multi-currency transactions, debt workflows, exchange rates, receipts, closing variance.
- **Files:** `docs/QA_CHECKLIST.md`

### [ ] 7.6 Release & Deployment Documentation
- Write `docs/INSTALLATION.md` for end-user setup.
- Create `docs/ADMIN_GUIDE.md` (settings, backup, license renewal).
- Build GitHub Release package with installer + changelog.
- **Files:** `docs/INSTALLATION.md`, `docs/ADMIN_GUIDE.md`, `CHANGELOG.md`

---

## Implementation Notes

### Task Ordering
- **Phases 4 & 5 can overlap:** 5.1–5.3 are critical path; 5.4–5.6 can wait in parallel.
- **Phase 6 is independent:** Can be built once Phase 5 is stable.
- **Phase 7 happens last:** Security audit, obfuscation, installer preparation at the end.

### Technology Choices
- **Closing/Variance Reports:** Use `html2pdf` or `pdfkit` for client-side PDF generation (no server needed).
- **Sync Queue:** Use a cron-like pattern in Electron's `ipcMain` with interval checking.
- **Obfuscation:** Optional; JavaScript obfuscation has diminishing returns in Electron (code is bundled in ASAR). Focus on code review + permission checks instead.

### Business Logic Alignment
- All modules respect the **Drawer A (OMT) vs Drawer B (General)** distinction.
- Enforce closing workflows to prevent financial discrepancies.
- Track variances for daily reconciliation and auditing.

### Styling & UX
- Follow existing **Tailwind dark theme** (slate-800 cards, violet/emerald/red accents).
- Keep modals consistent with CheckoutModal pattern.
- Use consistent spacing, borders, and iconography from lucide-react.

---

## Current Implementation Status

### Fully Implemented (Phase 1–5 Core)
- ✅ Authentication (login/logout)
- ✅ Inventory (CRUD, barcode, stock tracking)
- ✅ Clients (CRUD, history)
- ✅ POS (cart, multi-currency checkout, draft sales)
- ✅ Debts (tracking, repayment, history)
- ✅ Exchange (USD/LBP/EUR)
- ✅ OMT/Whish (send money, bill payment, commission tracking)
- ✅ Recharge (MTC/Alfa virtual stock, credit transfer)
- ✅ Maintenance (job tracking, status workflow, payment)
- ✅ Dashboard (sales stats, charts, recent activity, top products)

### Partially Implemented
- ⚠️ Expense tracking (table exists, no UI/handlers)
- ⚠️ Daily closing (table exists, no end-of-day wizard/variance report)

### Not Implemented
- ❌ Sync engine & cloud backup
- ❌ Receipt printing/thermal printer integration
- ❌ Settings module UI
- ❌ Notifications UI
- ❌ Security/DRM/installer
