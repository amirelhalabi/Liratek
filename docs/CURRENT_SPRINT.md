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

- **Ready**: [T-01]!!!, [T-03]!!, [T-04]!!, [T-05]!, [T-06]!, [T-07]!!, [T-09]!!!
- **In Progress**: [T-02]!!!, [T-08]!!!
- **On Hold**: [P0-1]!!!, [P0-2]!!!, [P0-3]!!!, [P1-1]!!, [P1-2]!, [P1-3]!!
- **Ready for Testing**:
- **Ready for Prod**: [P2-1], [P2-2], [P2-3], [P2-4]

---

## 🗒️ Task Details (Backlog)

### P0 — Release Quality / Distribution
- **[P0-1] Installer QA** !!!
  - Owner: @TBD
  - Details: Installer QA on real systems (Windows installer + macOS .app/.dmg)
- **[P0-2] Build Verification** !!!
  - Owner: @TBD
  - Details: Verification on clean machines (first-run, single-instance behavior, permissions)
- **[P0-3] Code Signing** !!!
  - Owner: @TBD
  - Details: Setup for macOS notarization and Windows signing.

### P1 — Shipping Improvements
- **[P1-1] Automated Testing** !!
  - Owner: @TBD
  - Details: Increase coverage toward ~70% (keep CI green).
- **[P1-2] Auto-Updater** !
  - Owner: @TBD
  - Details: Implementation beyond the current scaffold.
- **[P1-3] User Documentation** !!
  - Owner: @TBD
  - Details: Help system for install/admin and general user guide.

### P2 — Operational Enhancements (Completed)
- **[P2-1] Closing Report Auto-Attach**: Automatically link generated PDFs to closing records.
- **[P2-2] Variance Threshold Alerts**: Visual warnings when cash discrepancies exceed set % in Closing.
- **[P2-3] Performance Hardening**: Added database indexes and optimized query patterns.
- **[P2-4] Backup Automation**: Automated local DB backups with restore verification.

### Technical Specifications (T-Tasks)

- **[T-01] Two-Wallet System & Mixed Payment Support** !!!
  - Goal: Support `CASH`, `WHISH`, `OMT`, `BINANCE` payment methods.
  - Details: Map each method to a drawer; all cash affects General drawer. Telecom recharges decrease MTC/Alfa balance but increase payment drawer by full price.
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

---

## 📈 Platform History & Done
- [x] Fix Jest Matchers TypeScript regression
- [x] Resolve `yarn build` CSS import errors
- [x] Analyze `dev` branch features and update documentation
- [x] Unified activity logs to `details_json`
- [x] Phase 2: Error handling pass across all services
- [x] Typed POS checkout handlers and drafts