/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * createCustomServiceSchema — OWNER_NOTES_REMAINING_BUILD.md #16 "Pay out"
 * refines (Route A, migration v185). A direction field, not negative
 * cost/price, so cost_usd/cost_lbp/price_usd/price_lbp keep their existing
 * .min(0) — see the module doc.
 */

import { createCustomServiceSchema } from "../customService";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    description: "Syria transfer",
    price_usd: 100,
    cost_usd: 97,
    partnerId: 1,
    partnerMode: "VIA",
    ...overrides,
  };
}

describe("createCustomServiceSchema — direction (payout)", () => {
  it("leaves direction undefined when omitted (repository treats that as 'IN')", () => {
    // Deliberately no `.default("IN")` on the schema — see its own doc
    // comment: adding a defaulted (therefore output-required) field would
    // break every existing `CreateCustomServiceInput`-typed test call site
    // that doesn't pass one. `CustomServiceRepository.createService` reads
    // `data.direction === "OUT"` / `data.direction ?? "IN"`, so `undefined`
    // behaves identically to "IN" at runtime either way.
    const parsed = createCustomServiceSchema.parse(
      baseInput({ partnerMode: undefined, partnerId: undefined }),
    );
    expect(parsed.direction).toBeUndefined();
  });

  it("accepts direction 'OUT' under partnerMode 'VIA' with both price and cost > 0", () => {
    const parsed = createCustomServiceSchema.parse(
      baseInput({ direction: "OUT" }),
    );
    expect(parsed.direction).toBe("OUT");
    expect(parsed.price_usd).toBe(100);
    expect(parsed.cost_usd).toBe(97);
  });

  it("rejects direction 'OUT' without partnerMode 'VIA' (no partner, e.g. an ordinary walk-in service)", () => {
    const result = createCustomServiceSchema.safeParse(
      baseInput({ direction: "OUT", partnerMode: undefined, partnerId: undefined }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /only valid for a Via-Partner/.test(i.message),
        ),
      ).toBe(true);
    }
  });

  it("rejects direction 'OUT' under partnerMode 'FOR' (the other partner mode)", () => {
    const result = createCustomServiceSchema.safeParse(
      baseInput({ direction: "OUT", partnerMode: "FOR" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a payout with price but no cost (nothing would leave the drawer)", () => {
    const result = createCustomServiceSchema.safeParse(
      baseInput({ direction: "OUT", cost_usd: 0, cost_lbp: 0 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /needs both the amount that arrived .* and the amount paid out/.test(
            i.message,
          ),
        ),
      ).toBe(true);
    }
  });

  it("rejects a payout with cost but no price (nothing would be owed by the partner)", () => {
    const result = createCustomServiceSchema.safeParse(
      baseInput({ direction: "OUT", price_usd: 0, price_lbp: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it("still rejects a negative cost/price under direction 'OUT' — a direction field, not negative prices (rule text)", () => {
    const result = createCustomServiceSchema.safeParse(
      baseInput({ direction: "OUT", cost_usd: -5 }),
    );
    expect(result.success).toBe(false);
  });

  it("leaves the ordinary Via-Partner IN flow unaffected (regression guard)", () => {
    const parsed = createCustomServiceSchema.parse(
      baseInput({ direction: "IN", price_usd: 15, cost_usd: 4 }),
    );
    expect(parsed.direction).toBe("IN");
  });
});
