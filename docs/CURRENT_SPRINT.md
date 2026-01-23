# Current Sprint (Dec 19–Dec 26, 2025)

Note: This is the canonical, single source of truth for active work, backlog, and done. Older planning/status docs are deprecated in favor of this file.

Goal: Type-safe cross-layer contracts, UI polish (services/exchange), and event/logging consistency.

On Hold

- Phase 3: Repositories typing — ProductRepository done; SalesRepository deep-typed (rows, aggregates)

Todo

> Conventions: use checkboxes; add an owner + target date when a task becomes active.

### P0 — Release Quality / Distribution (On Hold)

- [ ] (On Hold) Installer QA on real systems (Windows installer + macOS .app/.dmg)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] (On Hold) Build verification on clean machines (first-run, single-instance behavior, permissions)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] (On Hold) Code signing setup (macOS notarization + Windows signing)
  - Owner: @TBD
  - Target: YYYY-MM-DD

### P1 — Shipping Improvements (On Hold)

- [ ] (On Hold) Increase automated test coverage toward ~70% (keep CI green)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] (On Hold) Auto-updater implementation (beyond scaffold)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] (On Hold) User documentation / help system (install/admin + user guide)
  - Owner: @TBD
  - Target: YYYY-MM-DD

### P2 — Operational Enhancements

- [x] Closing report auto-attach
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [x] Variance threshold alerts (Closing) + setting (`closing_variance_threshold_pct`)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [x] Database indexes + performance hardening
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [x] Local backup automation + restore verification
  - Owner: @TBD
  - Target: YYYY-MM-DD

#### P2 — Operational Enhancements (Technical Specifications)

- [ ] [T-01] Two-Wallet System & Mixed Payment Support
  - Owner: @TBD
  - Target: YYYY-MM-DD
  - Clarifications (Dec 31, 2025):
    - Payment methods needed: `CASH` (already), `WHISH`, `OMT`, `BINANCE`
    - Each payment method maps to a drawer:
      - `CASH` → General drawer (cash only)
      - `WHISH` → Whish drawer
      - `BINANCE` → Binance drawer
      - `OMT` → OMT drawer (already exists conceptually in Closing)
    - Currency scope for POS payments (for now): `USD` and `LBP` only (other currencies later)
    - Important rule: all **cash** payments (USD/LBP) affect the **General** drawer
    - Note: app supports admin-managed currencies, but POS multi-payment lines should start with USD/LBP only
    - Opening/Closing behavior:
      - All drawers must appear in Opening and Closing (including new `WHISH` and `BINANCE` drawers).
      - "Expected" amounts are computed automatically from transactions and should change immediately after each sale/service.
      - In Closing, the operator should only enter/edit the *actual* physical amounts when there is a difference versus expected (variance).
    - Recharge rule clarification:
      - MTC/Alfa drawers represent **telecom balance** (checked on the shop phone numbers), not physical cash.
      - When a recharge is sold: the customers payment increases the selected payment-method drawer by the **full price**, and the MTC/Alfa telecom balance decreases by the recharge `amount`.
- [ ] [T-02] Supplier Ledger (Dual-Currency Debt)
  - Owner: @TBD
  - Target: YYYY-MM-DD
  - Suggested enhancement (not yet implemented):
    - Add a "Pay Supplier" workflow that can optionally update running cash drawers automatically:
      - When recording a PAYMENT entry, also write to `payments` and update `drawer_balances` to subtract from the selected payment-method drawer (CASH/OMT/WHISH/BINANCE) in the specified currency.
      - Keep this optional/confirmable to avoid accidental drawer mutations.
      - This aligns supplier settlements with the same running-balance model used by Sales/Expenses/Services.
- [ ] [T-03] Smart Barcode Duplicate & Autogen Handler
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] [T-04] Telecom Profit Engine (MTC/Alfa Special Logic)
  - Owner: @TBD
  - Target: YYYY-MM-DD
  - Open technical clarifications (to confirm before implementation):
    - Recharge accounting scope: Should MTC/Alfa profit be tracked as a separate ledger/report (recommended) rather than altering cash drawers?
    - Commission/fees: When applying the $0.16 fee and bundle logic, should fees be applied per transaction line item or only for specific recharge types (e.g., CREDIT_TRANSFER only)?
    - Bundle lookup source: Where should the “Returned Dollars” mapping live (DB table vs static config), and how should it be editable (admin UI vs hardcoded)?
    - Profit storage: Where should we persist profit totals (daily profit table / activity log / new `telecom_profit` table), and do we need separate totals for MTC, Alfa, and combined?
    - Reporting: Should profit be computed at transaction-save time (persisted) or computed on-demand from historical transactions (and what about edits/late entries)?
    - Drawer interaction: Confirm whether telecom profits should be displayed in Opening/Closing as informational-only or treated as a balance that can be manually verified.
- [ ] [T-05] Loto Module (Real-time Profit Tracking)
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] [T-06] Binance Service Module
  - Owner: @TBD
  - Target: YYYY-MM-DD
- [ ] [T-07] Admin-Only Security “Late Entry”
  - Owner: @TBD
  - Target: YYYY-MM-DD

Ready for Testing

Completed

- Opening/Closing: Opening modal is now accessible from anywhere (moved listener/modal to MainLayout)
- Modals: click-outside-to-close enabled across key modals (Opening/Closing, POS Checkout + receipt preview, ProductForm, ClientForm, Expenses, Debts, Maintenance)
- Modals: fixed rounded corner clipping (added overflow-hidden to containers)
- Tests: fixed React act(...) warning in useCurrencies hook test
- Maintenance hooks cleanup (avoid set-state-in-effect)
- Notifications: Introduced NotificationItem and typed TopBar/NotificationCenter
- POS: Typed drafts, checkout handlers, and removed remaining any types
- Lint executed; reduced warnings in appEvents/NotificationCenter and Settings UI; remaining warnings deferred to next passes
- appEvents: typed overloads with generic fallback (keeps tests like "ping")
- Preload typing pass: Inventory, Clients, Debt, Exchange, OMT, Closing payloads
- Activity logs: unified to details_json across repositories (FinancialService, Exchange, Recharge, Maintenance)
- Legacy DB migration: ensured activity_logs.details_json; OMT/Whish transaction retest passed
- Phase 2 progress: Cleaned error handling in Settings, Expense, Rate, Report, Currency, Client, Closing, Exchange, Financial, Inventory, Sales, and Maintenance services; tests all green
- Services/Exchange layout: constrained cards to max-h-[80vh], reduced padding
- Debts/Dashboard: introduced concrete DTO types; tooltip formatter typed
- ClientForm: normalized whatsapp_opt_in to 0/1 and separated create/update payloads
- Services page layout: adjusted OMT/Whish cards to fit viewport without nested scroll
- Quotation: Confirmed Developer Total (excl. Hardware) is $1000
- Checks: yarn lint, typecheck, tests (413), coverage summary generated, and build succeeded
- Phase 3 progress: ProductRepository typing improvements (removed any in error paths), SalesRepository catch normalization

Checks

- Lint/Typecheck/Tests/Coverage run daily; gate merges on passing status.

Backlog

- Data archival strategy (>1 year records) — define retention + archive workflow/tooling
- Multi-location support
- Real-time drawer balance improvements
- Optimization pass (runtime perf + build size)
- Opening/Closing Phase 2 improvements
- Marketing plan follow-ups
- Cloud sync continuation
- DRM/licensing
- Smart barcode duplicate handling (DUP1, DUP2...)
- Optional future modules: Supplier payables, Loto
- Code signing (macOS notarization + Windows signing)

Notes

- Quotation template updated to reflect $1000 developer total (excluding hardware).
- Lint is currently clean in CI checks; keep it at 0 warnings going forward.


(Technical specifications T-01..T-07 were promoted into the main **Todo** section above.)

last chat
Added the suggested T‑02 improvement option (no implementation) to docs/CURRENT_SPRINT.md under the [T-02] Supplier  │
│ Ledger (Dual-Currency Debt) task:                                                                                    │
│                                                                                                                      │
│  • Proposed a “Pay Supplier” workflow that optionally:                                                               │
│     • writes to payments                                                                                             │
│     • updates drawer_balances by subtracting from the selected payment-method drawer (CASH/OMT/WHISH/BINANCE) in the │
│       specified currency                                                                                             │
│     • includes an explicit confirmation to avoid accidental drawer mutations                                         │
│                                                                                                                      │
│ What would you like to do next:                                                                                      │
│                                                                                                                      │
│  1 Add more T‑02 clarifications (e.g., supplier payment method selection + default),                                 │
│  2 Start discussing T‑04 answers, or                                                                                 │
│  3 Move to T‑07 “Late Entry”?                                                                                        │