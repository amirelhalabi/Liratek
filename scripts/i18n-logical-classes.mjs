#!/usr/bin/env node
/**
 * i18n-logical-classes.mjs — LIRA-331 codemod (research R6, task T021).
 *
 * Renames physical Tailwind direction classes to their logical twins, so one
 * class list is right in both directions:
 *   ml-/mr- → ms-/me-        pl-/pr- → ps-/pe-       left-/right- → start-/end-
 *   text-left/right → text-start/end                 border-l/r → border-s/e
 *   rounded-l/r → rounded-s/e    rounded-tl/tr/bl/br → rounded-ss/se/es/ee
 * Variants (`md:`, `hover:`), `!important` and negative (`-ml-1`) are kept.
 *
 * In LTR the page renders IDENTICALLY (ms-2 = margin-inline-start = margin-left
 * in LTR). Look-alikes (`rounded-lg`, `border-red-500`) are never touched.
 * `space-x`/`divide-x` need nothing (Tailwind 4.1 builds them logically).
 *
 * Left for a person (reported, not changed): `left-1/2` / `right-1/2` in a
 * class list that also uses `translate-x` — the centring trick breaks when
 * only one half flips.
 *
 * Only class lists are rewritten: a `className`/`*ClassName` value, a
 * clsx/cn/twMerge argument, a variable/property named *class*, or a string
 * of two or more class-like tokens (scripts/lib/i18nGuard.mjs
 * isClassContext, shared with guard G2). A lone data value such as a stored
 * "left-panel" setting is never touched; import paths are skipped.
 *
 * Usage: node scripts/i18n-logical-classes.mjs <dir-or-file> [...]  (writes)
 *        node scripts/i18n-logical-classes.mjs --dry <dir-or-file>   (report)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isClassContext } from "./lib/i18nGuard.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const CORNER = { tl: "ss", tr: "se", bl: "es", br: "ee" };
const SIDE = { l: "s", r: "e" };

function renameBase(base) {
  let m;
  if ((m = /^([mp])([lr])-(.+)$/.exec(base))) return `${m[1]}${SIDE[m[2]]}-${m[3]}`;
  if ((m = /^(left|right)-(.+)$/.exec(base))) return `${m[1] === "left" ? "start" : "end"}-${m[2]}`;
  if (base === "text-left") return "text-start";
  if (base === "text-right") return "text-end";
  if ((m = /^border-([lr])(-.+)?$/.exec(base))) return `border-${SIDE[m[1]]}${m[2] ?? ""}`;
  if ((m = /^rounded-([lr])(-.+)?$/.exec(base))) return `rounded-${SIDE[m[1]]}${m[2] ?? ""}`;
  if ((m = /^rounded-(tl|tr|bl|br)(-.+)?$/.exec(base))) return `rounded-${CORNER[m[1]]}${m[2] ?? ""}`;
  return null;
}

/** Rewrites one class string. Returns { text, changes, review }. */
export function convertClassString(text) {
  const centring = /(^|[\s:])-?translate-x-/.test(text);
  let changes = 0;
  const review = [];
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i];
    if (!token || /^\s+$/.test(token)) continue;
    const cut = token.lastIndexOf(":") + 1;
    const variants = token.slice(0, cut);
    let rest = token.slice(cut);
    const important = rest.startsWith("!") ? "!" : "";
    rest = rest.slice(important.length);
    const negative = rest.startsWith("-") ? "-" : "";
    const base = rest.slice(negative.length);
    if (centring && /^(left|right)-1\/2$/.test(base)) {
      review.push(token);
      continue;
    }
    const renamed = renameBase(base);
    if (renamed) {
      parts[i] = `${variants}${important}${negative}${renamed}`;
      changes += 1;
    }
  }
  return { text: parts.join(""), changes, review };
}

const CLASS_LIKE = /^[a-z0-9!:\-./[\]#%_()&>*,=]+$/;

function looksLikeClassList(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => CLASS_LIKE.test(t));
}

/** Rewrites every class-like string in a source file. */
export function convertSource(source, fileName = "x.tsx") {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const review = [];
  let changes = 0;

  const consider = (node, start, end) => {
    const inner = source.slice(start, end);
    if (!looksLikeClassList(inner.trim())) return;
    // The same rule as guard G2: a class context, or 2+ class tokens. A lone
    // data value ("left-panel" stored in localStorage) is never renamed.
    if (!isClassContext(node, inner)) return;
    const result = convertClassString(inner);
    review.push(...result.review);
    if (result.changes > 0) {
      edits.push({ start, end, text: result.text });
      changes += result.changes;
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    const start = node.getStart(sf);
    const end = node.getEnd();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      consider(node, start + 1, end - 1);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      consider(node, start + 1, end - 2);
    } else if (ts.isTemplateTail(node)) {
      consider(node, start + 1, end - 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return { text, changes, review };
}

function walk(target, out = []) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.(ts|tsx)$/.test(target) && !target.endsWith(".d.ts")) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === "node_modules" || entry === "dist") continue;
    walk(path.join(target, entry), out);
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const targets = args.filter((a) => a !== "--dry");
  if (targets.length === 0) {
    console.error("usage: node scripts/i18n-logical-classes.mjs [--dry] <dir-or-file> [...]");
    process.exit(2);
  }
  let total = 0;
  for (const target of targets) {
    for (const file of walk(path.resolve(target))) {
      if (/[\\/](__tests__|__mocks__)[\\/]|\.(test|spec)\.tsx?$/.test(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      const result = convertSource(source, file);
      for (const token of result.review) console.log(`REVIEW ${file}: ${token} (centred with translate-x)`);
      if (result.changes > 0) {
        total += result.changes;
        console.log(`${dry ? "would change" : "changed"} ${result.changes}  ${file}`);
        if (!dry) fs.writeFileSync(file, result.text);
      }
    }
  }
  console.log(`${dry ? "would rename" : "renamed"} ${total} class(es)`);
}
