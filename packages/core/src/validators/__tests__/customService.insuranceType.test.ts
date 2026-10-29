/**
 * LIRA-360 — `insurance_type` on a custom-service sale.
 *
 * RULE 17 — written before the schema had the key. Server side the type is
 * optional on an insurance sale (research R12: an old browser tab or an
 * offline-queued sale must not be refused); it is refused on any other
 * category so a stray key is never silently stored.
 */
import { createCustomServiceSchema } from "../customService";

const base = { description: "Car insurance", price_usd: 100, cost_usd: 80 };

describe("createCustomServiceSchema — insurance_type", () => {
  it("keeps a valid type on an insurance sale", () => {
    const out = createCustomServiceSchema.parse({
      ...base,
      category: "insurance",
      insurance_type: "LIFE",
    });
    expect(out.insurance_type).toBe("LIFE");
  });

  it("accepts an insurance sale with no type (stored untyped)", () => {
    const out = createCustomServiceSchema.parse({
      ...base,
      category: "insurance",
    });
    expect(out.insurance_type).toBeUndefined();
  });

  it("refuses a type on any other category", () => {
    expect(
      createCustomServiceSchema.safeParse({
        ...base,
        category: "repair",
        insurance_type: "LIFE",
      }).success,
    ).toBe(false);
    expect(
      createCustomServiceSchema.safeParse({ ...base, insurance_type: "LIFE" })
        .success,
    ).toBe(false);
  });

  it("refuses an unknown type", () => {
    expect(
      createCustomServiceSchema.safeParse({
        ...base,
        category: "insurance",
        insurance_type: "MAID",
      }).success,
    ).toBe(false);
  });
});
