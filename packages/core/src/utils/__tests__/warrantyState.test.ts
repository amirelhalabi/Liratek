/**
 * LIRA-296 (T004) — ONE warranty-state helper (rule 14).
 *
 * Replaces `ProductUnitService.computeWarrantyStatus` (LIRA-143 decision #11)
 * and the frontend `getWarrantyState`. Every case from both old suites is
 * ported here verbatim (inputs and expected answers), so the new helper is
 * proven to agree with both on everything they were ever tested on.
 *
 * Precedence: OVERRIDE > REFUND (VOID) > SALE stamp > NONE. The end date is
 * inclusive, and only the first 10 characters (`YYYY-MM-DD`) are compared.
 */
import {
  resolveWarranty,
  resolveWarrantyMonths,
  unitWarrantyDisplay,
  warrantyState,
} from "../warrantyState.js";

describe("warrantyState — ported from ProductUnitService.computeWarrantyStatus", () => {
  // Each row: [name, overrideUntil, saleRefunded, stampedUntil, today, expected]
  const cases: [
    string,
    string | null,
    boolean,
    string | null,
    string,
    {
      source: "OVERRIDE" | "REFUND" | "SALE" | null;
      until: string | null;
      state: string;
    },
  ][] = [
    [
      "override, not yet expired -> OVERRIDE/COVERED",
      "2026-12-31",
      false,
      null,
      "2026-08-25",
      { source: "OVERRIDE", until: "2026-12-31", state: "COVERED" },
    ],
    [
      "override, in the past -> OVERRIDE/EXPIRED",
      "2026-01-01",
      false,
      null,
      "2026-08-25",
      { source: "OVERRIDE", until: "2026-01-01", state: "EXPIRED" },
    ],
    [
      "no override, refunded sale -> REFUND/VOID regardless of stamped date",
      null,
      true,
      "2026-12-31",
      "2026-08-25",
      { source: "REFUND", until: null, state: "VOID" },
    ],
    [
      "override present AND sale refunded -> OVERRIDE wins outright",
      "2026-12-31",
      true,
      "2020-01-01",
      "2026-08-25",
      { source: "OVERRIDE", until: "2026-12-31", state: "COVERED" },
    ],
    [
      "no override, not refunded, stamped covered -> SALE/COVERED",
      null,
      false,
      "2026-12-31",
      "2026-08-25",
      { source: "SALE", until: "2026-12-31", state: "COVERED" },
    ],
    [
      "no override, not refunded, stamped expired -> SALE/EXPIRED",
      null,
      false,
      "2026-01-01",
      "2026-08-25",
      { source: "SALE", until: "2026-01-01", state: "EXPIRED" },
    ],
    [
      "nothing set -> NONE",
      null,
      false,
      null,
      "2026-08-25",
      { source: null, until: null, state: "NONE" },
    ],
    [
      "boundary: override until === today -> COVERED",
      "2026-08-25",
      false,
      null,
      "2026-08-25",
      { source: "OVERRIDE", until: "2026-08-25", state: "COVERED" },
    ],
    [
      "boundary: stamped until === today -> COVERED",
      null,
      false,
      "2026-08-25",
      "2026-08-25",
      { source: "SALE", until: "2026-08-25", state: "COVERED" },
    ],
  ];

  it.each(cases)("%s", (_name, overrideUntil, refunded, stamped, today, expected) => {
    expect(
      resolveWarranty(stamped, today, {
        overrideUntil,
        fullyRefunded: refunded,
      }),
    ).toEqual(expected);
    expect(
      warrantyState(stamped, today, {
        overrideUntil,
        fullyRefunded: refunded,
      }),
    ).toBe(expected.state);
  });
});

describe("warrantyState — ported from frontend getWarrantyState", () => {
  it("is NONE when there is no warranty_until at all", () => {
    expect(warrantyState(null, "2026-08-25", { fullyRefunded: false })).toBe(
      "NONE",
    );
    expect(warrantyState(undefined, "2026-08-25")).toBe("NONE");
  });

  it("is VOID when the line is refunded, regardless of the date", () => {
    expect(
      warrantyState("2027-01-01", "2026-08-25", { fullyRefunded: true }),
    ).toBe("VOID");
    expect(
      warrantyState("2020-01-01", "2026-08-25", { fullyRefunded: true }),
    ).toBe("VOID");
  });

  it("is COVERED when warranty_until is today or later", () => {
    expect(warrantyState("2026-08-25", "2026-08-25")).toBe("COVERED");
    expect(warrantyState("2027-01-01", "2026-08-25")).toBe("COVERED");
  });

  it("is EXPIRED when warranty_until is before today", () => {
    expect(warrantyState("2026-08-24", "2026-08-25")).toBe("EXPIRED");
  });

  it("compares only the date prefix of a full ISO datetime", () => {
    expect(warrantyState("2026-08-25T23:59:00Z", "2026-08-25T00:00:00Z")).toBe(
      "COVERED",
    );
    expect(
      warrantyState(null, "2026-08-26T01:00:00Z", {
        overrideUntil: "2026-08-25T23:59:00Z",
      }),
    ).toBe("EXPIRED");
  });

  it("VOID takes precedence over an otherwise-covered date", () => {
    expect(
      warrantyState("2099-01-01", "2026-08-25", { fullyRefunded: true }),
    ).toBe("VOID");
  });
});

describe("warrantyState — the one case the two old helpers disagreed on", () => {
  // computeWarrantyStatus said VOID (refund beats "no stamp"); the old
  // frontend helper said NONE (it checked the date first). The unified
  // precedence is OVERRIDE > REFUND > SALE > NONE, so it is VOID. Callers
  // that must show nothing for a line with no warranty check for a date
  // first (SaleDetailModal does).
  it("a fully refunded line with no stamped date is VOID", () => {
    expect(warrantyState(null, "2026-08-25", { fullyRefunded: true })).toBe(
      "VOID",
    );
  });
});

describe("resolveWarrantyMonths — line edit ?? product ?? category ?? none (LIRA-296)", () => {
  it.each([
    [6, 3, 1, 6],
    [0, 3, 1, 0],
    [undefined, 3, 1, 3],
    [null, 3, 1, 3],
    [undefined, null, 1, 1],
    [undefined, 0, 1, 0],
    [undefined, null, null, null],
    [undefined, undefined, undefined, null],
  ])("edit %p, product %p, category %p → %p", (edit, product, category, want) => {
    expect(resolveWarrantyMonths(edit, product, category)).toBe(want);
  });
});

/**
 * LIRA-296 follow-up (owner decision 2026-10-10) — a unit on the shelf has
 * no warranty yet: it starts when the unit is sold. So an IN_STOCK unit reads
 * NOT_SOLD whatever its stored verdict (an old refund-time override date, a
 * refunded sale's VOID, or NONE). A SOLD unit keeps its real verdict.
 */
describe("unitWarrantyDisplay", () => {
  it.each(["COVERED", "EXPIRED", "VOID", "NONE"] as const)(
    "an IN_STOCK unit reads NOT_SOLD even when its verdict is %s",
    (state) => {
      expect(
        unitWarrantyDisplay({ status: "IN_STOCK", warranty: { state } }),
      ).toBe("NOT_SOLD");
    },
  );

  it.each(["COVERED", "EXPIRED", "VOID", "NONE"] as const)(
    "a SOLD unit keeps its verdict %s",
    (state) => {
      expect(unitWarrantyDisplay({ status: "SOLD", warranty: { state } })).toBe(
        state,
      );
    },
  );
});
