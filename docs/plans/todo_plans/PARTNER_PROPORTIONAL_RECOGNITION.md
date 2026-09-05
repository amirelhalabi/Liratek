# Partner-Proportional Profit Recognition — Foundation (Step 1 of 3)

Owner decision 2026-09-05: partner obligations across `ProfitRepository`'s
`FOR_%` modules are recognised **proportionally as the partner pays**,
instead of all-or-nothing. Scope is the Profits page only. `ClosingRepository`
keeps its binary gate, `ExchangeRepository`'s single site is untouched, and
client debt (`notDebtPending`, 36 sites) is untouched — DBT-1 stands.

This document is the output of **Step 1** (foundation): the shared SQL
fragment, its unit tests, and this classification. **No existing query was
converted** — every one of the 19 call sites below still runs exactly the
query it ran before this change; that is proven by the unchanged jest
baseline (see "Verification" at the end).

---

## 1. The fragment

Added to `packages/core/src/repositories/ProfitRepository.ts`, immediately
after `notPartnerPending` (its binary sibling):

```ts
export function partnerCoverageRatio(refTable: string, idExpr: string): string {
  return `COALESCE(
    (
      SELECT MAX(0.0, MIN(1.0,
        SUM(plr.covered_amount) / NULLIF(SUM(plr.amount), 0)
      ))
      FROM partner_ledger plr
      WHERE plr.reference_table = '${refTable}'
        AND plr.reference_id = ${idExpr}
        AND plr.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
    ),
    1.0
  )`;
}
```

- Row selection (`reference_table`, `reference_id`, `transaction_type LIKE
  'FOR\_%' ESCAPE '\'`) is copy-identical to `notPartnerPending`'s own WHERE
  clause (rule 14 — one definition of "what counts as a partner row"). The
  only difference is this fragment does **not** additionally filter
  `covered_amount < amount - 0.005` — every matching FOR_% row (covered or
  not) must contribute to both SUMs, or an already-fully-covered row would
  be silently dropped from the ratio.
- **Defaults to 1.0** when a row has no FOR_% rows at all (both SUMs are
  SQL NULL → division is NULL → outer `COALESCE` returns 1.0) — a
  non-partner row recognises fully, unchanged from today.
- **Clamped to `[0, 1]`** via the scalar (2-argument, not the 1-argument
  aggregate) `MIN`/`MAX` forms — verified empirically that better-sqlite3's
  bundled SQLite resolves 2-argument `MIN`/`MAX` to the scalar row-wise form
  even when one argument is itself an aggregate expression (`SUM(...)`
  collapsed to a single row); see the "multiple FOR_% rows" and
  "over-coverage" unit tests.
- **`NULLIF` guards the division** so a zero-`amount` FOR_% row degrades to
  the same 1.0 default instead of propagating a bare NULL.
- **Derived at read time, never stamped.** `PartnerRepository
  .applySettlementCoverage` (incrementing `covered_amount`, oldest-uncovered-
  first FIFO, ~line 424) and `TransactionRepository
  ._unwindPartnerSettlementCoverage` (decrementing it, newest-covered-first
  reverse-FIFO, ~line 3286) both change what this fragment returns on the
  very next read, with no reversal code of its own needed — rule 20 is
  satisfied by construction because nothing is recorded against the source
  row to begin with.

Full rationale (why 1.0, why the clamp, why derive-never-stamp, and the
two-way cross-reference to `notPartnerPending`) is written as the fragment's
own doc comment in `ProfitRepository.ts`.

## 2. Unit tests

`packages/core/src/repositories/__tests__/ProfitRepository.partnerCoverageRatio.test.ts`
— 9 tests, exercising the raw SQL expression against a minimal in-memory
schema (`source_rows(id)` + `partner_ledger(reference_table, reference_id,
transaction_type, amount, covered_amount, tenant_id)`), independent of any
`ProfitRepository` method (the fragment isn't wired into one yet):

| # | Case | Result |
|---|---|---|
| 1 | No FOR_% rows at all | `1.0` |
| 2 | Zero coverage | `0` |
| 3 | Half coverage | `0.5` |
| 4 | Full coverage | `1.0` |
| 5 | Over-coverage | clamped to `1.0` |
| 6 | Defensively-negative `covered_amount` | clamped to `0` |
| 7 | Two FOR_% rows, $100/$100 covered + $0/$300 uncovered | `0.25` (dollar-weighted `SUM(covered)/SUM(amount)`), explicitly asserted `!= 0.5` (the naive per-row average) — proves aggregation, not averaging |
| 8 | A `THROUGH_%` row present, no `FOR_%` row | `1.0`, and cross-checked that `notPartnerPending`'s own NOT EXISTS agrees (`true` = not pending) on the identical fixture — proves both fragments select the same rows |
| 9 | Two different source rows, one covered one not | ratios are independent per row (no global-scan leakage) |

**Result: 9 passed, 9 total.**

## 3. Environment

- `better-sqlite3` was on the Electron ABI (verified by constructing a
  `Database` instance, not just `require`-ing the module — a bare `require`
  is a documented false positive here). Ran `yarn rebuild:node` once, as
  authorized. Confirmed Node ABI afterward by constructing an in-memory DB.
- Core jest, full run **before** any change (re-established empirically
  rather than trusted from the task prompt): **268 suites / 2816 tests,
  exit 0, 39.1s.**
- Core jest, full run **after** adding the fragment + its test file:
  **269 suites / 2825 tests, exit 0, 32.9s.** Delta is exactly +1 suite /
  +9 tests (the new file) — the pre-existing 268/2816 are byte-for-byte
  unchanged, proving the fragment addition altered zero existing behaviour.
- `cd packages/core && npm run build` — clean, zero errors.
- Did **not** run `yarn dev`, `yarn build`, or Playwright, per instructions.
  Did **not** sync into `node_modules/@liratek/core`.

---

## 4. Classification of the 19 `notPartnerPending` call sites

A naive `grep -n "notPartnerPending("` over `ProfitRepository.ts` returns 20
lines — but one of those (the `export function notPartnerPending(refTable
...` line itself) is the fragment's own **definition**, not a call site.
Excluding it leaves exactly **19 real invocations**, which is what is
classified below. (If "20" was arrived at by a similarly naive grep, this
reconciles it; the three lane ranges the task specifies — A: 2, B: 7, C: 10
— sum to 19, so the lane split itself already agrees with this count.)

Line numbers below are **current**, i.e. after this change (the new
fragment + its ~98-line doc comment, inserted right after `notPartnerPending`,
shifted every subsequent line by a constant +98). The task's own line
citations (`~432/~688`, `~1127-1400`, `~1619-2058`) map to the **pre-change**
file; add 98 to land on the row in the table below.

| # | Current line | Enclosing method / CTE | `refTable` arg | Monetary columns returned by that query |
|---|---|---|---|---|
| 1 | 530 | `salePaidOrPartnerSettled(alias)` helper — embeds `notPartnerPending("sales", alias.id)` in its OR-arm | `sales` | *(indirect — see §5; consumed by `getSalesRevCost`, `getSalesProfit`, `getByDate`'s `daily_sales`/`daily_sales_profit`, and via a second wrapper by `getByUser`/`getByClient`'s sale arm)* |
| 2 | 786 | `supplierSettlementProfitArm(hasAllocations, currency)` helper — one gate inside the `cashless` CASE branch | `financial_services` | *(indirect — see §5; consumed by `getByUser`/`getByClient`'s SUPPLIER_SETTLEMENT arm: `profit_usd`/`profit_lbp` only, no revenue/cost pair)* |
| 3 | 1225 | `getSupplierCommissionTotals` — `cashless` bucket | `financial_services` | `profit_usd`, `profit_lbp`, `count` (`COUNT(DISTINCT sca.settlement_ledger_id)`) |
| 4 | 1255 | `getFinancialSettledByCurrency` | `financial_services` | `revenue`, `commission`, `count` (`COUNT(*)`) — grouped by currency |
| 5 | 1323 | `getMobileServicesByCurrency` | `financial_services` | `revenue`, `cost`, `profit`, `count` (`COUNT(*)`) — grouped by currency |
| 6 | 1351 | `getRechargesByCurrency` | `recharges` | `revenue`, `cost`, `profit`, `count` (`COUNT(*)`) — grouped by currency |
| 7 | 1382 | `getCustomServicesTotals` | `custom_services` | `revenue_usd`, `revenue_lbp`, `cost_usd`, `cost_lbp`, `profit_usd`, `profit_lbp`, `count` (`COUNT(*)`) |
| 8 | 1444 | `getLotoTotals` | `loto_tickets` | `revenue_lbp`, `profit_lbp`, `count` (`COUNT(*)`) |
| 9 | 1498 | `getExchangeTotals` | `exchange_transactions` | `profit_usd`, `revenue_usd`, `count` (`COUNT(*)`) |
| 10 | 1717 | `getFinancialSettledByProvider` — allocation (UNION) arm | `financial_services` | `profit_usd`, `profit_lbp` (real); `revenue_usd`, `revenue_lbp` deliberately `0` (no revenue/cost pair for a commission-only allocation); `count` deliberately `0 AS count` (the underlying fs row is already counted once by the base arm — see #11) |
| 11 | 1749 | `getFinancialSettledByProvider` — base arm | `financial_services` | `revenue_usd`, `revenue_lbp`, `profit_usd`, `profit_lbp`, `count` (`COUNT(*)`) — the two arms are `UNION ALL`'d then re-`SUM`'d/re-`GROUP BY`'d by the outer query into the method's final `FinByProviderRow` (same five columns) |
| 12 | 1778 | `getRechargesByCarrier` | `recharges` | `revenue_usd`, `revenue_lbp`, `cost_usd`, `cost_lbp`, `profit_usd`, `profit_lbp`, `count` (`COUNT(*)`) — grouped by carrier |
| 13 | 1845 | `getByDate` — `daily_commissions` allocation arm (`dailyCommissionsAllocationArm`) | `financial_services` | `profit_usd`, `profit_lbp` (real); `revenue_usd`, `revenue_lbp` deliberately `0`. **No count column at all** — `getByDate`'s final `ProfitByDateRow` never exposes a per-day count |
| 14 | 1928 | `getByDate` — `daily_commissions` base arm | `financial_services` | `profit_usd`, `profit_lbp`, `revenue_usd`, `revenue_lbp` (no count, same reason as #13) |
| 15 | 1950 | `getByDate` — `daily_recharges` CTE | `recharges` | `revenue_usd`, `revenue_lbp`, `cost_usd`, `cost_lbp`, `profit_usd`, `profit_lbp` (no count) |
| 16 | 1970 | `getByDate` — `daily_custom` CTE | `custom_services` | `revenue_usd`, `revenue_lbp`, `cost_usd`, `cost_lbp`, `profit_usd`, `profit_lbp` (no count) |
| 17 | 2004 | `getByDate` — `daily_loto` CTE | `loto_tickets` | `revenue_lbp`, `profit_lbp` (no count) |
| 18 | 2028 | `getByDate` — `daily_exchange` CTE | `exchange_transactions` | `revenue_usd`, `profit_usd` (no count) |
| 19 | 2156 | `getRealizedCommissionTotals` | `financial_services` | `total_usd`, `total_lbp`, `count` (`COUNT(*)`) |

Also note: `getSalesRevCost` (revenue_usd, cost_usd, `count = COUNT(DISTINCT
s.id)`) and `getSalesProfit` (`profit_usd`) don't call `notPartnerPending`
directly — they gate through `salePaidOrPartnerSettled` (#1), which is why
they're listed as indirect consumers rather than their own numbered rows;
converting #1 converts both of them automatically.

`daily_maint` (`getByDate`'s maintenance CTE) has **no** `notPartnerPending`
gate at all — maintenance jobs are never for-partner in this schema, so
there was never anything to gate. Not a call site, but worth flagging so a
lane doesn't go looking for one that doesn't exist.

## 5. Sites that reuse `notPartnerPending` through a wrapper (not counted above, but affected)

Two helper functions embed a `notPartnerPending` call once and are then
called from multiple places; converting the ONE embedded call converts every
consumer "for free," so these consumers are not separately numbered above:

- **`salePaidOrPartnerSettled(alias)`** (embeds site #1) is itself called at
  10 sites: `getSalesRevCost`, `getSalesProfit`, `getByDate`'s `daily_sales`
  and `daily_sales_profit` CTEs (4 call sites), plus `getByUser`/`getByClient`'s
  sale-arm `revenue_usd`/`profit_usd`/`profit_lbp` CASE branches (6 more call
  sites across the two methods' three SUM expressions each).
- **`supplierSettlementProfitArm(hasAllocations, currency)`** (embeds site
  #2) is called from `getByUser`/`getByClient`'s `profit_usd`/`profit_lbp`
  CASE expressions (4 call sites: 2 methods × 2 currencies).

## 6. `txnNotPartnerPending` — a related but DIFFERENT predicate, out of this fragment's shape

`txnNotPartnerPending(alias)` (defined ~line 509) has **identical semantics**
to `notPartnerPending` but a **different signature**: it correlates against
`alias.source_table`/`alias.source_id` (columns read off a `transactions`
row already in scope) rather than a literal `refTable` string constant. It is
called at 7 sites, all inside `getDeferredProfit`'s `partnerRow` bucket and
`getByUser`/`getByClient`'s combined `NOT (txnNotPartnerPending(t) AND
notDebtPending(t.id))` guard (3 SUM expressions × 2 methods, plus
`getDeferredProfit`).

**This is why `getByUser`, `getByClient`, and `getDeferredProfit` fall
outside all three lanes' line ranges (A/B/C only span the 19 sites above) —
not because they were overlooked, but because `partnerCoverageRatio`'s
signature (`refTable: string` — a compile-time literal) cannot express "the
table named by this row's own column" the way `txnNotPartnerPending` needs.
Converting those three methods would need a sibling fragment, e.g.
`txnPartnerCoverageRatio(alias: string)` returning the same ratio expression
correlated on `${alias}.source_table`/`${alias}.source_id` instead of a
literal table name — straightforward to derive from the fragment built here,
but a distinct piece of work this step deliberately does not build (the task
scoped Step 1 to the fragment matching `notPartnerPending`'s own shape).**
Flagging this now so it isn't rediscovered as a surprise mid-lane.

## 7. Lane split (for the two lanes that follow)

Using **current** (post-this-change) line numbers; the task's original
citations are given alongside for cross-reference:

- **Lane A** — the sales path. Current lines **530, 786** (task's original
  `~432`, `~688`). Converting `salePaidOrPartnerSettled` and
  `supplierSettlementProfitArm` in place converts `getSalesRevCost`,
  `getSalesProfit`, `getByDate`'s `daily_sales`/`daily_sales_profit`, and (via
  the same two helpers) `getByUser`/`getByClient`'s sale + SUPPLIER_SETTLEMENT
  arms — 2 direct sites, ~14 indirect consumer call sites per §5.
- **Lane B** — current lines **1225–1498** (task's original `~1127-1400`):
  sites #3–#9 (`getSupplierCommissionTotals` cashless bucket through
  `getExchangeTotals`).
- **Lane C** — current lines **1717–2156** (task's original `~1619-2058`):
  sites #10–#19 (`getFinancialSettledByProvider` through
  `getRealizedCommissionTotals`, including all of `getByDate`'s remaining
  per-day CTEs).

---

## 8. Does "weight every monetary column" hold at every site? — evidence-backed answer

**Short answer: no, not uniformly. `COUNT(*)`/`COUNT(DISTINCT …)` columns are
the one recurring exception, and they appear at a majority of the 19 sites.
Every revenue/cost/profit/commission column, by contrast, is safe to weight
— none of the 19 sites return a per-row display read, and the columns that
are already deliberately `0` (by an unrelated, orthogonal design decision)
stay correctly `0` regardless of the ratio.**

### 8a. Where the rule holds cleanly

Every `revenue_usd/lbp`, `cost_usd/lbp`, `profit_usd/lbp`, `commission`,
`total_usd/lbp`, and `revenue`/`cost`/`profit` (untyped-currency, grouped by
a `currency` column) at all 19 sites is a plain `SUM(...)` (or a `CASE`-
bucketed `SUM`) with no COUNT semantics — multiplying the summed expression
by `partnerCoverageRatio(...)` is mechanically sound and satisfies the
task's own continuity argument: at ratio 0 the column reads 0 (matching
today's fully-gated-out row), at ratio 1 it reads the full value (matching
today's fully-realized row), and only a partially-covered row changes.
Verified by inspecting all 19 `SELECT` lists (§4 table) — none contains a
non-additive monetary expression (no `MIN`/`MAX`/`AVG` over a monetary
column at any site).

The `0`-by-design columns (`revenue_usd`/`revenue_lbp` on the two allocation
arms, sites #10 and #13) are unaffected either way — they are contractually
zero because a commission allocation carries no revenue/cost pair of its
own, a fact that has nothing to do with partner coverage. Weighting `0 *
ratio` is still `0`.

### 8b. Where the rule does NOT hold: `COUNT(*)` / `COUNT(DISTINCT …)`

Nine of the 19 sites return a count column, and every one of them is a raw
integer row/entity count:

- `getSupplierCommissionTotals` cashless (#3): `COUNT(DISTINCT
  sca.settlement_ledger_id)`
- `getFinancialSettledByCurrency` (#4), `getMobileServicesByCurrency` (#5),
  `getRechargesByCurrency` (#6), `getCustomServicesTotals` (#7),
  `getLotoTotals` (#8), `getExchangeTotals` (#9), `getFinancialSettledByProvider`
  base arm (#11), `getRechargesByCarrier` (#12), `getRealizedCommissionTotals`
  (#19): all plain `COUNT(*)`.

Today, because the gate lives in the `WHERE` clause, a row is either fully
in (`count` gets `+1`) or fully out (`count` gets `+0`) — `count` is
inherently a **row-membership tally**, never a dollar amount. Multiplying a
`COUNT(*)` by a continuous `[0,1]` ratio produces a **fractional count**
(e.g. "3.4 transactions"), which:

1. Has no sensible UI rendering — verified concretely, not assumed:
   `ProfitService.ts` passes every one of these `count` fields straight
   through unmodified (`count: salesRevCost.count`, `finSvc.count +=
   row.count`, etc. — lines 286-775), and `frontend/src/features/profits
   /pages/Profits.tsx` renders them as bare integers with a unit suffix and
   no formatting (`{summary.sales.count} sales`,
   `{summary.financial_services.count} txns`,
   `{summary.mobile_services.count} txns`,
   `{summary.custom_services.count} jobs` — lines 753, 785, 888, 941).
   `"3.4 txns"` would render literally as written; there is no
   `Math.round`/`toFixed` between the query and the DOM today.
2. Does not correspond to any real-world quantity — a transaction either
   happened or it didn't; what's partial is how much of ITS MONEY has been
   collected from the partner, not how many transactions occurred.

**This is a genuine design decision for whichever lane touches a `count`
column, not something this step can silently resolve by "just weight it
too."** Two candidate resolutions, named here so the lane doesn't have to
rediscover the question:

- **(a) Count on any recognition at all** — `count` becomes `SUM(CASE WHEN
  ratio > 0 THEN 1 ELSE 0 END)`, i.e. a row is counted the moment it starts
  contributing anything, matching "how many transactions have SOME revenue
  showing in this view."
- **(b) Count only full recognition** — `count` stays gated on `ratio = 1`
  (functionally unchanged from today's binary gate), while the monetary
  columns beside it go continuous. This keeps "12 recharges" meaning
  exactly what it means today, at the cost of `count` and `revenue`/`profit`
  no longer moving in lockstep for a partially-covered period.

This document takes no position on (a) vs (b) — that is an owner-facing
product question, not a mechanical one, and out of scope for a foundation
step. It is named here specifically so a lane does not have to discover it
mid-implementation.

### 8c. Per-row display reads — none found in scope

The task asked specifically to check for a per-row display read where
weighting would be meaningless. **None of the 19 sites is one** — every
site is a `GROUP BY`/single-row aggregate (`SELECT SUM(...) ... GROUP BY
currency|provider|carrier` or `SELECT SUM(...) ...` with no `GROUP BY` at
all for a single total). Verified by reading every one of the 19 `SELECT`
statements in full (§4). The one place in `ProfitRepository.ts` that DOES
return individual, non-aggregated rows for display — `getByUser`/
`getByClient` (one row per user/client, still a `GROUP BY` aggregate over
many transactions, not one row per transaction — so still additive, not a
counter-example either) — uses `txnNotPartnerPending`, not
`notPartnerPending`, and is already called out in §6 as needing a different
fragment shape, not as a rule violation.

### 8d. Self-check (did this analysis miss anything?)

- Which input, if wrong, flips this conclusion? — If the UI already
  tolerated/rounded fractional counts, the "genuine design decision" framing
  would soften to "cosmetic." Checked directly (§8b, point 1): it does not —
  `Profits.tsx` interpolates `summary.*.count` straight into JSX with no
  rounding. This was outside Step 1's stated scope (`packages/core` only),
  but the check was cheap and the finding is load-bearing enough for the
  next lanes that it's worth the one frontend read.
- What would a reviewer who disagrees say first? — "Just always weight
  count too, `3.4` is fine, round it in the UI." That is option (a) above,
  restated; it is a legitimate answer, not a rebuttal — the point stands
  that it IS a decision, not a mechanical consequence of "weight every
  monetary column."

---

## 9. What this step deliberately did NOT do

- Did not convert any of the 19 sites, `salePaidOrPartnerSettled`,
  `supplierSettlementProfitArm`, or `txnNotPartnerPending`'s 7 sites.
- Did not touch `ClosingRepository.ts`, `ExchangeRepository.ts`,
  `notDebtPending`, or `current_sprint.md`.
- Did not build a `txnPartnerCoverageRatio` sibling for the dynamic-table
  case (§6) — named as follow-up work, not built.
- Did not resolve the `count`-column question (§8b) — named, not decided.
- Did not commit, stage, or stash anything.
