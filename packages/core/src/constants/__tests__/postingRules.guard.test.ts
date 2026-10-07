/**
 * Posting-rules coverage guard (POSTING_INTEGRITY_PLAN.md §7, phase 5).
 *
 * Every value of TRANSACTION_TYPES must be classified EXACTLY once: either
 * some rule in POSTING_RULES declares its postings, or POSTING_RULE_EXCLUSIONS
 * names why it has none (no money / reversal row / rule still TODO).
 * A new transaction type added without either fails here — the gap the
 * 2026-10-06 FOR-partner OMT SEND bug slipped through ("nothing lists, per
 * path, which postings are required").
 *
 * Rule 17: the first run of this file was against a classification missing
 * the `todo-phase5` block (drafted, then removed before the guard first ran).
 * It failed listing 40 unclassified types (SALE, EXCHANGE, RECHARGE,
 * LOTO_CASH_PRIZE …); the block was added back after.
 */
import {
  POSTING_RULES,
  POSTING_RULE_EXCLUSIONS,
  type PostingRule,
} from "../postingRules";
import { TRANSACTION_TYPES } from "../transactionTypes";

const allTypes = new Set<string>(Object.values(TRANSACTION_TYPES));
const ruled = new Set<string>(
  (Object.values(POSTING_RULES) as PostingRule[]).map((r) => r.transactionType),
);
const excluded = new Set<string>(Object.keys(POSTING_RULE_EXCLUSIONS));

describe("POSTING_RULES coverage guard", () => {
  it("every transaction type has a posting rule or a named exclusion", () => {
    const unclassified = [...allTypes].filter(
      (t) => !ruled.has(t) && !excluded.has(t),
    );
    // On failure: add a rule to constants/postingRules.ts (POSTING_MAP.md §4),
    // or an entry to POSTING_RULE_EXCLUSIONS with its reason.
    expect(unclassified).toEqual([]);
  });

  it("no type is both ruled and excluded", () => {
    expect([...ruled].filter((t) => excluded.has(t))).toEqual([]);
  });

  it("no stale exclusion (every excluded type still exists)", () => {
    expect([...excluded].filter((t) => !allTypes.has(t))).toEqual([]);
  });

  it("every rule declares all four ledgers, and every 'post' has a line", () => {
    for (const [key, rule] of Object.entries(POSTING_RULES) as [
      string,
      PostingRule,
    ][]) {
      for (const ledger of [
        "drawers",
        "supplier",
        "partner",
        "debt",
      ] as const) {
        const e = rule.ledgers[ledger];
        expect({ key, ledger, defined: e !== undefined }).toEqual({
          key,
          ledger,
          defined: true,
        });
        if (e.post === "post") {
          expect({ key, ledger, lines: e.lines.length > 0 }).toEqual({
            key,
            ledger,
            lines: true,
          });
        }
      }
    }
  });
});
