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
| **PFT-1** | Schema: DROP `partner_ledger.transaction_type` CHECK → free-form (migration table-rebuild + create_db.sql); add USDT bucket to `getBalanceBreakdown`. Replay on a prod DB copy. | ⬜ |
| **PFT-2** | PARTNER_ACCOUNT routing + **POS** reference + **type-agnostic partner_ledger reversal in voidTransaction/refundTransaction** (fixes the pre-existing FOR_OMT gap too). Failing-first: create+void nets partner ledger to 0; drawer deltas normal. | ✅ 2026-07-13 (lira-113) |
| **PFT-3** | Recharge family: MTC/Alfa, Katsh/iPick, OMT App/Whish App, Binance (FOR_* each; Binance = USDT). | ⬜ |
| **PFT-4** | Loto (FOR_LOTO) + refine existing FOR_OMT "skip General" → conditional so cash paid now is collected (preserving the system-commission profit). | ⬜ |
| **PFT-5** | Partners page: verify the new `FOR_*` rows + USDT balance render/settle. | ⬜ |
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
