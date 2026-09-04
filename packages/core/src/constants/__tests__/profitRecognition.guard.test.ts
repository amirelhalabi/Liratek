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
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectQueryUnits,
  unitKey,
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
  "ProfitRepository:getFinancialPendingByCurrency:(query)":
    "Deliberately the PRE-recognition bucket (is_settled = 0), surfaced as " +
    "its own 'pending' line (ProfitService.getByPaymentMethod) and never " +
    "summed into a realized total. The gate applies when/if the row moves " +
    "to the settled bucket (getFinancialSettledByCurrency, which DOES carry " +
    "notPartnerPending + notDebtPending).",
  "ProfitRepository:getByDate:daily_pmfee":
    "Payment-method fee is realized wallet-drawer cash the instant it's " +
    "collected (getPmFeeTotals's own doc comment: 'immediate shop profit ... " +
    "NOT gated by is_settled') — it is never part of a counterparty-financed " +
    "principal, so it cannot be partner- or debt-pending by construction.",
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
  "ProfitRepository:getPaymentMethodRows:(query)":
    "Trips the commission token only via its literal '0 AS " +
    "pending_commission_usd' padding column (payments-table view; sums " +
    "p.amount, never commission or profit). Its ungated state is the " +
    "documented v1 gap (COUNTERPARTY_LEDGERS.md §6 'Documented v1 gaps') — " +
    "explicitly out of LIRA-108's scope, which closed the commission ROWS " +
    "of the same view, not the per-payment-method rows.",
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
  // --- ClosingRepository.getDailyStatsSnapshot (LIRA-158 Phase 5) ---
  // `totalProfitUSD` is an INFORMATIONAL, same-day snapshot: its only
  // consumer is the generated closing PDF's "Total Profit (USD)" line
  // (LIRA-158_COMMISSION_REPORTING_PLAN.md §1.3 — no dashboard tile, no
  // ledger of record), scoped by `todayLocal(...)` to TODAY only. That
  // narrower purpose is why several entries below accept a same-day
  // cash/refund check instead of the Profits page's full partner-/debt-
  // pending machinery — but where a query is missing even ITS OWN module's
  // existing `is_refunded` gate (a gap this same LIRA-158 phase already
  // fixed for the sibling `finProfitLegacy` query, per §1.3's "bonus
  // defect"), that is called out honestly as a known gap, not papered over.
  "ClosingRepository:getDailyStatsSnapshot:finProfitLegacyDegraded":
    "LIRA-160 (2026-09-04, updated by the 2026-09-04 follow-up once " +
    "`notDebtPending` was exported): the SCHEMA-DRIFT branch, active ONLY " +
    "when NEITHER `partner_ledger` NOR `transactions` exists " +
    "(`ClosingRepository.moduleProfitGates.test.ts`, `ClosingRepository" +
    ".localBusinessDay.test.ts`, `ClosingRepository" +
    ".lira160PartnerPendingGates.test.ts` — none of them create either " +
    "table). On such a schema no partner_ledger row can reference this " +
    "table and no transactions row (hence no debt_ledger-keyed id) can " +
    "exist either, so both `notPartnerPending` and `notDebtPending` would " +
    "always no-op — same recognition-by-construction reasoning as every " +
    "other degraded branch in this file (`finProfitSettlement`, " +
    "`getSupplierCommissionTotals:degraded`). The other three siblings — " +
    "`finProfitLegacyPartnerOnly` (partner_ledger only), " +
    "`finProfitLegacyDebtOnly` (transactions only, via " +
    "`_sourceTxnIdSubquery` + `notDebtPending`), and `finProfitLegacyFull` " +
    "(both) — each call at least one GATE_FRAGMENT literally and need no " +
    "exclusion. NO RESIDUAL GAP: every schema combination a real fixture " +
    "exercises now applies whichever gates its own tables support.",
  "ClosingRepository:getDailyStatsSnapshot:finProfitSettlement":
    "Recognition-by-construction, identical reasoning to " +
    "getSupplierCommissionTotals:degraded above (LIRA-137 fix) transplanted " +
    "to Closing's todayLocal window (LIRA-158 Phase 4, D10): the SCHEMA-" +
    "DRIFT branch (`!this._hasSettlementAllocationsTable()`), the OLD " +
    "undifferentiated stamp-only query preserved verbatim for a pre-v150 " +
    "fixture — a SUPPLIER_SETTLEMENT transaction's profit_usd is the " +
    "operator's entered commission, a real provider-drawer top-up funded " +
    "BY the supplier AT settlement — no partner_ledger row is ever created " +
    "with reference_table = 'supplier_ledger' and no debt_ledger module-" +
    "debt row is ever keyed to a SUPPLIER_SETTLEMENT transaction id, so " +
    "both gates would always no-op here regardless of batch shape. REFUND " +
    "on the same source_table nets a same-day void to 0 (rule 20), " +
    "matching the ProfitRepository sibling exactly.",
  "ClosingRepository:getDailyStatsSnapshot:billsOnlySettlement":
    "D17 (LIRA-158 follow-up, owner decision 2026-08-31): the BILLS-ONLY " +
    "half of finProfitSettlement's former undifferentiated query, split out " +
    "once `settlement_commission_allocations` exists — same split, same " +
    "rationale as ProfitRepository.getSupplierCommissionTotals:billsOnly " +
    "above, transplanted to Closing's todayLocal window. Real provider-" +
    "funded drawer money the instant it's recognised ('our profit " +
    "entirely,' owner) — recognition-by-construction, no partner_ledger/" +
    "debt_ledger row is ever keyed to a SUPPLIER_SETTLEMENT transaction id, " +
    "so a gate would always no-op. The CASHLESS half (`cashlessSettlement`, " +
    "alongside this unit) is already gated via its own notPartnerPending + " +
    "allocationNotDebtPending calls and needs no exclusion.",
  "ClosingRepository:getDailyStatsSnapshot:rechargeProfitDegraded":
    "LIRA-160 (2026-09-04, updated by the follow-up once `notDebtPending` " +
    "was exported): same schema-drift branch / recognition-by-construction " +
    "reasoning as finProfitLegacyDegraded above — active ONLY when NEITHER " +
    "`partner_ledger` NOR `transactions` exists. It still carries " +
    "`notRefunded('recharges')` (the LIRA-158-era fix, unaffected) — " +
    "`notRefunded` isn't a GATE_FRAGMENT, so the unit still trips the token " +
    "match and needs this exclusion. The other three siblings " +
    "(`rechargeProfitPartnerOnly`/`rechargeProfitDebtOnly`/" +
    "`rechargeProfitFull`) each call at least one GATE_FRAGMENT literally " +
    "and need no exclusion. NO RESIDUAL GAP.",
  "ClosingRepository:getDailyStatsSnapshot:customProfitDegraded":
    "Same class as rechargeProfitDegraded immediately above, same " +
    "reasoning, for the custom-service source: schema-drift branch, active " +
    "ONLY when NEITHER `partner_ledger` NOR `transactions` exists, still " +
    "gated by `notRefunded('custom_services')` (unaffected LIRA-158-era " +
    "fix, still not a GATE_FRAGMENT). The other three siblings " +
    "(`customProfitPartnerOnly`/`customProfitDebtOnly`/`customProfitFull`) " +
    "each call at least one GATE_FRAGMENT literally and need no exclusion. " +
    "NO RESIDUAL GAP.",
  "ClosingRepository:getDailyStatsSnapshot:maintProfitDegraded":
    "LIRA-158 FIX (unchanged by LIRA-160, restated): `LOWER(status) = " +
    "'completed'` used to never match any row — maintenance.status's real " +
    "values are Received/In_Progress/Ready/Delivered/Delivered_Paid (no " +
    "'completed' state ever exists) — fixed by reusing `ProfitRepository" +
    ".maintenanceCompleted` (the exact B5 fix already applied to the " +
    "Profits page). LIRA-160 ADDS `notRefunded('maintenance')` " +
    "unconditionally (`maintenance.is_refunded` is a real, always-present " +
    "production column — LIRA-081, `MaintenanceRepository" +
    ".isJobMoneyLocked` — so this fix needed no schema-drift probe; " +
    "existing fixtures that predated the column were updated to carry " +
    "it). No `notPartnerPending` gate is added: maintenance has no " +
    "partner-routing path at all — `ProfitRepository.getMaintenanceTotals` " +
    "itself (the Profits-page counterpart) gates only `notRefunded` + " +
    "`notDebtPending`, never `notPartnerPending` (verified against " +
    "ProfitRepository.ts before filing this exclusion). THIS specific " +
    "unit (`maintProfitDegraded`) is the branch active ONLY when " +
    "`transactions` doesn't exist (`ClosingRepository" +
    ".moduleProfitGates.test.ts`, `ClosingRepository" +
    ".localBusinessDay.test.ts`, `ClosingRepository" +
    ".lira160PartnerPendingGates.test.ts`) — on such a schema no " +
    "`transactions` row (hence no debt_ledger-keyed id) can exist, so " +
    "`notDebtPending` would always no-op; still excluded because neither " +
    "`maintenanceCompleted` nor `notRefunded` is a GATE_FRAGMENT this " +
    "guard scans for. The sibling `maintProfitGated` (2026-09-04 " +
    "follow-up, active whenever `transactions` exists) calls " +
    "`notDebtPending` directly via `_sourceTxnIdSubquery` and needs no " +
    "exclusion. NO RESIDUAL GAP on either branch.",
};

describe("profit-recognition-gate drift guard (CQ-1, LIRA-098; LIRA-158 Phase 5)", () => {
  const sources = new Map(
    SCANNED_FILES.map((f) => [f.tag, fs.readFileSync(f.path, "utf8")] as const),
  );
  const units = SCANNED_FILES.flatMap((f) =>
    collectQueryUnits(sources.get(f.tag)!, f.tag),
  );
  const profitUnits = units.filter((u) => PROFIT_TOKEN_REGEX.test(u.sql));

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
    const violations = profitUnits.filter((u) => {
      if (unitKey(u) in EXCLUDED_UNITS) return false;
      return !GATE_CALL_REGEX.test(u.sql);
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
      if (GATE_CALL_REGEX.test(unit.sql)) return true; // now gated — exclusion is dead weight
      return false;
    });
    expect(stale).toEqual([]);
  });
});
