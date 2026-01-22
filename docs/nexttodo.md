# Next TODO / Roadmap (Aligned with Current Repo)

**Purpose:** This file is the practical “what’s next” tracker for the project.

- Canonical sprint tracker: `docs/CURRENT_SPRINT.md`
- Full project reference: `docs/PROJECT.md`

---

## Current State (What’s Already Implemented)

Based on the current repository (v1.0.0), these areas are already implemented end-to-end:

- Authentication + role-based access
- Inventory (products, barcode lookup, stock)
- POS (cart, checkout, multi-currency payment, draft sales)
- Clients (profiles + history)
- Debts (ledger + repayments)
- Dashboard (stats + activity)
- Currency exchange + rate management
- OMT/Whish services tracking
- Mobile recharge (Alfa/MTC)
- Maintenance/repairs workflow
- Opening/Closing wizards (multi-drawer + multi-currency)
- Settings (users, currencies, diagnostics, notifications)

If you’re looking for the original “PDR style” description of modules, it has mostly been realized in code already; this file now focuses on **remaining work and future releases**.

---

## Sprint Status

The current sprint work is marked **On Hold** in `docs/CURRENT_SPRINT.md`.

---

## Remaining Work (Prioritized)

### CRITICAL / Release Quality Gate

1. **Installer QA on real systems**
   - Test built installers on Windows and macOS.
   - Reference: `docs/development/TEST_RESULTS.md` (Pending production installer tests).

2. **Code signing** (deferred to v1.1+ in `docs/CURRENT_SPRINT.md`)
   - macOS notarization signing
   - Windows signing (reduce SmartScreen warnings)

### HIGH Priority

1. **Increase automated test coverage toward ~70%**
   - Maintain the current “tests green” standard (currently 413 tests passing in CI).

2. **Auto-updater implementation**
   - Current state is “scaffold only / scaffold done” per `docs/PROJECT.md`.

3. **User documentation / help system**
   - Add a user-facing manual (in-app or bundled docs).

4. **Build verification on clean machines**
   - Ensure first-run behavior is smooth across platforms.

### MEDIUM Priority

1. **Closing enhancements (remaining polish)**
   - Variance UX fine-tuning, multi-currency rounding consistency, optional printable summaries.

2. **Database performance hardening (remaining)**
   - Consider foreign key enforcement strategy (`PRAGMA foreign_keys = ON`) and verify implications.

---

## Recently Completed (P2)

- [x] Closing report auto-attach (PDF generated and saved; `report_path` persisted on daily closing)
- [x] Variance threshold alert banner in Closing + Settings field `closing_variance_threshold_pct`
- [x] Database indexes + idempotent SQL migration runner
- [x] Local backups: schedule + retention pruning + list/verify/restore UI (Diagnostics)

### LOW Priority / Future

- Cloud sync continuation (optional / future)
- Multi-location support
- DRM/licensing (optional)

---

## Feature Requests Mentioned Historically (Reality Check)

Some items appear in older planning notes (or the previous `nexttodo.md` blob) but need re-scoping because the repo has evolved:

- **Supplier debt tracking:** current app has client debts; supplier debt is not a first-class module.
  - If we want it: define “Supplier” entity + payable ledger + reports.

- **Loto management:** not present as a first-class feature module in the current repo.
  - If we want it: define data model (tickets/rows/cycles), UI, and reporting rules.

- **Smart barcode duplicate handling ("DUP")**: inventory exists; barcode duplication rules may not be formalized as described.
  - If we want it: specify behavior and implement at the inventory create/update layer + UI prompts.

If you confirm any of these are still required, they should be promoted into the roadmap with concrete acceptance criteria.

---

## Technical Specs (Appended from `docs/CURRENT_SPRINT.md`)

These items were appended to the end of `docs/CURRENT_SPRINT.md` as detailed technical specifications. They are captured here as actionable roadmap entries.

- [ ] **[T-01] Multi-Drawer + Multi-Payment Lines (CASH/WHISH/OMT/BINANCE) — USD/LBP**
  - Context: a single sale can be paid using multiple payment lines, each with a **method** and a **currency**.
  - Methods: `CASH`, `WHISH`, `OMT`, `BINANCE`
  - Drawer mapping:
    - `CASH` → General drawer (cash USD/LBP)
    - `OMT` → OMT drawer
    - `WHISH` → Whish drawer
    - `BINANCE` → Binance drawer
  - DB: introduce a payments table (multi-row payments per `sale_id`) with `method` + `currency_code`.
  - UI: Checkout modal supports multiple payment lines (Method + Currency + Amount).
  - Closing: Expected drawer amounts are updated behind the scenes via `drawer_balances` and should change immediately after each sale/service; users enter actuals only when variance exists.
  - Services (OMT/Whish): financial service SEND/RECEIVE transactions also write to `payments` and update `drawer_balances`.
  - Recharges (MTC/Alfa): Paid By increases the selected method drawer by full price; MTC/Alfa expected balance decreases by the recharge `amount` (telecom stock checked on the shop phone).
  - Success: drawer reports show accurate totals per (drawer, currency), including mixed-method and mixed-currency sales.

- [ ] **[T-02] Supplier Ledger (Dual-Currency Debt)**
  - Context: track debt owed to suppliers (e.g., IPIC, Katsh) separately in USD and LBP.
  - DB: add `suppliers` and `supplier_ledger` tables; ledger has `amount_usd` and `amount_lbp`.
  - Logic:
    - Top-up: increase debt in specified currency.
    - Payment: decrease debt and subtract from corresponding currency in the main drawer.
  - UI: supplier ledger view with two balances: “Total Debt USD” and “Total Debt LBP”.
  - Success: user can see supplier balances per currency independently.

- [ ] **[T-03] Smart Barcode Duplicate & Autogen Handler**
  - Context: standardize item tracking when barcodes overlap or are missing.
  - Logic: in ProductService, check for an existing barcode on save.
  - UI: if duplicate found, show modal with “Duplicate Barcode” action.
  - String rules: append `DUP1` to the barcode; if `DUP1` exists, increment (`DUP2`, …).
  - Autogen: if barcode is blank, generate a unique numeric 8-digit code.
  - Success: avoid unique-constraint crashes; allow quick differentiation of overlapping manufacturer barcodes.

- [ ] **[T-04] Telecom Profit Engine (MTC/Alfa Special Logic)**
  - Context: recharges for MTC/Alfa have a specific $0.16 fee and bundle logic.
  - Constraint: $0.16 fee applies only to MTC/Alfa recharges.
  - Logic: Profit = (Final_Price - Cost_Price) - 0.16.
  - Bundles: implement lookup for “Returned Dollars” values used to compute actual cost/profit.
  - Success: profit reports reflect the $0.16 deduction and bundle math automatically.

- [ ] **[T-05] Loto Module (Real-time Profit Tracking)**
  - Context: Loto tickets sold in rows (max 8) with optional Zeed fee.
  - UI: entry form: Barcode, 1–8 row selector (100k LBP/row), Zeed toggle (+20k LBP).
  - Logic: calculate 4.45% profit on total sale amount at entry.
  - Accounting: save profit immediately to DailyProfit log and add total cash to the LBP drawer.
  - Success: every Loto sale updates profit instantly by 4.45%.

- [ ] **[T-06] Binance Service Module**
  - Context: manual record-keeping for Binance transfers and fees.
  - UI: Transfer/Send/Receive screens; mandatory “Manual Reference/Transaction ID”.
  - Fees: add “SRT/Manual Fees” field to deduct from transaction or add to cost.
  - Constraint: no $0.16 fee here (mobile only).
  - Success: Binance transactions logged with reference numbers for manual audit.

- [ ] **[T-07] Admin-Only Security “Late Entry”**
  - Context: correcting ledger errors found on camera footage.
  - Constraint: admin-only.
  - UI: “Custom Timestamp” toggle on transaction forms.
  - Logic: when used, save with `provided_timestamp` instead of `now()`.
  - Audit: create activity_log entry tagged `LATE ENTRY` with Admin name.
  - Success: admins can fix past drawer errors with a clear audit trail.

---

## Proposed Release Buckets

### v1.0.x (Stabilization)

- [ ] Production installer tests (Windows + macOS)
- [ ] Fix any installer-only issues discovered

### v1.1.0

- [ ] Code signing (macOS + Windows)
- [ ] Auto-updater
- [ ] User documentation/help
- [ ] Test coverage improvements

### v1.2.0

- [ ] Hardware integrations (barcode scanner workflows)
- [ ] Receipt printer support
- [ ] Email receipt delivery
- [ ] Advanced analytics & reports

### v2.x (Optional Future)

- [ ] Cloud backup/sync
- [ ] Multi-shop / multi-location
- [ ] Mobile companion app
- [ ] Web admin dashboard
