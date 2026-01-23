# Current Sprint (Jan 23–Jan 30, 2026)

Note: This is the canonical source of truth for all active tasks. Details for each task can be found in the Backlog section at the end.

### 📖 How to Read This Document

- **Kanban Board**: A high-level overview of task IDs and their status.
- **Backlog**: See the **Task Details** section below for full goals, owners, and specs for each ID.
- **Priority Scale**:
  - `!!!` **High**: Critical path, core business logic, or release blockers.
  - `!!`  **Medium**: Operational enhancements and important features.
  - `!`   **Low**: Optional modules or future improvements.

## 🏗️ Sprint Board

- **Ready**: [T-01]!!!, [T-03]!!, [T-04]!!, [T-05]!, [T-06]!, [T-07]!!, [T-09]!!!, [T-10]!!!, [T-11]!!, [T-12]!!, [T-13]!, [T-14]!!, [T-15]!, [T-16]!!!, [T-17]!!
- **In Progress**: [T-02]!!!, [T-08]!!!
- **On Hold**: [P0-1]!!!, [P0-2]!!!, [P0-3]!!!, [P1-1]!!, [P1-2]!, [P1-3]!!
- **Ready for Testing**:
- **Ready for Prod**: [P2-1], [P2-2], [P2-3], [P2-4]

---

## 🗒️ Task Details (Backlog)

### P0 — Release Quality / Distribution
- **[P0-1] Installer QA** !!!
  - Details: Installer QA on real systems (Windows installer + macOS .app/.dmg)
- **[P0-2] Build Verification** !!!
  - Details: Verification on clean machines (first-run, single-instance behavior, permissions)
- **[P0-3] Code Signing** !!!
  - Details: Setup for macOS notarization and Windows signing.

### P1 — Shipping Improvements
- **[P1-1] Automated Testing** !!
  - Details: Increase coverage toward ~70% (keep CI green).
- **[P1-2] Auto-Updater** !
  - Details: Implementation beyond the current scaffold.
- **[P1-3] User Documentation** !!
  - Details: Help system for install/admin and general user guide.

### P2 — Operational Enhancements (Completed)
- **[P2-1] Closing Report Auto-Attach**: Automatically link generated PDFs to closing records.
- **[P2-2] Variance Threshold Alerts**: Visual warnings when cash discrepancies exceed set % in Closing.
- **[P2-3] Performance Hardening**: Added database indexes and optimized query patterns.
- **[P2-4] Backup Automation**: Automated local DB backups with restore verification.

### Technical Specifications (T-Tasks)

- **[T-01] Two-Wallet System & Mixed Payment Support** !!!
  - Goal: Support `CASH`, `WHISH`, `OMT`, `BINANCE` payment methods.
- **[T-02] Supplier Ledger (Dual-Currency Debt)** !!!
  - Owner: @Antigravity (In Progress)
  - Goal: Add "Pay Supplier" workflow that optionally updates cash drawers.
- **[T-03] Smart Barcode Duplicate Handler** !!
  - Goal: Handle duplicate barcodes (DUP1, DUP2) and autogen logic.
- **[T-04] Telecom Profit Engine (MTC/Alfa Special Logic)** !!
  - Goal: Specific accounting for recharge fees ($0.16) and bundle logic.
- **[T-05] Loto Module** !
  - Goal: Real-time profit tracking for lottery services.
- **[T-06] Binance Service Module** !
  - Goal: Integration for Binance-based payments and transfers.
- **[T-07] Admin-Only Security “Late Entry”** !!
  - Goal: Allow admins to record transactions for past dates securely.
- **[T-08] IMEI & Warranty Tracking** !!!
  - Owner: @Antigravity (In Progress)
  - Goal: Prompt for IMEI during sales of phones; link to sale_items for warranty receipts.
- **[T-09] Monthly Analytics & Gross Profit Dashboard** !!!
  - Goal: Aggregate daily closings into monthly P&L view; calculate true Gross Profit.

#### Tasks Extracted from Documentation Analysis (Jan 23)
- **[T-10] Real-time Drawer Balances** !!!
  - Goal: Live running totals for all drawers in the Dashboard (currently missing).
- **[T-11] Hardware Barcode Scanner Integration** !!
  - Goal: Native support for physical scanners in POS and Inventory.
- **[T-12] Receipt Printer Support** !!
  - Goal: ESC/POS support for thermal receipt printers.
- **[T-13] Email Receipt Delivery** !
  - Goal: Functionality to send digital receipts to customers via email.
- **[T-14] Versioned Migration System** !!
  - Goal: Transition from `ensureColumnExists` to timestamp-based SQL migrations.
- **[T-15] Data Archival Workflow** !
  - Goal: Archive records older than 1 year to external file to maintain performance.
- **[T-16] SQLCipher DB Encryption** !!!
  - Goal: Secure the local `liratek.db` file using SQLCipher encryption.
- **[T-17] Admin Closing Approval** !!
  - Goal: Workflow where staff closings are flagged as 'Pending' until admin approval.

---

## 📈 Platform History & Done
- [x] Fix Jest Matchers TypeScript regression
- [x] Resolve `yarn build` CSS import errors
- [x] Analyze `dev` branch features and update documentation
- [x] Restore missing documentation from `archive/dev-legacy`
- [x] Consolidated fragmented docs into DEVELOPMENT.md (Pending final cleanup)
