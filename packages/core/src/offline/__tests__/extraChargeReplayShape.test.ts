/**
 * LIRA-319 T009 — offline replay stays compatible after the extra-charge
 * fields land (research R4).
 *
 * An offline event stores the shape of the schema it was parsed with. On
 * replay the server refuses it unless every key only the server has is
 * optional WITHOUT a default (`isCompatible`). `extra_usd` / `extra_lbp` are
 * new server-only keys, so an event recorded before LIRA-319 must still be
 * compatible — which holds only while both stay `.optional()` with no
 * `.default()`.
 *
 * Table-driven: later modules append their schema to `SCHEMAS` (contracts/
 * write-payloads.md lists all seven).
 */
import { z } from "zod";
import { describeShape, isCompatible, type ShapeNode } from "../schemaShape";
import { saleProcessSchema } from "../../validators/sale";
import { createRechargeSchema } from "../../validators/recharge";
import { createCustomServiceSchema } from "../../validators/customService";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { lotoSellSchema } from "../../validators/loto";
import { createFinancialServiceSchema } from "../../validators/financial";
import { sessionCheckoutSchema } from "../../validators/session";

const EXTRA_KEYS = ["extra_usd", "extra_lbp"] as const;

const SCHEMAS: { name: string; schema: z.ZodType }[] = [
  { name: "saleProcessSchema", schema: saleProcessSchema },
  { name: "createRechargeSchema", schema: createRechargeSchema },
  { name: "createCustomServiceSchema", schema: createCustomServiceSchema },
  { name: "saveMaintenanceJobSchema", schema: saveMaintenanceJobSchema },
  { name: "lotoSellSchema", schema: lotoSellSchema },
  { name: "createFinancialServiceSchema", schema: createFinancialServiceSchema },
];

/** The shape a pre-LIRA-319 event carries: today's shape minus the extra keys. */
function withoutExtraKeys(shape: ShapeNode): ShapeNode {
  const keys = { ...(shape.keys ?? {}) };
  for (const k of EXTRA_KEYS) delete keys[k];
  return { ...shape, keys };
}

describe.each(SCHEMAS)("$name — extra_usd / extra_lbp replay shape", ({ schema }) => {
  const server = describeShape(schema);

  it("has both extra keys, optional and without a default", () => {
    for (const k of EXTRA_KEYS) {
      expect({ key: k, node: server.keys?.[k] }).toEqual({
        key: k,
        node: { type: "number", optional: true },
      });
    }
  });

  it("an event recorded before LIRA-319 (no extra keys) is still compatible", () => {
    expect(isCompatible(withoutExtraKeys(server), server)).toBe(true);
  });

  it("an event recorded with the extra keys is compatible", () => {
    expect(isCompatible(server, server)).toBe(true);
  });
});

describe("the check catches a .default() on an extra key", () => {
  it("a server copy with extra_usd.default(0) refuses a pre-LIRA-319 event", () => {
    const base = z.object({ total: z.number() });
    const good = base.extend({ extra_usd: z.number().nonnegative().optional() });
    const bad = base.extend({ extra_usd: z.number().nonnegative().default(0) });
    const oldEvent = describeShape(base);
    expect(isCompatible(oldEvent, describeShape(good))).toBe(true);
    expect(isCompatible(oldEvent, describeShape(bad))).toBe(false);
  });
});

// Custom Services also gained `discount_usd` / `discount_lbp` (LIRA-319: the
// server must see a discount to refuse "discount and extra"). Same rule: an
// event recorded before LIRA-319 carries neither, so both must stay optional
// with no default.
describe("createCustomServiceSchema — discount_usd / discount_lbp replay shape", () => {
  const DISCOUNT_KEYS = ["discount_usd", "discount_lbp"] as const;
  const server = describeShape(createCustomServiceSchema);

  it("both discount keys are optional without a default", () => {
    for (const k of DISCOUNT_KEYS) {
      expect({ key: k, node: server.keys?.[k] }).toEqual({
        key: k,
        node: { type: "number", optional: true },
      });
    }
  });

  it("an event recorded before LIRA-319 (no extra or discount keys) is still compatible", () => {
    const keys = { ...(server.keys ?? {}) };
    for (const k of [...EXTRA_KEYS, ...DISCOUNT_KEYS]) delete keys[k];
    expect(isCompatible({ ...server, keys }, server)).toBe(true);
  });
});

// LIRA-341 — the session checkout gained `discount_usd` / `discount_lbp` (the
// basket discount). Same rule: a checkout recorded offline before LIRA-341
// carries neither, so both must stay optional with no default. (Written
// after the fields landed — not proven failing-first.)
describe("sessionCheckoutSchema — discount_usd / discount_lbp replay shape", () => {
  const DISCOUNT_KEYS = ["discount_usd", "discount_lbp"] as const;
  const server = describeShape(sessionCheckoutSchema);

  it("both discount keys are optional without a default", () => {
    for (const k of DISCOUNT_KEYS) {
      expect({ key: k, node: server.keys?.[k] }).toEqual({
        key: k,
        node: { type: "number", optional: true },
      });
    }
  });

  it("a checkout recorded before LIRA-341 (no discount keys) is still compatible", () => {
    const keys = { ...(server.keys ?? {}) };
    for (const k of DISCOUNT_KEYS) delete keys[k];
    expect(isCompatible({ ...server, keys }, server)).toBe(true);
  });
});
