# Product

<!-- impeccable:product-schema 1 -->

<!--
  Provenance: written 2026-10-20 by an agent running `/impeccable init` without
  the owner available to interview. Facts were taken from the repository
  (CLAUDE.md, README.md, docs/FEATURE_GUIDE.md, docs/release-notes/*,
  landing/index.html, frontend/src/index.css) and the brief the agent was given.
  Lines marked "(inferred)" are the agent's reading of that evidence and have
  NOT been confirmed by the owner. Confirm or correct them on the next init run.

  Scope: this record covers the LiraTek app UI in frontend/ — the one React
  renderer shipped as both the Electron desktop app and the multi-tenant web
  app. The Expo phone app in mobile/ and the marketing site in landing/ are
  separate surfaces with their own design and are not described here.
-->

## Platform

web

(The desktop build is Electron wrapping this same web UI, so its design language is web, not native.)

## Users

- **Cashiers ("staff" role).** They work at the counter of a Lebanese phone and electronics shop, often with a customer standing in front of them and others waiting. Their job is to ring up sales, send and receive OMT and Whish transfers, do MTC and Alfa recharges, exchange USD and LBP, take debt repayments and book repairs, quickly and without a money mistake.
- **Shop owners ("admin" role).** They run the shop and often work the counter too. They also close the day, count drawers, settle suppliers and partners, manage stock, prices and users, and read profits. Profits, settings and most supplier and ledger screens are admin-only.
- (inferred) Users are not accountants or software people. Release notes are written for "shop owners and cashiers" in plain words, and the owner reads them on WhatsApp.

## Product Purpose

LiraTek is a point-of-sale and back-office system built for Lebanese phone shops. It records every way money moves through such a shop in one place, in dollars and lira side by side: sales and stock (with IMEI and serials), transfers through OMT and Whish, carrier recharges, bill payments (iPick, Katsh, Whish App, OMT App, Binance), currency exchange, customer debts, repairs, warranties, expenses, loto, customer baskets, drawer counts and daily closing.

Success means the drawer, the debts and the supplier balances are right at the end of the day, and the counter work was fast enough that customers did not wait on the software.

## Positioning

It is built around how a Lebanese phone shop actually works, which a generic POS cannot copy truthfully:

- Two currencies on every screen, the same as at the counter: prices, payments, change, debts and drawers in USD and LBP, with split payments across both and a live exchange rate.
- The shop's other businesses are first-class: OMT and Whish transfers with their fees worked out, MTC and Alfa credit and days, bill and voucher providers, and the supplier and partner balances each of these creates.
- The same system runs on the shop's own computer (offline-first desktop app, licence key) and in any browser at the shop's own address (multi-tenant web app, subscription).

## Operating Context

- **The counter.** Fast, repeated, interrupted work, often keyboard and barcode-scanner driven, on a desktop or laptop screen in the shop. A customer may be watching the screen.
- **Money in two currencies.** Customers pay in USD, LBP or both, and change is often given in the other currency. Rounding to a practical note is normal ("keep the small change" counts the leftover as shop profit).
- **Drawers.** Several cash drawers (general, OMT, Whish and others) that are counted during the day and closed at the end of it, with any difference shown.
- **Customer debt.** Selling on credit and taking repayments later is ordinary. Who owes what, and in which currency, is checked often.
- **Suppliers and partners.** Each recharge, transfer or bill provider is also a supplier the shop owes or is owed by. Their balances must match the provider's own statement.
- **Two runtimes, one UI.** Desktop runs in the shop (Beirut time). The web app runs on a server elsewhere, so any day or time is supplied by the client.
- **Mostly English UI today.** Arabic (right-to-left) is built but switched off in the app until the wording is reviewed; layout already uses start/end logical sides so it can turn on. Numbers always use Western digits.
- **What's new.** Every visible change ships with a plain-language release note, and new UI ships with a "What's new" card and a real screenshot.

## Capabilities and Constraints

- Modules: POS, debts, inventory, clients, exchange, OMT/Whish, recharge (MTC, Alfa, iPick, Katsh), Whish App, OMT App, Binance, loto, expenses, maintenance (repairs), custom services, customer baskets (sessions), partners, suppliers, warranty, closing and drawer counts, transactions (with void and refund), profits.
- Roles: `admin` and `staff`. Some screens and actions are admin-only.
- Every feature must work the same on desktop (Electron) and web (browser).
- Light and dark themes; dark is the default. Each user picks theme per device.
- Modules can be turned on or off per shop, and web shops have a subscription that can move to a read-only state; a shop is never locked out of its own history.
- Terminology to keep: USD and LBP (also "dollars" and "lira"), drawer, closing, checkpoint, debt, repayment, basket (customer session), supplier, partner, "Customer pays" / "Shop pays", split payment, change, void, refund.
- Provider names and logos (OMT, Whish, MTC, Alfa, iPick, Katsh, Binance) are real third-party brands shown so cashiers can recognise them at a glance.
- Undecided: when Arabic will be switched on in the app.

## Brand Commitments

- Name: **LiraTek**. Logo, mark and swirl assets are in `landing/assets/` (`liratek-logo.png`, `liratek-mark.png`, `liratek-swirl.png`).
- Voice: plain, short and concrete, written for shop owners and cashiers. Say what they can now see or do and where. No ticket numbers, no technical terms, no claims beyond what was built. (From CLAUDE.md rule 30 and the shipped release notes.)
- Brand palette anchors were chosen by the owner (Porcelain, Signal Blue, Cosmic Navy, Pastel Violet); the visual system itself is recorded in DESIGN.md.
- Red and green carry money meaning (money out or owed, money in or paid) and are not used decoratively. (Stated in the brief and enforced in `index.css` decision D1.)

## Evidence on Hand

- Real product screenshots: `frontend/public/whats-new/<version>/*.png` and `landing/screens/`.
- Demo videos: `landing/assets/demo.mp4`, `landing/assets/demo-ar.mp4`.
- Release history in plain language: `docs/release-notes/v*.md`.
- Sales contact: WhatsApp, listed on the landing page.
- **Absent, never fabricate:** public pricing (the landing page deliberately shows none), customer testimonials, named customer shops, ratings, user counts, or performance benchmarks.

## Product Principles

1. **The money must be right.** A wrong total, a wrong currency or a dropped client on a transaction is the worst failure; clarity of amounts beats every other concern.
2. **Speed at the counter.** Fewer clicks and less reading for the common case; the customer should not wait on the screen.
3. **Calm and dense.** Many numbers on screen at once, readable without effort; nothing competes with the amounts for attention. (inferred from the brief: "POS must stay calm and dense")
4. **Dollars and lira side by side.** Both currencies are always visible where money is involved, never hidden behind a toggle.
5. **One product, two places.** Desktop and web behave the same; nothing works on only one unless it says so.

## Accessibility & Inclusion

- Text and labels on filled buttons meet WCAG AA contrast in both themes (contrast ratios are checked and recorded in `index.css`).
- Meaning is never carried by colour alone where money is involved. (inferred: red and green are paired with signs, labels or IN/OUT badges in the current UI)
- Right-to-left layout must keep working for when Arabic is switched on: use start/end, not left/right.
- (inferred) Users range from young cashiers to older owners on varied, sometimes old shop computers and screens; do not rely on fine detail, tiny text below `text-xs` (12px), or heavy effects.
