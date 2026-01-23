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
- [T-08]!!! IMEI & Warranty Tracking
- [T-02]!!! Supplier Ledger Drawer Integration
- **Financial Reporting & Analytics** (completed Jan 24)

### 🚧 In Progress
- None currently

### 📋 Ready (Ordered by Priority)
**High Priority (!!!)**
- [T-18]!!! Frontend/Backend Separation
- [T-01]!!! Two-Wallet System & Mixed Payment Support
- [T-09]!!! Monthly Analytics & Gross Profit Dashboard
- [T-10]!!! Real-time Drawer Balances
- [T-16]!!! SQLCipher DB Encryption
- [P0-1]!!! Installer QA
- [P0-2]!!! Build Verification
- [P0-3]!!! Code Signing

**Medium Priority (!!)**
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
**Status**: Ready  
**Goal**: Refactor monolithic Electron app into standalone backend (Node.js REST/WebSocket server) and frontend (modern web app). Restructure `src/` folder (details TBD).

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
