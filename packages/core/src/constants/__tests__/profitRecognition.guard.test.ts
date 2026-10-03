/**
 * Profit-recognition-gate drift guard (CQ-1, LIRA-098; extended to
 * ClosingRepository under LIRA-158 Phase 5).
 *
 * `ProfitRepository.ts`'s "Rule 14" section defines the domain rule "profit is
 * real only when money is real" as four owner-facing fragments —
 * `notDebtPending`, `notPartnerPending`, `saleFullyPaid`,
 * `salePaidOrPartnerSettled` — plus two variants of the SAME rule defined in
 * that same section: `saleNotFullyPaid` (the negation, used by the
 * deliberately-UNREALIZED "pending sale profit" query) and
 * `txnNotPartnerPending` (the transaction-scoped variant keyed on
 * source_table/source_id, used by the by-user/by-client views). All six are
 * treated as valid gates here — a query using the negated or
 * transaction-scoped form is still applying the same rule, just phrased for
 * its query shape; excluding them would make this guard fail on CORRECT
 * code (getByUser/getByClient/getPendingSaleProfit all gate exclusively via
 * one of these three).
 *
 * Nothing previously scanned for a NEW profit query shipping without one of
 * these — this is that scan (COUNTERPARTY_CONSOLIDATION_PLAN.md CQ-1's
 * second, never-built guard; see its "Left TODO" note).
 *
 * Mechanism: parse each file in {@link SCANNED_FILES} into "query units" — one
 * per `.prepare(\`...\`)` call, further split into one unit per CTE (plus a
 * trailing "final select" unit) for a query that uses `WITH`
 * (`ProfitRepository.getByDate` is the only one today) — then assert every
 * unit whose SQL text contains `profit` (case-insensitive; every profit
 * column is `profit_usd`/`profit_lbp`/`potential_profit_usd`/etc.) also
 * textually calls one of the six gate fragments. Text-based, not AST-based
 * (mirrors `moduleDebtTypes.guard.test.ts` / `partnerLedgerTypes.guard.test.ts`)
 * — cheap, survives formatting changes, and catches the actual failure mode: a
 * new query, or a new CTE added to `getByDate`, that computes profit from
 * sales/debt/partner data without wiring in the gate. Splitting `getByDate`
 * into per-CTE units (instead of treating its whole ~200-line prepare() call
 * as one pass/fail unit) matters: without it, a new ungated CTE added
 * alongside the nine existing ones would hide behind the gate fragments the
 * OTHER nine CTEs already reference in the same template literal.
 *
 * Scope (widened by LIRA-108): the scan matches units that spell "profit"
 * OR "commission". The original profit-only heuristic is exactly how
 * `getRealizedCommissionTotals` — which feeds
 * `ProfitService.getByPaymentMethod`'s "Commission (Settled)" row, documented
 * there as "shown as positive profit" — escaped LIRA-098's scan while missing
 * the `notPartnerPending`/`notDebtPending` gates its sibling
 * `getFinancialSettledByCurrency` carries. That hole was fixed under
 * LIRA-108 (the query now carries both gates via the same transactions JOIN
 * shape), and the token widening here makes the class unrepresentable:
 * a commission-summing query is profit reporting whether or not it spells
 * "profit", so it gets the same gate-or-documented-exclusion discipline.
 *
 * EXCHANGE_LOT_SETTLEMENT.md Phase 3 (2026-08-22) — recognition rationale for
 * exotic-currency exchange profit, recorded here since this guard is exactly
 * where a query's recognition timing is supposed to be documented. For a
 * lot-tracked (non-USD, non-LBP) currency, `exchange_transactions
 * .leg1_profit_usd`/`leg2_profit_usd` are no longer the half-spread-vs-
 * mid-market snapshot: a BUY leg (the acquire side) always stamps 0 (Q8 — a
 * buy earns nothing until it is sold), and a SELL leg (the consume side)
 * stamps the FIFO-realized profit computed by `ExchangeLotRepository
 * .consumeFifo` at settlement (the sell's own) time against
 * `exchange_lot_settlements` — never at the buy's time. Both `getByUser`'s
 * `EXCHANGE_LEG_PROFIT` unit and `getByDate`'s `daily_exchange` CTE keep
 * summing those exact same two columns, still gated by
 * `notPartnerPending("exchange_transactions", "id")` (a for-partner sell's
 * realized profit still defers to partner coverage, same as before) — no new
 * query, no new gate, no EXCLUDED_UNITS entry needed: the recognition RULE
 * ("profit is real only when money is real") is unchanged, only WHICH number
 * satisfies it for an exotic leg changed, and that number is computed inside
 * `ExchangeRepository.createTransaction` before either column is ever
 * written, not inside one of these already-gated queries. USD<->LBP legs are
 * completely untouched (still the pre-existing spread stamp).
 *
 * LIRA-158 Phase 5 — scan extended to `ClosingRepository.ts`. Three mechanism
 * changes, all required so the extension does not silently corrupt the
 * existing ProfitRepository coverage:
 *
 * 1. **Keys are now `<file>:<method>:<unit>`.** `EXCLUDED_UNITS` keys for
 *    ProfitRepository gained a `ProfitRepository:` prefix (every entry
 *    updated in this same change; the SET of excluded queries and their
 *    rationale is otherwise byte-for-byte unchanged) so a same-named method
 *    in a different scanned file can never collide with one here.
 * 2. **A method with more than one non-`WITH` `.prepare()` call is now
 *    disambiguated by the local `const`/`let` name each query is assigned
 *    to**, instead of every such query collapsing onto the identical bare
 *    `"(query)"` label. `ClosingRepository.getDailyStatsSnapshot` is why:
 *    it has NINE `.prepare()` calls in one method (no CTEs), six of them
 *    profit-bearing — under the old one-label-per-method-shape rule they
 *    would all key as `getDailyStatsSnapshot:(query)`, so excluding ONE of
 *    them (say, a correct one) would silently exclude ALL SIX, including
 *    the ones that are genuine gaps. A method with exactly one non-`WITH`
 *    prepare is completely unaffected — it still gets the bare `"(query)"`
 *    label unconditionally, which is what every pre-existing ProfitRepository
 *    `EXCLUDED_UNITS` key assumes (verified: `getDeferredProfit` is the only
 *    ProfitRepository method with 2+ non-`WITH` prepares, and it was never in
 *    `EXCLUDED_UNITS` — its two units silently relabel from `(query)`/`(query)`
 *    to `partnerRow`/`clientDebtRow`, which changes nothing observable since
 *    neither key was ever referenced and both units still pass on their own
 *    merits). See {@link precedingVarName}.
 * 3. **`findMethodBoundaries` now also recognizes top-level `function NAME(`
 *    declarations**, not just 2-space class methods — see that function's
 *    own doc comment for the pre-existing mis-attribution bug this closes
 *    (`ProfitRepository`'s private `_hasSettlementAllocationsTable` schema
 *    probe was silently attributing to "constructor" and escaping this
 *    guard entirely, an UNEXCLUDED violation that predates this Phase 5
 *    extension — see the new `hasSettlementAllocationsTable:(query)`
 *    EXCLUDED_UNITS entry).
 *
 * LIRA-158 D17 follow-up (owner decision 2026-08-31) — `GATE_FRAGMENTS`
 * gained a SEVENTH entry, `allocationNotDebtPending`. It is a genuine gate,
 * not a loophole: `ProfitRepository.allocationNotDebtPending` is a thin
 * wrapper that calls `notDebtPending` VERBATIM on a resolved
 * `financial_services` row's own FINANCIAL_SERVICE transaction id (see its
 * doc comment) — a unit that calls it IS applying the exact same
 * client-debt-pending rule as a unit that calls `notDebtPending` directly,
 * just against a `settlement_commission_allocations` row instead of a
 * `transactions` row. Its sibling `cashlessCommissionBatch` is deliberately
 * NOT added here: it only classifies a settlement batch as bills-only vs
 * cashless (a re-derivation of `SupplierRepository.isBillsOnlyBatch`'s
 * negation) and defers nothing on its own — a query could call it alone with
 * no debt gate at all and still be wrongly unguarded, so treating it as a
 * gate would open exactly the loophole this guard exists to close. D17 also
 * added several new query units built on these two fragments across
 * `ProfitRepository.getSupplierCommissionTotals`, `getFinancialSettledByProvider`,
 * `getByDate`, `getDeferredProfit`, `getByUser`, `getByClient`, and
 * `ClosingRepository.getDailyStatsSnapshot` — see the new/updated
 * EXCLUDED_UNITS entries below for the units that are correctly ungated
 * (bills-only: real money, recognition-by-construction) vs the ones that
 * are now recognised as gated via `allocationNotDebtPending` and needed no
 * exclusion at all.
 *
 * LIRA-169 — per-column detection, closing a loophole found while building
 * `embeddedCommission.guard.test.ts` (LIRA-159 D3): this guard used to check
 * only "does the GATE_CALL_REGEX match ANYWHERE in the whole unit's SQL
 * text" (`GATE_CALL_REGEX.test(u.sql)`). `ProfitRepository.getByUser`/
 * `.getByClient` each compute `revenue_usd`/`profit_usd`/`profit_lbp` as
 * their OWN independent `SUM(CASE ... END) AS <col>` block, each
 * independently repeating `NOT (${txnNotPartnerPending("t")} AND
 * ${notDebtPending("t.id")})` inline at the top of its own CASE — the gate
 * is never hoisted once into the outer WHERE. Stripping the gate from only
 * ONE of those columns (say `profit_usd`'s own copy) while leaving a
 * SIBLING column's copy (`profit_lbp`'s) intact would still leave
 * `GATE_CALL_REGEX.test(u.sql)` true — the surviving sibling's gate call
 * "covers" the newly-ungated column purely because they share one
 * `.prepare()` unit. Same class of hole `embeddedCommission.guard.test.ts`
 * already closed for its own narrower scan (see that file's `isGated`'s own
 * doc comment) — this guard now reuses the SAME per-column machinery
 * (`isGatedPerColumn`/`textIsGated`/`splitSelectShape`, generalised into
 * `testHelpers/sqlQueryUnits.ts` so neither guard pastes a second copy of
 * the other's logic, rule 14): a WHERE-clause gate still covers every
 * column uniformly, but failing that, EVERY top-level profit/commission-
 * token-bearing column must independently resolve to a gate (inline or
 * alias). See this file's own "LIRA-169: sibling-column loophole" test
 * below for the synthetic before/after proof (rule 17) — the real
 * `getByUser`/`getByClient` queries pass on merit against the new, stricter
 * check with zero new EXCLUDED_UNITS entries needed (verified by running
 * this suite).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectQueryUnits,
  unitKey,
  findMethodBoundaries,
  methodSourceSlice,
  isGatedPerColumn,
  type QueryUnit,
} from "../testHelpers/sqlQueryUnits";

const SRC_ROOT = path.join(__dirname, "..", "..");

/**
 * Every repository file this guard scans for profit/commission-bearing SQL.
 * `tag` prefixes every unit key parsed from that file (see header note 1)
 * so the two files' methods can never collide even if a name is reused.
 */
const SCANNED_FILES: { tag: string; path: string }[] = [
  {
    tag: "ProfitRepository",
    path: path.join(SRC_ROOT, "repositories", "ProfitRepository.ts"),
  },
  {
    tag: "ClosingRepository",
    path: path.join(SRC_ROOT, "repositories", "ClosingRepository.ts"),
  },
];

/**
 * The recognition-gate fragment family (Rule 14) — see file header. Defined
 * (as `function <name>(`) exclusively in `ProfitRepository.ts`; the other
 * scanned file only ever IMPORTS a subset of them, so the "still exists as a
 * callable function" sanity check below reads ProfitRepository's own source.
 */
const GATE_FRAGMENTS = [
  "notDebtPending",
  "notPartnerPending",
  "txnNotPartnerPending",
  "saleFullyPaid",
  "saleNotFullyPaid",
  "salePaidOrPartnerSettled",
  // LIRA-158 D17 — wraps notDebtPending VERBATIM against a
  // settlement_commission_allocations row's own fs transaction id (see this
  // file's header note and ProfitRepository.allocationNotDebtPending's own
  // doc comment); a genuine gate, not a loophole. `cashlessCommissionBatch`
  // (the batch-shape classifier D17 also introduced) is deliberately NOT
  // listed — it defers nothing on its own, so it doesn't belong here.
  "allocationNotDebtPending",
  // Owner decision 2026-09-05 (PARTNER_PROPORTIONAL_RECOGNITION.md) — the
  // proportional counterpart of `notPartnerPending`: instead of excluding a
  // partner-pending row's profit/revenue/cost/commission whole, the query
  // multiplies each monetary column by this row's covered fraction
  // (`partnerCoverageRatio`'s own doc comment has the full derivation). A
  // query that calls it IS applying the SAME "profit real only when partner
  // money is real" rule as one that calls `notPartnerPending` — just
  // continuously instead of binarily — so it is a genuine gate here, not a
  // loophole. Sites converted so far still gate client debt with
  // `notDebtPending` unchanged where that applies; `getExchangeTotals` has
  // no debt-gating concept at all, so this entry is the ONLY thing that
  // keeps its converted query recognized as gated.
  "partnerCoverageRatio",
  // Owner decision 2026-09-05 (PARTNER_PROPORTIONAL_RECOGNITION.md Step 2) —
  // the transactions-alias counterpart of `partnerCoverageRatio`, used by
  // getByUser/getByClient/getDeferredProfit's `partnerRow` bucket (see
  // txnPartnerCoverageRatio's own doc comment). Same "genuine gate, not a
  // loophole" reasoning as partnerCoverageRatio above, just correlated on a
  // transactions row's own source_table/source_id instead of a literal
  // refTable string.
  "txnPartnerCoverageRatio",
  // Task 3 (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md) — the sales-path
  // proportional counterpart of `salePaidOrPartnerSettled`: a NUMERIC weight
  // (1.0 fully customer-paid, the partner's covered fraction for a
  // for-partner sale, 0 otherwise — see saleRecognitionWeight's own doc
  // comment) that getSalesRevCost, getSalesProfit, getByDate's
  // daily_sales/daily_sales_profit, and getByUser/getByClient's sale arm now
  // multiply their monetary columns by, in place of the old binary gate. A
  // query that calls it IS applying the SAME "sale profit real only when
  // money is real" rule as one that calls `salePaidOrPartnerSettled` — just
  // continuously instead of binarily — so it is a genuine gate here, not a
  // loophole. `getSalesProfit` and `getByDate`'s `daily_sales_profit` CTE are
  // this fragment's ONLY reason to be gated at all (their sole predicate);
  // `getSalesRevCost`/`daily_sales` never tripped the profit/commission
  // token to begin with (revenue_usd/cost_usd only) so this entry isn't
  // load-bearing there, and getByUser/getByClient's sale arm sits inside a
  // unit that also calls notDebtPending/txnPartnerCoverageRatio elsewhere.
  "saleRecognitionWeight",
  // LIRA-231 — net-of-item-refund counterpart of `saleNotFullyPaid`, used by
  // `_getPendingSaleProfitNet`'s WHERE gate (the deferred/pending "unpaid
  // sales" card, net of item refunds). Compares still-uncollected NET
  // revenue (post item-refund) against the same $0.05 tolerance, instead of
  // `saleNotFullyPaid`'s GROSS `final_amount_usd` — using the gross form
  // here would keep a fully-item-refunded-but-unpaid sale on the list
  // forever, at its full pre-refund outstanding amount (see that method's
  // own doc comment). Same "profit real only when money is real" rule,
  // applied to the net figure — a genuine gate, not a loophole.
  "saleNetRevenueNotFullyPaid",
] as const;

const GATE_CALL_REGEX = new RegExp(`\\b(?:${GATE_FRAGMENTS.join("|")})\\(`);

/**
 * SQL column aliases are lowercase (`profit_usd`, `potential_profit_usd`,
 * `commission`, ...). "commission" added by LIRA-108: commission sums ARE
 * profit reporting (the "Commission (Settled)" row), and the profit-only
 * token is exactly how the ungated `getRealizedCommissionTotals` escaped
 * this guard's first version.
 */
const PROFIT_TOKEN_REGEX = /profit|commission/i;

/**
 * Query units that legitimately contain a "profit" column/alias but do NOT
 * reference a recognition-gate fragment, each with its verified reason.
 * Keys are `<file>:<method>:<unit>` (see header note 1) — `file` matches a
 * {@link SCANNED_FILES} `tag`.
 */
const EXCLUDED_UNITS: Record<string, string> = {
  "ProfitRepository:getDebtRepaymentProfit:(query)":
    "Recognition-by-construction: DEBT_REPAYMENT/KEPT_CHANGE rows ARE the " +
    "recognition event (kept change collected AT the repayment) — there is " +
    "no counterparty-pending state left to gate against; the repayment " +
    "happening now is what 'money is real' means for this row.",
  "ProfitRepository:getCounterpartyDiscountTotals:(query)":
    "Owner decision D1 (COUNTERPARTY_CONSOLIDATION_PLAN.md): " +
    "COUNTERPARTY_DISCOUNT carries a signed profit stamp with amount_usd/lbp " +
    "always 0 (no cash moved) and is NON_REVERSIBLE_TRANSACTION_TYPES — " +
    "immediate recognition by design, nothing left to defer.",
  "ProfitRepository:getSupplierCommissionTotals:degraded":
    "LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md), re-keyed from the " +
    "stale 'ProfitRepository:getSupplierCommissionTotals:(query)' by the " +
    "LIRA-158 D17 follow-up when the method split from one bare prepare " +
    "into three named ones (degraded/billsOnly/cashless — see that " +
    "method's own doc comment). This is the SCHEMA-DRIFT branch only " +
    "(`!this._hasSettlementAllocationsTable()`, a pre-v150 fixture): the " +
    "OLD, undifferentiated stamp-only query, recognition-by-construction " +
    "for the SAME reason getDebtRepaymentProfit/getCounterpartyDiscountTotals " +
    "above are — no partner_ledger row is EVER created with reference_table " +
    "= 'supplier_ledger' and no debt_ledger module-debt row is ever keyed " +
    "to a SUPPLIER_SETTLEMENT transaction id, so notPartnerPending/" +
    "notDebtPending would always no-op here regardless of batch shape. On " +
    "this schema there is no `settlement_commission_allocations` table to " +
    "classify bills-only vs cashless against in the first place, so — " +
    "unlike the two branches below — this one is not even D17-aware; it is " +
    "the pre-D17 behavior preserved verbatim for fixtures that predate the " +
    "allocations table.",
  "ProfitRepository:getSupplierCommissionTotals:billsOnly":
    "D17 (LIRA-158 follow-up, owner decision 2026-08-31): the BILLS-ONLY " +
    "half of the degraded branch's former undifferentiated query, split out " +
    "once `settlement_commission_allocations` exists so the CASHLESS half " +
    "(the `cashless` unit alongside this one, already gated via its own " +
    "notPartnerPending + allocationNotDebtPending calls) can defer " +
    "correctly without double-counting. A bills-only Katsh/iPick " +
    "settlement's commission is a REAL provider-drawer top-up (or real " +
    "payment legs) funded directly BY THE SUPPLIER at settlement — 'our " +
    "profit entirely' (owner) — recognition-by-construction, same " +
    "reasoning as the (now-removed) combined entry this replaces: no " +
    "partner_ledger/debt_ledger row is ever keyed to a SUPPLIER_SETTLEMENT " +
    "transaction id, so a gate here would always no-op. Restricted to " +
    "`NOT (cashlessCommissionBatch(...))` so it never also counts a " +
    "cashless or mixed batch's stamp (that money is real too, but re-" +
    "sourced from allocations, not from this flat stamp — see the method's " +
    "partition-proof doc comment for the exhaustive/disjoint argument).",
  // "ProfitRepository:getFinancialPendingByCurrency:(query)" REMOVED
  // (PA-3.6, OWNER_NOTES_2026-09-21.md §6.5): the query now calls
  // partnerCoverageRatio (a for-partner unsettled row's pending commission
  // is weighted to the shop's own covered share, matching the settled
  // sibling getFinancialSettledByCurrency's own partner-coverage treatment)
  // — it is a genuinely gated unit now, not an exclusion. Still
  // deliberately NOT notDebtPending-gated (see the method's own doc
  // comment, "L0-4"): client-debt status is out of scope for this bucket
  // by design, unaffected by this change.
  "ProfitRepository:getByDate:daily_pmfee":
    "Payment-method fee is realized wallet-drawer cash the instant it's " +
    "collected (getPmFeeTotals's own doc comment: 'immediate shop profit ... " +
    "NOT gated by is_settled') — it is never part of a counterparty-financed " +
    "principal, so it cannot be partner- or debt-pending by construction.",
  // --- PA-2.2 (OWNER_NOTES_2026-09-21.md §6.4) — By Date CTEs mirroring
  // three EXISTING getSummary/getByModule sources, each already excluded
  // above/nearby for the SAME recognition-by-construction reasoning; these
  // CTEs are copy-identical SQL bodies, not new rules.
  "ProfitRepository:getByDate:daily_kept_change":
    "Mirrors getDebtRepaymentProfit exactly (see that method's own " +
    "EXCLUDED_UNITS entry above): DEBT_REPAYMENT/KEPT_CHANGE rows ARE the " +
    "recognition event, nothing left to gate.",
  "ProfitRepository:getByDate:daily_discounts":
    "Mirrors getCounterpartyDiscountTotals exactly (see that method's own " +
    "EXCLUDED_UNITS entry above): COUNTERPARTY_DISCOUNT is immediate-" +
    "recognition-by-design and NON_REVERSIBLE_TRANSACTION_TYPES.",
  "ProfitRepository:getByDate:daily_bills_commission":
    "Mirrors getSupplierCommissionTotals's bills-only/degraded buckets " +
    "exactly (see that method's own EXCLUDED_UNITS entries above): a " +
    "bills-only SUPPLIER_SETTLEMENT stamp is real provider-funded money the " +
    "instant it's recognised — no partner_ledger/debt_ledger row is ever " +
    "keyed to a SUPPLIER_SETTLEMENT transaction id, so a gate here would " +
    "always no-op. The CASHLESS half is excluded from this CTE (NOT " +
    "cashlessCommissionBatch) and counted instead by " +
    "dailyCommissionsAllocationArm, which IS gated (allocationNotDebtPending " +
    "+ partnerCoverageRatio) — checked as its own unit, folded into " +
    "daily_commissions above.",
  "ProfitRepository:getByDate:(final select)":
    "Pure re-aggregation: sums CTE aliases (dsp.profit_usd, dc.profit_usd, " +
    "dr.profit_usd, ...) that were each already gated inside their own CTE " +
    "(checked as independent units by this guard) — the gate lives in the " +
    "CTE, not in the COALESCE(...) + that recombines already-gated numbers.",
  // --- commission-token exclusions (LIRA-108 scan widening) ---
  "ProfitRepository:getPendingCommissionTotals:(query)":
    "LIRA-108 deliberate: the PRE-recognition bucket keyed purely on " +
    "is_settled = 0, mirroring getFinancialPendingByCurrency's exclusion " +
    "above — a supplier-unsettled row awaits settlement regardless of " +
    "counterparty state; the partner/debt gates apply when the row moves to " +
    "the settled bucket (getRealizedCommissionTotals, which DOES carry them " +
    "since LIRA-108). Gating this too would double-hide a settled-but-" +
    "pending row (already withheld from realized AND from pending's " +
    "is_settled = 0), breaking the realized/pending/deferred partition.",
  "ProfitRepository:getPendingCommissionByProvider:(query)":
    "Same predicate as getPendingCommissionTotals by design — it only " +
    "breaks that row's total down per provider for the pending-row label " +
    "(ProfitService.getByPaymentMethod). Must stay predicate-identical to " +
    "it or the label total diverges from the row total; same PRE-" +
    "recognition-bucket reasoning.",
  "ProfitRepository:getUnsettledCommissions:(query)":
    "Not an aggregation at all — a row LIST of unsettled (is_settled = 0) " +
    "commission rows for the supplier-settlement work queue. Pre-" +
    "recognition by construction (same bucket as the two pending entries " +
    "above); a partner/debt gate here would hide rows the operator still " +
    "needs to settle with the supplier.",
  "ProfitRepository:getPaymentMethodRows:(final select)":
    "LO-R8 (round 3, OWNER_NOTES_2026-09-21.md §6) — renamed from the stale " +
    "'(query)' key: LPay's By-Payment restructure (owner decisions " +
    "2026-09-24, §6.8) turned this into a multi-CTE WITH query " +
    "(linked_legs/session_legs/orphan_legs/all_legs/unit_net), so the unit " +
    "this guard now finds is the trailing SELECT after those CTEs, not the " +
    "whole prepare() call. Same underlying reason as before the rename: " +
    "trips the commission token only via its literal '0 AS " +
    "pending_commission_usd' padding column (a net-of-change payments-table " +
    "view; sums linked/session/orphan legs, never commission or profit). Its " +
    "ungated state is the documented v1 gap (COUNTERPARTY_LEDGERS.md §6 " +
    "'Documented v1 gaps') — explicitly out of LIRA-108's scope, which " +
    "closed the commission ROWS of the same view, not the per-payment-method " +
    "rows. The CTEs above it (linked_legs etc.) are their own, separately " +
    "checked units — none of them reference 'profit'/'commission' at all, so " +
    "they need no exclusion of their own.",
  "ProfitRepository:hasSettlementAllocationsTable:(query)":
    "False-positive token match, not a recognition question at all: this is " +
    "a schema-introspection probe (`SELECT 1 FROM sqlite_master WHERE " +
    "type = 'table' AND name = 'settlement_commission_allocations'`, LIRA-158 " +
    "Phase 3/5 item 2's shared free function) that trips the 'commission' " +
    "token purely because the TABLE NAME it checks for contains that " +
    "substring — there is no revenue, profit, or commission dollar figure " +
    "anywhere in this query. Same class as {@link hasCommissionModelColumn}'s " +
    "own `PRAGMA table_info(financial_services)` probe immediately above it " +
    "(which doesn't need an entry only because 'financial_services' doesn't " +
    "happen to spell 'commission'). Found while extending this guard's " +
    "boundary detection to free (module-scope) functions (LIRA-158 Phase 5, " +
    "see {@link findMethodBoundaries}'s doc comment) — before that fix this " +
    "probe's `.prepare(` lived inline in the PRIVATE class method " +
    "`_hasSettlementAllocationsTable`, which `methodRe` cannot see (the " +
    "`private` keyword sits where the name would), so it silently " +
    "attributed to 'constructor' and was an UNEXCLUDED violation nobody had " +
    "caught — pre-existing, unrelated to ClosingRepository, discovered as a " +
    "side effect of this same extension.",
  // --- ClosingRepository (LIRA-158 Phase 5, REMOVED under LIRA-219) ---
  // Every `ClosingRepository:getDailyStatsSnapshot:*` entry that lived here
  // (finProfitLegacyDegraded, finProfitSettlement, billsOnlySettlement,
  // rechargeProfitDegraded, customProfitDegraded, maintProfitDegraded) was
  // removed in the SAME change that deleted the profit SQL those keys
  // pointed at: `ClosingRepository.getDailyStatsSnapshot` was renamed to
  // `getDailyActivityStats(day)` and no longer computes profit at all — it
  // now returns only sales/debt-payments/expenses. Profit is composed one
  // layer up, in `ClosingService.getDailyStatsSnapshot`, by reading
  // `ProfitService.getSummary(day, day).totals.gross_*` (the ONE definition
  // of gross profit, rule 14 — the same call `ProfitRepository`'s OWN units
  // above are already gated for). There is nothing left in
  // `ClosingRepository.ts` for this guard to find profit-bearing, and the
  // "zero profit-bearing units in ClosingRepository.ts" test below asserts
  // exactly that, so a future re-texted profit query in this file fails CI
  // immediately instead of silently escaping this guard's scan the way the
  // original bug did. See `ClosingService.profitParity.test.ts` for the
  // guarding spec that replaced these six scenarios (rule 24).
  // --- LIRA-233 (#14 slice 3) — per-row drill-down siblings of the three
  // already-excluded profit-only totals queries above. Each detail query
  // mirrors its totals sibling's own SELECT minus the SUM/COUNT (see each
  // method's own doc comment in ProfitRepository.ts) — same rows, same
  // WHERE, so the SAME "recognition-by-construction, nothing left to gate"
  // reasoning applies verbatim; these are NOT new gaps, just the totals
  // query's reasoning restated for its row-level twin (rule 14 — one
  // rationale, not a second one invented per unit).
  "ProfitRepository:getKeptChangeDetail:(query)":
    "Mirrors getDebtRepaymentProfit exactly (see that method's own " +
    "EXCLUDED_UNITS entry above): DEBT_REPAYMENT/KEPT_CHANGE rows ARE the " +
    "recognition event (kept change collected AT the repayment) — there is " +
    "no counterparty-pending state left to gate against.",
  "ProfitRepository:getCounterpartyDiscountDetail:(query)":
    "Mirrors getCounterpartyDiscountTotals exactly (see that method's own " +
    "EXCLUDED_UNITS entry above): COUNTERPARTY_DISCOUNT carries a signed " +
    "profit stamp with amount_usd/lbp always 0 (no cash moved) and is " +
    "NON_REVERSIBLE_TRANSACTION_TYPES — immediate recognition by design, " +
    "nothing left to defer.",
  "ProfitRepository:getSupplierCommissionDetail:(query)":
    "Mirrors getSupplierCommissionTotals's billsOnly/degraded buckets " +
    "exactly (see those methods' own EXCLUDED_UNITS entries above): this " +
    "detail query is BILLS-ONLY (or the pre-allocations-table degraded " +
    "shape, same cashlessGate branch that totals query uses) — a real " +
    "provider-drawer top-up funded directly BY THE SUPPLIER at settlement, " +
    "'our profit entirely' (owner) — recognition-by-construction; no " +
    "partner_ledger/debt_ledger row is ever keyed to a SUPPLIER_SETTLEMENT " +
    "transaction id, so a gate here would always no-op.",
  // --- LIRA-169 — the "expose the gate" Detail family. Newly surfaced by
  // this ticket's own per-column tightening (none of these were violations
  // under the old whole-unit check, because EVERY one of them calls a gate
  // fragment SOMEWHERE in the same unit — just not on the profit/revenue/
  // cost column itself). Each is a per-row drill-down feeding the Profits
  // page's "Show transactions" list under a By-Module row, and each is
  // DELIBERATELY ungated on its own profit/revenue/cost column: the whole
  // point of a drill-down is to show BOTH counted and not-yet-counted rows
  // with their raw figures, so the UI can render a "why isn't this counted
  // yet" reason. Recognition is applied ONE LAYER UP by multiplying the
  // raw figure by the SAME gate the query exposes as its own column
  // (`weight`/`debt_pending`/`partner_coverage_ratio`) — in
  // `ProfitService`'s module-detail builders (verified: e.g.
  // `buildSaleModuleDetail`'s `r.profit_usd * weight`), never by summing
  // the raw column ungated. Every entry below is independently verified by
  // reading its own method's doc comment (several say so explicitly —
  // "including debt-pending ones ... the service needs those to render the
  // 'not counted yet' section") and the gate-state column it exposes
  // alongside the raw figure.
  "ProfitRepository:getSalesDetail:tenantId":
    "Private-method mis-attribution (see this file's header note 3 / " +
    "embeddedCommission.guard.test.ts's identical precedent): the true " +
    "source is PRIVATE getCompletedSalesDetailGross (the schema-drift " +
    "fallback branch, no discount/net columns), mis-attributed to the " +
    "nearest preceding PUBLIC boundary getSalesDetail. Exposes " +
    "`weight` (saleRecognitionWeight), `fully_paid` (saleFullyPaid), " +
    "`has_partner_obligation`/`partner_coverage_ratio` " +
    "(partnerCoverageRatio) as their own columns; `profit_usd`/" +
    "`profit_lbp`/`revenue_usd`/`cost_usd` stay raw so " +
    "`ProfitService.buildSaleModuleDetail` can multiply by `weight` and " +
    "render the not-counted-yet reason for a partial/zero-weight sale.",
  "ProfitRepository:getSalesDetail:(final select)":
    "Same mis-attribution and same reasoning as the `tenantId` entry " +
    "immediately above — this is PRIVATE getCompletedSalesDetailNet's " +
    "trailing SELECT (the primary branch, with discount/net columns), " +
    "mis-attributed to getSalesDetail. Exposes the identical " +
    "weight/fully_paid/has_partner_obligation/partner_coverage_ratio " +
    "columns for the same 'expose the gate, multiply upstream' reason.",
  "ProfitRepository:getSalesDetail:saleAggExtraWhere":
    "Same mis-attribution, same source method (getCompletedSalesDetailNet) " +
    "as the two entries above — this is that method's `sale_agg`/`sale_net` " +
    "CTE pair (shared `saleAggBody` shape with getSalesRevCost's own " +
    "already-excluded CTE), feeding the final select above with raw " +
    "revenue/cost; the gate columns are computed in the final select, not " +
    "here.",
  "ProfitRepository:getRechargeDetail:(query)":
    "Own doc comment, verified verbatim: 'Returns EVERY recharge for this " +
    "carrier in range ... including debt-pending ones " +
    "getRechargesByCarrier's own WHERE hard-excludes — the service (rule " +
    "13) needs those to render the not counted yet section and state " +
    "why.' Exposes `debt_pending` (notDebtPending) and " +
    "`has_partner_obligation`/`partner_coverage_ratio` " +
    "(hasPartnerObligation/partnerCoverageRatio) as their own columns; " +
    "`profit_usd`/`profit_lbp` stay raw by design.",
  "ProfitRepository:getFinancialServiceDetail:transferRows":
    "Own doc comment, verified: gate state is 'exposed as columns " +
    "(recognized/debt_pending), never applied as a [SQL gate]' — same " +
    "'expose the gate' shape getRechargeDetail already uses for its own " +
    "debt_pending.",
  "ProfitRepository:getFinancialServiceDetail:allocationRows":
    "Same method, same doc comment, same reasoning as the transferRows " +
    "entry immediately above — the allocations-table-aware twin of the " +
    "same drill-down, same gate-state-exposed-as-columns shape.",
  "ProfitRepository:getCustomServiceDetail:(query)":
    "Exposes `has_partner_obligation` (hasPartnerObligation) and " +
    "`debt_pending` (allocationNotDebtPending — the settlement_commission_" +
    "allocations-row variant, verified present in this query's own " +
    "CASE WHEN) as their own columns; profit/revenue/cost columns stay " +
    "raw, same 'expose the gate' Detail-family shape as getRechargeDetail.",
  "ProfitRepository:getMaintenanceDetail:(query)":
    "Exposes `has_partner_obligation` (hasPartnerObligation) and " +
    "`debt_pending` (notDebtPending) as their own columns; own doc comment " +
    "additionally notes this query 'applies NO partner weighting' (no " +
    "saleRecognitionWeight-style continuous gate for this module) — same " +
    "'expose the gate' Detail-family shape otherwise.",
  "ProfitRepository:getLotoDetail:(query)":
    "Exposes `debt_pending` (notDebtPending) as its own column; same " +
    "'expose the gate' Detail-family shape as getRechargeDetail/" +
    "getMaintenanceDetail.",
  "ProfitRepository:getExchangeDetail:(query)":
    "Exposes `has_partner_obligation` (hasPartnerObligation) as its own " +
    "column; own doc comment notes this module recognises 'profit only, " +
    "weighted by partnerCoverageRatio (no debt gate)' — partnerCoverageRatio " +
    "is likewise exposed as its own column, applied upstream like every " +
    "other Detail-family entry here.",
  "ProfitRepository:getTopupBuybackDetail:(query)":
    "Own doc comment, verified verbatim: 'Mirrors getTopupBuybackProfit " +
    "minus the SUM — that totals query DOES gate on notDebtPending (hard " +
    "WHERE) and weight on partnerCoverageRatio, so ... this exposes both " +
    "as columns, same \"expose the gate\" shape as getRechargeDetail.' " +
    "Exact, explicit confirmation of this whole family's rationale from " +
    "the source itself.",
};

describe("profit-recognition-gate drift guard (CQ-1, LIRA-098; LIRA-158 Phase 5)", () => {
  const sources = new Map(
    SCANNED_FILES.map((f) => [f.tag, fs.readFileSync(f.path, "utf8")] as const),
  );
  // LIRA-169 — method boundaries per scanned file, so each unit's gate check
  // can resolve a hoisted-variable alias against its OWN enclosing method's
  // source (see isGatedPerColumn's doc comment in sqlQueryUnits.ts).
  const boundariesByFile = new Map(
    SCANNED_FILES.map(
      (f) => [f.tag, findMethodBoundaries(sources.get(f.tag)!)] as const,
    ),
  );
  const units = SCANNED_FILES.flatMap((f) =>
    collectQueryUnits(sources.get(f.tag)!, f.tag),
  );
  const profitUnits = units.filter((u) => PROFIT_TOKEN_REGEX.test(u.sql));

  /** LIRA-169 — per-column gate check for unit `u`, resolving its own
   *  enclosing method's source for alias detection. */
  function unitIsGated(u: QueryUnit): boolean {
    const methodSource = methodSourceSlice(
      sources.get(u.file)!,
      boundariesByFile.get(u.file)!,
      u.methodName,
    );
    return isGatedPerColumn(u, methodSource, PROFIT_TOKEN_REGEX, GATE_FRAGMENTS);
  }

  it("sanity: every named recognition-gate fragment still exists as a callable function", () => {
    // If one of these were ever renamed, every check below would silently
    // stop finding it — prove the names this guard depends on are still
    // real. Defined exclusively in ProfitRepository.ts (see GATE_FRAGMENTS'
    // own doc comment).
    const profitRepoSource = sources.get("ProfitRepository")!;
    for (const fragment of GATE_FRAGMENTS) {
      expect(profitRepoSource).toContain(`function ${fragment}(`);
    }
  });

  it("sanity: the scan found a non-trivial number of profit-bearing query units", () => {
    // A guard that finds nothing to check is a guard that checks nothing.
    expect(profitUnits.length).toBeGreaterThan(10);
  });

  it("every profit-bearing query unit references a recognition-gate fragment (or is a named, justified exclusion)", () => {
    // LIRA-169: per-column (isGatedPerColumn), not whole-unit
    // (GATE_CALL_REGEX.test(u.sql) alone) — see this file's own LIRA-169
    // header note for why the whole-unit form misses a sibling column's
    // ungated copy of the same predicate.
    const violations = profitUnits.filter((u) => {
      if (unitKey(u) in EXCLUDED_UNITS) return false;
      return !unitIsGated(u);
    });
    if (violations.length > 0) {
      const message = violations
        .map(
          (v) =>
            `'${unitKey(v)}' (line ${v.line}) — SQL references ` +
            `'profit'/'commission' but calls none of ${GATE_FRAGMENTS.join(", ")}. If this ` +
            `query genuinely doesn't need a recognition gate, add ` +
            `'${unitKey(v)}' to EXCLUDED_UNITS here with a ` +
            `verified reason; otherwise wire in the correct gate fragment ` +
            `(rule 14, docs/COUNTERPARTY_LEDGERS.md).`,
        )
        .join("\n");
      throw new Error(`Ungated profit query unit(s):\n${message}`);
    }
  });

  it("EXCLUDED_UNITS carries no stale entries (every entry still matches an unguarded profit-bearing unit)", () => {
    const stale = Object.keys(EXCLUDED_UNITS).filter((key) => {
      const unit = units.find((u) => unitKey(u) === key);
      if (!unit) return true; // key no longer matches any parsed unit
      if (!PROFIT_TOKEN_REGEX.test(unit.sql)) return true; // no longer mentions "profit"
      if (unitIsGated(unit)) return true; // now gated (LIRA-169: per-column) — exclusion is dead weight
      return false;
    });
    expect(stale).toEqual([]);
  });

  it("ClosingRepository.ts carries ZERO profit-bearing query units (LIRA-219)", () => {
    // `ClosingRepository.getDailyStatsSnapshot` was deleted and replaced by
    // `getDailyActivityStats(day)` (sales/debt-payments/expenses only —
    // profit now lives in `ClosingService.getDailyStatsSnapshot`, composed
    // from `ProfitService.getSummary`, never re-texted SQL). This is the
    // guard that keeps it that way: a future change that adds a profit/
    // commission-shaped query back into this file — re-introducing the
    // exact class of bug LIRA-219 fixed — fails here immediately, rather
    // than silently reintroducing a second, divergent definition of profit
    // (rule 14) that this whole guard exists to prevent. If this ever
    // needs to change, the change belongs in
    // `ClosingService.profitParity.test.ts` first (rule 17), not here.
    const closingProfitUnits = profitUnits.filter((u) => u.file === "ClosingRepository");
    expect(closingProfitUnits.map(unitKey)).toEqual([]);
  });

  // LIRA-169 — rule 17: proven failing-first via a SYNTHETIC fixture (never
  // by editing real production code). The fixture below reproduces the
  // exact loophole shape `embeddedCommission.guard.test.ts`'s own history
  // found: one `.prepare()` unit with two profit-bearing SUM(CASE...)
  // columns, each carrying its OWN inline copy of the gate — then one
  // column's copy is stripped while the sibling's survives, exactly what
  // stripping `notDebtPending(...)` from only `getByUser`'s `profit_usd`
  // CASE while leaving `profit_lbp`'s copy intact would look like.
  it("LIRA-169: sibling-column loophole — old whole-unit check misses it, new per-column check catches it", () => {
    const gatedSiblingOnly: QueryUnit = {
      file: "ProfitRepository",
      methodName: "getByUser",
      unitLabel: "(query)",
      sql:
        "SELECT\n" +
        "  SUM(CASE WHEN t.type = 'SALE' THEN t.revenue_usd ELSE 0 END) AS revenue_usd,\n" +
        "  -- profit_usd's own gate was stripped — this is the regression.\n" +
        "  SUM(CASE WHEN t.type = 'SALE' THEN t.profit_usd ELSE 0 END) AS profit_usd,\n" +
        "  SUM(CASE WHEN t.type = 'SALE' AND NOT (txnNotPartnerPending(t) AND notDebtPending(t.id)) THEN t.profit_lbp ELSE 0 END) AS profit_lbp\n" +
        "FROM transactions t",
      line: 1,
    };

    // RED — the old, whole-unit check this guard used before LIRA-169. It
    // still reports "gated" because profit_lbp's surviving gate call makes
    // GATE_CALL_REGEX match the unit's SQL text SOMEWHERE, even though the
    // regressed profit_usd column carries no gate of its own at all. This
    // is the exact pre-fix formula (`GATE_CALL_REGEX.test(u.sql)`), proven
    // wrong on this fixture — not inferred, not asserted by comment.
    expect(GATE_CALL_REGEX.test(gatedSiblingOnly.sql)).toBe(true);

    // GREEN — the new per-column check correctly rejects the same fixture:
    // profit_usd's own column text resolves to no gate, so NOT every
    // profit/commission-bearing column is gated.
    const methodSource = `  getByUser(userId) {\n${gatedSiblingOnly.sql}\n  }\n`;
    expect(
      isGatedPerColumn(
        gatedSiblingOnly,
        methodSource,
        PROFIT_TOKEN_REGEX,
        GATE_FRAGMENTS,
      ),
    ).toBe(false);

    // Sanity: a unit where EVERY profit-bearing column carries its own gate
    // (the real, correct shape every production query uses today) still
    // passes the new check — proves the tightened logic isn't just
    // rejecting everything.
    const everyColumnGated: QueryUnit = {
      ...gatedSiblingOnly,
      sql:
        "SELECT\n" +
        "  SUM(CASE WHEN t.type = 'SALE' THEN t.revenue_usd ELSE 0 END) AS revenue_usd,\n" +
        "  SUM(CASE WHEN t.type = 'SALE' AND NOT (txnNotPartnerPending(t) AND notDebtPending(t.id)) THEN t.profit_usd ELSE 0 END) AS profit_usd,\n" +
        "  SUM(CASE WHEN t.type = 'SALE' AND NOT (txnNotPartnerPending(t) AND notDebtPending(t.id)) THEN t.profit_lbp ELSE 0 END) AS profit_lbp\n" +
        "FROM transactions t",
    };
    expect(
      isGatedPerColumn(
        everyColumnGated,
        methodSource,
        PROFIT_TOKEN_REGEX,
        GATE_FRAGMENTS,
      ),
    ).toBe(true);
  });
});
