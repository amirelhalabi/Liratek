/**
 * Reversal-symmetry guard (CLAUDE.md rule 20, owner-reported 2026-07-12).
 *
 * The generic void/refund cancels module-charge debt via _cancelDebt over
 * MODULE_DEBT_TRANSACTION_TYPES. The bug this guards against: a flow starts
 * booking a NEW '<Module> Debt' charge type (as the lira-093 "CUSTOMER_ACCOUNT
 * everywhere" sweep did for recharge/services) and nobody adds it to the
 * whitelist — refunds then silently keep the customer's debt.
 *
 * Mechanism: every quoted `… Debt` string literal anywhere in core source
 * must be CLASSIFIED — either in MODULE_DEBT_TRANSACTION_TYPES (generic
 * reversal owns it) or in the exclusion map below with its reversal owner
 * named. An unclassified literal fails this test with instructions.
 * Convention (rule 20): charge types MUST be named '<Module> Debt', so this
 * scan catches them by construction.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MODULE_DEBT_TRANSACTION_TYPES } from "../transactionTypes";

/** Debt-named ledger types deliberately NOT reversed by the generic path —
 *  each entry names its reversal owner. */
const EXCLUDED_DEBT_TYPES: Record<string, string> = {
  "Session Debt":
    "session-owned: transaction_id is NULL (links via session_id); reversed by the session flow",
  "Manual Debt":
    "manual Debts-page entry with no transaction linkage; reversed by the opposite manual entry (DEBT_CASH_OUT is gated non-reversible)",
  "Imported Debt":
    "Excel-import opening balance (insertRawEntry), no transaction linkage; corrected by re-import/manual entry",
};

const SRC_ROOT = path.join(__dirname, "..", "..");
const DEBT_LITERAL = /['"]([A-Z][A-Za-z ]* Debt)['"]/g;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("MODULE_DEBT_TRANSACTION_TYPES — reversal-symmetry guard (rule 20)", () => {
  const found = new Map<string, string[]>(); // type → files
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(DEBT_LITERAL)) {
      const type = match[1];
      const rel = path.relative(SRC_ROOT, file);
      const files = found.get(type) ?? [];
      if (!files.includes(rel)) files.push(rel);
      found.set(type, files);
    }
  }

  it("every '<Module> Debt' literal in core source is classified (whitelist or named exclusion)", () => {
    const unclassified = [...found.entries()].filter(
      ([type]) =>
        !MODULE_DEBT_TRANSACTION_TYPES.includes(type) &&
        !(type in EXCLUDED_DEBT_TYPES),
    );
    if (unclassified.length > 0) {
      const message = unclassified
        .map(
          ([type, files]) =>
            `'${type}' (${files.join(", ")}) — if the generic void/refund must ` +
            `cancel this charge, add it to MODULE_DEBT_TRANSACTION_TYPES ` +
            `(constants/transactionTypes.ts); otherwise add it to ` +
            `EXCLUDED_DEBT_TYPES here and NAME its reversal owner. ` +
            `See CLAUDE.md rule 20 / FEATURE_GUIDE §9.`,
        )
        .join("\n");
      throw new Error(`Unclassified debt ledger types:\n${message}`);
    }
  });

  it("the whitelist carries no dead entries (every entry appears in source)", () => {
    const dead = MODULE_DEBT_TRANSACTION_TYPES.filter((t) => !found.has(t));
    expect(dead).toEqual([]);
  });

  it("no type is both whitelisted and excluded", () => {
    const both = MODULE_DEBT_TRANSACTION_TYPES.filter(
      (t) => t in EXCLUDED_DEBT_TYPES,
    );
    expect(both).toEqual([]);
  });
});
