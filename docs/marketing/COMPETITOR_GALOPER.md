# Competitor analysis: Galoper ERP vs LiraTek

**Date:** 2026-10-10 · **Author:** research session with Claude (owner-requested)
**Status:** reference document. Re-check Galoper's site before relying on any claim older than a few months.

## 1. Summary

Galoper is a **general ERP for Lebanese businesses**: accounting, banking, purchasing,
B2B sales, inventory, a retail POS and, since recently, process manufacturing. It targets
retail, wholesale, food & beverage, financial services, services and distribution.

LiraTek is a **counter tool for Lebanese phone shops**: POS with IMEI, USD + LBP drawers,
OMT / Whish, MTC / Alfa recharge, the customer debts book, repairs and daily closing, on
desktop (works offline) and on the web.

They overlap only at the till: POS, stock, customers, suppliers and USD + LBP. Galoper is not
a direct competitor for phone shops today, but it is the closest local product a phone-shop
owner might compare us with.

**Our edge:** the phone-shop routine — OMT/Whish, recharge, IMEI, repairs, drawers, debts
book — and working offline. Galoper lists none of these.
**Their edge:** accounting, VAT/NSSF compliance, purchasing, B2B sales, multi-warehouse,
variants, permissions/approvals and integrations.

## 2. Sources and how reliable each claim is

| Source | Read on | What it gave |
|---|---|---|
| `https://galoper.net/` (homepage) | 2026-10-10 | Positioning, module list, key claims, contact |
| `https://galoper.net/apps/*` — accounting, bank, inventory, supplier, customer, purchase, sales, expense, task-management, report, calendar, retail-pos | 2026-10-10 | Per-module feature lists |
| `https://galoper.net/integrations` | 2026-10-10 | Integrations |
| `https://galoper.net/pricing` | 2026-10-10 | No prices visible (loaded by script or behind "Book Demo") |
| YouTube: "How Salmon Recipes Drive Production \| Galoper ERP Process Manufacturing & Traceability", channel Galoper ERP, 7:23, published 2026-09-23 (`https://www.youtube.com/watch?v=bufmY5jHmmQ`) | 2026-10-10 | Full English transcript + frames: the manufacturing module |

**Caveats:**
- Everything about Galoper comes from **their own marketing**. We have not used the product.
- Their **Retail POS, Report and Task Management pages say almost nothing**. A "✗" for Galoper
  below means "not mentioned", not "proven missing".
- The video is an illustrated, AI-narrated explainer (a slideshow with one small product
  screenshot), not a product demo.
- LiraTek's column was taken from the codebase (modules, settings, recent tickets). It was not
  re-tested module by module for this document.

## 3. Galoper at a glance

- **Product:** "Galoper ERP", built by Ciatek. Cloud only (no offline mode mentioned).
- **Claims:** "All-in-One Platform", single database, "Unlimited Users", "99.9% uptime",
  "No hidden costs", "50+ built-in reports", Lebanese chart of accounts, VAT / NSSF / CNSS
  compliance.
- **Currencies:** USD, LBP, EUR with automatic exchange-rate updates.
- **Customers:** the homepage counter shows "0+ Businesses" (likely a placeholder). Likely,
  based on that counter, they are early-stage too; not verified.
- **Pricing:** not published; "Book a Free Demo". Monthly/annual toggle on the pricing page.
- **Contact:** WhatsApp +961 81 090 287, help.galoper.net, LinkedIn / Facebook / Instagram
  (@galopererp).
- **Marketing:** short AI-narrated explainer videos on YouTube.

### 3.1 Modules (from their Apps pages)

| Module | What they list |
|---|---|
| **Accounting** | Lebanese chart of accounts (English + Arabic, customisable), double-entry journal vouchers with multi-currency lines, drafts / clone / reverse, opening balances, year closing (P&L to retained earnings, VAT to tax liability), period locks with an unlock password, VAT & NSSF compliance |
| **Bank** | Bank accounts across banks, currencies and branches; IBAN / SWIFT / routing; live balances incl. overdraft; each account linked to the chart of accounts; Stripe / PayPal as payment channels |
| **Inventory** | Multiple locations / warehouses and transfers; product variants (colour, size, storage…) with auto SKUs, per-variant image and barcode; adjustments with reason codes and audit log; goods receipt and delivery notes (partial receipts); returnable packages and deposits; barcode / SKU generation and label printing; barcode scanning in receiving, delivery and adjustments; low-stock alerts |
| **Supplier** | Supplier records with several contacts and roles; multi-currency with a payables account per currency; supplier price lists per item with history, applied automatically to purchase quotations and orders; activate / deactivate keeping history |
| **Purchase** | Requisitions → requests for quotation (compare suppliers) → purchase quotations → purchase orders (multi-currency, multi-tax, payment terms, delivery schedules) → goods receiving (partial, expiry dates) → purchase invoices with approval → payment vouchers (cash, transfer, cheque, email confirmation); advance payments; returns, credit and debit notes; refund vouchers |
| **Sales** | Quotations (validity, packaging, discounts) → sales orders (stock reservation) → delivery notes → invoices; partial payments; customer- or region-specific price lists (fixed price or margin ranges) with approvals; promotions (percent, fixed, buy-one-get-one) restricted by product / category / customer, stackable or not; salesperson commissions (on billing or payment, reversed on returns) |
| **Customer** | Individual or company customers, company branches, several shipping addresses, bank details, attachments; live receivables per currency; Excel import / export; bulk activate / deactivate |
| **Expense** | Employee claims and reimbursements, approvals, cost allocation |
| **Report** | "50+ reports", Excel / PDF export, KPI dashboards (no report names listed) |
| **Task Management / Calendar** | Projects and tasks; shared calendar with reminders and double-booking prevention |
| **Retail POS** | "Point-of-sale with real-time inventory sync" — no other detail published |
| **Manufacturing** (video only, not on the Apps menu) | Bills of materials scaled to batch size; certified production versions; routings with work centres, set-up / run / wait times; production orders that reserve stock and back-flush materials; first-expired-first-out lot picking; one input with several outputs (main products, by-products, waste) and cost allocation between them; lot traceability forward and backward with recalls; variance analysis (material price, quantity, labour) |
| **Coming soon** | Assets & Payroll |
| **Integrations** | Shopify, WooCommerce, WhatsApp (share orders / invoices / documents), Brevo (email marketing), Twilio (SMS / WhatsApp), Power BI; homepage also names Apple Pay / Android Pay |

## 4. Side-by-side comparison

| Feature | Galoper | LiraTek |
|---|---|---|
| **— Galoper has, LiraTek doesn't —** | | |
| Accounting: chart of accounts, journal vouchers, opening balances, year closing, period locks | ✓ | ✗ |
| VAT and NSSF / CNSS compliance | ✓ | ✗ |
| Bank accounts (IBAN/SWIFT), Stripe/PayPal channels | ✓ | ✗ |
| Purchasing chain: requisition, RFQ, quotation, PO, goods receipt, purchase invoice with approval, advances, credit/debit notes | ✓ | partial (supplier ledger and payments) |
| Supplier price lists with history | ✓ | ✗ |
| B2B sales chain: quotation, sales order, delivery note, invoice, partial payments | ✓ | ✗ (POS sales) |
| Customer / region price lists; promotions (percent, fixed, BOGO) | ✓ | partial (discount at checkout) |
| Salesperson commissions | ✓ | ✗ |
| Multiple warehouses and transfers | ✓ | ✗ |
| Product variants with auto SKUs | ✓ | ✗ |
| Delivery notes, returnable packages, deposits | ✓ | ✗ |
| Company customers with branches, addresses, attachments; Excel import | ✓ | partial (clients) |
| Approval workflows; granular role permissions | ✓ | partial (admin / staff) |
| Employee expense claims | ✓ | ✗ (shop expenses only) |
| Tasks, projects, shared calendar | ✓ | ✗ |
| Integrations: Shopify, WooCommerce, WhatsApp sharing, Brevo, Twilio, Power BI | ✓ | partial (WhatsApp settings exist) |
| EUR + automatic rate updates | ✓ | ✗ (USD + LBP, rates set by the shop) |
| Manufacturing: BOM, routings, production orders, lots / expiry, by-products, variances | ✓ | ✗ |
| Payroll and fixed assets | "soon" | ✗ |
| **— LiraTek has, Galoper doesn't (not mentioned) —** | | |
| OMT and Whish transfers: fees, statement matching | ✗ | ✓ |
| MTC and Alfa recharge (credit and days), carrier lines, supplier balances | ✗ | ✓ |
| Mobile services and custom services | ✗ | ✓ |
| Phones tracked by IMEI, with warranty | not mentioned | ✓ |
| Repairs (maintenance) from intake to pickup, with parts | ✗ | ✓ |
| Customer debts book: sell on credit, repay in USD or LBP, cash out credit | as receivables only | ✓ |
| Currency exchange as a service | ✗ | ✓ |
| Cash drawers per currency and payment method; daily opening and closing | not mentioned | ✓ |
| Profits per module, behind a profits password | not mentioned | ✓ |
| Loto | ✗ | ✓ |
| Customer sessions and parked sales | ✗ | ✓ |
| Partners ledger | ✗ | ✓ |
| Voids / refunds that reverse every ledger touched | not mentioned | ✓ |
| **Works offline (desktop app) + web** | ✗ cloud only | ✓ |
| Each shop at its own address, self sign-up by email, Google sign-in, My account | not mentioned | ✓ |
| Voice bot | ✗ | ✓ |
| **— Both —** | | |
| POS with barcodes and receipts | ✓ (barely described) | ✓ |
| Stock, low-stock alerts, barcode labels | ✓ | ✓ |
| USD and LBP | ✓ | ✓ (deeper: split payments, change, drawers) |
| Suppliers and customers with balances | ✓ | ✓ |
| Shop expenses | ✓ | ✓ |
| Users and roles | ✓ (granular) | ✓ (admin / staff) |
| Reports, Excel / PDF export | ✓ ("50+") | ✓ (fewer, money-focused) |
| Pricing published | ✗ | ✗ |

## 5. What LiraTek should adopt (ranked for phone shops)

Ranking is a judgment call, not measured data. "Have today" was checked by searching the code
on 2026-10-10.

| # | Feature (from Galoper) | In LiraTek terms | Have today | Value | Effort |
|---|---|---|---|---|---|
| 1 | WhatsApp sharing of documents | Send the receipt, a debt statement, "your repair is ready" | partial (WhatsApp settings and a sending service exist; scope not checked) | High | Medium |
| 2 | Receivables ageing / statements | Printable or WhatsApp statement per debtor; debts older than 30/60/90 days | not found | High | Small |
| 3 | Permissions and approvals | Hide cost and profit from staff; admin PIN for void, refund, large discount | partial (admin / staff) | High | Medium |
| 4 | Purchasing and supplier price lists | Receive a supplier invoice into stock (partial deliveries), update cost, keep price history | partial (supplier ledger) | Medium–high | Medium |
| 5 | Product variants | One model with storage / colour variants, each with stock and barcode | no | Medium–high | Medium |
| 6 | Excel import | Import products, prices, customers at onboarding | unclear | Medium | Small |
| 7 | Promotions and price lists | Bundles ("phone + cover"), wholesale prices for some customers | partial (checkout discount) | Medium | Medium |
| 8 | Stock counts with reason codes | Monthly count; differences recorded with a reason | partial (stock adjust) | Medium | Small–medium |
| 9 | Multiple branches / warehouses | Chains share products and transfer stock | no | High for chains, low otherwise | Large |
| 10 | Calendar and reminders | Repair pickup reminders, debt due dates | no | Low–medium | Small |
| 11 | Accountant export (instead of full accounting) | Monthly Excel of sales, expenses and VAT figures | partial (table exports) | Medium | Small |

**Not worth copying for phone shops:** full accounting, VAT/NSSF filing, payroll, bank IBAN
records, tasks/projects, manufacturing, Shopify/WooCommerce.

**Suggested next batch:** #2 statements → #1 WhatsApp sharing (built on #2) → #3 admin PIN.
Separately, warranty for any item is ticketed as **LIRA-296**
(`docs/plans/done_plans/WARRANTY_ANY_ITEM_PLAN.md`).

## 6. Positioning and marketing takeaways

1. **Lead with what they don't have**: OMT/Whish, MTC/Alfa recharge, IMEI, repairs, drawers in
   USD + LBP, the debts book. A phone-shop owner sees their own day in LiraTek and not in
   Galoper.
2. **Say "works offline"** on the landing and feature pages. Power and internet cuts are
   normal in Lebanon; Galoper is cloud-only.
3. **Don't build an accounting system to compete.** Offer an accountant export instead.
4. **Watch their "Financial Services" sector.** If they add money transfers, they move closer to
   us.
5. **Copy their content tactic cheaply:** 1–2 minute explainer videos per feature (e.g. "Closing
   the day in USD and LBP"), which also help search.

## 7. Open questions (not verified)

- Galoper's prices and plans.
- Whether their POS handles IMEI / serials, offline use, receipts and cash drawers.
- Whether "Financial Services" includes money transfer or recharge.
- How many shops actually use it.

The fastest way to answer these: book their free demo, or read help.galoper.net.
