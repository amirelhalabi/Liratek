/**
 * `clientTzOffsetMinutes()` (utils/requestDay.ts) — LIRA-237's request-path
 * accessor for the browser's own UTC offset. Mirrors
 * `requestDay.clientDay.test.ts`'s coverage of `clientDay()`; see that
 * file's doc comment for the rule-27 rationale.
 *
 * Unlike `clientDay()`, this has NO machine fallback (`undefined`, not
 * `-new Date().getTimezoneOffset()`) — `ProfitRepository.localtimeModifier()`
 * is the one caller, and it falls back to SQLite's own `'localtime'`
 * modifier itself, which already reads the machine's OS zone on desktop.
 *
 * NOT proven failing-first (LIRA-223): written alongside the LIRA-237
 * plumbing it covers.
 */

import { clientTzOffsetMinutes } from "../requestDay";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext";

describe("clientTzOffsetMinutes()", () => {
  it("is undefined outside any tenant-context scope", () => {
    expect(clientTzOffsetMinutes()).toBeUndefined();
  });

  it("returns the context's offset inside a runWithTenant scope that set one", () => {
    runWithTenant(
      1,
      () => {
        expect(clientTzOffsetMinutes()).toBe(180);
      },
      { clientTzOffsetMinutes: 180 },
    );
  });

  it("is undefined inside a runWithTenant scope that did not set an offset", () => {
    runWithTenant(1, () => {
      expect(clientTzOffsetMinutes()).toBeUndefined();
    });
  });

  it("is undefined when the supplied value is out of range", () => {
    runWithTenant(
      1,
      () => {
        expect(clientTzOffsetMinutes()).toBeUndefined();
      },
      { clientTzOffsetMinutes: 9999 },
    );
  });

  it("is undefined again once the scope has exited", () => {
    runWithTenant(1, () => {}, { clientTzOffsetMinutes: 180 });
    expect(clientTzOffsetMinutes()).toBeUndefined();
  });

  it("is undefined-safe inside a runWithoutTenant bypass scope", () => {
    runWithoutTenant(() => {
      expect(clientTzOffsetMinutes()).toBeUndefined();
    });
  });
});
