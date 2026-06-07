# LiraTek POS — Current Sprint

> **Sprint Focus:** UI Consistency, Binance Fixes, Whish App UX, Transaction Enrichment & Session Checkout
> **Created:** 2026-06-07
> **Last Updated:** 2026-06-07
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## LIRA-048: Exchange Page — Show Dual USD/LBP Output Fields

| Field                | Value                                    |
| -------------------- | ---------------------------------------- |
| **Epic**             | UI Consistency                           |
| **Type**             | Feature / UX                             |
| **Priority**         | High                                     |
| **Status**           | TODO                                     |
| **Affected Modules** | Exchange                                 |
| **Assigned To**      | —                                        |
| **Depends On**       | —                                        |

### Summary

Currently the Exchange page shows a single "Customer Gets" field displaying the converted amount in the target currency. Replace this with two always-visible output fields — **USD** and **LBP** — mirroring the dual-currency display pattern used in the POS Checkpoint Modal.

### Context

The POS Checkpoint Modal already has a proven dual-field layout where both USD and LBP amounts are shown simultaneously. The Exchange page should adopt the same pattern for output so the operator always sees both representations regardless of the exchange direction.

### Acceptance Criteria

- [ ] Remove single "customer gets (to currency)" output field
- [ ] Always show two output fields: USD and LBP
- [ ] Field values computed using the current exchange rate (same logic as before, just surfaced in both currencies)
- [ ] Layout matches the dual-field style from POS Checkpoint Modal
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                                     |
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

- [ ] Recharge forms show two amount fields: USD and LBP (matching POS Checkpoint Modal style)
- [ ] A payment method dropdown is added, allowing the operator to change the method if needed
- [ ] Dropdown uses the same payment methods available in the current system
- [ ] USD/LBP field interaction (editing one auto-calculates the other via exchange rate) mirrors POS Checkpoint Modal behavior
- [ ] All recharge form variants (MTC, Alfa, etc.) updated consistently
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                  | Change                                       |
| -------- | --------------------------------------------------------------------- | -------------------------------------------- |
| Frontend | `frontend/src/features/recharge/components/TelecomForm.tsx`           | Add dual fields + payment method dropdown    |
| Frontend | `frontend/src/features/recharge/components/FinancialForm.tsx`         | Same                                         |
| Frontend | `frontend/src/features/recharge/components/CryptoForm.tsx`            | Same                                         |
| Frontend | `frontend/src/features/recharge/components/KatchForm.tsx`             | Same                                         |
| Frontend | `frontend/src/features/recharge/components/PaymentSheet.tsx`          | Update to support dropdown + dual fields     |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`             | Propagate changes                            |

---

## LIRA-050: Mobile Recharge — Fix Layout (Proceed to Pay Position + Scrollable Grid)

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| **Epic**             | UI Layout                          |
| **Type**             | Bug / UX                           |
| **Priority**         | Medium                             |
| **Status**           | TODO                               |
| **Affected Modules** | Mobile Recharge                    |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Two layout issues in the Mobile Recharge page:

1. **"Proceed to Pay" button/section** should be repositioned to the **top right**, aligned with the search bar, and its position should be fixed (not scroll away).
2. **Only the recharge items grid** should be scrollable — the rest of the page (header, search bar, proceed-to-pay) stays fixed.

### Acceptance Criteria

- [ ] "Proceed to Pay" section is anchored to the top right, next to the search bar
- [ ] "Proceed to Pay" does not scroll out of view
- [ ] The recharge items grid scrolls independently within its container
- [ ] No layout regressions on other parts of the page

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
| **Status**           | TODO                               |
| **Affected Modules** | Partners                           |
| **Assigned To**      | —                                  |
| **Depends On**       | LIRA-047 (DONE)                    |

### Summary

Audit the "Record Transaction" dialog/modal on the Partners page. The transaction type options may be overly verbose or inconsistent after LIRA-047 added `THROUGH_*` / `FOR_*` prefixed types alongside legacy types. Simplify the type list so it is clean, readable, and reflects current business terminology.

### Context

After LIRA-047, the `partner_ledger.transaction_type` field has accumulated several formats: legacy plain types, `THROUGH_*` prefixed types, and `FOR_*` prefixed types. The UI dropdown for recording transactions should present these in a clear, consistent way — removing or consolidating anything confusing.

### Acceptance Criteria

- [ ] Review all `transaction_type` values currently shown in "Record Transaction" dropdown
- [ ] Remove or relabel redundant/legacy entries (mark with "(legacy)" or remove where safe)
- [ ] Group or order types logically (e.g., OMT Send/Receive, Whish Send/Receive, Settlement, Adjustment)
- [ ] TypeScript types updated to match simplified set if any are removed
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                                           |
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

- [ ] Binance SEND with cash payment: Cash/General drawer is credited with the amount paid by customer
- [ ] Binance drawer tracks USDT (not USD) and is correctly debited on SEND
- [ ] Fee does not appear as a spurious entry in General drawer
- [ ] Checkpoint correctly shows Binance drawer balance in USDT
- [ ] Existing Binance RECEIVE logic reviewed for same class of bug
- [ ] Unit or integration tests added/updated for Binance drawer flows
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                               |
| **Affected Modules** | Whish App                          |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Two ordering changes in the Whish App UI:

1. **Bills / Transactions toggle** — flip the order so Transactions comes before Bills (or vice versa — confirm desired order with user).
2. **Audit and Transactions page tab order** — flip so the preferred tab appears first.

### Acceptance Criteria

- [ ] Bills/Transactions toggle order is flipped
- [ ] Audit/Transactions page tab order is flipped
- [ ] No functional regressions — toggling and tab switching still work correctly
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                               |
| **Affected Modules** | All transaction tables             |
| **Assigned To**      | —                                  |
| **Depends On**       | —                                  |

### Summary

Each transaction row in transaction tables has a summary/description column. Enrich this description to include the **in** and **out** amounts for each transaction, so the operator can quickly see cash flow direction and magnitude without opening the transaction detail.

### Context

Currently transaction descriptions may only show type/label. Adding `IN: $X` / `OUT: $Y` (or equivalent) directly in the description text makes scanning the table faster and reduces the need to drill into individual records.

### Acceptance Criteria

- [ ] Each transaction row summary includes an in-amount and/or out-amount label
- [ ] Format is consistent and readable (e.g., `↑ $50.00 / ↓ LBP 90,000` or similar)
- [ ] Applied to all transaction tables that show a description/summary column
- [ ] No performance regression (amounts should already be in the query result)
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                                            |
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

- [ ] Checkout Modal renders `MultiPaymentInput` in place of the existing simpler payment field
- [ ] All `MultiPaymentInput` features work inside the modal (split payment, USD/LBP, CUSTOMER_ACCOUNT)
- [ ] CUSTOMER_ACCOUNT auto-selects when a client is attached to the session (consistent with existing `MultiPaymentInput` behavior per [[project_recharge_payment_autoselect]])
- [ ] Modal layout accommodates the wider component without overflow
- [ ] Payment totals validate correctly before confirming checkout
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                          | Change                                                     |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Frontend | Customer Session Checkout Modal component (locate in `frontend/src/features/`) | Replace simple payment input with `MultiPaymentInput`      |
| Frontend | `packages/ui/src/components/ui/MultiPaymentInput.tsx`                         | Any props adjustments needed for modal context             |
| Types    | `frontend/src/types/electron.d.ts`                                            | Update if checkout payload shape changes                   |

---

## Summary

| Priority  | Total  | Done | Remaining |
| --------- | ------ | ---- | --------- |
| High      | 4      | 0    | 4         |
| Medium    | 2      | 0    | 2         |
| Low       | 1      | 0    | 1         |
| Bug       | 1      | 0    | 1         |
| **Total** | **8**  | **0** | **8**    |

---

> **Recommendation:** Start with LIRA-052 (Binance bug) and LIRA-055 (Checkout Modal) — LIRA-052 is a correctness bug affecting financial accuracy, and LIRA-055 is high-impact for the core POS flow.
