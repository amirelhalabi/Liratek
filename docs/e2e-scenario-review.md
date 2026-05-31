# E2E Scenario Review — Component-Level Test Catalog

This document captures the component-level E2E test catalog, the review questions raised against it, and the resolved answers that should be applied before implementation begins.

---

## Original Component Catalog

### 1. MultiPaymentInput

**What it is:** Split-payment entry — add multiple payment lines (cash USD, cash LBP, OMT, Whish, card, customer account), validates totals, enforces non-negative values.

**Used in:** Expenses, Custom Services, Debts, Loto, Sessions, Maintenance, POS

| Scenario | Where (original) |
|----------|-----------------|
| Single payment line fills full amount | All 7 |
| Split across cash USD + cash LBP | Expenses, Custom Services, Maintenance, POS |
| Add CUSTOMER_ACCOUNT line — only when client attached | Debts, Custom Services (C3/C4 only) |
| Customer account auto-selected when client is picked | Recharge, Sessions |
| Remove a payment line | All |
| Total exceeds invoice amount → submit blocked | All |
| Total is zero → submit blocked | All |
| Partial payment creates debt entry | Debts, Custom Services, Maintenance |

---

### 2. ClientAutocompleteInput

**What it is:** Searchable dropdown — type name or phone, returns matching saved clients, fires callback on selection.

**Used in:** Recharge (x4), Custom Services, Debts, Sessions

| Scenario | Where (original) |
|----------|-----------------|
| Search by partial name → results appear | All |
| Search by phone number → results appear | All |
| Select result → parent form autofills name/phone | Recharge forms, Custom Services |
| No results → empty state shown | All |
| Clear selection → form resets | Recharge, Custom Services |
| Session already has client → field pre-populated | Recharge (C4), Custom Services (C4) |
| Client has open debt → debt badge visible | Debts |

---

### 3. SaveAsClientCheckbox

**What it is:** Checkbox that appears when name/phone are manually entered but no saved client selected. On submit, creates a new client record.

**Used in:** Recharge, Maintenance, Custom Services, Sessions

| Scenario | Where (original) |
|----------|-----------------|
| Hidden when client selected via autocomplete (C3/C4) | Recharge, Custom Services, Maintenance |
| Visible when name/phone typed manually (C1/C2) | All 4 |
| Checked + submit → new client appears in Clients module | Recharge, Custom Services, Maintenance |
| Unchecked + submit → no client created | All |
| Duplicate name/phone → warning shown, checkbox disabled | All |

---

### 4. TransactionTimeOverride

**What it is:** Collapsible widget — defaults to now, lets user pick a past datetime, blocks future dates.

**Used in:** Recharge (x5), Custom Services, Exchange, Expenses, Maintenance, Loto, POS

| Scenario | Where (original) |
|----------|-----------------|
| Collapsed by default → shows "now" | All |
| Expand, pick a past date/time → saved on submit | Recharge, Custom Services, Exchange |
| Pick a future date/time → blocked | All |
| Collapse after picking → value retained | All |
| Submit without changing → timestamp is today | All |
| Override date shows correctly in history table | Recharge history, Custom Services history |

---

### 5. DataTable

**What it is:** Universal history/list table — sortable columns, pagination, multi-row select (shift+click), export to Excel/PDF.

**Used in:** 17 locations

| Scenario | Where (original) |
|----------|-----------------|
| Render list → rows appear correctly | Recharge history, Maintenance history |
| Sort by column ascending/descending | Exchange history, Expenses history |
| Pagination → navigate pages | Custom Services history |
| Shift+click multi-row select | Debts, Inventory |
| Export to Excel → file downloads | Recharge, Maintenance |
| Export to PDF → file downloads | Recharge, Maintenance |
| Empty state → "no records" message | Any fresh module |
| Date range filter narrows rows | Exchange, Expenses |

---

### 6. DateRangeFilter

**What it is:** Two date inputs (From / To) that filter the history table in real time.

**Used in:** Recharge, Custom Services, Exchange, Expenses, Loto, Maintenance, Sessions

| Scenario | Where (original) |
|----------|-----------------|
| Set From date → older rows disappear | Recharge, Expenses |
| Set To date → newer rows disappear | Exchange, Maintenance |
| From > To → table empties or error shown | Any |
| Clear both dates → all rows return | Any |
| Boundary date (From = To) → only that day's rows | Custom Services |

---

### 7. EditHistoryPopover

**What it is:** "Edited" badge on a row — click to open popover showing a timeline of field changes (before → after).

**Used in:** Recharge history, Custom Services history, Exchange history, Expenses history, Maintenance history

| Scenario | Where (original) |
|----------|-----------------|
| Popover opens on click | Recharge, Expenses |
| Shows correct before/after values | Custom Services, Exchange |
| Multiple edits show full timeline | Maintenance |
| Record never edited → badge hidden | Any |

---

### 8. ConfirmModal

**What it is:** Reusable danger/warning/info confirmation dialog before destructive actions.

**Used in:** Inventory (delete product), POS (void sale, remove cart item), and other modules with void actions

| Scenario | Where (original) |
|----------|-----------------|
| Opens on destructive action click | Inventory delete, POS void |
| Cancel → nothing changes | All |
| Confirm → action executes | Inventory delete |
| Keyboard focus works after close (Electron Windows bug) | All |
| Danger variant shows red styling | Void actions (vague) |

---

### 9. CheckoutModal

**What it is:** POS checkout modal — multi-currency payment, client search, transaction time override. Reused by Maintenance.

**Used in:** POS, Maintenance

| Scenario | POS | Maintenance |
|----------|-----|-------------|
| Assign client mid-checkout (C1 → client selected) | ✓ | ✓ |
| Payment method auto-switches to CUSTOMER_ACCOUNT | ✓ | ✓ |
| Partial payment → debt created | ✓ | ✓ |
| Override transaction time before submitting | ✓ | ✓ |

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

| Scenario | Change |
|----------|--------|
| S2 (MultiPaymentInput split) | Expand to all 7 |
| S3 (CUSTOMER_ACCOUNT line) | Expand to Debts, Custom Services, Sessions, Maintenance, POS |
| S4 (auto-select CUSTOMER_ACCOUNT) | Verify and clarify which modules wire client → payment auto-switch |
| S8 (partial payment → debt) | Add Sessions and POS; keep Expenses and Loto excluded |
| S11, S13 (ClientAutocomplete autofill + clear) | Expand to all 6 locations |
| S14 (pre-populated from session) | Verify if Debts is session-aware; Sessions itself stays excluded |
| S15 (debt badge) | Expand to all 6 unless design decision says otherwise |
| S16, S18 (SaveAsClientCheckbox) | Add Sessions to both |
| S22 (TransactionTimeOverride past date) | Expand to all 8 locations |
| S26 (override shows in history) | Expand to all 7 history locations |
| S30 (DataTable multi-select) | Confirm which modules have multi-select enabled |
| S31/S32 (DataTable export) | Add 1 more representative location |
| S34 (DataTable date range) | Align with all 7 DateRangeFilter locations |
| S40 (EditHistoryPopover opens) | Expand to all 5 locations |
| S44 (ConfirmModal opens) | Replace "any" with explicit verified module list |
| S46 (ConfirmModal confirms) | Add POS void sale |
| S48 (ConfirmModal danger variant) | Replace "void actions" with specific module list |
