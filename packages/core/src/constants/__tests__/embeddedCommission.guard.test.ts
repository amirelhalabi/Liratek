/**
 * embedded-commission-estimate drift guard (LIRA-159 D3).
 *
 * The bug class: `financial_services.commission` holds a creation-time
 * ESTIMATE for `commission_model = 1` (AT_SETTLEMENT) rows. Settlement
 * overrides the real figure elsewhere (`supplier_settlements` /
 * `settlement_commission_allocations`, entered by the operator) and NEVER
 * writes it back onto the row's own `commission` column (owner decision D6 —
 * no stamp-back; see `ProfitRepository.embeddedCommission`'s own doc
 * comment). So any query that reads `financial_services.commission` for
 * REPORTING — summing it, counting rows by it, surfacing it as a dollar
 * figure — WITHOUT first restricting to legacy rows (`commission_model = 0`,
 * where the column genuinely is the settled truth) or explicitly carving out
 * the model-1 rows some other way, reports a number that was never true for
 * every AT_SETTLEMENT row it touches. LIRA-158 fixed several such queries;
 * LIRA-159 found more that were missed (`FinancialServiceRepository
 * .getUnsettledSummaryByProvider`, `FinancialRepository.getMonthlyPL`'s old
 * raw `SUM(commission)`, since replaced by composition). This guard exists so
 * the NEXT such query cannot ship ungated.
 *
 * The one true model gate (rule 14) is the fragment pair in
 * `ProfitRepository.ts`: {@link embeddedCommission} (`commission_model = 0` —
 * "this row's own `commission` column is the settled truth") and its
 * complement {@link atSettlementCommission} (`commission_model = 1` — "the
 * real figure doesn't exist on this row at all"). A query that calls EITHER
 * is model-aware: one restricts a dollar sum to the rows where `commission`
 * is trustworthy, the other deliberately counts (never sums) the rows where
 * it isn't. Both count as "gated" here for the same reason the sibling
 * `profitRecognition.guard.test.ts` accepts a fragment's negation or
 * transaction-scoped variant — a query using either half is still applying
 * the SAME rule, just phrased for what it needs.
 *
 * Mechanism: reuses `../testHelpers/sqlQueryUnits.ts` (extracted from
 * `profitRecognition.guard.test.ts` under this same LIRA-159 ticket, D3, so
 * this guard doesn't paste a second ~300-line copy of the query-unit parser
 * — rule 14 applies to test code too) to parse each file in
 * {@link SCANNED_FILES} into "query units" — one per `.prepare(\`...\`)`
 * call, split per-CTE for a `WITH` query, disambiguated by the assigned
 * `const`/`let` name when a method has 2+ non-`WITH` prepares — then applies
 * THIS guard's own, narrower scope test (see {@link isInScope}) and gate
 * test (see {@link isGated}) to each unit. Text-based, not AST-based: cheap,
 * survives formatting changes, and catches the actual failure mode (a new
 * query, or a new CASE arm, that sums/counts `financial_services.commission`
 * without restricting to a commission model) — the same tradeoff
 * `profitRecognition.guard.test.ts` and `moduleDebtTypes.guard.test.ts` make.
 *
 * `EXCLUDED_UNITS` is the named, justified escape hatch for a unit that
 * genuinely doesn't need the gate (a per-row operational read, not a
 * reporting aggregate) — see each entry's own rationale below. A genuine
 * ungated REPORTING aggregate found while building this guard would NOT be
 * silently added here; none was found (see the two exclusions below, both
 * non-reporting reads) — this guard shipped fully green with zero
 * behavioural gaps papered over.
 *
 * LIRA-158/LIRA-159 history: LIRA-158 (COMMISSION_AT_SETTLEMENT_PLAN.md /
 * LIRA-158_COMMISSION_REPORTING_PLAN.md) introduced the `embeddedCommission`/
 * `atSettlementCommission` gate pair and fixed the reporting surfaces it
 * found (`ProfitRepository`'s six commission queries, `ClosingRepository
 * .getDailyStatsSnapshot`'s `finProfitLegacy`), but explicitly deferred
 * `FinancialServiceRepository.getUnsettledSummaryByProvider` as "ACCEPTABLE
 * — self-documented as an estimate" (D15 follow-up note). LIRA-159 closed
 * that deferral for real (D15) and additionally found
 * `FinancialRepository.getMonthlyPL`'s raw `SUM(financial_services.commission)`
 * query, replaced by composing the already-gated `ProfitRepository` methods
 * instead of a third hand-rolled copy (rule 14). This guard (D3) is the
 * static backstop so a THIRD missed query never ships silently again.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectQueryUnits,
  findMethodBoundaries,
  methodNameAt,
  lineAt,
  stripSqlLineComments,
  unitKey,
  type QueryUnit,
} from "../testHelpers/sqlQueryUnits";

const SRC_ROOT = path.join(__dirname, "..", "..");

/**
 * Every repository file this guard scans for a bare
 * `financial_services.commission` column read. The five named in the ticket
 * plus `TransactionRepository.ts` — found by grepping every repository file
 * under `repositories/` that mentions `financial_services` for a literal
 * (non-suffix, non-alias-only) "commission" token; its
 * `_reverseSupplierSettlement` genuinely reads the bare column (see its
 * EXCLUDED_UNITS entry below). `ActivityRepository.ts`,
 * `CustomerSessionRepository.ts`, `DebtRepository.ts`, `PartnerRepository.ts`,
 * `SalesRepository.ts`, `ServiceProviderRepository.ts`, and
 * `SessionPaymentRepository.ts` also reference `financial_services` but were
 * checked and contain no bare "commission" token at all (verified via the
 * same grep). `tag` prefixes every unit key parsed from that file so
 * same-named methods across files can never collide.
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
  {
    tag: "FinancialServiceRepository",
    path: path.join(SRC_ROOT, "repositories", "FinancialServiceRepository.ts"),
  },
  {
    tag: "FinancialRepository",
    path: path.join(SRC_ROOT, "repositories", "FinancialRepository.ts"),
  },
  {
    tag: "SupplierRepository",
    path: path.join(SRC_ROOT, "repositories", "SupplierRepository.ts"),
  },
  {
    tag: "TransactionRepository",
    path: path.join(SRC_ROOT, "repositories", "TransactionRepository.ts"),
  },
];

/** The model-gate fragment pair (rule 14) — see file header. Both defined
 *  (as `function <name>(`) exclusively in `ProfitRepository.ts`. */
const GATE_FRAGMENTS = [
  "embeddedCommission",
  "atSettlementCommission",
] as const;
const GATE_CALL_REGEX = new RegExp(`\\b(?:${GATE_FRAGMENTS.join("|")})\\(`);

/**
 * A genuine READ of the `commission` column. `\bcommission\b` alone (no
 * extra suffix exclusion needed) already fails to match every look-alike the
 * ticket named — `commission_model`, `commission_usd`, `commission_lbp`,
 * `commission_rate`, `commission_rate_currency`, `commission_entry_mode`,
 * `commission_eligible`, `commission_unit_count`, `commission_collection_mode`,
 * and the table `settlement_commission_allocations` — because `_` is a `\w`
 * character in JS regex, so there is NO word boundary between `commission`
 * and a trailing/leading `_`; `\bcommission\b` cannot match inside any of
 * those identifiers at all. Verified against the real files below (every
 * scanned file's spot-check case).
 *
 * The one look-alike `\bcommission\b` alone does NOT exclude, found while
 * proving this regex against the real files: `AS commission` — an OUTPUT
 * ALIAS naming a column computed from something else entirely (e.g.
 * `ProfitRepository.getFinancialSettledByCurrency` /
 * `getFinancialPendingByCurrency` both do
 * `COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE
 * t.profit_usd END), 0) AS commission` — the value summed is
 * `transactions.profit_usd`/`profit_lbp`, never `financial_services
 * .commission`). Excluded via a negative lookbehind for `AS `/`as `
 * immediately before the token; a genuine read like `fs.commission` or
 * `SUM(fs2.commission)` is preceded by `.`/`(`/whitespace, never by `AS `, so
 * it is unaffected — and a unit that both READS the real column AND aliases
 * some other expression to the same name (not seen in these files, but
 * possible) would still match on its own `fs.commission`-shaped occurrence
 * elsewhere in the same unit.
 */
const BARE_COMMISSION_COLUMN_REGEX = /(?<!\bAS\s)\bcommission\b/i;

/** Only a read-shaped statement (`SELECT`/`WITH`) can be a REPORTING read in
 *  this guard's sense. An `INSERT`/`UPDATE` naming `commission` in its column
 *  list or `SET` clause is WRITING the (possibly estimated) value, not
 *  reporting it — `FinancialServiceRepository.createTransaction`'s
 *  `INSERT INTO financial_services (..., commission, ...)` is exactly this
 *  shape and would otherwise false-positive (it names `financial_services`
 *  and contains the bare `commission` column literally). Verified below. */
function isReadQuery(sql: string): boolean {
  return /^\s*(SELECT|WITH)\b/i.test(sql);
}

/**
 * A unit is in this guard's scope when: it's a read (not a write), it
 * references the `financial_services` table (directly, or via an alias bound
 * to it earlier in the SAME unit — a plain substring check suffices, since
 * the alias-binding line itself always contains the literal table name), AND
 * its SQL contains a genuine bare-column read of `commission` per
 * {@link BARE_COMMISSION_COLUMN_REGEX}.
 */
function isInScope(sql: string): boolean {
  return (
    isReadQuery(sql) &&
    /\bfinancial_services\b/.test(sql) &&
    BARE_COMMISSION_COLUMN_REGEX.test(sql)
  );
}

/**
 * Bare `${identifier}` interpolations in a unit's SQL text — i.e. a plain
 * variable reference, NOT a function call (`${embeddedCommission(...)}` has
 * a `(` immediately after the name and is excluded by requiring `}`
 * immediately after the identifier).
 */
function bareInterpolatedIdentifiers(sql: string): string[] {
  const re = /\$\{\s*([A-Za-z_]\w*)\s*\}/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * Does `text` (either a whole unit's SQL, or one column/WHERE-clause slice
 * of it — see {@link isGated}) itself resolve to a model gate, two layers:
 *
 * 1. Direct: `text` literally calls `embeddedCommission(` or
 *    `atSettlementCommission(`.
 *
 * 2. Alias-resolved: `text` interpolates a BARE variable (no inline call)
 *    that was assigned, earlier in the SAME enclosing method, from an
 *    expression containing a call to one of the two gate fragments — e.g.
 *    `FinancialServiceRepository.getAnalytics` computes `const
 *    modelZeroOnly = embeddedCommission(...)` ONCE and its five separate
 *    `.prepare()` calls each only interpolate `${modelZeroOnly}` — none of
 *    their OWN captured SQL text contains the literal string
 *    `embeddedCommission(`, so layer 1 alone would report all five as
 *    false-positive violations despite being genuinely gated. This is a
 *    real pattern in the actual code (not hypothetical), found while
 *    proving this guard against the real files.
 *
 * Alias resolution is scoped to the ENCLOSING METHOD's full source (its own
 * boundary to the next method boundary, or EOF) rather than to a precise
 * "before this prepare" slice: a hoisted gate variable is always assigned
 * before its uses for the code to run at all, so checking the whole method
 * body is safe and avoids needing exact character offsets the shared parser
 * doesn't expose (it only tracks 1-based line numbers).
 */
function textIsGated(text: string, methodSource: string): boolean {
  if (GATE_CALL_REGEX.test(text)) return true;
  for (const name of bareInterpolatedIdentifiers(text)) {
    const assignRe = new RegExp(
      `\\b(?:const|let)\\s+${name}\\s*[:=][^;]*?\\b(?:${GATE_FRAGMENTS.join("|")})\\(`,
    );
    if (assignRe.test(methodSource)) return true;
  }
  return false;
}

/**
 * Split a SELECT-shaped unit's SQL into its top-level (paren-depth-0)
 * comma-separated SELECT-list `columns` and everything from the top-level
 * `FROM` onward (`rest` — the FROM/JOIN/WHERE/GROUP BY tail). Depth-tracked
 * so a comma or the word FROM inside a subquery/CASE/function call never
 * splits early or ends the column list prematurely — e.g.
 * `ProfitRepository.getByUser`'s `pending_profit_usd` column contains its
 * OWN nested `SELECT ... FROM financial_services fs2 WHERE ...` subquery;
 * that inner FROM must NOT be mistaken for the outer query's top-level FROM.
 * Falls back to `{ columns: [sql], rest: "" }` when `sql` doesn't contain a
 * `SELECT` at all (defensive — every in-scope unit in these six files IS
 * SELECT-shaped, confirmed by this guard's own unit dump).
 */
function splitSelectShape(sql: string): { columns: string[]; rest: string } {
  const selectMatch = /\bSELECT\b/i.exec(sql);
  if (!selectMatch) return { columns: [sql], rest: "" };
  const start = selectMatch.index + selectMatch[0].length;
  let depth = 0;
  let fromIdx = sql.length;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /^FROM\b/i.test(sql.slice(i))) {
      fromIdx = i;
      break;
    }
  }
  const columnListText = sql.slice(start, fromIdx);
  const rest = sql.slice(fromIdx);
  const columns: string[] = [];
  let colDepth = 0;
  let last = 0;
  for (let i = 0; i < columnListText.length; i++) {
    const ch = columnListText[i];
    if (ch === "(") colDepth++;
    else if (ch === ")") colDepth--;
    else if (ch === "," && colDepth === 0) {
      columns.push(columnListText.slice(last, i));
      last = i + 1;
    }
  }
  columns.push(columnListText.slice(last));
  return { columns, rest };
}

/**
 * Gate detection for a whole {@link QueryUnit}, at COLUMN granularity —
 * NOT just "does the gate call appear anywhere in this unit's text". That
 * coarser check was tried first and PROVEN insufficient by rule-17 (see
 * this guard's own commit history / the LIRA-159 report): stripping
 * `embeddedCommission(...)` from ONLY `getUnsettledSummaryByProvider`'s
 * `pending_commission_usd`/`_lbp` CASE expressions, while its THIRD
 * CASE expression (`awaiting_settlement_count`) keeps its own
 * `atSettlementCommission(...)` call, left `GATE_CALL_REGEX.test(unit.sql)`
 * TRUE regardless — the surviving sibling gate call "covered" the two
 * newly-ungated columns purely because they share one `.prepare()` call.
 * This is exactly the same class of hazard `profitRecognition.guard.test.ts`
 * already solved once via CTE-splitting (`getByDate`'s per-CTE units) — the
 * fix here is the SELECT-list analogue: split each unit into its top-level
 * columns and require EVERY column that itself reads the bare `commission`
 * value to independently resolve to a gate.
 *
 * Two ways a column can be gated:
 *
 * 1. A WHERE-clause (or otherwise outside the column list — `rest` from
 *    {@link splitSelectShape}) gate call filters every ROW before any
 *    column expression runs, so it protects EVERY column uniformly — e.g.
 *    `ProfitRepository.getRealizedCommissionTotals` and
 *    `ClosingRepository`'s `finProfitLegacy` both gate this way
 *    (`AND ${embeddedCommission(...)}` in the WHERE clause, not inside a
 *    CASE). Checked FIRST and short-circuits per-column checking entirely.
 *
 * 2. Failing that, EVERY individual top-level column whose own text matches
 *    {@link BARE_COMMISSION_COLUMN_REGEX} must itself resolve to a gate
 *    (inline or alias) — e.g. `getUnsettledSummaryByProvider`'s
 *    `pending_commission_usd`/`_lbp` (each carries its own inline
 *    `${embeddedCommission(...)}`) and `FinancialServiceRepository
 *    .getAnalytics`'s five units (each column carries its own
 *    `${modelZeroOnly}`, alias-resolved per column).
 *
 * A unit with NO commission-bearing column in its SELECT list at all (the
 * bare read is only in `rest`, or the unit isn't cleanly SELECT-shaped)
 * falls back to a whole-text check so this function never silently "passes"
 * a unit it can't decompose — defensive; not hit by any unit in these six
 * files today (every in-scope unit's commission read is a column, verified).
 */
function isGated(unit: QueryUnit, methodSource: string): boolean {
  const { columns, rest } = splitSelectShape(unit.sql);
  if (textIsGated(rest, methodSource)) return true;
  const commissionColumns = columns.filter((c) =>
    BARE_COMMISSION_COLUMN_REGEX.test(c),
  );
  if (commissionColumns.length === 0) {
    return textIsGated(unit.sql, methodSource);
  }
  return commissionColumns.every((c) => textIsGated(c, methodSource));
}

/** Slice of `source` spanning `methodName`'s own body (its boundary to the
 *  next boundary, or EOF) — see {@link isGated}'s doc comment. */
function methodSourceSlice(
  source: string,
  boundaries: { name: string; index: number }[],
  methodName: string,
): string {
  const sorted = [...boundaries].sort((a, b) => a.index - b.index);
  const i = sorted.findIndex((b) => b.name === methodName);
  if (i === -1) return source;
  const start = sorted[i].index;
  const end = i + 1 < sorted.length ? sorted[i + 1].index : source.length;
  return source.slice(start, end);
}

/**
 * Supplementary collector for `this.query<...>(`/`this.queryOne<...>(`
 * calls (`BaseRepository`'s convenience wrappers around `db.prepare(...)
 * .all/.get(...)`) whose SQL is an INLINE template literal — as opposed to a
 * pre-built `sql` variable passed in from elsewhere, which several call
 * sites use and this collector does not attempt to trace back (same
 * text-scan tradeoff the shared parser itself makes for `getColumns()`-style
 * indirection).
 *
 * `collectQueryUnits` (the shared parser) only recognizes `.prepare(\`...\`)`
 * — true for every scanned file EXCEPT `TransactionRepository.ts`, which
 * almost exclusively calls `this.query<T>(...)`/`this.queryOne<T>(...)`
 * instead of `this.db.prepare(...)` directly (70+ call sites; verified via
 * grep). Without this collector, `_reverseSupplierSettlement`'s bare
 * `commission` SELECT (`this.query<{...}>(\`SELECT id, provider,
 * service_type, commission, commission_model FROM financial_services
 * WHERE settlement_id = ? AND tenant_id = ?\`, ...)`) would be silently
 * INVISIBLE to this guard — not "checked and passing", just never looked
 * at, which defeats the point of a guard whose job is catching what a query
 * does regardless of which DB-access wrapper it goes through. No other
 * scanned file has an in-scope `this.query(`/`this.queryOne(`-shaped
 * commission read (verified: every other file's bare "commission" mention
 * outside a `.prepare(` call is a comment, a TS interface field, or a
 * write-path parameter — none is inside one of these call sites).
 *
 * Reuses the SAME exported primitives (`findMethodBoundaries`/
 * `methodNameAt`/`lineAt`/`stripSqlLineComments`) `collectQueryUnits` itself
 * uses. No WITH/CTE-splitting or per-method variable disambiguation is
 * implemented here (unlike `collectQueryUnits`) — no in-scope `this.query(`-
 * shaped call in these files uses a CTE, and per-method disambiguation
 * instead falls back to a simple `(query-like #N)` ordinal per method
 * (mirroring `collectQueryUnits`'s own `(query #N)` fallback shape for a
 * `.prepare(` call with no discoverable variable name) — accepted as a
 * known fragility (an EXCLUDED_UNITS key naming ordinal N could shift if a
 * DIFFERENT `this.query(`-shaped call is added/removed earlier in the same
 * mis-attributed span), caught the same way the shared parser's own
 * ordinal fallback is: the "EXCLUDED_UNITS carries no stale entries" check
 * below.
 */
function collectQueryLikeUnits(source: string, file: string): QueryUnit[] {
  const boundaries = findMethodBoundaries(source);
  const re = /this\.(?:query|queryOne)(?:<[\s\S]*?>)?\(\s*`([\s\S]*?)`/g;
  const units: QueryUnit[] = [];
  const seenByMethod = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const methodName = methodNameAt(boundaries, m.index);
    const line = lineAt(source, m.index);
    const cleaned = stripSqlLineComments(m[1]);
    const seen = (seenByMethod.get(methodName) ?? 0) + 1;
    seenByMethod.set(methodName, seen);
    units.push({
      file,
      methodName,
      unitLabel: `(query-like #${seen})`,
      sql: cleaned,
      line,
    });
  }
  return units;
}

/**
 * Query units that read `financial_services.commission` but do NOT call
 * (directly or via alias) a model gate, each with its verified reason. Keys
 * are `<file>:<method>:<unit>` — `file` matches a {@link SCANNED_FILES}
 * `tag`; `method` is the ENCLOSING boundary the parser attributed the unit
 * to, which for a `private`/`protected` class method is the nearest
 * preceding PUBLIC method's name (the shared parser's `findMethodBoundaries`
 * only recognizes 2-space `name(` and top-level `function name(` boundaries
 * — a `private`/`protected` modifier sits where the name would, so it never
 * matches; see that function's own doc comment for the precedent this same
 * mis-attribution already caused once). Both real methods named in the
 * rationale below (`_resolveSettlementBatchModel`, `_reverseSupplierSettlement`)
 * are private — the KEY names the mis-attributed public method the scan
 * actually found (verified by running the guard and reading its own
 * violation output, not guessed), the RATIONALE names the true method.
 *
 * A consequence of this collapsing, found while proving this guard against
 * the real files: the SupplierRepository key below can be genuinely
 * AMBIGUOUS. Every private method between `settleTransactions` and the next
 * public boundary (`_resolveSettlementBatchModel`, `_bookCommissionAtSettlement`,
 * and a THIRD, unrelated `rows`-assigned prepare belonging to neither of
 * those two) collapses onto `settleTransactions`'s name, and two of those
 * prepares happen to both be assigned to a local variable literally named
 * `rows` — so `"SupplierRepository:settleTransactions:rows"` matches TWO
 * different parsed units, only one of which is in this guard's scope. The
 * "EXCLUDED_UNITS carries no stale entries" check below is written to
 * tolerate this (checked EVERY unit sharing a key, not just the first) —
 * see its own doc comment for how a naive first-match lookup was PROVEN
 * wrong here (it reported a false "stale") before landing on that design.
 *
 * Both entries below are per-row OPERATIONAL reads (settlement-eligibility
 * resolution, reversal-state resolution), never a reporting aggregate — the
 * bug class this guard exists for is specifically a query that SUMS/COUNTS
 * the column into a dollar figure or displayed total. Neither of these two
 * does that; see each entry. Both were considered as candidate genuine
 * ungated REPORTING aggregates and ruled out on that specific question —
 * see each rationale's closing sentence.
 */
/**
 * LIRA-186: exclusion identity, keyed WITHOUT the parser's ordinal fallback
 * label (`(query #N)` / `(query-like #N)`) — that label shifts whenever an
 * unrelated query is added/removed earlier in the same mis-attributed
 * method span (see `TransactionRepository:getRefundBookedRate`'s own
 * history below: #20 → #21 → #23 across three unrelated changes, none of
 * which touched the excluded query itself), which previously forced this
 * exact const to be edited in an unrelated change just to keep the ordinal
 * current. A key here is `file` + `method` (the same mis-attributed
 * boundary the parser resolves — still the best available identity for a
 * private method, see the doc comment above) + `sqlContains`, a substring
 * of the unit's OWN SQL text stable across ordinal shifts (chosen to be
 * unique within that file+method pairing — see each entry's rationale).
 * `matchesExclusion` below does the lookup; nothing keys off `unitLabel`
 * for exclusion-matching purposes any more (the un-excluded "ungated
 * commission read" error message still reports a unit's live `unitKey()`
 * for the OPERATOR fixing a NEW violation — only still useful there, since
 * a fresh violation has no stale ordinal to go stale).
 */
interface ExclusionRule {
  file: string;
  method: string;
  sqlContains: string;
  reason: string;
}

const EXCLUDED_UNITS: ExclusionRule[] = [
  {
    file: "SupplierRepository",
    method: "settleTransactions",
    sqlContains:
      "id, provider, service_type, commission, commission_model, currency FROM financial_services",
    reason:
      "Dead SELECT column, not a reporting read. The true source is the " +
      "PRIVATE method `_resolveSettlementBatchModel` — mis-attributed by the " +
      "shared parser to `settleTransactions` (the nearest preceding PUBLIC " +
      "method boundary; see this const's own doc comment) and (pre-LIRA-186) " +
      "labeled `rows` (the local variable its `.prepare()` result is " +
      "assigned to, since `settleTransactions` — the mis-attribution target " +
      "— has 2+ non-WITH prepares; that variable name is no longer part of " +
      "this exclusion's identity, see the sqlContains fragment instead). It " +
      "selects `id, provider, service_type, commission, commission_model, " +
      "currency FROM financial_services` into `EligibleSettlementRow[]`, but " +
      "verified (grepped every `.commission` / `.commission_model` access on " +
      "the resulting `rows`/`eligibleRows` across SupplierRepository.ts) " +
      "that only `.commission_model` (to derive the batch's shared model, " +
      "D4's mixed-model rejection) and `.currency`/`.service_type`/" +
      "`.provider`/`.id` are ever read downstream — `.commission` itself is " +
      "fetched and then never consulted again anywhere, in " +
      "`_bookCommissionAtSettlement` or otherwise. A value nobody reads " +
      "cannot misreport anything: NOT a reporting aggregate, ruled out. " +
      "NOTE: this exclusion is genuinely ambiguous — SupplierRepository.ts " +
      "has a second, out-of-scope `rows`-assigned prepare (no `commission` " +
      "token) that collapses onto the same `settleTransactions` boundary; " +
      "`matchesExclusion` is checked against every in-scope unit sharing " +
      "file+method, and `sqlContains` alone already disambiguates the two " +
      "(the out-of-scope one has no such substring).",
  },
  {
    file: "TransactionRepository",
    method: "getRefundBookedRate",
    sqlContains:
      "SELECT id, provider, service_type, commission, commission_model FROM financial_services WHERE settlement_id IN",
    reason:
      "Per-row REVERSAL-STATE read, not a reporting aggregate. The true " +
      "source is the PRIVATE method `_reverseSupplierSettlement` — " +
      "mis-attributed by {@link collectQueryLikeUnits} to the nearest " +
      "preceding PUBLIC method boundary (see this const's own doc comment). " +
      "Pre-LIRA-186 this exclusion was keyed by the parser's ordinal " +
      "fallback label and had to be hand-edited three times for reasons " +
      "that had nothing to do with this query: the ordinal shifted from #20 " +
      "to #21 when the SMS-fee-expense cutover (owner decision 2026-09-06) " +
      "inserted `_cascadeExpenseSiblingVoid`/`_expensesHasSourceRefColumns` " +
      "earlier in this same mis-attributed span, from #21 to #23 when " +
      "LIRA-189 (multi-member supplier-settlement reversal) widened this " +
      "same method's OWN preceding `linkedLedgerRows` lookup into a " +
      "two-branch ternary, and the ATTRIBUTED PUBLIC METHOD NAME itself " +
      "from `getCustomerFacingLegs` to `getRefundBookedRate` when LIRA-236 " +
      "(REFUND_EXCHANGE_RATE_PLAN.md) added `getRefundBookedRate` as a new " +
      "public method immediately after `getCustomerFacingLegs`, becoming " +
      "the new nearest-preceding boundary for the SAME unmoved private " +
      "query. The `sqlContains` fragment below is the query's own SQL text " +
      "— it cannot shift when an unrelated query is added/removed nearby, " +
      "only if THIS query's own shape changes (at which point re-verifying " +
      "the exclusion is exactly the right outcome). `SELECT id, provider, " +
      "service_type, commission, commission_model FROM financial_services " +
      "WHERE settlement_id IN (...)` feeds each row into " +
      "`isPendingSupplierSettlement` to decide whether reversing this " +
      "settlement should also flip `is_settled` back to 0. That function IS " +
      "already model-aware — `if (commission_model === 1) {...} return " +
      "(provider is OMT/WHISH) && commission > 0` — it only consults the " +
      "bare `commission` value inside the IMPLICIT commission_model === 0 " +
      "(legacy) branch, where the column genuinely is the settled truth " +
      "(same rule `embeddedCommission` encodes); it just expresses that " +
      "branch as plain JS `if`/`return` in " +
      "`FinancialServiceRepository.isPendingSupplierSettlement` rather than " +
      "as a SQL gate call, so it is invisible to this guard's text-only " +
      "`embeddedCommission(`/`atSettlementCommission(` detection. Not a " +
      "dollar figure or count surfaced anywhere: NOT a reporting aggregate, " +
      "ruled out. `getRefundBookedRate` itself (verified by reading it) " +
      "runs no SQL touching `financial_services.commission` at all — it " +
      "reads `transactions.exchange_rate` only.",
  },
];

/** Collapse all whitespace runs (including the newlines/indentation every
 *  multi-line template-literal SQL string in these files actually contains)
 *  to a single space, so `sqlContains` can be written as one readable line
 *  without having to reproduce the source file's exact line-wrapping. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Whether unit `u` matches exclusion `rule`: same scanned-file `tag`, same
 * parser-attributed enclosing method, and `rule.sqlContains` is a
 * (whitespace-normalized) substring of the unit's own SQL text (LIRA-186 —
 * replaces exact `unitKey()` equality so an exclusion survives the parser's
 * ordinal fallback label shifting under unrelated changes).
 */
function matchesExclusion(u: QueryUnit, rule: ExclusionRule): boolean {
  return (
    u.file === rule.file &&
    u.methodName === rule.method &&
    normalizeWhitespace(u.sql).includes(normalizeWhitespace(rule.sqlContains))
  );
}

function findExclusion(u: QueryUnit): ExclusionRule | undefined {
  return EXCLUDED_UNITS.find((rule) => matchesExclusion(u, rule));
}

describe("embedded-commission-estimate drift guard (LIRA-159 D3)", () => {
  const sources = new Map(
    SCANNED_FILES.map((f) => [f.tag, fs.readFileSync(f.path, "utf8")] as const),
  );
  const boundariesByFile = new Map(
    SCANNED_FILES.map(
      (f) => [f.tag, findMethodBoundaries(sources.get(f.tag)!)] as const,
    ),
  );
  const units = SCANNED_FILES.flatMap((f) => [
    ...collectQueryUnits(sources.get(f.tag)!, f.tag),
    ...collectQueryLikeUnits(sources.get(f.tag)!, f.tag),
  ]);
  const inScopeUnits = units.filter((u) => isInScope(u.sql));

  it("sanity: every named gate fragment still exists as a callable function in ProfitRepository.ts", () => {
    const profitRepoSource = sources.get("ProfitRepository")!;
    for (const fragment of GATE_FRAGMENTS) {
      expect(profitRepoSource).toContain(`function ${fragment}(`);
    }
  });

  it("sanity: the scan found a non-trivial number of commission-column-reading query units", () => {
    // A guard that finds nothing to check is a guard that checks nothing —
    // the same vacuous-pass hazard the repo's e2e floor check exists for.
    expect(inScopeUnits.length).toBeGreaterThan(10);
  });

  it("BARE_COMMISSION_COLUMN_REGEX is not fooled by look-alike identifiers (spot check)", () => {
    const lookAlikes = [
      "sca.commission_usd",
      "sca.commission_lbp",
      "commission_model",
      "commission_rate",
      "commission_rate_currency",
      "commission_entry_mode",
      "commission_eligible",
      "commission_unit_count",
      "commission_collection_mode",
      "settlement_commission_allocations",
      "SELECT ... AS commission",
      "as commission",
    ];
    for (const s of lookAlikes) {
      expect(BARE_COMMISSION_COLUMN_REGEX.test(s)).toBe(false);
    }
    // And a genuine read shape must still match.
    for (const s of [
      "fs.commission",
      "fs2.commission",
      "commission > 0",
      "(commission)",
    ]) {
      expect(BARE_COMMISSION_COLUMN_REGEX.test(s)).toBe(true);
    }
  });

  it("every commission-column-reading query unit is model-gated (or is a named, justified exclusion)", () => {
    const violations = inScopeUnits.filter((u) => {
      if (findExclusion(u)) return false;
      const methodSource = methodSourceSlice(
        sources.get(u.file)!,
        boundariesByFile.get(u.file)!,
        u.methodName,
      );
      return !isGated(u, methodSource);
    });
    if (violations.length > 0) {
      const message = violations
        .map(
          (v) =>
            `'${unitKey(v)}' (line ${v.line}) — SQL reads ` +
            `financial_services.commission but calls neither embeddedCommission(` +
            `nor atSettlementCommission( (directly or via a hoisted variable). ` +
            `If this query genuinely doesn't need the gate, add an entry to ` +
            `EXCLUDED_UNITS here — { file: '${v.file}', method: '${v.methodName}', ` +
            `sqlContains: <a substring of its SQL unique within that file+method>, ` +
            `reason: <verified> } (LIRA-186: key by identity, not the parser's ` +
            `ordinal fallback label); otherwise wire in the correct gate fragment ` +
            `(rule 14, ProfitRepository.embeddedCommission / .atSettlementCommission).`,
        )
        .join("\n");
      throw new Error(`Ungated commission-column read(s):\n${message}`);
    }
  });

  it("EXCLUDED_UNITS carries no stale entries (every entry still matches an in-scope, ungated unit)", () => {
    // Deliberately checks EVERY unit matching a rule's file+method+sqlContains,
    // not just the first match: the private-method mis-attribution documented
    // on EXCLUDED_UNITS's own doc comment can make a rule genuinely
    // ambiguous — e.g. the SupplierRepository rule can match BOTH
    // `_getUnsettledBySupplierColumns`-adjacent code's own `rows` prepare
    // (out of scope — no "commission" token, and `sqlContains` alone already
    // excludes it since that text doesn't appear there) AND
    // `_resolveSettlementBatchModel`'s `rows` prepare (in scope, the intended
    // target), because both private methods collapse onto the same public
    // "settleTransactions" boundary. A rule is "still needed" if ANY unit
    // matching it is in-scope and ungated, which is the only question that
    // actually matters (the main violations check above is unaffected by the
    // same collision, since it tests `findExclusion(u)` per-unit over
    // `inScopeUnits` only — an out-of-scope collider is never a candidate
    // there).
    const stale = EXCLUDED_UNITS.filter((rule) => {
      const candidates = units.filter((u) => matchesExclusion(u, rule));
      if (candidates.length === 0) return true; // rule matches no parsed unit at all
      const stillNeeded = candidates.some((u) => {
        if (!isInScope(u.sql)) return false;
        const methodSource = methodSourceSlice(
          sources.get(u.file)!,
          boundariesByFile.get(u.file)!,
          u.methodName,
        );
        return !isGated(u, methodSource);
      });
      return !stillNeeded;
    });
    expect(stale.map((r) => `${r.file}:${r.method}:${r.sqlContains}`)).toEqual(
      [],
    );
  });

  it("getUnsettledSummaryByProvider and getMonthlyPL are covered by this guard's own design (LIRA-159 fix targets)", () => {
    // getUnsettledSummaryByProvider must pass ON MERIT — no exclusion entry.
    const summaryUnit = inScopeUnits.find(
      (u) =>
        u.file === "FinancialServiceRepository" &&
        u.methodName === "getUnsettledSummaryByProvider",
    );
    expect(summaryUnit).toBeDefined();
    expect(findExclusion(summaryUnit!)).toBeUndefined();
    const methodSource = methodSourceSlice(
      sources.get("FinancialServiceRepository")!,
      boundariesByFile.get("FinancialServiceRepository")!,
      "getUnsettledSummaryByProvider",
    );
    expect(isGated(summaryUnit!, methodSource)).toBe(true);

    // getMonthlyPL's raw SUM(commission) was removed in favour of composing
    // ProfitRepository's gated methods — FinancialRepository.ts should now
    // contain NO in-scope unit at all.
    const financialRepoInScope = inScopeUnits.filter(
      (u) => u.file === "FinancialRepository",
    );
    expect(financialRepoInScope).toEqual([]);
  });

  // LIRA-186. NOT proven failing-first by rule 17's own test-execution
  // standard: the "old" behaviour it documents (exact `unitKey()` string
  // equality against a Record keyed by the parser's ordinal fallback label)
  // is the code this very change replaces, so reproducing it failing would
  // mean reverting the fix this test is part of delivering — the exact
  // self-referential case rule 17's "label tests NOT proven failing-first
  // when that isn't possible" carve-out anticipates, not a shortcut taken
  // to avoid the work. What IS executed and verified: the old scheme's
  // break is a plain, unconditional string-equality fact (asserted
  // directly below, not inferred), and the new scheme's survival is
  // asserted against the REAL `findExclusion`/`matchesExclusion` this file
  // now ships, not a hand-simulated stand-in.
  it("LIRA-186: exclusion identity survives an ordinal-label shift that the old unitKey()-keyed Record did not", () => {
    const before: QueryUnit = {
      file: "TransactionRepository",
      methodName: "getRefundBookedRate",
      unitLabel: "(query-like #23)",
      sql:
        "SELECT id, provider, service_type, commission, commission_model " +
        "FROM financial_services WHERE settlement_id IN (?)",
      line: 100,
    };
    // Simulates exactly the documented real-world trigger (LIRA-189, a
    // query inserted earlier in the same mis-attributed span): the ordinal
    // fallback label shifts while the excluded query's own SQL and
    // parser-attributed method are unchanged.
    const after: QueryUnit = { ...before, unitLabel: "(query-like #24)" };

    // Old scheme, unconditionally: a Record keyed by the full `unitKey()`
    // string (file:method:unitLabel) no longer matches once the label
    // shifts — this is what forced the three unrelated hand-edits the
    // ticket and this file's own rationale document.
    const oldStyleKey =
      "TransactionRepository:getRefundBookedRate:(query-like #23)";
    expect(unitKey(before)).toBe(oldStyleKey);
    expect(unitKey(after)).not.toBe(oldStyleKey);

    // New scheme: both match the same rule, because identity never
    // consults `unitLabel`.
    expect(findExclusion(before)).toBeDefined();
    expect(findExclusion(after)).toBeDefined();
    expect(findExclusion(before)).toBe(findExclusion(after));
  });
});
