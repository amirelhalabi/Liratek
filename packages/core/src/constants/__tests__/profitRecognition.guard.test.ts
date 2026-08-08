/**
 * ProfitRepository profit-recognition-gate drift guard (CQ-1, LIRA-098).
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
 * Mechanism: parse ProfitRepository.ts source into "query units" — one per
 * `.prepare(\`...\`)` call, further split into one unit per CTE (plus a
 * trailing "final select" unit) for the single query that uses `WITH`
 * (`getByDate`) — then assert every unit whose SQL text contains `profit`
 * (case-insensitive; every profit column is
 * `profit_usd`/`profit_lbp`/`potential_profit_usd`/etc.) also textually calls
 * one of the six gate fragments. Text-based, not AST-based (mirrors
 * `moduleDebtTypes.guard.test.ts` / `partnerLedgerTypes.guard.test.ts`) —
 * cheap, survives formatting changes, and catches the actual failure mode: a
 * new query, or a new CTE added to `getByDate`, that computes profit from
 * sales/debt/partner data without wiring in the gate. Splitting `getByDate`
 * into per-CTE units (instead of treating its whole ~200-line prepare() call
 * as one pass/fail unit) matters: without it, a new ungated CTE added
 * alongside the nine existing ones would hide behind the gate fragments the
 * OTHER nine CTEs already reference in the same template literal.
 *
 * Known, deliberate scope boundary: this only catches queries that spell
 * "profit" literally. `getRealizedCommissionTotals` / `getPendingCommissionTotals` /
 * `getPendingCommissionByProvider` / `getUnsettledCommissions` sum
 * `financial_services.commission` directly (never `profit_usd`/`profit_lbp`)
 * and fall outside this text scan by construction. LIRA-098's build found
 * `getRealizedCommissionTotals` — which feeds
 * `ProfitService.getByPaymentMethod`'s "Commission (Settled)" row, documented
 * there as "shown as positive profit" — missing the `notPartnerPending` /
 * `notDebtPending` gates its sibling `getFinancialSettledByCurrency` carries
 * for the exact same commission-provider set. Filed as a finding in the
 * LIRA-098 report, deliberately NOT fixed here (out of this ticket's scope,
 * and fixing it would mean editing ProfitRepository.ts, which this ticket
 * does not touch).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");
const REPO_PATH = path.join(SRC_ROOT, "repositories", "ProfitRepository.ts");

/** The recognition-gate fragment family (Rule 14) — see file header. */
const GATE_FRAGMENTS = [
  "notDebtPending",
  "notPartnerPending",
  "txnNotPartnerPending",
  "saleFullyPaid",
  "saleNotFullyPaid",
  "salePaidOrPartnerSettled",
] as const;

const GATE_CALL_REGEX = new RegExp(`\\b(?:${GATE_FRAGMENTS.join("|")})\\(`);

/** SQL column aliases are lowercase (`profit_usd`, `potential_profit_usd`, ...). */
const PROFIT_TOKEN_REGEX = /profit/i;

interface QueryUnit {
  /** Enclosing repository method, resolved from the nearest preceding `  name(` boundary. */
  methodName: string;
  /** CTE name for a `WITH`-based query, `"(final select)"` for its trailing SELECT, or `"(query)"` for a plain single-statement query. */
  unitLabel: string;
  sql: string;
  /** 1-based source line where this unit's enclosing `.prepare(` call starts (for error messages). */
  line: number;
}

/** Locate every class-method start (`  methodName(`) so a query can be attributed to its method. */
function findMethodBoundaries(
  source: string,
): { name: string; index: number }[] {
  const boundaries: { name: string; index: number }[] = [];
  const re = /^ {2}(\w+)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    boundaries.push({ name: m[1], index: m.index });
  }
  return boundaries;
}

function methodNameAt(
  boundaries: { name: string; index: number }[],
  index: number,
): string {
  let name = "(module scope)";
  for (const b of boundaries) {
    if (b.index <= index) name = b.name;
    else break;
  }
  return name;
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Strip `-- ...` SQL line comments before any profit/gate matching or CTE
 * paren-balancing. Two real hazards this avoids, both found while proving
 * this guard against the actual file: (1) prose like `getPaymentMethodRows`'s
 * `-- Flag if ALL entries for this method are debt repayments (no profit)`
 * would otherwise false-positive the "profit" token match on a query that
 * has no profit column at all; (2) several doc comments wrap a parenthetical
 * across two comment lines (e.g. getByUser's `-- ORIGINAL seller
 * (orig.user_id via` / `-- reverses_id), not whoever...`) — left in, those
 * parens still balance out globally, but relying on that is fragile for
 * `findMatchingParen`'s CTE-boundary walk, so comments are removed first.
 */
function stripSqlLineComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

/** Find the index of the `)` matching the `(` at `openIndex` (a `(` character). */
function findMatchingParen(str: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(
    "profitRecognition.guard.test.ts: unbalanced parentheses while splitting " +
      "a WITH-query into CTE units — ProfitRepository.ts's getByDate query " +
      "shape changed; update splitCteUnits() in this guard.",
  );
}

/**
 * Split a query's SQL text into one unit per CTE plus a trailing "final
 * select" unit, for a query that opens with `WITH`. A non-WITH query is
 * returned as a single `"(query)"` unit unchanged.
 */
function splitCteUnits(sql: string): { label: string; body: string }[] {
  if (!/^\s*WITH\b/i.test(sql)) {
    return [{ label: "(query)", body: sql }];
  }
  const units: { label: string; body: string }[] = [];
  const cteNameRe = /(\w+)\s+AS\s*\(/g;
  let lastCloseIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = cteNameRe.exec(sql)) !== null) {
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findMatchingParen(sql, openParenIndex);
    units.push({
      label: match[1],
      body: sql.slice(openParenIndex + 1, closeParenIndex),
    });
    lastCloseIndex = closeParenIndex;
    cteNameRe.lastIndex = closeParenIndex + 1;
  }
  if (lastCloseIndex === -1) {
    throw new Error(
      "profitRecognition.guard.test.ts: a query starts with WITH but no CTE " +
        "(`name AS (`) was found — update splitCteUnits() in this guard.",
    );
  }
  units.push({
    label: "(final select)",
    body: sql.slice(lastCloseIndex + 1),
  });
  return units;
}

function collectQueryUnits(source: string): QueryUnit[] {
  const boundaries = findMethodBoundaries(source);
  const units: QueryUnit[] = [];
  // Optional trailing comma: every `.prepare(\`sql\`)` call in this file is
  // formatted with a dangling comma before the closing paren.
  const prepareRe = /\.prepare\(\s*`([\s\S]*?)`\s*,?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = prepareRe.exec(source)) !== null) {
    const methodName = methodNameAt(boundaries, m.index);
    const line = lineAt(source, m.index);
    const cleaned = stripSqlLineComments(m[1]);
    for (const u of splitCteUnits(cleaned)) {
      units.push({ methodName, unitLabel: u.label, sql: u.body, line });
    }
  }
  return units;
}

/**
 * Query units that legitimately contain a "profit" column/alias but do NOT
 * reference a recognition-gate fragment, each with its verified reason.
 */
const EXCLUDED_UNITS: Record<string, string> = {
  "getDebtRepaymentProfit:(query)":
    "Recognition-by-construction: DEBT_REPAYMENT/KEPT_CHANGE rows ARE the " +
    "recognition event (kept change collected AT the repayment) — there is " +
    "no counterparty-pending state left to gate against; the repayment " +
    "happening now is what 'money is real' means for this row.",
  "getCounterpartyDiscountTotals:(query)":
    "Owner decision D1 (COUNTERPARTY_CONSOLIDATION_PLAN.md): " +
    "COUNTERPARTY_DISCOUNT carries a signed profit stamp with amount_usd/lbp " +
    "always 0 (no cash moved) and is NON_REVERSIBLE_TRANSACTION_TYPES — " +
    "immediate recognition by design, nothing left to defer.",
  "getFinancialPendingByCurrency:(query)":
    "Deliberately the PRE-recognition bucket (is_settled = 0), surfaced as " +
    "its own 'pending' line (ProfitService.getByPaymentMethod) and never " +
    "summed into a realized total. The gate applies when/if the row moves " +
    "to the settled bucket (getFinancialSettledByCurrency, which DOES carry " +
    "notPartnerPending + notDebtPending).",
  "getByDate:daily_pmfee":
    "Payment-method fee is realized wallet-drawer cash the instant it's " +
    "collected (getPmFeeTotals's own doc comment: 'immediate shop profit ... " +
    "NOT gated by is_settled') — it is never part of a counterparty-financed " +
    "principal, so it cannot be partner- or debt-pending by construction.",
  "getByDate:(final select)":
    "Pure re-aggregation: sums CTE aliases (dsp.profit_usd, dc.profit_usd, " +
    "dr.profit_usd, ...) that were each already gated inside their own CTE " +
    "(checked as independent units by this guard) — the gate lives in the " +
    "CTE, not in the COALESCE(...) + that recombines already-gated numbers.",
};

describe("ProfitRepository — profit-recognition-gate drift guard (CQ-1, LIRA-098)", () => {
  const source = fs.readFileSync(REPO_PATH, "utf8");
  const units = collectQueryUnits(source);
  const profitUnits = units.filter((u) => PROFIT_TOKEN_REGEX.test(u.sql));

  it("sanity: every named recognition-gate fragment still exists as a callable function", () => {
    // If one of these were ever renamed, every check below would silently
    // stop finding it — prove the names this guard depends on are still real.
    for (const fragment of GATE_FRAGMENTS) {
      expect(source).toContain(`function ${fragment}(`);
    }
  });

  it("sanity: the scan found a non-trivial number of profit-bearing query units", () => {
    // A guard that finds nothing to check is a guard that checks nothing.
    expect(profitUnits.length).toBeGreaterThan(10);
  });

  it("every profit-bearing query unit references a recognition-gate fragment (or is a named, justified exclusion)", () => {
    const violations = profitUnits.filter((u) => {
      const key = `${u.methodName}:${u.unitLabel}`;
      if (key in EXCLUDED_UNITS) return false;
      return !GATE_CALL_REGEX.test(u.sql);
    });
    if (violations.length > 0) {
      const message = violations
        .map(
          (v) =>
            `'${v.methodName}:${v.unitLabel}' (line ${v.line}) — SQL references ` +
            `'profit' but calls none of ${GATE_FRAGMENTS.join(", ")}. If this ` +
            `query genuinely doesn't need a recognition gate, add ` +
            `'${v.methodName}:${v.unitLabel}' to EXCLUDED_UNITS here with a ` +
            `verified reason; otherwise wire in the correct gate fragment ` +
            `(rule 14, docs/COUNTERPARTY_LEDGERS.md).`,
        )
        .join("\n");
      throw new Error(`Ungated profit query unit(s):\n${message}`);
    }
  });

  it("EXCLUDED_UNITS carries no stale entries (every entry still matches an unguarded profit-bearing unit)", () => {
    const stale = Object.keys(EXCLUDED_UNITS).filter((key) => {
      const unit = units.find((u) => `${u.methodName}:${u.unitLabel}` === key);
      if (!unit) return true; // key no longer matches any parsed unit
      if (!PROFIT_TOKEN_REGEX.test(unit.sql)) return true; // no longer mentions "profit"
      if (GATE_CALL_REGEX.test(unit.sql)) return true; // now gated — exclusion is dead weight
      return false;
    });
    expect(stale).toEqual([]);
  });
});
