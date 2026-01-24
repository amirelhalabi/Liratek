# Current Sprint (Jan 23–Jan 30, 2026)

**Last Updated**: Jan 24, 2026

## 📖 How to Read This Document

- **Sprint Board**: High-level Kanban view of all task statuses
- **T-Tasks**: Technical implementation tasks (business logic, features, architecture)
- **P-Tasks**: Platform/release tasks (QA, distribution, documentation)
- **Priority Scale**: `!!!` High | `!!` Medium | `!` Low

---

## 🏗️ Sprint Board

### ✅ Completed
- [T-18]!!! Frontend/Backend Separation
- [T-08]!!! IMEI & Warranty Tracking
- [T-02]!!! Supplier Ledger Drawer Integration
- **Financial Reporting & Analytics** (completed Jan 24)

### 🚧 In Progress
- [T-20]!!! Post-Refactor Cleanup & Verification

### 📋 Ready (Ordered by Priority)
**High Priority (!!!)**
- [T-18]!!! Frontend/Backend Separation
- [T-20]!!! Post-Refactor Cleanup & Verification
- [T-19]!!! Migrate Remaining Features to Backend API
- [T-01]!!! Two-Wallet System & Mixed Payment Support
- [T-09]!!! Monthly Analytics & Gross Profit Dashboard
- [T-10]!!! Real-time Drawer Balances
- [T-16]!!! SQLCipher DB Encryption
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
- [T-13]! Email Receipt Delivery
- [T-15]! Data Archival Workflow
- [P1-2]! Auto-Updater

---

## 🔧 T-Tasks: Technical Implementation

### [T-18] Frontend/Backend Separation !!! 
**Added**: Jan 24, 2026  
**Status**: In Progress  
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

**Phase 1: Migration Verification & Completion**
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
  - [x] Closing (`/api/closing`) ✅ Jan 24 - needs: createDailyClosing, getDailyStatsSnapshot, updateDailyClosing, getSystemExpectedBalances, setOpeningBalances
  - [x] Suppliers (`/api/suppliers`) ✅ Jan 24
  - [x] Activity Logs (`/api/activity`) ✅ Jan 24
  - [x] Rates (`/api/rates`) ✅ Jan 24
  - [x] Users (`/api/users`) ✅ Jan 24 (placeholder endpoints)
  - [x] Reports/Diagnostics (`/api/reports`, `/api/diagnostics`) ✅ Jan 24 (placeholder endpoints for Electron-only features)
- [x] Update frontend components to use backend API (completed for: recharge, services, maintenance, currencies)
- [ ] Complete remaining window.api migrations (~24 files, ~86 occurrences remaining)
- [ ] Verify WebSocket real-time updates work
- [ ] Test all features end-to-end in browser mode

**Browser vs Electron Mode Testing Status (Jan 24)**:
- ✅ **Working in Browser Mode**: Auth, Settings, Dashboard, Clients, Inventory, Sales, Debts, Exchange, Expenses, Recharge, Services, Maintenance, Currencies (list)
- ⏳ **Partial/Electron Only**: Closing, Opening, Advanced Settings (rates, users, suppliers, diagnostics, reports, activity, updates)
- 📝 **Recommendation**: Continue development in Electron mode where all features work, complete API migration incrementally

**Phase 2: Cleanup Plan**
Folders to DELETE (old Electron structure):
- `src/` - Old monolithic frontend code (592KB) → Replaced by `frontend/src/`
- `electron/` - Old Electron main process (796KB) → Replaced by `backend/`
- `dist/` - Old build output (848KB)
- `dist-electron/` - Old Electron build (460KB)
- `build/` - Old builder resources (1.4MB)
- `public/` - Old static assets (4KB) → Replaced by `frontend/public/`
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

### [T-16] SQLCipher DB Encryption !!!
**Status**: Ready  
**Goal**: Secure the local database file using SQLCipher encryption.

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
