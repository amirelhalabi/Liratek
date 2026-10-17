# Competitor features vs LiraTek (2026-10-17)

Research covers 9 names from the owner's list: Table POS (including its phone-shops page), Overclock (website, LinkedIn and Instagram together), Sandooq, MAPOS, Managely, AR POS, Rewaa, Foodics and Lemonade Digital Media. One research agent covered each, using only public web pages from 2026-10-17. LiraTek's own column comes from the code, not from the marketing copy. `docs/marketing/MARKETING.md` is v1.0.0 launch copy and is out of date.

Prices and claims are as each vendor publishes them. Re-check before quoting anything publicly. "Not found" means the agent searched and saw nothing. It does not prove the feature is missing.

## 1. Bottom line

- **Only Table POS is a direct, real competitor.** It has a phone-shop page, Alfa/Touch line tracking, IMEI and warranty on the sale, USD/LBP, debts, an owner app and a price of $10/month.
- **Real Lebanese products that are not phone-shop focused:** MAPOS is a Beirut ERP and Sandooq is a general retail POS. Both are serious products.
- **Weak, or not really competitors:**
  - Overclock: a 1-person IT and hardware shop that installs POS.
  - AR POS: a marketing site with no traces outside its own site.
  - Lemonade: a web agency that bundles a WooCommerce POS.
  - Managely: an Egyptian ERP with a Lebanon landing page.
  - Rewaa: Saudi only, prices in SAR.
  - Foodics: restaurants only.
- **No competitor covers LiraTek's core money modules:**
  - OMT/Whish send and receive as an agent, with supplier and partner ledgers.
  - Checking the balance against OMT's SMS.
  - MTC/Alfa credits and days, including days sold ahead.
  - iPick/Katsh, Loto, Binance, and the wrong-number card flow.
  - Several drawers per currency, with checkpoints.
  - Daily closing with profit per module.
- **Two competitors overlap with this:**
  - AR POS claims an "OMT / Western Union" module with sender and receiver tracking. This is unverified, and it has no live demo.
  - Table records Alfa/Touch transfers and card sales with fees. Table describes this itself as "a ledger" with no connection to the operators.
- **LiraTek's biggest gaps against this field:**
  1. No Arabic UI. Table, MAPOS, Sandooq and AR POS all have one.
  2. No published price or self-serve trial. Table, Sandooq, Managely, Lemonade and Rewaa have both.
  3. No online store. Table, MAPOS, Managely, Lemonade and AR POS have one.
  4. No loyalty points. MAPOS, Managely, Rewaa, Foodics and AR POS have them.
  5. No multi-branch with shared stock. Most of the field has it; Table sells it by quote.
  6. No VAT or tax handling, and no accounting ledger. MAPOS and Sandooq handle Lebanon's 11% VAT.

## 2. Competitor snapshots

### Table POS — tablelb.com (DIRECT)
- **What it is:** Beirut. Footer: "© 2026 Table (TABLELB) · Beirut, Lebanon". Sells to 13 trades, including phone shops, electronics, retail, restaurants, pharmacies and car parts.
- **Platform:**
  - Windows-only till: "There is no Mac, Linux, iPad or Android till".
  - Owner app for iPhone and Android.
  - Browser-based QR menu and online store.
  - Works offline and syncs when the internet is back.
- **Phone-shop features:**
  - Serial number and warranty on the sale line.
  - Several barcodes per accessory, and up to 3 price tiers.
  - Alfa/Touch line and balance tracking, plus transfers and card sales with fees. In its own words, "a ledger — it doesn't connect to the operators".
  - A repair is rung up as a service and left on the customer's account.
- **Currency:**
  - USD/LBP, with change given in both.
  - Exchange rate from lirarate.org or set by the shop, and saved with each sale.
  - LBP rounded to 5,000-lira notes.
- **Other features:**
  - "58 reports on the till" and "50 reports in the owner phone app".
  - X/Z reports, and expected cash per currency.
  - Nine access levels.
  - Variants on up to 3 options.
  - Shelf labels in USD, LBP or both.
  - Moving-average cost.
  - Bin for deleted items.
  - AI help assistant by text and voice, in Lebanese Arabic and English.
- **Price:**
  - $10/month or $100/year per till, with no fee on sales.
  - Add-ons: extra till $10/month, waiter tablet $5/month, price-checker tablet $5/month, QR menu $25/year, online store $5/month.
  - Hardware bundles: $150 software only, $400 with laptop, $550 with touch screen.
  - The pricing page is a configurator. Its "$35/month + $25/year, or $375/year" example is the $10 base plus every add-on ticked ($10 + $10 + $5 + $5 + $5 = $35/month, and the QR menu at $25/year). It is not a separate plan.
  - "Mobile owner app: Free, included with every licence."
  - "0% of your sales. Table doesn't process payments or take a cut."
  - "One-click backup: every product, customer and sale as JSON."
  - Multi-branch: price on request. "each branch runs as its own Table shop", so stock is not shared between branches.
  - 14-day trial, no credit card.
  - Support by WhatsApp and email.
- **Gaps:**
  - No OMT/Whish module. OMT and Whish appear only as ways a customer pays.
  - No repair job workflow.
  - No loyalty.
  - No accounting.
  - Windows-only till.
- Sources: tablelb.com, tablelb.com/phone-shops, tablelb.com/pricing, tablelb.com/retail

### Overclock — overclocklb.com, LinkedIn, Instagram @over.clocklb (WEAK)
- **What it is:**
  - An IT, CCTV and gaming-gear shop in West Bekaa (Machghara), with a WooCommerce store.
  - "POS Systems" is one of six services: hardware install, printer and cash drawer setup, and staff handover.
  - LinkedIn says "Powering mobile shops with smart POS solutions for sales, inventory, and debt management". It lists 1 employee, founded 2025. Instagram has about 107 followers.
- **Software:** no named software product, no feature page, no prices. `/pos` returns a 404. The dashboard screenshots on Instagram look like a generic third-party ERP.
- **Link to Table: unconfirmed.** One research agent said it saw an "Overclock POS" link to Table. tablelb.com does not mention Overclock (checked directly).
- **Fake search results:** search results repeated claims about "Prince Tech" and "Soi Studio" with percentages. Overclock's own projects page does not support them. Do not reuse them.
- **What LiraTek lacks against it:** no software features. Its only edge is installing hardware locally.

### Sandooq — sandooq.app (REAL, GENERAL RETAIL)
- **What it is:**
  - A browser app for desktop, tablet and phone. Works offline first.
  - Sells to Lebanon, Saudi Arabia, UAE, Qatar, Oman, Bahrain and Syria.
  - The company and owners are not named anywhere on the site.
- **Features:**
  - Real two-currency payment: LBP and USD are taken as two separate payments and checked separately.
  - The shop sets the exchange rate by hand (no rate feed). The rate is saved with each sale.
  - Purchase order, then goods received, then supplier bill.
  - Batch and expiry dates; write-offs.
  - Credit limits checked at the till.
  - **Double-entry accounts** and fiscal period close.
  - Lebanon's 11% VAT as a tax setting.
  - Cash per cashier, safe and float, and handing over between cashiers.
  - 5 roles, device PIN lock, and a log of changes that cannot be edited.
  - Full Arabic and English interface (right-to-left) and receipts in both languages.
  - Multi-store.
- **Price:**
  - Starter: $39/month, or $34/month paid yearly.
  - Professional: $89/month, or $74/month paid yearly.
  - Enterprise: price on request.
  - Free guided trial of about 2 weeks.
  - Support by WhatsApp and contact form.
- **Gaps:** no phone-shop features (IMEI, recharge, transfers, repairs), no native app, no loyalty.
- Sources: sandooq.app, /features, /pricing, /pos-system/lebanon

### MAPOS — mapos.tech (REAL, BROAD ERP)
- **What it is:**
  - Made by i-Mad Technology, Beirut, founded 2015. Also sells in Saudi Arabia and Qatar.
  - Cloud web dashboard, plus iOS and Android apps with an offline Quick POS.
  - Sells to 15 industries.
- **Features:**
  - USD and LBP accounts, totals per currency, and foreign-exchange gains and losses.
  - **Repairs and warranty desk:** job cards, intake, warranty lookup, printed slips.
  - Lebanese chart of accounts, 11% VAT and VAT return report.
  - **Payroll with NSSF.**
  - Multi-branch and warehouses.
  - Loyalty points.
  - Online store, with payment gateways and Wakilni delivery.
  - **WhatsApp Cloud API** campaigns and receipts.
  - Whish accepted at the till as a payment method.
  - Customer display; a "Phone Sell Screen".
  - **Arabic voice AI assistant.**
  - Van sales, rentals, manufacturing and projects.
- **Price:** not published; demo by WhatsApp. 30-day money-back guarantee.
- **Gaps:** no OMT/Whish agent module, no recharge or lines, no IMEI tracking found, no desktop app.
- Sources: mapos.tech/en/lebanon, /en/modules/*, /en/about

### Managely — managely.cloud (WEAK FOR THIS MARKET)
- **What it is:**
  - Cloud ERP by Tech Station, based in Egypt.
  - Its Lebanon landing page pushes "dual pricing" in two currencies.
  - Cloud, offline POS, and mobile apps on the Growth plan and above.
- **Features:**
  - CRM, HR and payroll, accounting, purchasing and manufacturing.
  - Online store, delivery, bookings, and WhatsApp ordering.
  - Loyalty and vouchers.
  - Shift and drawer handovers.
  - Multi-branch.
  - AI reports.
  - API and app marketplace.
- **Price:**
  - Phoenix (Lebanon): $5 per user per month.
  - Growth: $9 per user per month.
  - Enterprise: $270/month.
  - 7-day trial for a $1 card check.
  - Setup packages from $1,750.
- **Gaps:** no telecom, no transfers, no repairs. Serial numbers are recorded only when an item is returned.

### AR POS — poslebanon.co (UNPROVEN)
- **What it is:**
  - A web app shell built in React, plus an online shop builder.
  - The only content found is the site's own JavaScript. No trace outside it: no social pages, no reviews.
- **Claimed modules:** supermarket, restaurant (kitchen screen), clothing, gift shop, **OMT/Western Union** (sender and receiver tracking, rates), and **mobile and insurance** (plan activation, commission calculator).
- **Claimed features:**
  - Blind cash counts and cash drops.
  - Multi-location pricing.
  - Arabic and English.
  - USD and LBP.
  - Loyalty.
- **Price:** not published. 14-day trial. Support by WhatsApp: +961 76 332 499.
- **Warning signs:** testimonials look like placeholders, and the demo links are not connected.

### Rewaa — rewaa.com (NOT IN LEBANON)
- **What it is:** Riyadh-based, with 23,000+ merchants (figure from third-party sites). Cloud and mobile. SAR only.
- **Features:**
  - ZATCA e-invoicing (Saudi tax authority).
  - Salla and Zid online-store sync.
  - Built-in accounting.
  - Purchasing and suppliers.
  - Loyalty and promotions.
  - AI invoice reader.
  - Hardware discounts.
- **Price:** 247–708 SAR/month. 14-day trial.
- **Gaps:** nothing found about Lebanon, LBP, OMT/Whish, telecom, IMEI or repairs.

### Foodics — foodics.com (NOT A COMPETITOR)
- **What it is:** a Saudi restaurant POS that raised $198M and serves about 35 countries.
- **Features:** kitchen screen, kiosks, pay at the table, delivery-app links, Foodics Pay, loyalty, 120+ integrations, and merchant financing (Foodics Capital).
- **Price:** from 199 AED/month (UAE).
- **Lebanon:** not on its support list. One changelog entry handles large LBP amounts.

### Lemonade Digital Media — lemonadedigitalmedia.com (NOT A COMPETITOR)
- **What it is:** a Lebanese web agency.
- **The link from the list:** `?p=172441` is an article on starting an online store. It does not mention POS.
- **Its POS offer** (`?p=160460`):
  - A WooCommerce store plus a POS: $29/month for store and POS, $39/month in two languages.
  - Stock sync between the store and the shop.
  - Thermal printer and barcode reader.
- **Gaps:** no currency, debt or telecom features.

### Other names found along the way (not researched)
Omega POS, BIM POS, Hamster POS, KORONA POS and XStak. All five come from one blog on xstak.com, and XStak is itself a POS vendor. Research them separately if needed.

## 3. Feature matrix

Key:
- ✅ = advertised or present.
- ◐ = partial.
- ❌ = not found.
- ? = claimed but unverified.

| Feature | LiraTek | Table | Sandooq | MAPOS | Managely | AR POS | Rewaa | Foodics | Lemonade |
|---|---|---|---|---|---|---|---|---|---|
| USD + LBP | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ❌ | ◐ | ❌ |
| Live exchange rate | ✅ | ✅ lirarate | ❌ manual | ✅ | ✅ | ? | ❌ | ❌ | ❌ |
| Customer debts | ✅ | ✅ | ✅ credit limits | ◐ | ❌ | ❌ | ❌ | ❌ | ❌ |
| IMEI / serial + warranty | ✅ | ✅ | ◐ batch | ❌ | ◐ returns only | ◐ | ❌ | ❌ | ❌ |
| OMT/Whish send and receive as agent | ✅ | ❌ (payment only) | ❌ | ❌ (Whish payment only) | ❌ | ? OMT/WU | ❌ | ❌ | ❌ |
| MTC/Alfa recharge and lines | ✅ | ◐ ledger | ❌ | ❌ | ❌ | ? plan activation | ❌ | ❌ | ❌ |
| iPick/Katsh, Loto, Binance | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Repair jobs | ✅ | ◐ service line | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Several drawers / checkpoints / closing | ✅ | ✅ X/Z | ✅ | ◐ Z-report | ✅ | ✅ | ◐ | ◐ | ❌ |
| Cash report: expected vs counted per currency | ✅ checkpoints + closing | ✅ X/Z report | ✅ Z-read | ✅ Z-report | ✅ | ✅ blind count | ? | ? | ❌ |
| Separate shift and Z-report per till or cashier | ❌ drawers per currency | ✅ $10/till | ✅ | ? | ✅ | ✅ | ? | ? | ❌ |
| Profit per module | ✅ | ◐ reports | ✅ margins | ✅ | ✅ | ◐ | ✅ | ✅ | ◐ |
| Supplier ledgers | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ❌ |
| Purchase orders | ◐ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ❌ |
| Gift cards / vouchers | ✅ | ❌ | ❌ | ◐ promo codes | ✅ | ✅ | ◐ | ✅ | ❌ |
| Barcode labels | ✅ | ✅ shelf USD/LBP | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Offline | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ❌ | ? | ❌ |
| Desktop app | ✅ Win + Mac | ✅ Win only | ❌ browser | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Web app | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Owner mobile app | ✅ | ✅ | ❌ | ✅ | ✅ | ◐ mobile web | ✅ | ✅ | ❌ |
| Voice / AI assistant | ✅ voice bot | ✅ text + voice | ❌ | ✅ voice AI | ✅ AI reports | ❌ | ◐ invoice reader | ❌ | ❌ |
| **Arabic UI** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| **Published price + self-serve trial** | ❌ | ✅ $10/mo | ✅ $39/mo | ❌ | ✅ $5/user | ◐ trial | ✅ | ✅ | ✅ $29/mo |
| **Online store** | ❌ | ✅ $5/mo | ❌ | ✅ | ✅ | ✅ | ✅ Salla/Zid | ✅ | ✅ |
| **Loyalty points** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Multi-branch, shared stock** | ❌ | ◐ quote | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **VAT / tax** | ❌ | ❌ | ✅ 11% | ✅ 11% + return | ✅ | ❌ | ✅ ZATCA | ✅ | ❌ |
| **Double-entry accounting** | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **HR / payroll** | ❌ | ❌ | ❌ | ✅ NSSF | ✅ | ❌ | ❌ | ❌ | ❌ |
| **WhatsApp receipts / campaigns** | ◐ API only | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ◐ | ❌ |
| **Card terminal / payment gateway** | ❌ | ◐ own terminals | ✅ links | ✅ | ✅ | ❌ | ✅ | ✅ Foodics Pay | ❌ |
| **Hardware bundles** | ❌ | ✅ $150–550 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ◐ |
| Roles | ◐ admin/staff only | ✅ 9 levels | ✅ 5 roles | ✅ templates | ✅ | ✅ 3 roles | ✅ | ✅ | ❌ |
| Customer display | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Restaurant / kitchen screen | ❌ | ✅ | ✅ modifiers | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

Bold rows are where LiraTek trails the field.

## 4. What competitors have that LiraTek doesn't, ranked for a phone-shop POS

1. **Arabic interface.**
   - Who has it: Table, Sandooq, MAPOS, AR POS and Managely.
   - Why it matters: it is a basic expectation in Lebanon. Table also has Lebanese-Arabic voice help.
2. **Public price and a self-serve 14-day trial.**
   - Who has it: Table at $10/month.
   - Why it matters: Table is the price owners will compare against. LiraTek has no trial flow; a shop's account is marked paid by hand.
3. **More roles than admin and staff.**
   - Who has it: Table has 9 access levels and Sandooq has 5 roles, including cashier, stock clerk and accountant.
   - Why it matters: owners want cashiers who cannot see costs or profits.
4. **Multi-branch with shared stock.**
   - Who has it: Sandooq, MAPOS, Managely and AR POS. Table sells it by quote.
   - Why it matters: today LiraTek gives each shop its own separate account.
5. **Loyalty points.**
   - Who has it: MAPOS, Managely, AR POS, Rewaa and Foodics.
   - What LiraTek has instead: vouchers and gift cards only.
6. **WhatsApp receipts and messages to customers.**
   - Who has it: MAPOS and Managely.
   - What LiraTek has: the Meta Cloud API connection and the customer opt-in flag, but nothing that sends messages automatically.
7. **Online store or catalog.**
   - Who has it: Table ($5/month add-on), MAPOS, Lemonade and AR POS.
   - Why it is lower priority: less important for phone shops.
8. **VAT, and accounting or VAT reports.**
   - Who has it: Sandooq and MAPOS, for VAT-registered shops.
   - Why it is lower priority: most small phone shops are not VAT-registered. This is an assumption, not checked.
9. **Shelf labels priced in USD, LBP or both, and LBP rounded to 5,000-lira notes.**
   - Who has it: Table.
   - What LiraTek has: CODE128 barcode labels only. Price on the label and note-rounding were not checked.
10. **Cash report under the names owners know: "X report" and "Z report".**
    - The function already exists. Checkpoints count the cash at any time, which is an X report. Closing shows expected vs counted per currency and prints a report, which is a Z report. Drawer top-ups, cash-outs and transfers are pay-ins and pay-outs.
    - The real gap: no separate drawer, shift and Z report for each till or cashier. Table charges $10/month per extra till for this. (Likely, based on the code search: LiraTek drawers are per currency and payment method, not per till.)
11. **Hardware bundles with installation.**
    - Who has it: Table ($150–550), and Overclock as an installer.
    - Possible response: partner with a local installer instead of building anything.
12. **Lower priority:** purchase order and goods-received workflow (Sandooq), customer display (MAPOS), payroll (MAPOS), card-payment links (Sandooq), price-checker tablet (Table).

Not relevant to phone shops: restaurant tables, kitchen screens and kiosks; supermarket weighing; van sales, rentals and manufacturing.

## 5. Where LiraTek leads (no competitor found doing these)

- OMT/Whish send and receive as an agent, with the fee worked out.
- Supplier and partner ledgers for each money system.
- Checking the OMT balance against OMT's SMS.
- Hold Money and the Syria route.
- MTC/Alfa credits and days, including days sold ahead on carrier lines.
- Alfa Gift.
- The wrong-number card flow.
- iPick/Katsh, Whish App bills, and the gaming and internet card catalog.
- Loto sales, prizes and settlements.
- Binance USDT.
- Exchange lots and tracking of the foreign-currency position.
- Several drawers per currency, the checkpoint timeline, and daily closing with profit per module.
- Repair job statuses with parts. Only MAPOS has something similar.
- Desktop app on Windows and Mac, a web app and an owner mobile app, all from one system. Table's till is Windows-only.
- Owner records after-hours OMT App and Whish App transfers from the phone.

## 6. Caveats

- Competitor features are taken from their own marketing. None was tested hands-on.
- AR POS: no outside trace and no live demo, so treat every claim as unproven.
- MAPOS: "no IMEI" and "no OMT" are absences on its website, not proof.
- Table and Overclock: the link between them is unconfirmed (see the Overclock section).
- LiraTek Arabic UI: a code search for i18n, RTL or Arabic strings in `frontend/src` found nothing. This was a grep, not a manual check of the app.
- See also `marketing/instagram/COMPETITORS.md` for angles to use in social posts.
