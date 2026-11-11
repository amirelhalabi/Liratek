# Feature Specification: Summary view on Audit & Transactions

**Feature Branch**: `389-transactions-summary` (work happens on `main`; ticket LIRA-389)

**Created**: 2026-11-11

**Status**: Draft

**Input**: Owner, 2026-11-11: "Let's say I want to know how many laptops I sold this month. How could I know today?" Then: "Think about a way to do that. A screen where I can filter to see all the products I sold in a window frame [from/to date pickers]. And this should not be locked to only the sales: how many OMT transactions I did this month, or the volume of transactions." Decisions on the proposal: placement = a List | Summary toggle on the Audit & Transactions page; first dimensions = Type, Service type, Product, Product category; **no profit or commission column on this screen, ever**.

## Today

No screen counts units per product or transactions per module over a period. The only way is to filter the Transactions list by dates, type and search text, then count rows or Excel lines by hand. A "top products" query exists in the shop's code with no date range and no page that calls it.

## Clarifications

### Session 2026-11-11 (owner decisions)

- Q: Where does the summary live — a Summary view on Audit & Transactions, a new Reports page, or a tab on Profits? → A: **Summary view on Audit & Transactions**, sharing its from/to, type filter, search and Excel export, so the numbers always match the list.
- Q: Which dimensions first? → A: **Type, Service type / provider, Product, Product category.** Client, Cashier, Day and Payment method come later.
- Q: Profit / commission columns? → A: **Never on this screen.** Profit stays on the Profits page.

### Open questions (recommended answer first; the build follows it unless the owner overrules)

1. **Default grouping when Summary opens.** → Recommended: Type when the type filter is "All types"; Service type when one module is selected; Product when the type is Sales.
2. **Rows with zero volume** (e.g. a $0 free job). → Recommended: counted, shown with "—" in the volume columns.
3. **Hidden auto rows** (the Transactions list hides `is_auto` siblings by default). → Recommended: the summary follows the list's visibility exactly, so the count equals the rows a user would see; a type-targeted filter that reveals them reveals them in the summary too.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - How many of each product did I sell this month (Priority: P1)

The owner opens Audit & Transactions, sets 1–30 Nov, type Sales, switches to Summary, groups by Product.

```
Audit & Transactions      From [01/11/2026] To [30/11/2026]  Types [Sales]  Search [        ]
[ List | Summary ]        Group by [Product ▾]                                  [Excel]

Product                           Count   Units   Volume USD   Volume LBP
Lenovo IdeaPad 3 15"                  4       4    $1,780.00            —
HP 250 G9                             3       3    $1,410.00            —
USB-C cable 1 m                      27      31            —   12,400,000
TOTAL                                34      38    $3,190.00   12,400,000
```

Typing "laptop" in the search narrows the rows to products whose name matches. Clicking a row switches back to the list, filtered to that product's sales.

**Why this priority**: The owner's question, verbatim.

**Independent Test**: Sell 4 Lenovo and 3 HP in the month, one Lenovo refunded; Summary by Product shows Lenovo Count 3 / Units 3 / $1,335.00 (net), HP 3 / 3 / $1,410.00; the list filtered to Lenovo shows the same 3 live sales (plus the refunded one with its badge).

**Acceptance Scenarios**:

1. **Given** sales in the range, **When** Summary is grouped by Product, **Then** one row per product with Count (sales containing it), Units (quantity summed over sale lines), Volume USD and Volume LBP (the sale lines' sold amounts, each in its own currency), plus a TOTAL row.
2. **Given** a sale with two lines of the same product (qty 2 + qty 1), **When** grouped by Product, **Then** Count 1, Units 3.
3. **Given** a refunded sale, **When** the "include refunded" toggle is off (default), **Then** it is not counted and its amount is not in the volume; **When** on, it shows with its refund netted and the row count includes it.
4. **Given** a sale-line item refund of 1 of 3 units, **When** grouped by Product, **Then** Units 2 and the volume net of the refunded line.
5. **Given** a product that was renamed, **When** grouped by Product, **Then** one row under the current name.

---

### User Story 2 - How many OMT transactions this month, and what volume (Priority: P1)

Type OMT/Whish, Summary grouped by Service type.

```
Types [OMT/Whish]  Group by [Service type ▾]     Count   Volume USD   Volume LBP
OMT Send                                            62   $18,420.00   41,500,000
OMT Receive                                         31    $9,105.00            —
OMT Bills                                           14            —   22,800,000
Whish Send                                           9    $2,300.00            —
TOTAL                                              116   $29,825.00   64,300,000
```

**Acceptance Scenarios**:

1. **Given** OMT/Whish rows in range, **When** grouped by Service type, **Then** one row per provider + service type (send, receive, bills, app transfers, vouchers, online brokerage …), Count and Volume per currency.
2. **Given** an OMT send of $100 with a $1 fee, **When** summed, **Then** the volume is the customer-side amount the transaction row carries ($101 if the row's amount includes the fee; the rule is "the transaction's own amount", stated once).
3. **Given** a send inside a session basket paid together with a sale, **When** summed, **Then** the send counts as 1 OMT row with its own $101; the basket's pooled payment is never used.
4. **Given** "All types" and grouping by Type, **When** summed, **Then** one row per module (Sales, OMT/Whish, MTC/Alfa, Exchange, Loto, Repairs, Services, Expenses, …) with Count and Volume per currency; refunds, voids and reversal rows are not rows of their own (they only net).

---

### User Story 3 - The summary always matches the list (Priority: P1)

**Acceptance Scenarios**:

1. **Given** any combination of from/to, type filter and search, **When** Summary is shown, **Then** its TOTAL Count equals the number of rows the List shows for the same filters (with the same refunded/auto visibility).
2. **Given** a row in the summary, **When** clicked, **Then** the List opens filtered to exactly those transactions, and its row count equals the summary row's Count.

---

### User Story 4 - Export (Priority: P2)

**Acceptance Scenarios**:

1. **Given** Summary is shown, **When** Excel is exported, **Then** the workbook gains a "Summary" sheet with the current grouping's rows and TOTAL, next to the existing sheets.

---

### Edge Cases

- **Mixed currencies in one row**: both columns filled; never converted or added across currencies.
- **Category with no products sold**: no row.
- **Product deleted after the sale**: still a row, under its last known name, marked "(deleted)".
- **Session basket members**: each member counts under its own type; the basket itself never appears.
- **Expenses**: counted under Type "Expenses" with their amount as volume (money out), shown in the same columns; no sign games, the Type row says Expenses.
- **Large ranges**: a year of a busy shop (tens of thousands of rows) must still answer within a few seconds; the summary is computed on the server, never by loading the list into the browser.
- **Role**: everyone who can open Audit & Transactions can use Summary (no Profits password).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Audit & Transactions gains a List | Summary toggle; Summary uses the page's existing from/to, type filter and search, unchanged, plus a Group by selector (Type, Service type, Product, Product category) and an "include refunded" toggle (default off).
- **FR-002**: Columns: the dimension label, Count, Units (Product and Category only), Volume USD, Volume LBP; a TOTAL row; no profit, cost, margin or commission column.
- **FR-003**: ONE filter rule shared by the list and the summary (same date bounds, type set, search match, auto-row visibility), so TOTAL Count equals the list's row count for the same filters.
- **FR-004**: Volume per row = the sum of each transaction's own customer-side amount in its own currency; payment legs are never summed; refunds are netted and reversal rows never form rows of their own.
- **FR-005**: Product and Category rows are built from sale lines (units and sold amounts), net of per-line item refunds; other dimensions from transaction rows.
- **FR-006**: Clicking a summary row shows the List filtered to that row's transactions.
- **FR-007**: The Excel export includes a Summary sheet when Summary is shown.
- **FR-008**: Computed on the server for both desktop and web (one reporting read, both transports); the browser never aggregates the list itself.
- **FR-009**: Release note and a What's new card with a real screenshot of Summary by Product (rule 30).

### Key Entities

- **transactions**: type, provider / service type, amount per currency, status, `reverses_id`, session membership, `is_auto`.
- **sale_items**: product, category (through the product), quantity, sold amount, item-refund state.

## Success Criteria _(mandatory)_

- **SC-001**: Core test, table-driven: a fixture of sales (incl. multi-line, refunded, item-refunded), OMT/Whish sends and receives, a session basket with a sale + an OMT send, a recharge and an expense; for each dimension the rows, counts, units and volumes equal hand-computed expectations; TOTAL Count equals the list query's row count for the same filters (failing first).
- **SC-002**: Page test: the toggle, group-by selector, include-refunded toggle, TOTAL row, no profit column present in any grouping, row click filters the list.
- **SC-003**: Web e2e: seed the fixture through the real screens, open Summary by Product and by Service type, compare with the list counts, export and read the Summary sheet (`lira-web-100`).
- **SC-004**: Summary for a 12-month range on the test tenant answers in under 3 seconds (measured once, web).

## Assumptions

- The Transactions list already exposes its filter state (from, to, types, search) and an Excel export with multiple sheets; the summary reuses both.
- "Service type" is the existing provider + service-type pair the Transactions list already labels (OMT Send, Whish Receive, Alfa Gift, Katsh …); no new taxonomy.
- Product category is the product's current category; uncategorised products form an "(no category)" row.

## Decisions taken unattended (2026-11-11)

The three open questions follow their recommended answers (default grouping by the type
selection; zero-volume rows counted with "—"; hidden auto rows follow the list exactly).
Further decisions, with the reason (details in `research.md`):

1. **One filter rule in core.** The list's browser-side rules (auto-row hide, Supplier
   Credit, Cash only, mixed selections) move into one core module that the list and the
   summary both use; the summary runs the list's own server query with the same filters
   (R1, R2).
2. **What "TOTAL = list count" means exactly.** The list shows refund / reversal rows and
   refunded originals; the summary never makes reversal rows rows of their own and (with
   "include refunded" off) leaves refunded originals out. So TOTAL Count = list rows −
   reversal rows − (refunded originals while the toggle is off). With the toggle on and no
   refund rows in range, TOTAL equals the list count exactly (R3).
3. **Product / Category TOTAL Count = distinct sales**, not the sum of the rows (a sale with
   a laptop and a cable is one sale in TOTAL, one in each product row).
4. **Product / Category rows come from sales only** (only sales have products). Choosing
   them with other types selected shows only the sales part; the default grouping already
   picks Product only when the selection is Sales.
5. **Product volume is USD only.** Sale lines are priced in USD (`amount_lbp` is always 0 on
   a sale), so Volume LBP shows "—" for products and categories. The Sales row's volume
   under Type (sale value after discount, with any extra) can differ from the sum of its
   product rows (line prices before the sale discount).
6. **Type rows are modules** (Sales, Money transfers, MTC / Alfa, Exchange, Loto, Repairs,
   Services, Expenses, Vouchers, Hold money, Debts, Suppliers, Partners, Drawers, Session
   basket, Discounts, Clients) from one typed core map, so a new transaction type cannot be
   left out. Session-basket lines (kept change, waived, extra, basket discount) count under
   "Session basket"; the basket's pooled payment is never read.
7. **Service type names = the list's Type column text**, plus "Send" / "Recv" / "Bill"
   where that text has no service word (OMT / Whish system rows) — so OMT Send and OMT
   Receive are separate rows.
8. **Volume = each transaction's stored amount**, netted with the stored amounts of its
   refund / void / undo rows whatever their date (a June sale refunded in July nets in the
   June summary).
9. **Search on Product / Category** narrows to the lines whose product (or category) name
   contains the text, unless the sale was found by its client or cashier name.
10. **Excel sheet name.** The workbook already has a sheet called "Summary"; the new one is
    "Summary by Product" (or Type / Service type / Product category).
11. **Row click** opens the List with a removable chip ("Showing: Lenovo IdeaPad 3") — the
    list gains drill filters by module, service type, product and category. The list then
    shows the row's Count plus, while "include refunded" is off, the refunded ones with
    their badge (as in User Story 1's independent test); with it on, the counts are equal.
12. **Row cap.** The summary reads at most 100,000 transactions per request and says so on
    screen when the range holds more.
13. **Checkpoints are counted, never volume.** A drawer checkpoint's amount is the count's
    over/short, not money a customer paid; it counts under "Drawers" with "—" volume.
14. **Signed rows are summed as stored.** Partner settlements / payments and line
    adjustments keep their sign, so their volume can be negative (net).

### Questions for the owner

1. Should the Sales row under "Type" show the same figure as the sum of the Product rows
   (line prices) or the sale value after discount (today's choice, decision 5)?
2. Do you want an LBP volume for products (sale value converted at the sale's rate), or is
   "USD only" right since prices are in USD?
3. Should "Group by Product" with other types selected say how many non-sale transactions
   were left out? (Today it shows the note "Only sales have products, so only sales are
   counted here.")
4. Partner settlements and line adjustments can show a negative volume (net of both
   directions). Keep it, or show them count-only like checkpoints?
