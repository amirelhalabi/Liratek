#!/usr/bin/env node
/**
 * Node-native tests for `scripts/lib/transportParity.mjs` (LIRA-297): the
 * rule logic behind `scripts/check-transport-parity.mjs`.
 *
 *   - A1: a `window.api` / `isElectron()` conditional whose BOTH branches build
 *     object literals — one payload per transport (CLAUDE.md rule 22).
 *   - C1: any `window.api` access in frontend code, checked against a reviewed
 *     allowlist keyed by file + the `window.api.<namespace>` it may touch.
 *
 * Rule 17: written before the module existed; the first run failed with
 * ERR_MODULE_NOT_FOUND for scripts/lib/transportParity.mjs (recorded
 * 2026-10-10), then passed once it was written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeSource,
  applyAllowlist,
  isScannedPath,
  validateAllowlist,
} from "../lib/transportParity.mjs";

const a1 = (src, file = "x.tsx") => analyzeSource(file, src).a1;
const c1 = (src, file = "x.tsx") => analyzeSource(file, src).c1;

// ---------------------------------------------------------------------------
// A1 — payload per transport
// ---------------------------------------------------------------------------

test("A1 flags the original Settle Debt gate: object literals are call ARGUMENTS in both branches", () => {
  const src = `
    async function pay() {
      const result = window.api
        ? await window.api.debt.addRepayment({ clientId, amountUSD })
        : await addRepayment({ client_id, amount_usd });
    }`;
  const hits = a1(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
  assert.equal(hits[0].kind, "ternary");
});

test("A1 flags an isElectron() if/else whose branches both build a payload", () => {
  const src = `
    if (isElectron()) {
      send({ a: 1 });
    } else {
      post("/x", { body: { a: 1 } });
    }`;
  const hits = a1(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "if");
});

test("A1 flags a negated / optional-chained / cast transport test", () => {
  assert.equal(a1(`const p = !isElectron() ? { a } : { b };`).length, 1);
  assert.equal(a1(`const p = window.api?.x ? { a } : { b };`).length, 1);
  assert.equal(a1(`const p = (window as any).api ? { a } : { b };`).length, 1);
});

test("A1 ignores a ternary where only ONE branch is an object (state initialiser)", () => {
  assert.deepEqual(
    a1(`const s = isElectron() ? { kind: "combined" } : null;`),
    [],
  );
  assert.deepEqual(a1(`const s = isElectron() ? null : undefined;`), []);
});

test("A1 ignores an if with no else (C1's job, not A1's)", () => {
  assert.deepEqual(a1(`if (isElectron()) { track({ a: 1 }); }`), []);
});

test("A1 does not descend into JSX: style props on both sides are not payloads", () => {
  const src = `
    const el = !isElectron() ? (
      <div style={{ color: "red" }} onClick={() => go({ a: 1 })} />
    ) : (
      <span style={{ color: "blue" }} />
    );`;
  assert.deepEqual(a1(src), []);
});

test("A1 does not descend into nested function bodies", () => {
  const src = `const f = isElectron() ? () => ({ a: 1 }) : () => ({ b: 2 });`;
  assert.deepEqual(a1(src), []);
});

test("A1 ignores conditionals that are not transport tests", () => {
  assert.deepEqual(a1(`const p = isAdmin ? { a } : { b };`), []);
  assert.deepEqual(a1(`const p = api.ok ? { a } : { b };`), []);
});

test("A1 ignores window.api in comments, strings and plain template text", () => {
  const src = `
    // window.api ? send({ a }) : post({ b })
    /* isElectron() ? { a } : { b } */
    const s = "window.api ? { a } : { b }";
    const t = \`isElectron() ? { a } : { b }\`;
    const p = flag ? { a } : { b };`;
  assert.deepEqual(a1(src), []);
});

test("A1 honours a reasoned transport-parity-exempt marker on the line above", () => {
  const src = `
    // transport-parity-exempt: display-only labels, not a request payload
    const p = isElectron() ? { label: "Desktop" } : { label: "Web" };`;
  assert.deepEqual(a1(src), []);
  const r = analyzeSource("x.tsx", src);
  assert.equal(r.a1Exempt.length, 1);
});

test("A1 does NOT honour an exempt marker with no reason", () => {
  const src = `
    // transport-parity-exempt:
    const p = isElectron() ? { label: "Desktop" } : { label: "Web" };`;
  assert.equal(a1(src).length, 1);
});

// ---------------------------------------------------------------------------
// C1 — window.api access
// ---------------------------------------------------------------------------

test("C1 finds every access form and names the namespace", () => {
  const src = [
    `if (!window.api) return;`, // 1 bare
    `window.api?.display?.fixFocus();`, // 2 display
    `await window.api.debt.getDebtors();`, // 3 debt
    `await window.api!.currencies.set(x);`, // 4 currencies
    `const ok = typeof window.api?.license?.status === "function";`, // 5 license
    `(window as any).api.omt.getById(1);`, // 6 omt
    `window["api"].sales.list();`, // 7 sales
    `const has = !!window.api;`, // 8 bare
  ].join("\n");
  const hits = c1(src);
  assert.deepEqual(
    hits.map((h) => [h.line, h.namespace]),
    [
      [1, "(bare)"],
      [2, "display"],
      [3, "debt"],
      [4, "currencies"],
      [5, "license"],
      [6, "omt"],
      [7, "sales"],
      [8, "(bare)"],
    ],
  );
});

test("C1 ignores comments, strings, other objects' .api, and isElectron()", () => {
  const src = `
    // if (!window.api) return;
    /** window.api.debt.getDebtors() */
    const s = "window.api.x";
    const t = \`window.api.y\`;
    const a = api.debt.getDebtors();
    const b = props.window.api;
    if (isElectron()) doIt();`;
  assert.deepEqual(c1(src), []);
});

test("C1 does count window.api inside a template-literal SUBSTITUTION (real code)", () => {
  assert.equal(c1("const t = `${window.api.x.y()}`;").length, 1);
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const hitsByFile = new Map([
  [
    "features/pos/POS.tsx",
    [
      { line: 10, namespace: "display", snippet: "" },
      { line: 20, namespace: "sales", snippet: "" },
    ],
  ],
  ["shared/Print.ts", [{ line: 5, namespace: "print", snippet: "" }]],
]);

test("allowlist: a namespace outside the entry's set is a violation, not a free ride", () => {
  const r = applyAllowlist(hitsByFile, [
    {
      file: "features/pos/POS.tsx",
      namespaces: ["display"],
      reason: "fixFocus",
    },
    { file: "shared/Print.ts", namespaces: ["print"], reason: "silent print" },
  ]);
  assert.deepEqual(
    r.violations.map((v) => [v.file, v.line, v.namespace]),
    [["features/pos/POS.tsx", 20, "sales"]],
  );
  assert.equal(r.allowed, 2);
  assert.deepEqual(r.stale, []);
});

test("allowlist: an unlisted file is a violation for every hit", () => {
  const r = applyAllowlist(hitsByFile, []);
  assert.equal(r.violations.length, 3);
});

test("allowlist: an entry (or one of its namespaces) that matches nothing is stale", () => {
  const r = applyAllowlist(hitsByFile, [
    {
      file: "features/pos/POS.tsx",
      namespaces: ["display", "sales", "print"],
      reason: "x",
    },
    { file: "shared/Print.ts", namespaces: ["print"], reason: "y" },
    { file: "gone/Old.tsx", namespaces: ["debt"], reason: "z" },
  ]);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(
    r.stale.map((s) => [s.file, s.namespace]),
    [
      ["features/pos/POS.tsx", "print"],
      ["gone/Old.tsx", "debt"],
    ],
  );
});

test("allowlist validation rejects entries without a reason or namespaces, and duplicates", () => {
  const errs = validateAllowlist([
    { file: "a.ts", namespaces: ["x"], reason: "ok" },
    { file: "b.ts", namespaces: ["x"], reason: "  " },
    { file: "c.ts", namespaces: [], reason: "r" },
    { file: "a.ts", namespaces: ["y"], reason: "dup" },
    { file: "d.ts", namespaces: ["x"], reason: "r", temporary: "yes" },
  ]);
  assert.equal(errs.length, 4);
  assert.deepEqual(
    validateAllowlist([
      { file: "a.ts", namespaces: ["x"], reason: "ok", temporary: true },
    ]),
    [],
  );
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("isScannedPath excludes tests, mocks, declarations and the adapter files", () => {
  assert.equal(isScannedPath("features/debts/pages/Debts/index.tsx"), true);
  assert.equal(isScannedPath("shared/utils/printReceipt.ts"), true);
  for (const p of [
    "api/backendApi.ts",
    "api/ElectronApiAdapter.ts",
    "types/electron.d.ts",
    "vite-env.d.ts",
    "features/x/__tests__/a.tsx",
    "features/x/a.test.tsx",
    "features/x/a.spec.ts",
    "__mocks__/thing.ts",
    "index.css",
    "CLAUDE.md",
  ]) {
    assert.equal(isScannedPath(p), false, p);
  }
});
