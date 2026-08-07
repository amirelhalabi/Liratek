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

// ─────────────────────────────────────────────────────────────────────────
// LIRA-105 — unregistered payment-method code: isDrawerAffectingMethod /
// isNonCashDrawerMethod must agree with PaymentMethodRepository.isDrawerAffecting.
// ─────────────────────────────────────────────────────────────────────────
//
// PaymentMethodRepository.isDrawerAffecting(code) is `method?.affects_drawer
// === 1` — `undefined === 1` is `false` for a code with no `payment_methods`
// row. Before the fix, `isDrawerAffectingMethod`/`isNonCashDrawerMethod` in
// this file defaulted the SAME "DB reachable, code not found" case to `true`
// (via `!NON_DRAWER_METHODS.has(method)`), disagreeing with the repository.
// This mocks `getPaymentMethodRepository` so `getByCode()` resolves (no
// throw) and returns `undefined` — the exact "unregistered code" case, NOT
// the separate "DB unavailable" `catch` fallback (which intentionally keeps
// using the hardcoded map — see the sibling SessionPaymentService.basket.test.ts
// files that omit the `payment_methods` table on purpose).
const mockGetByCode = jest.fn();
jest.mock("../../repositories/PaymentMethodRepository", () => ({
  getPaymentMethodRepository: () => ({ getByCode: mockGetByCode }),
}));

import {
  partitionLegs,
  isReturnLeg,
  isDrawerAffectingMethod,
  isNonCashDrawerMethod,
} from "../payments";

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

describe("isDrawerAffectingMethod / isNonCashDrawerMethod — LIRA-105 unregistered-code fallback", () => {
  const UNREGISTERED_CODE = "TOTALLY_UNKNOWN_METHOD_XYZ";

  beforeEach(() => {
    // DB IS reachable (no throw) — it just has no row for this code. This is
    // the "unregistered code" case, distinct from the DB-unavailable `catch`
    // fallback exercised elsewhere (which must keep returning `true` for
    // known codes like CASH via the hardcoded map — untouched by this fix).
    mockGetByCode.mockReturnValue(undefined);
  });

  afterEach(() => {
    mockGetByCode.mockReset();
  });

  it("isDrawerAffectingMethod(unregistered code) is false — matches PaymentMethodRepository.isDrawerAffecting", () => {
    // PaymentMethodRepository.isDrawerAffecting: `method?.affects_drawer === 1`.
    // `undefined?.affects_drawer === 1` is `false` — the reconciled answer.
    expect(isDrawerAffectingMethod(UNREGISTERED_CODE)).toBe(false);
  });

  it("isNonCashDrawerMethod(unregistered code) is also false", () => {
    expect(isNonCashDrawerMethod(UNREGISTERED_CODE)).toBe(false);
  });

  it("both predicates AGREE for an unregistered code (the ticket's core assertion)", () => {
    expect(isDrawerAffectingMethod(UNREGISTERED_CODE)).toBe(
      isNonCashDrawerMethod(UNREGISTERED_CODE),
    );
    expect(isDrawerAffectingMethod(UNREGISTERED_CODE)).toBe(false);
  });

  it("a REGISTERED drawer-affecting code (e.g. CASH) is unaffected by this fix", () => {
    mockGetByCode.mockReturnValue({
      code: "CASH",
      affects_drawer: 1,
      drawer_name: "General",
    });
    expect(isDrawerAffectingMethod("CASH")).toBe(true);
  });

  it("a REGISTERED non-drawer code (e.g. CUSTOMER_ACCOUNT) is unaffected by this fix", () => {
    mockGetByCode.mockReturnValue({
      code: "CUSTOMER_ACCOUNT",
      affects_drawer: 0,
      drawer_name: "General",
    });
    expect(isDrawerAffectingMethod("CUSTOMER_ACCOUNT")).toBe(false);
  });
});
