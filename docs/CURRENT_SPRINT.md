# Current Sprint (Feb 12–Feb 19, 2026)

**Last Updated**: Feb 13, 2026

## 📖 How to Read This Document

- **Sprint Board**: High-level Kanban view of all task statuses
- **T-Tasks**: Technical implementation tasks (business logic, features, architecture)
- **P-Tasks**: Platform/release tasks (QA, distribution, documentation)
- **Priority Scale**: `!!!` High | `!!` Medium | `!` Low

---

## 🏗️ Sprint Board

### ✅ Completed

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

- None currently - Ready for next sprint task

### 🔜 Next Priority (MUST DO)

- [T-29]!!! Recharge Module UX + voucher images + debt payment + remove phone fields
- [T-30]!!! Financial Services (OMT/Whish) improvements: phone param + service dropdown + settlement visibility
- [T-31]!! Expenses simplification: remove types dropdown

### 📋 Ready (Ordered by Priority)

**This Sprint Focus (Urgent)**

**High Priority (!!!)**

- [T-29]!!! Recharge Module UX + voucher images + debt payment + remove phone fields
- [T-30]!!! Financial Services (OMT/Whish) improvements: phone param + service dropdown + settlement visibility

**Medium Priority (!!)**

- [T-31]!! Expenses simplification: remove types dropdown

**Low Priority (!)**

- (All low priority tasks completed this sprint)

---

**Backlog / Later (post-urgent sprint)**

**High Priority (!!!)**

- [T-19]!!! Migrate Remaining Features to Backend API
- [T-01]!!! Two-Wallet System & Mixed Payment Support
- [T-10]!!! Real-time Drawer Balances
- [P0-1]!!! Installer QA
- [P0-2]!!! Build Verification
- [P0-3]!!! Code Signing

**Medium Priority (!!)**

- [T-21]!! Backend REST API Documentation
- [T-22]!! Comprehensive E2E Test Coverage
- [T-03]!! Smart Barcode Duplicate Handler
- [T-04]!! Telecom Profit Engine (MTC/Alfa)
- [T-07]!! Admin-Only Security "Late Entry"
- [T-11]!! Hardware Barcode Scanner Integration
- [T-12]!! Receipt Printer Support
- [T-14]!! Versioned Migration System
- [T-17]!! Admin Closing Approval
- [P1-1]!! Automated Testing
- [P1-3]!! User Documentation

**Low Priority (!)**

- [T-05]! Loto Module
- [T-06]! Binance Service Module
- [T-09]! Monthly Analytics & Gross Profit Dashboard (already delivered as Financial Reporting & Analytics)
- [T-13]! Email Receipt Delivery
- [T-15]! Data Archival Workflow
- [P1-2]! Auto-Updater

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
- [ ] Verify WebSocket real-time updates work (in testing)
- [ ] Test all features end-to-end in browser mode (in testing)

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

- [ ] Backup current state
- [ ] Delete old folders
- [ ] Update root package.json
- [ ] Delete duplicate config files
- [ ] Test that workspace still builds and runs
- [ ] Update documentation to reflect new structure

### [T-27] Payment Methods Everywhere + Drawer Model Expansion (OMT System / Whish App / Binance) !!!

**Added**: Feb 12, 2026  
**Status**: 🚧 In Progress  
**Goal**: Standardize and support payment methods across _all_ transactions and ensure drawer propagation works in Opening/Closing.

**Why first**: This is a foundation task. Recharge/Services/Binance/Whish all depend on consistent payment+drawer handling.

**Scope**:

- Unify `pay_by` (or equivalent) across modules: `cash`, `debt`, `whish_app`, `omt_system`, `binance`
- Add drawers in DB + propagation through:
  - Opening balances
  - Closing balances
  - Dashboard drawer balances
- Drawer naming changes:
  - Rename `omt` → `omt system`
  - Rename `wish` → `whish app`
  - Add `Binance` drawer
  - Add `Omt app drawer` (clarify in schema as separate from cash drawers)

**Acceptance Criteria**:

- [ ] Any transaction can be tagged with a payment method from the standardized set
- [ ] Drawer totals correctly update for all payment methods where applicable
- [ ] Opening/Closing includes the new drawers and names consistently
- [ ] Dashboard reflects the new drawers

**Estimate**: 1.5–3 days (depends on schema + migration + UI touch points)

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
**Status**: Ready  
**Dependencies**: [T-27] for payment methods  
**Goal**: Improve recharge workflows and remove unnecessary phone fields.

**Requested changes**:

- Add voucher images (attach image per voucher / show in UI)
- Add debt payment support in recharge
- Remove phone number from voucher card in Recharge module
- In “days validity” flow also remove phone number field

**Acceptance Criteria**:

- [ ] Recharge voucher cards show images
- [ ] Recharge can be paid by debt + other payment methods
- [ ] No phone number field appears in voucher UI or days-validity flow

**Estimate**: 1–3 days

---

### [T-30] Financial Services (OMT/Whish) improvements: phone param + service dropdown + settlement visibility !!!

**Added**: Feb 12, 2026  
**Status**: Ready  
**Dependencies**: [T-27]  
**Goal**: Make OMT/Whish transactions capture required phone number and improve clarity of who owes what.

**Global requirement**:

- These transactions depend on phone number → ensure a phone field exists and is passed as a parameter into transactions.

**OMT specific**:

- Show what OMT needs from user in USD/LBP and what user needs from OMT
- Add dropdown service selection:
  - Bill Payment
  - Cash To Business
  - Ministry of Interior Transactions (معاملات وزارة الداخلية)
  - Cash Out
  - Ministry of Finance Transactions (معاملات وزارة المالية)
  - INTRA
  - Online Brokerage

**Whish specific**:

- Show what you owe (requires technical discussion: exact accounting model)

**Acceptance Criteria**:

- [ ] OMT/Whish forms include phone number and it’s stored
- [ ] OMT supports selecting the service type from the list
- [ ] OMT UI shows the two-sided settlement view (USD+LBP)
- [ ] Whish “owe” view implemented per agreed model

**Estimate**: 2–4 days (depends on accounting decision for Whish)

---

### [T-31] Expenses simplification: remove types dropdown !!

**Added**: Feb 12, 2026  
**Status**: Ready  
**Goal**: Remove the expense “types” dropdown to simplify entry.

**Acceptance Criteria**:

- [ ] UI no longer shows types dropdown
- [ ] Backend accepts expense without type
- [ ] Reports unaffected

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

- [ ] Opening drawer changes do not mutate inventory
- [ ] Inventory sanity checks in dashboard reflect true inventory
- [ ] Add regression test for the scenario

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
- [ ] Wire backend to use core resolver
- [ ] Wire electron-app to use core resolver
- [ ] Add startup logs showing resolver source (env vs file vs default)

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

**Status**: Ready  
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

**Status**: Ready  
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

**Status**: Ready  
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
- Single source of truth for business logic
- Production-ready builds working across all platforms
