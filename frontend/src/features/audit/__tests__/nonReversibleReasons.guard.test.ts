/**
 * LIRA-079 guard: the Transactions page's "can't refund here, because…"
 * messages can never silently drift from core's actual non-reversible set.
 *
 * Mirrors the pairing of `actionGating.guard.test.ts` — that test pins
 * ACTIONABLE_TYPES ∪ NON_REVERSIBLE_TRANSACTION_TYPES as an exact partition
 * of every TransactionType; this one pins NON_REVERSIBLE_REASONS as having
 * exactly one entry per NON_REVERSIBLE_TRANSACTION_TYPES member — no type
 * missing its explanation, and no stale entry left behind for a type that
 * has since moved OUT of that set (e.g. RECHARGE_TOPUP/SUPPLIER_SETTLEMENT/
 * PARTNER_SETTLEMENT/PARTNER_PAYMENT, all historically non-reversible, now
 * reversible via a dedicated owner).
 */

// Deep import of the dependency-free constants module — see
// actionGating.guard.test.ts for why the @liratek/core barrel can't be used
// from frontend jest.
import { NON_REVERSIBLE_TRANSACTION_TYPES } from "../../../../../packages/core/src/constants/transactionTypes";
import { NON_REVERSIBLE_REASONS } from "../nonReversibleReasons";

describe("NON_REVERSIBLE_REASONS ↔ core NON_REVERSIBLE_TRANSACTION_TYPES", () => {
  it("has exactly one entry per non-reversible type — nothing missing", () => {
    const missing = [...NON_REVERSIBLE_TRANSACTION_TYPES].filter(
      (t) => !(t in NON_REVERSIBLE_REASONS),
    );
    expect(missing).toEqual([]);
  });

  it("has no stale entry for a type that is no longer non-reversible", () => {
    const stale = Object.keys(NON_REVERSIBLE_REASONS).filter(
      (t) =>
        !NON_REVERSIBLE_TRANSACTION_TYPES.has(
          t as Parameters<typeof NON_REVERSIBLE_TRANSACTION_TYPES.has>[0],
        ),
    );
    expect(stale).toEqual([]);
  });

  it("every message is non-empty plain text (not a stub)", () => {
    for (const [type, reason] of Object.entries(NON_REVERSIBLE_REASONS)) {
      expect(reason.length).toBeGreaterThan(10);
      expect(reason).not.toMatch(/^TODO/i);
      void type;
    }
  });
});
