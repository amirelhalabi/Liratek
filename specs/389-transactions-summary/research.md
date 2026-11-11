# Research — LIRA-389 Summary view

Each entry: Decision / Rationale / Alternatives considered.

## R1 — Where the list's filter rule lives today, and how ONE rule feeds both views

Facts (read 2026-11-11):

- SQL half — `TransactionRepository.getRecent(limit, filters)`: day range (`localDayRangeFilter`,
  rule 27), `typeFilters` OR-group (+ paid-via drawer/account/voucher), `search` (`summary`,
  `client_name`, `username` LIKE), `excludeTypes` (`CLIENT_CREATED`).
- Browser half — `useTransactionRows.fetchPage` builds those filters from the selected
  FILTER_GROUPS options, then `filterVisible` keeps a row when ANY selected option's full
  rule set accepts it (`isRowVisibleForOption`): type tuple / paid-via twins, the rule-26
  auto-row hide for SUPPLIER_PAYMENT / EXPENSE / WARRANTY_COST (revealed by a filter of
  that type), Supplier Credit (`supplier_credit_only`), Cash only (`cash_only`, needs the
  row's legs + session legs + extra-currency legs). A mixed typed + untyped selection drops
  `typeFilters` and relies on the browser half alone.

**Decision**: move the request builder and the row predicate into ONE browser-safe core
module, `packages/core/src/utils/transactionListFilter.ts`:
`buildTransactionListFilters(options, { search, day_from, day_to })` and
`isTransactionListRowVisible(row, options)` (+ the per-type visibility helpers). The list
hook imports both (its local copies are deleted; `auditConstants` re-exports the helpers so
existing imports/tests keep working). The summary service calls `getRecent` with the SAME
built filters and keeps the SAME predicate's rows.

**Rationale**: one definition (rule 14); the summary is then equal to the list by
construction, and a core test can prove `TOTAL` against `getRecent` + predicate.

**Alternatives**: (a) re-express the browser half as SQL in a new summary query — a second
copy of the auto-hide / Cash-only rules in another language, exactly the drift rule 14
forbids; (b) compute the summary in the browser from loaded pages — FR-008 forbids it and it
would need every page loaded.

## R2 — Summary source rows and performance

**Decision**: `TransactionSummaryService` reads `transactionRepo.getRecent(SUMMARY_ROW_CAP,
filters)` (cap 100,000; `truncated: true` in the result when hit) and filters with the core
predicate. Sale lines and linked reversal rows come from `TransactionSummaryRepository` in
chunked `IN (…)` reads (chunk 400, same ceiling as `SESSION_BATCH_CHUNK_SIZE`).

**Rationale**: `getRecent` already computes every per-row signal the predicate and the
netting need (`payments`, `session_payments`, `paid_via_*`, `reversed_by_id`,
`item_refunded`, `item_refund_remaining`, `item_refund_of_id`). Re-deriving them in a
lighter query would be a second copy. SC-004 (< 3 s for 12 months) is measured once on the
seeded web DB; if it fails, the fallback is a `getRecent` option that skips leg attachment
when no Cash-only option is selected (recorded, not built pre-emptively).

**Alternatives**: one bespoke SQL per dimension (the ticket's first sketch) — rejected for
R1's reason; the "ONE SQL per dimension sharing one filter fragment" intent is met by the
shared filter builder + one sale-line read.

**Finding during SC-004 (2026-11-11)**: one `getRecent(100000, …)` call over 40,000
transactions threw "Query execution failed" in `_attachPaymentLegs` (one bound parameter
per row in a single statement). The service therefore reads the list query page by page
(5,000 rows, the list's own FETCH_CAP) with the list's keyset cursor `before`. Measured
after the fix on a 40,000-transaction / 12-month synthetic shop (in-process, core):
Type 921 ms, Service type 962 ms, Product 795 ms, Category 792 ms. Guard:
`TransactionSummaryService.test.ts` "reads a range larger than one statement can bind"
(35,000 rows; written after the fix, not proven failing-first).

## R3 — What a summary row counts (and the TOTAL invariant)

**Decision** (formula pinned by the core test):

```
counted rows  = visible list rows (R1)
              − reversal rows        (reverses_id set, or type REFUND / REFUND_UNDO /
                                      HOLD_MONEY_COLLECT_VOID — POSTING_RULE_EXCLUSIONS
                                      "reversal" — or VOUCHER_CANCEL)
              − refunded originals   (only while "include refunded" is OFF:
                                      status VOIDED, or reversed_by_id set, or a sale whose
                                      every line was refunded item by item)
TOTAL Count (Type / Service type) = |counted rows|
TOTAL Count (Product / Category) = distinct counted SALE rows that have ≥1 line in a row
```

Basket-line rows (KEPT_CHANGE, WAIVED_SHORTFALL, EXTRA_CHARGE, BASKET_DISCOUNT) are real
list rows with their own Type; they count under their own module ("Session basket") — the
basket's POOLED amounts (`customer_session_transactions`, `session_payments`) are never
read for volume. So the only list rows the summary never shows as rows of their own are
reversal rows, and (toggle off) refunded originals.

**Rationale**: the spec's own rules ("reversal rows are not rows of their own", toggle off
hides refunded) make "TOTAL = list row count" literally false whenever the list holds a
reversal or a refunded row; the formula is the exact, testable form of FR-003 / US3.

**R3a — per-row drill count** (US3 AS2): after a row click the List shows that row's
transactions with the list's normal visibility, so its count = the row's Count + that
group's refunded originals while the toggle is OFF (they are listed with their REFUNDED /
VOIDED badge); with the toggle ON the two are equal. Reversal rows never appear under a
module / service / product drill (REFUND rows are their own module and are not SALE rows).

## R4 — Volume and netting

**Decision**: Volume per row = Σ `amount_usd` / Σ `amount_lbp` of the counted transactions
as stored (the list's Amount column source; never payment legs, never pooled basket
amounts), each currency separately, plus — for each counted original — the stored amounts
of its ACTIVE linked reversal rows, whatever their date:

- `reverses_id = original.id` (whole refund, void reversal row, hold-pickup void,
  compensating discount, warranty-cost reversal);
- a sale's item-refund rows: type REFUND / REFUND_UNDO, `reverses_id IS NULL`,
  `source_table='sales'`, same `source_id` (the `saleItemRefundOriginalIdSql` link);
- a voucher sale's `VOUCHER_CANCEL` (same `source_id`, the `reversedByIdSql` link).

A voided original (status VOIDED) nets to its void reversal row the same way. With the
toggle off, refunded originals are not counted at all, so only partial refunds net.

**Rationale**: reuses the existing reversal signals; the netted figure for a refunded row
is ≈ 0 (a void or untouched refund mirrors the original).

## R5 — Product and Category rows

**Decision**: from `sale_items` of counted SALE rows (`source_table='sales'`):
Units = `quantity − refunded_quantity` (the ProfitRepository rule), Volume USD =
`sold_price_usd × (quantity − refunded_quantity)` (sold price is per unit; sales are
USD-priced — `amount_lbp` is always 0 on a SALE), Volume LBP always empty ("—"). A
whole-refunded / voided sale counted with the toggle ON contributes Count 1, Units 0,
Volume 0. Count = number of counted sales containing the product (a sale with two lines of
one product counts once). Product label = current `products.name`, "(deleted)" suffix when
`is_deleted = 1`; Category label = `COALESCE(product_categories.name, products.category)`
(the expression `ProductRepository` already displays — exported once and reused), null →
"(no category)". Category row: Count = sales containing ≥1 product of the category.
Non-sale rows are outside these two dimensions (only sales have products).

Search with Product / Category: the search already narrows the sales (the list's own
`summary`/client/cashier match). In addition, when a sale was found by a product name and
not by its client or cashier, only the lines whose product (or category) name contains the
search count — "laptop" shows laptop lines only.

**Notes / limits**: the Sales Type volume (sale value incl. extra, net of discount) is not
the sum of Product volumes (line prices before the sale-level discount). Shown, not hidden.

## R6 — Labels

**Decision**:

- Type dimension = module, from a typed `Record<TransactionType, SummaryModuleKey>`
  (exhaustive; a new type is a compile error until classified): sales, financial,
  telecom, exchange, loto, repairs, services, expenses, vouchers, holdMoney, debts,
  suppliers, partners, drawers, basket, discounts, refunds, clients. en/ar labels in the
  `audit` namespace.
- Service type = `serviceTypeTitle(row)`: core `transactionTitle(row)` (the list's Type
  column text), plus " Send" / " Recv" / " Bill" when the title does not already carry the
  service type (OMT / Whish system rows). Translated with the list's own `translateTitle`.
- No "Service type" taxonomy is invented beyond that.

## R7 — Row click (drill) and rule 23

**Decision**: `useTransactionRows` takes an optional `drill`:
`{ dimension: "type" | "service", key }` → applied client-side with the SAME core key
functions (`summaryModuleOf`, `serviceTypeTitle`); `{ dimension: "product", productId }` /
`{ dimension: "category", category }` → two new `getRecent` filter keys
`sale_product_id` / `sale_category` (null = no category): SALE rows whose sale has a line
of that product / category (literal `tenant_id = ?` in the subquery). Shown as a removable
chip above the table.

Rule-23 diff for the new keys: (a) schema `transactionSaleDrillFiltersSchema` (core);
(b) `preload.ts` binding type is `Record<string, unknown>` (passes through); (c) IPC
`transactions:get-recent` today forwards `filters` raw except the paging keys → it now also
validates the two drill keys with the core schema and merges them (malformed → refused);
REST `/recent` parses each key explicitly → adds `sale_product_id` / `sale_category`
through the same schema. Without (c) REST would drop them silently.

## R8 — Export

**Decision**: the existing workbook already has a sheet named "Summary" (report header,
money in/out, by type). The new sheet is named `Summary by <grouping>` ("Summary by
Product", ≤ 31 chars) and is appended after it only while the Summary view is shown. The
DataTable keeps loading every page before exporting (LIRA-348), so the other sheets are
unchanged.

## R9 — Access

**Decision**: same as the list. REST `requireAuth` (the `/recent` route's guard);
IPC `requireRole(e.sender.id, ["admin", "staff"])` (every role; the list's IPC read has no
check at all — the summary does not copy that gap). No Profits password.
