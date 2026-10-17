/**
 * LIRA-331 — rule logic for scripts/check-i18n.mjs (contracts/i18n-catalog.md).
 * Pure functions: no file system. Unit-tested by
 * scripts/__tests__/i18nGuard.test.mjs.
 *
 *   G1  hard-coded Latin-letter UI text
 *   G2  physical direction classes / inline styles
 *   G3  machine-locale formatting (toLocale*, Intl.NumberFormat/DateTimeFormat)
 *   G4  en/ar catalog key or {{placeholder}} mismatch
 *   G5  an Arabic value containing a forbidden glossary variant
 * (G6/G7 are file-system checks in the runner.)
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/** JSX props whose literal value is user-visible text. */
const TEXT_PROPS = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "tooltip",
  "emptyText",
  "confirmText",
]);

/** Object properties whose literal value is user-visible text. */
const TEXT_OBJECT_PROPS = new Set([
  ...TEXT_PROPS,
  "header",
  "description",
  "message",
  "emptyMessage",
  "subtitle",
  "helperText",
]);

/** Calls whose literal first argument is user-visible text. */
const TEXT_CALLS = new Set([
  "toast",
  "showToast",
  "setError",
  "setMessage",
  "confirm",
  "alert",
]);

const EXEMPT_MARK = "i18n-exempt:";

/** Two Latin letters in a row = a word, not a symbol or a unit letter. */
const LATIN_WORD = /[A-Za-z]{2,}/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` still has Latin words after brand names are removed. */
export function hasEnglish(text, brandNames = []) {
  let rest = text;
  for (const brand of brandNames) {
    rest = rest.replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, "g"), " ");
  }
  return LATIN_WORD.test(rest);
}

// ---------------------------------------------------------------------------
// G2 — physical direction classes
// ---------------------------------------------------------------------------

const PHYSICAL_CLASS = [
  /^[mp][lr]-/, // ml- mr- pl- pr-
  /^(left|right)-/, // left-0 right-2
  /^text-(left|right)$/,
  /^border-[lr](-|$)/,
  /^rounded-(l|r|tl|tr|bl|br)(-|$)/,
];

/** The physical-direction class tokens in a class string. */
export function physicalClassTokens(classString) {
  const hits = [];
  for (const token of classString.split(/\s+/)) {
    if (!token) continue;
    const base = token
      .slice(token.lastIndexOf(":") + 1)
      .replace(/^!/, "")
      .replace(/^-/, "");
    if (PHYSICAL_CLASS.some((re) => re.test(base))) hits.push(token);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Class context: only class lists are checked/renamed, never data values
// such as a stored "left-panel" setting or a comparison against it.
// ---------------------------------------------------------------------------

const CLASS_LIKE_TOKEN = /^[a-z0-9!:\-./[\]#%_()&>*,=]+$/;
const CLASS_FNS = new Set(["clsx", "cn", "cx", "twMerge", "twJoin", "classNames"]);
const PASS_THROUGH_BINARY = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.PlusToken,
]);

function nameText(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : "";
}

/**
 * True when a string (or template part) is a class list: it has two or more
 * class-like tokens, or it sits in a class context — a `className` /
 * `*ClassName` JSX value, an argument to clsx/cn/cx/twMerge/classNames, or
 * a variable/property whose name contains "class" (through ternary branches,
 * `&&`/`||`/`??`/`+`, parentheses, arrays and templates).
 */
export function isClassContext(node, text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((t) => CLASS_LIKE_TOKEN.test(t))) return true;
  let cur = node;
  if (ts.isTemplateHead(cur)) cur = cur.parent;
  else if (ts.isTemplateMiddle(cur) || ts.isTemplateTail(cur)) cur = cur.parent.parent;
  for (let p = cur.parent; p; cur = p, p = p.parent) {
    if (ts.isJsxAttribute(p)) return /classname$/i.test(p.name.getText());
    if (ts.isCallExpression(p)) {
      return ts.isIdentifier(p.expression) && CLASS_FNS.has(p.expression.text);
    }
    if (ts.isVariableDeclaration(p)) return /class/i.test(nameText(p.name));
    if (ts.isPropertyAssignment(p)) {
      return p.initializer === cur && /class/i.test(nameText(p.name));
    }
    if (ts.isConditionalExpression(p)) {
      if (p.condition === cur) return false;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      if (!PASS_THROUGH_BINARY.has(p.operatorToken.kind)) return false;
      continue;
    }
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isJsxExpression(p) ||
      ts.isTemplateSpan(p) ||
      ts.isTemplateExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isAsExpression(p)
    ) {
      continue;
    }
    return false;
  }
  return false;
}

const PHYSICAL_STYLE_PROP = /^((margin|padding|border)(Left|Right)\w*|left|right)$/;

// ---------------------------------------------------------------------------
// Source analysis (G1–G3)
// ---------------------------------------------------------------------------

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isExempt(lines, line) {
  return (
    (lines[line - 1] ?? "").includes(EXEMPT_MARK) ||
    (lines[line - 2] ?? "").trim().startsWith("//") &&
      (lines[line - 2] ?? "").includes(EXEMPT_MARK)
  );
}

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
  }
  return null;
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    // toast.error(...) / toast.success(...) → "toast"; window.confirm → "confirm"
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "toast") {
      return "toast";
    }
    return expr.name.text;
  }
  return null;
}

/**
 * Findings for one source file: { g1, g2, g3, exempt } — each finding is
 * { line, text }.
 */
export function analyzeSource(fileName, source, { brandNames = [] } = {}) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split("\n");
  const out = { g1: [], g2: [], g3: [], exempt: 0 };
  out.exempt = lines.filter((l) => l.includes(EXEMPT_MARK)).length;

  const push = (bucket, node, text) => {
    const line = lineOf(sf, node);
    if (isExempt(lines, line)) return;
    out[bucket].push({ line, text });
  };

  const checkClassString = (node, text) => {
    if (!isClassContext(node, text)) return;
    for (const token of physicalClassTokens(text)) push("g2", node, token);
  };

  const visit = (node) => {
    // Import paths are never UI text or classes.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

    // G1: JSX text
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text && hasEnglish(text, brandNames)) push("g1", node, text);
    }

    // G1: literal text props (className / data-testid / key are not text)
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      const value =
        init && ts.isJsxExpression(init) ? literalText(init.expression) : literalText(init);
      if (TEXT_PROPS.has(name) && value !== null && hasEnglish(value, brandNames)) {
        push("g1", node, value);
      }
      // G2: inline physical styles
      if (name === "style" && init && ts.isJsxExpression(init) && init.expression &&
          ts.isObjectLiteralExpression(init.expression)) {
        for (const prop of init.expression.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name.getText(sf).replace(/["']/g, "");
          const v = literalText(prop.initializer);
          if (PHYSICAL_STYLE_PROP.test(key)) push("g2", prop, key);
          else if (key === "textAlign" && (v === "left" || v === "right")) {
            push("g2", prop, `textAlign: ${v}`);
          }
        }
      }
    }

    // G1: literal text in object properties that hold UI text (DataTable
    // `header`, option `label`, `title`, `description`, …).
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(sf).replace(/["']/g, "");
      if (TEXT_OBJECT_PROPS.has(key)) {
        const value = literalText(node.initializer);
        if (value !== null && hasEnglish(value, brandNames)) push("g1", node, value);
      }
    }

    // G1: literal text passed to toast/setError/…; G3: toLocale*
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && TEXT_CALLS.has(name)) {
        const value = literalText(node.arguments[0]);
        if (value !== null && hasEnglish(value, brandNames)) push("g1", node, value);
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        /^toLocale(Date|Time)?String$/.test(node.expression.name.text)
      ) {
        push("g3", node, node.expression.name.text);
      }
    }

    // G3: Intl.NumberFormat / Intl.DateTimeFormat (new or call)
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Intl" &&
      (node.name.text === "NumberFormat" || node.name.text === "DateTimeFormat")
    ) {
      push("g3", node, `Intl.${node.name.text}`);
    }

    // G2: physical classes in any string or template text
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkClassString(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      checkClassString(node, node.text);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------
// Catalogs (G4, G5)
// ---------------------------------------------------------------------------

/** { "a.b": value } for every leaf of a nested catalog. */
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function placeholders(value) {
  const names = new Set();
  if (typeof value !== "string") return names;
  for (const m of value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)) names.add(m[1]);
  return names;
}

function groupByBase(flat) {
  const groups = new Map();
  for (const [key, value] of Object.entries(flat)) {
    const base = key.replace(PLURAL_SUFFIX, "");
    const entry = groups.get(base) ?? { values: [], names: new Set() };
    entry.values.push([key, value]);
    for (const n of placeholders(value)) entry.names.add(n);
    groups.set(base, entry);
  }
  return groups;
}

/** G4 issues between one namespace's en and ar catalogs. */
export function compareCatalogs(ns, en, ar) {
  const issues = [];
  const enG = groupByBase(flatten(en));
  const arG = groupByBase(flatten(ar));
  for (const [base, e] of enG) {
    const a = arG.get(base);
    if (!a) {
      issues.push({ ns, key: base, kind: "missing-in-ar" });
      continue;
    }
    for (const [key, value] of a.values) {
      if (typeof value !== "string" || value.trim() === "") {
        issues.push({ ns, key, kind: "empty-in-ar" });
      }
    }
    const same =
      e.names.size === a.names.size && [...e.names].every((n) => a.names.has(n));
    if (!same) {
      issues.push({
        ns,
        key: base,
        kind: "placeholder-mismatch",
        detail: `en {${[...e.names].join(",")}} vs ar {${[...a.names].join(",")}}`,
      });
    }
  }
  for (const base of arG.keys()) {
    if (!enG.has(base)) issues.push({ ns, key: base, kind: "extra-in-ar" });
  }
  return issues;
}

/** G5: Arabic values that contain a forbidden glossary variant. */
export function forbiddenHits(ns, ar, forbidden) {
  const hits = [];
  for (const [key, value] of Object.entries(flatten(ar))) {
    if (typeof value !== "string") continue;
    for (const word of forbidden) {
      if (word && value.includes(word)) hits.push({ ns, key, word });
    }
  }
  return hits;
}

/** The quoted strings of a source snippet, in order. */
export function parseQuotedList(src) {
  const out = [];
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}
