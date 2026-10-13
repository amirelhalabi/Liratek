/**
 * `createCheckpointSchema` — an MTC/Alfa checkpoint carries NO drawer amount.
 *
 * The carrier drawers hold USD only, and the checkpoint screen deliberately
 * leaves that USD figure out (`useDrawerCheckpoint` filters it from
 * `drawerCurrencies`): the drawer is derived server-side from the SUM of the
 * counted lines (`ClosingRepository.createCheckpoint` appends the row). So a
 * single-drawer MTC/Alfa save sends `amounts: []` plus `carrier_lines`, and
 * the schema must accept it. It used to require `amounts.min(1)`, which
 * refused every MTC/Alfa checkpoint with "At least one drawer amount is
 * required" on both transports.
 *
 * A payload with neither amounts nor lines is still refused with that message.
 */

import { createCheckpointSchema } from "../closing.js";

const carrierLine = {
  carrier_line_id: 1,
  counted_credits: 705.3,
  counted_expires_at: "2027-01-11",
};

describe("createCheckpointSchema — carrier-only checkpoint", () => {
  it("accepts empty amounts when carrier lines are counted", () => {
    const result = createCheckpointSchema.safeParse({
      drawer_name: "MTC",
      amounts: [],
      carrier_lines: [carrierLine],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["no carrier_lines key", {}],
    ["empty carrier_lines", { carrier_lines: [] }],
  ])("refuses empty amounts with %s", (_label, extra) => {
    const result = createCheckpointSchema.safeParse({
      drawer_name: "MTC",
      amounts: [],
      ...extra,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "At least one drawer amount is required",
      );
      expect(result.error.issues[0].path).toEqual(["amounts"]);
    }
  });
});
