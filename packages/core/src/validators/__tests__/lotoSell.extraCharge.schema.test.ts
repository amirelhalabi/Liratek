/**
 * LIRA-319 T042 — `lotoSellSchema` carries the extra and refuses the same
 * shapes the repository does, on both transports (IPC handler and
 * `POST /api/loto/sell` share this schema). Field names are the schema's own
 * (rule 24): fixtures are typed as its input.
 */
import type { z } from "zod";
import { lotoSellSchema } from "../loto";
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
} from "../common";

type Payload = z.input<typeof lotoSellSchema>;

const BASE: Payload = {
  sale_amount: 100_000,
  currency: "LBP",
  payments: [{ method: "CASH", currencyCode: "LBP", amount: 110_000 }],
};

function errors(p: Payload): string[] {
  const r = lotoSellSchema.safeParse(p);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("lotoSellSchema — extra charge (LIRA-319)", () => {
  it("keeps extra_lbp (Zod would strip an unknown key — rule 23)", () => {
    expect(lotoSellSchema.parse({ ...BASE, extra_lbp: 10_000 })).toMatchObject({
      extra_lbp: 10_000,
    });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", () => {
    const parsed = lotoSellSchema.parse(BASE);
    expect(parsed).not.toHaveProperty("extra_lbp");
    expect(parsed).not.toHaveProperty("extra_usd");
  });

  it("an extra equal to the ticket is accepted", () => {
    expect(errors({ ...BASE, extra_lbp: 100_000 })).toEqual([]);
  });

  it.each<[string, Partial<Payload>, string | RegExp]>([
    [
      "discount + extra",
      { extra_lbp: 10_000, discount_lbp: 1_000 },
      DISCOUNT_AND_EXTRA_MESSAGE,
    ],
    [
      "extra on a partner ticket",
      { extra_lbp: 10_000, partnerMode: "FOR", partnerId: 1, payments: [] },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    [
      "extra above the ticket",
      { extra_lbp: 100_001 },
      EXTRA_ABOVE_TOTAL_MESSAGE,
    ],
    ["a USD extra", { extra_usd: 1 }, /extra is in LBP/],
    [
      "a negative extra",
      { extra_lbp: -1 },
      /greater than or equal to 0|>=0|too_small/i,
    ],
  ])("refuses %s", (_name, patch, message) => {
    const errs = errors({ ...BASE, ...patch });
    expect(errs.length).toBeGreaterThan(0);
    if (typeof message === "string") expect(errs).toContain(message);
    else expect(errs.some((e) => message.test(e))).toBe(true);
  });
});
