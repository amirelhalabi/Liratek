// Find `.prepare(`<template-literal>`).run|get|all(<args>)` inline chains where
// the count of `?` placeholders != count of top-level bind args.
// Hand-scanned (no regex bleed). Skips non-template-literal SQL, spreads, and
// named-param statements (reported separately as "unhandled").
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [
  join(REPO, "packages/core/src/repositories"),
  join(REPO, "packages/core/src/services"),
];

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (e !== "__tests__") walk(p, acc); }
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts") && !e.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

// From index of opening backtick, return {text, end} of the template literal.
function readTemplate(s, i) {
  // s[i] === '`'
  let text = "", j = i + 1, depth = 0;
  for (; j < s.length; j++) {
    const c = s[j], prev = s[j - 1];
    if (c === "`" && prev !== "\\" && depth === 0) return { text, end: j };
    if (c === "$" && s[j + 1] === "{") { depth++; text += "${"; j++; continue; }
    if (c === "}" && depth > 0) { depth--; text += c; continue; }
    text += c;
  }
  return { text, end: j };
}

// From index of opening '(', return {body, end} balancing parens (string/template aware).
function readParenGroup(s, i) {
  let body = "", depth = 0, inStr = null, tmpl = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j], prev = s[j - 1];
    body += c;
    if (inStr) { if (c === inStr && prev !== "\\") inStr = null; continue; }
    if (tmpl) { if (c === "`" && prev !== "\\") tmpl--; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "`") { tmpl++; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return { body: body.slice(1, -1), end: j }; }
  }
  return { body: body.slice(1), end: s.length };
}

function splitArgs(s) {
  const args = []; let depth = 0, cur = "", inStr = null, tmpl = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], prev = s[i - 1];
    if (inStr) { cur += c; if (c === inStr && prev !== "\\") inStr = null; continue; }
    if (tmpl) { cur += c; if (c === "`" && prev !== "\\") tmpl--; continue; }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
    if (c === "`") { tmpl++; cur += c; continue; }
    if ("([{".includes(c)) { depth++; cur += c; continue; }
    if (")]}".includes(c)) { depth--; cur += c; continue; }
    if (c === "," && depth === 0) { if (cur.trim()) args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function countPlaceholders(sql) {
  // strip ${...} interpolations (they don't contribute literal ? binds)
  let s = sql.replace(/\$\{[^}]*\}/g, "");
  let n = 0, inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"') { inStr = c; continue; }
    if (c === "?") n++;
  }
  return n;
}

const findings = [], unhandled = [];
for (const file of walk(ROOTS[0]).concat(walk(ROOTS[1]))) {
  const src = readFileSync(file, "utf8");
  const rel = file.replace(REPO + "/", "");
  let idx = 0;
  while ((idx = src.indexOf(".prepare(", idx)) !== -1) {
    const line = src.slice(0, idx).split("\n").length;
    let k = idx + ".prepare(".length;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== "`") { idx = k; continue; } // non-literal SQL — skip
    const { text: sql, end: btEnd } = readTemplate(src, k);
    // after backtick: skip ws + an optional trailing comma (Prettier emits
    // `.prepare(\n  `sql`,\n)`), then expect ')'
    let p = btEnd + 1;
    while (p < src.length && /\s/.test(src[p])) p++;
    if (src[p] === ",") { p++; while (p < src.length && /\s/.test(src[p])) p++; }
    if (src[p] !== ")") { idx = btEnd; continue; }
    p++;
    while (p < src.length && /\s/.test(src[p])) p++;
    if (src[p] !== ".") { idx = btEnd; continue; } // not an inline chain (prepared-const reuse)
    p++;
    const mm = /^(run|get|all)\s*\(/.exec(src.slice(p, p + 12));
    if (!mm) { idx = btEnd; continue; }
    const method = mm[1];
    const parenOpen = p + mm[0].length - 1;
    const { body } = readParenGroup(src, parenOpen);
    if (/[@:$]\w/.test(sql)) { idx = btEnd; continue; } // named params model
    const ph = countPlaceholders(sql);
    const args = splitArgs(body);
    if (args.some((a) => a.startsWith("..."))) { unhandled.push(`${rel}:${line} (spread args)`); idx = btEnd; continue; }
    // `ph` counts only LITERAL `?` (interpolated ${fragment} helpers are stripped
    // and may add hidden placeholders + their own args at runtime). So:
    //  - ph > args  → RELIABLE bug ("too few parameter values"): hidden fragment
    //    placeholders only widen the gap, so a literal surplus is always real.
    //  - args > ph  → only reliable when NO interpolation (a ${fragment} can
    //    legitimately explain extra args). Suppress that direction when the SQL
    //    interpolates, to avoid fragment-helper false positives.
    const interpolated = sql.includes("${");
    const mismatch = ph > args.length || (args.length > ph && !interpolated);
    if (mismatch) {
      findings.push({ rel, line, method, ph, args: args.length, sql: sql.replace(/\s+/g, " ").trim().slice(0, 100) });
    }
    idx = btEnd;
  }
}

if (findings.length === 0) {
  console.log("OK: no inline .prepare().run/get/all() placeholder/arg mismatches.");
} else {
  console.log(`FOUND ${findings.length} placeholder/arg mismatch(es):\n`);
  for (const f of findings) console.log(`${f.rel}:${f.line}  .${f.method}()  ${f.ph} placeholders vs ${f.args} args\n    ${f.sql}\n`);
}
if (unhandled.length) console.log(`\n(${unhandled.length} skipped — spread args, verify manually if suspicious)`);
process.exitCode = findings.length > 0 ? 1 : 0;
