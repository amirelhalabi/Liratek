import { isDrawerVisible } from "../drawerModules.js";

/**
 * The OTHER brand's cash drawer (Whish cash in an OMT shop, OMT cash in a
 * Whish shop).
 *
 * A shop physically keeps two drawers: General and one for its PRIMARY
 * money-transfer system. Secondary-system cash already lands in General
 * (`resolveServiceCashDrawer` only routes to a system drawer when the
 * provider IS the base system, and a walk-in on the secondary system is
 * refused). But every tenant is seeded with BOTH system drawers, and both
 * were always shown and always offered for counting — so an OMT shop saw an
 * empty "Whish cash" card and was asked to count a drawer it does not own.
 * On the test tenant that count typed $200 + 5,000,000 LBP into a drawer
 * that does not exist (2026-10-16).
 *
 * Rule: hide the secondary system's cash drawer while it holds nothing. If
 * it holds money (a typed count, older data), keep showing it so the money
 * is never hidden — moving it to General makes the card disappear.
 */
describe("secondary system cash drawer", () => {
  const allOn = () => true;

  it("hides Whish cash in an OMT shop when empty", () => {
    expect(
      isDrawerVisible("Whish_System", allOn, {
        baseSystem: "OMT",
        balances: { USD: 0, LBP: 0 },
      }),
    ).toBe(false);
  });

  it("hides OMT cash in a Whish shop when empty", () => {
    expect(
      isDrawerVisible("OMT_System", allOn, {
        baseSystem: "WHISH",
        balances: {},
      }),
    ).toBe(false);
  });

  it.each([
    ["USD", { USD: 200, LBP: 0 }],
    ["LBP", { USD: 0, LBP: 5_000_000 }],
    ["a negative balance", { USD: -10 }],
    ["another currency", { EUR: 50 }],
  ])("keeps it visible while it holds %s", (_label, balances) => {
    expect(
      isDrawerVisible("Whish_System", allOn, { baseSystem: "OMT", balances }),
    ).toBe(true);
  });

  it("ignores floating-point dust", () => {
    expect(
      isDrawerVisible("Whish_System", allOn, {
        baseSystem: "OMT",
        balances: { USD: 1e-9 },
      }),
    ).toBe(false);
  });

  it("never hides the primary system's cash drawer, even when empty", () => {
    expect(
      isDrawerVisible("OMT_System", allOn, {
        baseSystem: "OMT",
        balances: {},
      }),
    ).toBe(true);
    expect(
      isDrawerVisible("Whish_System", allOn, {
        baseSystem: "WHISH",
        balances: {},
      }),
    ).toBe(true);
  });

  it("never hides General, even when empty", () => {
    expect(
      isDrawerVisible("General", allOn, { baseSystem: "OMT", balances: {} }),
    ).toBe(true);
  });

  it("shows both system drawers while the base system or balance is unknown", () => {
    // Safe direction: a screen that has not loaded yet must not hide a drawer
    // that may hold money.
    expect(isDrawerVisible("Whish_System", allOn)).toBe(true);
    expect(
      isDrawerVisible("Whish_System", allOn, { baseSystem: "OMT" }),
    ).toBe(true);
    expect(
      isDrawerVisible("Whish_System", allOn, { balances: {} }),
    ).toBe(true);
    expect(
      isDrawerVisible("Whish_System", allOn, {
        baseSystem: null,
        balances: {},
      }),
    ).toBe(true);
  });
});
