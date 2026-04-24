# LiraTek POS — Urgent Sprint Backlog

> **Sprint Goal:** Fix all critical blockers and deliver high-priority features  
> **Created:** 2026-04-23  
> **Last Updated:** 2026-04-24 (Session 4)  
> **Status Legend:** `TODO` | `IN PROGRESS` | `IN REVIEW` | `DONE` | `BLOCKED` | `TBD`

---

## Epic 2: Unified Checkpoint System (formerly Opening/Closing)

> Merge Opening and Closing into a single "Checkpoint" that can be done at any time. Fix the dashboard reset bug. Add variance alerting. This is a major architectural change to the daily operations flow.

---

### LIRA-004: Merge Opening/Closing into Single Checkpoint Concept

| Field                | Value                                   |
| -------------------- | --------------------------------------- |
| **Epic**             | Unified Checkpoint System               |
| **Type**             | Feature / Refactor                      |
| **Priority**         | High                                    |
| **Status**           | TODO                                    |
| **Affected Modules** | Closing, Dashboard, Checkpoint Timeline |
| **Assigned To**      | —                                       |

**Description:**  
Currently the app has separate "Opening" (start of day) and "Closing" (end of day) flows. This needs to be merged into a single "Checkpoint" action that:

- Can be performed at any time of day, any number of times
- Records physical counts vs system-expected per drawer/currency
- The amounts from one checkpoint automatically become the baseline for the next
- No more "Start Day" or "End Day" concepts

**Acceptance Criteria:**

- [ ] All UI text changed from "Opening"/"Closing" to "Checkpoint"
- [ ] Single "New Checkpoint" button replaces separate start/end day flows
- [ ] Checkpoint can be created at any time, multiple times per day
- [ ] Each checkpoint records expected vs actual per drawer and currency
- [ ] Previous checkpoint's actual values = next checkpoint's starting baseline
- [ ] `CheckpointTimeline` page reflects the unified model
- [ ] No data loss for existing opening/closing records (backward compatible)

**Sub-Tasks:**

1. **LIRA-004a:** Rename all "Opening"/"Closing" UI labels to "Checkpoint" across all components
2. **LIRA-004b:** Refactor `ClosingService` — remove open/close distinction, support anytime checkpoint
3. **LIRA-004c:** Refactor `ClosingRepository` — update queries to treat all records as checkpoints
4. **LIRA-004d:** Update `Opening/index.tsx` and `Closing.tsx` — merge into single `Checkpoint.tsx` component
5. **LIRA-004e:** Update `CheckpointTimeline/index.tsx` to display unified checkpoint entries
6. **LIRA-004f:** Update IPC handlers and preload bindings for new checkpoint API
7. **LIRA-004g:** Migration: add any needed columns (e.g., `checkpoint_type` or remove `type` constraint)

**Technical Notes:**

- Current tables: `daily_closings`, `daily_closing_amounts`
- Consider renaming tables or adding a view (non-breaking migration)
- `ClosingService.getSystemExpected()` is the key method — must work for mid-day checkpoints
- Drawer list: General, OMT_System, OMT_App, Whish_App, Binance, MTC, Alfa, iPick, Katsh, Whish_System, Loto

**Files to Modify:**

- `frontend/src/features/closing/` (all files)
- `packages/core/src/services/ClosingService.ts`
- `packages/core/src/repositories/ClosingRepository.ts`
- `electron-app/handlers/` (closing handlers)
- `electron-app/preload.ts`
- `frontend/src/types/electron.d.ts`

---

### LIRA-005: Fix Dashboard Values Resetting on Checkpoint

| Field               | Value                     |
| ------------------- | ------------------------- |
| **Epic**            | Unified Checkpoint System |
| **Type**            | Bug                       |
| **Priority**        | High                      |
| **Status**          | TODO                      |
| **Affected Module** | Dashboard (`/`)           |
| **Assigned To**     | —                         |

**Description:**  
When the user clicks "Start Day" (now "New Checkpoint"), the dashboard values (daily sales, profit, transaction counts) reset to zero. This is incorrect — dashboard values should be based on the current calendar day's transactions, completely independent of checkpoint events.

**Acceptance Criteria:**

- [ ] Creating a checkpoint does NOT reset dashboard counters
- [ ] Dashboard values reflect all transactions from the current calendar day (midnight to now)
- [ ] Dashboard values persist correctly across multiple checkpoints in the same day
- [ ] After app restart, dashboard still shows correct daily totals

**Technical Notes:**

- Check `Dashboard.tsx` — does it subscribe to a "day started" event that resets state?
- Check the dashboard data queries — are they filtering by closing period instead of calendar day?
- The fix likely involves changing the query to use `DATE(created_at) = DATE('now')` instead of referencing the last opening record

**Files to Investigate:**

- `frontend/src/features/dashboard/components/Dashboard.tsx`
- `electron-app/handlers/` (dashboard or reporting handlers)
- `packages/core/src/services/ReportingService.ts` or `FinancialService.ts`

---

### LIRA-006: Checkpoint Variance Alert Icons

| Field               | Value                                 |
| ------------------- | ------------------------------------- |
| **Epic**            | Unified Checkpoint System             |
| **Type**            | Feature                               |
| **Priority**        | Medium                                |
| **Status**          | TODO                                  |
| **Affected Module** | Checkpoint Timeline, Checkpoint Modal |
| **Assigned To**     | —                                     |

**Description:**  
When a checkpoint has a discrepancy (actual ≠ expected), display a visual alert icon (e.g., warning triangle) on that checkpoint entry. This helps the user quickly identify which checkpoint had a variance and by how much.

Additionally, customer credit deposits (reverse debts — see LIRA-020) must be excluded from being flagged as "extra" money. For example, if a customer leaves $40 at the shop as credit, that $40 should not trigger a variance alert because the system knows it belongs to client X.

**Acceptance Criteria:**

- [ ] Alert icon displayed on checkpoint entries where actual ≠ expected for any drawer/currency
- [ ] Icon shows on the `CheckpointTimeline` list view
- [ ] Clicking the icon shows a breakdown of which drawers have variance
- [ ] Customer credit deposits are subtracted from "extra" before determining if alert is needed
- [ ] Tooltip or detail shows the variance amount

**Dependencies:**

- LIRA-004 (Checkpoint system refactor)
- LIRA-020 (Reverse Debt / Customer Credit — for exclusion logic)

**Files to Modify:**

- `frontend/src/features/closing/components/CheckpointTimeline/index.tsx`
- `frontend/src/features/closing/components/VarianceCard.tsx`
- `packages/core/src/services/ClosingService.ts`

---

### LIRA-007: Checkpoint Currencies Section (TBD)

| Field               | Value                     |
| ------------------- | ------------------------- |
| **Epic**            | Unified Checkpoint System |
| **Type**            | Feature                   |
| **Priority**        | Low                       |
| **Status**          | TBD                       |
| **Affected Module** | Checkpoint Modal          |
| **Assigned To**     | —                         |

**Description:**  
Add a currencies summary section in the checkpoint view showing total amounts per currency across all drawers. The exact design and data source (currency_drawers vs currency_modules) needs further discussion.

**Acceptance Criteria:**

- [ ] TBD — requires design discussion
- [ ] Display total per active currency across relevant drawers

**Notes:**

- Blocked until design is agreed upon
- Consider: should this show drawer-level breakdown or just totals?

---

### LIRA-008: Checkpoint Stress Test & Acceptance Validation

| Field           | Value                        |
| --------------- | ---------------------------- |
| **Epic**        | Unified Checkpoint System    |
| **Type**        | QA / Testing                 |
| **Priority**    | High                         |
| **Status**      | TODO                         |
| **Depends On**  | LIRA-004, LIRA-005, LIRA-006 |
| **Assigned To** | —                            |

**Description:**  
End-to-end acceptance test that replicates the real shop flow:

**Test Scenario:**

1. Start fresh — no checkpoints exist
2. Create transactions across multiple modules (POS sale, exchange, OMT send, MTC recharge, expense)
3. Do Checkpoint #1 — verify expected amounts match the sum of transactions
4. Enter actual amounts (some matching, some with variance)
5. Save checkpoint — verify it records correctly
6. Create more transactions
7. Do Checkpoint #2 — verify baseline = Checkpoint #1 actuals, and expected = baseline + new transactions
8. Verify dashboard values are NOT affected by either checkpoint
9. Verify variance alert icons appear where actual ≠ expected
10. Verify `CheckpointTimeline` shows both checkpoints correctly

**Acceptance Criteria:**

- [ ] Full flow above passes without errors
- [ ] Expected amounts are mathematically correct across all drawers
- [ ] Dashboard unaffected
- [ ] Timeline displays correctly
- [ ] Variance alerts work
- [ ] Multi-currency amounts correct (USD, LBP, EUR if active)

---

## Epic 3: Transaction Editing

> Allow non-admin users to edit any transaction type. Track who edited and when.

---

### LIRA-009: Make All Transaction Types Editable

| Field                | Value                   |
| -------------------- | ----------------------- |
| **Epic**             | Transaction Editing     |
| **Type**             | Feature                 |
| **Priority**         | High                    |
| **Status**           | TODO                    |
| **Affected Modules** | All transaction modules |
| **Assigned To**      | —                       |

**Description:**  
Currently transactions are either immutable or only admin-editable. All transaction types must be editable by any user (admin and staff). All fields should be editable.

**Transaction Types to Support:**

- Sales (POS)
- Exchange
- OMT / Whish system services
- OMT App / Whish App transfers
- MTC / Alfa recharges
- iPick / Katsh vouchers
- Binance
- Custom Services
- Maintenance
- Expenses
- Loto tickets
- Debt repayments

**Acceptance Criteria:**

- [ ] Edit button available on all transaction types in their respective history/detail views
- [ ] Staff users (not just admin) can edit
- [ ] All fields are editable: amounts, payment method, currency, client, notes, date, service-specific fields
- [ ] Editing recalculates drawer balances (reverse old amounts, apply new amounts)
- [ ] Editing recalculates profit if cost/price changed
- [ ] Unified transaction journal (`transactions` table) is updated to reflect edits
- [ ] Edit button opens a pre-filled form identical to the creation form

**Sub-Tasks:**

1. **LIRA-009a:** Backend — Add `update()` methods to all repositories that lack them
2. **LIRA-009b:** Backend — Add `editTransaction()` methods to all services with drawer balance recalculation
3. **LIRA-009c:** IPC — Add `*:update` handlers for each module, allowing staff role
4. **LIRA-009d:** Frontend — Add edit button + pre-filled edit forms for each module's history view
5. **LIRA-009e:** Preload — Add `update` bindings for each module API namespace

**Technical Notes:**

- Drawer balance recalculation: reverse the original transaction's drawer impact, then apply the new values
- Must handle payment method changes (e.g., changing from CASH to DEBT creates a debt entry)
- Must handle currency changes
- Consider using a database transaction (BEGIN/COMMIT) for atomicity

**Files to Modify:**

- All repositories in `packages/core/src/repositories/`
- All services in `packages/core/src/services/`
- All handlers in `electron-app/handlers/`
- `electron-app/preload.ts`
- `frontend/src/types/electron.d.ts`
- All history/detail modals in `frontend/src/features/`

---

### LIRA-010: Track and Display Edit Metadata

| Field           | Value               |
| --------------- | ------------------- |
| **Epic**        | Transaction Editing |
| **Type**        | Feature             |
| **Priority**    | High                |
| **Status**      | TODO                |
| **Depends On**  | LIRA-009            |
| **Assigned To** | —                   |

**Description:**  
Every edit must record who made the change and when. This metadata must be visible in the UI.

**Acceptance Criteria:**

- [ ] `edited_by` (username) and `edited_at` (timestamp) columns added to all transaction tables
- [ ] On edit, these fields are populated automatically from the session
- [ ] All history/detail views show "Edited by [username] at [time]" badge on edited transactions
- [ ] Audit log entry created for every edit with before/after field values
- [ ] Badge is visually distinct (e.g., yellow/orange indicator)

**Technical Notes:**

- Migration needed to add `edited_by TEXT` and `edited_at TEXT` to: `sales`, `exchange_transactions`, `financial_services`, `recharges`, `custom_services`, `maintenance`, `expenses`, `loto_tickets`, `debt_ledger`
- Audit log: use existing `AuditService.log()` with action type `EDIT` and payload containing old + new values
- Update `create_db.sql` with new columns

**Files to Modify:**

- `packages/core/src/db/migrations/index.ts` (new migration)
- `electron-app/create_db.sql`
- All repositories (add edited_by/edited_at to UPDATE queries)
- All frontend history/detail components (display badge)

---

## Epic 4: Transaction Timestamp Override

> Allow users to enter a transaction at a specific past time if they missed recording it.

---

### LIRA-011: Optional Time Field on All Transaction Forms

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Transaction Timestamp Override |
| **Type**             | Feature                        |
| **Priority**         | Medium                         |
| **Status**           | TODO                           |
| **Affected Modules** | All transaction forms          |
| **Assigned To**      | —                              |

**Description:**  
Add an optional datetime picker to all transaction creation forms. If the user missed recording a transaction at 10:00 AM, they can enter it later and set the time to 10:00 AM. If not specified, defaults to current time.

**Acceptance Criteria:**

- [ ] Optional datetime picker available on all transaction forms
- [ ] Defaults to current date/time if not used
- [ ] Selected time is used as the transaction's `created_at`
- [ ] Time cannot be set in the future (validation)
- [ ] Time cannot be set before the last checkpoint (validation — prevents backdating past a reconciled period)
- [ ] Transaction appears in correct chronological position in history views
- [ ] Dashboard and checkpoint calculations use the overridden time correctly

**Technical Notes:**

- Add `transaction_time?: string` parameter to all create methods in services
- Use `COALESCE(?, CURRENT_TIMESTAMP)` in SQL INSERT statements
- Frontend: use a time picker component (consider `input type="datetime-local"`)
- Collapsed by default, expandable via "Set custom time" link to keep forms clean

**Files to Modify:**

- All service `create()` methods
- All repository `create()` methods
- All IPC handlers (accept optional `transaction_time`)
- All frontend transaction forms (add datetime picker)

---

## Epic 5: Customer Sessions Overhaul

> Shared sessions across network, improved lifecycle UI, and walk-in checkout flow.

---

### LIRA-012: Shared Database File Across Network

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| **Epic**             | Customer Sessions Overhaul                 |
| **Type**             | Feature                                    |
| **Priority**         | High                                       |
| **Status**           | TODO                                       |
| **Affected Modules** | Settings, Database Connection, All Modules |
| **Assigned To**      | —                                          |

**Description:**  
Allow multiple PCs on the same LAN to share a single SQLite database file over the network. This enables customer sessions (and all data) to be visible across all devices.

**Acceptance Criteria:**

- [ ] Settings page has a "Database Path" field where user can set a network path (e.g., `\\server\share\liratek.db`)
- [ ] App connects to the shared DB file on startup
- [ ] WAL journal mode enabled for concurrent read access
- [ ] Busy timeout configured (e.g., 5000ms) for write contention
- [ ] Retry logic for `SQLITE_BUSY` errors
- [ ] Multiple app instances can read simultaneously
- [ ] Write operations are serialized via SQLite's locking
- [ ] Graceful error handling if network path is unavailable
- [ ] Fallback to local DB if network DB is unreachable

**Technical Notes:**

- SQLite over network share has known limitations — WAL mode helps but doesn't fully solve concurrent writes
- Consider using `PRAGMA busy_timeout = 5000`
- Consider `PRAGMA journal_mode = WAL`
- The setup wizard already has a `StepDetect.tsx` and `StepJoinShop.tsx` — may already support this partially
- SQLCipher adds complexity — encrypted DB file must be accessible with same key on all devices

**Risks:**

- SQLite over network shares can corrupt on certain NAS/SMB implementations
- Performance may degrade with many concurrent writers
- Consider documenting supported network configurations

**Files to Modify:**

- `packages/core/src/db/connection.ts`
- `frontend/src/features/settings/components/ShopConfig.tsx`
- `electron-app/handlers/setupHandlers.ts`
- `electron-app/main.ts` (DB initialization)

---

### LIRA-013: Session Lifecycle UI (Close vs Delete)

| Field               | Value                      |
| ------------------- | -------------------------- |
| **Epic**            | Customer Sessions Overhaul |
| **Type**            | Feature                    |
| **Priority**        | Medium                     |
| **Status**          | TODO                       |
| **Affected Module** | Sessions (floating window) |
| **Assigned To**     | —                          |

**Description:**  
Improve the session list to distinguish between closing a session (customer left, but session remains visible) and deleting a session (permanently removed from list).

**Acceptance Criteria:**

- [ ] Closed sessions remain in the session list with a "closed" visual state (greyed out, strikethrough, etc.)
- [ ] "X" icon on each session to close it (end visit, keep in list)
- [ ] Trash can icon on each session to delete it (remove permanently)
- [ ] Delete requires confirmation dialog
- [ ] Active sessions have a distinct visual style vs closed ones
- [ ] Session list can be filtered: All / Active / Closed

**Files to Modify:**

- `frontend/src/features/sessions/components/SessionFloatingWindow.tsx`
- `frontend/src/features/sessions/components/SessionContext.tsx`
- `packages/core/src/services/CustomerSessionService.ts`
- `packages/core/src/repositories/CustomerSessionRepository.ts`

---

### LIRA-014: Walk-In Session with Batch Checkout

| Field               | Value                      |
| ------------------- | -------------------------- |
| **Epic**            | Customer Sessions Overhaul |
| **Type**            | Feature                    |
| **Priority**        | High                       |
| **Status**          | IN PROGRESS                |
| **Affected Module** | Sessions, POS Checkout     |
| **Assigned To**     | —                          |

**Description:**  
A "Walk-In" session is for anonymous customers who perform multiple transactions (recharge, exchange, buy a product, etc.) and pay for everything at the end in a single checkout.

**Flow:**

1. User clicks "New Walk-In Session"
2. Session is created without requiring customer name
3. User performs various transactions across modules — all linked to this session
4. User clicks "Checkout" on the session
5. A POS-style checkout modal appears showing:
   - List of all transactions in the session (with amounts)
   - If a POS sale was done, show the individual items within that sale
   - Grand total across all transactions
6. Multi-payment support (USD, LBP, split, debt)
7. After payment, session is marked as settled and closed

**Acceptance Criteria:**

- [ ] "New Walk-In" button in session UI (no customer name required)
- [ ] All transactions during walk-in are linked to the session
- [ ] "Checkout" button opens a checkout modal with transaction summary
- [ ] Modal shows line items: transaction type, description, amount for each
- [ ] POS transactions show individual items (product name, qty, price)
- [ ] Grand total is sum of all transaction amounts
- [ ] Multi-payment form (same as POS checkout: USD, LBP, split)
- [ ] Payment recorded, session marked settled/closed
- [ ] If customer wants to pay partially by debt, client must be selected/created

**Technical Notes:**

- Reuse the POS `CheckoutModal` pattern but adapt for multi-transaction summary
- Need a new service method: `CustomerSessionService.checkout(sessionId, paymentData)`
- The checkout needs to handle the fact that individual transactions may have already affected drawers — the checkout is a settlement, not a new set of drawer movements
- Consider: should individual transactions be recorded as "pending" until checkout? Or recorded immediately and checkout is just a confirmation?

**Design Decision Needed:**

- ~~Option A: Transactions are recorded immediately with payment_method=SESSION, and checkout settles the session balance~~
- ~~Option B: Transactions are deferred and only committed at checkout~~
- **Decision: Option B** — Transactions are stored in memory only (SessionContext state). Nothing hits the DB until successful checkout. At checkout, all transactions are created in a single batch.

**Design Decisions Made (Session 4):**

1. **Deferred transactions** — cart items stored in memory, DB writes only on checkout
2. **"Add to Cart" replaces "Submit"/"Proceed to Checkout"** when activeSession exists; normal Submit when no session
3. **Multi-payment at checkout** — single payment applies to entire cart total
4. **Partial payment → debt** — adapt debt history to show transaction+items (not just POS inventory items)
5. **Cart item amounts:** SEND = amount + fee (positive), RECEIVE = amount - fee (negative), Loto cash prize = negative
6. **Per-transaction drawer operations** — Side A (module drawer) happens per-transaction as normal; Side B (customer payment) is the checkout payment
7. **Exchange excluded** from initial implementation (see LIRA-040)
8. **Binance Receive** needs review (see LIRA-041)
9. **POS:** "Add to Cart" replaces "Proceed to Checkout" — adds entire POS order as one cart entry

**Files to Modify:**

- `frontend/src/features/sessions/components/` (new CheckoutModal)
- `frontend/src/features/sessions/components/SessionFloatingWindow.tsx`
- `packages/core/src/services/CustomerSessionService.ts`
- `packages/core/src/repositories/CustomerSessionRepository.ts`
- `electron-app/handlers/sessionHandlers.ts`

---

## Epic 8: MTC/Alfa Recharge Improvements

> Beyond the critical fix in LIRA-003, additional improvements needed.

---

### LIRA-022: Margin Alert in Recharge History

| Field               | Value                     |
| ------------------- | ------------------------- |
| **Epic**            | MTC/Alfa Improvements     |
| **Type**            | Feature                   |
| **Priority**        | Medium                    |
| **Status**          | TODO                      |
| **Affected Module** | Mobile Recharge > History |
| **Assigned To**     | —                         |

**Description:**  
Show a visual alert/badge on history entries where the price-to-client was manually changed from the auto-calculated default and the margin exceeds 100,000 LBP. This is a theft detection mechanism — exposes users who overcharge customers and pocket the difference.

**Acceptance Criteria:**

- [ ] History entries show an alert icon (e.g., red warning) when margin > 100,000 LBP
- [ ] Tooltip shows: "Price to client was modified — margin: X LBP"
- [ ] Alert only triggers when price was manually overridden (not when default price naturally exceeds threshold)
- [ ] Works for both MTC and Alfa

**Technical Notes:**

- Need to store `default_price_to_client` alongside `price_to_client` to detect manual changes
- Or calculate expected price at display time using the rate that was active at transaction creation

**Files to Modify:**

- `frontend/src/features/recharge/components/HistoryModal.tsx`
- `packages/core/src/repositories/RechargeRepository.ts` (store default price or rate snapshot)

---

## Epic 9: OMT/Whish System & Financial Services

---

### LIRA-025: Add LBP Support in OMT & Whish Transactions

| Field               | Value                                               |
| ------------------- | --------------------------------------------------- |
| **Epic**            | OMT/Whish Services                                  |
| **Type**            | Feature                                             |
| **Priority**        | Medium                                              |
| **Status**          | TODO                                                |
| **Affected Module** | Services (`/services`), Mobile Recharge > Whish App |
| **Assigned To**     | —                                                   |
| **Blocked By**      | OMT LBP fee structure (to be provided by user)      |

**Description:**  
Add LBP as a currency option for OMT and Whish service transactions.

**Fee Rules:**

- **OMT System:** LBP fees TBD (user will provide fee structure)
- **Whish System:** No fees for LBP, no fees for USD (no fees at all — see LIRA-023)
- **Whish App (under mobile recharge):** USD send/receive has fees. LBP send/receive has NO fees

**Acceptance Criteria:**

- [ ] LBP selectable as currency in OMT System transactions
- [ ] LBP selectable in Whish System transactions (no fees)
- [ ] LBP selectable in Whish App transactions (no fees for LBP)
- [ ] Fee calculations adjust based on currency selection
- [ ] Drawer balances updated in correct currency
- [ ] History shows currency correctly

---

## Epic 11: Drawer Top-Up

---

### LIRA-029: General Drawer Top-Up Feature

| Field               | Value                 |
| ------------------- | --------------------- |
| **Epic**            | Drawer Top-Up         |
| **Type**            | Feature               |
| **Priority**        | Medium                |
| **Status**          | TODO                  |
| **Affected Module** | Dashboard or Settings |
| **Assigned To**     | —                     |

**Description:**  
Allow the user to top up the General drawer with USD and/or LBP. This is for when the shop is low on USD cash and the owner brings in more. It is NOT an expense (no cost recorded) — it simply increases the drawer balance.

**Acceptance Criteria:**

- [ ] "Top Up Drawer" button accessible from dashboard or a dedicated spot
- [ ] Input fields for USD amount and LBP amount
- [ ] Submitting increases `drawer_balances` for General drawer
- [ ] Transaction recorded in journal as type `DRAWER_TOPUP`
- [ ] Top-ups reflected in checkpoint expected calculations
- [ ] Top-ups visible in a history/log
- [ ] Optional notes field

**Files to Modify:**

- New component or add to dashboard
- `packages/core/src/services/` (new or extend ClosingService)
- `packages/core/src/repositories/` (drawer balance update)
- New IPC handler

---

## Epic 12: Reverse Debt / Customer Credit _(Needs Discussion)_

---

### LIRA-030: Customer Credit System (Reverse Debt)

| Field                | Value                               |
| -------------------- | ----------------------------------- |
| **Epic**             | Reverse Debt                        |
| **Type**             | Feature                             |
| **Priority**         | High                                |
| **Status**           | TODO — Design Phase                 |
| **Affected Modules** | Debts, POS, All transaction screens |
| **Assigned To**      | —                                   |

**Description:**  
Support scenarios where the shop owes money to a customer (reverse debt / customer credit). This happens when:

- Customer overpays
- Customer leaves money at the shop intentionally (deposit)
- Customer returns an item for store credit

The customer can later spend their credit on purchases or services. These credit-spend transactions appear in the debt page.

**Core Behaviors:**

1. **Create credit:** Record that shop owes customer X amount (negative debt entry)
2. **Spend credit:** When customer buys something, option to "Pay with Credit" which deducts from their balance
3. **View balance:** Debt page shows both debts (customer owes shop) and credits (shop owes customer)
4. **Checkpoint integration:** Customer credit deposits should not be flagged as "extra money" in checkpoints (LIRA-006)

**Acceptance Criteria:**

- [ ] Negative debt entries supported in `debt_ledger`
- [ ] "Add Customer Credit" action available (from POS refund, manual entry, etc.)
- [ ] "Pay with Credit" option in payment methods when customer has positive credit balance
- [ ] Debt page shows net balance per client (positive = they owe, negative = we owe)
- [ ] Credit transactions appear in debt history with clear labeling
- [ ] Checkpoint system excludes customer credit from variance alerts

**Design Decisions Needed:**

- How to handle partial credit usage (e.g., credit balance $40, purchase $25 → remaining $15)
- Should credit expire?
- Should there be admin approval for creating credits?
- Visual distinction between debt and credit entries in the UI

**Files to Modify:**

- `packages/core/src/services/DebtService.ts`
- `packages/core/src/repositories/DebtRepository.ts`
- `frontend/src/features/debts/`
- All payment forms (add credit option)
- `packages/core/src/services/ClosingService.ts` (checkpoint exclusion)

---

## Epic 13: Maintenance Page Improvements

---

### LIRA-031: Active Jobs List & Standby Workflow

| Field               | Value                        |
| ------------------- | ---------------------------- |
| **Epic**            | Maintenance Improvements     |
| **Type**            | Feature                      |
| **Priority**        | High                         |
| **Status**          | TODO                         |
| **Affected Module** | Maintenance (`/maintenance`) |
| **Assigned To**     | —                            |

**Description:**  
Add a prominent "Active Jobs" section at the top of the maintenance page showing all jobs in Received or In Progress status. Users can open a job, save it on standby, and later come back to check out (collect payment) when the work is done.

Also fix: the description field crashes or loses focus when typing.

**Acceptance Criteria:**

- [ ] "Active Jobs" section at top of maintenance page
- [ ] Shows all jobs with status: Received, In Progress
- [ ] Each job card shows: device, client, status, date received, description snippet
- [ ] "Checkout" button on each active job opens payment collection modal
- [ ] Job status transitions: Received → In Progress → Completed (at checkout)
- [ ] Description field does NOT lose focus or crash when typing
- [ ] Completed jobs move to history section below

**Bug Fix — Description Field:**

- Investigate if this is the same Electron focus bug as LIRA-035
- Or if it's a re-render issue causing the input to unmount/remount
- Check for uncontrolled → controlled input switching
- Check if state updates trigger full component re-renders

**Files to Modify:**

- `frontend/src/features/maintenance/components/Maintenance/index.tsx`
- `packages/core/src/services/MaintenanceService.ts`

---

## Epic 14: Custom Services & Item Selector

---

### LIRA-032: Inventory Search Bar in Custom Services

| Field               | Value                                |
| ------------------- | ------------------------------------ |
| **Epic**            | Custom Services                      |
| **Type**            | Feature                              |
| **Priority**        | Medium                               |
| **Status**          | TODO                                 |
| **Affected Module** | Custom Services (`/custom-services`) |
| **Assigned To**     | —                                    |

**Description:**  
Replace the description text field with a search bar that queries the inventory. If a matching product is found, user selects it and cost/price auto-fill from the product record. If nothing matches, the search bar becomes a free-text description input.

**Acceptance Criteria:**

- [ ] Search bar replaces description field
- [ ] Typing searches products by name, barcode, or category
- [ ] Dropdown shows matching products
- [ ] Selecting a product auto-fills: name (as description), cost, and selling price
- [ ] If no results found, user can type freely as a description
- [ ] Clear button to reset selection and switch back to search mode
- [ ] Works with existing custom service creation flow

**Files to Modify:**

- `frontend/src/features/custom-services/components/CustomServices/index.tsx`

---

### LIRA-033: Netflix / Account Selling in Services

| Field               | Value           |
| ------------------- | --------------- |
| **Epic**            | Custom Services |
| **Type**            | Feature         |
| **Priority**        | Low             |
| **Status**          | TODO            |
| **Affected Module** | Custom Services |
| **Assigned To**     | —               |

**Description:**  
Ensure custom services can handle selling digital accounts (Netflix, Spotify, etc.) as a transaction. This is a straightforward service sale — no inventory tracking of how many accounts are available. The shop records the selling transaction with cost and price.

When accounts are sourced from "Samer" (external entity), the "As Samer" button should be available to flag the transaction for settlement.

**Acceptance Criteria:**

- [ ] Custom service form can record Netflix/Spotify/etc. account sales
- [ ] Cost and price recorded, profit calculated
- [ ] "As Samer" flag available (depends on Epic 15)
- [ ] No stock tracking needed — just transaction recording

**Dependencies:** Epic 15 (As Samer) for the external entity flag

---

## Epic 15: Mobile Recharge UI Improvements

---

### LIRA-035: Binance Optional Fees

| Field               | Value                     |
| ------------------- | ------------------------- |
| **Epic**            | Mobile Recharge UI        |
| **Type**            | Feature                   |
| **Priority**        | Low                       |
| **Status**          | TODO                      |
| **Affected Module** | Mobile Recharge > Binance |
| **Assigned To**     | —                         |

**Description:**  
Add optional `fee_in` and `fee_out` fields to Binance transactions, following the same pattern as OMT App and Whish App.

**Acceptance Criteria:**

- [ ] Optional fee_in field on Binance receive transactions
- [ ] Optional fee_out field on Binance send transactions
- [ ] Fees factored into profit calculation
- [ ] Fees stored in `financial_services` record
- [ ] Works with existing Binance transaction flow

---

## Epic 17: "As Samer" — External Entity System _(TBD — Large Feature)_

---

### LIRA-037: External Entity ("As Samer") System Design

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| **Epic**             | As Samer                                               |
| **Type**             | Feature                                                |
| **Priority**         | High                                                   |
| **Status**           | TBD — Needs Design Discussion                          |
| **Affected Modules** | Services, Custom Services, Debts, Settings > Suppliers |
| **Assigned To**      | —                                                      |

**Description:**  
"Samer" represents an external shop/partner that the user does business with. Currently, Samer is loosely associated with the Whish System drawer and supplier settlement. This needs to be formalized into a proper external entity system.

**Core Concept:**

- Samer is a foreign entity (external shop) the user collaborates with
- Some OMT/Whish transactions are done "as Samer" (on his behalf or through his system)
- Debts flow both ways between the shop and Samer
- Settlement happens periodically via Settings > Suppliers
- Services (Netflix accounts, etc.) can be sourced from Samer

**Planned Capabilities:**

- "As Samer" toggle button on: OMT Send, OMT Receive, Whish System Send/Receive, Custom Services
- Transactions flagged "As Samer" are tracked in a dedicated settlement ledger
- Settlement page showing: all Samer transactions, mutual debts, net balance, settlement history
- Services purchased from Samer create a debt entry (shop owes Samer)

**Acceptance Criteria:**

- [ ] TBD — requires design session
- [ ] Should support multiple external entities (not just Samer) for future extensibility
- [ ] Settlement flow clearly shows who owes whom and how much

**Design Questions to Resolve:**

1. Is this a generic "External Entity" system or hardcoded for Samer only?
2. How does Samer's settlement relate to the existing supplier ledger?
3. Should Samer have his own "drawer" for tracking purposes?
4. How do Samer debts interact with the reverse debt system (LIRA-030)?
5. What reports does the user need for Samer reconciliation?

**Current State:**

- Samer is currently the Whish System supplier
- Settlement happens via `Settings > Suppliers > Supplier Ledger`
- `supplier_ledger` table tracks TOP_UP, PAYMENT, ADJUSTMENT, SETTLEMENT entries

---

## Epic 18: Refund & Void Consistency

> Ensure refund/void actions from the Transactions table propagate correctly to source module history tables.

---

### LIRA-039: Refund/Void Must Mark Source Module Records

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| **Epic**             | Refund & Void Consistency                     |
| **Type**             | Bug / Feature                                 |
| **Priority**         | High                                          |
| **Status**           | TODO                                          |
| **Affected Modules** | Transactions table, all module history tables |
| **Assigned To**      | —                                             |

**Description:**  
When a transaction is refunded or voided from the Transactions/Audit page, the system correctly inserts a refund row in the `transactions` table and reverses the drawer amounts. However, **it does not update the source module's record** — the original entry in the module's history still appears as a normal transaction.

**Example:**

1. User does an MTC recharge → row created in `recharges` table + `transactions` table
2. User refunds it from the Transactions page → refund row inserted in `transactions`, drawer reversed ✅
3. MTC history modal still shows the original recharge as normal ❌ — should be marked as "Refunded"

This applies to ALL module source tables: `recharges`, `financial_services`, `sales`, `exchange_transactions`, `custom_services`, `maintenance_jobs`, `expenses`, `loto_tickets`, `debt_ledger`.

**Acceptance Criteria:**

- [ ] Refunding a transaction marks the source record as refunded (e.g., `status = 'REFUNDED'` or `is_refunded = 1`)
- [ ] Voiding a transaction marks the source record as voided
- [ ] Module history modals show refunded/voided entries with a visual indicator (strikethrough, badge, different color)
- [ ] Refunded entries are still visible in history (not deleted) but clearly distinguished
- [ ] Works for all module types: MTC/Alfa recharges, OMT/Whish services, OMT/Whish App transfers, POS sales, exchange, custom services, maintenance, expenses, loto, debts
- [ ] Existing refund logic (drawer reversal, refund row in transactions table) continues to work as-is

**Sub-Tasks:**

1. **LIRA-039a:** Migration — add `is_refunded INTEGER DEFAULT 0` and `refunded_at TEXT` columns to all source tables that lack them
2. **LIRA-039b:** Backend — update refund/void service method to also update the source module record
3. **LIRA-039c:** Frontend — update all history modals to show refunded/voided status with visual indicator
4. **LIRA-039d:** Verify void feature works end-to-end with same propagation logic

**Technical Notes:**

- The refund handler likely lives in `electron-app/handlers/` — find where the refund row is inserted and add the source table update there
- The `transactions` table has a `module` or `type` field that identifies the source — use this to determine which table to update
- Use a DB transaction (BEGIN/COMMIT) to ensure atomicity: refund row + source update happen together
- Consider adding `refunded_by` (username) for audit trail

**Files to Investigate/Modify:**

- `electron-app/handlers/` (transaction/audit handlers — find refund logic)
- `packages/core/src/services/TransactionService.ts` or equivalent
- `packages/core/src/repositories/` (all module repositories — add `markRefunded()` method)
- `packages/core/src/db/migrations/index.ts` (new migration for `is_refunded` columns)
- `electron-app/create_db.sql` (update schema)
- All frontend history modals (add refunded visual state)

---

## Epic 19: Opening/Closing & OMT Fix Verification

---

### LIRA-038: Verify Opening/Closing Works After Checkpoint Refactor

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| **Epic**        | Verification                                       |
| **Type**        | QA                                                 |
| **Priority**    | High                                               |
| **Status**      | TODO                                               |
| **Depends On**  | LIRA-004 (Checkpoint Refactor), LIRA-001 (OMT Fix) |
| **Assigned To** | —                                                  |

**Description:**  
After implementing the checkpoint refactor and OMT fix, perform a comprehensive verification:

1. Create transactions in all modules
2. Perform a checkpoint — verify all drawer amounts are correct
3. Create an OMT transaction — verify it saves and records correctly
4. Perform another checkpoint — verify OMT transaction is reflected
5. Verify dashboard is not affected

**Acceptance Criteria:**

- [ ] All module transactions save correctly
- [ ] Checkpoint expected amounts are accurate
- [ ] OMT transactions save without error
- [ ] Dashboard values independent of checkpoints
- [ ] No regressions in existing functionality

---

## Summary Table

| ID       | Title                               | Epic                | Priority | Status |
| -------- | ----------------------------------- | ------------------- | -------- | ------ |
|          | **Checkpoint System**               |                     |          |        |
| LIRA-004 | Merge Opening/Closing → Checkpoint  | Checkpoint System   | High     | TODO   |
| LIRA-005 | Fix Dashboard Reset on Checkpoint   | Checkpoint System   | High     | TODO   |
| LIRA-006 | Checkpoint Variance Alerts          | Checkpoint System   | Medium   | TODO   |
| LIRA-007 | Checkpoint Currencies Section       | Checkpoint System   | Low      | TBD    |
| LIRA-008 | Checkpoint Stress Test              | Checkpoint System   | High     | TODO   |
|          | **Transaction Editing**             |                     |          |        |
| LIRA-009 | Make All Transactions Editable      | Transaction Editing | High     | TODO   |
| LIRA-010 | Track & Display Edit Metadata       | Transaction Editing | High     | TODO   |
|          | **Timestamp Override**              |                     |          |        |
| LIRA-011 | Optional Time Field on Transactions | Timestamp Override  | Medium   | TODO   |
|          | **Sessions Overhaul**               |                     |          |        |
| LIRA-012 | Shared DB Across Network            | Sessions Overhaul   | High     | TODO   |
| LIRA-013 | Session Close vs Delete UI          | Sessions Overhaul   | Medium   | TODO   |
| LIRA-014 | Walk-In Session Batch Checkout      | Sessions Overhaul   | High     | TODO   |
|          | **MTC/Alfa**                        |                     |          |        |
| LIRA-022 | Margin Alert in Recharge History    | MTC/Alfa            | Medium   | TODO   |
|          | **OMT/Whish**                       |                     |          |        |
| LIRA-025 | Add LBP in OMT & Whish              | OMT/Whish           | Medium   | TODO   |
|          | **Drawer Top-Up**                   |                     |          |        |
| LIRA-029 | General Drawer Top-Up               | Drawer Top-Up       | Medium   | TODO   |
|          | **Reverse Debt**                    |                     |          |        |
| LIRA-030 | Customer Credit / Reverse Debt      | Reverse Debt        | High     | TBD    |
|          | **Maintenance**                     |                     |          |        |
| LIRA-031 | Maintenance Active Jobs & Fix       | Maintenance         | High     | TODO   |
|          | **Custom Services**                 |                     |          |        |
| LIRA-032 | Inventory Search in Custom Services | Custom Services     | Medium   | TODO   |
| LIRA-033 | Netflix Account Selling             | Custom Services     | Low      | TODO   |
|          | **Mobile Recharge UI**              |                     |          |        |
| LIRA-035 | Binance Optional Fees               | Mobile Recharge UI  | Low      | TODO   |
|          | **As Samer**                        |                     |          |        |
| LIRA-037 | "As Samer" External Entity System   | As Samer            | High     | TBD    |
|          | **Refund & Void**                   |                     |          |        |
| LIRA-039 | Refund/Void Source Module Sync      | Refund & Void       | High     | TODO   |
|          | **Verification**                    |                     |          |        |
| LIRA-038 | Post-Refactor Verification          | Verification        | High     | TODO   |

---

### LIRA-040: Exchange Transactions in Customer Sessions

| Field               | Value                      |
| ------------------- | -------------------------- |
| **Epic**            | Customer Sessions Overhaul |
| **Type**            | Feature                    |
| **Priority**        | Medium                     |
| **Status**          | TODO                       |
| **Affected Module** | Exchange, Sessions         |
| **Assigned To**     | —                          |

**Description:**  
Exchange transactions are tricky in the "Add to Cart" / session checkout flow because the customer is both giving and receiving money (currency swap). Needs design work to determine how exchange fits into the batch checkout model.

**Notes:**

- Deferred from initial "Add to Cart" implementation
- Exchange may need to remain as immediate-submit when session is active, or have special cart handling

---

### LIRA-041: Binance Receive Layout & Session Integration

| Field               | Value                               |
| ------------------- | ----------------------------------- |
| **Epic**            | Customer Sessions Overhaul          |
| **Type**            | Bug / Feature                       |
| **Priority**        | Medium                              |
| **Status**          | TODO                                |
| **Affected Module** | Mobile Recharge > Binance, Sessions |
| **Assigned To**     | —                                   |

**Description:**  
Binance Receive (customer sends crypto to shop, cashes out) may not be properly handled in the current layout. The shop increases its Binance drawer and decreases general drawer by the same amount, then gets paid the fee. When in a customer session, the receive amount minus fee should appear as a negative cart item (shop pays out to customer). Needs review and testing.

**Notes:**

- SEND: customer pays amount + fee (positive in cart)
- RECEIVE: customer receives amount - fee (negative in cart)
- Verify drawer logic is correct for both directions

---

### LIRA-042: Fix OmtWhishAppTransferForm Snake_Case Payment Fields

| Field               | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| **Epic**            | Customer Sessions Overhaul                              |
| **Type**            | Bug                                                     |
| **Priority**        | High                                                    |
| **Status**          | TODO                                                    |
| **Affected Module** | Mobile Recharge > OMT App / Whish App                   |
| **Blocked By**      | —                                                       |
| **Blocks**          | LIRA-014 (payment data must work before batch checkout) |
| **Assigned To**     | —                                                       |

**Description:**  
`OmtWhishAppTransferForm.tsx` sends `payment_method` and `payment_lines` (snake_case) but the Zod `FinancialServiceSchema` expects `paidByMethod` and `payments` (camelCase). The Zod `.strip()` silently drops unknown fields, meaning **payment info is lost** on every OMT App / Whish App transaction. The transaction is created but with no payment method recorded.

**Acceptance Criteria:**

- [ ] Form sends `paidByMethod` and `payments` (matching Zod schema)
- [ ] Payment method is correctly recorded on OMT App / Whish App transactions
- [ ] Drawer balances update correctly based on chosen payment method
- [ ] Verify in dev mode: create OMT App send, check DB for payment record

**Files to Modify:**

- `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` — rename fields to camelCase

---

### LIRA-043: Add linkTransaction to FinancialForm & KatchForm

| Field               | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| **Epic**            | Customer Sessions Overhaul                              |
| **Type**            | Bug                                                     |
| **Priority**        | High                                                    |
| **Status**          | TODO                                                    |
| **Affected Module** | Mobile Recharge > OMT App, Whish App, iPick, Katsh      |
| **Blocks**          | LIRA-014 (session linking must work before Add to Cart) |
| **Assigned To**     | —                                                       |

**Description:**  
`linkTransaction` was added to `CryptoForm` (Binance) and `handleTelecomSubmit` (MTC/Alfa) but needs investigation for `FinancialForm` (OMT App/Whish App card grid) and `KatchForm` (iPick/Katsh card grid). These forms may not call `linkTransaction` after successful submit, meaning transactions from these modules won't appear in the customer session.

**Acceptance Criteria:**

- [ ] Investigate if `FinancialForm` calls `linkTransaction` after submit — add if missing
- [ ] Investigate if `KatchForm` calls `linkTransaction` after submit — add if missing
- [ ] Verify in dev mode: create session, do OMT App transfer, confirm it appears in session floating window

**Files to Investigate/Modify:**

- `frontend/src/features/recharge/components/FinancialForm.tsx`
- `frontend/src/features/recharge/components/KatchForm.tsx`

---

| ID       | Title                                      | Epic              | Priority | Status |
| -------- | ------------------------------------------ | ----------------- | -------- | ------ |
| LIRA-040 | Exchange in Customer Sessions              | Sessions Overhaul | Medium   | TODO   |
| LIRA-041 | Binance Receive Layout & Sessions          | Sessions Overhaul | Medium   | TODO   |
| LIRA-042 | Fix OmtWhish Snake_Case Payment Bug        | Sessions Overhaul | High     | DONE   |
| LIRA-043 | linkTransaction in FinancialForm/KatchForm | Sessions Overhaul | High     | DONE   |

---

> **LIRA-042 completed** (Session 4): Fixed `payment_method` → `paidByMethod` and `payment_lines` → `payments` in OmtWhishAppTransferForm.tsx.
> **LIRA-043 completed** (Session 4): Rewrote FinancialForm and KatchForm to make real API calls (were no-op stubs). Added `linkTransaction`. Removed dead `handleFinancialSubmit` from parent.
> **LIRA-014 IN PROGRESS** (Session 4): Steps 1-7 complete (DB migration v61, cart types, SessionContext cart state, floating window cart display, POS Add to Cart, MTC/Alfa Add to Cart, all remaining modules Add to Cart). Step 8 (backend batch checkout) next.
