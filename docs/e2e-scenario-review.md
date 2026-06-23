# E2E Scenario Review — Component-Level Test Catalog

This document captures the component-level E2E test catalog, the review questions raised against it, and the resolved answers that should be applied before implementation begins.

---

## Original Component Catalog

### 1. MultiPaymentInput

**What it is:** Split-payment entry — add multiple payment lines (cash USD, cash LBP, OMT, Whish, card, customer account), validates totals, enforces non-negative values.

**Used in:** Expenses, Custom Services, Debts, Loto, Sessions, Maintenance, POS

| Scenario                                              | Where (original)                            |
| ----------------------------------------------------- | ------------------------------------------- |
| Single payment line fills full amount                 | All 7                                       |
| Split across cash USD + cash LBP                      | Expenses, Custom Services, Maintenance, POS |
| Add CUSTOMER_ACCOUNT line — only when client attached | Debts, Custom Services (C3/C4 only)         |
| Customer account auto-selected when client is picked  | Recharge, Sessions                          |
| Remove a payment line                                 | All                                         |
| Total exceeds invoice amount → submit blocked         | All                                         |
| Total is zero → submit blocked                        | All                                         |
| Partial payment creates debt entry                    | Debts, Custom Services, Maintenance         |

---

### 2. ClientAutocompleteInput

**What it is:** Searchable dropdown — type name or phone, returns matching saved clients, fires callback on selection.

**Used in:** Recharge (x4), Custom Services, Debts, Sessions

| Scenario                                         | Where (original)                    |
| ------------------------------------------------ | ----------------------------------- |
| Search by partial name → results appear          | All                                 |
| Search by phone number → results appear          | All                                 |
| Select result → parent form autofills name/phone | Recharge forms, Custom Services     |
| No results → empty state shown                   | All                                 |
| Clear selection → form resets                    | Recharge, Custom Services           |
| Session already has client → field pre-populated | Recharge (C4), Custom Services (C4) |
| Client has open debt → debt badge visible        | Debts                               |

---

### 3. SaveAsClientCheckbox

**What it is:** Checkbox that appears when name/phone are manually entered but no saved client selected. On submit, creates a new client record.

**Used in:** Recharge, Maintenance, Custom Services, Sessions

| Scenario                                                | Where (original)                       |
| ------------------------------------------------------- | -------------------------------------- |
| Hidden when client selected via autocomplete (C3/C4)    | Recharge, Custom Services, Maintenance |
| Visible when name/phone typed manually (C1/C2)          | All 4                                  |
| Checked + submit → new client appears in Clients module | Recharge, Custom Services, Maintenance |
| Unchecked + submit → no client created                  | All                                    |
| Duplicate name/phone → warning shown, checkbox disabled | All                                    |

---

### 4. TransactionTimeOverride

**What it is:** Collapsible widget — defaults to now, lets user pick a past datetime, blocks future dates.

**Used in:** Recharge (x5), Custom Services, Exchange, Expenses, Maintenance, Loto, POS

| Scenario                                        | Where (original)                          |
| ----------------------------------------------- | ----------------------------------------- |
| Collapsed by default → shows "now"              | All                                       |
| Expand, pick a past date/time → saved on submit | Recharge, Custom Services, Exchange       |
| Pick a future date/time → blocked               | All                                       |
| Collapse after picking → value retained         | All                                       |
| Submit without changing → timestamp is today    | All                                       |
| Override date shows correctly in history table  | Recharge history, Custom Services history |

---

### 5. DataTable

**What it is:** Universal history/list table — sortable columns, pagination, multi-row select (shift+click), export to Excel/PDF.

**Used in:** 17 locations

| Scenario                            | Where (original)                      |
| ----------------------------------- | ------------------------------------- |
| Render list → rows appear correctly | Recharge history, Maintenance history |
| Sort by column ascending/descending | Exchange history, Expenses history    |
| Pagination → navigate pages         | Custom Services history               |
| Shift+click multi-row select        | Debts, Inventory                      |
| Export to Excel → file downloads    | Recharge, Maintenance                 |
| Export to PDF → file downloads      | Recharge, Maintenance                 |
| Empty state → "no records" message  | Any fresh module                      |
| Date range filter narrows rows      | Exchange, Expenses                    |

---

### 6. DateRangeFilter

**What it is:** Two date inputs (From / To) that filter the history table in real time.

**Used in:** Recharge, Custom Services, Exchange, Expenses, Loto, Maintenance, Sessions

| Scenario                                         | Where (original)      |
| ------------------------------------------------ | --------------------- |
| Set From date → older rows disappear             | Recharge, Expenses    |
| Set To date → newer rows disappear               | Exchange, Maintenance |
| From > To → table empties or error shown         | Any                   |
| Clear both dates → all rows return               | Any                   |
| Boundary date (From = To) → only that day's rows | Custom Services       |

---

### 7. EditHistoryPopover

**What it is:** "Edited" badge on a row — click to open popover showing a timeline of field changes (before → after).

**Used in:** Recharge history, Custom Services history, Exchange history, Expenses history, Maintenance history

| Scenario                           | Where (original)          |
| ---------------------------------- | ------------------------- |
| Popover opens on click             | Recharge, Expenses        |
| Shows correct before/after values  | Custom Services, Exchange |
| Multiple edits show full timeline  | Maintenance               |
| Record never edited → badge hidden | Any                       |

---

### 8. ConfirmModal

**What it is:** Reusable danger/warning/info confirmation dialog before destructive actions.

**Used in:** Inventory (delete product), POS (void sale, remove cart item), and other modules with void actions

| Scenario                                                | Where (original)           |
| ------------------------------------------------------- | -------------------------- |
| Opens on destructive action click                       | Inventory delete, POS void |
| Cancel → nothing changes                                | All                        |
| Confirm → action executes                               | Inventory delete           |
| Keyboard focus works after close (Electron Windows bug) | All                        |
| Danger variant shows red styling                        | Void actions (vague)       |

---

### 9. CheckoutModal

**What it is:** POS checkout modal — multi-currency payment, client search, transaction time override. Reused by Maintenance.

**Used in:** POS, Maintenance

| Scenario                                          | POS | Maintenance |
| ------------------------------------------------- | --- | ----------- |
| Assign client mid-checkout (C1 → client selected) | ✓   | ✓           |
| Payment method auto-switches to CUSTOMER_ACCOUNT  | ✓   | ✓           |
| Partial payment → debt created                    | ✓   | ✓           |
| Override transaction time before submitting       | ✓   | ✓           |

---

## Review Questions & Resolved Answers

### MultiPaymentInput

**Q — S2: Split USD + LBP listed only for Expenses, Custom Services, Maintenance, POS. Why not Debts, Loto, Sessions?**
→ **Expand to all 7.** Splitting between cash currencies is a general capability. Debts, Loto, and Sessions have no technical reason to exclude it.

**Q — S3: CUSTOMER_ACCOUNT line listed only for Debts and Custom Services. Should it be broader?**
→ **Partially correct.** CUSTOMER_ACCOUNT only appears when a client is attached. Correct scope is every module where a client can be attached AND MultiPaymentInput is present: **Debts, Custom Services, Sessions, Maintenance, POS**. Expenses and Loto don't attach clients — correctly excluded.

**Q — S4: Auto-select CUSTOMER_ACCOUNT when client picked — why only Recharge and Sessions?**
→ **Needs clarification.** This UX behavior should fire everywhere a client can be selected alongside a payment input. Confirm which modules actually wire client selection to payment method auto-switching. Likely scope: **Debts, Custom Services, Sessions, Maintenance, POS**. Recharge inclusion needs verification.

**Q — S8: Partial payment → debt created, listed only for Debts, Custom Services, Maintenance. What about POS, Sessions, Loto, Expenses?**
→ **Expenses: correctly excluded** — expenses are outgoing payments, no receivable debt is generated.
→ **Loto: correctly excluded** — payouts are one-directional, debt concept doesn't apply.
→ **Sessions: add** — partial checkout of a session should create a debt.
→ **POS: add** — partial checkout at POS clearly creates a debt.

---

### ClientAutocompleteInput

**Q — S11: Select result → autofills name/phone. Why not Debts and Sessions?**
→ **Oversight. Expand to all 6 locations.** Selecting a debtor in Debts or a client in Sessions should autofill the same way.

**Q — S13: Clear selection → form resets. Why not Debts and Sessions?**
→ **Oversight. Expand to all 6 locations.** If selection triggers autofill, clearing should reset — applies everywhere.

**Q — S14: Session client → field pre-populated. Why not Debts and Sessions itself?**
→ **Sessions itself: correctly excluded** — the session start modal is the source of the client, it can't pre-populate from itself.
→ **Debts: verify** — depends on whether the debt repayment form reads session context. Add if session-aware; leave out if not.

**Q — S15: Debt badge visible — why only Debts?**
→ **Product decision.** The badge is technically possible everywhere a client is selected. Recommend expanding to all 6 locations — cashiers benefit from the debt warning in Recharge, Custom Services, and Sessions. Override only if there's a deliberate design reason to suppress it elsewhere.

---

### SaveAsClientCheckbox

**Q — S16: Hidden when C3/C4 — Sessions excluded. Why?**
→ **Oversight. Add Sessions.** Sessions is explicitly listed as one of the 4 locations the component is used in. The hide/show behavior applies equally there.

**Q — S18: Checked + submit → new client created — Sessions excluded. Why?**
→ **Oversight. Add Sessions.** Same reasoning as S16.

---

### TransactionTimeOverride

**Q — S22: Pick past date → saved on submit. Only Recharge, Custom Services, Exchange. Why not the other 5?**
→ **Oversight. Expand to all 8 locations.** The widget behaves identically everywhere. Testing only 3 gives false coverage. Correct scope: **Recharge (x5), Custom Services, Exchange, Expenses, Maintenance, Loto, POS**.

**Q — S26: Override date shows in history. Only Recharge and Custom Services. Why not the other 5?**
→ **Oversight. Expand to all 7 locations that have both TransactionTimeOverride and a history table:** Recharge, Custom Services, Exchange, Expenses, Maintenance, Loto, POS.

---

### DataTable

**Q — S27–S34: Most scenarios only cover 2–3 of 17 locations. Is the sampling sufficient?**
→ **Acceptable if DataTable is fully shared** (same sorting, export, and pagination config across all modules). If the component has per-module configuration differences, each configured variant needs its own test. Specific notes:

- **S30 (shift+click multi-select):** Only valid in modules where multi-select is enabled. Confirm which modules have it — if only Debts and Inventory, those are correct.
- **S31/S32 (export):** Add at least one more representative location to confirm export is not module-specific.
- **S34 (date range filter):** Align with all 7 DateRangeFilter locations, not just Exchange and Expenses.

---

### DateRangeFilter

**Q — S35/S36/S39: Why only 2 locations each when the filter is used in 7?**
→ **Acceptable as-is** if the filter is a fully shared component with no per-module configuration. Risk is low (filter-only, read-only). Ensure the 2 chosen locations cover different data types if timestamps and date-only fields differ across modules.

---

### EditHistoryPopover

**Q — S40: Popover opens on click — only Recharge and Expenses out of 5 locations. Why?**
→ **Expand to all 5.** "Popover opens" is the most basic assertion. Skipping 3 of 5 locations means broken popovers in those modules go undetected.

**Q — S41: Correct values — only Custom Services and Exchange. Acceptable?**
→ **Acceptable** as a representative sample for correctness. 2 of 5 is sufficient.

**Q — S42: Multiple edits timeline — only Maintenance. Acceptable?**
→ **Acceptable.** One representative location is enough for this edge case.

---

### ConfirmModal

**Q — S44: Opens on destructive action — "any module with a void action" is vague. Which modules?**
→ **Replace with explicit list.** Based on active modules, confirm which actually use ConfirmModal: likely **Inventory (delete product), POS (void sale, remove cart item), Custom Services (void service), Maintenance (cancel job)**. Verify and lock down the list before implementation.

**Q — S46: Confirm → action executes — why only Inventory delete?**
→ **Add POS void sale** at minimum. Testing confirmation in one location is insufficient — two locations needed to prove it's not module-specific.

**Q — S48: Danger variant red styling — "void actions" is vague. Which modules?**
→ **Replace with specific modules:** POS void sale, Inventory delete product (and any others confirmed in S44 that render the danger variant).

---

## Change Summary Table

| Scenario                                       | Change                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| S2 (MultiPaymentInput split)                   | Expand to all 7                                                    |
| S3 (CUSTOMER_ACCOUNT line)                     | Expand to Debts, Custom Services, Sessions, Maintenance, POS       |
| S4 (auto-select CUSTOMER_ACCOUNT)              | Verify and clarify which modules wire client → payment auto-switch |
| S8 (partial payment → debt)                    | Add Sessions and POS; keep Expenses and Loto excluded              |
| S11, S13 (ClientAutocomplete autofill + clear) | Expand to all 6 locations                                          |
| S14 (pre-populated from session)               | Verify if Debts is session-aware; Sessions itself stays excluded   |
| S15 (debt badge)                               | Expand to all 6 unless design decision says otherwise              |
| S16, S18 (SaveAsClientCheckbox)                | Add Sessions to both                                               |
| S22 (TransactionTimeOverride past date)        | Expand to all 8 locations                                          |
| S26 (override shows in history)                | Expand to all 7 history locations                                  |
| S30 (DataTable multi-select)                   | Confirm which modules have multi-select enabled                    |
| S31/S32 (DataTable export)                     | Add 1 more representative location                                 |
| S34 (DataTable date range)                     | Align with all 7 DateRangeFilter locations                         |
| S40 (EditHistoryPopover opens)                 | Expand to all 5 locations                                          |
| S44 (ConfirmModal opens)                       | Replace "any" with explicit verified module list                   |
| S46 (ConfirmModal confirms)                    | Add POS void sale                                                  |
| S48 (ConfirmModal danger variant)              | Replace "void actions" with specific module list                   |

---

## Implementation Status

Reflects changes merged to main after the review above.

### Implemented

| Scenario                                            | What changed                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S11 — ClientAutocomplete autofills name/phone       | Custom Services, Debts, Sessions: replaced custom inline search with `<ClientAutocompleteInput>` — autofill now works in all 6 locations                                                       |
| S13 — Clear selection → form resets                 | Custom Services, Debts, Sessions: clear on `<ClientAutocompleteInput>` resets the form; Sessions clear button also calls `resetSaveAsClient()`                                                 |
| S15 — Debt badge visible                            | `ClientAutocompleteInput` gained `showDebtBadge?: boolean`; passed as `showDebtBadge` in Custom Services, Debts, Sessions — badge now appears in all locations, not just Debts                 |
| S3 — CUSTOMER_ACCOUNT line when client attached     | Custom Services: `paymentInputKey` + `paymentInitialMethod` state added; selecting a client via autocomplete remounts `MultiPaymentInput` with `initialMethod = CUSTOMER_ACCOUNT` if available |
| S4 — Auto-switch to CUSTOMER_ACCOUNT on client pick | Custom Services: wired up (see S3 above). Clear client resets payment method to default.                                                                                                       |
| S16 — SaveAsClientCheckbox hidden when C3/C4        | Sessions: already present in `StartSessionModal`; clear button now also calls `resetSaveAsClient()` confirming the hide/show cycle works                                                       |
| S18 — Checked + submit → new client created         | Sessions: confirmed already handled by `StartSessionModal`                                                                                                                                     |

### Correctly Excluded (not implemented by design)

| Scenario                                | Reason                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S4 — auto-switch in Debts               | Debts operates on already-selected clients — there is no "pick a client then pay" flow; payment input is independent                                                                       |
| S4 — auto-switch in Maintenance         | Maintenance delegates payment to `CheckoutModal`, which handles this internally                                                                                                            |
| S4 — auto-switch in POS                 | POS already handled inside `CheckoutModal`                                                                                                                                                 |
| S8 — partial payment → debt in Sessions | Frontend (`SessionCheckoutModal`) already supports CUSTOMER_ACCOUNT per item; debt creation on partial payment is a backend concern in the session checkout handler, not a frontend change |
| S8 — partial payment → debt in Loto     | Payouts are one-directional; debt concept does not apply                                                                                                                                   |
| S8 — partial payment → debt in Expenses | Expenses are outgoing payments; no receivable debt is generated                                                                                                                            |

### Still Open (not yet addressed)

All items resolved — see section below.

---

## Resolution of Still-Open Items

### S2 — Split USD + LBP in Debts, Loto, Sessions

**Investigation findings:**

- **Debts**: `MultiPaymentInput` rendered with no `maxLines` or restricting props — split payment fully supported.
- **Loto**: Same — no restrictions in either the ticket sale form or the settlement/payout modal.
- **Sessions**: Does NOT use `MultiPaymentInput` at all. Payment is set per-cart-item via individual dropdowns, not a shared payment input.

**Decision:** Expand S2 to include Debts and Loto. Sessions correctly excluded — the component is absent.
**Final scope: Expenses, Custom Services, Maintenance, POS, Debts, Loto (all 6 that use MultiPaymentInput).**

---

### S8 — Partial payment → debt in POS

**Investigation findings:**
`SalesRepository` (packages/core/src/repositories/SalesRepository.ts) creates a `debt_ledger` entry automatically when `final_amount - totalPaidUSD > $0.05`, provided a `client_id` is present. Anonymous sales cannot create debt.

**Decision:** Add POS to S8. Test requires a client to be attached (C3/C4 context). Correctly excluded for anonymous/C1 checkouts.
**Final scope for S8: Debts, Custom Services, Maintenance, POS (with client attached).**

---

### S8 — Partial payment → debt in Sessions

**Investigation findings:**
The session checkout handler delegates each cart item to its individual module handler (sales, recharge, custom-service, etc.). Debt creation happens at the module level, not the session level. Sessions does not independently insert into `debt_ledger`.

**Decision:** Sessions correctly excluded from S8 as a direct scenario. POS-within-session debt is already covered by the POS scenario above.

---

### S14 — Debts pre-populated from session context

**Investigation findings:**
`Debts/index.tsx` has no `useSession()` call, no `SessionContext` import, and no `activeSession` variable. The credit/repay modal requires explicit client selection — it is entirely session-agnostic.

**Decision:** Debts correctly excluded from S14. No pre-population from session context exists.

---

### S22 — TransactionTimeOverride past date in all locations

No code investigation needed — doc update only.
**Final scope: all 8 locations — Recharge (x5 forms), Custom Services, Exchange, Expenses, Maintenance, Loto, POS.**

---

### S26 — Override date shows correctly in history

No code investigation needed — doc update only.
**Final scope: all 7 history locations — Recharge, Custom Services, Exchange, Expenses, Maintenance, Loto, POS.**

---

### S30 — DataTable multi-select: which modules

**Investigation findings:**

- **Inventory / ProductList**: passes `onShiftSelect` prop → true shift+click range select enabled.
- **Settings / CategoriesManager**: passes `selectAll` prop only → select-all/deselect-all, no shift+click range.
- **Debts**: no `onShiftSelect` or `selectAll` prop — was incorrectly listed in the original catalog.
- All other modules (Loto, Sessions, Recharge, etc.): no multi-select props.

**Decision:** S30 scope corrected to **Inventory (ProductList) only**. Debts removed. CategoriesManager gets a separate note: select-all is present but shift+click range is not.

---

### S34 — DataTable date range filter in all DateRangeFilter locations

No code investigation needed — doc update only.
**Final scope: all 7 locations — Recharge, Custom Services, Exchange, Expenses, Loto, Maintenance, Sessions.**

---

### S40 — EditHistoryPopover opens in all 5 locations

No code investigation needed — doc update only.
**Final scope: all 5 locations — Recharge, Custom Services, Exchange, Expenses, Maintenance.**

---

### S44 — ConfirmModal: explicit module list

**Investigation findings:**
ConfirmModal appears in exactly 3 files for 4 distinct destructive actions:

1. **Inventory / ProductList** — delete single product (`danger`)
2. **Inventory / ProductList** — batch delete selected products (`danger`)
3. **POS / SaleDetailModal** — refund sale (`danger`)
4. **POS / index** — clear cart (`danger`)

All 4 usages use the `danger` variant. No `warning` or `info` variants exist in the codebase currently.

**Decision:** Replace "any module with a void action" with the explicit list above.

---

### S46 — ConfirmModal confirm executes: add POS

**Decision:** Expand to cover both Inventory delete and POS refund sale. POS clear cart is also a candidate.

---

### S48 — ConfirmModal danger variant: specific modules

**Decision:** All 4 usages are `danger` — Inventory delete, Inventory batch delete, POS refund sale, POS clear cart. Replace vague "void actions" with this list.

---

## Final Corrected Scenario Catalog

This section is the authoritative, updated version of the catalog with all review decisions applied. Use this as the source of truth for test implementation.

### MultiPaymentInput

| #   | Scenario                                             | Locations                                                                                         |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| S1  | Single payment line fills full amount                | All 6 (Expenses, Custom Services, Debts, Loto, Maintenance, POS)                                  |
| S2  | Split across cash USD + cash LBP                     | All 6                                                                                             |
| S3  | CUSTOMER_ACCOUNT line appears when client attached   | Debts, Custom Services, Sessions, Maintenance, POS                                                |
| S4  | Customer account auto-selected when client is picked | Custom Services (implemented); Debts/Maintenance/POS delegate to CheckoutModal; Sessions per-item |
| S5  | Remove a payment line                                | All 6                                                                                             |
| S6  | Total exceeds invoice amount → submit blocked        | All 6                                                                                             |
| S7  | Total is zero → submit blocked                       | All 6                                                                                             |
| S8  | Partial payment creates debt entry                   | Debts, Custom Services, Maintenance, POS (client must be attached; threshold > $0.05)             |

> Sessions excluded from S1–S8: does not use `MultiPaymentInput` — payment is per-cart-item.

---

### ClientAutocompleteInput

| #   | Scenario                                         | Locations                                                                                           |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| S9  | Search by partial name → results appear          | All 6 (Recharge x4, Custom Services, Debts, Sessions)                                               |
| S10 | Search by phone number → results appear          | All 6                                                                                               |
| S11 | Select result → parent form autofills name/phone | All 6                                                                                               |
| S12 | No results → empty state shown                   | All 6                                                                                               |
| S13 | Clear selection → form resets                    | All 6                                                                                               |
| S14 | Session client → field pre-populated (C4)        | Recharge (C4), Custom Services (C4) only — Debts is session-agnostic, Sessions itself is the source |
| S15 | Client has open debt → debt badge visible        | All 6 (`showDebtBadge` prop passed everywhere)                                                      |

---

### SaveAsClientCheckbox

| #   | Scenario                                                | Locations                                        |
| --- | ------------------------------------------------------- | ------------------------------------------------ |
| S16 | Hidden when client selected via autocomplete (C3/C4)    | Recharge, Custom Services, Maintenance, Sessions |
| S17 | Visible when name/phone typed manually (C1/C2)          | Recharge, Custom Services, Maintenance, Sessions |
| S18 | Checked + submit → new client in Clients module         | Recharge, Custom Services, Maintenance, Sessions |
| S19 | Unchecked + submit → no client created                  | All 4                                            |
| S20 | Duplicate name/phone → warning shown, checkbox disabled | All 4                                            |

---

### TransactionTimeOverride

| #   | Scenario                                        | Locations                                                                                        |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| S21 | Collapsed by default → shows "now"              | All 8 (Recharge x5, Custom Services, Exchange, Expenses, Maintenance, Loto, POS)                 |
| S22 | Expand, pick a past date/time → saved on submit | All 8                                                                                            |
| S23 | Pick a future date/time → blocked               | All 8                                                                                            |
| S24 | Collapse after picking → value retained         | All 8                                                                                            |
| S25 | Submit without changing → timestamp is today    | All 8                                                                                            |
| S26 | Override date shows correctly in history table  | Recharge, Custom Services, Exchange, Expenses, Maintenance, Loto, POS (all 7 with history views) |

---

### DataTable

| #   | Scenario                            | Locations                                                                          |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| S27 | Render list → rows appear correctly | Recharge, Maintenance (representative)                                             |
| S28 | Sort by column ascending/descending | Exchange, Expenses (representative)                                                |
| S29 | Pagination → navigate pages         | Custom Services (large dataset)                                                    |
| S30 | Shift+click multi-row select        | Inventory / ProductList only (only module with `onShiftSelect` enabled)            |
| S31 | Export to Excel → file downloads    | Recharge, Maintenance, + 1 additional                                              |
| S32 | Export to PDF → file downloads      | Recharge, Maintenance, + 1 additional                                              |
| S33 | Empty state → "no records" message  | Any fresh module                                                                   |
| S34 | Date range filter narrows rows      | Recharge, Custom Services, Exchange, Expenses, Loto, Maintenance, Sessions (all 7) |

> CategoriesManager (Settings): has select-all checkbox but NOT shift+click range select — test select-all separately, do not group with S30.

---

### DateRangeFilter

| #   | Scenario                                         | Locations                              |
| --- | ------------------------------------------------ | -------------------------------------- |
| S35 | Set From date → older rows disappear             | Recharge, Expenses (representative)    |
| S36 | Set To date → newer rows disappear               | Exchange, Maintenance (representative) |
| S37 | From > To → table empties or error shown         | Any                                    |
| S38 | Clear both dates → all rows return               | Any                                    |
| S39 | Boundary date (From = To) → only that day's rows | Custom Services                        |

---

### EditHistoryPopover

| #   | Scenario                           | Locations                                                          |
| --- | ---------------------------------- | ------------------------------------------------------------------ |
| S40 | Popover opens on click             | All 5 (Recharge, Custom Services, Exchange, Expenses, Maintenance) |
| S41 | Shows correct before/after values  | Custom Services, Exchange (representative)                         |
| S42 | Multiple edits show full timeline  | Maintenance                                                        |
| S43 | Record never edited → badge hidden | Any                                                                |

---

### ConfirmModal

| #   | Scenario                                                | Locations                                                                         |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| S44 | Opens on destructive action click                       | Inventory delete product, Inventory batch delete, POS refund sale, POS clear cart |
| S45 | Cancel → nothing changes                                | All 4                                                                             |
| S46 | Confirm → action executes                               | Inventory delete product, POS refund sale                                         |
| S47 | Keyboard focus works after close (Electron Windows bug) | All 4                                                                             |
| S48 | Danger variant shows red styling                        | All 4 (all usages are `danger`)                                                   |

---

### CheckoutModal

| #   | Scenario                                          | POS | Maintenance |
| --- | ------------------------------------------------- | --- | ----------- |
| S49 | Assign client mid-checkout (C1 → client selected) | ✓   | ✓           |
| S50 | Payment method auto-switches to CUSTOMER_ACCOUNT  | ✓   | ✓           |
| S51 | Partial payment → debt created                    | ✓   | ✓           |
| S52 | Override transaction time before submitting       | ✓   | ✓           |
