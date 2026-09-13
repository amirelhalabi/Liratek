/**
 * `createCheckpointSchema.closing_date` — the CLIENT's own local calendar day.
 *
 * Added alongside `ClosingRepository.createCheckpoint` honouring
 * `data.closing_date ?? localDay()` (see the sibling repository test). The
 * server cannot compute "the shop's today" on web (Fly boots in UTC, not the
 * shop's timezone), so the browser sends its own `localDay()` value and the
 * schema must accept a well-formed `YYYY-MM-DD` while rejecting garbage — a
 * free-form string here would let a malformed value reach the INSERT.
 */

import { createCheckpointSchema } from "../closing.js";

function baseInput(): Record<string, unknown> {
  return {
    drawer_name: "MAIN",
    amounts: [
      {
        drawer_name: "MAIN",
        currency_code: "USD",
        expected_amount: 10,
        physical_amount: 10,
      },
    ],
  };
}

describe("createCheckpointSchema — closing_date", () => {
  it("is optional — a payload without it still parses", () => {
    const result = createCheckpointSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.closing_date).toBeUndefined();
    }
  });

  it("accepts a well-formed YYYY-MM-DD value", () => {
    const result = createCheckpointSchema.safeParse({
      ...baseInput(),
      closing_date: "2026-09-13",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.closing_date).toBe("2026-09-13");
    }
  });

  it.each([
    "2026-9-13", // unpadded month
    "13-09-2026", // wrong order
    "2026/09/13", // wrong separator
    "not-a-date",
    "",
])("rejects a malformed value: %p", (bad) => {
    const result = createCheckpointSchema.safeParse({
      ...baseInput(),
      closing_date: bad,
    });
    expect(result.success).toBe(false);
  });
});
