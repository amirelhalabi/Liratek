#!/usr/bin/env node
/**
 * Node-native tests for the LIRA-331 i18n guard: rule logic in
 * scripts/lib/i18nGuard.mjs and the runner scripts/check-i18n.mjs
 * (contracts/i18n-catalog.md G1–G7).
 *
 * Rule 17: written before either file existed; the first run failed with
 * ERR_MODULE_NOT_FOUND for scripts/lib/i18nGuard.mjs (2026-10-17).
 *
 * The end-to-end cases build a throwaway repo tree in a temp dir and run the
 * real script against it with --root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  analyzeSource,
  compareCatalogs,
  forbiddenHits,
  parseQuotedList,
  physicalClassTokens,
} from "../lib/i18nGuard.mjs";

const BRANDS = ["OMT", "Whish", "LiraTek", "USD", "LBP"];
const g = (src, file = "x.tsx") => analyzeSource(file, src, { brandNames: BRANDS });

// ---------------------------------------------------------------------------
// G1 — hard-coded Latin-letter UI text
// ---------------------------------------------------------------------------

test("G1 flags JSX text with Latin letters", () => {
  const hits = g(`export const A = () => <h1>Settle debt</h1>;`).g1;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "Settle debt");
});

test("G1 flags literal placeholder/title/aria-label/alt/label props", () => {
  for (const prop of ["placeholder", "title", "aria-label", "alt", "label", "tooltip", "emptyText", "confirmText"]) {
    const hits = g(`const A = () => <input ${prop}="Search clients" />;`).g1;
    assert.equal(hits.length, 1, prop);
  }
  assert.equal(g(`const A = () => <input placeholder={"Search"} />;`).g1.length, 1);
});

test("G1 flags literal arguments to toast/setError/setMessage/confirm/alert", () => {
  assert.equal(g(`toast.error("Could not save");`).g1.length, 1);
  assert.equal(g(`showToast("Saved", "success");`).g1.length, 1);
  assert.equal(g(`setError("Amount is required");`).g1.length, 1);
  assert.equal(g(`setMessage(\`Saved\`);`).g1.length, 1);
  assert.equal(g(`if (confirm("Delete it?")) {}`).g1.length, 1);
  assert.equal(g(`alert("Done");`).g1.length, 1);
});

test("G1 flags literal text in label/header/title/placeholder/description object properties", () => {
  assert.equal(g(`const cols = [{ key: "date", header: "Date" }];`).g1.length, 1);
  assert.equal(g(`const opts = [{ value: "CASH", label: "Cash" }];`).g1.length, 1);
  assert.equal(g(`const x = { description: "Money paid out" };`).g1.length, 1);
  assert.deepEqual(g(`const opts = [{ value: "CASH", label: t("common:payment.CASH") }];`).g1, []);
  assert.deepEqual(g(`const o = { key: "date", value: "CASH" };`).g1, []);
});

test("G1 passes translated text, brand names, symbols, numbers, className, data-testid, key", () => {
  const src = `
    const A = () => (
      <div className="flex ml-0x" data-testid="pay-button" key="row">
        {t("repay.title")}
        <span>OMT</span>
        <span>Whish LiraTek</span>
        <span>$ / %</span>
        <span>12.5</span>
        <input placeholder={t("repay.amount")} />
      </div>
    );`;
  assert.deepEqual(g(src).g1, []);
});

test("G1 honours a per-line // i18n-exempt: escape (same or previous line)", () => {
  assert.deepEqual(g(`setError("raw data value"); // i18n-exempt: data`).g1, []);
  assert.deepEqual(
    g(`// i18n-exempt: owner's label kept verbatim\nconst A = () => <b>Cash</b>;`).g1,
    [],
  );
});

// ---------------------------------------------------------------------------
// G2 — physical direction classes
// ---------------------------------------------------------------------------

test("G2 flags physical margin/padding/position/text/border/rounded classes", () => {
  for (const cls of ["ml-2", "mr-auto", "pl-4", "pr-1", "-ml-1", "md:mr-2", "left-0", "right-2", "text-left", "text-right", "border-l", "border-r-2", "rounded-l-lg", "rounded-tr"]) {
    assert.equal(physicalClassTokens(`flex ${cls} gap-2`).length, 1, cls);
  }
});

test("G2 leaves logical and look-alike classes alone", () => {
  for (const cls of ["ms-2", "me-auto", "ps-4", "pe-1", "start-0", "end-2", "text-start", "border-s", "rounded-s-lg", "rounded-lg", "border-red-500", "rounded-full", "text-lg", "leading-relaxed",
    // Tailwind 4.1 builds space-x / divide-x from margin-inline / border-inline:
    // already right-to-left safe.
    "space-x-2", "divide-x"]) {
    assert.deepEqual(physicalClassTokens(cls), [], cls);
  }
});

test("G2 scans className literals and template text in source", () => {
  const hits = g(`const A = () => <div className={\`p-2 \${x ? "ml-2" : "ms-1"}\`} />;`).g2;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "ml-2");
});

test("G2 ignores a lone data value outside a class context", () => {
  const src = `
    const mode = localStorage.getItem("layout_mode") || "left-panel";
    if (mode === "left-panel") handleLayoutChange("left-panel");
  `;
  assert.deepEqual(g(src).g2, []);
  assert.equal(g(`const BASE = "flex ml-2";`).g2.length, 1);
  assert.equal(g(`const x = cn("pr-4", a && "border-l-2");`).g2.length, 2);
});

// ---------------------------------------------------------------------------
// G3 — machine-locale formatting
// ---------------------------------------------------------------------------

test("G3 flags toLocale* calls and Intl.NumberFormat / Intl.DateTimeFormat", () => {
  assert.equal(g(`const s = amount.toLocaleString();`).g3.length, 1);
  assert.equal(g(`const s = d.toLocaleDateString("en-US");`).g3.length, 1);
  assert.equal(g(`const s = d.toLocaleTimeString();`).g3.length, 1);
  assert.equal(g(`const f = new Intl.NumberFormat("en-US");`).g3.length, 1);
  assert.equal(g(`const f = Intl.DateTimeFormat();`).g3.length, 1);
  assert.deepEqual(g(`const s = formatNumber(amount);`).g3, []);
});

// ---------------------------------------------------------------------------
// G4 / G5 — catalogs
// ---------------------------------------------------------------------------

test("G4 flags a key missing in ar, an extra ar key and a placeholder mismatch", () => {
  const en = { repay: { title: "Repay", owed: "Owes {{amount}}" }, gone: "x" };
  const ar = { repay: { title: "تسديد", owed: "عليه {{sum}}" }, extra: "y" };
  const issues = compareCatalogs("debts", en, ar).map((i) => i.kind).sort();
  assert.deepEqual(issues, ["extra-in-ar", "missing-in-ar", "placeholder-mismatch"]);
});

test("G4 accepts Arabic plural forms against English _one/_other", () => {
  const en = { items_one: "{{count}} item", items_other: "{{count}} items" };
  const ar = {
    items_zero: "لا أغراض", items_one: "غرض واحد", items_two: "غرضان",
    items_few: "{{count}} أغراض", items_many: "{{count}} غرضًا", items_other: "{{count}} غرض",
  };
  assert.deepEqual(compareCatalogs("x", en, ar), []);
});

test("G4 flags an empty Arabic value", () => {
  assert.equal(compareCatalogs("x", { a: "A" }, { a: "" })[0].kind, "empty-in-ar");
});

test("G5 flags an Arabic value containing a forbidden glossary variant", () => {
  const hits = forbiddenHits("debts", { a: { b: "الذمم المتبقية" }, c: "الديون" }, ["الذمم", "العميل"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "a.b");
});

test("parseQuotedList reads the quoted strings of a source list", () => {
  assert.deepEqual(parseQuotedList(`["OMT", 'Whish',\n "Alfa"]`), ["OMT", "Whish", "Alfa"]);
});

// ---------------------------------------------------------------------------
// End to end: the runner against a throwaway tree
// ---------------------------------------------------------------------------

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-i18n.mjs");

function writeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function baseTree(extra = {}) {
  const I = "packages/ui/src/i18n";
  return {
    [`${I}/namespaces.ts`]: `export const NAMESPACES = [\n  "common",\n  "debts",\n  "sales",\n  "server",\n] as const;\n`,
    [`${I}/scopes.json`]: { scopes: { common: [], debts: ["frontend/src/features/debts"], sales: ["frontend/src/features/sales"] } },
    [`${I}/brandNames.ts`]: `export const BRAND_NAMES = [\n  "OMT",\n] as const;\n`,
    [`${I}/glossary.ts`]: `export const GLOSSARY = {\n  debts: { en: "debts", ar: "الديون", forbidden: ["الذمم"], source: "landing" },\n};\n`,
    [`${I}/locales/en/common.json`]: { ok: "OK" },
    [`${I}/locales/ar/common.json`]: { ok: "حسنًا" },
    [`${I}/locales/en/debts.json`]: {},
    [`${I}/locales/ar/debts.json`]: {},
    [`${I}/locales/en/sales.json`]: {},
    [`${I}/locales/ar/sales.json`]: {},
    [`${I}/locales/ar/server.json`]: { "generic.saveFailed": "تعذّر الحفظ" },
    "packages/core/src/messages/serverMessages.ts": `export const SERVER_MESSAGES = {\n  "generic.saveFailed": "Could not save.",\n} as const;\n`,
    "packages/core/src/x.ts": `export const x = 1;\n`,
    "frontend/src/features/debts/Debts.tsx": `export const D = () => <h1>Debts page</h1>;\n`,
    "frontend/src/features/whatsNew/WhatsNew.tsx": `export const W = () => <h1 className="ml-2">What's new</h1>;\n`,
    ...extra,
  };
}

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf8" });
}

test("an unconverted module (empty namespace) is ignored, and whatsNew is never scanned", () => {
  const res = run(writeTree(baseTree()));
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /converted: 1\//);
});

test("adding a module's first key makes the guard fail on its hard-coded text (failing-first step)", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/en/debts.json": { page: { title: "Debts" } },
    "packages/ui/src/i18n/locales/ar/debts.json": { page: { title: "الديون" } },
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /G1.*Debts\.tsx.*Debts page/);
});

test("a converted module that uses t() passes", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/en/debts.json": { page: { title: "Debts" } },
    "packages/ui/src/i18n/locales/ar/debts.json": { page: { title: "الديون" } },
    "frontend/src/features/debts/Debts.tsx": `export const D = () => <h1 className="ms-2">{t("page.title")}</h1>;\n`,
  }));
  const res = run(root);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("G4 fails when an Arabic key is missing", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/en/common.json": { ok: "OK", cancel: "Cancel" },
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /G4.*common.*cancel/);
});

test("G5 fails on a forbidden glossary variant", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/ar/common.json": { ok: "الذمم" },
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /G5/);
});

test("G6 fails on an i18next import under packages/core", () => {
  const root = writeTree(baseTree({
    "packages/core/src/bad.ts": `import i18next from "i18next";\n`,
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /G6.*bad\.ts/);
});

test("G7 fails when the Arabic server catalog misses a SERVER_MESSAGES key", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/ar/server.json": {},
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /G7.*generic\.saveFailed/);
});

test("the namespace list must match the catalog files", () => {
  const root = writeTree(baseTree({
    "packages/ui/src/i18n/locales/en/extra.json": {},
    "packages/ui/src/i18n/locales/ar/extra.json": {},
  }));
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /extra/);
});

test("--list prints candidate strings for a folder, converted or not", () => {
  const root = writeTree(baseTree());
  const res = run(root, "--list", "frontend/src/features/debts");
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Debts page/);
});
