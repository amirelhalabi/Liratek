# LiraTek POS — Current Sprint

> **Sprint Focus:** UI Consistency, Binance Fixes, Whish App UX, Transaction Enrichment & Session Checkout
> **Created:** 2026-06-07
> **Last Updated:** 2026-06-08 (post-sprint follow-up)
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## LIRA-048: Exchange Page — Show Dual USD/LBP Output Fields

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | UI Consistency                           |
| **Type**             | Feature / UX                             |
| **Priority**         | High                                     |
| **Status**           | DONE                                     |
| **Affected Modules** | Exchange                                 |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

### Summary

Currently the Exchange page shows a single "Customer Gets" field displaying the converted amount in the target currency. Replace this with two always-visible output fields — **USD** and **LBP** — mirroring the dual-currency display pattern used in the POS Checkpoint Modal.

### Context

The POS Checkpoint Modal already has a proven dual-field layout where both USD and LBP amounts are shown simultaneously. The Exchange page should adopt the same pattern for output so the operator always sees both representations regardless of the exchange direction.

### Acceptance Criteria

- [x] Remove single "customer gets (to currency)" output field
- [x] Always show two output fields: USD and LBP
- [x] Field values computed using the current exchange rate (same logic as before, just surfaced in both currencies)
- [x] Layout matches the dual-field style from POS Checkpoint Modal
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                           | Change                                          |
| -------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Frontend | `frontend/src/features/exchange/pages/Exchange/index.tsx`      | Replace single output field with USD + LBP pair |
| Frontend | Any exchange-related components showing the "customer gets" UI | Same dual-field replacement                     |

---

## LIRA-049: Recharge — Dual USD/LBP Fields + Payment Method Dropdown

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | UI Consistency                           |
| **Type**             | Feature / UX                             |
| **Priority**         | High                                     |
| **Status**           | DONE                                     |
| **Affected Modules** | Mobile Recharge (all forms)              |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

### Summary

Replace the current payment display in Recharge forms with:
1. **Dual USD/LBP fields** — same appearance and functionality as in the POS Checkpoint Modal
2. **Payment method dropdown** — lets the operator change the payment method when needed (instead of it being fixed)

### Context

Currently Recharge forms show amounts in a fixed way. The POS Checkpoint Modal has a well-designed dual-currency input/display pattern. Recharge should adopt this same pattern so operators can see USD and LBP simultaneously and switch payment method inline without extra steps.

### Acceptance Criteria

- [x] Recharge forms show two amount fields: USD and LBP (matching POS Checkpoint Modal style)
- [x] A payment method dropdown is added, allowing the operator to change the method if needed
- [x] Dropdown uses the same payment methods available in the current system
- [x] USD/LBP field interaction (editing one auto-calculates the other via exchange rate) mirrors POS Checkout Modal behavior
- [x] TelecomForm: dual LBP/USD price fields + payment method dropdown (MTC/Alfa)
- [x] FinancialForm: USD equivalent shown below LBP total in sticky bar (OMT/Whish Bills/iPick)
- [x] KatchForm: USD equivalent shown below LBP total in sticky bar (Katsh/iPick)
- [x] CryptoForm: LBP equivalent shown below USD total in sticky bar + payment method dropdown (Binance)
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                  | Change                                                          |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Frontend | `frontend/src/features/recharge/components/TelecomForm.tsx`           | Dual LBP/USD price fields + payment method dropdown ✓           |
| Frontend | `frontend/src/features/recharge/components/FinancialForm.tsx`         | USD equivalent in sticky bar ✓                                  |
| Frontend | `frontend/src/features/recharge/components/CryptoForm.tsx`            | LBP equivalent in sticky bar + payment method dropdown ✓        |
| Frontend | `frontend/src/features/recharge/components/KatchForm.tsx`             | USD equivalent in sticky bar ✓                                  |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`             | Propagate changes ✓                                             |

---

## LIRA-050: Mobile Recharge — Fix Layout (Proceed to Pay Position + Scrollable Grid)

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | UI Layout                          |
| **Type**             | Bug / UX                           |
| **Priority**         | Medium                             |
| **Status**           | DONE                               |
| **Affected Modules** | Mobile Recharge                    |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Two layout issues in the Mobile Recharge page:

1. **"Proceed to Pay" button/section** should be repositioned to the **top right**, aligned with the search bar, and its position should be fixed (not scroll away).
2. **Only the recharge items grid** should be scrollable — the rest of the page (header, search bar, proceed-to-pay) stays fixed.

### Acceptance Criteria

- [x] "Proceed to Pay" section is anchored to the top right, next to the search bar
- [x] "Proceed to Pay" does not scroll out of view
- [x] The recharge items grid scrolls independently within its container
- [x] No layout regressions on other parts of the page

### Files to Modify

| Layer    | File                                                                  | Change                                      |
| -------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`             | Restructure layout for fixed top-right CTA  |
| Frontend | Any recharge sub-components that own the grid/proceed section         | Adjust scroll container and position        |

---

## LIRA-051: Partners Page — Simplify Record Transaction Types

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Partner System                     |
| **Type**             | Cleanup / UX                       |
| **Priority**         | Medium                             |
| **Status**           | DONE                               |
| **Affected Modules** | Partners                           |
| **Assigned To**      | —                                  |
| **Depends On**       | LIRA-047 (DONE)                    |

### Summary

Audit the "Record Transaction" dialog/modal on the Partners page. The transaction type options may be overly verbose or inconsistent after LIRA-047 added `THROUGH_*` / `FOR_*` prefixed types alongside legacy types. Simplify the type list so it is clean, readable, and reflects current business terminology.

### Context

After LIRA-047, the `partner_ledger.transaction_type` field has accumulated several formats: legacy plain types, `THROUGH_*` prefixed types, and `FOR_*` prefixed types. The UI dropdown for recording transactions should present these in a clear, consistent way — removing or consolidating anything confusing.

### Acceptance Criteria

- [x] Review all `transaction_type` values currently shown in "Record Transaction" dropdown
- [x] Remove or relabel redundant/legacy entries — THROUGH_*/FOR_* removed (auto-written by FSR, not for manual entry)
- [x] Group or order types logically into optgroups: General, OMT, Whish, Other
- [x] TypeScript types updated — `PartnerTransactionType` union added, covers all historical DB values for display
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                        | Change                                          |
| -------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Frontend | `frontend/src/features/partners/pages/Partners/index.tsx`                   | Simplify type dropdown in Record Transaction UI |
| Frontend | `frontend/src/features/partners/components/` (any relevant sub-components)  | Update type labels/options                      |
| Types    | `frontend/src/types/electron.d.ts`                                          | Remove obsolete transaction type values if any  |

---

## LIRA-052: Binance — Fix SEND Drawer Logic (Cash Drawer Not Credited, Amount Goes to Wrong Place)

| Field                | Value                                          |
| -------------------- | ---------------------------------------------- |
| **Epic**             | Binance / Financial Services                   |
| **Type**             | Bug                                            |
| **Priority**         | High                                           |
| **Status**           | DONE                                           |
| **Affected Modules** | Mobile Recharge > Binance, Drawers, Checkpoint |
| **Assigned To**      | —                                              |
| **Depends On**       | —                                              |

### Summary

Multiple bugs in the Binance SEND transaction flow:

1. Sending $102 **adds 2 USDT to the General drawer** instead of crediting the Cash drawer with $102.
2. The **Cash drawer is not affected at all** — it should be credited with the full $102 paid by the customer.
3. The **Binance drawer is being checkpointed in USD ($500)** instead of in USDT — the Binance drawer should track USDT balances.
4. The **fee is incorrectly routed to the General drawer**, and the send amount is not credited anywhere.

### Root Cause Investigation Areas

- `FinancialServiceRepository.ts` — Binance SEND drawer logic: which drawer is debited/credited, how fee and amount are split
- Binance drawer currency: confirm drawer is set up as USDT, not USD
- `create_db.sql` / migrations: verify Binance drawer currency_code is `USDT`
- Checkpoint: verify Binance drawer reads/writes USDT amounts, not USD

### Expected Behavior (Binance SEND — customer sends $102 to Binance)

| Event            | Drawer Effect                                       |
| ---------------- | --------------------------------------------------- |
| Customer pays    | Cash (General) drawer +$102                         |
| Binance deducted | Binance drawer (USDT) -100 USDT (amount sent)       |
| Fee kept         | Shop profit — no separate drawer entry for fee      |

*(Exact fee/amount split to be confirmed during investigation)*

### Acceptance Criteria

- [x] Binance SEND with cash payment: Cash/General drawer is credited with the amount paid by customer
- [x] Binance drawer tracks USDT (not USD) and is correctly debited on SEND
- [x] Fee does not appear as a spurious entry in General drawer (implicit in cash-in vs crypto-out spread)
- [x] Migration v93: remaps Binance drawer currency_code USD→USDT, merges stale balances, updates create_db.sql
- [x] RECEIVE logic fixed: Binance drawer credited in USDT, General drawer debited in USD (amount−fee)
- [x] `FinancialServiceRepository.binance.test.ts` added (12 tests covering SEND/RECEIVE/CUSTOMER_ACCOUNT)
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                  | Change                                                      |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts`        | Fix Binance SEND drawer credit/debit routing                |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`                | Review if Binance logic lives here instead                  |
| Database | `packages/core/src/db/migrations/index.ts`                            | Fix Binance drawer currency if needed                       |
| Database | `electron-app/create_db.sql`                                          | Sync schema fix                                             |
| Frontend | `frontend/src/features/recharge/components/CryptoForm.tsx`            | Verify correct fields passed for SEND                       |

---

## LIRA-053: Whish App — Flip Toggle Order (Bills/Transactions) + Flip Audit/Transactions Tab Order

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Whish App UX                       |
| **Type**             | UX / Polish                        |
| **Priority**         | Low                                |
| **Status**           | DONE                               |
| **Affected Modules** | Whish App                          |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Two ordering changes in the Whish App UI:

1. **Bills / Transactions toggle** — flip the order so Transactions comes before Bills (or vice versa — confirm desired order with user).
2. **Audit and Transactions page tab order** — flip so the preferred tab appears first.

### Acceptance Criteria

- [x] Bills/Transactions toggle order is flipped (Transfer now first)
- [x] Audit/Transactions page tab order is flipped (Transactions now first)
- [x] Whish App tab now defaults to Transfer on navigation (not Bills)
- [x] No functional regressions — toggling and tab switching still work correctly
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                  | Change                                    |
| -------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Frontend | Whish App toggle/tab component (locate in `frontend/src/features/`)   | Flip render order of toggle items         |
| Frontend | Audit/Transactions page component                                     | Flip tab order                            |

---

## LIRA-054: Transaction Table — Add In/Out Amounts to Summary Description

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Transaction Visibility             |
| **Type**             | Feature / UX                       |
| **Priority**         | Medium                             |
| **Status**           | DONE                               |
| **Affected Modules** | All transaction tables             |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Each transaction row in transaction tables has a summary/description column. Enrich this description to include the **in** and **out** amounts for each transaction, so the operator can quickly see cash flow direction and magnitude without opening the transaction detail.

### Context

Currently transaction descriptions may only show type/label. Adding `IN: $X` / `OUT: $Y` (or equivalent) directly in the description text makes scanning the table faster and reduces the need to drill into individual records.

### Acceptance Criteria

- [x] Each transaction row summary includes directional arrow badges (↑ in / ↓ out)
- [x] Consistent emerald/red color coding across all tables
- [x] Applied to 7 tables: TransactionsViewer, Expenses, Maintenance, CustomServices, Recharge history, Services (OMT/Whish), Loto checkpoint history
- [x] No performance regression — amounts already present in query results
- [x] Typecheck and lint pass
- [ ] **Follow-up:** BINANCE rows in TransactionsViewer show no directional badge — needs `service_type` on unified transaction row (backend join)

### Files to Modify

| Layer    | File                                                                  | Change                                                  |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Frontend | Transaction table component(s) across all modules                     | Append in/out amounts to description/summary cell       |
| Backend  | Relevant repository `getAll` / `list` queries (if amounts not present) | Ensure in/out amounts are included in query response    |

---

## LIRA-055: Customer Session Checkout Modal — Add MultiPaymentInput Component

| Field                | Value                                           |
| -------------------- | ----------------------------------------------- |
| **Epic**             | Customer Sessions                               |
| **Type**             | Feature                                         |
| **Priority**         | High                                            |
| **Status**           | DONE                                            |
| **Affected Modules** | POS > Customer Sessions > Checkout Modal        |
| **Assigned To**      | —                                               |
| **Depends On**       | —                                               |

### Summary

The Customer Session Checkout Modal currently uses a simpler payment input. Replace/augment it with the existing **`MultiPaymentInput`** component and its full functionality — matching the multi-payment capability available in other checkout contexts (split payments, USD + LBP, CUSTOMER_ACCOUNT auto-select, etc.).

### Context

`MultiPaymentInput` (`packages/ui/src/components/ui/MultiPaymentInput.tsx`) is already used in other checkout flows and supports:
- Multiple simultaneous payment methods
- USD + LBP split
- CUSTOMER_ACCOUNT auto-selection when a client is in session
- Dynamic total validation

The Customer Session Checkout Modal should have the same richness instead of a reduced version.

### Acceptance Criteria

- [x] Checkout Modal renders `MultiPaymentInput` in place of the existing bulk payment selector
- [x] All `MultiPaymentInput` features work inside the modal (split payment, USD/LBP, CUSTOMER_ACCOUNT)
- [x] CUSTOMER_ACCOUNT auto-selects when session has a named client
- [x] Separate MultiPaymentInput instances for USD and LBP totals; USDT shown as read-only display
- [x] Payment legs now passed in checkout IPC call (previously always sent as empty array)
- [x] Modal layout accommodates the wider component without overflow
- [x] Payment totals validate correctly before confirming checkout
- [x] Typecheck and lint pass
- [ ] **Follow-up:** Voucher support at checkout requires `client_id` on session (currently only `customer_name`/`customer_phone` stored)

### Files to Modify

| Layer    | File                                                                          | Change                                                     |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Frontend | Customer Session Checkout Modal component (locate in `frontend/src/features/`) | Replace simple payment input with `MultiPaymentInput`      |
| Frontend | `packages/ui/src/components/ui/MultiPaymentInput.tsx`                         | Any props adjustments needed for modal context             |
| Types    | `frontend/src/types/electron.d.ts`                                            | Update if checkout payload shape changes                   |

---

## Summary (Sprint 1 — LIRA-048..055)

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| High      | 4      | 4     | 0         |
| Medium    | 2      | 2     | 0         |
| Low       | 1      | 1     | 0         |
| Bug       | 1      | 1     | 0         |
| **Total** | **8**  | **8** | **0**     |

---

## Open Follow-ups (Post-Sprint 1)

| ID | Description | Priority |
|----|-------------|----------|
| LIRA-054-FU | BINANCE rows in TransactionsViewer missing directional badge — needs `service_type` joined onto unified transaction row | Low |
| LIRA-055-FU | Voucher support at session checkout requires `client_id` stored on session (currently only name/phone) | Low |

---
---

# Sprint 2 — Topup Flows, Supplier Improvements & Hold Money

> **Sprint Focus:** Topup modal UX fixes, Whish App partner/client topup, supplier balance improvements, hold money service
> **Created:** 2026-06-14
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

---

## LIRA-056: KATSH / iPick — Remove "From Drawer" from Topup Modal + Settlement E2E Test

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | Topup UX                                 |
| **Type**             | Bug / UX + Test                          |
| **Priority**         | Medium                                   |
| **Status**           | DONE                                     |
| **Affected Modules** | Recharge > Katsh, iPick                  |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

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

| Layer    | File                                                                              | Change                                                                  |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`                           | Added `topUpFromSupplier()` method                                      |
| Backend  | `packages/core/src/services/RechargeService.ts`                                  | Added `topUpFromSupplier()` service method                              |
| Backend  | `packages/core/src/repositories/__tests__/SupplierRepository.settlement.test.ts` | 7 new tests for topUpFromSupplier + supplier settlement                 |
| Electron | `electron-app/schemas/index.ts`                                                   | Added `TopUpFromSupplierSchema`                                         |
| Electron | `electron-app/handlers/rechargeHandlers.ts`                                       | Added `recharge:top-up-from-supplier` IPC handler                       |
| Electron | `electron-app/preload.ts`                                                         | Added `topUpFromSupplier` binding                                       |
| Types    | `frontend/src/types/electron.d.ts`                                                | Added `topUpFromSupplier` type                                          |
| Frontend | `packages/ui/src/components/ui/TopUpModal.tsx`                                    | `isSupplierCredit` flag hides drawer UI; shows supplier banner          |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`                        | Added `handleTopUpConfirmSupplier`; passes `onConfirmSupplier` to modal |

---

## LIRA-057: WHISH APP — Topup Via Partner / From Client Sub-Modes

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| **Epic**             | Whish App Topup                               |
| **Type**             | Feature                                       |
| **Priority**         | High                                          |
| **Status**           | DONE                                          |
| **Affected Modules** | Recharge > Whish App, Partners                |
| **Assigned To**      | —                                             |
| **Depends On**       | —                                             |

### Summary

The existing Whish App topup button opens the generic `TopUpModal` with a "from drawer" flow — which does not match either real-world topup scenario. Replaced it with two sub-modes:

- **Via Partner**: a partner credits your Whish App balance now; you owe them and pay later via settle. Records a `partner_ledger` CREDIT entry (we owe partner) + increases Whish_App drawer. No cash drawer touched.
- **From Client**: a client transfers Whish credits to the shop; shop pays the client cash. Mirrors the existing MTC/Alfa `topUpFromCustomer` flow (credits in / cash out) with a RECEIVE-style fee UI: Whish_App **+amount**, General **−(amount − fee)**, profit = fee. Fee field has 1% USD auto-default; "fee included" checkbox unchecked by default.

### Implementation Note (correction during build)

Initial assumption was "From Client" === Whish App RECEIVE. Tracing the code showed RECEIVE *decreases* the system drawer (provider owes shop) — the wrong direction. "From Client" is credits-in / cash-out, structurally identical to the existing MTC/Alfa `topUpFromCustomer`. Implemented as a dedicated `topUpFromClient` repo method (Whish_App +amount, General −cashPaid, profit booked = amount − cashPaid).

### Acceptance Criteria

- [x] TopUpModal for WHISH_APP shows two sub-mode buttons: "Via Partner" / "From Client"; old drawer/external UI hidden for WHISH_APP
- [x] **Via Partner**: `PartnerSelector` shown; on confirm → `RechargeRepository.topUpFromPartner` creates `partner_ledger` CREDIT (`WHISH_TOPUP`) entry + Whish_App drawer +amount; no cash drawer affected; visible in Partners ledger
- [x] **From Client**: amount (USD/LBP) + fee field (1% USD auto-default, manual override) + "fee included" checkbox (unchecked default) + optional client name; on confirm → `topUpFromClient`: Whish_App +amount, General −(amount−fee), profit = fee
- [x] New IPC: `recharge:top-up-from-partner`, `recharge:top-up-from-client` (Zod-validated, requireRole) + preload bindings + `electron.d.ts` types
- [x] `'WHISH_TOPUP'` added to `partner_ledger` transaction_type union
- [x] Tests: 5 new `RechargeRepository.topup.test.ts` (partner CREDIT + no-drawer, unknown-partner guard, client credits-in/cash-out, insufficient-balance guard, LBP path) — all pass
- [x] Full validation: packages/core 343/343, @liratek/backend 384/384, frontend 209 passed/1 skipped, typecheck + lint clean for changed files

### Files Modified

| Layer    | File                                                                              | Change                                                                  |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`                           | Added `topUpFromPartner` + `topUpFromClient`                            |
| Backend  | `packages/core/src/services/RechargeService.ts`                                  | Added service delegates                                                 |
| Backend  | `packages/core/src/repositories/PartnerRepository.ts`                            | Added `'WHISH_TOPUP'` to transaction_type union                        |
| Database | `packages/core/src/db/migrations/index.ts`                                       | **v97** — dropped `recharges.carrier CHECK(MTC/Alfa)` so all-provider top-ups can log; **v98** — added `'WHISH_TOPUP'` to `partner_ledger.transaction_type CHECK` (mirrors v83). Both recreate-table migrations validated (rows+ids+indexes preserved, new inserts succeed) |
| Database | `electron-app/create_db.sql`                                                      | `recharges.carrier TEXT NOT NULL` (no CHECK), `partner_ledger` CHECK += `WHISH_TOPUP`, v97 + v98 migration entries |
| Backend  | `packages/core/src/repositories/__tests__/RechargeRepository.topup.test.ts`      | New — 5 tests                                                           |
| Backend  | `packages/core/src/repositories/__tests__/SupplierRepository.settlement.test.ts` | Fixed `transactions` test schema (missing exchange_rate/client_phone/device_id) — unblocked LIRA-056's 7 tests |
| Electron | `electron-app/schemas/index.ts`                                                   | `TopUpFromPartnerSchema`, `TopUpFromClientSchema`                       |
| Electron | `electron-app/handlers/rechargeHandlers.ts`                                       | Two new IPC handlers                                                    |
| Electron | `electron-app/preload.ts`                                                         | `topUpFromPartner` + `topUpFromClient` bindings                        |
| Types    | `frontend/src/types/electron.d.ts`                                                | Matching IPC types                                                      |
| Frontend | `packages/ui/src/components/ui/TopUpModal.tsx`                                    | `isWhishTopUp` two-mode UI (partner picker / client fee form)           |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`                        | `handleTopUpConfirmPartner/Client`, partner state, modal wiring         |

---

## LIRA-058: OMT APP — Topup Flow Design

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | OMT App Topup                            |
| **Type**             | Feature                                  |
| **Priority**         | Medium                                   |
| **Status**           | NEEDS INTERVIEW                          |
| **Affected Modules** | Recharge > OMT App, Suppliers            |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

### Summary

OMT App topup has a nuanced dual-pool problem that needs design clarification before implementation. Blocked on interview.

### Context (partial — interview incomplete)

In OMT System there are conceptually two money pools:
- **Cash pool**: physical cash customers paid for OMT transactions → lives in the OMT System drawer
- **Owed/topup pool**: money committed/sent to OMT App — does NOT come from the cash drawer

Topping up OMT App from OMT System should:
- NOT reduce the OMT System cash drawer
- Record a transaction visible in the Suppliers page for OMT System
- Track the distinction between cash and owed money

### Acceptance Criteria

- [ ] *(To be defined after interview)*

### Notes

- Interview required to clarify: what exactly is the "owed pool", how does it appear in the supplier ledger, how does OMT pay us back, can the owed pool go negative?

---

## LIRA-059: SUPPLIERS — Display Fixes + Bidirectional Balance + Supplier Pays Us

| Field                | Value                                              |
| -------------------- | -------------------------------------------------- |
| **Epic**             | Supplier Management                                |
| **Type**             | Feature + Bug Fix                                  |
| **Priority**         | High                                               |
| **Status**           | TODO                                               |
| **Affected Modules** | Suppliers                                          |
| **Assigned To**      | —                                                  |
| **Depends On**       | —                                                  |

### Summary

Four bundled improvements to the Suppliers page:

1. **Rename "Katch" → "Katsh"**: the supplier `name` field in the DB is "Katch" but should be "Katsh" to match the drawer name. Requires a migration and `create_db.sql` fix.
2. **Wire Loto Liban drawer name**: Loto Liban shows no drawer name on the right side of the supplier list. The `PROVIDER_DRAWER` map in the frontend is missing `LOTO: "Loto"`.
3. **Bidirectional balance**: allow overpayment on settlement — the balance goes negative (supplier owes us). Show negative balance in green ("they owe you"), positive in red ("you owe them"). This already works mathematically; the display and UX need to correctly communicate the direction.
4. **Supplier pays us**: add a "Supplier Payment Received" action in the supplier detail. Operator selects payment method → related drawer is credited → supplier balance is reduced (or goes further negative). Mirrors a settlement but in the opposite direction.

### Context

- `create_db.sql` line 928: `('Katch', 'ipec_katch', 'Katsh', 1)` — name is "Katch", should be "Katsh"
- `PROVIDER_DRAWER` map (`frontend/src/features/suppliers/pages/Suppliers/index.tsx` line 71): missing `LOTO: "Loto"`
- Supplier balance = sum of TOP_UP entries minus sum of PAYMENT/SETTLEMENT entries. Currently the UI may not handle or display a negative result clearly
- "Supplier pays us" = new entry type (e.g., `SUPPLIER_PAYS_US`) or reuse `ADJUSTMENT` with a sign — creates a drawer credit and reduces supplier balance

### Acceptance Criteria

- [ ] Migration: UPDATE `suppliers SET name = 'Katsh' WHERE name = 'Katch'`; `create_db.sql` updated to seed "Katsh"
- [ ] Loto Liban shows its drawer name ("Loto") on the right side of the supplier list
- [ ] Settling with an amount greater than owed creates a negative balance (credit)
- [ ] Negative balance displayed in green with clear label (e.g., "They owe you $20.00")
- [ ] Positive balance displayed in red with label "You owe $50.00"
- [ ] "Supplier Payment Received" button in supplier detail — operator enters amount + selects payment method
- [ ] On confirm: correct drawer credited, supplier ledger entry created, balance updated
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                          | Change                                                                 |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                                    | Migration v95: rename Katch→Katsh in suppliers table                   |
| Database | `electron-app/create_db.sql`                                                  | Fix seed name "Katch"→"Katsh"                                          |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`                   | Add `LOTO: "Loto"` to `PROVIDER_DRAWER`; bidirectional balance display |
| Backend  | `packages/core/src/repositories/SupplierRepository.ts`                        | Add "supplier pays us" entry type + drawer credit logic                |
| Electron | `electron-app/handlers/supplierHandlers.ts`                                   | New IPC handler for supplier-pays-us action                            |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`                   | "Supplier Payment Received" UI in supplier detail                      |

---

## LIRA-060: SERVICES — Hold Money

| Field                | Value                                              |
| -------------------- | -------------------------------------------------- |
| **Epic**             | Services                                           |
| **Type**             | Feature                                            |
| **Priority**         | Medium                                             |
| **Status**           | TODO                                               |
| **Affected Modules** | Services, Dashboard                                |
| **Assigned To**      | —                                                  |
| **Depends On**       | —                                                  |

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

| Layer    | File                                                                          | Change                                                                       |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                                    | Migration v96: `hold_money` table (id, client_name, usd_amount, lbp_amount, status, created_by, created_at, updated_at) |
| Database | `electron-app/create_db.sql`                                                  | Add `hold_money` table + seed "Hold Money" preset/category                   |
| Backend  | `packages/core/src/repositories/HoldMoneyRepository.ts`                       | create, list active, collect                                                  |
| Backend  | `packages/core/src/services/HoldMoneyService.ts`                              | Business logic: validate, drawer credit on hold, drawer debit on collect      |
| Electron | `electron-app/handlers/holdMoneyHandlers.ts`                                  | IPC handlers: create, list, collect                                           |
| Frontend | `frontend/src/features/services/pages/Services/index.tsx`                     | "Hold Money" section with form + active holds list + Collect button           |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx`                         | Notification cards for active holds                                           |

---

## Summary (Sprint 2 — LIRA-056..060)

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| High      | 2      | 1     | 1         |
| Medium    | 3      | 1     | 2         |
| **Total** | **5**  | **2** | **3**     |
