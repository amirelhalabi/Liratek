/**
 * legMethodLabel — payment-detail row method label (checkpoint drawer naming).
 *
 * Today's generic "Checkpoint Adjustment" label collapses every checkpoint
 * reconciliation leg into one indistinguishable string, even though each leg
 * moves a DIFFERENT drawer. This names the drawer instead: "Checkpoint
 * General", "Checkpoint OMT_System", etc. Every other leg (including a
 * checkpoint leg missing `drawer_name`, e.g. a legacy pre-fix row) keeps
 * today's exact fallback expression untouched.
 *
 * `CHECKPOINT_ADJUSTMENT_METHOD` is imported from `@liratek/core` (rule 24 —
 * a test asserting a payload/constant-driven shape must take it from the
 * shared source, never retype the literal by hand).
 */
import { CHECKPOINT_ADJUSTMENT_METHOD } from "@liratek/core";
import {
  legMethodLabel,
  fallbackMethodLabel,
  formatPaymentMethods,
} from "../transactionDisplay";
import type { TransactionPaymentLeg } from "../cashFlow";

const leg = (
  overrides: Partial<TransactionPaymentLeg> = {},
): TransactionPaymentLeg => ({
  direction: "in",
  amount: 13_531,
  signed_amount: 13_531,
  currency_code: "USD",
  method: CHECKPOINT_ADJUSTMENT_METHOD,
  ...overrides,
});

describe("legMethodLabel", () => {
  it("a CHECKPOINT_ADJUSTMENT leg with a drawer_name renders 'Checkpoint <Drawer>'", () => {
    const result = legMethodLabel(leg({ drawer_name: "General" }), new Map());
    expect(result).toBe("Checkpoint General");
  });

  it("a CHECKPOINT_ADJUSTMENT leg with NO drawer_name falls back to today's expression", () => {
    const labelByCode = new Map<string, string>();
    const result = legMethodLabel(leg(), labelByCode);
    expect(result).toBe(
      labelByCode.get(CHECKPOINT_ADJUSTMENT_METHOD) ??
        fallbackMethodLabel(CHECKPOINT_ADJUSTMENT_METHOD),
    );
    expect(result).toBe("Checkpoint Adjustment");
  });

  it("a non-checkpoint leg is completely unaffected when labelByCode has an entry", () => {
    const labelByCode = new Map([["CASH", "Cash"]]);
    const cashLeg = leg({
      method: "CASH",
      drawer_name: "General",
    });
    expect(legMethodLabel(cashLeg, labelByCode)).toBe("Cash");
  });

  it("a non-checkpoint leg is completely unaffected when labelByCode has NO entry (falls back to title-case)", () => {
    const cashLeg = leg({ method: "CASH", drawer_name: "General" });
    expect(legMethodLabel(cashLeg, new Map())).toBe("Cash");
  });
});

describe("formatPaymentMethods — Method column stays drawer-agnostic (scope decision)", () => {
  it("a checkpoint spanning several drawers still collapses to one 'Checkpoint Adjustment' label, not a per-drawer list", () => {
    const legs: TransactionPaymentLeg[] = [
      leg({ drawer_name: "General" }),
      leg({ drawer_name: "OMT_System" }),
      leg({ drawer_name: "Whish_System" }),
    ];
    const labelByCode = new Map([
      [CHECKPOINT_ADJUSTMENT_METHOD, "Checkpoint Adjustment"],
    ]);
    expect(formatPaymentMethods(legs, labelByCode)).toBe(
      "Checkpoint Adjustment",
    );
  });
});
