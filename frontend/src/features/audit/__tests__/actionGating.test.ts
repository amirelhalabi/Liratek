/**
 * actionGating — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { TRANSACTION_TYPES } from "../../../../../packages/core/src/constants/transactionTypes";
// LIRA-388 — the page's Refund button partitions against core's
// NON-REFUNDABLE set (the structural rows), no longer against the generic
// path's raw-void gate (NON_REVERSIBLE_TRANSACTION_TYPES), which still
// refuses a raw void of the types core routes to their own owner.
import { NON_REFUNDABLE_TRANSACTION_TYPES as NON_REVERSIBLE_TRANSACTION_TYPES } from "../../../../../packages/core/src/constants/refundKinds";
import { ACTIONABLE_TYPES, RECEIPTABLE_TYPES } from "../auditConstants";
import { isReversibleRow, type ActionGatingFields } from "../actionGating";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("actionGating.guard", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("actionGating", () => {
  beforeAll(resetBetweenFiles);

  /**
   * isReversibleRow — Void/Refund row-actionability gate (note 21d).
   *
   * Pre-fix, the Transactions viewer's inline gate
   * (`ACTIONABLE_TYPES.has(type) && status !== "VOIDED" && type !== "REFUND"
   * && !reverses_id`) never went false once a transaction was refunded: the
   * refunded ORIGINAL row keeps status=ACTIVE and reverses_id=null (see
   * TransactionRepository.refundTransaction), so Void/Refund stayed visible
   * and a second click was only rejected server-side ("Transaction has
   * already been refunded"). `reversed_by_id` (TransactionRepository.getRecent)
   * is the new read-model signal that closes the gap.
   *
   * Failing-first (rule 17): a row shaped exactly like a refunded original
   * (ACTIVE, no reverses_id, reversed_by_id set) is asserted NOT reversible.
   * Against the pre-fix gate (which never read reversed_by_id at all) this
   * would report `true` — the bug this test guards.
   */

  function row(overrides: Partial<ActionGatingFields>): ActionGatingFields {
    return {
      type: "SALE",
      status: "ACTIVE",
      reverses_id: null,
      reversed_by_id: null,
      ...overrides,
    };
  }

  describe("isReversibleRow", () => {
    it("an ordinary ACTIVE, never-refunded row is reversible", () => {
      expect(isReversibleRow(row({}))).toBe(true);
    });

    it("a refunded original (ACTIVE, reversed_by_id set) is NOT reversible — the bug this guards", () => {
      expect(isReversibleRow(row({ reversed_by_id: 42 }))).toBe(false);
    });

    it("a VOIDED row is not reversible", () => {
      expect(isReversibleRow(row({ status: "VOIDED" }))).toBe(false);
    });

    it("LIRA-388 — an owned type (standalone loto prize, account cash-in, drawer top-up) is refundable from its row", () => {
      for (const type of [
        "LOTO_CASH_PRIZE",
        "CREDIT_CASH_IN",
        "DRAWER_TOPUP",
      ]) {
        expect(isReversibleRow(row({ type }))).toBe(true);
      }
    });

    it("LIRA-388 — a carrier-line edit refunds only when it recorded its credits", () => {
      expect(
        isReversibleRow(
          row({
            type: "CARRIER_LINE_ADJUSTMENT",
            metadata_json: JSON.stringify({ reason: "edited" }),
          }),
        ),
      ).toBe(false);
      expect(
        isReversibleRow(
          row({
            type: "CARRIER_LINE_ADJUSTMENT",
            metadata_json: JSON.stringify({
              reason: "edited",
              credits_before: 1,
              credits_after: 4,
            }),
          }),
        ),
      ).toBe(true);
    });

    it("a REFUND row (type REFUND) is not reversible", () => {
      expect(isReversibleRow(row({ type: "REFUND", reverses_id: 1 }))).toBe(
        false,
      );
    });

    it("a VOID reversal row (reverses_id set) is not reversible", () => {
      expect(isReversibleRow(row({ reverses_id: 7 }))).toBe(false);
    });

    it("a non-actionable type (e.g. CHECKPOINT) is not reversible regardless of other fields", () => {
      expect(isReversibleRow(row({ type: "CHECKPOINT" }))).toBe(false);
    });

    // ── The loto family's per-type contract (owner ask, 2026-07-29) ───────────
    //
    // Loto TICKET sales became reversible (see
    // TransactionRepository._reverseLotoSupplierLedger); cash prizes and
    // settlements deliberately did NOT. `actionGating.guard.test.ts` already
    // pins the SET-level invariant (ACTIONABLE ∩ NON_REVERSIBLE = ∅), which
    // catches drift between the two sets — but it cannot catch someone removing
    // LOTO_CASH_PRIZE from BOTH sets, nor does it state the intended per-type
    // behaviour anywhere a reader will see it. These three assert the actual
    // button-visibility contract directly, so "cash prizes are not refundable"
    // is a pinned fact rather than an emergent property of two other lists.
    it("a LOTO ticket sale IS reversible (the repository guard decides settled-vs-not, not the UI)", () => {
      expect(isReversibleRow(row({ type: "LOTO" }))).toBe(true);
    });

    // LIRA-388 (owner, 2026-11-11) — premise reversed: a standalone prize
    // used to be a dead end ("Can't refund here", pointing at a Loto page
    // action that never existed); it now gets "Refund" from its row.
    it("a LOTO_CASH_PRIZE IS refundable from its row (LIRA-388)", () => {
      expect(isReversibleRow(row({ type: "LOTO_CASH_PRIZE" }))).toBe(true);
    });

    it("a LOTO_SETTLEMENT is NOT reversible — no Void/Refund button is offered", () => {
      expect(isReversibleRow(row({ type: "LOTO_SETTLEMENT" }))).toBe(false);
    });
  });
});
