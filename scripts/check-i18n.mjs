#!/usr/bin/env node
/**
 * check-i18n.mjs — LIRA-331 guard for the Arabic app UI
 * (specs/331-arabic-ui/contracts/i18n-catalog.md). Runs in CI at error level.
 * Rule logic lives in scripts/lib/i18nGuard.mjs (unit-tested by
 * scripts/__tests__/i18nGuard.test.mjs).
 *
 * A namespace counts as CONVERTED once packages/ui/src/i18n/locales/en/<ns>.json
 * holds at least one key. Its files are listed in packages/ui/src/i18n/
 * scopes.json (the most specific matching path owns a file). From then on, in
 * that namespace's files:
 *   G1  hard-coded Latin-letter UI text (JSX text, text props, toast/setError…)
 *   G2  physical direction classes (ml-/mr-/pl-/pr-/left-/right-/text-left/
 *       text-right/border-l/r/rounded-l/r…) and inline physical styles.
 *       (space-x/divide-x are allowed: Tailwind 4.1 builds them from
 *       margin-inline/border-inline.)
 *   G3  toLocale* / Intl.NumberFormat / Intl.DateTimeFormat (use
 *       @liratek/ui/i18n/format)
 * Everywhere:
 *   G4  en/ar key sets or {{placeholders}} differ, or an Arabic value is empty
 *   G5  an Arabic value contains a forbidden glossary variant (glossary.ts)
 *   G6  i18next / react-i18next imported under packages/core
 *   G7  the Arabic `server` catalog's keys differ from core's SERVER_MESSAGES
 * Plus: namespaces.ts, scopes.json and the catalog files list the same
 * namespaces.
 *
 * Escape for a data value: `// i18n-exempt: <reason>` on the line (or the
 * line above). Tests, __mocks__, .d.ts and features/whatsNew (FR-012, not in
 * scopes.json) are never scanned.
 *
 * Usage:
 *   node scripts/check-i18n.mjs                 # check, exit 1 on findings
 *   node scripts/check-i18n.mjs --list <dir>    # print candidate strings (G1)
 *   node scripts/check-i18n.mjs --root <dir>    # check another tree (tests)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeSource,
  compareCatalogs,
  flatten,
  forbiddenHits,
  parseQuotedList,
} from "./lib/i18nGuard.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const ROOT = path.resolve(
  argValue("--root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const LIST_DIR = argValue("--list");
const I18N = path.join(ROOT, "packages/ui/src/i18n");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

const findings = [];
const report = (code, where, message) => findings.push(`${code}  ${where}  ${message}`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    report("G4", rel(file), `unreadable JSON: ${error.message}`);
    return {};
  }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

function isScannable(file) {
  return (
    /\.(ts|tsx)$/.test(file) &&
    !file.endsWith(".d.ts") &&
    !/\.(test|spec)\.tsx?$/.test(file) &&
    !/[\\/](__tests__|__mocks__)[\\/]/.test(file)
  );
}

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (isScannable(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === "node_modules" || entry === "dist") continue;
    walk(path.join(target, entry), out);
  }
  return out;
}

function sourceList(file, marker) {
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf(marker);
  if (start === -1) return [];
  const open = src.indexOf("[", start);
  const close = src.indexOf("]", open);
  return parseQuotedList(src.slice(open, close + 1));
}

const brandNames = sourceList(path.join(I18N, "brandNames.ts"), "BRAND_NAMES");

// ---------------------------------------------------------------------------
// --list: candidate strings for one folder, converted or not
// ---------------------------------------------------------------------------
if (LIST_DIR) {
  for (const file of walk(path.join(ROOT, LIST_DIR))) {
    const { g1 } = analyzeSource(file, fs.readFileSync(file, "utf8"), { brandNames });
    for (const hit of g1) console.log(`${rel(file)}:${hit.line}  ${JSON.stringify(hit.text)}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Namespaces: namespaces.ts == en files (+ server) == ar files == scopes.json
// ---------------------------------------------------------------------------
const declared = sourceList(path.join(I18N, "namespaces.ts"), "NAMESPACES");
const enFiles = listJson(path.join(I18N, "locales/en"));
const arFiles = listJson(path.join(I18N, "locales/ar")).filter((f) => !f.startsWith("server"));
const scopesFile = path.join(I18N, "scopes.json");
const scopes = fs.existsSync(scopesFile) ? readJson(scopesFile).scopes ?? {} : {};

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const declaredClient = declared.filter((n) => n !== "server");
if (!sameSet(declaredClient, enFiles)) {
  report("NS", "namespaces.ts", `lists [${declaredClient.join(", ")}] but locales/en has [${enFiles.join(", ")}]`);
}
if (!sameSet(enFiles, arFiles)) {
  report("NS", "locales/ar", `has [${arFiles.join(", ")}] but locales/en has [${enFiles.join(", ")}]`);
}
if (!sameSet(Object.keys(scopes).sort(), enFiles)) {
  report("NS", "scopes.json", `lists [${Object.keys(scopes).sort().join(", ")}] but locales/en has [${enFiles.join(", ")}]`);
}

// ---------------------------------------------------------------------------
// G4 / G5: catalogs
// ---------------------------------------------------------------------------
const glossaryFile = path.join(I18N, "glossary.ts");
const forbidden = fs.existsSync(glossaryFile)
  ? [...fs.readFileSync(glossaryFile, "utf8").matchAll(/forbidden:\s*\[([^\]]*)\]/g)].flatMap(
      (m) => parseQuotedList(m[1]),
    )
  : [];

const enCatalogs = {};
for (const ns of enFiles) {
  const en = readJson(path.join(I18N, `locales/en/${ns}.json`));
  const arPath = path.join(I18N, `locales/ar/${ns}.json`);
  const ar = fs.existsSync(arPath) ? readJson(arPath) : {};
  enCatalogs[ns] = en;
  for (const issue of compareCatalogs(ns, en, ar)) {
    report("G4", `${ns}:${issue.key}`, issue.kind + (issue.detail ? ` (${issue.detail})` : ""));
  }
}
for (const file of listJson(path.join(I18N, "locales/ar"))) {
  const ar = readJson(path.join(I18N, `locales/ar/${file}.json`));
  for (const hit of forbiddenHits(file, ar, forbidden)) {
    report("G5", `${hit.ns}:${hit.key}`, `uses "${hit.word}" (glossary forbids it)`);
  }
}

// ---------------------------------------------------------------------------
// G6: no i18next under packages/core
// ---------------------------------------------------------------------------
for (const file of walk(path.join(ROOT, "packages/core/src"))) {
  const src = fs.readFileSync(file, "utf8");
  if (/(from\s+|require\(\s*|import\(\s*)["'](i18next|react-i18next)["']/.test(src)) {
    report("G6", rel(file), "imports i18next (core must stay language-free; rule 27/29)");
  }
}

// ---------------------------------------------------------------------------
// G7: ar server catalog == SERVER_MESSAGES
// ---------------------------------------------------------------------------
function serverMessageKeys() {
  const keys = [];
  const main = path.join(ROOT, "packages/core/src/messages/serverMessages.ts");
  if (fs.existsSync(main)) {
    const src = fs.readFileSync(main, "utf8");
    const start = src.indexOf("SERVER_MESSAGES");
    const body = src.slice(src.indexOf("{", start), src.indexOf("} as const", start));
    for (const m of body.matchAll(/^\s*"([\w.]+)"\s*:/gm)) keys.push(m[1]);
  }
  // P2: per-area leaves, merged with an `<area>.` prefix.
  const areaDir = path.join(ROOT, "packages/core/src/messages/server");
  if (fs.existsSync(areaDir)) {
    for (const f of fs.readdirSync(areaDir).filter((x) => x.endsWith(".ts"))) {
      const area = f.slice(0, -3);
      const src = fs.readFileSync(path.join(areaDir, f), "utf8");
      for (const m of src.matchAll(/^\s*"?([\w.]+)"?\s*:\s*["'`]/gm)) keys.push(`${area}.${m[1]}`);
    }
  }
  return keys.sort();
}
const serverKeys = serverMessageKeys();
const arServer = {};
for (const file of listJson(path.join(I18N, "locales/ar")).filter((f) => f.startsWith("server"))) {
  Object.assign(arServer, flatten(readJson(path.join(I18N, `locales/ar/${file}.json`))));
}
for (const key of serverKeys) {
  if (!(key in arServer)) report("G7", `server:${key}`, "missing in the Arabic server catalog");
}
for (const key of Object.keys(arServer)) {
  if (!serverKeys.includes(key)) report("G7", `server:${key}`, "not a SERVER_MESSAGES key");
}

// ---------------------------------------------------------------------------
// G1–G3: converted namespaces' files
// ---------------------------------------------------------------------------
const converted = enFiles.filter((ns) => Object.keys(flatten(enCatalogs[ns])).length > 0);
const allScopes = Object.entries(scopes).flatMap(([ns, paths]) =>
  paths.map((p) => ({ ns, p: p.replace(/\/+$/, "") })),
);

function ownerOf(relFile) {
  let best = null;
  for (const { ns, p } of allScopes) {
    if (relFile === p || relFile.startsWith(`${p}/`)) {
      if (!best || p.length > best.p.length) best = { ns, p };
    }
  }
  return best?.ns ?? null;
}

let exemptions = 0;
let scanned = 0;
for (const ns of converted) {
  for (const scopePath of scopes[ns] ?? []) {
    for (const file of walk(path.join(ROOT, scopePath))) {
      const relFile = rel(file);
      if (ownerOf(relFile) !== ns) continue;
      scanned += 1;
      const result = analyzeSource(file, fs.readFileSync(file, "utf8"), { brandNames });
      exemptions += result.exempt;
      for (const hit of result.g1) report("G1", `${relFile}:${hit.line}`, JSON.stringify(hit.text));
      for (const hit of result.g2) report("G2", `${relFile}:${hit.line}`, `physical class/style "${hit.text}" (use the logical one)`);
      for (const hit of result.g3) report("G3", `${relFile}:${hit.line}`, `${hit.text} (use @liratek/ui/i18n/format)`);
    }
  }
}

for (const line of findings) console.log(line);
console.log(
  `i18n guard — converted: ${converted.length}/${enFiles.length} namespaces ` +
    `[${converted.join(", ")}], files scanned: ${scanned}, i18n-exempt lines: ${exemptions}, findings: ${findings.length}`,
);
process.exit(findings.length > 0 ? 1 : 0);
