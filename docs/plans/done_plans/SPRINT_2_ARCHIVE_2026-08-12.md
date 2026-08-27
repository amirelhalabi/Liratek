# Sprint 2 Archive — Topup Flows, Supplier Improvements & Hold Money (LIRA-056..064)

> **Archived 2026-08-12** from `current_sprint.md` (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`,
> committed `2bfc7f5`). Sprint 2 created 2026-06-14. 8 of 9 tickets are DONE.
>
> **LIRA-058 (OMT App topup flow design) is NOT archived here — it is still genuinely open**
> (NEEDS INTERVIEW, blocked on an owner interview that never happened) and lives in the live
> board in `current_sprint.md`. It originally sat between LIRA-057 and LIRA-059 below.

---

# Sprint 2 — Topup Flows, Supplier Improvements & Hold Money

> **Sprint Focus:** Topup modal UX fixes, Whish App partner/client topup, supplier balance improvements, hold money service
> **Created:** 2026-06-14
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

---

## LIRA-056: KATSH / iPick — Remove "From Drawer" from Topup Modal + Settlement E2E Test

| Field                | Value                   |
| -------------------- | ----------------------- |
| **Epic**             | Topup UX                |
| **Type**             | Bug / UX + Test         |
| **Priority**         | Medium                  |
| **Status**           | DONE                    |
| **Affected Modules** | Recharge > Katsh, iPick |
| **Assigned To**      | —                       |
| **Depends On**       | —                       |

### Summary

When topping up Katsh or iPick, the operator contacts the supplier who extends credit — no cash leaves any drawer. The current `TopUpModal` incorrectly shows a "from drawer" dropdown for these providers, implying a drawer transfer that doesn't happen. Remove it.

Additionally, the supplier settlement flow for Katsh/iPick has not been tested. Add an e2e/integration test to verify that settling with a supplier correctly deducts from the selected drawer and records the payment in the supplier ledger.

### Context

- Katsh/iPick topup = supplier credits your app balance now; you pay them later via settle (recorded as `TOP_UP` entry in supplier ledger, no drawer affected)
- The `TopUpModal` (`packages/ui/src/components/ui/TopUpModal.tsx`) shows "From Drawer" / "External (Cash In)" modes for all providers — this makes no sense for Katsh/iPick where the only topup source is the supplier themselves
- Supplier settlement has a `PAYMENT` entry type and drawer deduction — this path needs a test to verify correctness

### Acceptance Criteria

- [x] `TopUpModal` for Katsh and iPick no longer shows the "from drawer" dropdown or mode toggle — replaced with amber supplier-credit banner + "Confirm Supplier Credit" button
- [x] Topup for Katsh/iPick now calls new `recharge:top-up-from-supplier` IPC endpoint → records `TOP_UP` entry in `supplier_ledger`, increases provider drawer balance, NO source drawer deducted
- [x] `RechargeRepository.topUpFromSupplier()` added; `RechargeService.topUpFromSupplier()` added; Zod schema `TopUpFromSupplierSchema` added; IPC handler registered; preload binding + `electron.d.ts` type added
- [x] Integration tests: 5 tests for `topUpFromSupplier` + 2 for supplier settlement — all pass (384 backend tests green)
- [x] Frontend typecheck clean (pre-existing errors in unrelated files on this branch); 210 frontend tests pass

### Files Modified

| Layer    | File                                                                             | Change                                                                  |
| -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`                           | Added `topUpFromSupplier()` method                                      |
| Backend  | `packages/core/src/services/RechargeService.ts`                                  | Added `topUpFromSupplier()` service method                              |
| Backend  | `packages/core/src/repositories/__tests__/SupplierRepository.settlement.test.ts` | 7 new tests for topUpFromSupplier + supplier settlement                 |
| Electron | `electron-app/schemas/index.ts`                                                  | Added `TopUpFromSupplierSchema`                                         |
| Electron | `electron-app/handlers/rechargeHandlers.ts`                                      | Added `recharge:top-up-from-supplier` IPC handler                       |
| Electron | `electron-app/preload.ts`                                                        | Added `topUpFromSupplier` binding                                       |
| Types    | `frontend/src/types/electron.d.ts`                                               | Added `topUpFromSupplier` type                                          |
| Frontend | `packages/ui/src/components/ui/TopUpModal.tsx`                                   | `isSupplierCredit` flag hides drawer UI; shows supplier banner          |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`                        | Added `handleTopUpConfirmSupplier`; passes `onConfirmSupplier` to modal |

---

## LIRA-057: WHISH APP — Topup Via Partner / From Client Sub-Modes

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Whish App Topup                |
| **Type**             | Feature                        |
| **Priority**         | High                           |
| **Status**           | DONE                           |
| **Affected Modules** | Recharge > Whish App, Partners |
| **Assigned To**      | —                              |
| **Depends On**       | —                              |

### Summary

The existing Whish App topup button opens the generic `TopUpModal` with a "from drawer" flow — which does not match either real-world topup scenario. Replaced it with two sub-modes:

- **Via Partner**: a partner credits your Whish App balance now; you owe them and pay later via settle. Records a `partner_ledger` CREDIT entry (we owe partner) + increases Whish_App drawer. No cash drawer touched.
- **From Client**: a client transfers Whish credits to the shop; shop pays the client cash. Mirrors the existing MTC/Alfa `topUpFromCustomer` flow (credits in / cash out) with a RECEIVE-style fee UI: Whish_App **+amount**, General **−(amount − fee)**, profit = fee. Fee field has 1% USD auto-default; "fee included" checkbox unchecked by default.

### Implementation Note (correction during build)

Initial assumption was "From Client" === Whish App RECEIVE. Tracing the code showed RECEIVE _decreases_ the system drawer (provider owes shop) — the wrong direction. "From Client" is credits-in / cash-out, structurally identical to the existing MTC/Alfa `topUpFromCustomer`. Implemented as a dedicated `topUpFromClient` repo method (Whish_App +amount, General −cashPaid, profit booked = amount − cashPaid).

### Acceptance Criteria

- [x] TopUpModal for WHISH_APP shows two sub-mode buttons: "Via Partner" / "From Client"; old drawer/external UI hidden for WHISH_APP
- [x] **Via Partner**: `PartnerSelector` shown; on confirm → `RechargeRepository.topUpFromPartner` creates `partner_ledger` CREDIT (`WHISH_TOPUP`) entry + Whish_App drawer +amount; no cash drawer affected; visible in Partners ledger
- [x] **From Client**: amount (USD/LBP) + fee field (1% USD auto-default, manual override) + "fee included" checkbox (unchecked default) + optional client name; on confirm → `topUpFromClient`: Whish_App +amount, General −(amount−fee), profit = fee
- [x] New IPC: `recharge:top-up-from-partner`, `recharge:top-up-from-client` (Zod-validated, requireRole) + preload bindings + `electron.d.ts` types
- [x] `'WHISH_TOPUP'` added to `partner_ledger` transaction_type union
- [x] Tests: 5 new `RechargeRepository.topup.test.ts` (partner CREDIT + no-drawer, unknown-partner guard, client credits-in/cash-out, insufficient-balance guard, LBP path) — all pass
- [x] Full validation: packages/core 343/343, @liratek/backend 384/384, frontend 209 passed/1 skipped, typecheck + lint clean for changed files

### Files Modified

| Layer    | File                                                                             | Change                                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`                           | Added `topUpFromPartner` + `topUpFromClient`                                                                                                                                                                                                                                |
| Backend  | `packages/core/src/services/RechargeService.ts`                                  | Added service delegates                                                                                                                                                                                                                                                     |
| Backend  | `packages/core/src/repositories/PartnerRepository.ts`                            | Added `'WHISH_TOPUP'` to transaction_type union                                                                                                                                                                                                                             |
| Database | `packages/core/src/db/migrations/index.ts`                                       | **v97** — dropped `recharges.carrier CHECK(MTC/Alfa)` so all-provider top-ups can log; **v98** — added `'WHISH_TOPUP'` to `partner_ledger.transaction_type CHECK` (mirrors v83). Both recreate-table migrations validated (rows+ids+indexes preserved, new inserts succeed) |
| Database | `electron-app/create_db.sql`                                                     | `recharges.carrier TEXT NOT NULL` (no CHECK), `partner_ledger` CHECK += `WHISH_TOPUP`, v97 + v98 migration entries                                                                                                                                                          |
| Backend  | `packages/core/src/repositories/__tests__/RechargeRepository.topup.test.ts`      | New — 5 tests                                                                                                                                                                                                                                                               |
| Backend  | `packages/core/src/repositories/__tests__/SupplierRepository.settlement.test.ts` | Fixed `transactions` test schema (missing exchange_rate/client_phone/device_id) — unblocked LIRA-056's 7 tests                                                                                                                                                              |
| Electron | `electron-app/schemas/index.ts`                                                  | `TopUpFromPartnerSchema`, `TopUpFromClientSchema`                                                                                                                                                                                                                           |
| Electron | `electron-app/handlers/rechargeHandlers.ts`                                      | Two new IPC handlers                                                                                                                                                                                                                                                        |
| Electron | `electron-app/preload.ts`                                                        | `topUpFromPartner` + `topUpFromClient` bindings                                                                                                                                                                                                                             |
| Types    | `frontend/src/types/electron.d.ts`                                               | Matching IPC types                                                                                                                                                                                                                                                          |
| Frontend | `packages/ui/src/components/ui/TopUpModal.tsx`                                   | `isWhishTopUp` two-mode UI (partner picker / client fee form)                                                                                                                                                                                                               |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`                        | `handleTopUpConfirmPartner/Client`, partner state, modal wiring                                                                                                                                                                                                             |

---

> _(LIRA-058 — OMT App topup flow design, NEEDS INTERVIEW — moved to the live board, still open)_

---

## LIRA-059: SUPPLIERS — Display Fixes + Bidirectional Balance + Supplier Pays Us

| Field                | Value               |
| -------------------- | ------------------- |
| **Epic**             | Supplier Management |
| **Type**             | Feature + Bug Fix   |
| **Priority**         | High                |
| **Status**           | DONE                |
| **Affected Modules** | Suppliers           |
| **Assigned To**      | —                   |
| **Depends On**       | —                   |

### Summary

Six bundled improvements to the Suppliers page:

1. ✅ **DONE (v1.24.0)** — **Rename "Katch" → "Katsh"** (migration v96 + `create_db.sql`).
2. ✅ **DONE (v1.24.0)** — **Wire Loto Liban drawer name** (`PROVIDER_DRAWER` += `LOTO: "Loto"`).
3. **Bidirectional balance**: allow overpayment on settlement — the balance goes negative (supplier owes us). Show negative balance in green ("they owe you"), positive in red ("you owe them"). This already works mathematically; the display and UX need to correctly communicate the direction.
4. **Supplier pays us**: add a "Supplier Payment Received" action in the supplier detail. Operator selects payment method → related drawer is credited → supplier balance is reduced (or goes further negative). Mirrors a settlement but in the opposite direction.
5. **Focused pay/receive actions via MultiPaymentInput + pay-back-anytime**: today the Manual Entry tab uses raw USD/LBP fields and a "Withdraw from `<provider>` drawer" checkbox — which wrongly withdraws from the **provider's own drawer** (e.g. "Katsh"), not the cash you actually pay with. The generic Manual Entry tab is being **removed** (see **LIRA-074**); replace it with focused **Pay Supplier** / **Supplier Paid Us** actions that use **`MultiPaymentInput`** (as the settlement modal already does) so the operator pays/receives with any payment method and the **correct drawer** is debited/credited. This also solves "I did a top-up, 0 pending transactions, how do I pay the supplier back?" — paying down a positive balance no longer requires pending transactions to settle. (Pairs with **LIRA-061**, which fixes how SEND-provider debt is recorded/settled.)
6. **Companies / Products tabs**: add a tab bar under the "Suppliers" page title with two tabs — **Companies** (selected by default) and **Products**. **Companies** = the current system/financial suppliers (iPick, Katsh, OMT, OMT App, Whish App, Loto Liban). **Products** = the records from the **Product Suppliers** table (Settings → Categories & Suppliers), surfaced read-side here.

### Context

- `create_db.sql` line 928: `('Katch', 'ipec_katch', 'Katsh', 1)` — name is "Katch", should be "Katsh"
- `PROVIDER_DRAWER` map (`frontend/src/features/suppliers/pages/Suppliers/index.tsx` line 71): missing `LOTO: "Loto"`
- Supplier balance = sum of TOP_UP entries minus sum of PAYMENT/SETTLEMENT entries. Currently the UI may not handle or display a negative result clearly
- "Supplier pays us" = new entry type (e.g., `SUPPLIER_PAYS_US`) or reuse `ADJUSTMENT` with a sign — creates a drawer credit and reduces supplier balance

### Acceptance Criteria

- [x] Migration: UPDATE `suppliers SET name = 'Katsh' WHERE name = 'Katch'`; `create_db.sql` updated to seed "Katsh" — **done v1.24.0 (v96)**
- [x] Loto Liban shows its drawer name ("Loto") on the right side of the supplier list — **done v1.24.0**
- [x] Settling with an amount greater than owed creates a negative balance (credit)
- [x] Negative balance displayed in green with clear label (e.g., "They owe you $20.00")
- [x] Positive balance displayed in red with label "You owe $50.00"
- [x] "Supplier Payment Received" button in supplier detail — operator enters amount + selects payment method
- [x] On confirm: correct drawer credited, supplier ledger entry created, balance updated
- [x] **Manual Entry tab replaced with Pay/Receive UI** — PAY SUPPLIER / SUPPLIER PAID US toggle + `MultiPaymentInput`; PAYMENT debits the **payment-method drawer**, not the provider's own drawer
- [x] Paying down a positive supplier balance works with **zero pending transactions** to settle
- [x] **Companies / Products tabs** under the page title; Companies default = is_system=1 suppliers; Products = is_system=0 product vendors
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                          | Change                                                                                     |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Database | `packages/core/src/db/migrations/index.ts`                    | ~~Migration: rename Katch→Katsh~~ done (v96)                                               |
| Database | `electron-app/create_db.sql`                                  | ~~Fix seed name "Katch"→"Katsh"~~ done                                                     |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`   | Bidirectional balance display; Companies/Products tabs; Manual Entry → `MultiPaymentInput` |
| Backend  | `packages/core/src/repositories/SupplierRepository.ts`        | "Supplier pays us" entry type + drawer credit; pay-down without pending txns               |
| Electron | `electron-app/handlers/supplierHandlers.ts`                   | New IPC handler for supplier-pays-us / pay-down action                                     |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`   | "Supplier Payment Received" UI; MultiPaymentInput in Manual Entry                          |
| Backend  | `packages/core/src/repositories/ProductSupplierRepository.ts` | Read API for Products tab (reuse existing if present)                                      |

> **Depends on / pairs with:** LIRA-061 (SEND-provider debt recording) — the Manual Entry pay-down and bidirectional balance assume the ledger correctly separates manual top-ups from sale costs.

### Post-implementation fixes (implemented with LIRA-065)

Several follow-up improvements shipped alongside LIRA-065:

- **Negative-balance color fix** — Total Owed cards now show green for negative (supplier owes you) instead of always red.
- **Tab bar moved** inside the top of the left panel (was at the page-level title).
- **Loto Liban `is_system` fix** — seeded without `is_system = 1` so it appeared under Products instead of Companies. Fixed original migration INSERT; **migration v107** (`UPDATE suppliers SET is_system = 1 WHERE provider = 'LOTO'`) for existing DBs; `create_db.sql` updated.
- **Products tab connected to inventory (migration v108)** — `product_suppliers` gained a `supplier_id` FK to `suppliers`; v108 backfills all existing rows. `ProductSupplierRepository.create()`/`getOrCreate()` now atomically create the linked `suppliers` row. New `getProductItems(supplierId)` + `getProductSupplierBalances()`. Two new IPC channels: `suppliers:product-balances` + `suppliers:product-items`. Products tab detail panel: **Items** tab (product table with per-row totals) + **Pay / Receive** tab (same cashflow form as Companies, pre-fills owed amount).
- **Settle Transactions currency fixes** — amount/commission columns format dynamically (LBP vs USD) based on the transaction's `currency` field; OMT Fee column hidden when no row has a non-zero fee (gone for Katsh/iPick); `settleTotalOwedLbp`/`settleNetPayLbp` added to inline summary and confirmation modal; `handleSettle` previously hardcoded `amount_lbp: 0` — now passes the correct LBP net; settlement modal `MultiPaymentInput` pre-fills LBP amount and switches currency automatically for LBP-only transactions.

---

## LIRA-060: SERVICES — Hold Money

| Field                | Value                                   |
| -------------------- | --------------------------------------- |
| **Epic**             | Services                                |
| **Type**             | Feature                                 |
| **Priority**         | Medium                                  |
| **Status**           | DONE (validated 2026-07-19 — was stale) |
| **Affected Modules** | Services, Dashboard                     |
| **Assigned To**      | —                                       |
| **Depends On**       | —                                       |

### Summary

Add a "Hold Money" category to the Services page. The operator can hold cash (USD and/or LBP) for a named client; the held amount goes into the General drawer. When the client returns, the operator clicks "Collect" — cash goes out of General drawer and the hold is marked as collected. The Dashboard shows one notification card per active hold.

### Context

- Lives inside the existing Services page as a new preset category (e.g., category name: "Hold Money")
- Seeded preset: name "Hold Money", cost = 0, price = 0, plus two new amount fields (USD held, LBP held) and a client name field
- The preset is cash-only — no payment method selector needed; always hits the General drawer
- Dashboard: active holds are surfaced as notification cards (one per hold). When no holds exist, no notification is shown
- Releasing a hold = cash out of General drawer + marks the hold record as `collected`

### Acceptance Criteria

- [ ] New "Hold Money" category seeded in custom services (or equivalent Services preset table)
- [ ] Preset form shows: Client Name (text), USD Amount (optional), LBP Amount (optional) — at least one amount required
- [ ] On submit: USD amount credited to General drawer (USD), LBP amount credited to General drawer (LBP), hold record created with status `held`
- [ ] Services page lists active holds under the "Hold Money" category with client name and amounts
- [ ] "Collect" button on each active hold: marks status as `collected`, debits General drawer for the held amounts (cash out), creates a collection transaction
- [ ] Dashboard: one card per active hold showing client name + held amounts; cards disappear when collected
- [ ] Collected holds visible in transaction/audit history
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                      | Change                                                                                                                  |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                | Migration v96: `hold_money` table (id, client_name, usd_amount, lbp_amount, status, created_by, created_at, updated_at) |
| Database | `electron-app/create_db.sql`                              | Add `hold_money` table + seed "Hold Money" preset/category                                                              |
| Backend  | `packages/core/src/repositories/HoldMoneyRepository.ts`   | create, list active, collect                                                                                            |
| Backend  | `packages/core/src/services/HoldMoneyService.ts`          | Business logic: validate, drawer credit on hold, drawer debit on collect                                                |
| Electron | `electron-app/handlers/holdMoneyHandlers.ts`              | IPC handlers: create, list, collect                                                                                     |
| Frontend | `frontend/src/features/services/pages/Services/index.tsx` | "Hold Money" section with form + active holds list + Collect button                                                     |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx`     | Notification cards for active holds                                                                                     |

---

## LIRA-061: BUG — iPick/Katsh/Whish App/OMT App Sales Recorded as TOP_UP, Not Settleable

| Field                | Value                                   |
| -------------------- | --------------------------------------- |
| **Epic**             | Supplier System                         |
| **Type**             | Bug                                     |
| **Priority**         | High                                    |
| **Status**           | DONE                                    |
| **Affected Modules** | Suppliers, Financial Services, Recharge |
| **Assigned To**      | —                                       |
| **Depends On**       | —                                       |
| **Blocks**           | LIRA-062                                |

### Summary

Creating a **sale** through a cost/price provider (Katsh observed; same path for iPick, and the SEND side of Whish App / OMT App) auto-writes a `TOP_UP` entry into the supplier ledger instead of surfacing as a settleable transaction. Result: the ledger shows `TOP_UP +924,150 — Auto: SEND via Katsh`, the owed balance inflates, and the Settle Transactions tab shows "No pending transactions to settle for Katsh" — so a sale can't be reconciled per-transaction and is indistinguishable from a manual top-up.

### Root Cause (grounded)

- `FinancialServiceRepository.ts` ~L1585-1595: in the cost/price flow, **any non-RECEIVE** service type books `entry_type: "TOP_UP"` with `ledgerAmount = cost`. A sale (SEND) is therefore written identically to a manual supplier top-up.
- `getUnsettledBySupplier()` ~L1722-1729: **only RECEIVE rows** with `commission > 0` and `is_settled = 0` are returned. SEND/cost-flow sales never qualify → never appear in the Settle tab.

### Acceptance Criteria

- [x] Katsh/iPick (and Whish App / OMT App SEND) sales appear in **transaction history** and are reconcilable — not as generic "TOP_UP" ledger rows
- [x] Ledger clearly **distinguishes** a manual supplier top-up from a sale-cost consumed from balance — new `SALE_COST` entry type/label (migration v99)
- [x] A decision is implemented for **how SEND-provider debt is settled** — per-transaction settle list (getUnsettledBySupplier UNION branch) + cumulative-balance pay-down; guard is `settlement_id IS NULL`
- [x] Owed balance stays mathematically correct after the relabel (no double counting) — SALE_COST same positive sign as TOP_UP; SETTLEMENT nets it to zero
- [x] Tests: Katsh SEND sale ledger effect, iPick SEND, the settle/pay-down path (FinancialServiceRepository.saleCost.test.ts + e2e)
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                           | Change                                                                           |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts` | Fix ledger entry-type for cost-flow SEND sales; revisit `getUnsettledBySupplier` |
| Backend  | `packages/core/src/repositories/SupplierRepository.ts`         | Entry-type / settlement model for SEND-provider debt                             |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`    | Surface sales correctly (settle list vs balance pay-down)                        |
| Backend  | `packages/core/src/repositories/__tests__/`                    | New tests for sale → ledger effect + settlement                                  |

---

## LIRA-062: iPick / Katsh — Bills Section

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Bills / Recharge                   |
| **Type**             | Feature                            |
| **Priority**         | Medium                             |
| **Status**           | DONE                               |
| **Affected Modules** | Recharge > iPick, Katsh; Suppliers |
| **Assigned To**      | —                                  |
| **Depends On**       | LIRA-061                           |

### Summary

Add a simple **Bills** section inside the existing iPick & Katsh recharge screens. The operator enters a single **bill amount** and uses the same bottom **"Proceed to Pay"** button — no item catalog.

### Drawer / Ledger Mechanics (confirmed)

The bill amount is entered in **one currency**, chosen via a **USD/LBP toggle** (same single-currency pattern as the Maintenance page — `useState<"USD" | "LBP">`, the unselected currency stays zeroed). For a bill of `X` in the selected currency:

- Customer pays the bill amount in **cash** → **General drawer (selected currency) + X**
- The bill amount is treated as **cost** → **provider drawer (Katsh/iPick app balance) − X** (same currency)
- The shop earns a **hardcoded 20,000 LBP commission per bill**, regardless of bill amount or currency, paid by the supplier → **supplier owes shop + 20,000 LBP** (supplier-ledger credit, shown green on the Suppliers page)

### Acceptance Criteria

- [ ] New "Bills" section/tab in the iPick **and** Katsh recharge screens; single amount input + **USD/LBP toggle**; uses existing Proceed to Pay
- [ ] Bill amount is single-currency (toggle picks USD **or** LBP, mirroring the Maintenance page)
- [ ] On confirm: General **+X** (cash in, selected currency), provider drawer **−X** (cost out, selected currency), supplier-owes-shop **+20,000 LBP**
- [ ] Commission is **hardcoded at 20,000 LBP per bill** — always LBP, independent of bill currency/amount
- [ ] Bill shows in transaction history with correct in/out
- [ ] Suppliers page shows the 20,000 LBP commission as supplier→shop (green / credit)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                | Change                                                                                         |
| -------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts` (or FSR)     | `processBill()` — drawer (selected currency) + supplier-ledger (20,000 LBP commission) effects |
| Electron | `electron-app/schemas/index.ts` / `handlers/rechargeHandlers.ts`    | Zod schema (amount + currency) + IPC handler                                                   |
| Electron | `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`       | Binding + type                                                                                 |
| Frontend | `frontend/src/features/recharge/components/KatchForm.tsx` (+ iPick) | Bills sub-section with USD/LBP toggle (mirror `Maintenance/index.tsx` L110-111)                |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`           | Wire bill confirm into Proceed to Pay                                                          |

> **Note:** commission is hardcoded (no setting/migration needed). If a bill needs to be a persisted record (vs. a plain transaction), add it during implementation.

---

## LIRA-063: Whish App + OMT App — Make Client Name / Phone Optional

| Field                | Value                         |
| -------------------- | ----------------------------- |
| **Epic**             | Whish / OMT App UX            |
| **Type**             | UX                            |
| **Priority**         | Low                           |
| **Status**           | DONE                          |
| **Affected Modules** | Recharge > OMT App, Whish App |
| **Assigned To**      | —                             |
| **Depends On**       | —                             |

### Summary

In the shared OMT App / Whish App transfer form, the SEND/RECEIVE buttons are disabled until **both** name and phone are filled (`OmtWhishAppTransferForm.tsx` L674-683). Make name & phone **optional** for both providers; still persist them when provided.

### Acceptance Criteria

- [x] SEND/RECEIVE can proceed with empty name/phone (amount-only validation remains)
- [x] Applies to **both** OMT App and Whish App (gating keyed on `serviceType`, not provider — both covered)
- [x] When provided, name/phone are still saved (`handleSubmit` trims + passes `clientName`/`phoneNumber` unchanged; client propagation untouched)
- [x] Typecheck and lint pass (frontend typecheck clean; lint 0 errors)

### Files Modified

| Layer    | File                                                                    | Change                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` | Removed the SEND and RECEIVE name/phone alert-gating blocks in the Proceed-to-Pay handler; only the amount check remains (button `disabled` was already amount-only) |

---

## LIRA-064: Transactions Table — Structured In/Out Payment Breakdown in Summary

| Field                | Value                      |
| -------------------- | -------------------------- |
| **Epic**             | Transaction Visibility     |
| **Type**             | Feature                    |
| **Priority**         | Medium                     |
| **Status**           | DONE                       |
| **Affected Modules** | Audit > TransactionsViewer |
| **Assigned To**      | —                          |
| **Depends On**       | — (builds on LIRA-054)     |

### Summary

Beyond the directional arrow badges (LIRA-054), surface the actual **payment legs** per transaction — what the customer paid (**in**) and what the shop returned (**out**), with currencies. e.g. `in: $50 + 100,000 LBP · out: 20,000 LBP`.

### Design Constraints (per user)

- The backend returns a **structured** payment-info field on each transaction row (join the payments table) — a clear `payments` / in+out legs array with currency. **Do NOT** bake payment text into the stored `summary` string.
- The frontend reads the structured field and renders it **appended in the summary column** (joined client-side, not persisted).
- Structure it so we can later switch to an **expandable detail row** with no data changes.

### Acceptance Criteria

- [x] Unified transaction query returns structured in/out payment legs per row (stored `summary` text unchanged)
- [x] TransactionsViewer summary column renders in/out legs with currencies, joined client-side
- [x] Data shape supports a future expandable-row view without backend changes (`TransactionPaymentLeg[]` with direction/amount/signed_amount/currency_code/method)
- [x] Scope: **TransactionsViewer only** for now
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                          | Change                                             |
| -------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Backend  | `packages/core/src/repositories/TransactionRepository.ts`     | Join payments → structured in/out legs on each row |
| Electron | `electron-app/preload.ts`, `frontend/src/types/electron.d.ts` | Surface the structured field                       |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx`    | Render in/out legs in the summary column           |

---

## Summary (Sprint 2 — LIRA-056..064)

| Priority  | Total | Done  | Remaining |
| --------- | ----- | ----- | --------- |
| High      | 3     | 3     | 0         |
| Medium    | 5     | 4     | 1         |
| Low       | 1     | 1     | 0         |
| **Total** | **9** | **8** | **1**     |

> Recounted 2026-07-19: only LIRA-058 (OMT App top-up — needs owner interview)
> remains open in Sprint 2.

### Sprint 2 board

| ID       | Title                                                  | Priority | Status          |
| -------- | ------------------------------------------------------ | -------- | --------------- |
| LIRA-056 | KATSH/iPick — remove "From Drawer" + tests             | Medium   | DONE            |
| LIRA-057 | Whish App — Via Partner / From Client top-up           | High     | DONE            |
| LIRA-058 | OMT App — top-up flow design                           | Medium   | NEEDS INTERVIEW |
| LIRA-059 | Suppliers — balance, pay-back, Companies/Products tabs | High     | DONE            |
| LIRA-060 | Services — Hold Money                                  | Medium   | DONE            |
| LIRA-061 | BUG — sales mislabeled as TOP_UP, not settleable       | High     | DONE            |
| LIRA-062 | iPick/Katsh — Bills section                            | Medium   | DONE            |
| LIRA-063 | Whish/OMT App — optional name/phone                    | Low      | DONE            |
| LIRA-064 | Transactions — structured in/out breakdown             | Medium   | DONE            |

> **E2E coverage (2026-06-20):** every DONE Sprint-2 ticket now has a dedicated money-invariant e2e —
> `lira-056/057/059/061/063/064` (plan: `docs/plans/done_plans/sprint2-e2e-coverage.md`). Details in the
> **POST-REVIEW FOLLOW-UPS (2026-06-20)** section near the top.

---

---
