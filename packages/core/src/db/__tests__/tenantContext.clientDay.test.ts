/**
 * Tenant context — `clientDay` carried alongside the tenant id.
 *
 * CLAUDE.md rule 27: any server-side `localDay()` caller reached from a
 * request answers "what day is it" from the machine's own clock — correct on
 * desktop (the machine IS the shop's PC), wrong on web for ~3h/night (Fly
 * runs UTC, the shop is Beirut/UTC+3). The fix threads the CLIENT's own
 * calendar day through the SAME AsyncLocalStorage scope that already carries
 * the tenant id, set once by `authenticateJWT` from the `X-Client-Day`
 * header, instead of adding a bespoke field/param per call site.
 *
 * These tests cover the context plumbing in isolation (no DB, no
 * repository). `localDate.clientDay.test.ts` covers the `clientDay()`
 * accessor built on top of `getContextClientDay()`, and
 * `VoucherRepository.clientDay.test.ts` covers a real caller reading through
 * both.
 */

import {
  runWithTenant,
  runWithoutTenant,
  getContextClientDay,
  getCurrentTenantId,
  initFixedTenantContext,
  resetTenantContext,
  CLIENT_DAY_PATTERN,
} from "../tenantContext";

describe("tenantContext — clientDay", () => {
  beforeEach(() => {
    resetTenantContext();
  });

  afterEach(() => {
    resetTenantContext();
  });

  describe("no context", () => {
    it("getContextClientDay() is undefined with no active scope", () => {
      expect(getContextClientDay()).toBeUndefined();
    });

    it("getContextClientDay() is undefined under the fixed (desktop) fallback — it carries no day", () => {
      initFixedTenantContext(1);
      expect(getCurrentTenantId()).toBe(1);
      expect(getContextClientDay()).toBeUndefined();
    });
  });

  describe("runWithTenant({ clientDay })", () => {
    it("returns the supplied day for the extent of the scope, and undefined again outside it", () => {
      runWithTenant(7, () => {
        expect(getContextClientDay()).toBe("2026-03-01");
      }, { clientDay: "2026-03-01" });
      expect(getContextClientDay()).toBeUndefined();
    });

    it("is undefined when no clientDay option is passed at all — existing 2-arg callers are unaffected", () => {
      runWithTenant(7, () => {
        expect(getCurrentTenantId()).toBe(7);
        expect(getContextClientDay()).toBeUndefined();
      });
    });

    it.each([
      ["empty string", ""],
      ["not a date at all", "hello"],
      ["missing day", "2026-03"],
      ["wrong separators", "2026/03/01"],
      ["trailing garbage", "2026-03-01T00:00:00Z"],
      ["single-digit month/day", "2026-3-1"],
    ])(
      "silently drops a malformed clientDay (%s) rather than storing or throwing",
      (_label, malformed) => {
        runWithTenant(
          7,
          () => {
            expect(getContextClientDay()).toBeUndefined();
          },
          { clientDay: malformed },
        );
      },
    );

    it("CLIENT_DAY_PATTERN agrees with the cases above (single source of truth for the header validator)", () => {
      expect(CLIENT_DAY_PATTERN.test("2026-03-01")).toBe(true);
      expect(CLIENT_DAY_PATTERN.test("2026/03/01")).toBe(false);
      expect(CLIENT_DAY_PATTERN.test("hello")).toBe(false);
    });

    it("a nested runWithTenant with its own clientDay overrides the outer one for its own extent, then restores it", () => {
      runWithTenant(
        1,
        () => {
          expect(getContextClientDay()).toBe("2026-01-01");
          runWithTenant(
            2,
            () => {
              expect(getContextClientDay()).toBe("2026-01-02");
            },
            { clientDay: "2026-01-02" },
          );
          expect(getContextClientDay()).toBe("2026-01-01");
        },
        { clientDay: "2026-01-01" },
      );
    });

    it("a nested runWithTenant WITHOUT its own clientDay does not inherit the outer one — the ALS store is replaced, not merged", () => {
      runWithTenant(
        1,
        () => {
          expect(getContextClientDay()).toBe("2026-01-01");
          runWithTenant(2, () => {
            expect(getContextClientDay()).toBeUndefined();
          });
        },
        { clientDay: "2026-01-01" },
      );
    });
  });

  describe("runWithoutTenant (bypass)", () => {
    it("never carries a clientDay, even nested under a runWithTenant scope that has one", () => {
      runWithTenant(
        1,
        () => {
          runWithoutTenant(() => {
            expect(getContextClientDay()).toBeUndefined();
          });
        },
        { clientDay: "2026-01-01" },
      );
    });
  });
});
