/**
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 7 — `derivePaidByMethod` is the fix
 * for the telecom/financial "stale paid_by_method on a split" bug: a
 * `lines.length === 1`-gated setter self-heals the single-leg case (the
 * sheet re-emits on mount before submit is possible) but NEVER fires for a
 * split, so whatever the (now-removed) dropdown last set kept being sent
 * even though the customer actually split the payment. Deriving straight
 * from the CURRENT legs on every call fixes both cases in one place.
 */
import { derivePaidByMethod } from "../paymentUtils";

describe("derivePaidByMethod", () => {
  it("returns the fallback (default CASH) when there are no legs", () => {
    expect(derivePaidByMethod([])).toBe("CASH");
  });

  it("returns a caller-supplied fallback when there are no legs", () => {
    expect(derivePaidByMethod([], "WHISH")).toBe("WHISH");
  });

  it("returns the single leg's own method — never the stale fallback", () => {
    expect(
      derivePaidByMethod([{ method: "CUSTOMER_ACCOUNT" }], "CASH"),
    ).toBe("CUSTOMER_ACCOUNT");
  });

  // rule 17 — the exact bug this closes: pre-fix, a form that only updated
  // `paidBy` from a `lines.length === 1` guard would keep sending whatever
  // `paidBy` last held (e.g. the removed dropdown's "CASH") once the
  // customer split into 2+ legs, because that guard never fires again.
  it("returns MULTI for 2 legs, regardless of what the fallback holds", () => {
    expect(
      derivePaidByMethod(
        [{ method: "CASH" }, { method: "CUSTOMER_ACCOUNT" }],
        "CASH",
      ),
    ).toBe("MULTI");
  });

  it("returns MULTI for 3+ legs", () => {
    expect(
      derivePaidByMethod(
        [{ method: "CASH" }, { method: "OMT" }, { method: "WHISH" }],
        "CASH",
      ),
    ).toBe("MULTI");
  });
});
