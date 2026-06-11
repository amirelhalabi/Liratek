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

## Summary

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| High      | 4      | 4     | 0         |
| Medium    | 2      | 2     | 0         |
| Low       | 1      | 1     | 0         |
| Bug       | 1      | 1     | 0         |
| **Total** | **8**  | **8** | **0**     |

---

## Open Follow-ups (Post-Sprint)

| ID | Description | Priority |
|----|-------------|----------|
| LIRA-054-FU | BINANCE rows in TransactionsViewer missing directional badge — needs `service_type` joined onto unified transaction row | Low |
| LIRA-055-FU | Voucher support at session checkout requires `client_id` stored on session (currently only name/phone) | Low |
