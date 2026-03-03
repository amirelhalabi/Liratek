# Current Sprint (Feb 19–Feb 28, 2026)

**Last Updated**: Feb 22, 2026

## 📖 How to Read This Document

- **Sprint Board**: High-level Kanban view of all task statuses
- **T-Tasks**: Technical implementation tasks (business logic, features, architecture)
- **P-Tasks**: Platform/release tasks (QA, distribution, documentation)
- **Priority Scale**: `!!!` High | `!!` Medium | `!` Low

---

## 🏗️ Sprint Board

### ✅ Completed

- [T-54]!!! Refund/Void Flow Rewrite — transaction wrapper, double-refund guard, drawer reversal, stock restoration, debt cancellation (completed Feb 22)
- [T-53]!!! Profit Audit & Pending Profit — fully-paid filter, FIFO debt repayment, Pending Profit tab, 16 unit tests (completed Feb 22)
- [T-52]!!! Binance Merge into Financial Services — migration v25, delete standalone module, BINANCE provider in financial_services (completed Feb 22)
- [T-30]!!! Financial Services improvements — phone param, OMT service dropdown, bidirectional settlement view (completed Feb 22)
- [T-48]!! Profits Module — full-stack admin-only analytics (7 tabs: Overview, By Module, By Date, By Payment, By Cashier, By Client, Pending Profit) (completed Feb 22)
- [T-50]!! Reusable TableComponent — DataTable component replacing 22 inline tables (completed Feb 21)
- [T-49]! Table Export — ExportBar component with Excel/PDF export on all 24 table instances (completed Feb 21)
- [T-46]!!! Recharge Module Improvements — voucher images per item, full payment methods (CASH/OMT/WHISH/BINANCE/DEBT) for financial services, cost tracking with auto-save, mobileServices.json integration, Service Debt on Debts page (completed Feb 18)
- [T-39]!!! Recharge Consolidation — merge MTC/Alfa + IPEC/Katch + Binance into one page (completed Feb 16)
- [T-40]!! Dynamic Currencies — DB-driven currency system with module/drawer mappings (completed Feb 16)
- [T-41]!! DB-Driven Modules — sidebar + settings from modules table (completed Feb 16)
- [T-42]!! Payment Methods Manager — CRUD settings page + hooks (completed Feb 16)
- [T-45]!! WhatsApp Cloud API Integration — send messages via Meta API, test button in Settings (completed Feb 16)
- [T-43]! Drawer name fixes — Wish_App_Money→Whish_System, OMT_APP provider, supplier-module linking, Whish App supplier (completed Feb 16)
- [T-44]! Documentation consolidation — 8 docs archived, 4 new docs created (completed Feb 16)
- [T-31]!! Expenses simplification — remove types dropdown (completed Feb 16)
- [T-29]!!! Recharge UX — voucher images, debt payment, phone field removal, Binance UI alignment, Settings cleanup (completed Feb 16)
- [T-34]! New module: IPEC/Katch/WishApp services page (completed Feb 13)
- [T-33]! New module: Binance transfers (completed Feb 13)
- [T-36] Debts page redesign — split tables + USD/LBP display (completed Feb 13)
- [T-37] Dashboard improvements — USD/LBP totals, decimal precision, Top Debtors list (completed Feb 13)
- [T-38] Runtime bug fixes — Exchange CHECK, session linking, recharge credits (completed Feb 13)
- [T-35]!! Frontend Consolidation - @liratek/ui Package (completed Feb 13)
- [T-28]!!! Customer Visit Session (FULLY COMPLETED Feb 12)
- [T-32]!! BUG: MTC credits affecting inventory + dashboard sanity (completed Feb 12)
- [T-27]!!! Payment Methods Everywhere + Drawer Model Expansion (completed Feb 12)
- [T-26]!!! Enterprise Hardening: Dual-Mode API Facade (`frontend/src/api/backendApi.ts`) (completed Feb 12)
- [T-25]!!! Shared Core Backend Consolidation (@liratek/core) (completed Jan 25)
- [T-24]!!! Unified Database Location (Web + Desktop) (completed Jan 25)
- [T-23]!!! New Electron Backend Integration (completed Jan 24)
- [T-20]!!! Post-Refactor Cleanup & Verification (completed Feb 1)
- [T-18]!!! Frontend/Backend Separation (completed Feb 1)
- [T-08]!!! IMEI & Warranty Tracking (completed Jan 24)
- [T-02]!!! Supplier Ledger Drawer Integration (completed Jan 24)
- **Financial Reporting & Analytics** (completed Jan 24)
- **Documentation Consolidation** (completed Jan 25)
- **CI/CD Build Pipeline Fix** (completed Jan 25)

### 🚧 In Progress

(none — all sprint tasks complete)

### 🔜 Next Priority (MUST DO)

- [T-51]!! Consolidated Reports Page — checkbox-based module selector with multi-module Excel/PDF export

### 📋 Ready (Ordered by Priority)

**This Sprint Focus (Urgent)**

**High Priority (!!!)**

**Medium Priority (!!)**

- [T-51]!! Consolidated Reports Page — checkbox-based module selector with multi-module Excel/PDF export
- [T-55]!! Payment Method Surcharge — 1% default fee on Binance/WHISH-to-WHISH/OMT-wallet payments
- [T-56]!! Transaction History Page — cross-module transaction history filterable by drawer and module

**Low Priority (!)**

- (No low priority tasks this sprint)

---

**Backlog / Later (post-urgent sprint)**

**High Priority (!!!)**

- [T-19]!!! Migrate Remaining Features to Backend API
- [T-01]!!! Two-Wallet System & Mixed Payment Support
- [T-10]!!! Real-time Drawer Balances
- [P0-1]!!! Installer QA
- [P0-2]!!! Build Verification
- [P0-3]!!! Code Signing
- [TR-C0]!!! Complete Request Validation (8 remaining routes: activity, currencies, dashboard, modules, paymentMethods, sessions, settings, suppliers)
- [TR-C2]!!! Remove ReportService duplication in electron-app/services
- [TR-C3]!!! Fix 98 `any` usages in backendApi.ts (type safety)

**Medium Priority (!!)**

- [T-21]!! Backend REST API Documentation
- [T-22]!! Comprehensive E2E Test Coverage (includes re-enabling CI E2E tests)
- [T-03]!! Smart Barcode Duplicate Handler
- [T-04]!! Telecom Profit Engine (MTC/Alfa)
- [T-07]!! Admin-Only Security "Late Entry"
- [T-11]!! Hardware Barcode Scanner Integration
- [T-12]!! Receipt Printer Support
- [T-17]!! Admin Closing Approval
- [P1-1]!! Automated Testing (integration + contract tests)
- [P1-3]!! User Documentation
- [TR-H1]!! Replace SELECT \* in ModuleRepository (4 queries)
- [TR-M1]!! Database schema optimization (NOT NULL, CHECK constraints, partial indexes)
- [TR-M2]!! Frontend component refactoring (split large components >500 LOC)
- [TR-M4]!! Deduplicate electron-app/services → use @liratek/core directly
- [TR-M6]!! Automated backup system (daily SQLite backup + verification + cleanup)
- [TR-FE1]!! React Query (TanStack Query) for data fetching
- [TR-FE2]!! React Error Boundary (crash resilience)
- [TR-SEC3]!! Content Security Policy headers (web mode)
- [TR-DEVOPS2]!! GitHub Actions release automation

**Low Priority (!)**

- [T-05]! Loto Module
- [T-06]! Binance Service Module
- [T-09]! Monthly Analytics & Gross Profit Dashboard (already delivered as Financial Reporting & Analytics)
- [T-13]! Email Receipt Delivery
- [T-15]! Data Archival Workflow
- [P1-2]! Auto-Updater
- [FC-4]! Frontend Consolidation Phase 4: Move Feature Components to @liratek/ui (8-10h, deferred until web frontend needed)
- [FC-5]! Frontend Consolidation Phase 5: Update Frontend Shell (2-3h, depends on FC-4)
- [FC-6]! Frontend Consolidation Phase 6: Testing & Validation (3-4h)
- [TR-M5]! Decide WebSocket future (implement real-time features or remove Socket.IO)
- [TR-L1]! Performance monitoring / APM
- [TR-L3]! Internationalization (i18n)
- [TR-L4]! JSDoc code documentation for public APIs
- [TR-L5]! Storybook for UI components
- [TR-AR1]! Event-driven architecture (EventBus for decoupled modules)
- [TR-DB1]! Database query optimization & indexing
- [TR-DB2]! Consistent soft deletes across all tables
- [TR-DB3]! Database connection pooling (web mode)
- [TR-FE3]! React Hook Form integration
- [TR-PERF1]! Bundle size optimization (code splitting, tree shaking)
- [TR-PERF2]! Database query batching (N+1 prevention)
- [TR-DEVOPS1]! Docker development environment

---

## 🔧 T-Tasks: Technical Implementation

### [T-18] Frontend/Backend Separation !!!

**Added**: Jan 24, 2026  
**Status**: ✅ Completed (Feb 1, 2026)  
**Goal**: Refactor monolithic Electron app into standalone backend (Node.js REST/WebSocket server) and frontend (modern web app).

**Progress**:

- [x] Phase 1: Backend Setup
- [x] Phase 2: Frontend Adaptation (web-mode HTTP API + Socket.IO, migrated Clients/Inventory/Dashboard)
- [~] Phase 3: Testing & Deployment
  - [x] Docker setup
  - [x] End-to-end testing
  - [x] Migration guide

### [T-19] Migrate Remaining Features to Backend API !!!

**Added**: Jan 24, 2026  
**Status**: Ready  
**Dependencies**: [T-18]  
**Goal**: Complete backend migration for remaining features: Closing, Services/Recharge, and Suppliers.

**Scope**:

- Migrate Closing workflow to REST API
- Migrate Services/Recharge module to REST API
- Migrate Suppliers module to REST API
- Ensure feature parity with Electron implementation

### [T-20] Post-Refactor Cleanup & Verification !!!

**Added**: Jan 24, 2026  
**Status**: ✅ In Progress  
**Dependencies**: [T-18]  
**Goal**: Complete migration of all functionality from the old structure (`src/`, `electron/`) to the new separated structure (`frontend/`, `backend/`), then clean up the old monolith.

**Migration Reference Strategy**:

- **Frontend (`liratek/frontend/`)**: Reference all implementations from `liratek/src/`
  - Compare component structures, API calls, business logic
  - Ensure all features in `src/` are migrated to `frontend/src/`
  - Update to use backend REST API instead of `window.api` (Electron IPC)
- **Backend (`liratek/backend/`)**: Reference all implementations from `liratek/electron/`
  - Compare database schemas, repositories, services
  - Ensure all IPC handlers in `electron/handlers/` are converted to REST API endpoints in `backend/src/api/`
  - Ensure all business logic in `electron/services/` is available in `backend/src/services/`
  - Verify database queries and migrations are consistent

**Phase 1: Migration Verification & Completion** ✅ **COMPLETED Feb 1, 2026**

- [x] Start backend server and verify it runs properly
- [x] Start frontend dev server and verify it connects to backend
- [x] Test authentication flow (✅ Fixed: admin password set, CSP headers configured)
- [x] Fix Settings module to use backend API (✅ Created `/api/settings` endpoint)
- [x] Fix Dashboard monthly-pl error (✅ Fixed column name from `from_currency` to `from_code`)
- [x] Create backend API endpoints for core modules:
  - [x] Maintenance/Repairs (`/api/maintenance`) ✅ Jan 24
  - [x] Recharge (`/api/recharge`) ✅ Jan 24
  - [x] Services/OMT (`/api/services`) ✅ Jan 24
  - [x] Currencies (`/api/currencies`) ✅ Jan 24
  - [x] Closing (`/api/closing`) ✅ Jan 24
  - [x] Suppliers (`/api/suppliers`) ✅ Jan 24
  - [x] Activity Logs (`/api/activity`) ✅ Jan 24
  - [x] Rates (`/api/rates`) ✅ Jan 24
  - [x] Users (`/api/users`) ✅ Jan 24
  - [x] Reports/Diagnostics (`/api/reports`, `/api/diagnostics`) ✅ Jan 24
  - [x] Sales (`/api/sales/:id`, `/api/sales/:id/items`) ✅ Feb 1
- [x] Update frontend components to use backend API ✅ **59 calls migrated across 23 files (Feb 1)**
- [x] Complete window.api migrations ✅ **ALL business logic migrated - 76% coverage**
- [x] Verify WebSocket real-time updates work (infra done, manual QA pending)
- [x] Test all features end-to-end in browser mode (infra done, manual QA pending)

**Migration Summary (Feb 1, 2026):**

- **✅ Migrated:** 59 calls across 23 files (76%)
  - Settings: CurrencyManager, NotificationsConfig, DrawerConfig, SupplierLedger, UsersManager, RatesManager, ActivityLogViewer
  - Features: Exchange, Expenses, Inventory, Opening, POS, Closing, Debts
  - Shared: TopBar, useSystemExpected, AuthContext (partial)
- **✅ Intentionally Kept:** 19 calls (24% - Electron-only features)
  - UpdatesPanel.tsx (4) - Auto-updater
  - Diagnostics.tsx (7) - File operations
  - AuthContext.tsx (2) - Session restore
  - Various Electron-specific checks (6)

**Result:** All business logic now works in BOTH Desktop and Web modes! 🎉

**Browser vs Electron Mode Testing Status (Jan 24)**:

- ✅ **Working in Browser Mode**: Auth, Settings, Dashboard, Clients, Inventory, Sales, Debts, Exchange, Expenses, Recharge, Services, Maintenance, Currencies (list)
- ⏳ **Partial/Electron Only**: Closing, Opening, Advanced Settings (rates, users, suppliers, diagnostics, reports, activity, updates)
- 📝 **Recommendation**: Continue development in Electron mode where all features work, complete API migration incrementally

**Phase 2: Cleanup Plan** ✅ **COMPLETED Feb 1, 2026**

- [x] Removed backup files (.bak) - 6 files deleted
- [x] Verified code quality (no console.log in production)
- [x] Confirmed error handling consistency
- [x] Validated clean workspace structure
- [x] Documentation updated

**Note:** Old monolithic folders (src/, electron/, dist/) were already removed in previous cleanup.

**Cleanup Results:**

- ✅ Clean and organized codebase
- ✅ Consistent code patterns across all migrated files
- ✅ All documentation current
- ✅ Ready for production testing
- `config/` - Old app config (16KB) → Replaced by `backend/config/`
- `packages/` - Old shared packages (56KB) → No longer needed
- `__mocks__/` - Old root mocks (24KB) → Moved to backend/frontend specific mocks

Files to UPDATE:

- Root `package.json` - Remove old Electron scripts, keep only workspace management
- Root `vite.config.ts` - Should be deleted (now in `frontend/`)
- Root `tsconfig.*.json` - Should be deleted (now in `backend/` and `frontend/`)
- Root `jest.config.ts`, `jest.setup.ts` - Should be deleted
- Root `eslint.config.js` - Should be deleted
- Root `tailwind.config.js`, `postcss.config.js` - Should be deleted
- Root `index.html` - Should be deleted (now in `frontend/`)

Files to KEEP:

- `docker-compose.yml`, `Dockerfile`, `nginx.conf` - Deployment configs
- `README.md`, `RELEASE_NOTES_v1.0.0.md` - Documentation
- `docs/` - All documentation
- `.github/` - CI/CD workflows
- `scripts/` - Build and utility scripts (may need updates)
- `resources/` - App icons and assets for packaging
- `.gitignore`, `.yarnrc.yml` - Version control configs

**Phase 3: Execute Cleanup**

- [x] Backup current state
- [x] Delete old folders
- [x] Update root package.json
- [x] Delete duplicate config files
- [x] Test that workspace still builds and runs
- [x] Update documentation to reflect new structure

### [T-27] Payment Methods Everywhere + Drawer Model Expansion (OMT System / Whish App / Binance) !!!

**Added**: Feb 12, 2026  
**Status**: ✅ COMPLETED (Feb 16, 2026)  
**Goal**: Standardize and support payment methods across _all_ transactions and ensure drawer propagation works in Opening/Closing.

**Implementation Completed**:

- ✅ Unified payment methods: CASH, OMT, WHISH, BINANCE, DEBT — all DB-driven via `payment_methods` table
- ✅ New drawers seeded: OMT_App, Whish_App, Whish_System, Binance (USD+LBP)
- ✅ Drawer naming fixed: `Wish_App_Money` → `Whish_System`, WHISH→Whish_System, WISH_APP→Whish_App
- ✅ Opening/Closing includes all drawers dynamically
- ✅ Dashboard reflects new drawers
- ✅ `PaymentMethodRepository` + `PaymentMethodService` + settings CRUD page
- ✅ `usePaymentMethods` hook used across all transaction forms

**Acceptance Criteria** (All Met):

- [x] Any transaction can be tagged with a payment method from the standardized set
- [x] Drawer totals correctly update for all payment methods where applicable
- [x] Opening/Closing includes the new drawers and names consistently
- [x] Dashboard reflects the new drawers

---

### [T-28] Customer Visit Session (customerServiceWindow) + cross-module linkage !!!

**Added**: Feb 12, 2026  
**Status**: ✅ COMPLETED (Feb 12, 2026)  
**Goal**: Track customer visits with a dedicated session system that links all transactions (sales, recharges, exchanges, services, maintenance) to customer sessions.

**Implementation Completed**:

- ✅ **Backend**: REST API endpoints (`/api/sessions/*`), services, repositories, auto-linking endpoint
- ✅ **Electron**: IPC handlers, preload API, session methods exposed to renderer
- ✅ **Database**: `customer_sessions` + `customer_session_transactions` tables with auto-migration system
- ✅ **Frontend**: SessionContext, Messenger-style FAB Speed Dial, draggable floating window
- ✅ **Auto-linking**: All 5 transaction modules (POS, Recharge, Exchange, Services, Maintenance)
- ✅ **Auto-fill**: Customer names pre-populated in all transaction forms (no dropdown clutter when session active)

**UI Features Implemented**:

- Messenger-style FAB (bottom-right) with Speed Dial expansion showing all active sessions
- Draggable minimized badge with vertical column constraint and smart click vs drag detection (5px threshold)
- Adaptive window dimensions: 280x130px (empty) → 400x500px (with scrolling for 4+ transactions)
- Compact one-line header: profile icon + name + phone inline
- Auto-minimize on app load for cleaner initial view
- X button closes session with confirmation dialog (not just hides window)
- Smooth animations, no lag during drag (conditional CSS transitions)
- Vertical column drag constraints for both minimized badge and expanded window

**Session Management**:

- Multiple active sessions support (different customers simultaneously)
- Duplicate prevention per customer (cannot create two sessions for same customer)
- Radio button session switching via FAB Speed Dial
- Auto-load first active session on app startup
- Session window shows real-time transaction list with running totals

**Technical Implementation**:

- Dual-mode support: Electron IPC + HTTP REST API with automatic fallback
- Database migration system (`migrateCustomerSessions`) for seamless schema updates
- Smart interaction detection: drag vs click differentiation using distance threshold
- Conditional CSS transitions: only animate width/height during drag, not position
- Idempotent migrations: safe to run multiple times

**Acceptance Criteria** (All Met):

- [x] User can start session, then create transactions in different modules
- [x] All transactions are automatically linked to the active session
- [x] Session window shows transaction list in real time with adaptive sizing
- [x] Session can be closed and later reviewed (marked as closed in database)
- [x] Multiple sessions supported with easy switching
- [x] Customer names auto-filled in all transaction forms
- [x] Messenger-style UX with vertical column constraints
- [x] Works in both Electron (desktop) and Web modes

---

### [T-35] Frontend Consolidation - @liratek/ui Package !!

**Added**: Feb 13, 2026  
**Status**: ✅ COMPLETED (Feb 13, 2026)  
**Goal**: Consolidate shared frontend components, utilities, config, and types into a reusable `@liratek/ui` package to enable code sharing between Desktop and future Web deployments.

**Implementation Completed**:

- ✅ **Package Structure**: Created `packages/ui/` with proper workspace configuration
- ✅ **UI Primitives**: Migrated Select, NotificationCenter, PageHeader to @liratek/ui
- ✅ **Utilities**: Moved appEvents (type-safe event emitter) to shared package
- ✅ **Config**: Moved constants (EXCHANGE_RATE, DRAWER names) and denominations (bill rounding) to shared package
- ✅ **Types**: Consolidated renderer types with @liratek/core re-exports
- ✅ **API Adapter**: Implemented platform abstraction layer (types, provider, frontend adapter)
- ✅ **Build Configuration**: Updated Vite, TypeScript, and Jest configs with @liratek/ui paths
- ✅ **Import Refactoring**: Updated 27 files to import directly from @liratek/ui
- ✅ **Cleanup**: Removed all re-export stubs and empty directories
- ✅ **Testing**: All builds passing, tests verified, adapter tested

**Architecture Decisions**:

- Kept layouts (MainLayout, Sidebar, TopBar) in frontend - they orchestrate app-specific features
- Kept feature hooks (useAuth, useCurrencies, etc.) in frontend - they're not general-purpose UI hooks
- Only moved truly platform-agnostic shared primitives to @liratek/ui
- CSS delivery owned by app shell (documented in README)
- API adapter pattern enables future web shell without code duplication

**Build Results**:

- ✅ Typecheck: Clean (no errors)
- ✅ Production build: 965.62 kB (gzip: 275.98 kB) in 1.96s
- ✅ Tests: All passing
- ✅ No warnings or errors

**Files Affected**:

- Created: `packages/ui/` with 15+ source files
- Updated: 27 files across frontend features
- Removed: 7 re-export stub files + 2 empty directories
- Documentation: Updated consolidation plan and package README

---

### [T-29] Recharge Module UX + voucher images + debt payment + remove phone fields !!!

**Added**: Feb 12, 2026  
**Status**: ✅ COMPLETED (Feb 16, 2026)  
**Dependencies**: [T-27] for payment methods  
**Goal**: Improve recharge workflows and remove unnecessary phone fields.

**Implementation Completed**:

- ✅ Static voucher images displayed per provider
- ✅ Debt payment support in recharge flow
- ✅ Phone number field removed from voucher cards and days-validity flow
- ✅ Binance (CryptoForm) UI completely rewritten to match FinancialForm pattern: stats row on top, w-1/3 form, matching input styles, consistent table headers, refresh button
- ✅ Binance stat cards have subtitles ("outgoing", "incoming", "today")
- ✅ Binance tab shows USD volume instead of transaction count
- ✅ Supplier debt banners moved above provider cards
- ✅ Settings page cleaned up: removed legacy Admin section, global Save/Cancel buttons, unused state
- ✅ Created Integrations tab in Settings with WhatsApp configuration
- ✅ All suppliers shown in Settings Supplier Ledger (not just system), sorted system-first then alphabetical
- ✅ SYS badge removed from Supplier Ledger

**Acceptance Criteria**:

- [x] Recharge voucher cards show images
- [x] Recharge can be paid by debt + other payment methods
- [x] No phone number field appears in voucher UI or days-validity flow

---

### [T-45] WhatsApp Cloud API Integration !!

**Added**: Feb 16, 2026  
**Status**: ✅ COMPLETED (Feb 16, 2026)  
**Goal**: Integrate WhatsApp Cloud API for sending messages to customers.

**Implementation Completed**:

- ✅ **Core Service**: `packages/core/src/services/WhatsAppService.ts` — singleton service with `sendMessage()`, `sendTemplate()`, `sendTestMessage()`, `formatLebanonNumber()`
- ✅ **Settings**: Two keys stored in `system_settings`: `whatsapp_api_key` (access token) + `whatsapp_phone_number_id` (sender phone number ID from Meta dashboard)
- ✅ **Electron Handler**: `electron-app/handlers/whatsappHandlers.ts` — IPC channels `whatsapp:send-test` and `whatsapp:send-message`
- ✅ **Preload API**: `whatsapp.sendTest()` and `whatsapp.sendMessage()` exposed via preload
- ✅ **Frontend API**: `sendWhatsAppTestMessage()` and `sendWhatsAppMessage()` in `backendApi.ts` with dual-mode support
- ✅ **Settings UI**: `IntegrationsConfig.tsx` — Access Token (password field), Phone Number ID, test connection section with recipient phone input and "Send Test" button, success/error feedback
- ✅ **Template Messages**: Test messages use Meta's built-in `hello_world` template (pre-approved, works without 24h conversation window)
- ✅ **Tested**: Successfully sent test message to 81077357 via WhatsApp Cloud API v21.0

**Architecture**:

- WhatsApp Cloud API v21.0: `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- Business-initiated messages require pre-approved templates (free-form text only works within 24h conversation window)
- Lebanese phone number formatting: strips leading 0, adds 961 country code
- Free tier: 1,000 service conversations/month

**Acceptance Criteria**:

- [x] WhatsApp API credentials configurable in Settings > Integrations
- [x] Test message can be sent and received via template
- [x] Error handling for missing credentials and API failures
- [x] Works in Electron mode (IPC) with HTTP fallback for web mode

---

### [T-30] Financial Services (OMT/Whish) improvements: phone param + service dropdown + settlement visibility !!!

**Added**: Feb 12, 2026  
**Status**: ✅ Completed (Feb 22, 2026)  
**Dependencies**: [T-27]  
**Goal**: Make OMT/Whish transactions capture required phone number and improve clarity of who owes what.

**Implementation Completed**:

- ✅ **Migration v22** — added `phone_number` and `omt_service_type` columns to `financial_services` table
- ✅ **OMT service dropdown** — 7 service types: Bill Payment, Cash To Business, Ministry of Interior, Cash Out, Ministry of Finance, INTRA, Online Brokerage
- ✅ **Phone number field** — stored on financial_services transactions
- ✅ **Bidirectional settlement view** — shows per-provider USD/LBP owed amounts ("You owe them" vs "They owe you") using supplier balances
- ✅ **Frontend Services page** — complete UI with phone input, OMT service type selector, settlement balance cards
- ✅ **28 unit tests** in `backend/src/__tests__/financial_services_t30.test.ts` — validator (phone/OMT type/BINANCE/DEBT), addTransaction storage, getHistory retrieval, error handling

**Acceptance Criteria** (All Met):

- [x] OMT/Whish forms include phone number and it’s stored
- [x] OMT supports selecting the service type from the list
- [x] OMT UI shows the two-sided settlement view (USD+LBP)
- [x] Whish “owe” view implemented via bidirectional supplier balance

---

### [T-55] Payment Method Surcharge (Binance / WHISH-to-WHISH / OMT Wallet) !!

**Added**: Feb 22, 2026  
**Status**: Ready  
**Dependencies**: [T-30]  
**Goal**: Certain payment methods carry an extra commission fee that the customer pays. This fee creates a drawer transaction.

**Business Rules**:

- **Affected payment methods**: Binance, WHISH-to-WHISH, OMT Wallet
- **Default surcharge**: 1% of the transaction amount
- **Override per transaction**: The shop owner can change the fee % at time of payment (e.g. 0.5%, 2%), but this does **not** change the stored default — only the fee for that specific transaction
- **Fee destination**: The surcharge amount creates a transaction in the drawer linked to the payment method (e.g. Binance surcharge → Binance drawer)
- **Applies globally**: This surcharge applies in **any module** where these payment methods are used (POS, Financial Services, Exchange, etc.), not just OMT/WHISH

**Implementation Tasks**:

- [ ] Add `surcharge_percent` config per payment method (stored in DB or config, default 1% for Binance/WHISH/OMT-wallet, 0% for others)
- [ ] Backend: when processing a payment with a surcharge-enabled method, auto-calculate fee = `amount × surcharge_percent`
- [ ] Backend: create an additional drawer transaction for the surcharge amount in the payment method's drawer
- [ ] Frontend: show the surcharge % field (pre-filled with default) when a surcharge-enabled payment method is selected
- [ ] Frontend: allow editing the % per-transaction (does not persist as new default)
- [ ] Frontend: display the calculated surcharge amount next to the % field (read-only, auto-calculated)
- [ ] Ensure surcharge is visible in history/reports (separate column or line item)
- [ ] Unit tests for surcharge calculation and drawer effect

**Acceptance Criteria**:

- [ ] Selecting Binance/WHISH/OMT-wallet shows surcharge field defaulting to 1%
- [ ] Changing surcharge % recalculates the fee amount in real-time
- [ ] Surcharge creates a separate drawer transaction
- [ ] Default remains 1% for subsequent transactions (override is per-transaction only)
- [ ] Cash and other non-surcharge methods show no surcharge field

**Estimate**: 2–3 days

---

### [T-56] Transaction History Page — Cross-Module Filterable History !!

**Added**: Feb 22, 2026  
**Status**: Ready  
**Dependencies**: None  
**Goal**: A dedicated page to view transaction history across all modules, filterable by drawer and module.

**Business Rules**:

- Shows all transactions across the system in reverse chronological order
- Filterable by **drawer** (General, OMT_System, Binance, Whish_System, Whish_App, OMT_App, etc.)
- Filterable by **module** (POS, Financial Services, Exchange, Maintenance, Recharge, Expenses, etc.)
- Supports date range filter
- Each row shows: date, module name, drawer affected, amount (+/-), payment method, description/reference
- Export to Excel and PDF

**Implementation Tasks**:

- [ ] Backend: create endpoint to query transactions across all modules with drawer/module filters
- [ ] Backend: aggregate from all relevant tables (payments, financial_services, exchange, maintenance, etc.) into unified format
- [ ] Frontend: new page with filter bar (drawer dropdown, module dropdown, date range)
- [ ] Frontend: DataTable with sortable columns
- [ ] Frontend: Excel + PDF export
- [ ] Add to sidebar navigation

**Acceptance Criteria**:

- [ ] Page shows transactions from all modules in one unified list
- [ ] Filtering by drawer shows only transactions affecting that drawer
- [ ] Filtering by module shows only transactions from that module
- [ ] Combined filters work (e.g. "Binance drawer" + "Financial Services")
- [ ] Excel/PDF export respects active filters
- [ ] Date range filter works

**Estimate**: 3–4 days

---

### [T-31] Expenses simplification: remove types dropdown !!

**Added**: Feb 12, 2026  
**Status**: Ready  
**Goal**: Remove the expense “types” dropdown to simplify entry.

**Acceptance Criteria**:

- [x] UI no longer shows types dropdown
- [x] Backend accepts expense without type
- [x] Reports unaffected

**Estimate**: 0.5–1 day

---

### [T-32] BUG: MTC credits affecting inventory + dashboard sanity !!

**Added**: Feb 12, 2026  
**Status**: Ready  
**Goal**: Fix incorrect logic where MTC credits appear to affect inventory when they shouldn’t.

**Repro (reported)**:

- Add credits in opening drawers (e.g., put $100 in MTC drawer)
- Verify inventory is not affected
- Ensure dashboard sanity checks reflect correct inventory values

**Acceptance Criteria**:

- [x] Opening drawer changes do not mutate inventory
- [x] Inventory sanity checks in dashboard reflect true inventory
- [x] Add regression test for the scenario

**Estimate**: 0.5–2 days (depending on root cause)

---

### [T-33] New module: Binance transfers (send/receive) !

**Added**: Feb 12, 2026  
**Status**: ✅ COMPLETED (Feb 13, 2026)  
**Dependencies**: [T-27]  
**Goal**: Track simple Binance finance transactions (send/receive) with payment method integration.

**Implementation Completed**:

- ✅ **Database**: `binance_transactions` table with type/amount/fee/address/txHash/description, migration `002_add_binance_transactions.sql`
- ✅ **Core**: `BinanceRepository` (CRUD + analytics + drawer integration) + `BinanceService` (business logic wrapper)
- ✅ **Electron**: `binanceHandlers.ts` with IPC channels (`binance:add-transaction`, `binance:get-history`, `binance:get-analytics`), preload API, main.ts registration
- ✅ **Backend**: REST API routes (`/api/binance/transactions`, `/api/binance/history`, `/api/binance/analytics`) in `backend/src/api/binance.ts`
- ✅ **Frontend**: Full page component at `features/binance/pages/Binance/index.tsx` with SEND/RECEIVE toggle, stats cards, transaction history table, session integration
- ✅ **Closing/Opening**: Binance drawer added (USD-only), LBP hardcoded to 0
- ✅ **Tests**: `BinanceService.test.ts` — all passing
- ✅ **Sidebar**: Binance entry with Bitcoin icon

**Architecture**: Standalone `binance_transactions` table (not `financial_services`) since Binance transactions have distinct fields (fee, wallet address, tx hash, USDT currency). Uses same drawer_balances/payments ledger pattern.

**Acceptance Criteria**:

- [x] Create send/receive transactions
- [x] Linked to drawers/payment method model
- [x] Appears in customer session if active

---

### [T-34] New module: IPEC/Katch/WishApp services page (new UI) !

**Added**: Feb 12, 2026  
**Status**: ✅ COMPLETED (Feb 13, 2026)  
**Dependencies**: [T-27], [T-28] recommended  
**Goal**: Add new page with new UI to support common services for IPEC / Katch / Wish App.

**Implementation Completed**:

- ✅ **Database**: Expanded `financial_services` CHECK constraint to include `'IPEC','KATCH','WISH_APP'` providers. Migration `003_add_ikw_providers.sql` + core migration function `migrateIKWProviders()`. Added 6 new `drawer_balances` seeds: IPEC (USD/LBP), Katch (USD/LBP), Wish_App_Money (USD/LBP)
- ✅ **Core Repository**: Extended `FinancialServiceRepository` provider union type + drawer mapping (IPEC→`IPEC`, KATCH→`Katch`, WISH_APP→`Wish_App_Money`)
- ✅ **Core ClosingRepository**: Added `ipecDrawer`, `katchDrawer`, `wishAppDrawer` to `SystemExpectedBalances` interface + `getSystemExpectedBalances()` implementation
- ✅ **Electron**: Mirror changes in electron-app repos + migration registered in `main.ts`
- ✅ **Frontend Page**: `features/ikw-services/pages/IKWServices/index.tsx` — 3-way provider toggle (IPEC blue / Katch orange / Wish App purple), service type buttons (SEND/RECEIVE/BILL_PAYMENT), amount+commission form, stats grid with per-provider breakdown, transaction history table, session auto-fill+link
- ✅ **Routing**: `/ikw-services` route in `App.tsx`
- ✅ **Sidebar**: "IPEC/Katch" entry with Zap icon
- ✅ **Closing/Opening**: 3 new drawers added to `DrawerType` union, `DRAWER_CONFIGS`, `DRAWER_ORDER`, `useSystemExpected` hook, and closing expected balance sums
- ✅ **Tests**: All 312 backend tests passing (23 suites), all type-checks clean across core/frontend/electron-app
  - `core_ikw_migration.test.ts` — 4 tests: no-op when table missing, skip rebuild when already migrated, full migration flow, idempotent drawer seeding
  - `FinancialService.test.ts` — 3 new tests: IPEC/KATCH/WISH_APP provider transactions with correct drawer mapping
  - `ClosingService.test.ts` — updated mocks include ipecDrawer/katchDrawer/wishAppDrawer

**Architecture**: Leverages existing `financial_services` table infrastructure — same table, same repository, same IPC/API channels as OMT/WHISH. Only added new provider values + drawers + frontend page. Zero code duplication.

**Acceptance Criteria**:

- [x] New page exists with the required services UI
- [x] Transactions are recorded consistently with payment method + optional customer session link

---

### [T-26] Enterprise Hardening: Dual-Mode API Facade (`frontend/src/api/backendApi.ts`) !!!

**Status**: ✅ Completed (Feb 12, 2026)

**Completion Summary**:

- Implemented centralized routing helpers (`ipcOrHttp`, `getElectronApi`) in `frontend/src/api/backendApi.ts`
- Fixed missing Electron routes (clients, dashboard, suppliers, users, reports, currencies, rates, etc.)
- Added enforcement tests: `frontend/src/api/__tests__/backendApi.dualmode.test.ts` (Electron mode must not call `fetch`)
- Verified: `yarn test` + `yarn build` (root + backend + frontend)

**Acceptance Criteria**:

- [x] Every exported function in `backendApi.ts` supports Desktop + Web
- [x] Centralized routing to prevent drift
- [x] Automated tests enforce no HTTP in Electron mode

### [T-21] Backend REST API Documentation !!

**Added**: Jan 24, 2026  
**Status**: Ready  
**Dependencies**: [T-20]  
**Goal**: Document the completed backend REST API with OpenAPI/Swagger specification.

**Scope**:

- Generate OpenAPI 3.0 specification
- Add Swagger UI endpoint
- Document all endpoints with request/response examples
- Include authentication and error response patterns

### [T-22] Comprehensive E2E Test Coverage !!

**Added**: Jan 24, 2026  
**Status**: Ready  
**Dependencies**: [T-20]  
**Goal**: Add comprehensive end-to-end tests for critical user flows.

**Scope**:

- Form submission tests (create, update)
- Delete flow tests with confirmation
- Multi-step workflow tests
- Error handling and validation tests

**Follow-up task: E2E performance + CI hardening (recommended before re-enabling in CI)**

- Re-enable E2E in CI once stable (currently disabled with `if: false` in `.github/workflows/ci.yml`).
- Speed/stability improvements (already prototyped):
  - Use production-like servers instead of dev servers:
    - Backend: `yarn workspace @liratek/backend build && yarn workspace @liratek/backend start`
    - Frontend: `yarn workspace @liratek/frontend build && yarn workspace @liratek/frontend preview --host 0.0.0.0 --port 5173`
  - Cache Playwright browsers (`~/.cache/ms-playwright`) via `actions/cache`.
  - Run Playwright with parallel workers (`workers=2`, `fullyParallel: true`) and `retries=1` in CI.
  - Use CI script `yarn workspace @liratek/frontend test:e2e:ci`.
- Recommendation: keep E2E off PRs until refactor dust settles; run on `workflow_dispatch` or nightly.

### [T-23] New Electron Backend Integration !!!

**Priority**: CRITICAL (MUST DO NEXT)  
**Status**: Ready to Start  
**Owner**: Dev Team  
**Created**: Jan 24, 2026

**Goal**: Complete the new Electron app by integrating backend services, enabling deletion of old monolithic structure.

**Context**:

- New clean Electron structure created in `electron-app/`
- Currently minimal (window management + basic IPC bridge)
- Backend services need to be imported and connected
- Once complete, can delete old `electron/` and `src/` folders (~1.5 GB)

**Dependencies**:

- ✅ T-20 Phase 1 (Backend API migration) - Complete
- ✅ T-20 Phase 2 (Structure cleanup prep) - Complete
- ✅ electron-app/ skeleton created - Complete

**Deliverables**:

1. Import all backend services into electron-app/main.ts
2. Register all 19 IPC handler modules
3. Connect handlers to backend services
4. Test all features work in new Electron
5. Update root package.json with final scripts
6. Delete old structure (electron/, src/, public/, etc.)
7. Update documentation

**Estimated Effort**: 3-4 hours

**Implementation Guide**: See `docs/ELECTRON_INTEGRATION_GUIDE.md` for detailed step-by-step instructions.

---

### ~~[T-25] Shared Core Backend Consolidation (packages/core)~~ ✅ **COMPLETED Jan 25, 2026**

**Priority**: URGENT  
**Status**: In Progress (PR1 started)  
**Owner**: Dev Team

**Goal**: Reduce duplication and eliminate parity drift by consolidating shared backend logic into a single core package used by both:

- Desktop backend (`electron-app/`)
- Web backend (`backend/`)

**Context**:
We currently maintain two parallel backends (desktop IPC vs web REST) with duplicated services/repositories. This caused real parity bugs (e.g., debt totals mismatch).

**Reference**:

- See `docs/BACKEND_DIFFERENCES.md` Section 12 (Consolidation Plan) and Section 11 (QA Parity Checklist).

**Deliverables**:

**PR1 (started): Core skeleton + shared DB resolver**

- [x] Create `packages/core/` package skeleton
- [x] Add shared DB resolver (`resolveDatabasePath`) in core
- [x] Wire backend to use core resolver
- [x] Wire electron-app to use core resolver
- [x] Add startup logs showing resolver source (env vs file vs default)

**Next PRs** (from `docs/BACKEND_DIFFERENCES.md`):

1. Create `packages/core/` package
2. Move shared DB path resolver into core
3. Migrate Auth module (crypto + user repo + auth service) into core
4. Migrate Debts module (repo + service) into core
5. Update desktop IPC handlers to call core services
6. Update web REST routes to call core services
7. Run QA Parity Checklist after each migration

**Suggested PR sequence** (from `docs/BACKEND_DIFFERENCES.md`):

- PR1: core skeleton + db path resolver
- PR2: crypto + AuthService + UserRepository
- PR3: DebtRepository + DebtService
- PR4: remaining modules
- PR5: delete duplicated code

---

### ~~[T-24] Unified Database Location (Web + Desktop)~~ ✅ **COMPLETED Jan 25, 2026**

**Priority**: CRITICAL  
**Status**: ✅ COMPLETED
**Owner**: Dev Team

**Goal**: Ensure all app modes (Electron Desktop and Web mode via backend+frontend) use the exact same database file.

**Decision (Option 2)**: **Do not move/rename any existing DB files yet.**
Instead, use a single authoritative DB via `DATABASE_PATH` pointing to the existing mock-data database in Application Support.

**Authoritative DB (currently contains mock data)**:

- `~/Library/Application Support/liratek/phone_shop.db`
  - Verified: `users=1`, `clients=4`, `sales=10`

**Why this approach**:

- Lowest risk: no file moves, no data loss
- Immediate: both Web and Desktop can share the same DB by setting the same path
- Still compatible with a future move to Documents if desired

**How to run**:

**Recommended (no CLI env vars): user-local DB config**

Create:

- `~/Documents/LiraTek/db-path.txt`

**Setup commands (copy/paste):**

```bash
mkdir -p "$HOME/Documents/LiraTek"
echo "$HOME/Library/Application Support/liratek/phone_shop.db" > "$HOME/Documents/LiraTek/db-path.txt"
cat "$HOME/Documents/LiraTek/db-path.txt"
```

Put the absolute DB path inside (one line), e.g.:

- `/Users/amir/Library/Application Support/liratek/phone_shop.db`

Then run normally:

- Desktop: `npm run dev`
- Web: `npm run dev:web`

**Important**: keep `backend/.env` for backend config (PORT/JWT/etc.), but **do not set `DATABASE_PATH` there** unless you intentionally want to override `db-path.txt`.

**Override (advanced): DATABASE_PATH**

- Desktop:
  - `DATABASE_PATH="$HOME/Library/Application Support/liratek/phone_shop.db" npm run dev`
- Web:
  - Set `backend/.env`:
    - `DATABASE_PATH=/Users/amir/Library/Application Support/liratek/phone_shop.db`
  - Then run: `npm run dev:web`

**DB Files You May See (and what they mean)**:

1. `~/Library/Application Support/liratek/phone_shop.db` ✅ **KEEP / AUTHORITATIVE**
   - Old app DB with mock data
2. `~/Library/Application Support/@liratek/electron-app/phone_shop.db` ❌ **DELETE**
   - Empty DB (0 tables)
3. `~/Library/Application Support/@liratek/electron-app/liratek.db` ⚠️ **OPTIONAL BACKUP**
   - Has schema + admin, but no business data (`clients=0`, `sales=0`)

**Requirements**:

1. **Single DB file** shared by:
   - Desktop Electron mode
   - Web mode
2. DB must be **outside the repo** and must **not be committed/pushed**
3. DB location must be clearly documented

**Acceptance Criteria**:

- ✅ Logs confirm both Electron and backend open the same DB path (the `DATABASE_PATH` value)
- ✅ Creating a client/sale in Desktop is visible in Web mode immediately
- ✅ No `*.db` files exist inside the repo

**Completion Summary (Jan 25, 2026)**:

- ✅ Database path resolution implemented in `@liratek/core/src/db/dbPath.ts`
- ✅ Both electron-app and backend use `resolveDatabasePath()` from shared core
- ✅ Configuration file created: `~/Documents/LiraTek/db-path.txt`
- ✅ Points to authoritative DB: `~/Library/Application Support/liratek/phone_shop.db`
- ✅ Verified: Both modes resolve to same database path (source: file:db-path.txt)
- ✅ Database contains mock data: users=1, clients=4, sales=10
- ✅ All acceptance criteria met and verified

**Implementation**:

- Resolution order: DATABASE_PATH env var → ~/Documents/LiraTek/db-path.txt → platform defaults
- Both modes log the resolved path and source for verification
- SQLite WAL mode ensures consistency across concurrent access

---

### [T-01] Two-Wallet System & Mixed Payment Support !!!

**Status**: ✅ Completed (Feb 16, 2026) — implemented via Payment Methods system (CASH, OMT, WHISH, BINANCE, DEBT)  
**Goal**: Support `CASH`, `WHISH`, `OMT`, `BINANCE` payment methods with proper drawer tracking.

### [T-02] Supplier Ledger (Dual-Currency Debt) !!!

**Status**: ✅ Completed (Jan 24, 2026)  
**Goal**: "Pay Supplier" workflow with optional cash drawer updates.

### [T-03] Smart Barcode Duplicate Handler !!

**Status**: Ready  
**Goal**: Handle duplicate barcodes (DUP1, DUP2) with autogen logic.

### [T-04] Telecom Profit Engine (MTC/Alfa Special Logic) !!

**Status**: Ready  
**Goal**: Specific accounting for recharge fees ($0.16) and bundle logic.

### [T-05] Loto Module !

**Status**: Ready  
**Goal**: Real-time profit tracking for lottery services.

### [T-06] Binance Service Module !

**Status**: ✅ Completed (Feb 13, 2026) — consolidated into Mobile Recharge page (Feb 16)  
**Goal**: Integration for Binance-based payments and transfers.

### [T-07] Admin-Only Security "Late Entry" !!

**Status**: Ready  
**Goal**: Allow admins to record transactions for past dates securely.

### [T-08] IMEI & Warranty Tracking !!!

**Status**: ✅ Completed (Jan 24, 2026)  
**Goal**: Prompt for IMEI during phone sales; link to sale_items for warranty receipts.

### [T-09] Monthly Analytics & Gross Profit Dashboard !!!

**Status**: ✅ Completed (Jan 24, 2026)  
**Goal**: Aggregate daily closings into monthly P&L view; calculate true Gross Profit.  
**Note**: Implemented as centralized Financial Reporting with Monthly P&L aggregation and Commissions Dashboard.

### [T-10] Real-time Drawer Balances !!!

**Status**: Ready  
**Goal**: Live running totals for all drawers in the Dashboard.

### [T-11] Hardware Barcode Scanner Integration !!

**Status**: Ready  
**Goal**: Native support for physical scanners in POS and Inventory.

### [T-12] Receipt Printer Support !!

**Status**: Ready  
**Goal**: ESC/POS support for thermal receipt printers.

### [T-13] Email Receipt Delivery !

**Status**: Ready  
**Goal**: Send digital receipts to customers via email.

### [T-14] Versioned Migration System !!

**Status**: ✅ Completed (Feb 16, 2026) — sequential version-based migrations in `packages/core/src/db/migrations/index.ts` (v9–v13)  
**Goal**: Transition from `ensureColumnExists` to timestamp-based SQL migrations.

### [T-15] Data Archival Workflow !

**Status**: Ready  
**Goal**: Archive records older than 1 year to maintain performance.

### ~~[T-16] SQLCipher DB Encryption~~ ✅ **COMPLETED Jan 25, 2026**

**Status**: ✅ Infrastructure Complete - Documented as Optional Advanced Feature
**Goal**: Secure the local database file using SQLCipher encryption.

**Current Status (Jan 25, 2026)**:

- ✅ Key management system implemented (`@liratek/core/src/db/dbKey.ts`)
- ✅ Encryption integration implemented (`@liratek/core/src/db/sqlcipher.ts`)
- ✅ Both electron-app and backend integrated with encryption system
- ✅ Resolution order: DATABASE_KEY env → ~/Documents/LiraTek/db-key.txt → none
- ❌ Current better-sqlite3@12.6.2 doesn't include SQLCipher (standard SQLite only)

**To Complete**:

1. **Decision Required**: Choose SQLCipher implementation:
   - ❌ Option A: @journeyapps/sqlcipher - NOT COMPATIBLE (uses async node-sqlite3 API, would require complete rewrite)
   - Option B: Build better-sqlite3 with SQLCipher from source (recommended but complex)
   - Option C: Document encryption as optional feature requiring custom build (CURRENT STATUS)
   - ✅ Option D: Use better-sqlite3-with-sqlcipher package if available

2. **Building better-sqlite3 with SQLCipher**:
   - Requires SQLCipher development libraries installed on system
   - Platform-specific build process (macOS, Windows, Linux)
   - Needs electron-rebuild for Electron compatibility
   - High complexity for end users

**Architecture**:

- Infrastructure is production-ready and waiting for SQLCipher-enabled build
- Code will work immediately once SQLCipher support is available
- Gracefully handles missing SQLCipher support (logs warning, continues unencrypted)

**Investigation Results (Jan 25, 2026)**:

- ❌ @journeyapps/sqlcipher is NOT compatible - uses completely different async API
- ✅ Infrastructure complete and working with standard better-sqlite3
- ✅ Will work with SQLCipher-enabled better-sqlite3 build without code changes
- 📋 Decision: Document as optional advanced feature for users who can build with SQLCipher

### [T-17] Admin Closing Approval !!

**Status**: Ready  
**Goal**: Staff closings flagged as 'Pending' until admin approval.

---

## 📦 P-Tasks: Platform & Release

### P0 — Release Quality (Critical Path)

#### [P0-1] Installer QA !!!

**Status**: On Hold  
**Goal**: Test installers on real systems (Windows installer + macOS .app/.dmg).

#### [P0-2] Build Verification !!!

**Status**: On Hold  
**Goal**: Verification on clean machines (first-run, single-instance, permissions).

#### [P0-3] Code Signing !!!

**Status**: On Hold  
**Goal**: Setup for macOS notarization and Windows code signing.

### P1 — Shipping Improvements

#### [P1-1] Automated Testing !!

**Status**: On Hold  
**Goal**: Increase coverage toward ~70% (keep CI green).

#### [P1-2] Auto-Updater !

**Status**: On Hold  
**Goal**: Implementation beyond the current scaffold.

#### [P1-3] User Documentation !!

**Status**: On Hold  
**Goal**: Help system for install/admin and general user guide.

### P2 — Operational Enhancements (Completed)

- ✅ **Closing Report Auto-Attach**: Automatically link generated PDFs to closing records
- ✅ **Variance Threshold Alerts**: Visual warnings for cash discrepancies in Closing
- ✅ **Performance Hardening**: Database indexes and optimized query patterns
- ✅ **Backup Automation**: Automated local DB backups with restore verification

---

## 📈 Recent Completions (Feb 22, 2026)

### Profit Audit & Pending Profit (T-53) ✅

- **Fully-paid filter** on all 5 sale profit queries in ProfitService + ClosingRepository — unpaid debt sales excluded from realized profit
- **FIFO debt repayment** — `DebtRepository._markSalesPaidFIFO()` recognizes profit when debt is fully repaid (oldest unpaid sale first)
- **Pending Profit tab** — 7th tab on Profits page showing unpaid sales with deferred revenue (3 summary cards + DataTable)
- **Recharges & financial services** included in all profit analysis methods
- **is_refunded filter** — refunded items excluded from profit
- **Bug fix** — corrected `s.client_name`/`s.client_phone` → client table JOIN
- **16 unit tests** for `getPendingProfit` (SQL correctness, aggregation, error handling)

### Refund/Void Flow Rewrite (T-54) ✅

- Complete transactional rewrite of `voidTransaction()` and `refundTransaction()` in `TransactionRepository`
- **Double-refund guard** prevents duplicate reversals
- **Drawer balance reversal** — cash/LBP removed from drawer on refund
- **Stock restoration** — POS sale items restored to inventory
- **Debt cancellation** — associated debts removed on void
- **Admin auth** — void/refund routes require admin role

### Binance Merge into Financial Services (T-52) ✅

- **Migration v25** migrates `binance_transactions` → `financial_services` (provider = 'BINANCE'), drops old table
- Deleted standalone `BinanceService.ts` and `BinanceRepository.ts`
- BINANCE added to `FinancialServiceProvider` enum
- New doc: `docs/FINANCIAL_SERVICES_ARCHITECTURE.md`

### Financial Services T-30 Completed ✅

- **Migration v22** — `phone_number` and `omt_service_type` columns on `financial_services`
- **OMT service type dropdown** — 7 types (Bill Payment, Cash To Business, etc.)
- **Bidirectional settlement view** — per-provider USD/LBP owed amounts

### Other Fixes ✅

- **CheckoutModal focus fix** — prevented focus-stealing bug on POS page
- **Migrations v22–v25** — all idempotent with `IF NOT EXISTS` / `IF EXISTS` guards
- **Test suite** — 326 backend tests passing (22 suites), up from 291

---

## 📈 Recent Completions (Feb 16, 2026 — evening)

### WhatsApp Cloud API Integration (T-45) ✅

- Full-stack WhatsApp Cloud API integration via Meta's Graph API v21.0
- `WhatsAppService` in `@liratek/core`: `sendMessage()`, `sendTemplate()`, `sendTestMessage()`, `formatLebanonNumber()`
- Electron IPC handlers (`whatsapp:send-test`, `whatsapp:send-message`) + preload API
- Frontend API functions with dual-mode (IPC + HTTP) support
- Settings > Integrations UI: Access Token, Phone Number ID, test connection with feedback
- Uses `hello_world` template for test messages (pre-approved, no 24h window needed)
- Successfully tested: message delivered to 81077357

### Recharge UX Polish (T-29 continued) ✅

- Binance CryptoForm completely rewritten to match FinancialForm pattern (stats row, w-1/3 form, matching inputs)
- Binance stat cards have subtitles ("outgoing", "incoming", "today") + tab shows USD volume
- Supplier debt banners moved above provider cards
- Supplier Ledger shows all suppliers (not just system), sorted system-first then alphabetical, SYS badge removed

### Settings Cleanup ✅

- Removed legacy Admin section, global Save/Cancel buttons, and all associated unused state/effects/handlers
- Created Integrations tab with self-contained `IntegrationsConfig` component
- Settings/index.tsx reduced from ~300 lines to ~70 lines
- 10 tabs: shop, drawer, suppliers, notifications, activity, modules, currencies, users, integrations, diagnostics

### Supplier Structure Fix (T-43 continued) ✅

- Added "Whish App" supplier (WHISH_APP, ipec_katch config) — migration v13
- Final 6 system suppliers: IPEC, Katch, OMT, Whish, OMT App, Whish App
- Fixed `scripts/migrate.ts` to self-initialize DB from `db-path.txt`

---

## 📈 Recent Completions (Feb 16, 2026 — earlier)

### Recharge Consolidation (T-39) ✅

- Merged 3 module pages (MTC/Alfa, IPEC/Katch/Whish App/OMT App, Binance) into one consolidated "Mobile Recharge" page
- Migration v12: routes consolidated to `/recharge`, recharge label → `MTC/Alfa`, `OMT_APP` provider + supplier added, drawer names fixed
- Sidebar: 3 modules → 1 "Mobile Recharge" link (useMemo-wrapped dedup logic)
- 7 providers, 3 form modes (telecom/financial/crypto), module-aware visibility
- Old pages moved to `features/recharge/pages/{Binance,IKWServices}/` — old routes redirect
- App.tsx: `/binance` and `/ikw-services` redirect to `/recharge`

### Dynamic Currencies (T-40) ✅

- New tables: `currency_modules`, `currency_drawers` — DB-driven currency↔module and currency↔drawer mappings
- `CurrencyContext` + `CurrencySelect` component for app-wide formatting
- Expanded `CurrencyManager` settings page: full CRUD for currencies, module assignments, drawer mappings
- EUR and USDT seeded as new currencies
- Closing system switched from hardcoded `SystemExpectedBalances` to dynamic `DynamicSystemExpectedBalances`

### DB-Driven Modules (T-41) ✅

- New `modules` table with 15 seeded modules (3 system, 12 toggleable)
- `ModuleRepository` + `ModuleService` + backend API + electron handlers
- `ModuleContext` with `useModules()` hook, `isModuleEnabled()` utility
- `ModulesManager` settings page — toggle modules on/off
- Sidebar fully DB-driven via `enabledModules` instead of hardcoded array
- Dynamic shop name via `useShopName()` hook

### Payment Methods Manager (T-42) ✅

- New `payment_methods` table with 5 seeds (CASH, OMT, WHISH, BINANCE, DEBT)
- Full-stack: `PaymentMethodRepository` → `PaymentMethodService` → API → handlers → preload
- `usePaymentMethods` hook supplies all transaction forms
- `PaymentMethodsManager` settings page for CRUD

### Drawer Fixes & Supplier Linking (T-43) ✅

- Fixed: `Wish_App_Money` → `Whish_System` across DB + all code references
- Fixed: `WHISH` maps to `Whish_System`, `WISH_APP` maps to `Whish_App`
- Added `OMT_APP` provider — distinct from `OMT`, maps to `OMT_App` drawer
- Migration v11: supplier-module linking with `module_key`, `provider`, `is_system` columns
- Migration v12: drawer renames + new drawer seeds (OMT_App, Whish_App, Binance)
- Migration v13: Whish App supplier (WHISH_APP, ipec_katch config) seeded
- System suppliers seeded: IPEC, Katch, OMT, Whish, OMT App, Whish App

### Documentation (T-44) ✅

- 8 docs archived to `docs/archive/`
- 2 docs deleted (replaced by consolidated LOGGING.md)
- 4 new docs: DYNAMIC_CURRENCIES.md, LOGGING.md, MODULE_MANAGEMENT.md, RECHARGE_CREDITS.md

---

## 📈 Recent Completions (Feb 13, 2026)

### [T-33] Binance Module ✅

- Full-stack Binance send/receive module: DB table + migration, core repo/service, electron handlers+preload, backend REST API, frontend page with stats+history, session integration
- Binance drawer: USD-only in closing/opening, LBP hardcoded to 0
- Tests: BinanceService.test.ts passing

### [T-34] IPEC/Katch/Wish App Module ✅

- Extended `financial_services` CHECK constraint with 3 new providers (`IPEC`, `KATCH`, `WISH_APP`)
- Core migration `migrateIKWProviders()` + SQL migration `003_add_ikw_providers.sql`
- 6 new drawer_balances seeds (IPEC USD/LBP, Katch USD/LBP, Wish_App_Money USD/LBP)
- Updated FinancialServiceRepository drawer mapping in both core and electron-app
- 3 new drawers in ClosingRepository `SystemExpectedBalances` + closing/opening UI
- New frontend page: `features/ikw-services/pages/IKWServices/index.tsx` with 3-way provider toggle (IPEC blue / Katch orange / Wish App purple)
- Route `/ikw-services`, sidebar entry "IPEC/Katch" with Zap icon
- Unit tests: `core_ikw_migration.test.ts` (4 tests), FinancialService IPEC/KATCH/WISH_APP tests (3 tests), ClosingService drawer mocks updated

### [T-36] Debts Page Redesign ✅

- Split single mixed timeline table into two side-by-side tables: Purchases (left, red) and Payments (right, emerald)
- Added `total_debt_usd` and `total_debt_lbp` to DebtorSummary and TopDebtor interfaces
- Updated debtor sidebar to show USD + LBP separately
- Added COALESCE wrappers to all DebtRepository SUM queries for NULL safety

### [T-37] Dashboard Improvements ✅

- Total Debt card: now shows USD and LBP separately instead of single value
- Top Debtors: replaced Recharts BarChart with simple list showing USD + LBP per debtor
- USD precision: changed `maximumFractionDigits` from 0 to 2 for all USD values on dashboard cards (shows $139.64 instead of $140)
- Added `totalDebtUsd` / `totalDebtLbp` to `DebtSummary` interface + SQL queries

### [T-38] Runtime Bug Fixes ✅

- **Exchange CHECK constraint**: DB only allows 'BUY'/'SELL', code had 'EXCHANGE' → derived from fromCurrency
- **Session linking**: Used `getActiveSession()` instead of explicit session ID → threaded sessionId from React state
- **Recharge credits**: Fixed incorrect credit balance updates
- **Top Debtors chart empty**: ResponsiveContainer height issue → added `min-h-[150px]`
- **Backend test fixes**: Fixed jest.requireActual pattern for AuthService, ActivityService, ClosingService stubs

### Test Status

- **All 312 backend tests passing** (23 suites)
- **All type-checks clean** across core, frontend, and electron-app

---

## 📈 Recent Completions (Jan 23-24)

- ✅ Fix Jest Matchers TypeScript regression
- ✅ Resolve `yarn build` CSS import errors
- ✅ Analyze `dev` branch features and update documentation
- ✅ Restore missing documentation from `archive/dev-legacy`
- ✅ Consolidated fragmented docs into DEVELOPMENT.md
- ✅ **T-08**: IMEI & Warranty Tracking
- ✅ **T-02**: Supplier Ledger Drawer Integration
- ✅ **Financial Reporting & Analytics**: Monthly P&L + Commissions Dashboard
- ✅ **Debt Repayment Rounding Fix** (Jan 24): Fixed rounding discrepancy in debt repayments where paying fractional amounts in LBP caused $0.01 errors
- ✅ **T-20 Phase 1 API Endpoints** (Jan 24): Created all remaining backend REST API endpoints (Closing, Suppliers, Rates, Users, Activity, Reports) - 19/19 modules complete
- ✅ **T-20 Phase 2 Structure Cleanup** (Jan 24): Updated root package.json to workspace-only mode, prepared old structure for deletion, migrated all functionality to frontend/backend workspaces
- ✅ **T-23 Electron Integration** (Jan 24): Created new electron-app/ with complete backend integration, all 19 modules working, deleted old monolithic structure (~1.5 GB freed)

---

## ✅ Recently Completed (Jan 25, 2026)

### [T-25] Shared Core Backend Consolidation ✅

**Status:** COMPLETED (Including CI/CD Fix)
**Date:** January 25, 2026
**Commits:** e891047 (main implementation), 5733f88 (CI fix)

Created `@liratek/core` monorepo package to eliminate code duplication between electron-app and backend.

**Achievements:**

- ✅ Created packages/core/ with all shared code
- ✅ Reduced codebase by 9,336 lines
- ✅ Extracted 18 repositories to shared package
- ✅ Extracted 17 services to shared package
- ✅ Extracted all utilities (crypto, logger, errors, barcode)
- ✅ Both electron-app and backend now use shared implementation
- ✅ Fixed electron-app soft delete bug (is_deleted → is_active)
- ✅ Fixed AuthService.login() async/await bug
- ✅ Added proper database initialization in both platforms
- ✅ Tested: Both Electron and Browser modes working with authentication
- ✅ Fixed CI/CD pipeline by adding build:core step before electron build
- ✅ All GitHub Actions workflows passing (Windows, macOS Intel, macOS ARM)

**Impact:**

- Unblocks T-16 (SQLCipher DB Encryption)
- Eliminates future code sync issues

---

### [T-48] Profits Module !!

**Added**: Feb 21, 2026
**Status**: ✅ Completed (Feb 21–22, 2026)
**Goal**: Full-stack admin-only profits analytics module with 7 analysis tabs + profit audit.

**Implementation Completed (Feb 21)**:

- ✅ **ProfitService** (`packages/core`) — queries sale_items, financial_services, custom_services, maintenance, expenses for margin calculations
- ✅ **REST API** (`backend/src/api/profits.ts`) — 7 endpoints with `requireRole(["admin"])`
- ✅ **Electron IPC** (`electron-app/handlers/profitHandlers.ts`) — 7 IPC channels
- ✅ **Frontend** (`frontend/src/features/profits/pages/Profits.tsx`) — 7 tabs: Overview (KPI cards), By Module, By Date (bar chart + table), By Payment Method, By Cashier, By Client, **Pending Profit**
- ✅ **Migration v21** — profits module registration in modules table

**Profit Audit & Enhancements (Feb 22)**:

- ✅ **Fully-paid filter** — all 5 sale profit queries in ProfitService + ClosingRepository exclude sales with outstanding debt from realized profit
- ✅ **FIFO debt repayment** — `DebtRepository._markSalesPaidFIFO()` updates `sales.paid_usd` when debt is repaid, triggering profit recognition
- ✅ **Pending Profit tab** — full-stack 7th tab showing unpaid sales with deferred profit (ProfitService.getPendingProfit → backend route → Electron IPC → frontend UI with 3 summary cards + DataTable)
- ✅ **Recharges & financial services** — included in all 6 profit analysis methods
- ✅ **is_refunded filter** — excludes refunded sale items from profit calculations
- ✅ **Bug fix** — corrected non-existent `s.client_name`/`s.client_phone` column references to use client table joins
- ✅ **16 unit tests** for `getPendingProfit` in `backend/src/__tests__/pending_profit.test.ts`
- ✅ **28 unit tests** for T-30 Financial Services in `backend/src/__tests__/financial_services_t30.test.ts`
- ✅ All typechecks clean, 326 tests passing (22 suites)

---

### [T-49] Table Export — ExportBar Component !

**Added**: Feb 21, 2026
**Status**: ✅ Completed (Feb 21, 2026)
**Goal**: Add Excel (.xlsx) and PDF export buttons to all 24 table instances across the project.

**Implementation Completed**:

- ✅ **tableExport.ts** utility — extracts data from `<table>` DOM, generates Excel (SheetJS) and PDF (jsPDF + autotable)
- ✅ **ExportBar** component — `exportExcel` + `exportPdf` boolean props, green/red styled buttons, hidden when both false
- ✅ Integrated into 24 tables across 18 files (Profits, Reports, Debts, Services, CustomServices, Maintenance, Inventory, Recharge, IKWServices, Binance, Exchange, Expenses, CommissionsDashboard, ClientList, ActivityLog, UsersManager, ModulesManager, RatesManager)
- ✅ Dependencies: `xlsx`, `jspdf`, `jspdf-autotable`, `file-saver`

---

### [T-50] Reusable TableComponent !!

**Added**: Feb 21, 2026
**Status**: ✅ Completed (Feb 21, 2026)
**Goal**: Consolidate the ExportBar + inline `<table>` pattern into a single reusable `<DataTable>` component to reduce boilerplate across all 24 table instances.

**Implementation Completed**:

- ✅ Created `frontend/src/shared/components/DataTable.tsx` — generic `<T>` component
  - Props: `columns` (string | DataTableColumn with ReactNode headers), `data`, `renderRow`, `exportExcel`, `exportPdf`, `exportFilename`, `loading`, `emptyMessage`, `emptyContent`, `footerContent`, `className`, `theadClassName`, `thClassName`, `tbodyClassName`
  - Manages `useRef<HTMLTableElement>` internally, renders ExportBar + table
- ✅ Migrated 22 tables across 14 files:
  - Simple (8): RatesManager, UsersManager, CommissionsDashboard, Exchange, Expenses, Maintenance, ClientList, ProductList
  - Medium (4): Services, CustomServices, Binance, IKWServices
  - Recharge (2): tableRef + cryptoTableRef
  - Debts (3): debtTableRef, paymentTableRef, saleItemsTableRef (with interactive sort column headers)
  - Reports (3): dailyTableRef (with expandable rows), revenueTableRef, overdueTableRef
  - Profits (5): moduleTableRef, dateTableRef (with footer totals row), paymentTableRef, cashierTableRef, clientTableRef
- ✅ Kept 2 files unmigrated by design: ModulesManager (multi-section tbody), ActivityLogViewer (TanStack Table)
- ✅ Deleted unused `useTableExport.tsx` hook
- ✅ All checks pass: typecheck clean, 81 frontend + 326 backend tests, lint 0 errors, build success

**Acceptance Criteria**:

- [x] `<DataTable>` component created with full props API
- [x] All inline tables migrated to `<DataTable>` (22/24, 2 excluded by design)
- [x] ExportBar embedded inside DataTable (no separate ExportBar imports needed)
- [x] Typecheck clean, no visual regressions
- [x] TanStack table instance kept separate (ActivityLogViewer)

**Estimate**: 1–2 days (completed in 1 day)

- Single source of truth for business logic
- Production-ready builds working across all platforms

---

### [T-51] Consolidated Reports Page — Multi-Module Export !!

**Goal**: Create a reporting page where the user can see all modules listed with checkboxes, select one or more, and export the combined data as Excel or PDF.

**Implementation Plan**:

- New page: `frontend/src/features/reports/pages/ConsolidatedReport.tsx` (or extend existing Reports page with a new tab)
- List all toggleable modules (from `getToggleableModules()`) with checkboxes
- For each selected module, fetch today's (or date-range-filtered) transaction data
- Render a combined preview table showing all selected modules' data
- Excel export: one sheet per module, or a single sheet with a "Module" column
- PDF export: combined table with module grouping headers
- Reuse existing `ExportBar` / `exportToExcel` / `exportToPdf` utilities

**Data Sources per Module**:

| Module            | API Call                    | Key Fields                                          |
| ----------------- | --------------------------- | --------------------------------------------------- |
| `recharge`        | `getRechargeHistory()`      | type, amount, commission, client, time              |
| `ipec_katch`      | `getFinancialHistory()`     | provider, type, amount, commission, client, time    |
| `binance`         | `getBinanceTransactions()`  | type, amount, client, time                          |
| `exchange`        | `getExchangeHistory()`      | from, to, rate, amount_in, amount_out, time         |
| `omt_whish`       | `getFinancialHistory()`     | provider, type, amount, commission, time            |
| `expenses`        | `getTodayExpenses()`        | category, amount_usd, amount_lbp, description, time |
| `debts`           | `getDebts()`                | client, amount_usd, amount_lbp, status              |
| `pos`             | `getSales()`                | items, total, payment_method, time                  |
| `maintenance`     | `getMaintenanceJobs()`      | client, device, status, cost, time                  |
| `custom_services` | `getCustomServiceHistory()` | description, amount, time                           |

**UI Layout**:

- Top: Date range filter (default: today)
- Left panel: Module checkboxes with select-all/deselect-all
- Right/main area: Preview table of combined data
- Bottom: Export buttons (Excel / PDF) — hidden when no modules selected or no data

**Acceptance Criteria**:

- [ ] All toggleable modules listed with checkboxes
- [ ] Select/deselect individual modules or all at once
- [ ] Combined data preview table rendered for selected modules
- [ ] Excel export works (one sheet per module or grouped)
- [ ] PDF export works with module grouping
- [ ] Empty state when no modules selected or no data
- [ ] Date range filter controls the query window

**Estimate**: 2–3 days

---

### [T-52] Binance Merge into Financial Services !!

**Added**: Feb 22, 2026
**Status**: ✅ Completed (Feb 22, 2026)
**Goal**: Eliminate standalone Binance module by merging it into the unified Financial Services architecture as a BINANCE provider.

**Implementation Completed**:

- ✅ **Migration v25** — migrates all `binance_transactions` data into `financial_services` table with `provider = 'BINANCE'`, then drops old table
- ✅ **Deleted** `BinanceService.ts` and `BinanceRepository.ts` — all logic now handled by `FinancialServiceRepository` with BINANCE provider
- ✅ **Updated validators** — added BINANCE to `FinancialServiceProvider` enum in `financialServiceValidators.ts`
- ✅ **Frontend** — Binance transactions now appear under Services page alongside OMT/Whish
- ✅ **Electron IPC** — removed standalone Binance IPC handlers, uses financial services channels
- ✅ **Architecture doc** — `docs/FINANCIAL_SERVICES_ARCHITECTURE.md` documents the unified provider model

---

### [T-53] Profit Audit & Pending Profit !!

**Added**: Feb 22, 2026
**Status**: ✅ Completed (Feb 22, 2026)
**Goal**: Ensure profit calculations are accurate by excluding unpaid sales and adding a Pending Profit view for deferred revenue.

**Implementation Completed**:

- ✅ **Fully-paid filter** on all 5 sale profit queries in `ProfitService` + `ClosingRepository` snapshot — sales with outstanding debt excluded from realized profit using formula: `(paid_usd + COALESCE(paid_lbp,0) / exchange_rate) >= final_amount_usd - 0.05`
- ✅ **FIFO debt repayment** — `DebtRepository._markSalesPaidFIFO()` updates `sales.paid_usd` when debt payments are recorded, oldest unpaid sale first, triggering profit recognition when fully paid
- ✅ **PendingProfitRow type** — `sale_id`, `sale_date`, `client_name`, `phone_number`, `final_amount_usd`, `paid_usd`, `outstanding_usd`, `pending_profit`
- ✅ **getPendingProfit()** — new ProfitService method querying unpaid sales with their deferred margin
- ✅ **Full-stack feature** — backend REST route, Electron IPC handler, preload bridge, API types, ElectronApiAdapter, frontend 7th tab with 3 SummaryCards (Unpaid Sales, Outstanding Amount, Pending Profit) + DataTable
- ✅ **Bug fix** — corrected `s.client_name`/`s.client_phone` → `COALESCE(c.full_name, 'Unknown')` / `COALESCE(c.phone_number, '')` via client JOIN
- ✅ **16 unit tests** in `backend/src/__tests__/pending_profit.test.ts` — SQL correctness, totals aggregation, error handling

---

### [T-54] Refund/Void Flow Rewrite !!!

**Added**: Feb 22, 2026
**Status**: ✅ Completed (Feb 22, 2026)
**Goal**: Replace fragile refund/void logic with a robust transactional flow that properly reverses all side effects.

**Implementation Completed**:

- ✅ **Transaction wrapper** — both `voidTransaction()` and `refundTransaction()` in `TransactionRepository` run inside a single SQLite transaction for atomicity
- ✅ **Double-refund guard** — checks `is_refunded` flag before processing, prevents duplicate reversals
- ✅ **Drawer balance reversal** — refunds/voids reverse the original payment's drawer impact (cash removed from drawer, LBP removed from drawer)
- ✅ **Stock restoration** — POS sale items restored to `inventory.quantity` on refund/void
- ✅ **Debt cancellation** — `_cancelDebt()` removes associated debt records and resets `sales.paid_usd` when voiding a credit sale
- ✅ **Admin auth** — void and refund routes require `requireRole(["admin"])`
- ✅ **is_refunded flag** — set on both `sales` and `sale_items` tables to exclude from profit calculations
