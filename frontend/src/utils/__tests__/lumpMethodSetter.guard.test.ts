/**
 * LIRA-391 guard (FR-5) — no page may remember "the" payment method from a
 * one-line sheet.
 *
 * The bug: `if (lines.length === 1) setX(lines[0].method)` (or the ternary
 * `lines.length === 1 ? lines[0].method : remembered`) never fires again once
 * the cashier adds a second line, so the remembered method goes stale and is
 * sent as a lump flag (`cashoutMethod`, `paidByMethod`) next to split legs.
 * The Binance cash-out paid "$200 account + $328.06 Whish" credited $528.06
 * to the account because of exactly this.
 *
 * The ONE derivation is `lumpMethodOf(lines)` in `src/utils/paymentUtils.ts`
 * (the method only when every line shares it). That file is the only one
 * allowed to contain the shape; every other occurrence in `src` fails here.
 *
 * Rule 17 — run on 2026-11-14 against the unfixed tree: FAILED, listing the
 * 8 setters / ternaries of the time (Recharge/index.tsx ×2,
 * OmtWhishAppTransferForm.tsx, FinancialForm.tsx, KatshForm.tsx,
 * TelecomForm.tsx ×2, Services/index.tsx) — see the report.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");
const ALLOWED = new Set([path.join("utils", "paymentUtils.ts")]);

/** `.length === 1` followed, within a short window, by `[0].method`. */
const ONE_LINE_METHOD = /\.length\s*===\s*1\b[\s\S]{0,160}?\[0\]!?\??\.method\b/g;

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "__tests__" ||
        entry.name === "__fixtures__" ||
        entry.name === "node_modules"
      )
        continue;
      out.push(...collect(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

describe("LIRA-391 — no one-line payment-method setter outside lumpMethodOf", () => {
  it("every page derives the lump method from ALL its lines", () => {
    const offenders: string[] = [];
    for (const file of collect(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(ONE_LINE_METHOD)) {
        offenders.push(`${rel}:${lineOf(source, m.index ?? 0)}`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `A payment method is remembered from a one-line sheet (stale once a ` +
          `second line is added — LIRA-391). Use lumpMethodOf(lines) from ` +
          `@/utils/paymentUtils instead:\n${offenders.join("\n")}`,
      );
    }
  });

  it("the pattern still matches the shape it guards (self-check)", () => {
    const sample =
      "if (lines.length === 1) {\n  setPaidBy(lines[0].method);\n}";
    expect(sample.match(ONE_LINE_METHOD)).not.toBeNull();
    const ternary = "x.length === 1\n  ? x[0].method\n  : stale";
    expect(ternary.match(ONE_LINE_METHOD)).not.toBeNull();
  });
});
