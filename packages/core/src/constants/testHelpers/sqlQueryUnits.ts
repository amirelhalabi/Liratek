/**
 * Shared SQL "query unit" parser, extracted from
 * `constants/__tests__/profitRecognition.guard.test.ts` (LIRA-159 D3) so a
 * second text-scan guard (`constants/__tests__/embeddedCommission.guard.test.ts`)
 * can reuse the exact same machinery instead of pasting a second ~300-line
 * copy (rule 14 applies to test code too).
 *
 * Moved VERBATIM — no behaviour change. See `profitRecognition.guard.test.ts`
 * for the full worked history of why each piece of this parser looks the way
 * it does (the CTE-splitting rationale, the per-method disambiguation via
 * `precedingVarName`, the free-function boundary fix, etc.) — those doc
 * comments travel with their functions below rather than being duplicated
 * here.
 *
 * NOT placed under a `__tests__/` directory anywhere in its path: this
 * package's `jest.config.cjs` `testRegex` is `(/__tests__/.*|(\.|/)(test|spec))\.tsx?$`
 * — the `/__tests__/.*` branch matches ANY `.ts` file nested under a
 * `__tests__` folder at any depth, with no filename convention required. A
 * file with this module's name (no `describe`/`it` blocks) placed under
 * `__tests__/` would be collected as its own empty test suite and fail the
 * run with "Your test suite must contain at least one test". Verified against
 * `packages/core/jest.config.cjs` before picking this location.
 */

/**
 * One parsed query unit: either a whole non-`WITH` `.prepare()` call, one CTE
 * body from a `WITH`-based query, or (a method with 2+ non-`WITH` prepares)
 * one of those prepares disambiguated by its own local variable name.
 */
export interface QueryUnit {
  /** Which scanned-file entry this unit came from (that file's own `tag`). */
  file: string;
  /** Enclosing repository method, resolved from the nearest preceding `  name(` boundary. */
  methodName: string;
  /**
   * CTE name for a `WITH`-based query, `"(final select)"` for its trailing
   * SELECT, `"(query)"` for a method with exactly one non-`WITH` prepare, or
   * (a method with 2+ non-`WITH` prepares) the local `const`/`let` variable
   * name that specific query is assigned to — falling back to `"(query #N)"`
   * if no such assignment can be found. See {@link precedingVarName}.
   */
  unitLabel: string;
  sql: string;
  /** 1-based source line where this unit's enclosing `.prepare(` call starts (for error messages). */
  line: number;
}

/** Locate every class-method start (`  methodName(`) so a query can be attributed to its method. */
export function findMethodBoundaries(
  source: string,
): { name: string; index: number }[] {
  const boundaries: { name: string; index: number }[] = [];
  const methodRe = /^ {2}(\w+)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(source)) !== null) {
    boundaries.push({ name: m[1], index: m.index });
  }
  // Top-level (module-scope, 0-indent) `function NAME(` declarations — the
  // free Rule 14 helpers (e.g. `hasCommissionModelColumn`,
  // `hasSettlementAllocationsTable`) declared before the class. Needed so a
  // `.prepare(` call INSIDE one of these attributes to the function's own
  // name instead of silently falling through to whatever class method (or
  // "(module scope)") happens to be the nearest OTHER boundary. This closes
  // a real, latent mis-attribution the LIRA-158 Phase 5 extension found:
  // `private`/`protected` class methods don't match `methodRe` either (the
  // modifier keyword sits where the name would), so a schema-probe method
  // like `_hasSettlementAllocationsTable` (private) used to have its inline
  // `.prepare(` silently attributed to "constructor" — the nearest PUBLIC
  // method boundary — and, because its SQL names a table containing the
  // substring "commission" (`settlement_commission_allocations`), that was
  // an UNEXCLUDED violation nobody had caught. Moving the probe into an
  // exported free function (LIRA-158 Phase 5 item 2's de-duplication) plus
  // this boundary fix relocates it to a clean, honestly-excluded
  // `hasSettlementAllocationsTable:(query)` key instead (see EXCLUDED_UNITS).
  const functionRe = /^(?:export )?function (\w+)\(/gm;
  while ((m = functionRe.exec(source)) !== null) {
    boundaries.push({ name: m[1], index: m.index });
  }
  boundaries.sort((a, b) => a.index - b.index);
  return boundaries;
}

export function methodNameAt(
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

export function lineAt(source: string, index: number): number {
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
export function stripSqlLineComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

/** Find the index of the `)` matching the `(` at `openIndex` (a `(` character). */
export function findMatchingParen(str: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(
    "sqlQueryUnits.ts: unbalanced parentheses while splitting " +
      "a WITH-query into CTE units — a scanned file's getByDate-shaped query " +
      "changed shape; update splitCteUnits() in this helper.",
  );
}

/**
 * Split a query's SQL text into one unit per CTE plus a trailing "final
 * select" unit, for a query that opens with `WITH`. A non-WITH query is
 * returned as a single `"(query)"` unit unchanged.
 */
export function splitCteUnits(sql: string): { label: string; body: string }[] {
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
      "sqlQueryUnits.ts: a query starts with WITH but no CTE " +
        "(`name AS (`) was found — update splitCteUnits() in this helper.",
    );
  }
  units.push({
    label: "(final select)",
    body: sql.slice(lastCloseIndex + 1),
  });
  return units;
}

/**
 * For a query unit inside a method with MORE THAN ONE non-`WITH`
 * `.prepare(` call, resolve the local `const`/`let` variable name that
 * specific call is assigned to — e.g. `const salesProfit = this.db.prepare(...)`
 * resolves to `"salesProfit"` for the `.prepare(` inside it, even when (as
 * with `ClosingRepository`'s `finProfitSettlement`) the assignment and the
 * `.prepare(` call are separated by an intervening ternary/parens:
 * `const finProfitSettlement = cond ? (this.db.prepare(...)...) : ...`.
 *
 * Scans from `windowStart` (the enclosing method's own boundary — see
 * {@link findMethodBoundaries} — never earlier, so a variable from a
 * DIFFERENT method can never leak in) up to `prepareIndex` and keeps the
 * LAST `const`/`let NAME =` match found — by construction, the assignment
 * for THIS query is always the closest one preceding its own `.prepare(`
 * call (every case in both scanned files declares the query's own variable
 * immediately before opening `.prepare(`, even through a ternary), so "last
 * in the window" is equivalent to "this query's own declaration" without
 * needing to understand the expression shape in between.
 *
 * Returns `null` if no `const`/`let` declaration is found in the window (a
 * bare `return this.db.prepare(...)` with no intermediate variable) — the
 * caller falls back to numbered `"(query #N)"` labels in that case.
 */
export function precedingVarName(
  source: string,
  prepareIndex: number,
  windowStart: number,
): string | null {
  const slice = source.slice(windowStart, prepareIndex);
  const re = /\b(?:const|let)\s+(\w+)\s*[:=]/g;
  let last: string | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(slice)) !== null) {
    last = mm[1];
  }
  return last;
}

export function collectQueryUnits(source: string, file: string): QueryUnit[] {
  const boundaries = findMethodBoundaries(source);
  // Optional trailing comma: every `.prepare(\`sql\`)` call in these files is
  // formatted with a dangling comma before the closing paren.
  const prepareSource = "\\.prepare\\(\\s*`([\\s\\S]*?)`\\s*,?\\s*\\)";

  // Pass 1: count non-WITH ("bare query") prepares per method. A method with
  // exactly one keeps the original bare "(query)" label (every pre-existing
  // EXCLUDED_UNITS key assumes this); a method with more than one needs the
  // per-query disambiguation this pass makes possible (see header note 2).
  const nonWithCountByMethod = new Map<string, number>();
  {
    const counter = new RegExp(prepareSource, "g");
    let mm: RegExpExecArray | null;
    while ((mm = counter.exec(source)) !== null) {
      const methodName = methodNameAt(boundaries, mm.index);
      const cleaned = stripSqlLineComments(mm[1]);
      if (!/^\s*WITH\b/i.test(cleaned)) {
        nonWithCountByMethod.set(
          methodName,
          (nonWithCountByMethod.get(methodName) ?? 0) + 1,
        );
      }
    }
  }

  const units: QueryUnit[] = [];
  const unnamedSeenByMethod = new Map<string, number>();
  const iter = new RegExp(prepareSource, "g");
  let m: RegExpExecArray | null;
  while ((m = iter.exec(source)) !== null) {
    const methodName = methodNameAt(boundaries, m.index);
    const line = lineAt(source, m.index);
    const cleaned = stripSqlLineComments(m[1]);
    const cteUnits = splitCteUnits(cleaned);
    const isBareQuery =
      cteUnits.length === 1 && cteUnits[0].label === "(query)";

    if (!isBareQuery) {
      for (const u of cteUnits) {
        units.push({ file, methodName, unitLabel: u.label, sql: u.body, line });
      }
      continue;
    }

    const totalInMethod = nonWithCountByMethod.get(methodName) ?? 1;
    if (totalInMethod <= 1) {
      units.push({
        file,
        methodName,
        unitLabel: "(query)",
        sql: cteUnits[0].body,
        line,
      });
      continue;
    }

    const methodStart =
      boundaries.find((b) => b.name === methodName)?.index ?? 0;
    const varName = precedingVarName(source, m.index, methodStart);
    if (varName) {
      units.push({
        file,
        methodName,
        unitLabel: varName,
        sql: cteUnits[0].body,
        line,
      });
    } else {
      const seen = (unnamedSeenByMethod.get(methodName) ?? 0) + 1;
      unnamedSeenByMethod.set(methodName, seen);
      units.push({
        file,
        methodName,
        unitLabel: `(query #${seen})`,
        sql: cteUnits[0].body,
        line,
      });
    }
  }
  return units;
}

export function unitKey(u: {
  file: string;
  methodName: string;
  unitLabel: string;
}): string {
  return `${u.file}:${u.methodName}:${u.unitLabel}`;
}

/** Slice of `source` spanning `methodName`'s own body (its boundary to the
 *  next boundary, or EOF). Extracted (LIRA-169) from
 *  `embeddedCommission.guard.test.ts`'s identically-named private helper so
 *  `profitRecognition.guard.test.ts` can share it (rule 14) instead of
 *  pasting a second copy. */
export function methodSourceSlice(
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
 * Split a SELECT-shaped unit's SQL into its top-level (paren-depth-0)
 * comma-separated SELECT-list `columns` and everything from the top-level
 * `FROM` onward (`rest`). Depth-tracked so a comma or the word FROM inside a
 * subquery/CASE/function call never splits early or ends the column list
 * prematurely. Falls back to `{ columns: [sql], rest: "" }` when `sql`
 * doesn't contain a `SELECT` at all.
 *
 * Extracted (LIRA-169) from `embeddedCommission.guard.test.ts`'s
 * identically-named helper — see that file's doc comment for the full
 * worked example (`ProfitRepository.getByUser`'s nested subquery) this
 * depth-tracking exists for. Moved verbatim; no behaviour change.
 */
export function splitSelectShape(sql: string): {
  columns: string[];
  rest: string;
} {
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

/** Bare `${identifier}` interpolations in a unit's SQL text — i.e. a plain
 *  variable reference, NOT a function call (`${someGate(...)}` has a `(`
 *  immediately after the name and is excluded by requiring `}` immediately
 *  after the identifier). Extracted (LIRA-169) from
 *  `embeddedCommission.guard.test.ts`'s identically-named helper. */
export function bareInterpolatedIdentifiers(sql: string): string[] {
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
 * of it) itself resolve to one of `gateFragments`, two layers: (1) direct —
 * `text` literally calls `someGate(`; (2) alias-resolved — `text`
 * interpolates a BARE variable, assigned earlier in `methodSource`, from an
 * expression that itself calls one of `gateFragments`.
 *
 * Generalised (LIRA-169) from `embeddedCommission.guard.test.ts`'s
 * identically-shaped `textIsGated`, parameterised on the caller's own gate
 * fragment list instead of a hardcoded `embeddedCommission`/
 * `atSettlementCommission` pair, so `profitRecognition.guard.test.ts` can
 * reuse the exact same alias-resolution logic for its own, larger
 * `GATE_FRAGMENTS` list (rule 14).
 */
export function textIsGated(
  text: string,
  methodSource: string,
  gateFragments: readonly string[],
): boolean {
  const callRe = new RegExp(`\\b(?:${gateFragments.join("|")})\\(`);
  if (callRe.test(text)) return true;
  for (const name of bareInterpolatedIdentifiers(text)) {
    const assignRe = new RegExp(
      `\\b(?:const|let)\\s+${name}\\s*[:=][^;]*?\\b(?:${gateFragments.join("|")})\\(`,
    );
    if (assignRe.test(methodSource)) return true;
  }
  return false;
}

/**
 * Gate detection for a whole {@link QueryUnit}, at COLUMN granularity — NOT
 * just "does the gate call appear anywhere in this unit's text". The coarser
 * whole-unit check is insufficient: a query with several independent
 * `SUM(CASE ...)` columns, each repeating its OWN copy of the gate inline,
 * reads as "gated" from a surviving SIBLING column's gate call alone even
 * after one column's own copy is stripped — proven in
 * `embeddedCommission.guard.test.ts`'s own history (LIRA-159 D3) and, by the
 * identical mechanism, a live (if latent) hole in
 * `profitRecognition.guard.test.ts` (LIRA-169): `ProfitRepository.getByUser`/
 * `.getByClient`'s `revenue_usd`/`profit_usd`/`profit_lbp` columns are each
 * their own `SUM(CASE ...) AS <col>` block, each independently repeating the
 * gate inline rather than hoisting it once into the outer WHERE.
 *
 * Two ways a column can be gated: (1) a WHERE-clause (`rest` from
 * {@link splitSelectShape}) gate call protects every column uniformly —
 * checked first, short-circuits per-column checking; (2) failing that, EVERY
 * top-level column whose own text matches `tokenRegex` must itself resolve
 * to a gate (inline or alias). A unit with no token-matching column at all
 * falls back to a whole-text check so this function never silently "passes"
 * a unit it can't decompose.
 *
 * Generalised (LIRA-169) from `embeddedCommission.guard.test.ts`'s
 * identically-shaped `isGated`, parameterised on the caller's own
 * token-match regex and gate fragment list.
 */
export function isGatedPerColumn(
  unit: { sql: string },
  methodSource: string,
  tokenRegex: RegExp,
  gateFragments: readonly string[],
): boolean {
  const { columns, rest } = splitSelectShape(unit.sql);
  if (textIsGated(rest, methodSource, gateFragments)) return true;
  const matchingColumns = columns.filter((c) => tokenRegex.test(c));
  if (matchingColumns.length === 0) {
    return textIsGated(unit.sql, methodSource, gateFragments);
  }
  return matchingColumns.every((c) =>
    textIsGated(c, methodSource, gateFragments),
  );
}
