#!/usr/bin/env node
/**
 * check-tenant-scoping.mjs
 *
 * WP1a static safety net for the multi-tenant retrofit
 * (see docs/plans/WEBAPP_MULTI_TENANT_PLAN.md).
 *
 * Scans, by default, three roots for SQL statement sites and flags every
 * statement that touches a tenant-scoped table without referencing
 * `tenant_id`:
 *   - packages/core/src/repositories/**\/*.ts — the primary DB access layer.
 *   - packages/core/src/services/**\/*.ts — services are supposed to be
 *     repository-only (see CLAUDE.md rule 13), but a handful of legacy
 *     violations (ProfitService, SessionPaymentService, ActivityService) do
 *     run raw SQL directly, so this must be covered too.
 *   - backend/src/**\/*.ts — the web-reachable Express layer. This is the
 *     layer a security review found blind: `backend/src/api/health.ts` ran
 *     a raw, unscoped cross-tenant aggregate (`COUNT(*) FROM clients` etc.)
 *     behind an UNAUTHENTICATED route, and the checker — scoped to
 *     repositories/ only — never saw it. Covering backend/src closes that
 *     gap for every other route file, middleware, and the DB bootstrap code.
 *
 * Deliberately NOT scanned: electron-app/handlers/. Those IPC handlers run
 * only inside the Electron main process under `initFixedTenantContext(1)` —
 * a fixed, single-tenant context, process-isolated from the web backend and
 * never reachable in multi-tenant (web) mode. Scanning them would flood the
 * gate with statements that are real SQL but not a multi-tenant risk,
 * drowning out genuine web-reachable violations.
 *
 * A "statement site" is any of:
 *   - a raw `.prepare(` call (the dominant pattern), or
 *   - BaseRepository's protected raw-SQL helpers: `this.query(...)`,
 *     `this.queryOne(...)`, `this.execute(...)` — including their generic
 *     call forms `this.queryOne<UserEntity>(query, username)`. Some
 *     repositories (UserRepository, SessionRepository) never call
 *     `.prepare(` directly and route ALL their SQL through these helpers,
 *     so scanning `.prepare(` alone leaves them a total blind spot.
 *
 * This is a FAIL-CLOSED, best-effort static linter — plain Node.js stdlib
 * only (no parser, no deps, so it can run before `yarn install` finishes).
 * It is intentionally happy to over-match (flag SQL that turns out fine on
 * closer look) but must never silently swallow a statement that genuinely
 * touches a tenant-scoped table. Where the SQL text can't be statically
 * resolved with confidence (e.g. dynamic SQL built through several lines of
 * string concatenation, or a table name substituted from a class field),
 * it resolves as literally as it can and documents the gap rather than
 * guessing — see `resolveIdentifier` / `buildFieldMap` below.
 *
 * Modes:
 *   node scripts/check-tenant-scoping.mjs              full report; exit 1 if violations > 0
 *   node scripts/check-tenant-scoping.mjs --stats       summary only; always exit 0
 *   node scripts/check-tenant-scoping.mjs --json        machine-readable JSON to stdout only
 *   node scripts/check-tenant-scoping.mjs --dir <path>  override the scan root (for tests)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Default scan roots (no --dir override) — see the file-level doc comment
// for why each is included and why electron-app/handlers/ is excluded.
const DEFAULT_SCAN_ROOTS = [
  path.join(REPO_ROOT, "packages", "core", "src", "repositories"),
  path.join(REPO_ROOT, "packages", "core", "src", "services"),
  path.join(REPO_ROOT, "backend", "src"),
];

// ---------------------------------------------------------------------------
// Tenant-scoped table list.
//
// MUST STAY IN SYNC with docs/plans/WEBAPP_MULTI_TENANT_PLAN.md — any table
// that receives a `tenant_id` column in the retrofit migration belongs here.
// ---------------------------------------------------------------------------
const TENANT_SCOPED_TABLES = [
  "transactions",
  "clients",
  "suppliers",
  "products",
  "product_categories",
  "product_suppliers",
  "sales",
  "sale_items",
  "debt_ledger",
  "customer_sessions",
  "customer_session_transactions",
  "session_cart_items",
  "supplier_ledger",
  "supplier_purchases",
  "maintenance",
  "expenses",
  "recharges",
  "exchange_transactions",
  "financial_services",
  "partners",
  "partner_ledger",
  "custom_services",
  "item_costs",
  "voucher_images",
  "mobile_service_items",
  "payments",
  "drawer_topups",
  "daily_closings",
  "daily_closing_amounts",
  "vouchers",
  "loto_tickets",
  "loto_monthly_fees",
  "loto_checkpoints",
  "loto_cash_prizes",
  "loto_settlements",
  "hold_money",
  "audit_log",
  "system_settings",
  "users",
  "sessions",
  "currencies",
  "exchange_rates",
  "service_presets",
  "drawer_balances",
  "modules",
  "currency_modules",
  "currency_drawers",
  "payment_methods",
  "loto_settings",
];

// Explicitly never flagged, even if referenced.
const NON_TENANT_TABLES = new Set([
  "schema_migrations",
  "tenants",
  "sync_queue",
  "sync_errors",
  "sqlite_sequence",
  "sqlite_master",
]);

const TENANT_TABLE_SET = new Set(TENANT_SCOPED_TABLES);

// Filename skipped wholesale — see the long comment above `scanRepositories()`.
const SKIP_FILENAMES = new Set(["BaseRepository.ts"]);

const EXEMPT_RE = /\/\*\s*tenant-exempt\s*:[^*]*\*\//i;
const TENANT_ID_RE = /tenant_id/i;

// Substituted for every template interpolation that cannot be statically
// resolved. Word-characters only, so SQL-identifier regexes still match it:
// when it lands in table position the statement is flagged fail-closed.
const UNRESOLVED_TOKEN = "__UNRESOLVED__";
const UNRESOLVED_TOKEN_LC = UNRESOLVED_TOKEN.toLowerCase();

// Matches FROM / JOIN / INTO ("INSERT INTO", "REPLACE INTO") / UPDATE,
// tolerating "UPDATE OR IGNORE"-style SQLite conflict clauses, then captures
// the immediately following identifier (the table name; any alias that
// follows is deliberately NOT captured).
const TABLE_REF_RE =
  /\b(?:FROM|JOIN|INTO|UPDATE)\b\s+(?:OR\s+(?:IGNORE|REPLACE|ROLLBACK|ABORT|FAIL)\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;

// =============================================================================
// Minimal JS/TS tokenizer
//
// We do not have a real parser available (pure stdlib, zero deps). This
// tokenizer is just good enough to tell "code" apart from string/template
// literals and comments, so we can (a) find genuine `.prepare(` call sites
// without tripping on one written inside a comment or a log string, and
// (b) know where a template literal / string argument actually ends despite
// containing parens, commas, or `${ ... }` interpolation.
// =============================================================================

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      tokens.push({ type: "comment", start: i, end: j });
      i = j;
    } else if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      tokens.push({ type: "comment", start: i, end: j });
      i = j;
    } else if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      tokens.push({ type: "string", start: i, end: j });
      i = j;
    } else if (c === "`") {
      let j = i + 1;
      let exprDepth = 0;
      while (j < n) {
        const cj = src[j];
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (exprDepth === 0 && cj === "`") {
          j++;
          break;
        }
        if (exprDepth === 0 && cj === "$" && src[j + 1] === "{") {
          exprDepth = 1;
          j += 2;
          continue;
        }
        if (exprDepth > 0) {
          if (cj === "{") exprDepth++;
          else if (cj === "}") exprDepth--;
          else if (cj === '"' || cj === "'") {
            const q = cj;
            j++;
            while (j < n && src[j] !== q) {
              if (src[j] === "\\") j++;
              j++;
            }
          } else if (cj === "`") {
            j++;
            while (j < n && src[j] !== "`") {
              if (src[j] === "\\") j++;
              j++;
            }
          }
          j++;
          continue;
        }
        j++;
      }
      tokens.push({ type: "template", start: i, end: j });
      i = j;
    } else {
      let j = i + 1;
      while (j < n && !'/"\'`'.includes(src[j])) j++;
      tokens.push({ type: "code", start: i, end: j });
      i = j;
    }
  }
  return tokens;
}

/** Blank out every non-code token (comments/strings/templates) while preserving
 * newlines and string length, so absolute offsets stay valid for line-number
 * lookups and we can safely substring-search for `.prepare(` in "real code" only. */
function maskNonCode(src, tokens) {
  const chars = src.split("");
  for (const t of tokens) {
    if (t.type !== "code") {
      for (let k = t.start; k < t.end; k++) {
        if (chars[k] !== "\n") chars[k] = " ";
      }
    }
  }
  return chars.join("");
}

/** First top-level `;` found inside a "code" token region of `slice`. */
function findTerminator(slice) {
  const tokens = tokenize(slice);
  for (const t of tokens) {
    if (t.type === "code") {
      for (let k = t.start; k < t.end; k++) {
        if (slice[k] === ";") return k;
      }
    }
  }
  return slice.length;
}

/**
 * Given the index right after a `.prepare(`'s opening paren, extract the
 * source text of the first argument, respecting nested parens and treating
 * string/template/comment tokens as atomic (a paren or comma inside a SQL
 * template literal must not be mistaken for the call's own punctuation).
 */
function extractArgument(src, argStart) {
  const slice = src.slice(argStart);
  const tokens = tokenize(slice);
  let depth = 1;
  let endLocal = slice.length;
  for (const t of tokens) {
    if (t.type !== "code") continue;
    let stop = false;
    for (let k = t.start; k < t.end; k++) {
      const ch = slice[k];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          endLocal = k;
          stop = true;
          break;
        }
      } else if (ch === "," && depth === 1) {
        endLocal = k;
        stop = true;
        break;
      }
    }
    if (stop) break;
  }
  return slice.slice(0, endLocal);
}

/**
 * Pull the literal text out of an arbitrary JS expression: concatenates the
 * contents of every string/template literal found in it (ignoring bare
 * identifiers, operators, etc. — best-effort, per the task brief). Inside a
 * template's `${ ... }` interpolations, `this.<field>` is substituted with a
 * statically-known literal value from `fieldMap` when available (see
 * `buildFieldMap`); anything else is blanked to a single space.
 */
function extractLiteralText(exprText, fieldMap) {
  const tokens = tokenize(exprText);
  const parts = [];
  for (const t of tokens) {
    if (t.type === "string") {
      parts.push(exprText.slice(t.start + 1, t.end - 1));
    } else if (t.type === "template") {
      let raw = exprText.slice(t.start + 1, t.end - 1);
      raw = raw.replace(
        /\$\{\s*this\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\}/g,
        (_whole, fname) =>
          fieldMap && fieldMap[fname] ? fieldMap[fname] : UNRESOLVED_TOKEN,
      );
      // Bare-identifier interpolation, e.g. `` `UPDATE ${tableName} SET ...` ``
      // where `const tableName = this.tableName;` aliases the class field
      // (SalesRepository does exactly this). Reuse the same fieldMap keyed
      // by field name — safe because it only changes output when the
      // identifier happens to collide with a known field name.
      raw = raw.replace(
        /\$\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}/g,
        (_whole, name) =>
          fieldMap && fieldMap[name] ? fieldMap[name] : UNRESOLVED_TOKEN,
      );
      // Fallback for any remaining interpolation, e.g. `${this.getColumns()}`
      // in SELECT column-list position — doesn't handle nested braces, which
      // is fine since those don't occur in the simple column/table
      // interpolations this codebase uses.
      //
      // Every unresolvable interpolation is replaced with UNRESOLVED_TOKEN
      // rather than blanked: if the token then lands in TABLE POSITION
      // (right after FROM/JOIN/INTO/UPDATE), the table is unknown at lint
      // time and the statement is flagged fail-closed (see scanFile). A
      // blank there silently dropped real violations — caught live on
      // TransactionRepository._markSourceRefunded, which does
      // `UPDATE ${sourceTable} SET is_refunded = ...` with a runtime
      // parameter whose every possible value is a tenant-scoped table.
      // In non-table positions (column lists, WHERE fragments) the token is
      // harmless noise, exactly like the blank was.
      raw = raw.replace(/\$\{[^}]*\}/g, UNRESOLVED_TOKEN);
      parts.push(raw);
    }
  }
  return parts.join(" ");
}

/**
 * Best-effort resolution of `.prepare(someVariable)` where the argument is a
 * bare identifier rather than an inline literal (the dynamic filter-builder
 * pattern used by e.g. CurrencyRepository/FinancialServiceRepository:
 *   let query = `SELECT ... FROM foo`;
 *   if (x) query += ` AND ...`;
 *   ...
 *   return this.db.prepare(query)...
 *
 * We find the nearest preceding plain assignment (`const/let/var IDENT =` or
 * `this.IDENT =`) before the call site — in this codebase's style that is
 * reliably the real declaration for this call, shadowing across nested
 * functions of the same name being rare — then concatenate every subsequent
 * `IDENT +=` up to the call site. Returns null if no assignment is found at
 * all (fully unresolved).
 */
function resolveIdentifier(src, ident, beforeIdx, fieldMap) {
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // (?<![.\w$])  — don't let `query` match inside `subquery =` or `obj.query =`
  // (?![=>])     — reject `==` comparisons and `=>` arrow functions
  const re = new RegExp(`(?<![.\\w$])${escaped}\\s*(\\+=|=)(?![=>])`, "g");
  const matches = [];
  let m;
  while ((m = re.exec(src))) {
    if (m.index >= beforeIdx) break;
    matches.push({ index: m.index, opEnd: m.index + m[0].length, op: m[1] });
  }
  if (matches.length === 0) return null;

  let declStart = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].op === "=") {
      declStart = i;
      break;
    }
  }
  const relevant = matches.slice(declStart);
  const parts = [];
  for (const mm of relevant) {
    const rhsSlice = src.slice(mm.opEnd);
    const rhsText = rhsSlice.slice(0, findTerminator(rhsSlice));
    parts.push(extractLiteralText(rhsText, fieldMap));
  }
  return parts.join(" ");
}

function isBareIdentifier(text) {
  return /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(text.trim());
}

/**
 * Resolve the reconstructed SQL text for one statement-site argument.
 * Returns `{ sql, unresolvedArg }`: `unresolvedArg` is true when the
 * argument is a bare identifier whose SQL could not be traced to any
 * assignment (e.g. a function parameter). Such statements are flagged
 * fail-closed by scanFile — "can't see the SQL" must never mean "passes".
 */
function resolveStatementSql(src, argText, callSiteIdx, fieldMap) {
  const trimmed = argText.trim();
  if (trimmed.length > 0 && isBareIdentifier(trimmed)) {
    const resolved = resolveIdentifier(src, trimmed, callSiteIdx, fieldMap);
    return resolved === null
      ? { sql: "", unresolvedArg: true }
      : { sql: resolved, unresolvedArg: false };
  }
  return { sql: extractLiteralText(argText, fieldMap), unresolvedArg: false };
}

/**
 * Scan a repository file for `this.<field> = "literal"` (constructor) and
 * `field = "literal"` (class-property initializer) assignments, so that
 * template interpolations like `` `DELETE FROM ${this.tableName}` `` can be
 * resolved to the real table name (e.g. CustomerSessionRepository sets
 * `private tableName = "customer_sessions"` as a class field).
 *
 * Also handles the dominant pattern in this codebase: subclasses of
 * BaseRepository never assign `this.tableName` themselves — they pass the
 * table name as the first argument to `super(...)` in their constructor,
 * e.g. `super("sales", { softDelete: false })`, and BaseRepository's own
 * constructor stores it as `this.tableName`. Statements that build SQL via
 * `` `UPDATE ${this.tableName} SET ...` `` (or a local `const tableName =
 * this.tableName` alias — see SalesRepository) are extremely common and
 * would otherwise silently lose their table name, which is a fail-OPEN bug
 * for a linter that must fail closed. So: `super("literal", ...)` seeds
 * `tableName` in the map unless the file already defines `this.tableName`
 * itself (that assignment always wins as more specific).
 */
function buildFieldMap(src) {
  const map = {};
  const fieldRe =
    /(?:private|protected|public)?\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=;]+)?=\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*;/g;
  let m;
  while ((m = fieldRe.exec(src))) {
    map[m[1]] = m[2];
  }
  const thisRe =
    /this\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*;/g;
  while ((m = thisRe.exec(src))) {
    map[m[1]] = m[2];
  }
  if (!map.tableName) {
    const superRe = /super\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/;
    const sm = src.match(superRe);
    if (sm) map.tableName = sm[1];
  }
  return map;
}

function extractTables(sqlText) {
  const found = new Set();
  TABLE_REF_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_REF_RE.exec(sqlText))) {
    found.add(m[1].toLowerCase());
  }
  return found;
}

function lineOf(src, idx) {
  let count = 1;
  for (let i = 0; i < idx; i++) {
    if (src[i] === "\n") count++;
  }
  return count;
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

// =============================================================================
// File discovery
// =============================================================================

function walkFiles(root, exts) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
      } else if (entry.isFile()) {
        if (exts.some((e) => entry.name.endsWith(e))) results.push(full);
      }
    }
  }
  walk(root);
  return results;
}

/**
 * Collect the repository source files to scan.
 *
 * BaseRepository.ts is deliberately excluded: its generic CRUD methods build
 * SQL as `` `SELECT ... FROM ${this.tableName} ...` `` where `tableName` is a
 * constructor parameter supplied independently by ~40 different subclasses.
 * There is no single static value to resolve inside BaseRepository.ts itself,
 * so scanning it here would either produce ~14 permanently-unresolvable
 * "unknown table" entries or (worse) silently pass because no table name is
 * ever spotted. The multi-tenant plan handles this correctly by scoping
 * BaseRepository centrally in WP1b (e.g. requiring/injecting tenant_id at
 * that one choke point) rather than statement-by-statement here.
 */
function collectRepositoryFiles(root) {
  const all = walkFiles(root, [".ts"]);
  const files = [];
  const skipped = [];
  for (const f of all) {
    const base = path.basename(f);
    if (base.endsWith(".d.ts")) continue;
    if (base.endsWith(".test.ts")) continue;
    if (base === "index.ts") continue;
    if (SKIP_FILENAMES.has(base)) {
      skipped.push(f);
      continue;
    }
    files.push(f);
  }
  return { files, skipped };
}

// =============================================================================
// Core scan
// =============================================================================

/**
 * Find every SQL statement site in the masked source. Two kinds:
 *
 *   1. `.prepare(` — direct better-sqlite3 usage (dominant pattern).
 *   2. `this.query(` / `this.queryOne(` / `this.execute(` — BaseRepository's
 *      protected raw-SQL helpers. UserRepository and SessionRepository route
 *      ALL their SQL through these and never call `.prepare(` directly, so
 *      missing them is a total blind spot (fail-open), not an approximation.
 *      Handles generic call forms too: `this.queryOne<UserEntity>(q, ...)`,
 *      including nested generics/braces (`<{ count: number }>`), by
 *      angle-bracket depth counting between the helper name and the `(`.
 *
 * Matching runs on the MASKED source (strings/comments blanked), so a
 * `.prepare(` inside a comment or log message never counts. Returns
 * `{ idx, openParenIdx }` pairs deduped by `openParenIdx` — dedup guards
 * against any two patterns ever claiming the same call's argument (each
 * distinct call site is still one statement even when its SQL variable is
 * shared with another call site elsewhere; those are separate executions
 * and are counted separately on purpose).
 */
function findCallSites(masked) {
  const sites = [];
  const re = /\.prepare\s*\(|this\.(queryOne|query|execute)\b/g;
  let m;
  while ((m = re.exec(masked))) {
    let openParenIdx;
    if (m[1] === undefined) {
      // `.prepare(` alternative — the regex already consumed the paren.
      openParenIdx = m.index + m[0].length - 1;
    } else {
      // Helper alternative — skip optional generics, then require `(`.
      let j = m.index + m[0].length;
      while (j < masked.length && /\s/.test(masked[j])) j++;
      if (masked[j] === "<") {
        let depth = 1;
        j++;
        while (j < masked.length && depth > 0) {
          if (masked[j] === "<") depth++;
          else if (masked[j] === ">") depth--;
          j++;
        }
        while (j < masked.length && /\s/.test(masked[j])) j++;
      }
      if (masked[j] !== "(") continue; // property reference, not a call
      openParenIdx = j;
    }
    sites.push({ idx: m.index, openParenIdx });
  }
  const seen = new Set();
  return sites.filter(
    (s) => !seen.has(s.openParenIdx) && (seen.add(s.openParenIdx), true),
  );
}

function scanFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const tokens = tokenize(src);
  const masked = maskNonCode(src, tokens);
  const fieldMap = buildFieldMap(src);
  const lines = src.split("\n");

  const statements = [];
  for (const site of findCallSites(masked)) {
    const { idx, openParenIdx } = site;
    const argStart = openParenIdx + 1;
    const argText = extractArgument(src, argStart);
    const { sql, unresolvedArg } = resolveStatementSql(src, argText, idx, fieldMap);
    const lineNum = lineOf(src, idx);

    const tables = extractTables(sql);
    // Fail-closed: an UNRESOLVED_TOKEN in table position means the table is
    // decided at runtime (e.g. `UPDATE ${sourceTable} ...`) — it MIGHT be a
    // tenant-scoped table, so the statement must justify itself with
    // tenant_id or an exemption comment like any other.
    const unresolvedTable = [...tables].some((t) =>
      t.includes(UNRESOLVED_TOKEN_LC),
    );
    const tenantHits = [...tables].filter((t) => TENANT_TABLE_SET.has(t)).sort();
    if (unresolvedTable || unresolvedArg) tenantHits.push("<unresolved>");
    // (NON_TENANT_TABLES is informational only — anything not in
    // TENANT_TABLE_SET, including these, is simply never flagged.)

    let reason;
    if (tenantHits.length === 0) {
      reason = "not-applicable";
    } else {
      const hay = `${sql} ${argText}`;
      const hasTenantId = TENANT_ID_RE.test(hay);
      const precedingLines = lines.slice(Math.max(0, lineNum - 4), lineNum - 1);
      const hasExempt = EXEMPT_RE.test(hay) || precedingLines.some((l) => EXEMPT_RE.test(l));
      if (hasExempt) reason = "exempt";
      else if (hasTenantId) reason = "ok";
      else reason = "violation";
    }

    statements.push({
      line: lineNum,
      sql: unresolvedArg
        ? `(unresolved SQL variable '${collapse(argText)}')`
        : collapse(sql || argText),
      tables: tenantHits,
      reason,
    });
  }
  return statements;
}

function scanRepositories(root) {
  const { files, skipped } = collectRepositoryFiles(root);
  const perFile = [];
  let totalStatements = 0;
  let totalViolations = 0;
  let totalExempt = 0;

  for (const file of files) {
    const statements = scanFile(file);
    const violations = statements.filter((s) => s.reason === "violation");
    const exempt = statements.filter((s) => s.reason === "exempt");
    totalStatements += statements.length;
    totalViolations += violations.length;
    totalExempt += exempt.length;
    perFile.push({
      file: path.relative(REPO_ROOT, file),
      statements,
      violationCount: violations.length,
      exemptCount: exempt.length,
      statementCount: statements.length,
    });
  }

  perFile.sort((a, b) => b.violationCount - a.violationCount || b.statementCount - a.statementCount);

  return {
    perFile,
    skipped: skipped.map((f) => path.relative(REPO_ROOT, f)),
    totals: {
      files: files.length,
      statements: totalStatements,
      violations: totalViolations,
      exempt: totalExempt,
    },
  };
}

/**
 * Scan several roots and merge into one report, as if they were a single
 * tree (`main()`'s default: repositories/ + services/ + backend/src — see
 * the file-level doc comment for why each is included and why
 * electron-app/handlers/ is deliberately excluded). Dedupes by absolute file
 * path in case two configured roots ever nest inside one another.
 */
function scanMultipleRoots(roots) {
  const perFile = [];
  const skipped = [];
  const seenFiles = new Set();
  let totalFiles = 0;
  let totalStatements = 0;
  let totalViolations = 0;
  let totalExempt = 0;

  for (const root of roots) {
    const result = scanRepositories(root);
    for (const f of result.perFile) {
      const abs = path.resolve(REPO_ROOT, f.file);
      if (seenFiles.has(abs)) continue;
      seenFiles.add(abs);
      perFile.push(f);
      totalFiles += 1;
      totalStatements += f.statementCount;
      totalViolations += f.violationCount;
      totalExempt += f.exemptCount;
    }
    skipped.push(...result.skipped);
  }

  perFile.sort((a, b) => b.violationCount - a.violationCount || b.statementCount - a.statementCount);

  return {
    perFile,
    skipped,
    totals: {
      files: totalFiles,
      statements: totalStatements,
      violations: totalViolations,
      exempt: totalExempt,
    },
  };
}

// =============================================================================
// `runWithoutTenant(` informational scan
// =============================================================================

function scanRunWithoutTenant() {
  const dirs = [
    path.join(REPO_ROOT, "packages", "core", "src"),
    path.join(REPO_ROOT, "backend", "src"),
  ];
  const hits = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir, [".ts", ".tsx", ".js", ".mjs"]);
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Mask comments/strings first: `runWithoutTenant(` is discussed at
      // length in tenantContext.ts doc comments, and a mention is not a call
      // site. Report the ORIGINAL line text for context, but match against
      // the masked code only. (maskNonCode preserves newlines, so line
      // splits stay aligned between the two.)
      const masked = maskNonCode(src, tokenize(src));
      const srcLines = src.split("\n");
      masked.split("\n").forEach((l, i) => {
        if (/function\s+runWithoutTenant\s*\(/.test(l)) return; // its own definition
        if (l.includes("runWithoutTenant(")) {
          hits.push({
            file: path.relative(REPO_ROOT, file),
            line: i + 1,
            snippet: collapse(srcLines[i]).slice(0, 100),
          });
        }
      });
    }
  }
  return hits;
}

// =============================================================================
// CLI / reporting
// =============================================================================

function parseArgs(argv) {
  const opts = { stats: false, json: false, dir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stats") opts.stats = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`check-tenant-scoping.mjs — static tenant_id scoping linter

Usage:
  node scripts/check-tenant-scoping.mjs              full report; exit 1 if violations > 0
  node scripts/check-tenant-scoping.mjs --stats       summary only; always exit 0
  node scripts/check-tenant-scoping.mjs --json        machine-readable JSON to stdout only
  node scripts/check-tenant-scoping.mjs --dir <path>  override the scan root (for tests)
`);
}

function printFullReport(result, runWithoutTenantHits) {
  for (const f of result.perFile) {
    const violations = f.statements.filter((s) => s.reason === "violation");
    if (violations.length === 0) continue;
    for (const v of violations) {
      console.log(`${f.file}:${v.line}  ${v.sql.slice(0, 80)}`);
    }
  }
  console.log("");
  printSummary(result, runWithoutTenantHits);
}

function printSummary(result, runWithoutTenantHits) {
  if (result.skipped.length > 0) {
    console.log("Skipped (generic CRUD, scoped centrally in WP1b):");
    for (const s of result.skipped) console.log(`  - ${s}`);
    console.log("");
  }

  console.log("Violations per repository file (top 15):");
  const withActivity = result.perFile.filter((f) => f.statementCount > 0);
  const header = "  " + "file".padEnd(45) + "statements".padStart(11) + "violations".padStart(12) + "exempt".padStart(9);
  console.log(header);
  for (const f of withActivity.slice(0, 15)) {
    console.log(
      "  " +
        f.file.padEnd(45) +
        String(f.statementCount).padStart(11) +
        String(f.violationCount).padStart(12) +
        String(f.exemptCount).padStart(9),
    );
  }
  console.log("");
  console.log(
    `TOTAL — files scanned: ${result.totals.files}, statements: ${result.totals.statements}, ` +
      `violations: ${result.totals.violations}, exempt: ${result.totals.exempt}`,
  );

  console.log("");
  console.log(`runWithoutTenant( call sites (informational): ${runWithoutTenantHits.length}`);
  for (const hit of runWithoutTenantHits.slice(0, 25)) {
    console.log(`  ${hit.file}:${hit.line}  ${hit.snippet}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // `--dir` overrides with a single root (test/debug convenience); the
  // default scans all three of DEFAULT_SCAN_ROOTS merged into one report.
  const result = opts.dir
    ? scanRepositories(path.resolve(process.cwd(), opts.dir))
    : scanMultipleRoots(DEFAULT_SCAN_ROOTS);
  const runWithoutTenantHits = scanRunWithoutTenant();

  if (opts.json) {
    const json = {
      files: result.perFile.map((f) => ({
        file: f.file,
        violations: f.statements
          .filter((s) => s.reason === "violation")
          .map((s) => ({ line: s.line, sql: s.sql })),
        exempt: f.exemptCount,
        statementCount: f.statementCount,
      })),
      skipped: result.skipped,
      runWithoutTenant: runWithoutTenantHits,
      totals: result.totals,
    };
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  } else if (opts.stats) {
    printSummary(result, runWithoutTenantHits);
  } else {
    printFullReport(result, runWithoutTenantHits);
  }

  // NOTE: use process.exitCode (let the event loop drain naturally) rather than
  // process.exit() here. process.exit() truncates stdout when it's a pipe and
  // the write is large enough to not fit in one syscall (observed firsthand:
  // --json on the full repo, ~65KB, silently cut off mid-string under `| node -e`).
  process.exitCode = opts.stats ? 0 : result.totals.violations > 0 ? 1 : 0;
}

main();
