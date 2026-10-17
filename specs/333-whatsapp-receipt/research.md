# Research: Send the receipt on WhatsApp (LIRA-333)

Every decision below is grounded in code read on 2026-10-17. Line numbers are approximate and will drift.

## R1 — One receipt description, built from the saved sale

**Decision**: add `frontend/src/features/sales/utils/saleReceipt.ts` with one builder:

```text
buildSaleReceiptData(sale: SaleDetail, items: SaleItem[], shop: ShopInfo) → ReceiptData
```

It reads only the saved sale (through `api.getSale` + `api.getSaleItems`).

Three places use it:
- the post-sale strip (Print and Send);
- the details window (Print and Send);
- the details window's existing `handlePrintReceipt`. Its inline `ReceiptData` literal (SaleDetailModal.tsx ~L571–602) is deleted in favour of the builder.

**Rationale**:
- FR-006, FR-007 and SC-003 require identical text for the same sale right after completion and later.
- `CheckoutModal.getReceiptData()` (~L794) cannot provide that. It uses `timestamp: new Date().toISOString()`, an empty receipt number for a new sale (`saleId` is null until saved), checkout state for the client, and unsaved `warranty_months`.
- `processSale` returns `result.id` (POS/index.tsx ~L699), so the strip can load the saved sale.

**Checkout's pre-save "Receipt Preview / Print"** (inside the checkout window, before saving) keeps its existing path. It is a different document: it has no number and the sale is not yet saved. The spec does not offer WhatsApp there (FR-003). The strip's Print uses the saved builder, so after Complete Sale every printout of a sale comes from the one description.

**Alternatives rejected**:
- (a) Make checkout's builder the shared one. It cannot know the receipt number or the saved time.
- (b) Build the receipt text in core. Date formatting must use the cashier's device (rule 27, spec Assumptions), and `receiptFormatter.ts` uses `toLocaleDateString()`/`toLocaleString()` in the renderer.

## R2 — What "paid" means on a saved sale

**Finding (certain, from code)**: `SalesRepository.processSale` derives `sales.paid_usd`/`paid_lbp` with `sumPayments` (~L700–720). That function skips OUT legs and every non-drawer method (`isDrawerAffectingMethod`; `NON_DRAWER_METHODS = {CUSTOMER_ACCOUNT, GIFT_CARD}` in `utils/payments.ts`).
- Non-drawer IN legs get **no `payments` row** (~L1531–1533).
- The reprint's "Paid USD/LBP" therefore already excludes the on-account portion and gift cards. It simply never prints them.
- Checkout's `tenderUSD/LBP` excludes only `CUSTOMER_ACCOUNT` (`isTenderLeg`, ~L359). It counts a gift card as paid.

So the two printouts disagree in two ways: the reprint has no account line, and the reprint drops the gift-card amount.

**Further finding (certain, from code): `sales.paid_usd` changes after the sale.** `DebtRepository.addRepayment` → `_markSalesPaidFIFO` runs `UPDATE sales SET paid_usd = paid_usd + ?` when the client later repays (documented at SalesRepository ~L4070–4080, LIRA-244). A receipt built from `sales.paid_*` therefore changes after a repayment, which breaks SC-003. **The current reprint already drifts this way; this is an existing defect that the shared builder fixes, and the owner should be told.**

By contrast, the sale's own `payments` rows are posted once, at sale time, and never touched again (same LIRA-244 comment). Non-cash change OUT legs are written as negative rows (`-amt`, ~L1601).

**Decision**: every figure comes from data that never changes after the sale.
- `payment_usd/lbp` (tender) = `SUM(payments.amount) WHERE transaction_id = <SALE txn> AND amount > 0`, per currency. Those are the IN legs.
- `gift_card_usd` is a new line, "Gift card: $X" (R3).
- `on_account_usd` is shown on its own line and never counted as paid (FR-008). It comes from the original charge only (R3).
- Change = `change_given_usd/lbp`, cash change only, as today. **Assumption (unverified):** these columns are never updated after the sale. T007 case (j) proves it.

Likely, based on the "Cash change uses the change_given path" comment: cash change may also write a negative CASH `payments` row. The `amount > 0` filter excludes it either way.

## R3 — Where the on-account and gift-card figures come from

**Finding**:
- **On account:** the account remainder is booked as a `debt_ledger` row with `transaction_type = 'Sale Debt'`, `transaction_id = <SALE txn id>` and `amount_lbp = null` (`bookClientDebtCharge`, SalesRepository ~L1779–1787). It is computed as `amountDue − (paid_usd + paid_lbp/rate)` in USD.
- **Gift cards:** a gift-card redemption sets `vouchers.redeemed_transaction_id = <txn id>`, with the face value in `vouchers.amount` (USD). Its value is deposited to the client as `CREDIT_DEPOSIT`. The gift-card shortfall is therefore **inside** the Sale Debt remainder, and the deposited credit offsets it (comment at ~L1555).

**Decision**: extend `SalesRepository.getSaleWithCustomer` (read-only, tenant-scoped, `?` binds) with three fields:
- `tender_usd`, `tender_lbp`, as in R2;
- `gift_card_usd` = `SUM(vouchers.amount)` where `redeemed_transaction_id` = the sale's SALE txn id;
- `on_account_usd` = `MAX(0, original 'Sale Debt' charge − gift_card_usd)`.

The original 'Sale Debt' charge is the positive (`amount_usd > 0`) 'Sale Debt' row(s) on the SALE txn id. Item-refund reversals (`_applySaleItemReversal`) re-post 'Sale Debt' rows with negated amounts, so they are excluded by sign. A repayment never edits the charge row; it posts against its own transaction.

All three predicates are defined once, as named SQL fragments (rule 14).

Every figure is USD-only, because that is how the debt is stored. **Owner-visible consequence:** an account portion taken in LBP at checkout prints as its USD equivalent on the saved receipt.

Likely, based on the code path above, this is exact and immutable for every current leg shape. The variant matrix test (T007) is the proof. It covers: cash only; USD+LBP; account-only; partial account; gift card; gift card + account; change in both currencies; discount; extra; **(j) on-account sale then a repayment**; and **(k) a partial item refund**. In (j) and (k) the receipt figures must be identical before and after. If any shape disagrees, the test fails before the builder ships (rule 28d). **Assumption (unverified):** item-refund reversal rows are negative and land on the SALE txn or a REFUND txn. (k) settles it.

**Session-basket sales (settled 2026-10-17 by T007 cases l/l2)**: a deferred sale writes no `payments` row and no Sale Debt on its own transaction, so `tender_*` would read 0 for a paid session item. The read therefore detects a session sale (`customer_session_transactions.unified_transaction_id` = the SALE txn) and, for that shape ONLY, reads `tender_* = sales.paid_*` (the basket's back-fill, `markSalePaid`) and `on_account_usd = MAX(0, final + extra − paid_usd − paid_lbp/rate)`. Limitation: these come from `paid_*`, so a later repayment that raises a session sale's `paid_*` would move them; non-session sales are immune.

**Implementation findings (2026-10-17, T007):**
- Gift card: `gift_card_usd = MIN(voucher face in USD, original Sale Debt charge)`. A voucher worth more than the sale is deposited whole, but only the part inside the remainder covered this sale (case f2: $25 voucher on a $15 sale shows "Gift card: $15"). An LBP voucher converts at the sale's saved rate. Known limit: a voucher worth more than the remainder AND an account part on the same sale cannot be told apart from the stored rows (the GIFT_CARD leg amount is not stored) — the account part would read low. No current checkout shape produces that.
- Case (j) confirmed: a repayment raises `sales.paid_usd` (premise asserted) and the receipt figures do not move.
- Case (k) confirmed: a partial item refund leaves every receipt figure unchanged (the original positive Sale Debt row is not edited).
- Case (e) confirmed: an LBP account leg reads as its USD equivalent.
- Case (m): a sale paid at the counter and then linked to an open session (POS `linkTransaction`) must NOT be read as a basket item. Today that link stores no unified id for sales, but if it did, the first draft of the session check would have read `paid_*` (seen failing: tender 10 instead of 4, gift 0, account 5). The session check is therefore "linked AND no positive payment AND no Sale Debt on the sale's transaction".
- Case (n): a For-Partner sale has no counter payment, no Sale Debt and no session link: the receipt shows "Paid USD: $0.00" and no account line — the same as the old reprint (`paid_usd` = 0 for these). The partner's debt is not printed on the customer receipt.

**Partly refunded sale**: the item refunds of the 'Sale Debt' share are separate negative rows (`_applySaleItemReversal`). See R7.

## R4 — Recipient number precedence (FR-012)

**Finding**: `getSaleWithCustomer` returns `COALESCE(c.phone_number, t.client_phone) AS client_phone`. That puts the linked client's phone first, which is the opposite of FR-012. Other screens show `client_phone`, so changing its meaning has a blast radius.

**Decision**: add two fields and leave `client_phone` as it is:
- `sale_phone` = `t.client_phone`
- `linked_client_phone` = `c.phone_number`

The recipient is `sale_phone ?? linked_client_phone ?? <typed>`, resolved by one helper, `recipientPhoneFor(sale)`, in `saleReceipt.ts`.

**Settled 2026-10-17 by T006:** for a linked client with no phone typed at checkout, `processSale` stamps the client's phone AS IT WAS at sale time on `transactions.client_phone`, so `sale_phone` is that snapshot (it wins over a later change on the client form, per FR-012's order). A walk-in sale needs a name to carry a phone (`client_phone requires client_name`), and processSale then auto-creates or matches a client from the name + phone, so a walk-in with a typed phone also gets a linked client.

Scenario US2-2 ("corrected phone on the sale's details is used") holds because `updateMetadata` writes `client_phone` to the transaction row. Likely, based on `SalesRepository.updateMetadata`: that edit path is gated to walk-in sales. For a linked client, the phone is corrected on the client form; it then wins only when the sale row's phone is empty. **Assumption (unverified):** linked-client sales stamp `transactions.client_phone` at sale time. T006 asserts it either way, and the helper's fallback covers an empty stamp.

## R5 — Opening WhatsApp outside LiraTek on both apps

**Finding**:
- `electron-app` has no `setWindowOpenHandler` / `will-navigate` handler (grep, non-test files). A renderer `window.open` would therefore create a LiraTek `BrowserWindow`, which violates FR-016.
- `shell.openExternal` exists only in the offline runtime (`main.ts` ~L285, `offlineHandlers.ts` ~L239). Screens cannot reach it.

**Decision**:
- **IPC channel `app:open-external`**, in a new `electron-app/handlers/appShellHandlers.ts`. It validates the payload with `openExternalUrlSchema` (core validators). It accepts only `https:` URLs whose host is in `WHATSAPP_HOSTS = ["wa.me", "api.whatsapp.com"]`. It calls `shell.openExternal(url)` and returns `{ success, error? }`.
- **No `requireRole`.** Any signed-in user may open a link. Opening touches no data, and the allow-list is the security boundary. (Electron's own `shell.openExternal` on an arbitrary URL is the risk; the allow-list closes it.)
- **Adapter `openExternalUrl(url)`** in `backendApi.ts`:
  - desktop → `window.api.app.openExternal({ url })`;
  - web → `const w = window.open(url, "_blank"); if (!w) return { success: false, error: "blocked" }; w.opener = null; return { success: true }`.

  Do NOT pass `"noopener"` in the features string: with it, `window.open` always returns `null`, so every click would read as blocked. Setting `w.opener = null` afterwards keeps both the isolation and the null-means-blocked signal (FR-018).
- **No REST route**: nothing reaches the server.

**Popup-gesture rule**: browsers allow a new tab only inside the click's synchronous call stack. The receipt data is therefore **prefetched** when the strip appears or the details window has loaded. The click handler is synchronous until `openExternalUrl` is called. The desktop arm may be async because IPC does not need a gesture.

**Alternatives rejected**:
- `setWindowOpenHandler` routing every `window.open` to `shell.openExternal`. This is global behaviour that could change other screens, and the print fallback window depends on `window.open`.
- `<a href target=_blank>`. It is the same gesture rule on web and does not solve desktop.

## R6 — Phone normalisation (FR-014/015)

**Finding**: `WhatsAppService.formatLebanonNumber` (private) strips `+`, keeps a leading `961`, strips a leading `0`, and otherwise prefixes `961`. Its effects:
- `0096176901610` → `961096176901610` (wrong);
- `+33 6…` → `9613361…` (wrong);
- `+961 03 123 456` → `961031234 56`-style (keeps the `0`).

**Decision**: add `packages/core/src/utils/whatsappPhone.ts` exporting `toWhatsAppNumber(raw): { ok: true; digits: string } | { ok: false; reason: "empty" | "invalid" }`. The rules, in order:
1. Strip spaces, `-`, `.`, `(`, `)`.
2. Reject anything that is not `^\+?\d+$`.
3. Treat a leading `+` or `00` as international.
4. International starting with `961`: drop a single `0` right after `961`.
5. International with another country: keep as is.
6. National with a leading `0`: replace the `0` with `961`.
7. No prefix, starts with `961`, and 10–11 digits long: already international, so keep it (e.g. `96176901610`).
8. Otherwise (national without a leading `0`): prefix `961`.
9. Final length must be 8–15 digits (E.164 maximum), otherwise invalid.

It is pure with no imports, and exported from both `browser.ts` and `index.ts`. `WhatsAppService` replaces its private method with it (FR-015). That changes the Cloud API path's behaviour only for the inputs it got wrong. The FR-014 table is the failing-first test (T003).

## R7 — Refunded sales

**Finding**: the reprint (`SaleDetailModal.handlePrintReceipt`) prints the sale as saved and ignores refunds.

**Decision**: per the spec's assumption, WhatsApp follows the reprint exactly, because it uses the same builder. Raised for the owner as information, not a blocker. A later change to show refunds would change both printouts at once, because they share the builder.

## R8 — Message length (FR-011): measure, don't guess

**Status: open until T031.**

**Plan**:
1. Build a worst-case sale: 40 lines, long names, serials, warranty terms of 600 characters, Arabic shop name and header.
2. `encodeURIComponent` the text and record the URL length.
3. Open it on (a) WhatsApp desktop for Windows through the desktop app, (b) WhatsApp Web in Chrome, (c) Android WhatsApp from the phone browser.
4. Record the largest length that arrives intact as `WHATSAPP_TEXT_MAX_ENCODED` in `receiptFormatter.ts`. Until it is measured, the constant ships at a conservative 2000 encoded characters (**Assumption (unverified)**).
5. Over the cap, `formatReceiptWhatsApp` shortens in this order:
   - drop the warranty-terms paragraph;
   - collapse the item lines to "name ×qty  $amount";
   - truncate the item list with "…and N more items".

   It always keeps the totals, payment, account and change lines, and appends "(shortened — ask the shop for the full receipt)".

## R9 — Where "Send" lives on screen

- **Strip (FR-001)**: a new `SaleCompletedStrip` in POS/index.tsx. It is set from `result.id` on processSale success and cleared when the cart gets its first item, or when a draft is resumed or checkout opens. It is non-modal and has no focus steal, so the barcode scanner keeps working (`window.api?.display?.fixFocus()` stays).
- **Details (FR-002)**: the button sits next to "Print" in `SaleDetailModal` (~L986), and is shown only when `sale.status === 'completed'` (FR-003). The modal is reached from POS recent sales and WarrantyLookup, so both get it for free. **Correction (T028, 2026-10-17):** TransactionsViewer does NOT open `SaleDetailModal`; SALE rows there have no details window and are not in `RECEIPTABLE_TYPES`, so the Transactions page gets no WhatsApp button in this change.
- **Walk-in with no number (US1-4)**: an inline number field in a small popover. Validation is live through `toWhatsAppNumber`, and nothing is saved (FR-013). Opening still happens inside the confirming click (popup gesture rule).

## R10 — Offline desktop mode

**Settled 2026-10-17 (T002):** the policy lives in core, `packages/core/src/offline/channelPolicy.ts` (not under `electron-app/offline/`). `sales:get` and `sales:get-items` are both in `READ`, so they run offline under the write guard. `app:open-external` is classed `local` (runs, never recorded), next to `print:silent` and `offline:open-web-app`; `electron-app/offline/__tests__/channelPolicy.complete.test.ts` failed with it unclassified before the entry was added, and its count assertion moved to local 25 / total 434. Opening the link needs only the shell, not the server.

Pre-existing, not LIRA-333: the same completeness test also reports `debt:get-all-history` (LIRA-330, `debtHandlers.ts`) as unclassified.
