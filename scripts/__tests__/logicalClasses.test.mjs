#!/usr/bin/env node
/**
 * LIRA-331 T021 — the physical → logical Tailwind class codemod
 * (scripts/i18n-logical-classes.mjs). In LTR the result renders identically
 * (`ms-2` is `margin-inline-start`, which IS `margin-left` in LTR); in RTL it
 * flips. A pure class rename: it never touches look-alikes such as
 * `rounded-lg` or `border-red-500`.
 *
 * Rule 17: written before the codemod existed; the first run failed with
 * ERR_MODULE_NOT_FOUND (2026-10-17).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertClassString, convertSource } from "../i18n-logical-classes.mjs";

test("renames every physical class to its logical twin", () => {
  const cases = {
    "ml-2": "ms-2",
    "mr-auto": "me-auto",
    "pl-4": "ps-4",
    "pr-1.5": "pe-1.5",
    "-ml-1": "-ms-1",
    "md:mr-2": "md:me-2",
    "hover:pl-3": "hover:ps-3",
    "!pr-0": "!pe-0",
    "left-0": "start-0",
    "right-2": "end-2",
    "-right-1": "-end-1",
    "text-left": "text-start",
    "text-right": "text-end",
    "border-l": "border-s",
    "border-r-2": "border-e-2",
    "border-l-red-500": "border-s-red-500",
    "rounded-l": "rounded-s",
    "rounded-r-lg": "rounded-e-lg",
    "rounded-tl-md": "rounded-ss-md",
    "rounded-tr": "rounded-se",
    "rounded-bl-lg": "rounded-es-lg",
    "rounded-br": "rounded-ee",
  };
  for (const [from, to] of Object.entries(cases)) {
    assert.equal(convertClassString(from).text, to, from);
  }
});

test("never touches look-alikes or already-logical classes", () => {
  const keep = "rounded-lg border-red-500 rounded-full text-lg ms-2 pe-1 start-0 leading-relaxed space-x-2 translate-x-1 inset-x-0 border";
  assert.equal(convertClassString(keep).text, keep);
});

test("keeps spacing and order of the class list", () => {
  assert.equal(
    convertClassString("flex  ml-2 items-center pr-4").text,
    "flex  ms-2 items-center pe-4",
  );
});

test("leaves left-1/2 / right-1/2 next to translate-x for review (centering breaks in RTL)", () => {
  const r = convertClassString("absolute left-1/2 -translate-x-1/2");
  assert.equal(r.text, "absolute left-1/2 -translate-x-1/2");
  assert.deepEqual(r.review, ["left-1/2"]);
});

test("convertSource rewrites class strings in code and reports the count", () => {
  const src = `
    const A = () => <div className="ml-2 text-left">{x}</div>;
    const b = cn("pr-4", active && "border-l-2");
    const c = \`p-2 \${y ? "mr-1" : ""}\`;
    import x from "./left-panel";
  `;
  const out = convertSource(src);
  assert.match(out.text, /className="ms-2 text-start"/);
  assert.match(out.text, /cn\("pe-4", active && "border-s-2"\)/);
  assert.match(out.text, /"me-1"/);
  assert.match(out.text, /"\.\/left-panel"/);
  assert.equal(out.changes, 5);
});
