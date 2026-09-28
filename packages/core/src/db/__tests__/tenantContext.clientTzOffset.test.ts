/**
 * Tenant context — `clientTzOffsetMinutes` carried alongside the tenant id
 * (LIRA-237). Same shape as `tenantContext.clientDay.test.ts`'s coverage of
 * `clientDay` — see that file's doc comment for the rule-27 rationale this
 * mirrors. `clientDay` (a day STRING) cannot fix `ProfitRepository`'s
 * per-row SQL bucketing on its own: `datetime(col, 'localtime')` needs a
 * numeric shift, not a label, which is what this field supplies.
 *
 * NOT proven failing-first (LIRA-223): written alongside the LIRA-237
 * plumbing it covers.
 */

import {
  runWithTenant,
  runWithoutTenant,
  getContextClientTzOffsetMinutes,
  getCurrentTenantId,
  initFixedTenantContext,
  resetTenantContext,
  CLIENT_TZ_OFFSET_MIN,
  CLIENT_TZ_OFFSET_MAX,
} from "../tenantContext";

describe("tenantContext — clientTzOffsetMinutes", () => {
  beforeEach(() => {
    resetTenantContext();
  });

  afterEach(() => {
    resetTenantContext();
  });

  describe("no context", () => {
    it("getContextClientTzOffsetMinutes() is undefined with no active scope", () => {
      expect(getContextClientTzOffsetMinutes()).toBeUndefined();
    });

    it("getContextClientTzOffsetMinutes() is undefined under the fixed (desktop) fallback", () => {
      initFixedTenantContext(1);
      expect(getCurrentTenantId()).toBe(1);
      expect(getContextClientTzOffsetMinutes()).toBeUndefined();
    });
  });

  describe("runWithTenant({ clientTzOffsetMinutes })", () => {
    it("returns the supplied offset for the extent of the scope, and undefined again outside it", () => {
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(180);
        },
        { clientTzOffsetMinutes: 180 },
      );
      expect(getContextClientTzOffsetMinutes()).toBeUndefined();
    });

    it("accepts a negative offset (west of UTC)", () => {
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(-300);
        },
        { clientTzOffsetMinutes: -300 },
      );
    });

    it("accepts a numeric-string header value (as Express headers arrive)", () => {
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(180);
        },
        { clientTzOffsetMinutes: "180" },
      );
    });

    it("rounds a fractional value to the nearest integer minute", () => {
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(180);
        },
        { clientTzOffsetMinutes: 179.6 },
      );
    });

    it("is undefined when no clientTzOffsetMinutes option is passed at all — existing callers are unaffected", () => {
      runWithTenant(7, () => {
        expect(getCurrentTenantId()).toBe(7);
        expect(getContextClientTzOffsetMinutes()).toBeUndefined();
      });
    });

    it.each([
      ["empty string", ""],
      ["not a number at all", "hello"],
      ["NaN", NaN],
      ["one minute past the max", CLIENT_TZ_OFFSET_MAX + 1],
      ["one minute past the min", CLIENT_TZ_OFFSET_MIN - 1],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
    ])(
      "silently drops an out-of-range/malformed offset (%s) rather than storing or throwing",
      (_label, malformed) => {
        runWithTenant(
          7,
          () => {
            expect(getContextClientTzOffsetMinutes()).toBeUndefined();
          },
          { clientTzOffsetMinutes: malformed as number },
        );
      },
    );

    it("accepts the exact boundary values", () => {
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(CLIENT_TZ_OFFSET_MAX);
        },
        { clientTzOffsetMinutes: CLIENT_TZ_OFFSET_MAX },
      );
      runWithTenant(
        7,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(CLIENT_TZ_OFFSET_MIN);
        },
        { clientTzOffsetMinutes: CLIENT_TZ_OFFSET_MIN },
      );
    });

    it("a nested runWithTenant with its own offset overrides the outer one for its own extent, then restores it", () => {
      runWithTenant(
        1,
        () => {
          expect(getContextClientTzOffsetMinutes()).toBe(180);
          runWithTenant(
            2,
            () => {
              expect(getContextClientTzOffsetMinutes()).toBe(-60);
            },
            { clientTzOffsetMinutes: -60 },
          );
          expect(getContextClientTzOffsetMinutes()).toBe(180);
        },
        { clientTzOffsetMinutes: 180 },
      );
    });
  });

  describe("runWithoutTenant (bypass)", () => {
    it("never carries a clientTzOffsetMinutes, even nested under a scope that has one", () => {
      runWithTenant(
        1,
        () => {
          runWithoutTenant(() => {
            expect(getContextClientTzOffsetMinutes()).toBeUndefined();
          });
        },
        { clientTzOffsetMinutes: 180 },
      );
    });
  });
});
