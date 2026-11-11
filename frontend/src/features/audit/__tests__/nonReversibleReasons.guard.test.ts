/**
 * LIRA-079 → LIRA-388 guard: the Transactions page's "can't refund here,
 * because…" texts can never drift from core's one refund classification.
 *
 * Since LIRA-388 the reasons cover exactly the rows core plans "none" for:
 * the structural types (`NON_REFUNDABLE_TRANSACTION_TYPES`) plus the
 * row-level key `carrierLineNoValues` (a carrier-line edit that recorded no
 * previous credits). Every text must name an action that EXISTS (FR-008).
 *
 * Rule 17 disclosure: rewritten together with the reasons it guards — NOT
 * proven failing-first.
 */

// Deep import of the dependency-free constants modules — see
// actionGating.guard.test.ts for why the @liratek/core barrel can't be used
// from frontend jest.
import { NON_REFUNDABLE_TRANSACTION_TYPES } from "../../../../../packages/core/src/constants/refundKinds";
import { NON_REVERSIBLE_REASONS } from "../nonReversibleReasons";
import en from "../../../../../packages/ui/src/i18n/locales/en/audit.json";
import ar from "../../../../../packages/ui/src/i18n/locales/ar/audit.json";

const ROW_LEVEL_KEYS = ["carrierLineNoValues"];
const EXPECTED = [
  ...NON_REFUNDABLE_TRANSACTION_TYPES,
  ...ROW_LEVEL_KEYS,
].sort();

describe("NON_REVERSIBLE_REASONS ↔ core's refund classification", () => {
  it("has exactly one text per non-refundable reason key", () => {
    expect(Object.keys(NON_REVERSIBLE_REASONS).sort()).toEqual(EXPECTED);
  });

  it("the en and ar strings carry the same keys", () => {
    expect(Object.keys(en.nonReversible).sort()).toEqual(EXPECTED);
    expect(Object.keys(ar.nonReversible).sort()).toEqual(EXPECTED);
  });

  it("the page text equals the module's default text (one wording)", () => {
    for (const [k, v] of Object.entries(NON_REVERSIBLE_REASONS)) {
      expect(en.nonReversible[k as keyof typeof en.nonReversible]).toBe(v);
    }
  });

  it("every message is non-empty plain text (not a stub)", () => {
    for (const reason of Object.values(NON_REVERSIBLE_REASONS)) {
      expect(reason.length).toBeGreaterThan(10);
      expect(reason).not.toMatch(/^TODO/i);
    }
  });

  // FR-008 — no reason may point at an action that does not exist. These
  // are the pointers that were false before LIRA-388 (a prize "from the Loto
  // page", a single-row Void, a monthly-fee page, "opposite manual top-up").
  it.each([
    [/void or refund the sale/i, "the per-row Void is gone"],
    [/\bvoid (it|this)\b/i, "the per-row Void is gone"],
    [/from the Loto page/i, "no prize/settlement action lives there"],
    [/monthly-fee page/i, "there is no such page"],
    [/opposite manual top-up/i, "that action was removed in 2026-08"],
  ])("no reason says %s (%s)", (pattern) => {
    for (const reason of Object.values(NON_REVERSIBLE_REASONS)) {
      expect(reason).not.toMatch(pattern);
    }
  });
});
