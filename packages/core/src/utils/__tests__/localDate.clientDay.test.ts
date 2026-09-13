/**
 * `clientDay()` (utils/localDate.ts) — the request-path counterpart to
 * `localDay()`. CLAUDE.md rule 27: `localDay()` reads the MACHINE's calendar
 * day, which is the shop's own clock on desktop but a Fly container's (no
 * `TZ`, i.e. UTC) on web — wrong for ~3h every night. `clientDay()` prefers
 * whatever day the client itself supplied via the tenant-context scope
 * (`runWithTenant()`'s `clientDay` option, set by `authenticateJWT` from the
 * `X-Client-Day` header) and only falls back to `localDay()` when nothing
 * was supplied — which is exactly what happens on desktop (no per-request
 * ALS scope is ever active there) and in any test/CLI context that never
 * calls `runWithTenant()`.
 *
 * Each case below pins a `clientDay` far from the real "today" so a test
 * that accidentally read `localDay()` instead would produce a visibly
 * different, wrong string — these cannot pass by the two values coincidentally
 * agreeing.
 */

import { clientDay, localDay } from "../localDate";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext";

describe("clientDay()", () => {
  it("returns the real machine day when called outside any tenant-context scope", () => {
    expect(clientDay()).toBe(localDay());
  });

  it("returns the context's clientDay value inside a runWithTenant scope that set one", () => {
    const pinned = "2031-07-04"; // far future — cannot coincide with "today"
    expect(pinned).not.toBe(localDay());

    runWithTenant(
      1,
      () => {
        expect(clientDay()).toBe(pinned);
      },
      { clientDay: pinned },
    );
  });

  it("falls back to localDay() inside a runWithTenant scope that did not set a clientDay", () => {
    runWithTenant(1, () => {
      expect(clientDay()).toBe(localDay());
    });
  });

  it("falls back to localDay() when the supplied value is malformed (fails CLIENT_DAY_PATTERN)", () => {
    runWithTenant(
      1,
      () => {
        expect(clientDay()).toBe(localDay());
      },
      { clientDay: "not-a-date" },
    );
  });

  it("falls back to localDay() again once the pinned scope has exited", () => {
    const pinned = "2031-07-04";
    runWithTenant(1, () => {}, { clientDay: pinned });
    expect(clientDay()).toBe(localDay());
  });

  it("is undefined-safe inside a runWithoutTenant bypass scope (never throws, falls back to localDay())", () => {
    runWithoutTenant(() => {
      expect(clientDay()).toBe(localDay());
    });
  });
});
