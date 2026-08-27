# Sprint 3 Archive — Enhancements & Polish (LIRA-065..076) + Backlog + Session Summary

> **Archived 2026-08-12** from `current_sprint.md` (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`,
> committed `2bfc7f5`). Sprint 3 created 2026-06-17. 10 of 12 tickets are DONE. Also includes the
> adjoining "🔮 Backlog / Future Enhancements" (LIRA-077, DONE) and the untitled
> "Session Summary — Session Basket Payment, Transaction-Based Profits & Supplier-Ledger Fix"
> narrative retro that followed it in the original file, both archived together since neither
> carries any open item.
>
> **LIRA-068 and LIRA-075 are NOT archived here — both are still genuinely open** (no code exists
> for either) and live in the live board in `current_sprint.md`. They originally sat between
> LIRA-067/LIRA-069 and LIRA-074/LIRA-076 respectively, below.

---

# Sprint 3 — Enhancements & Polish

> **Sprint Focus:** setup/onboarding, transaction visibility & receipts, profits hardening, supplier/recharge polish
> **Created:** 2026-06-17
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

---

## LIRA-065: Setup — Initial Drawer Amounts Page

| Field                | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| **Epic**             | Setup / Onboarding                                       |
| **Type**             | Feature                                                  |
| **Priority**         | Medium                                                   |
| **Status**           | DONE                                                     |
| **Affected Modules** | Settings / Setup, Drawers, Dashboard, TransactionsViewer |
| **Depends On**       | —                                                        |

### Summary

Add a setup page where the operator sets **initial (opening) amounts** for each currency drawer (General/per-provider, USD + LBP). Today there is no first-run page to seed starting drawer balances (Settings only references Opening/Closing in passing).

### Acceptance Criteria

- [x] A "Initial Drawer Amounts" page (in Setup, or a Settings panel) lists each drawer × currency with an amount input
- [x] Saving seeds the opening balances (creates the appropriate drawer/adjustment entries)
- [x] Idempotent / clearly communicates if balances are already set (no silent double-seed)
- [x] Values reflected in Closing/Opening and dashboards
- [x] Typecheck and lint pass

### Files Modified

| Layer    | File                                                       | Change                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/ClosingRepository.ts`      | `hasInitialBalancesSet()` — checks if any drawer has a non-zero balance                                                                                                                                                                             |
| Backend  | `packages/core/src/services/ClosingService.ts`             | Delegates `hasInitialBalancesSet()`                                                                                                                                                                                                                 |
| Backend  | `packages/core/src/repositories/ClosingRepository.ts`      | `notes` field added to `metadata_json` in `createCheckpoint`                                                                                                                                                                                        |
| Electron | `electron-app/handlers/closingHandlers.ts`                 | `closing:has-initial-balances-set` IPC handler                                                                                                                                                                                                      |
| Electron | `electron-app/preload.ts`                                  | `hasInitialBalancesSet` binding                                                                                                                                                                                                                     |
| Frontend | Setup wizard `StepDrawerAmounts`                           | Step 6 — module-filtered drawer grid; stores amounts in `payload.drawer_amounts`                                                                                                                                                                    |
| Frontend | Setup wizard `SetupWizard`                                 | Now 7 steps; `StepComplete` applies drawer amounts via `createCheckpoint` after setup                                                                                                                                                               |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx`      | Amber banner when initial balances not set; `InitialDrawerAmountsModal` (2-column grid, pre-fills current balances)                                                                                                                                 |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx` | `CHECKPOINT` label → "Checkpoint" / "Initial Setup" (orange when notes contain "initial"/"setup"); per-drawer amounts breakdown in summary; payment legs suppressed for CHECKPOINT rows; amount column uses `metadata_json.amounts` physical totals |

---

## LIRA-066: Settlement Transactions Appear in Transactions Table

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| **Epic**             | Transaction Visibility                                 |
| **Type**             | Bug / Feature                                          |
| **Priority**         | Medium                                                 |
| **Status**           | DONE (a3d09e7; board was stale — validated 2026-07-19) |
| **Affected Modules** | Audit > TransactionsViewer, Debts, Suppliers, Partners |
| **Depends On**       | — (related: LIRA-061)                                  |

### Summary

Ensure **settlement transactions** are visible in the unified Transactions table: **client** (debt repayment), **supplier** (both _company_ and _product_ suppliers), and **partner** settlements. The filter groups already list "Debt Repayment", "Supplier Payment/Settlement" — verify each path actually writes a `transactions` row and that none are missing.

### Acceptance Criteria

- [ ] Client debt settlement → appears in Transactions table
- [ ] Supplier settlement/payment (company **and** product suppliers) → appears
- [ ] Partner settlement → appears
- [ ] Correct in/out direction + amounts per settlement
- [ ] Existing filter-group labels resolve to real rows (no dead filters)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                         | Change                                          |
| -------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Backend  | Debt/Supplier/Partner repositories + `TransactionRepository` | Ensure settlement paths create transaction rows |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx`   | Verify rendering/filters                        |

### Progress Notes (2026-07-20 — owner notes batch)

- **Partner paper Record-Tx visibility (note 2) — FIXED today.** A partner Record-Transaction
  made with the "Cash moved" toggle off (paper/no-drawer entry) now posts a `PARTNER_ADJUSTMENT`
  row so it shows up in the Transactions table like every other partner entry. Failing-first
  tested.
- **Verification sweep (today)** re-confirmed this ticket's original acceptance criteria against
  the current tree: client debt settlement, supplier settlement (both company and product
  suppliers), and cash-partner settlement all write a `transactions` row correctly.
- **Residual gap found today, fix landing today:** the **CLIENT_ACCOUNT-method** partner
  settlement path (settling a partner balance by charging it to a client's account rather than
  cash) does not yet write a visible row — being fixed as part of the same 2026-07-20 session.
  Status intentionally left as-is (not flipped to DONE) until that fix is verified.

---

## LIRA-067: Transaction Payment Detail — Expandable Row + Indented Report Print

| Field                | Value                                  |
| -------------------- | -------------------------------------- |
| **Epic**             | Transaction Visibility                 |
| **Type**             | Feature                                |
| **Priority**         | Medium                                 |
| **Status**           | DISREGARDED                            |
| **Affected Modules** | Audit > TransactionsViewer, Exports    |
| **Depends On**       | **LIRA-064** (structured payment data) |

### Summary

Consume the structured in/out payment data from **LIRA-064** in two more surfaces:

1. **Expandable row** in the Transactions table — clicking a row reveals the per-leg payment detail.
2. **Printed/exported report** — print the payment details **under** the transaction row, **indented (start at column + 1)**.

### Acceptance Criteria

- [ ] Clicking a transaction row expands to show structured in/out payment legs
- [ ] Report/export prints payment detail lines beneath each transaction, indented one column in
- [ ] Reuses the LIRA-064 structured field (no duplicate data wiring; nothing baked into `summary` text)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                        | Change                                       |
| -------- | ----------------------------------------------------------- | -------------------------------------------- |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx`  | Expandable row UI                            |
| Frontend | `packages/ui/src/components/ui/DataTable.tsx` (export path) | Indented sub-rows in printed/exported report |

---

> _(LIRA-068 — Mark Transaction "Amount Changed" When Edited — moved to the live board, still open)_

---

## LIRA-069: Invoice / Receipt Print on Successful Payment

| Field                | Value                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- |
| **Epic**             | Receipts / Printing                                                                   |
| **Type**             | Feature                                                                               |
| **Priority**         | Low                                                                                   |
| **Status**           | DONE (2026-07-19 — gating predicate, history/session print, auto-print; see plan doc) |
| **Affected Modules** | POS, Recharge, Services, Maintenance, Customer Sessions, Audit                        |
| **Depends On**       | —                                                                                     |

### Summary

Print a receipt/invoice when a payment succeeds, with session-aware behavior and reprint entry points.

### Acceptance Criteria

- [ ] On successful payment → open a print dialog (receipt/invoice)
- [ ] If a **customer session is ongoing** → skip the auto-dialog; show a **Print** button in the customer-session payment modal instead
- [ ] In **all cases**, show a Print button for a selected transaction in the **Transactions table**
- [ ] Show a Print button in **each module's History modal**
- [ ] **Include** transaction types: mobile recharge, services, maintenance, etc.
- [ ] **Exclude**: OMT/Whish **System**, OMT/Whish **App**, Binance
- [ ] **Include Whish App Bills** (exception to the App exclusion)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                     | Change                                      |
| -------- | -------------------------------------------------------- | ------------------------------------------- |
| Frontend | Receipt/invoice component (new, or reuse POS receipt)    | Render + print dialog                       |
| Frontend | Checkout/payment success handlers; CustomerSession modal | Trigger dialog / session-aware Print button |
| Frontend | `TransactionsViewer.tsx` + module `HistoryModal`s        | Per-row Print button (type-gated)           |

---

## LIRA-070: Profits Page — Correctness Audit

| Field                | Value                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| **Epic**             | Profits                                                                  |
| **Type**             | Bug / Audit                                                              |
| **Priority**         | Low                                                                      |
| **Status**           | DONE (audit + lira-090 earlier; split-void gap closed 2026-07-19 via B+) |
| **Affected Modules** | Profits                                                                  |
| **Depends On**       | —                                                                        |

### Summary

Verify the Profits page (`frontend/src/features/profits/pages/Profits.tsx`) computes profit correctly across all sources (sales, recharge, services, maintenance, financial, etc.) and that totals/margins reconcile.

**Follow-up finding (2026-07-21, via LIRA-081):** `ProfitRepository.PROFIT_TXN_TYPES` (used by `getByUser`/`getByClient`/`getDeferredProfit`) does not include `EXCHANGE` — a pending for-partner exchange's deferred profit is invisible in the deferred-profit bucket (money math itself is correct). Pre-existing; fix has broad blast radius across all exchanges — audit before changing. (The missing `notPartnerPending` gate on exchange/custom-service totals WAS fixed 2026-07-21.)

### Acceptance Criteria

- [ ] Profit per source matches underlying transaction profit fields
- [ ] Totals/margins reconcile; no double-counting or missing sources
- [ ] Edge cases (refunds, voids, dual-currency, LBP-native) handled
- [ ] Discrepancies fixed at the source (repository/service), with tests
- [ ] Typecheck and lint pass

---

## LIRA-071: Hide Profits Page + Profit Data for Non-Admin

| Field                | Value                             |
| -------------------- | --------------------------------- |
| **Epic**             | Profits / Security                |
| **Type**             | Feature / Security                |
| **Priority**         | Low                               |
| **Status**           | DONE                              |
| **Affected Modules** | Profits, routing, margin displays |
| **Depends On**       | —                                 |

### Summary

`/profits` is currently behind `ProtectedRoute` (auth only), not role-gated. Hide the **Profits page** and **profit/margin data** from non-admin roles (route guard + nav item + any inline margin displays).

### Acceptance Criteria

- [x] Non-admins cannot navigate to `/profits` (new `AdminRoute` guard; nav item already hidden via `admin_only` module flag)
- [x] Profit/margin figures hidden for non-admins wherever surfaced (reuses `useAuth().user?.role === "admin"`, same as recharge `CardGridPayView`)
- [x] Admins unaffected
- [x] Backend profit IPC also role-checked (defense in depth) — `profitHandlers.ts` already `requireRole(["admin"])` on every channel
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                              | Change                     |
| -------- | --------------------------------- | -------------------------- |
| Frontend | `frontend/src/app/App.tsx`        | Role-gate `/profits` route |
| Frontend | nav/sidebar + any margin displays | Hide for non-admin         |
| Electron | profits handler(s)                | `requireRole(["admin"])`   |

---

## LIRA-072: Telecom (Alfa/MTC) Voucher Items Named by Card Number, Not Sell Amount

| Field                | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| **Epic**             | Recharge Catalog                                                    |
| **Type**             | Feature / Data                                                      |
| **Priority**         | Low                                                                 |
| **Status**           | DONE\* (iPick mtc Prepaid renamed; Credits/Validity held for owner) |
| **Affected Modules** | Recharge > iPick, Katsh, Whish App                                  |
| **Depends On**       | —                                                                   |

### Summary

For Alfa/MTC voucher items in iPick/Katsh/Whish App, the cart/item is currently named by its **sell amount**. Instead, name it by the **number printed on the card itself** (the card denomination/code). Requires checking the providers' actual cards to map correct labels.

### Acceptance Criteria

- [ ] Alfa/MTC voucher items display/save the name as the **card's printed number**, not the sell amount
- [ ] Mapping verified against the provider cards (Alfa + MTC denominations)
- [ ] Existing carts/history still render sensibly (no broken labels)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer        | File                                        | Change                  |
| ------------ | ------------------------------------------- | ----------------------- |
| Backend/Data | mobile service items seed/catalog           | Item name = card number |
| Frontend     | `KatchForm.tsx` + telecom voucher rendering | Use card-number label   |

---

## LIRA-073: DataTable Export — Customizable Columns

| Field                | Value                           |
| -------------------- | ------------------------------- |
| **Epic**             | Exports / Table Component       |
| **Type**             | Feature                         |
| **Priority**         | Low                             |
| **Status**           | DONE                            |
| **Affected Modules** | Shared `DataTable` (all tables) |
| **Depends On**       | —                               |

### Summary

Let the operator choose which columns are exported from the shared `DataTable` (`packages/ui/src/components/ui/DataTable.tsx`). Default the export to **Time, Summary, User**; allow adding any extra columns before exporting (Excel/PDF).

### Acceptance Criteria

- [x] Export defaults to **Time / Summary / User** columns (or all, when those headers are absent; overridable via `exportDefaultColumns` prop)
- [x] A pre-export column picker lets the user add/remove extra columns
- [x] Applies to both Excel and PDF export paths
- [x] No regression for tables that already export
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                          | Change                         |
| -------- | --------------------------------------------- | ------------------------------ |
| Frontend | `packages/ui/src/components/ui/DataTable.tsx` | Column-selection before export |

---

## LIRA-074: Remove Manual Entry Tab in Suppliers

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Supplier Management                |
| **Type**             | Cleanup / UX                       |
| **Priority**         | Low                                |
| **Status**           | DONE                               |
| **Affected Modules** | Suppliers                          |
| **Depends On**       | **LIRA-059** (replacement actions) |

### Summary

Remove the free-form **Manual Entry** tab (TOP_UP/PAYMENT/ADJUSTMENT raw entry) from the Suppliers page. Its legitimate use (paying a supplier / recording a supplier payment) is replaced by the focused **Pay Supplier** / **Supplier Paid Us** actions using `MultiPaymentInput` (LIRA-059 item 5).

### Acceptance Criteria

- [x] Manual Entry tab removed from `Suppliers/index.tsx` (replaced with Pay/Receive UI in LIRA-059 item 5)
- [x] No loss of capability — pay/receive flows exist via LIRA-059's focused actions
- [x] Ledger history still renders
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                        | Change                          |
| -------- | ----------------------------------------------------------- | ------------------------------- |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx` | Remove Manual Entry tab + state |

---

> _(LIRA-075 — Favorite/Pin Whish App Quick Link in Home Grid — moved to the live board, still open)_

---

## LIRA-076: Remove "Save as Client" Checkbox from Customer Session Modal (Keep Auto-Save)

| Field                | Value             |
| -------------------- | ----------------- |
| **Epic**             | Customer Sessions |
| **Type**             | Cleanup / UX      |
| **Priority**         | Medium            |
| **Status**           | DONE              |
| **Affected Modules** | Sessions          |
| **Depends On**       | —                 |

### Summary

Starting a customer session with a name + phone saved a `clients` row **even when the "Save as client" checkbox was left unchecked** — the checkbox and the code path that actually inserts into `clients` were completely disconnected (see Root Cause). **Owner decision:** keep the auto-save-on-session-create behavior; remove the now-misleading checkbox from the session modal instead of gating the backend behind it.

### Root Cause (grounded)

- **Checkbox path (frontend-only, now removed):** `StartSessionModal.tsx` rendered `SaveAsClientCheckbox` driven by the `useSaveAsClient` hook. When checked, `trySaveAsClient()` called `window.api.clients.create()` directly. The checkbox's boolean state was **never included** in the `session:start` IPC payload.
- **Actual insert (backend, unconditional — unchanged/kept):** `electron-app/handlers/sessionHandlers.ts` ~L303-320 has an "Auto-register client" block that runs on every `session:start` whenever `customer_name` **and** `customer_phone` are both present, via `ClientRepository.createClient()` (dedup'd by `findByPhone`). This is the behavior being kept.

### Resolution

- [x] Removed `useSaveAsClient` hook usage and `<SaveAsClientCheckbox />` from `StartSessionModal.tsx` (import, hook call, `resetSaveAsClient()` calls, `trySaveAsClient()` call, and the JSX)
- [x] Backend auto-register in `sessionHandlers.ts` left untouched — session start with name+phone still saves/finds the client automatically
- [x] `SaveAsClientCheckbox` / `useSaveAsClient` themselves NOT deleted — still used by Custom Services, Recharge (OMT/Whish transfer), Maintenance, and Services forms
- [x] Typecheck and lint pass (frontend: 0 errors, pre-existing warnings only)

### Files Modified

| Layer    | File                                                              | Change                                                                                                         |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Frontend | `frontend/src/features/sessions/components/StartSessionModal.tsx` | Removed the "Save as client" checkbox + its hook wiring; session client save is now purely automatic (backend) |

---

## Summary (Sprint 3 — LIRA-065..076)

> **2026-07-19 validation & completion sweep** (code-audited, then finished by
> parallel workstreams; full record:
> `docs/plans/todo_plans/PARTIAL_TASKS_COMPLETION_PLAN.md`):
> LIRA-066 was already DONE in code (commit a3d09e7 — board was stale).
> LIRA-069, -070(void gap), -072(iPick mtc Prepaid), -077 completed 2026-07-19.
> Remaining open: LIRA-068, LIRA-075, LIRA-058 (needs interview).

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| Medium    | 4      | 3     | 0         |
| Low       | 8      | 6     | 2         |
| **Total** | **12** | **9** | **2**     |

### Sprint 3 board

| ID       | Title                                               | Priority | Status      |
| -------- | --------------------------------------------------- | -------- | ----------- |
| LIRA-065 | Setup — initial drawer amounts page                 | Medium   | DONE        |
| LIRA-066 | Settlement txns (client/supplier/partner) in table  | Medium   | DONE        |
| LIRA-067 | Txn payment detail — expandable row + report print  | Medium   | DISREGARDED |
| LIRA-068 | Mark txn "amount changed" on edit                   | Low      | TODO        |
| LIRA-069 | Invoice/receipt print on payment                    | Low      | DONE        |
| LIRA-070 | Profits page correctness audit                      | Low      | DONE        |
| LIRA-071 | Hide profits page + data for non-admin              | Low      | DONE        |
| LIRA-072 | Telecom vouchers named by card number               | Low      | DONE\*      |
| LIRA-073 | DataTable export — customizable columns             | Low      | DONE        |
| LIRA-074 | Remove Manual Entry tab in Suppliers                | Low      | DONE        |
| LIRA-075 | Favorite/pin Whish App quick link in home grid      | Low      | TODO        |
| LIRA-076 | Remove "save as client" checkbox from session modal | Medium   | DONE        |

> \* LIRA-072: iPick mtc **Prepaid** renamed to card face value (matching the
> owner's A1 decision); `mtc.Credits` + `mtc.Validity` deliberately left
> amount/duration-labeled pending owner confirmation (evidence they're direct
> top-ups, not cards). Existing installs get the DB rename via the W6
> migration (see plan doc).

---

## 🔮 Backlog / Future Enhancements

## LIRA-077: Inventory — Stock Replenishment / Adjustment

| Field                | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| **Epic**             | Inventory                                                     |
| **Type**             | Feature / Enhancement                                         |
| **Priority**         | High                                                          |
| **Status**           | DONE (2026-07-19 — v132 audit table + adjust modal + history) |
| **Affected Modules** | Inventory, POS                                                |
| **Assigned To**      | —                                                             |
| **Depends On**       | Allow out-of-stock sales config + Negative-Stock report       |

### Summary

With **"Allow out-of-stock sales"** enabled, `stock_quantity` can go **negative** (and the Negative-Stock report / Diagnostics panel now surfaces oversold items). Add a way to **replenish / adjust stock** so operators can correct negative or inaccurate counts — e.g. a "Restock" / stock-adjustment action reachable from the Negative-Stock report and from Inventory. This closes the reconciliation loop for shops running in out-of-stock mode.

**TBD [to be discussed]:**

- Set-absolute vs. add-delta (or both); single-item vs. bulk restock.
- Entry point(s): Negative-Stock report row action, Inventory row action, and/or a dedicated screen.
- Audit trail (who / when / why); whether a restock books a transaction/cost or is a pure count correction (supplier/cost reconciliation vs. count-only).
- Permissions (admin vs. staff) and behaviour across desktop (IPC) + web (REST).

### Acceptance Criteria

- [ ] TBD — pending the discussion above.

---

## Session Summary — Session Basket Payment, Transaction-Based Profits & Supplier-Ledger Fix

> Builds on **LIRA-055** (session checkout modal) + **LIRA-064** (structured payment legs).
> Implemented on branch **`feat/session-basket-payment`**. Migrations **v100–v102** here
> (the parallel LIRA-059 supplier work added **v103**, sequential — no conflict).

### What was done

**Session basket payment — single source of truth (the core change)**

- A customer session is now ONE basket the customer pays for **once**. Each cart item is
  created in `deferPayment` mode: it books only its **internal** legs (provider cost, telecom
  stock, OMT/WHISH `_System` reserve transfer, Binance USDT) and **skips** its own
  customer-cash side. OMT/WHISH SEND keeps its `General → *_System` reserve on the transaction.
- New **`SessionPaymentService`** + **`SessionPaymentRepository`** record the single basket
  payment: customer-cash legs → `payments` (new **`session_id`** column), posted to drawers
  **once**, **one** debt-ledger entry for the CUSTOMER_ACCOUNT portion, gift-card redemption,
  and back-fill of each session SALE's paid state.
- Forms (OMT/Whish App, Crypto, Telecom, Katch, Financial, recharge page) no longer open a
  PaymentSheet in session mode — the Session Checkout modal is the **only** payment surface.
  Per-item method dropdowns removed; per-item **discount** added; gift card moved to a
  basket-level `GIFT_CARD` leg.
- Transactions viewer: same-session rows share the one basket payment + rate, with a
  **per-session colored left border** (light/dark safe). Migration **v100** (`payments.session_id`).

**Supplier-ledger secondary-system fix** (coordinates with LIRA-059)

- Only the shop's PRIMARY (base) OMT/WHISH system books a supplier-ledger debt. The SECONDARY
  system runs via a partner (obligation lives in `partner_ledger`) and is now **hidden from the
  Suppliers page**. Migration **v102** purges existing secondary-system pollution.

**Transaction-based profits + refund fix**

- Profit amount is now sourced uniformly from `transactions.profit_usd` (realized/pending gates
  kept). **REFUND** transactions stamp negative profit so refunds net correctly. Migration
  **v101** backfills historical custom-service/maintenance profit. Operator-edited exchange rate
  is recorded; new **`useSellRate`** unifies the Money-IN rate.

**Architecture (CLAUDE.md rules 13/14)**

- `ProfitService` + `SessionPaymentService` are now **SQL-free** (logic only); all SQL moved to
  **`ProfitRepository`** / **`SessionPaymentRepository`** with de-duplicated business predicates.

**Quality** — jest **374/374**, frontend **209**, **5 dedicated e2e specs**
(`lira-supplier-secondary-system`, `-session-basket-payment`, `-session-exchange-rate`,
`-session-profits`, `-session-basket-debt`), lint 0 errors, typecheck clean. `yarn test` made
sequential (`-A`) so the local full-suite run no longer OOMs (CI runs per-workspace, unaffected).

### What to manually test

**Session basket payment**

1. Start a customer session (name + phone).
2. Add several items from different modules — e.g. a **Whish App SEND**, an **MTC recharge**, a
   **POS sale** — and confirm you are **not** asked to pay at add-to-cart time.
3. Open **Session Checkout** → enter the payment once; try **overpaying** and handing back change.
   Confirm.
4. Expect: the **cash drawer rises by exactly (tendered − change)** — no double-count; the
   Transactions table shows each session row sharing the **same** payment legs + rate, with a
   matching per-session **left-border color** (toggle light/dark — the border stays).
5. Pay (partly) by **Customer Account** → expect exactly **one** debt entry for the basket on the
   session's client (not one per item).
6. Edit the exchange rate in the modal → the session's transactions show that rate (`@ <rate>`).

**Supplier-ledger fix**

1. Suppliers page → the **secondary** OMT/WHISH system (the non-base one) should **not** appear.
2. Do a secondary-system transfer via a partner → it books only a **partner-ledger** entry (no
   supplier-ledger entry); the base system still books normally.

**Profits**

1. Profits page totals for a past date range should be **unchanged** (parity).
2. A session **POS sale's** profit should be **realized** after a paid checkout (not stuck in
   Pending). Refund part of a sale → its profit drops by exactly the refunded amount.

### After testing — what's next

- **Finish committing** branch `feat/session-basket-payment`: db + core are committed (core
  bundles the parallel LIRA-059 supplier-cashflow edits, by request); **electron + frontend +
  e2e + chore** chunks remain.
- **Native ABI:** the suite last ran jest (Node ABI) — run `yarn dev` once to restore the
  Electron ABI before the next `test:e2e` (see CLAUDE.md "Running E2E tests").
- **Optional follow-up:** thread `exchange_rate` through custom/sales/loto/maintenance session
  transactions (financial/recharge already do it).
- **Sprint board next:** **LIRA-067** (expandable txn payment detail — builds directly on
  LIRA-064), **LIRA-065** (initial drawer amounts), **LIRA-066** (settlement txns in table).
  **LIRA-070** (profits correctness audit) is now largely covered by the transaction-based
  refactor — worth re-scoping or closing.

---

---
