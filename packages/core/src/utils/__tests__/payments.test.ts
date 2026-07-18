/**
 * partitionLegs — direction-based IN/OUT split (Wave 6, S8 guard, pulled
 * forward from Phase 3).
 *
 * Every money repository (FinancialServiceRepository, RechargeRepository,
 * SalesRepository, DebtRepository) calls this ONE helper to separate a
 * `payments[]` array into customer-paid (IN) legs and shop-returned (OUT)
 * change legs before doing anything else with them (rule 16). The contract
 * is intentionally simple and is pinned here in isolation so a future change
 * to the split logic gets caught here first, before it ever reaches a
 * repository-level money test.
 */

import { partitionLegs, isReturnLeg } from "../payments";

interface TestLeg {
  method: string;
  amount: number;
  direction?: "IN" | "OUT";
}

function leg(
  method: string,
  amount: number,
  direction?: "IN" | "OUT",
): TestLeg {
  return direction ? { method, amount, direction } : { method, amount };
}

describe("partitionLegs", () => {
  it("treats a leg with no `direction` as IN (backward compatible)", () => {
    const { inLegs, outLegs } = partitionLegs([leg("CASH", 100)]);
    expect(inLegs).toEqual([leg("CASH", 100)]);
    expect(outLegs).toEqual([]);
  });

  it("treats a leg with explicit direction: 'IN' as IN", () => {
    const { inLegs, outLegs } = partitionLegs([leg("CASH", 100, "IN")]);
    expect(inLegs).toEqual([leg("CASH", 100, "IN")]);
    expect(outLegs).toEqual([]);
  });

  it("treats a leg with direction: 'OUT' as OUT", () => {
    const { inLegs, outLegs } = partitionLegs([leg("CASH", 50, "OUT")]);
    expect(inLegs).toEqual([]);
    expect(outLegs).toEqual([leg("CASH", 50, "OUT")]);
  });

  it("splits a mixed set: IN tender legs + an OUT change leg", () => {
    const payments = [
      leg("CASH", 900000),
      leg("WHISH", 20),
      leg("CASH", 5000, "OUT"),
    ];
    const { inLegs, outLegs } = partitionLegs(payments);
    expect(inLegs).toEqual([leg("CASH", 900000), leg("WHISH", 20)]);
    expect(outLegs).toEqual([leg("CASH", 5000, "OUT")]);
  });

  it("splits multiple OUT legs (mixed-currency change, S5) from multiple IN legs", () => {
    const payments = [
      leg("CASH", 1000000),
      leg("CASH", 300000, "OUT"),
      leg("BINANCE", 2, "OUT"),
    ];
    const { inLegs, outLegs } = partitionLegs(payments);
    expect(inLegs).toHaveLength(1);
    expect(outLegs).toHaveLength(2);
    expect(outLegs.map((l) => l.method)).toEqual(["CASH", "BINANCE"]);
  });

  it("returns two empty arrays for an empty payments array", () => {
    expect(partitionLegs([])).toEqual({ inLegs: [], outLegs: [] });
  });

  it("returns two empty arrays for undefined", () => {
    expect(partitionLegs(undefined)).toEqual({ inLegs: [], outLegs: [] });
  });

  it("returns two empty arrays for null", () => {
    expect(partitionLegs(null)).toEqual({ inLegs: [], outLegs: [] });
  });

  it("preserves leg order within each bucket", () => {
    const payments = [
      leg("A", 1),
      leg("B", 2, "OUT"),
      leg("C", 3),
      leg("D", 4, "OUT"),
      leg("E", 5),
    ];
    const { inLegs, outLegs } = partitionLegs(payments);
    expect(inLegs.map((l) => l.method)).toEqual(["A", "C", "E"]);
    expect(outLegs.map((l) => l.method)).toEqual(["B", "D"]);
  });
});

describe("isReturnLeg", () => {
  it("is false when direction is absent", () => {
    expect(isReturnLeg({})).toBe(false);
  });

  it("is false when direction is 'IN'", () => {
    expect(isReturnLeg({ direction: "IN" })).toBe(false);
  });

  it("is true only when direction is exactly 'OUT'", () => {
    expect(isReturnLeg({ direction: "OUT" })).toBe(true);
  });
});
