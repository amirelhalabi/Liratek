/**
 * Services page — the OMT commission rates and the INTRA / Western Union /
 * Whish fee tiers must come from @liratek/core, never a hand-copied table
 * (LIRA-185 display lead 11, rule 14).
 *
 * The page carried its own copies "must match omtFees.ts" — a second
 * definition nothing forced to agree with the first. If a core rate changed,
 * the form's preview would promise one commission while the repository
 * booked another. This guard fails if any of those tables (or the lookup
 * helpers built on them) is re-declared locally in the page, and if the core
 * tables are not reachable from the browser entry the frontend resolves.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "@liratek/core";

const PAGE = path.resolve(__dirname, "../index.tsx");

describe("Services page — fee tables are imported from @liratek/core", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it.each([
    "OMT_COMMISSION_RATES",
    "INTRA_FEE_TIERS",
    "WESTERN_UNION_FEE_TIERS",
    "WHISH_FEE_TIERS",
    "INTRA_LBP_MAX_AMOUNT",
  ])("does not declare its own %s", (name) => {
    expect(src).not.toMatch(new RegExp(`\\bconst\\s+${name}\\b`));
  });

  it.each(["lookupOmtFee", "lookupIntraLbpFee"])(
    "does not declare its own %s()",
    (name) => {
      expect(src).not.toMatch(new RegExp(`\\bfunction\\s+${name}\\b`));
    },
  );

  it("the core tables are exported from the browser entry the frontend resolves", () => {
    const c = core as unknown as Record<string, unknown>;
    expect(Array.isArray(c.INTRA_FEE_TIERS)).toBe(true);
    expect(Array.isArray(c.WESTERN_UNION_FEE_TIERS)).toBe(true);
    expect(Array.isArray(c.WHISH_FEE_TIERS)).toBe(true);
    expect((c.OMT_COMMISSION_RATES as Record<string, number>)?.INTRA).toBe(0.1);
    expect(typeof c.lookupOmtFee).toBe("function");
    expect(typeof c.lookupIntraLbpFee).toBe("function");
  });
});
