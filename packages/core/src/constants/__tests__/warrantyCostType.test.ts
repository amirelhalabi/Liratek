/**
 * LIRA-296 (T031) — the `WARRANTY_COST` transaction type: the cost of
 * honouring warranties (a replacement unit, a refunded faulty unit, a
 * warranty repair's parts), and supplier recoveries that offset it.
 *
 *   - no payment legs, no drawer (FEATURE_GUIDE §13 items 3–5);
 *   - its reversal owner is `WarrantyService.voidClaim` (rule 20), so the
 *     generic void/refund path must refuse it: it sits in
 *     NON_REVERSIBLE_TRANSACTION_TYPES;
 *   - it is classified by the posting-rules table (every ledger "none").
 */
import {
  TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
} from "../transactionTypes";
import { POSTING_RULES, POSTING_RULE_EXCLUSIONS } from "../postingRules";

describe("WARRANTY_COST", () => {
  it("is a transaction type", () => {
    expect(TRANSACTION_TYPES.WARRANTY_COST).toBe("WARRANTY_COST");
  });

  it("is refused by the generic void/refund path (owner: voidClaim)", () => {
    expect(
      NON_REVERSIBLE_TRANSACTION_TYPES.has(TRANSACTION_TYPES.WARRANTY_COST),
    ).toBe(true);
  });

  it("moves no drawer, supplier, partner or client ledger", () => {
    const rule = Object.values(POSTING_RULES).find(
      (r) => r.transactionType === "WARRANTY_COST",
    );
    expect(rule).toBeDefined();
    expect(POSTING_RULE_EXCLUSIONS).not.toHaveProperty("WARRANTY_COST");
    for (const ledger of ["drawers", "supplier", "partner", "debt"] as const) {
      expect(rule!.ledgers[ledger].post).toBe("none");
    }
  });
});
