/**
 * LIRA-339 — the Vouchers page pre-checks coverage with the SAME tolerance
 * the server's reconcileLegs enforces (rule 14): what the button allows, the
 * server accepts, and what the server refuses, the button blocks.
 */
import { LEG_RECONCILIATION_EPSILON_USD } from "@liratek/core";
import { legsCover, legsMatch } from "../voucherLegs";

const RATE = 89500;
const target = { usd: 50, lbp: 0 };
const cash = (amount: number) => [{ currency_code: "USD", amount }];

describe("voucherLegs tolerance = server reconcile tolerance", () => {
  const inside = 50 - LEG_RECONCILIATION_EPSILON_USD + 0.01;
  const outside = 50 - LEG_RECONCILIATION_EPSILON_USD - 0.01;

  it("legsCover accepts a shortfall the server accepts, refuses one it refuses", () => {
    expect(legsCover(cash(inside), target, RATE)).toBe(true);
    expect(legsCover(cash(outside), target, RATE)).toBe(false);
  });

  it("legsMatch uses the same band on both sides", () => {
    expect(legsMatch(cash(inside), target, RATE)).toBe(true);
    expect(legsMatch(cash(outside), target, RATE)).toBe(false);
    expect(legsMatch(cash(100 - inside), target, RATE)).toBe(true);
    expect(legsMatch(cash(100 - outside), target, RATE)).toBe(false);
  });
});
