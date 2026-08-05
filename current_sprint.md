# LiraTek POS — Current Sprint

> **IMPORTANT NOTE — add a test into the e2e file for each ticket implemented to validate the feature.**

> **Sprint Focus:** UI Consistency, Binance Fixes, Whish App UX, Transaction Enrichment & Session Checkout
> **Created:** 2026-06-07
> **Last Updated:** 2026-06-20 (Sprint-2 e2e coverage + WHISH_APP rename v105)
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## 🔍 PRE-MERGE REVIEW & FIXES (2026-06-19) — 10 findings fixed, all green

A pre-merge code review of `feat/session-basket-payment` vs `main` (multi-angle finder + adversarial
verify) surfaced 10 real findings, all now fixed. Gates: **core 379/379** (374 + 5 new), **backend
384/384**, **frontend 209**, typecheck clean, lint 0 errors, **full e2e green**.

**Blocking money-correctness (fixed):**

1. **Cashout/payout in a session was never recorded.** Hybrid fix: **Binance RECEIVE** payout
   un-deferred (`FinancialServiceRepository` — posted even in session mode); **loto prize / OMT-Whish
   RECEIVE** stay deferred and the **Session Checkout modal** now emits the net cash-OUT leg when a
   currency total is negative (`SessionCheckoutModal.tsx`), so the recorder posts the payout once.
2. **Cross-item cash bleed** + 3. **gift-card under-realization** — `backfillSaleSettlement` rewritten
   to **account-debt-to-sales-first**: `salesPaidPool = max(0, salesTotal − (debtUsd−giftCardUsd +
(debtLbp−giftCardLbp)/rate))`. Conservative (never realizes uncollected profit); gift-card counts
   as collected; CUSTOMER_ACCOUNT correctly stays pending.
3. **v102 purge** scoped to `entry_type IN ('TOP_UP','SALE_COST')` — never deletes a real cash entry.

**Should-fix (fixed):** 5. v101 backfill only fills unstamped rows whose source exists (no clobber). 6. v101 excludes refunded maintenance. 7. custom-service cost-outflow leg excluded from the viewer
in/out summary. 8. REFUND revenue gated by `saleFullyPaid` in `getByUser`/`getByClient`. 9. sales
profit dated by `s.created_at` to reconcile with revenue. 10. `payments.session_id` nulled on session
delete (v100 ADD COLUMN FK is not enforced on upgraded DBs — documented).

**Also:** fixed a pre-existing `exactOptionalPropertyTypes` error in `Suppliers/index.tsx`
(`recordCashflow` note), and **stabilized a flaky e2e** (`app.spec.ts` "Debts: add sale debt and
settle" raced the async CUSTOMER_ACCOUNT auto-switch — now waits for the payment method to commit).

**New regression tests:**

- `packages/core/src/repositories/__tests__/SessionPaymentService.basket.test.ts` (backend, 5 cases:
  cross-item bleed, gift-card realizes, account-stays-pending control, loto OUT-leg payout, posted-once).
- `frontend/tests/e2e-electron/lira-session-payout.spec.ts` (#1 — Binance RECEIVE + loto payout).
- `frontend/tests/e2e-electron/lira-session-allocation.spec.ts` (#2/#3 — bleed + gift-card).

**Bug caught by the new e2e (fixed):** the `sales` table was missing `updated_at` (create_db.sql
never had it; no migration added it), yet `markSalePaid` — the session back-fill path — writes it, so
**a session basket containing a POS sale failed at checkout** (`no such column: updated_at`) on every
DB. Fixed: column added to create_db.sql + **migration v104**; `lira-session-allocation.spec.ts`
surfaced it. (Fix #1 / payout — `lira-session-payout.spec.ts` — was confirmed passing live.)

> **Note:** e2e specs are typechecked by `tsconfig.playwright.json`, NOT the standard
> `yarn workspace @liratek/frontend typecheck` (which only covers `src`). CI should run both.

**Migration re-test caveat:** the v100–v102 _migration_ fixes only re-run on a DB that hasn't applied
those versions yet. Reset/recreate a dev DB that already ran the old v101/v102 to exercise them.

---

## 🧪 POST-REVIEW FOLLOW-UPS (2026-06-20) — WHISH_APP rename + Sprint-2 e2e coverage

**1. `WISH_APP` → `WHISH_APP` provider rename (typo fix) — migration v105.** The Whish App provider
value was stored as the misspelled `WISH_APP`. Renamed everywhere:

- **Migration v105** (`rename_wish_app_to_whish_app`): recreates `financial_services` from its OWN
  live `CREATE` statement, widening ONLY the provider `CHECK` to also accept `'WHISH_APP'`
  (schema-faithful — every column/constraint/index preserved), then relabels
  `financial_services.provider`, `mobile_service_items.provider`, and `transactions.metadata_json`.
  `down()` reverses the data relabel (the widened CHECK still permits the old value → no recreate).
- Mirrored in `electron-app/create_db.sql` (CHECK uses `WHISH_APP`; `schema_migrations` seeded
  through v105) and renamed in `electron-app/schemas/index.ts` + `electron-app/preload.ts`.
- **Why it mattered:** with the typo, Whish App SEND failed to book a settleable `SALE_COST` supplier
  entry. Now covered by `lira-061` ("Whish App SEND books SALE_COST (WISH_APP→WHISH_APP fix)").

**2. Sprint-2 e2e coverage enforced — 6 specs, all green** (per the banner note "add a test … for
each ticket implemented"). Plan: `docs/plans/done_plans/sprint2-e2e-coverage.md`. Each is IPC-driven
(`appPage.evaluate(() => window.api.*)`) over the shared per-worker DB and asserts **deltas matched by
identity** (never "newest row"):

| Ticket   | Spec                                       | Validates                                                                                                                 |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| LIRA-056 | `lira-056-supplier-credit-topup-settle`    | Katsh/iPick credit top-up funds the provider drawer, General untouched; settle nets ledger to baseline                    |
| LIRA-057 | `lira-057-whish-topup-partner-client`      | Whish App Via Partner (`WHISH_TOPUP`/CREDIT, no cash drawer) + From Client (credits-in / cash-out, profit = fee) + guards |
| LIRA-059 | `lira-059-supplier-cashflow-bidirectional` | PAY / `SUPPLIER_PAYS_US` / overpay-goes-negative; Companies vs Products (`is_system`) split                               |
| LIRA-061 | `lira-061-sale-cost-supplier-ledger`       | cost/price SEND books `SALE_COST` (not `TOP_UP`) for Katsh/iPick/Whish App; per-txn settle + cumulative pay-down          |
| LIRA-063 | `lira-063-omt-whish-optional-client`       | OMT/Whish App SEND & RECEIVE proceed with empty name/phone; provided values still persisted                               |
| LIRA-064 | `lira-064-payment-legs-summary`            | structured in/out payment legs per row (mixed IN+OUT, two same-currency INs, cash-only SEND)                              |

**3. CLAUDE.md hardened** with the lessons learned: **rule 15** (E2E assertions over the shared DB —
match a row by identity + assert deltas, never "newest row"; one action can write multiple
`transactions` rows; `created_at` is second-granular) and a **stale-build note** in "Running E2E
tests" (rebuild `electron-app/dist` after editing electron-app source — a stale `schemas/dist` once
surfaced as a confusing `WHISH_APP` Zod-validation failure).

---

## LIRA-048: Exchange Page — Show Dual USD/LBP Output Fields

| Field                | Value          |
| -------------------- | -------------- |
| **Epic**             | UI Consistency |
| **Type**             | Feature / UX   |
| **Priority**         | High           |
| **Status**           | DONE           |
| **Affected Modules** | Exchange       |
| **Assigned To**      | —              |
| **Depends On**       | —              |

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

| Field                | Value                       |
| -------------------- | --------------------------- |
| **Epic**             | UI Consistency              |
| **Type**             | Feature / UX                |
| **Priority**         | High                        |
| **Status**           | DONE                        |
| **Affected Modules** | Mobile Recharge (all forms) |
| **Assigned To**      | —                           |
| **Depends On**       | —                           |

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

| Layer    | File                                                          | Change                                                   |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Frontend | `frontend/src/features/recharge/components/TelecomForm.tsx`   | Dual LBP/USD price fields + payment method dropdown ✓    |
| Frontend | `frontend/src/features/recharge/components/FinancialForm.tsx` | USD equivalent in sticky bar ✓                           |
| Frontend | `frontend/src/features/recharge/components/CryptoForm.tsx`    | LBP equivalent in sticky bar + payment method dropdown ✓ |
| Frontend | `frontend/src/features/recharge/components/KatchForm.tsx`     | USD equivalent in sticky bar ✓                           |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`     | Propagate changes ✓                                      |

---

## LIRA-050: Mobile Recharge — Fix Layout (Proceed to Pay Position + Scrollable Grid)

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | UI Layout       |
| **Type**             | Bug / UX        |
| **Priority**         | Medium          |
| **Status**           | DONE            |
| **Affected Modules** | Mobile Recharge |
| **Assigned To**      | —               |
| **Depends On**       | —               |

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

| Layer    | File                                                          | Change                                     |
| -------- | ------------------------------------------------------------- | ------------------------------------------ |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`     | Restructure layout for fixed top-right CTA |
| Frontend | Any recharge sub-components that own the grid/proceed section | Adjust scroll container and position       |

---

## LIRA-051: Partners Page — Simplify Record Transaction Types

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | Partner System  |
| **Type**             | Cleanup / UX    |
| **Priority**         | Medium          |
| **Status**           | DONE            |
| **Affected Modules** | Partners        |
| **Assigned To**      | —               |
| **Depends On**       | LIRA-047 (DONE) |

### Summary

Audit the "Record Transaction" dialog/modal on the Partners page. The transaction type options may be overly verbose or inconsistent after LIRA-047 added `THROUGH_*` / `FOR_*` prefixed types alongside legacy types. Simplify the type list so it is clean, readable, and reflects current business terminology.

### Context

After LIRA-047, the `partner_ledger.transaction_type` field has accumulated several formats: legacy plain types, `THROUGH_*` prefixed types, and `FOR_*` prefixed types. The UI dropdown for recording transactions should present these in a clear, consistent way — removing or consolidating anything confusing.

### Acceptance Criteria

- [x] Review all `transaction_type` values currently shown in "Record Transaction" dropdown
- [x] Remove or relabel redundant/legacy entries — THROUGH*\*/FOR*\* removed (auto-written by FSR, not for manual entry)
- [x] Group or order types logically into optgroups: General, OMT, Whish, Other
- [x] TypeScript types updated — `PartnerTransactionType` union added, covers all historical DB values for display
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                       | Change                                          |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| Frontend | `frontend/src/features/partners/pages/Partners/index.tsx`                  | Simplify type dropdown in Record Transaction UI |
| Frontend | `frontend/src/features/partners/components/` (any relevant sub-components) | Update type labels/options                      |
| Types    | `frontend/src/types/electron.d.ts`                                         | Remove obsolete transaction type values if any  |

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

| Event            | Drawer Effect                                  |
| ---------------- | ---------------------------------------------- |
| Customer pays    | Cash (General) drawer +$102                    |
| Binance deducted | Binance drawer (USDT) -100 USDT (amount sent)  |
| Fee kept         | Shop profit — no separate drawer entry for fee |

_(Exact fee/amount split to be confirmed during investigation)_

### Acceptance Criteria

- [x] Binance SEND with cash payment: Cash/General drawer is credited with the amount paid by customer
- [x] Binance drawer tracks USDT (not USD) and is correctly debited on SEND
- [x] Fee does not appear as a spurious entry in General drawer (implicit in cash-in vs crypto-out spread)
- [x] Migration v93: remaps Binance drawer currency_code USD→USDT, merges stale balances, updates create_db.sql
- [x] RECEIVE logic fixed: Binance drawer credited in USDT, General drawer debited in USD (amount−fee)
- [x] `FinancialServiceRepository.binance.test.ts` added (12 tests covering SEND/RECEIVE/CUSTOMER_ACCOUNT)
- [x] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                           | Change                                       |
| -------- | -------------------------------------------------------------- | -------------------------------------------- |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts` | Fix Binance SEND drawer credit/debit routing |
| Backend  | `packages/core/src/repositories/RechargeRepository.ts`         | Review if Binance logic lives here instead   |
| Database | `packages/core/src/db/migrations/index.ts`                     | Fix Binance drawer currency if needed        |
| Database | `electron-app/create_db.sql`                                   | Sync schema fix                              |
| Frontend | `frontend/src/features/recharge/components/CryptoForm.tsx`     | Verify correct fields passed for SEND        |

---

## LIRA-053: Whish App — Flip Toggle Order (Bills/Transactions) + Flip Audit/Transactions Tab Order

| Field                | Value        |
| -------------------- | ------------ |
| **Epic**             | Whish App UX |
| **Type**             | UX / Polish  |
| **Priority**         | Low          |
| **Status**           | DONE         |
| **Affected Modules** | Whish App    |
| **Assigned To**      | —            |
| **Depends On**       | —            |

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

| Layer    | File                                                                | Change                            |
| -------- | ------------------------------------------------------------------- | --------------------------------- |
| Frontend | Whish App toggle/tab component (locate in `frontend/src/features/`) | Flip render order of toggle items |
| Frontend | Audit/Transactions page component                                   | Flip tab order                    |

---

## LIRA-054: Transaction Table — Add In/Out Amounts to Summary Description

| Field                | Value                  |
| -------------------- | ---------------------- |
| **Epic**             | Transaction Visibility |
| **Type**             | Feature / UX           |
| **Priority**         | Medium                 |
| **Status**           | DONE                   |
| **Affected Modules** | All transaction tables |
| **Assigned To**      | —                      |
| **Depends On**       | —                      |

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
- [x] **Follow-up (done, validated 2026-07-19):** BINANCE rows in TransactionsViewer show no directional badge — needs `service_type` on unified transaction row (backend join)

### Files to Modify

| Layer    | File                                                                   | Change                                               |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Frontend | Transaction table component(s) across all modules                      | Append in/out amounts to description/summary cell    |
| Backend  | Relevant repository `getAll` / `list` queries (if amounts not present) | Ensure in/out amounts are included in query response |

---

## LIRA-055: Customer Session Checkout Modal — Add MultiPaymentInput Component

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | Customer Sessions                        |
| **Type**             | Feature                                  |
| **Priority**         | High                                     |
| **Status**           | DONE                                     |
| **Affected Modules** | POS > Customer Sessions > Checkout Modal |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

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
- [x] **Follow-up (resolved differently — client resolved at checkout, SessionCheckoutService.resolveSessionClientForCheckout):** Voucher support at checkout requires `client_id` on session (currently only `customer_name`/`customer_phone` stored)

### Files to Modify

| Layer    | File                                                                           | Change                                                |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Frontend | Customer Session Checkout Modal component (locate in `frontend/src/features/`) | Replace simple payment input with `MultiPaymentInput` |
| Frontend | `packages/ui/src/components/ui/MultiPaymentInput.tsx`                          | Any props adjustments needed for modal context        |
| Types    | `frontend/src/types/electron.d.ts`                                             | Update if checkout payload shape changes              |

---

## Summary (Sprint 1 — LIRA-048..055)

| Priority  | Total | Done  | Remaining |
| --------- | ----- | ----- | --------- |
| High      | 4     | 4     | 0         |
| Medium    | 2     | 2     | 0         |
| Low       | 1     | 1     | 0         |
| Bug       | 1     | 1     | 0         |
| **Total** | **8** | **8** | **0**     |

---

## Open Follow-ups (Post-Sprint 1)

| ID          | Description                                                                                                             | Priority |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| LIRA-054-FU | BINANCE rows in TransactionsViewer missing directional badge — needs `service_type` joined onto unified transaction row | Low      |
| LIRA-055-FU | Voucher support at session checkout requires `client_id` stored on session (currently only name/phone)                  | Low      |

---

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

## LIRA-058: OMT APP — Topup Flow Design

| Field                | Value                         |
| -------------------- | ----------------------------- |
| **Epic**             | OMT App Topup                 |
| **Type**             | Feature                       |
| **Priority**         | Medium                        |
| **Status**           | NEEDS INTERVIEW               |
| **Affected Modules** | Recharge > OMT App, Suppliers |
| **Assigned To**      | —                             |
| **Depends On**       | —                             |

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

- [ ] _(To be defined after interview)_

### Notes

- Interview required to clarify: what exactly is the "owed pool", how does it appear in the supplier ledger, how does OMT pay us back, can the owed pool go negative?

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

## LIRA-068: Mark Transaction "Amount Changed" When Edited

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Transaction Visibility / Audit |
| **Type**             | Feature                        |
| **Priority**         | Low                            |
| **Status**           | TODO                           |
| **Affected Modules** | All transaction types          |
| **Depends On**       | —                              |

### Summary

If a transaction's **amount** was modified after creation, flag it as **"amount changed"** (badge/indicator). Edits are already tracked via `edited_by` / `edited_at` across modules. **Check overlap with the existing recharge "margin alert"** (theft-detection on margin override, `HistoryModal` `marginAlertThreshold`, default 100k LBP) — reuse/align rather than duplicate. **Expand the indicator to all transaction types.**

### Acceptance Criteria

- [ ] A transaction whose amount changed shows an "amount changed" indicator
- [ ] Approach reconciled with the existing margin-alert mechanism (no duplicate/contradictory signals)
- [ ] Applies across all transaction types (not just recharge)
- [ ] Distinguishes "amount changed" from generic edited metadata where relevant
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                              | Change                                    |
| -------- | ------------------------------------------------- | ----------------------------------------- |
| Backend  | transaction/edit paths                            | Persist/expose amount-changed signal      |
| Frontend | `TransactionsViewer.tsx` + module `HistoryModal`s | Render indicator; align with margin alert |

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

## LIRA-075: Favorite/Pin Whish App Quick Link in Home Grid

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Navigation / Home     |
| **Type**             | Feature               |
| **Priority**         | Low                   |
| **Status**           | TODO                  |
| **Affected Modules** | Dashboard / Home grid |
| **Depends On**       | —                     |

### Summary

Add favorite/pinned **quick links** to a page (starting with Whish App) in the home grid view (`Dashboard.tsx`). Noted as **partially implemented** — finish the favorite-link affordance so Whish App (and others) can be pinned for quick access.

### Acceptance Criteria

- [ ] User can favorite/pin a page (Whish App) as a quick link in the home grid
- [ ] Pinned links persist and navigate correctly
- [ ] Builds on the partial home-grid implementation (no parallel mechanism)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                  | Change                     |
| -------- | ----------------------------------------------------- | -------------------------- |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx` | Favorite/pin quick-link UI |

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

# Sprint 4 — Owner Notes Batch (2026-07-20)

> **Sprint Focus:** disposition of a 32-note owner feedback batch delivered 2026-07-20 — each
> note was verified against the code before being ticketed. Full per-note disposition log (fixed
> today / invalid / in progress / ticketed / parked) lives in `LEFT_TO_DO.md`, dated section
> "2026-07-20 — Owner notes batch (32 notes)".
> **Created:** 2026-07-20
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

---

## LIRA-078: Refund Tender-Selection Modal

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Epic**             | Transactions                                                                            |
| **Type**             | Feature / UX                                                                            |
| **Priority**         | High                                                                                    |
| **Status**           | DONE (2026-07-21 — method-override modal, 33 unit tests + lira-126 e2e transport guard) |
| **Affected Modules** | Audit > TransactionsViewer                                                              |
| **Assigned To**      | —                                                                                       |
| **Depends On**       | —                                                                                       |

### Summary

Owner note 22b. Today refunding a transaction is a bare `confirm("Refund this transaction? A
reversal entry will be created.")` dialog (`TransactionsViewer.tsx` `handleRefund`) followed by
an instant, automatic reversal of the original payment legs — the operator has no say in HOW the
money goes back (e.g. return cash when the customer originally paid by CUSTOMER_ACCOUNT, or split
the return across methods). Replace this with a modal built on the shared `MultiPaymentInput`
component (the same pattern already used by `CounterpartySettleModal`) so the operator explicitly
chooses the return method(s), pre-filled with the original legs reversed as a sane default.

### Acceptance Criteria

- [ ] Clicking Refund opens a modal (not a `confirm()` dialog) containing `MultiPaymentInput`
- [ ] Modal defaults/pre-fills to the original transaction's legs, reversed (today's behavior, as the default path)
- [ ] Operator can change the return method/split before confirming
- [ ] Whichever methods are chosen, the correct drawer(s) are affected per method
- [ ] Reversal still nets ledgers and profit to exactly zero per currency (rule 20), regardless of which return method the operator picks
- [ ] Failing-first regression test proving the old auto-reversal-only path is superseded (rule 17)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                            | Change                                                                                                     |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx`      | Replace `confirm()` + `handleRefund` auto-reversal with a modal launch                                     |
| Frontend | New refund modal component (pattern: `CounterpartySettleModal`) | `MultiPaymentInput`-based tender selection                                                                 |
| Backend  | `packages/core/src/repositories/TransactionRepository.ts`       | Accept operator-chosen legs for the refund reversal instead of always reversing the original legs verbatim |

---

## LIRA-079: Refund Scope + Void Button Decision

| Field                | Value                      |
| -------------------- | -------------------------- |
| **Epic**             | Transactions               |
| **Type**             | Enhancement / Decision     |
| **Priority**         | Medium                     |
| **Status**           | NEEDS INTERVIEW            |
| **Affected Modules** | Audit > TransactionsViewer |
| **Assigned To**      | —                          |
| **Depends On**       | —                          |

### Summary

Owner notes 21b/21c and the second (duplicate-labeled) note 27 ("second 27"). The owner wants
refund available on "all" transaction types, and separately raised whether the Void button
should be removed altogether (possibly superseded by Refund). Both conflict with the deliberate
`NON_REVERSIBLE_TRANSACTION_TYPES` gate (`packages/core/src/constants/transactionTypes.ts`),
which exists because several types (LOTO, LOTO_CASH_PRIZE, LOTO_SETTLEMENT,
SUPPLIER_SETTLEMENT, RECHARGE_TOPUP, REFUND, and the partner-ledger types) have side effects the
generic reversal path cannot safely undo. Blocked on owner answers before any code changes.

### Open Questions (owner interview required)

- [ ] Which transaction types actually need refund support — all of them, or a defined subset excluding the types the gate protects for a real reason?
- [ ] Keep the Void button alongside Refund, or remove it? If removed, does every current Void-only use case have a Refund-based replacement?

### Acceptance Criteria

- [ ] _(To be defined after interview)_

---

## LIRA-080: No-Drawer (Paper) Credit/Debt Entries on Accounts + Supplier Pages

| Field                | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **Epic**             | Counterparty Ledgers                                                 |
| **Type**             | Feature                                                              |
| **Priority**         | High                                                                 |
| **Status**           | DONE (2026-07-21 — landed + verified; core tests 4/4, rule-20 gated) |
| **Affected Modules** | Debts (Accounts), Suppliers                                          |
| **Assigned To**      | —                                                                    |
| **Depends On**       | CQ-6 (`COUNTERPARTY_CONSOLIDATION_PLAN.md`)                          |

### Summary

Owner notes 1 + 32. The Partner page already has a default-off "Cash moved" toggle so a
Record-Transaction entry can be posted as a pure paper/ledger adjustment with no drawer effect.
The Accounts (client debt) page has no such toggle — every Add Credit/Debt always moves the
drawer. The Supplier page is worse: it has no Add Credit/Debt action at all today. Add the same
toggle to Accounts (default ON, preserving today's behavior) and add the missing Add Credit/Debt
button to Suppliers with the same toggle.

### Acceptance Criteria

- [ ] Accounts page "Add Credit/Debt" gains a "Cash moved" toggle, default ON (= current behavior unchanged when left alone)
- [ ] Supplier page gains an "Add Credit/Debt" action (currently absent), with the same toggle
- [ ] A paper (toggle-off) entry posts a visible no-cash-movement row in Transactions
- [ ] Reversal ownership defined for the new paper-entry ledger rows (rule 20)
- [ ] Failing-first tests for both the drawer-affecting and paper paths
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                    | Change                                  |
| -------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Frontend | `frontend/src/features/debts/pages/Debts/index.tsx` (Accounts)          | "Cash moved" toggle on Add Credit/Debit |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`             | New Add Credit/Debt action + toggle     |
| Backend  | `packages/core/src/repositories/{DebtRepository,SupplierRepository}.ts` | Paper-entry write path + reversal owner |

---

## LIRA-081: For-Partner Toggle on Exchange and Custom Services

| Field                | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **Epic**             | Partners                                                                                           |
| **Type**             | Enhancement                                                                                        |
| **Priority**         | Medium                                                                                             |
| **Status**           | DONE (2026-07-21 — Exchange + Custom Services; Maintenance deliberately excluded, see ticket note) |
| **Affected Modules** | Exchange, Custom Services                                                                          |
| **Assigned To**      | —                                                                                                  |
| **Depends On**       | CQ-6 (ForPartnerToggle consolidation)                                                              |

### Summary

Owner note 3. `ForPartnerToggle` is already wired into POS (`CheckoutModal.tsx`), Loto, and every
recharge form (`FinancialForm`, `OmtWhishAppTransferForm`, `KatchForm`, `TelecomForm`,
`CryptoForm`) but is absent from Exchange and Custom Services — those transactions cannot be
attributed to a partner today.

### Acceptance Criteria

- [ ] `ForPartnerToggle` present on Exchange and Custom Services forms, wired the same way as the existing consumers (single shared component, no copy-paste)
- [ ] Toggling posts the matching `partner_ledger` `FOR_*` entry
- [ ] Void cascade extends to these two newly-covered parent transaction types
- [ ] Tests covering the toggle-on write path and its void reversal
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                             | Change                                        |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| Frontend | `frontend/src/features/exchange/pages/Exchange/index.tsx`                        | Add `ForPartnerToggle`                        |
| Frontend | `frontend/src/features/custom-services/pages/CustomServices/index.tsx`           | Add `ForPartnerToggle`                        |
| Backend  | `packages/core/src/repositories/{ExchangeRepository,CustomServiceRepository}.ts` | `FOR_*` partner_ledger posting + void cascade |

---

## LIRA-082: Detailed Summaries on All createTransaction Call Sites

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **Epic**             | Transaction Visibility                                       |
| **Type**             | Enhancement                                                  |
| **Priority**         | Medium                                                       |
| **Status**           | DONE (2026-07-20 — 5 call sites enriched, no e2e collisions) |
| **Affected Modules** | Maintenance, Debts, Suppliers, Services (Hold Money)         |
| **Assigned To**      | —                                                            |
| **Depends On**       | —                                                            |

### Summary

Owner note 14. Several `createTransaction` call sites write bare, amount-only summaries that
don't reflect what actually happened: the Maintenance summary omits the device/issue, and
DebtRepayment / SupplierPayment / HoldMoney summaries carry only the amount with no context.
Enrich each with the relevant detail, appended to (not replacing) the existing summary prefix.

### Acceptance Criteria

- [ ] Maintenance transaction summary includes device + issue detail
- [ ] DebtRepayment, SupplierPayment, and HoldMoney summaries include identifying detail beyond the bare amount
- [ ] Existing summary prefixes/conventions preserved (no format break for existing rows/filters)
- [ ] Tests updated to assert the enriched summary text
- [ ] Typecheck and lint pass

### Files to Modify

| Layer   | File                                                                                        | Change                         |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| Backend | `packages/core/src/repositories/MaintenanceRepository.ts`                                   | Append device/issue to summary |
| Backend | `packages/core/src/repositories/{DebtRepository,SupplierRepository,HoldMoneyRepository}.ts` | Enrich summaries               |

---

## LIRA-083: Service Status Workflow for Custom Services

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | Custom Services |
| **Type**             | Feature         |
| **Priority**         | Medium          |
| **Status**           | TODO            |
| **Affected Modules** | Custom Services |
| **Assigned To**      | —               |
| **Depends On**       | —               |

### Summary

Owner note 15 ("sejel 3adli" — a paperwork-style custom service). `custom_services.status` today
only ever transitions between `completed` and `voided` (an accounting-only status) — there is no
work-in-progress lifecycle like Maintenance's `Received → In_Progress → Ready → Delivered`. Add a
genuine status workflow so a custom service (e.g. official-paper processing) can be tracked as it
progresses.

### Acceptance Criteria

- [ ] New multi-state work-status field, separate from the existing accounting status (proposed: `pending → in_progress → done`; confirm exact states with owner before finalizing)
- [ ] Status editable from the Custom Services page
- [ ] Status filterable in the list view
- [ ] Status visible in history (HistoryModal)
- [ ] Migration adds the column with a safe default (no `CURRENT_TIMESTAMP` default on an ALTER, per the v104 lesson)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                            | Change                             |
| -------- | --------------------------------------------------------------- | ---------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                      | New migration — work-status column |
| Database | `electron-app/create_db.sql`                                    | Mirror                             |
| Backend  | `packages/core/src/repositories/CustomServiceRepository.ts`     | Status transitions + filter        |
| Frontend | `frontend/src/features/custom-services/pages/CustomServices/**` | Status UI, filter, history display |

---

## LIRA-084: Partial Keep-Change

| Field                | Value                                            |
| -------------------- | ------------------------------------------------ |
| **Epic**             | Payments                                         |
| **Type**             | Enhancement                                      |
| **Priority**         | Medium                                           |
| **Status**           | TODO                                             |
| **Affected Modules** | MultiPaymentInput (shared)                       |
| **Assigned To**      | —                                                |
| **Depends On**       | T3 Keep Change (shipped — this is the follow-up) |

### Summary

Owner note 17. `keepChange` in `MultiPaymentInput` is currently all-or-nothing — the operator
either keeps the entire computed change or returns all of it. The owner wants to split it: e.g.
of a 140,000 LBP change, return 100,000 LBP and keep 40,000 on the customer's account.

### Acceptance Criteria

- [ ] Operator can keep a PARTIAL amount of the change, not just all-or-nothing
- [ ] The kept portion books exactly like today's full-keep (same ledger/debt path)
- [ ] The OUT (return) legs reflect only the amount actually returned, not the full computed change
- [ ] Works independently per currency
- [ ] Component test covering the partial-keep math
- [ ] Repository test covering the resulting legs
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                  | Change                        |
| -------- | ----------------------------------------------------- | ----------------------------- |
| Frontend | `packages/ui/src/components/ui/MultiPaymentInput.tsx` | Partial keep-change UI + math |

---

## LIRA-085: Undo/Reverse for Partner & Supplier Ledger Transactions

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **Epic**             | Partners / Suppliers                                         |
| **Type**             | Bug / Enhancement                                            |
| **Priority**         | High                                                         |
| **Status**           | DONE (2026-07-21 — module-owned reversals, 27 netting tests) |
| **Affected Modules** | Partners, Suppliers                                          |
| **Assigned To**      | —                                                            |
| **Depends On**       | —                                                            |

### Summary

Owner notes 25 and the partner/supplier half of note 26. `PARTNER_SETTLEMENT`,
`PARTNER_PAYMENT`, and `SUPPLIER_SETTLEMENT` are deliberately listed in
`NON_REVERSIBLE_TRANSACTION_TYPES` (rule 20) because no reversal owner was ever built for them.
The owner wants a mistake-undo path for these ledgers.

### Acceptance Criteria

- [ ] A module-owned reversal defined for each of the currently-non-reversible partner/supplier types (per rule 20 — generic-path extension or dedicated reversal)
- [ ] Create + reverse nets to exactly zero per currency, across every ledger touched (partner_ledger / supplier_ledger / drawer / debt if applicable)
- [ ] Undo affordance surfaced on the Partner and Supplier pages
- [ ] Failing-first proof (rule 17)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                                             | Change                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/constants/transactionTypes.ts`                                                | Move types out of `NON_REVERSIBLE_TRANSACTION_TYPES` once a reversal owner exists |
| Backend  | `packages/core/src/repositories/{PartnerRepository,SupplierRepository,TransactionRepository}.ts` | Reversal owner implementation                                                     |
| Frontend | `frontend/src/features/{partners,suppliers}/pages/*/index.tsx`                                   | Undo affordance                                                                   |

---

## LIRA-086: Dashboard Checkpoint Freshness Coloring

| Field                | Value       |
| -------------------- | ----------- |
| **Epic**             | Dashboard   |
| **Type**             | Enhancement |
| **Priority**         | Low         |
| **Status**           | TODO        |
| **Affected Modules** | Dashboard   |
| **Assigned To**      | —           |
| **Depends On**       | —           |

### Summary

Owner note 29. Color the dashboard's last-checkpointed value by how fresh/consistent it is
versus the expected value: green when it matches, orange for a small drift, red for a large
drift. Thresholds TBD with the owner.

### Acceptance Criteria

- [ ] Dashboard compares the last checkpointed value against the expected value
- [ ] Green = match, orange = small diff, red = large diff
- [ ] Drift thresholds confirmed with the owner (TBD — not yet defined)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                  | Change                             |
| -------- | ----------------------------------------------------- | ---------------------------------- |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx` | Freshness-coded checkpoint display |

---

## LIRA-087: Product-Supplier — Record Debt Now, Attach Products Later

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Suppliers / Inventory |
| **Type**             | Feature               |
| **Priority**         | Medium                |
| **Status**           | TODO                  |
| **Affected Modules** | Suppliers, Inventory  |
| **Assigned To**      | —                     |
| **Depends On**       | —                     |

### Summary

Owner note 31. Restocking already-received goods currently risks double-booking supplier debt:
there is no way to record a supplier debt without immediately tying it to specific inventory
items. Add a flow to record the debt first, then attach the related products to it later.

### Acceptance Criteria

- [ ] Record a supplier debt entry without any line items
- [ ] Later attach the related products to that recorded debt
- [ ] No duplicate debt created when products are attached after the fact
- [ ] Ledger stays consistent (balances unaffected by the two-step flow vs. the one-step flow)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                       | Change                                                           |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                                 | Linking table/column between a debt entry and product line items |
| Backend  | `packages/core/src/repositories/{SupplierRepository,ProductRepository}.ts` | Two-step debt→attach flow                                        |
| Frontend | `frontend/src/features/{suppliers,inventory}/**`                           | UI for recording debt then attaching products                    |

---

## LIRA-088: MTC/Alfa Provider-Balance Decrement Adjustment

| Field                | Value                |
| -------------------- | -------------------- |
| **Epic**             | Recharge             |
| **Type**             | Feature              |
| **Priority**         | Medium               |
| **Status**           | NEEDS INTERVIEW      |
| **Affected Modules** | Recharge > MTC, Alfa |
| **Assigned To**      | —                    |
| **Depends On**       | —                    |

### Summary

Owner note 4. MTC/Alfa top-up paths (`RechargeRepository.ts`) force positive amounts via
`Math.abs(data.amount)` — there is no way to record the shop consuming its own provider credit
(e.g. using the shop's phone line) as a signed decrement. Note: the "buy credits from customer"
half of the owner's ask already exists (`topUpFromCustomer`) — this ticket is only the decrement
half.

**2026-07-20 amendment:** the W6.a carrier-lines work (`CarrierLineService.updateBalance`,
drawer-free by design) may already cover this if the owner meant the shop-SIM credits reading.
If they meant the _resale_ provider-drawer balance, the decrement gap remains. Downgraded to
NEEDS INTERVIEW — confirm which balance the owner meant before building
(see `docs/plans/todo_plans/OWNER_NOTES_TASK_PLAN.md` §B).

### Acceptance Criteria

- [ ] A signed/decrement adjustment path exists for MTC/Alfa provider balance
- [ ] Does not move any cash drawer (informational/internal consumption, not a customer transaction)
- [ ] Audit trail records who/when/how much
- [ ] Tests covering the decrement path
- [ ] Typecheck and lint pass

### Files to Modify

| Layer   | File                                                   | Change                             |
| ------- | ------------------------------------------------------ | ---------------------------------- |
| Backend | `packages/core/src/repositories/RechargeRepository.ts` | Signed decrement adjustment method |

---

## LIRA-089: iPick/Katsh Bills — Commission at Settlement, Not Per-Bill

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | Suppliers / Recharge               |
| **Type**             | Feature / Decision                 |
| **Priority**         | Medium                             |
| **Status**           | NEEDS INTERVIEW                    |
| **Affected Modules** | Recharge > iPick, Katsh; Suppliers |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Owner note 13. Today every iPick/Katsh bill auto-books a hardcoded −20,000 LBP
`SUPPLIER_PAYS_US` ledger row at transaction time (`FinancialServiceRepository`, per LIRA-062).
The owner's model instead: count bills only at transaction time (no commission booked yet), and
enter the ACTUAL commission amount later, at supplier settlement. Blocked on owner answers before
implementation.

### Open Questions (owner interview required)

- [ ] Is the commission entered as ONE amount per settlement batch, or per-bill × count?
- [ ] What happens to bills already recorded under the old hardcoded-per-bill model — backfill, leave as-is, or migrate?

### Acceptance Criteria

- [ ] _(To be defined after interview — implementable using the W5 OMT/Whish settle-netting pattern as a template, per the parallel session's finding)_

---

## LIRA-090: Telecom Days/Credit Model (MTC/Alfa)

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Recharge                       |
| **Type**             | Feature / Decision             |
| **Priority**         | High                           |
| **Status**           | NEEDS INTERVIEW                |
| **Affected Modules** | Recharge > MTC, Alfa; Settings |
| **Assigned To**      | —                              |
| **Depends On**       | —                              |

### Summary

Owner notes 6–12. A substantial new model for shop-number validity days and per-item cost/credit
breakdowns for telecom (MTC/Alfa) — see `docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md` for
the full scope, current-state facts, and the open owner questions blocking implementation.

### Acceptance Criteria

- [ ] _(Blocked on the owner interview — see the plan doc)_

---

## Summary (Sprint 4 — LIRA-078..090)

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| High      | 4      | 0     | 4         |
| Medium    | 7      | 0     | 7         |
| Low       | 1      | 0     | 1         |
| **Total** | **13** | **0** | **13**    |

> 3 of the 13 (LIRA-080, LIRA-081, LIRA-082) are already IN PROGRESS — implementation landing
> the same day (2026-07-20) as this batch was triaged. 3 are NEEDS INTERVIEW (LIRA-079, LIRA-089,
> LIRA-090) and cannot proceed without owner answers.

## LIRA-091: Void Cascade for Auto Supplier-Ledger Siblings (FS/RECHARGE)

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| **Epic**             | Transactions / Suppliers                   |
| **Type**             | Bug                                        |
| **Priority**         | High                                       |
| **Status**           | DONE (2026-07-21)                          |
| **Affected Modules** | Transactions, Financial Services, Recharge |
| **Assigned To**      | —                                          |
| **Depends On**       | —                                          |

### Summary

The FEATURE_GUIDE §9 standing gap (also `LEFT_TO_DO.md` "Known gap — next batch"): voiding a
`FINANCIAL_SERVICE` (e.g. OMT/OMT-App SEND) or `RECHARGE` reverses cash + wallet legs, but the
**auto supplier TOP_UP/SUPPLIER_PAYS_US sibling** (ledger row + hidden `SUPPLIER_PAYMENT` txn)
stays — the supplier balance overstates the debt by the voided amount (conservative direction:
overstated, never understated). No schema link exists from the parent row to the sibling.
Fix: add the reference (migration v136), cascade the soft-void through both the single void
and `voidCheckoutGroup`, and handle the already-settled sibling case. Legacy (pre-link) rows
are out of reach without a heuristic data repair — documented limitation, mirroring LIRA-094.

**Shipped (2026-07-21):** `supplier_ledger.source_ref_table`/`source_ref_id` (migration v136)
back-links an auto sibling to its parent's `source_table`/`source_id`, stamped by both
FinancialServiceRepository `is_auto:true` sites (BILL commission, SEND/RECEIVE TOP_UP/PAYMENT).
`TransactionRepository._cascadeSupplierSiblingVoid` finds unrefunded, `is_auto=1` siblings and
reuses `_voidTransactionInternal` per sibling (soft-void via the pre-existing
`_markSourceRefunded` step — no second reversal path); `voidCheckoutGroup` inherits it for free
since it already delegates to the same internal method (proved for a Katsh BILL split-group
member). `_assertSupplierSiblingsVoidable` blocks the whole void/refund up-front, naming the
settlement, when the parent's own `financial_services.settlement_id` is already stamped —
honest-block, no compensating entry. FACTS-FIRST finding: RechargeRepository has no LIVE
`is_auto:true` separate-hidden-transaction creation site today (`topUpFromSupplier` is
link-mode, tied to the already-non-reversible `RECHARGE_TOPUP` type, and is deliberately left
unstamped — see the code comment); the RECHARGE acceptance case is proved as a synthetic,
source-table-generic fixture instead of a live path. Guarded against ~26 pre-existing hand-rolled
`supplier_ledger` test fixtures that predate v136 (`SupplierRepository._supplierLedgerHasSourceRefColumns`
/ `TransactionRepository._supplierLedgerHasSourceRefColumns` check column existence before
reading/writing the new columns — absent columns means "no siblings possible," a correct
no-op, not a swallowed error).

### Acceptance Criteria

- [x] Parent void/refund also soft-voids the auto supplier sibling (ledger + hidden txn)
- [x] Create + void nets to 0 across supplier_ledger per currency (failing-first proof)
- [x] Already-settled sibling handled explicitly (block — documented decision, owner sign-off item)
- [x] Both creation paths covered (FinancialServiceRepository live; RechargeRepository proved
      generically via a synthetic fixture — no live creation site exists today, see summary)
- [x] Migration v136 in BOTH migrations index and create_db.sql

## LIRA-094: Carrier-Legs Void Asymmetry (Split Checkouts) — retroactive filing

| Field                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| **Epic**             | Transactions / Payments                                        |
| **Type**             | Bug                                                            |
| **Priority**         | High                                                           |
| **Status**           | DONE (2026-07-19, shipped as design B+ in W5)                  |
| **Affected Modules** | Transactions, Financial Services, Recharge (Katch/iPick bills) |
| **Assigned To**      | —                                                              |
| **Depends On**       | —                                                              |

### Summary

Retroactive registry filing (2026-07-21): this work was executed 2026-07-19 under the
mislabel "LIRA-070" in `PARTIAL_TASKS_COMPLETION_PLAN.md` — the registry's real LIRA-070 is
the unrelated Profits-page audit. Multi-unit split checkouts book all payment legs on ONE
carrier transaction; voiding a single member (carrier or sibling) broke reversal symmetry
(rule 20). Shipped fix: metadata `split_group` linkage at create time, a void/refund guard on
group members, atomic `voidCheckoutGroup`, and a "Void entire checkout (N units)" action —
full design record in `docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md`. Open follow-ups
live there (design-A real column when a migration window opens; legacy pre-fix rows
undetectable by the guard). Numbers LIRA-092–093 remain free (LIRA-091 filed 2026-07-21, see above).

### Sprint 4 board

| ID       | Title                                                   | Priority | Status          |
| -------- | ------------------------------------------------------- | -------- | --------------- |
| LIRA-078 | Refund tender-selection modal                           | High     | DONE            |
| LIRA-079 | Refund scope + Void button decision                     | Medium   | NEEDS INTERVIEW |
| LIRA-080 | No-drawer paper credit/debt on Accounts + Supplier      | High     | DONE            |
| LIRA-081 | For-Partner toggle on Exchange + Custom Services        | Medium   | DONE            |
| LIRA-082 | Detailed summaries on all createTransaction call sites  | Medium   | DONE            |
| LIRA-083 | Custom Services status workflow                         | Medium   | TODO            |
| LIRA-084 | Partial keep-change                                     | Medium   | TODO            |
| LIRA-085 | Undo/reverse for partner & supplier ledger transactions | High     | DONE            |
| LIRA-086 | Dashboard checkpoint freshness coloring                 | Low      | TODO            |
| LIRA-087 | Product-supplier — debt now, attach products later      | Medium   | TODO            |
| LIRA-088 | MTC/Alfa provider-balance decrement                     | Medium   | NEEDS INTERVIEW |
| LIRA-089 | iPick/Katsh bills commission at settlement              | Medium   | NEEDS INTERVIEW |
| LIRA-090 | Telecom days/credit model                               | High     | NEEDS INTERVIEW |
| LIRA-091 | Void cascade for auto supplier-ledger siblings          | High     | DONE            |
| LIRA-094 | Carrier-legs void asymmetry (retroactive — shipped W5)  | High     | DONE            |

> Full per-note disposition (all 32 owner notes, including the ones that were INVALID/already
> working, FIXED today, or already tracked under an existing ticket) is logged in
> `LEFT_TO_DO.md`, dated section "2026-07-20 — Owner notes batch (32 notes)".
