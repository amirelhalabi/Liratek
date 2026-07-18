/**
 * Guard: the transactions-table action gating can never drift from the
 * backend's reversibility rules again.
 *
 * The UI's ACTIONABLE_TYPES (Void/Refund buttons) and core's
 * NON_REVERSIBLE_TRANSACTION_TYPES (_assertReversible, the real gate) are
 * maintained in two different packages. This test pins the invariant that
 * they form an exact partition of the TransactionType enum:
 *
 *   - a type in both        → the UI offers a button the backend rejects
 *   - a type in neither     → silently un-void-able from the UI while the raw
 *                             API happily runs a generic reversal the flow
 *                             may not support (the MTC_TOPUP drawer-desync
 *                             class of bug this guard was born from)
 *   - a type in neither set → also how dead entries hide ("BINANCE" sat in
 *                             ACTIONABLE_TYPES for months without matching a
 *                             single row)
 *
 * Adding a new TransactionType forces a conscious classification here:
 * either it's reversible (add to ACTIONABLE_TYPES) or it isn't (add to
 * NON_REVERSIBLE_TRANSACTION_TYPES with a rule-20 comment naming its
 * reversal owner).
 */

// Deep import of the dependency-free constants module — the @liratek/core
// barrel pulls the whole main-process package (better-sqlite3 et al.), which
// frontend jest cannot resolve.
import {
  TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
} from "../../../../../packages/core/src/constants/transactionTypes";
import { ACTIONABLE_TYPES, RECEIPTABLE_TYPES } from "../auditConstants";

const ALL_TYPES = new Set<string>(Object.values(TRANSACTION_TYPES));

describe("transactions-table action gating ↔ core reversibility", () => {
  it("every ACTIONABLE type is a real TransactionType (no dead entries)", () => {
    const dead = [...ACTIONABLE_TYPES].filter((t) => !ALL_TYPES.has(t));
    expect(dead).toEqual([]);
  });

  it("every RECEIPTABLE type is a real TransactionType", () => {
    const dead = [...RECEIPTABLE_TYPES].filter((t) => !ALL_TYPES.has(t));
    expect(dead).toEqual([]);
  });

  it("no ACTIONABLE type is NON_REVERSIBLE (button the backend would reject)", () => {
    const contradictions = [...ACTIONABLE_TYPES].filter((t) =>
      NON_REVERSIBLE_TRANSACTION_TYPES.has(
        t as Parameters<typeof NON_REVERSIBLE_TRANSACTION_TYPES.has>[0],
      ),
    );
    expect(contradictions).toEqual([]);
  });

  it("ACTIONABLE ∪ NON_REVERSIBLE covers every TransactionType (nothing unclassified)", () => {
    const unclassified = [...ALL_TYPES].filter(
      (t) =>
        !ACTIONABLE_TYPES.has(t) &&
        !NON_REVERSIBLE_TRANSACTION_TYPES.has(
          t as Parameters<typeof NON_REVERSIBLE_TRANSACTION_TYPES.has>[0],
        ),
    );
    expect(unclassified).toEqual([]);
  });
});
