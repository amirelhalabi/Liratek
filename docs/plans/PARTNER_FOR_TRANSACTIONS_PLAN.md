# Partner FOR-Transactions — POS / Recharge / Loto on the partner's account

> **Created**: 2026-07-13
> **Origin**: Owner request — extend "for partner" beyond the primary OMT
> system to POS, mobile recharge (MTC, Alfa, Katsh, iPick, OMT App, Whish App,
> Binance) and loto.
> **Tickets**: PFT-1 … PFT-5.

## The model (owner-confirmed, 2026-07-13)

A FOR-partner transaction is a **normal transaction** — same stock/credit
consumed, same **sell-price** billing, same **profit stamped** (POS margin,
recharge markup, loto commission, OMT system commission) — with ONE
difference: the **unpaid remainder books to `partner_ledger` (FOR_*, DEBIT)**
instead of a client's `debt_ledger`, against a **selected partner** instead of
a client.

- "No fee for the partner" = **no surcharge beyond normal pricing**, NOT
  waiving profit. (Reconciled with the earlier "no profits" phrasing; owner
  chose keep-normal-margin explicitly.)
- **Payment**: the customer/partner pays what they pay now via the normal
  drawer methods (CASH / OMT / WHISH / Binance) → drawers as usual; the
  remainder → the partner's account. This is **"PARTNER_ACCOUNT" as the
  deferred bucket in place of CUSTOMER_ACCOUNT** — every module that already
  charges a client's account gets the partner analog.
- **Settlement**: the partner pays their balance down via the existing
  Partners-page settlement methods (CASH/OMT/WHISH/BINANCE/CLIENT_ACCOUNT).

## Investigation (confirmed in code)

- **Account-debt booking is PER-REPOSITORY** (SalesRepository,
  RechargeRepository, FinancialServiceRepository, LotoTicketRepository,
  CustomServiceRepository each insert their own `debt_ledger` row for the
  unpaid remainder / CUSTOMER_ACCOUNT leg). No shared helper → PARTNER_ACCOUNT
  routing is per-module work (this drives the phasing).
- **partner_ledger is generic EXCEPT `transaction_type`**: `reference_table`/
  `reference_id`, `amount`, `currency`, `direction`, `settlement_method`,
  `notes` are free-form; the balance (`getBalanceBreakdown`) buckets by
  `transaction_type LIKE 'FOR_%'` / `'THROUGH_%'`, **per currency (USD+LBP),
  netted** — so new `FOR_*` types need ZERO balance-logic change.
- **Two schema gaps**: (a) `transaction_type` is a fixed CHECK enum; (b) the
  balance breakdown has USD+LBP buckets only — no USDT (Binance in scope).

## Risks

- **SQLite CHECK change = table rebuild.** You cannot `ALTER` a CHECK
  constraint; widening `partner_ledger.transaction_type` means create-new →
  copy → drop → rename (or dropping the CHECK to free-form). This is the
  delicate part — memory scar: a guarded/þrebuild migration (v104) bricked
  prod once. Test on a real client DB copy before release
  (migrations-test-against-prod-db-copy). **Alternative to weigh: drop the
  CHECK entirely** (transaction_type free-form) — simpler rebuild, loses a
  guardrail the balance logic doesn't rely on anyway.
- **USDT in the balance** (Binance): mirror the expenses lesson — a FOR_BINANCE
  ledger row is USDT; without a USDT bucket it's invisible in the balance.
- Rules 15/17/19/20 apply per module (delta asserts, failing-first, both
  transports where a REST route exists, create+reverse nets to 0 per currency
  incl. the partner ledger).

## Advisor-locked decisions (2026-07-13)

- **DROP the CHECK to free-form** (not widen). The balance contract is the
  `FOR_%`/`THROUGH_%` **prefix in code**, not the DB enum — the CHECK enforces
  nothing the balance needs. Widening signs up for a rebuild per future type;
  drop it once. Rebuild inside the migration txn, recreate the 2 indexes +
  partner_id/user_id FKs; replay on a real client DB copy before release.
- **Partner-ledger reversal is a PFT-2 item (rule 20), and fixes a
  PRE-EXISTING bug.** Confirmed via the FOR_OMT void oracle: `voidTransaction`
  does NOT touch `partner_ledger` at all — so voiding ANY partner transaction
  (existing FOR_OMT/THROUGH_* included) already strands its ledger row. PFT-2
  adds a **type-agnostic** reversal in `voidTransaction`: for the voided
  transaction, find `partner_ledger` rows `WHERE reference_table =
  original.source_table AND reference_id = original.source_id` and write a
  negating CREDIT (journal pattern; guard double-reversal via the VOIDED
  status gate). This covers FOR_* AND the pre-existing FOR_OMT/THROUGH_* gap
  uniformly. Prove create+void nets partner ledger to 0 per currency,
  failing-first.
- **Routing is mutually exclusive + partner-gated**: FOR-partner remainder →
  `partner_ledger`; else → client `debt_ledger`; NEVER both on one txn.
  Requires a selected partner (the partner analog of `canChargeToCustomerAccount`).
- **Remainder is native to the transaction currency** (T2 lesson): profit
  stamps in full at sell price; the partner DEBIT = (sell − paid-now legs) in
  the txn's own currency, never a collapsed converted figure. USDT bucket for
  Binance.
- **PARTNER_ACCOUNT surfacing**: implicit "remainder-on-selected-partner"
  (mirrors client debt), not a new dropdown method.

## Phases

| Ticket | Scope | Status |
| ------ | ----- | ------ |
| **PFT-1** | Schema: DROP `partner_ledger.transaction_type` CHECK → free-form (migration table-rebuild + create_db.sql); add USDT bucket to `getBalanceBreakdown`. Replay on a prod DB copy. | ✅ 2026-07-13 (6cc3672) |
| **PFT-2** | PARTNER_ACCOUNT routing + **POS** reference + **type-agnostic partner_ledger reversal in voidTransaction/refundTransaction** (fixes the pre-existing FOR_OMT gap too). Failing-first: create+void nets partner ledger to 0; drawer deltas normal. | ✅ 2026-07-13 (lira-113) |
| **PFT-2b** | Frontend: POS checkout "For Partner" toggle + partner picker (dual-transport). | ✅ 2026-07-13 (dc829f2, lira-114 + lira-web-013) |
| **PFT-3a** | Recharge family MTC/Alfa → `FOR_RECHARGE` routing. | ✅ 2026-07-13 (6a8dc06, lira-115) |
| **PFT-3b** | Financial-service family: Katsh/iPick, OMT App/Whish App, Binance (`FOR_*` each; Binance = USDT) + refine existing FOR_OMT "skip General" → conditional cash-at-time. **Open forks: Binance remainder currency (USDT vs cash), RECEIVE direction.** | ⬜ (Wave 2, serial) |
| **PFT-4** | Loto → `FOR_LOTO` routing (LBP; non-reversible, settlement-owned reversal). | ✅ 2026-07-13 (d91785d, lira-116) |
| **PFT-5** | Partners page: `FOR_*` rows render (prefix parser) + USDT balance card/settle. **Also fixed a real bug: USDT settle direction was keyed off the USD balance sign.** | ✅ 2026-07-13 (a019798, lira-117) |
| **PFT-6** | Profit recognition on partner settlement (Model A, owner-decided): FIFO settlement→source linkage bumps the source paid state so `saleFullyPaid` opens. Cross-cutting; built once after routing. | ⬜ |

## PFT-6 — profit recognition on partner settlement (OWNER DECIDED: Model A)

**Owner decision 2026-07-13: recognize profit WHEN THE PARTNER SETTLES**
(defer like client debt — Model A below). Rationale: matches the shop's real
cash and the existing on-account treatment; a normal credit sale already defers
profit until repayment. Does not block PFT-2/3/4 routing (routing is
model-independent); PFT-6 is the cross-cutting recognition mechanism, built once.

**PFT-6 to build:** partner FOR_* settlement must link back to the source
transaction(s) and open the fully-paid gate — mirror the supplier FIFO coverage
pattern (`TransactionRepository._unapplySupplierPurchaseCoverage` /
`_applySupplierPurchaseCoverage` already do FIFO settlement→purchase linkage).
On a partner settlement, apply the paid amount FIFO across that partner's open
FOR_* DEBIT rows, and for each source sale/service now covered, bump its paid
state (`sales.paid_usd` etc.) so `saleFullyPaid` opens and the stamped margin
enters realized profit. Prove failing-first: a FOR-partner sale's margin is
pending before settlement, realized after (rule 17), and nets to 0 on void of
either the sale or the settlement (rule 20).

**Surfaced during PFT-2 (advisor-flagged).**

A FOR-partner POS sale paid partly in cash leaves the remainder on the
partner's account (e.g. $40 cash of a $100 sale → `sales.paid_usd = 40`, $60 →
`partner_ledger` FOR_POS DEBIT). The profits summary recognizes SALE profit only
when the sale is **fully paid** (`ProfitRepository.saleFullyPaid`:
`paid_usd + paid_lbp/rate >= final_amount − 0.05`). So this sale's $40 margin is
**stamped on the transaction but excluded from the summary** until fully paid.

For a normal **client**-debt sale the margin is eventually recognized because
debt repayment **bumps `sales.paid_usd`** → the gate opens. But **partner
settlement writes only `partner_ledger`** (a bulk balance paydown, not
per-sale) and never touches `sales.paid_usd` → **the FOR-partner sale never
flips to fully-paid → its margin is stranded.** This contradicts the owner's
"keep normal margin".

Verified in code (2026-07-13): `getSalesProfit`, `getByUser`, `getByClient`,
`getByDate` all gate SALE profit on `saleFullyPaid`; partner settlement
(`PartnerRepository`/settle) has no link back to the source sale.

**Two defensible models for the owner to choose (PFT-6):**

- **(A) Defer like client debt** — profit realized only when the partner
  settles. Needs a recognition mechanism: partner FOR_POS settlement must mark
  the referenced sale(s) paid (hard — a lump settlement doesn't say which sale).
- **(B) Recognize at sale** — treat the FOR-partner remainder as
  partner-guaranteed (sale is "covered" $40 cash + $60 partner receivable), so
  stamp + recognize the full margin immediately; the `partner_ledger` row is a
  pure receivable decoupled from profit. Simpler; matches "normal margin" on a
  cash sale, but books unrealized margin before the partner pays.

Until resolved, a FOR-partner POS sale's margin sits in **pending profit**
(`getPendingSaleProfit`) — visible, not lost, but not in realized totals. Flag
to owner before PFT-3/4 (recharge/loto have the same fully-paid-gate shape).

---

# ⭐ VALIDATED FLOW CATALOG (owner-validated 2026-07-13) — SOURCE OF TRUTH

**This supersedes the "customer pays cash, remainder to partner" (walk-in)
model used everywhere above.** After a detailed owner interview, the model is:

## Governing principle
A "for partner" transaction has **NO walk-in customer in between** — the shop
acts for the partner, who **owes** the shop (SEND) or **is owed** by the shop
(RECEIVE) the **FULL amount**. **No cash is taken at the counter** for the
customer side. Everything is squared up later on the **Partners page
settlement**. The partner is selected via a **"For Partner" checkbox + partner
div** (the OMT-system pattern) on every applicable form.

## Profit timing
- **Immediate** (stamped + realized at the transaction): **iPick / Katsh only.**
- **Deferred until the partner settles**: everything else — POS margin, recharge
  markup, loto commission, and ALL OMT / OMT App / Whish App / Binance
  fees/commissions (SEND and RECEIVE). (Owner retracted the earlier
  "fee is immediate" — FS fee/commission is real only on settlement.)

## SEND — partner OWES the shop (partner_ledger DEBIT)
| Service | Drawer effect (normal flow kept) | Partner owes | Profit |
| --- | --- | --- | --- |
| **POS** | stock −qty; **NO cash drawer** | full sale price (USD) | margin — deferred |
| **Recharge MTC/Alfa** | MTC/Alfa provider drawer −amount | full price (USD/LBP) | markup — deferred |
| **Loto** | supplier float (normal) | full ticket value (LBP) | commission — deferred |
| **OMT system / OMT App / Whish App** | **existing OUT-payment form, any method (drawer follows method: cash→General, etc.); fee already in the form** | **full amount paid** | commission — deferred |
| **Binance** | **Binance/USDT drawer −(USDT sent)** | **full amount in USD** | margin — deferred |
| **iPick / Katsh / MTC-Alfa bill / Whish App bill** | cost/provider (normal) | **selling price** | margin — **IMMEDIATE** |

## RECEIVE — shop OWES the partner (partner_ledger CREDIT)
| Service | Drawer effect | Shop owes partner | Fee |
| --- | --- | --- | --- |
| **OMT system** | OMT drawer +amount | full amount | **no fee** |
| **OMT App** | OMT App drawer +amount | amount − fee (if fee) | optional — deferred |
| **Whish App** | Whish App drawer +amount | amount − fee (if fee) | optional — deferred |
| **Binance** | **Binance/USDT drawer +amount** | amount − fee (if fee), **in USD** | optional — deferred |

- No immediate payout on RECEIVE — the shop pays the partner **at settlement**
  (any method). The service drawer just increases by the received amount.

## Currency
- **Binance partner debt is USD both ways** (the drawer moves in USDT, but the
  partner owes/is-owed **USD**). → A partner **never carries a USDT balance**.
  **Remove USDT from the settle-currency options** and the USDT partner balance
  card (PFT-5 built these under the obsolete "track in USDT" answer). The
  Binance/USDT **drawer** is still real (currency_drawers), only the partner
  *ledger* is USD/LBP. (PFT-1's usdt bucket in `getBalanceBreakdown` becomes dead
  but harmless — leave it.)

## Partners page
- **Settlement** nets balances per currency (USD/LBP); paying down a DEBIT /
  paying out a CREDIT is **when the deferred profit is recognized** (PFT-6).
- **KEEP the "Add credit / debt" button** (owner wants it) — a general manual
  partner-ledger adjustment tool, like the Accounts page.

## UI
- All SEND/RECEIVE financial-service forms (OMT system, OMT App, Whish App,
  Binance) get the **OMT-system "For Partner" checkbox + partner div**. The OMT
  App / Whish App / Binance forms currently **auto-select the single partner** —
  that is the bug to fix (make it opt-in via the checkbox).

## Impact on already-shipped Wave-1 work (must be REVISED)
- **PFT-2 (POS), PFT-3a (recharge), PFT-4 (loto)** shipped on the walk-in
  remainder model → **revise to full-amount, no counter-cash step in partner
  mode**; update lira-113/114/115/116 to assert the full amount + no drawer cash.
- **PFT-5 (partners)** → **remove the USDT settle-currency option + USDT balance
  card**; lira-117 (USDT settle) becomes obsolete (remove/repurpose). Keep the
  getBalance/getAllBalances plumbing (harmless).

## Re-scoped remaining tickets
| Ticket | Scope | Status |
| --- | --- | --- |
| **PFT-R** | Revise POS/recharge/loto (PFT-2/3a/4) walk-in→full-amount; hide counter-cash in partner mode; update their e2es | ✅ 2026-07-13 (a65d70f, lira-113/114/115/116) |
| **PFT-R5** | Remove USDT settle option + card (Binance debt is USD); obsolete lira-117 | ✅ 2026-07-13 (9fb33ad) |
| **PFT-7** | Partners page **"Add credit / debt"** manual-adjustment button (dual-transport) | ✅ 2026-07-13 (9fb33ad) |
| **PFT-3b** | FS SEND (OMT/OMT App/Whish App via OUT-payment form; iPick/Katsh/bills selling-price; Binance USDT-drawer/USD-debt) + FS RECEIVE (OMT/App/Whish App/Binance: service drawer +amt, owe partner amount−fee). "For Partner" checkbox+div on each; fix auto-select. | ⬜ BLOCKED (other session owns FinancialServiceRepository) |
| **PFT-6** | Settlement→profit recognition — **BIGGER than first planned** (see note) | ⬜ |

### PFT-6 design (locked 2026-07-14, pre-build)

**Mechanism: per-row FIFO coverage on `partner_ledger`, ONE shared pending
predicate in `ProfitRepository`.**

1. **Migration v128** (+ `create_db.sql`): `partner_ledger` +
   `covered_amount REAL NOT NULL DEFAULT 0` (plain constant default — safe per
   the migrations-on-prod-copy scar; replay before release).
2. **Coverage application**: when a `SETTLEMENT` or manual `ADJUSTMENT` row is
   booked with direction D, apply |amount| FIFO (oldest first) across the
   partner's OPPOSITE-direction `FOR_%` rows in the same currency
   (`covered_amount < amount`), bumping `covered_amount`. `FOR_%`/`THROUGH_%`
   rows never act as coverage sources — this keeps void-reversal rows (same
   FOR_ type, opposite direction) from fake-settling their own original.
   Voiding an already-covered FOR row does NOT rebalance coverage (v1;
   the void's profit negation nets the P&L anyway — documented).
3. **Profit gates** (`ProfitRepository`, rule 14 — ONE named fragment):
   `partnerPending(refTable, refId)` = EXISTS an uncovered `FOR_%` row
   (excluding `FOR_IPICK`/`FOR_KATSH`, which the owner wants immediate).
   - SALE arms: gate becomes `saleFullyPaid OR (has FOR_POS row AND NOT
     partnerPending)` — a covered partner sale realizes; uncovered stays
     pending; non-partner sales unchanged.
   - Recharge / loto / FS / custom / maintenance profit arms: add
     `AND NOT partnerPending(...)` (they have NO pay gate today — this is the
     fix for the early-recognition gap below).
4. **E2E (lira-120, failing-first)**: for-partner sale + recharge + loto + FS
   → profit summary delta 0 (pending) → settle the partner in full → deltas
   appear (dated at the source txn's day). iPick/Katsh: delta appears
   immediately. Pre-gate code counts recharge/loto/FS immediately → the
   "pending before settlement" assertions fail.

**Separate finding — settlement moves NO money (PFT-6b, owner input needed):**
`PartnerService.settle` books only the partner_ledger row — no drawer
movement, no unified transaction. When a partner pays their tab in CASH the
General drawer does not change (pre-existing; also true for THROUGH
settlements). Under the full-amount model this is now a visible gap. Proposed
PFT-6b: settlement writes a unified txn + a payment leg per
`settlement_method` (CASH→General, etc.), with a named reversal owner (rule
20). **OWNER APPROVED 2026-07-14: yes — settlement moves the drawer** (cash
settlement hits General; method-specific drawers otherwise; voidable/audited
like other transactions).

### ⚠️ PFT-6 re-scope (found 2026-07-13, advisor)
The owner-decided defer-to-settlement is **only partially true in code today**:
- **POS** defers *naturally* — a for-partner sale has `paid_usd = 0`, so
  `saleFullyPaid` is false and its margin is already excluded from realized
  profit. PFT-6's "FIFO settlement → bump `paid_usd` → open the gate" fixes POS.
- **Recharge / loto / FS have NO payment gate** — `getRechargesByCurrency`,
  `getLotoTotals`, and the FS commission queries count profit as soon as the row
  exists. So a for-partner recharge/loto/FS **counts its markup/commission
  immediately** (live as of `a65d70f`), contradicting the owner's decision. The
  Wave-1/PFT-R e2es assert partner-balance deltas only, never profit — so this
  was not caught.
- **Therefore PFT-6 must add a per-module "recognized only when the partner has
  settled" gate** in `ProfitRepository` (the other session's file) for
  recharge/loto/FS, not just the sales `paid_usd` bump. iPick/Katsh stay
  immediate. This enlarges PFT-6 and couples it to `ProfitRepository`.
