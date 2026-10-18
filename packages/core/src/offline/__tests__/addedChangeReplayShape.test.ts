/**
 * LIRA-336 T003 — offline replay stays compatible after the added-change
 * fields land (research R1, sibling of extraChargeReplayShape.test.ts).
 *
 * An offline event stores the shape of the schema it was parsed with; on
 * replay the server refuses it unless every key only the server has is
 * optional WITHOUT a default (`isCompatible`). LIRA-336 adds:
 *   - `added_change_usd` / `added_change_lbp` on every payout schema;
 *   - a top-level `customerPayments` on the credit buy-back (recharge),
 *     top-up-from-client and Hold Money collect schemas.
 * An event recorded before LIRA-336 carries none of them, so it must still
 * replay — which holds only while each stays optional with no default. The
 * leg element schemas (`payments[]`) are deliberately untouched: arrays are
 * compared whole, so changing an element would refuse every older event.
 */
import { z } from "zod";
import { describeShape, isCompatible, type ShapeNode } from "../schemaShape";
import { createFinancialServiceSchema } from "../../validators/financial";
import {
  createExchangeSchema,
  exchangeSubmitSchema,
} from "../../validators/exchange";
import {
  createRechargeSchema,
  topUpFromClientSchema,
} from "../../validators/recharge";
import { holdMoneyCollectSchema } from "../../validators/holdMoney";

const ADDED_KEYS = ["added_change_usd", "added_change_lbp"] as const;

interface Case {
  name: string;
  schema: z.ZodType;
  /** Keys LIRA-336 added to this schema (customerPayments only where new). */
  newKeys: readonly string[];
}

const CASES: Case[] = [
  {
    name: "createFinancialServiceSchema",
    schema: createFinancialServiceSchema,
    newKeys: ADDED_KEYS,
  },
  {
    name: "createExchangeSchema",
    schema: createExchangeSchema,
    newKeys: ADDED_KEYS,
  },
  {
    name: "exchangeSubmitSchema",
    schema: exchangeSubmitSchema,
    newKeys: ADDED_KEYS,
  },
  {
    name: "createRechargeSchema",
    schema: createRechargeSchema,
    newKeys: [...ADDED_KEYS, "customerPayments"],
  },
  {
    name: "topUpFromClientSchema",
    schema: topUpFromClientSchema,
    newKeys: [...ADDED_KEYS, "customerPayments"],
  },
  {
    name: "holdMoneyCollectSchema",
    schema: holdMoneyCollectSchema,
    newKeys: [...ADDED_KEYS, "customerPayments"],
  },
];

function without(shape: ShapeNode, keys: readonly string[]): ShapeNode {
  const k = { ...(shape.keys ?? {}) };
  for (const key of keys) delete k[key];
  return { ...shape, keys: k };
}

describe.each(CASES)("$name — LIRA-336 replay shape", ({ schema, newKeys }) => {
  const server = describeShape(schema);

  it("added_change_usd / added_change_lbp are optional numbers with no default", () => {
    for (const k of ADDED_KEYS) {
      expect({ key: k, node: server.keys?.[k] }).toEqual({
        key: k,
        node: { type: "number", optional: true },
      });
    }
  });

  it("every new key is optional and has no default", () => {
    for (const k of newKeys) {
      const node = server.keys?.[k];
      expect({
        key: k,
        optional: node?.optional,
        hasDefault: node?.hasDefault,
      }).toEqual({
        key: k,
        optional: true,
        hasDefault: undefined,
      });
    }
  });

  it("an event recorded before LIRA-336 (none of the new keys) still replays", () => {
    expect(isCompatible(without(server, newKeys), server)).toBe(true);
  });

  it("an event recorded with the new keys replays", () => {
    expect(isCompatible(server, server)).toBe(true);
  });
});

describe("the payout leg element schemas are unchanged (offline replay)", () => {
  it("recharge / top-up / hold `payments` elements carry no customer key", () => {
    for (const schema of [
      createRechargeSchema,
      topUpFromClientSchema,
      holdMoneyCollectSchema,
    ]) {
      const el: ShapeNode | undefined =
        describeShape(schema).keys?.payments?.element;
      const inner = el?.keys ?? {};
      expect(Object.keys(inner)).not.toContain("added_change_usd");
      expect(Object.keys(inner)).not.toContain("customerPayments");
    }
  });
});
