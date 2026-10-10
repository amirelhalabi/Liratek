/**
 * transportParity.mjs — pure rule logic for scripts/check-transport-parity.mjs
 * (LIRA-297, docs/plans/ongoing_plans/TRANSPORT_PARITY_AUDIT_PLAN.md §2).
 *
 * Parses each file with the TypeScript compiler API rather than regex, so a
 * `window.api` inside a comment, a string or plain template text can never
 * produce a hit (and a real access spread over several lines can never hide).
 *
 * Rule A1 — payload per transport (CLAUDE.md rule 22). A ternary or if/else
 *   whose TEST is a transport check (`window.api` in any form, or a call to
 *   `isElectron()`) and whose BOTH branches contain an object literal. The
 *   object literals are searched for anywhere in each branch's subtree —
 *   the original Settle Debt bug had them as call ARGUMENTS
 *   (`window.api ? await ipc({…}) : await http({…})`) — except inside JSX
 *   (style/handler props are not payloads) and nested function bodies.
 *   An `if` with no `else` is left to C1. A deliberate exception carries a
 *   reasoned `// transport-parity-exempt: <why>` comment on the line of, or
 *   the line above, the conditional.
 *
 * Rule C1 — any `window.api` access (bare truthiness, optional chain, raw
 *   call, `window.api!`, `(window as any).api`, `window["api"]`). Each hit is
 *   reported with the `window.api.<namespace>` it reaches (`(bare)` for a
 *   truthiness check), and is allowed only by an allowlist entry for that
 *   file that names that namespace.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Loaded via require so a missing `typescript` throws immediately and the
// CLI exits non-zero (rule 28a: a guard that cannot run must not "pass").
const ts = require("typescript");

/** Files (relative to frontend/src, posix separators) never scanned. */
export const EXCLUDED_FILES = new Set([
  "api/backendApi.ts", // the dual-mode adapter: the ONE place a transport may be branched on
  "api/ElectronApiAdapter.ts",
  "types/electron.d.ts",
]);

export const EXEMPT_MARKER = /transport-parity-exempt:\s*\S/;

/** Whether a path relative to the scan root is in scope for both rules. */
export function isScannedPath(rel) {
  const p = rel.split("\\").join("/");
  if (!/\.(ts|tsx)$/.test(p) || p.endsWith(".d.ts")) return false;
  if (EXCLUDED_FILES.has(p)) return false;
  if (/(^|\/)(__tests__|__mocks__)\//.test(p)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(p)) return false;
  return true;
}

function unwrap(node) {
  let n = node;
  while (
    n &&
    (ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)))
  ) {
    n = n.expression;
  }
  return n;
}

/** Is `node` itself the expression `window.api` (any spelling)? */
function isWindowApi(node) {
  if (ts.isPropertyAccessExpression(node)) {
    const recv = unwrap(node.expression);
    return (
      node.name.text === "api" &&
      ts.isIdentifier(recv) &&
      recv.text === "window"
    );
  }
  if (ts.isElementAccessExpression(node)) {
    const recv = unwrap(node.expression);
    const arg = node.argumentExpression;
    return (
      ts.isIdentifier(recv) &&
      recv.text === "window" &&
      !!arg &&
      (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
      arg.text === "api"
    );
  }
  return false;
}

function isIsElectronCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(node.expression);
  if (ts.isIdentifier(callee)) return callee.text === "isElectron";
  if (ts.isPropertyAccessExpression(callee))
    return callee.name.text === "isElectron";
  return false;
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isJsx(node) {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

/** Depth-first search that does not enter nested functions (or JSX if asked). */
function someDescendant(root, pred, { skipJsx = false } = {}) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (isFunctionLike(n)) return;
    if (skipJsx && isJsx(n)) return;
    if (pred(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function isTransportTest(expr) {
  return someDescendant(expr, (n) => isWindowApi(n) || isIsElectronCall(n));
}

function hasObjectLiteral(branch) {
  return someDescendant(branch, (n) => ts.isObjectLiteralExpression(n), {
    skipJsx: true,
  });
}

/** The `window.api.<namespace>` an access reaches, or "(bare)". */
function namespaceOf(apiNode) {
  let cur = apiNode;
  let parent = cur.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isAsExpression(parent)) &&
    parent.expression === cur
  ) {
    cur = parent;
    parent = cur.parent;
  }
  if (
    parent &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === cur
  )
    return parent.name.text;
  if (
    parent &&
    ts.isElementAccessExpression(parent) &&
    parent.expression === cur &&
    parent.argumentExpression &&
    ts.isStringLiteralLike(parent.argumentExpression)
  )
    return parent.argumentExpression.text;
  return "(bare)";
}

/** Line numbers (1-based) of comments carrying a reasoned exempt marker. */
function exemptLines(sf, text) {
  const lines = new Set();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    sf.languageVariant,
    text,
  );
  for (
    let k = scanner.scan();
    k !== ts.SyntaxKind.EndOfFileToken;
    k = scanner.scan()
  ) {
    if (
      k === ts.SyntaxKind.SingleLineCommentTrivia ||
      k === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      if (EXEMPT_MARKER.test(scanner.getTokenText())) {
        const { line } = sf.getLineAndCharacterOfPosition(
          scanner.getTokenPos(),
        );
        lines.add(line + 1);
      }
    }
  }
  return lines;
}

function snippetAt(text, sf, node) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return (text.split(/\r?\n/)[line] ?? "").trim().slice(0, 120);
}

/**
 * Analyse one source file.
 * @returns {{a1: Array<{line:number,kind:"ternary"|"if",snippet:string}>,
 *            a1Exempt: Array<{line:number,kind:string,snippet:string}>,
 *            c1: Array<{line:number,namespace:string,snippet:string}>}}
 */
export function analyzeSource(fileName, text) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const exempt = exemptLines(sf, text);
  const a1 = [];
  const a1Exempt = [];
  const c1 = [];
  const lineOf = (n) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node) => {
    let test = null;
    let branches = null;
    let k = null;
    if (ts.isConditionalExpression(node)) {
      test = node.condition;
      branches = [node.whenTrue, node.whenFalse];
      k = "ternary";
    } else if (ts.isIfStatement(node) && node.elseStatement) {
      test = node.expression;
      branches = [node.thenStatement, node.elseStatement];
      k = "if";
    }
    if (test && isTransportTest(test) && branches.every(hasObjectLiteral)) {
      const line = lineOf(node);
      const hit = { line, kind: k, snippet: snippetAt(text, sf, node) };
      if (exempt.has(line) || exempt.has(line - 1)) a1Exempt.push(hit);
      else a1.push(hit);
    }

    if (isWindowApi(node)) {
      c1.push({
        line: lineOf(node),
        namespace: namespaceOf(node),
        snippet: snippetAt(text, sf, node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { a1, a1Exempt, c1 };
}

/** Structural problems in the allowlist (empty array = valid). */
export function validateAllowlist(entries) {
  const errors = [];
  if (!Array.isArray(entries)) return ["allowlist must be a JSON array"];
  const seen = new Set();
  entries.forEach((e, i) => {
    const at = `entry ${i} (${e && e.file})`;
    if (!e || typeof e.file !== "string" || !e.file) {
      errors.push(`${at}: missing "file"`);
      return;
    }
    if (seen.has(e.file))
      errors.push(`${at}: duplicate file — merge the entries`);
    seen.add(e.file);
    if (typeof e.reason !== "string" || !e.reason.trim())
      errors.push(
        `${at}: missing "reason" — every entry is a reviewed decision`,
      );
    if (
      !Array.isArray(e.namespaces) ||
      e.namespaces.length === 0 ||
      e.namespaces.some((n) => typeof n !== "string" || !n)
    )
      errors.push(
        `${at}: "namespaces" must be a non-empty array of window.api namespaces`,
      );
    if (e.temporary !== undefined && typeof e.temporary !== "boolean")
      errors.push(`${at}: "temporary" must be a boolean`);
  });
  return errors;
}

/**
 * Match C1 hits against the allowlist.
 * @param {Map<string, Array<{line:number,namespace:string,snippet:string}>>} hitsByFile
 * @param {Array<{file:string,namespaces:string[],reason:string,temporary?:boolean}>} allowlist
 */
export function applyAllowlist(hitsByFile, allowlist) {
  const byFile = new Map(allowlist.map((e) => [e.file, e]));
  const used = new Map(allowlist.map((e) => [e.file, new Set()]));
  const violations = [];
  let allowed = 0;
  for (const [file, hits] of hitsByFile) {
    const entry = byFile.get(file);
    for (const h of hits) {
      if (entry && entry.namespaces.includes(h.namespace)) {
        allowed++;
        used.get(file).add(h.namespace);
      } else {
        violations.push({ file, ...h, listed: !!entry });
      }
    }
  }
  const stale = [];
  for (const e of allowlist) {
    for (const ns of e.namespaces) {
      if (!used.get(e.file).has(ns))
        stale.push({ file: e.file, namespace: ns });
    }
  }
  return { violations, allowed, stale };
}
