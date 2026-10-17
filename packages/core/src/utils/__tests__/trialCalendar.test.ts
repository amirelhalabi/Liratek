/**
 * LIRA-332 — the trial calendar (quickstart §1). Not proven failing-first:
 * this is a new contract, so before `trialCalendar.ts` existed the file only
 * failed to compile.
 *
 * Every instant below was checked with Python `zoneinfo` (2026-10-17). The
 * answers must not depend on the machine's TZ: the core runner pins
 * Asia/Beirut, Fly runs UTC, and the module uses an explicit IANA zone.
 */

import {
  SHOP_TIME_ZONE,
  TRIAL_LENGTH_DAYS,
  isCalendarDay,
  endOfShopDay,
  shopDayOf,
  startOfShopDay,
  trialEndFor,
  trialView,
} from "../trialCalendar.js";

const utc = (iso: string) => new Date(iso);

describe("constants", () => {
  it("one zone and one length (FR-002)", () => {
    expect(SHOP_TIME_ZONE).toBe("Asia/Beirut");
    expect(TRIAL_LENGTH_DAYS).toBe(14);
  });
});

describe("startOfShopDay / endOfShopDay", () => {
  it.each([
    // [day, first instant of that Beirut day]
    ["2026-07-16", "2026-07-15T21:00:00.000Z"], // summer +3
    ["2026-11-02", "2026-11-01T22:00:00.000Z"], // winter +2
    ["2026-10-25", "2026-10-24T22:00:00.000Z"], // the day after autumn DST
    // Spring DST: local 00:00 on 03-28 never exists (00:00 → 01:00). The
    // first instant of 03-28 is 22:00 UTC, NOT the naive 21:00.
    ["2027-03-28", "2027-03-27T22:00:00.000Z"],
    ["2027-11-01", "2027-10-31T22:00:00.000Z"],
  ])("%s starts at %s", (day, iso) => {
    expect(startOfShopDay(day).toISOString()).toBe(iso);
  });

  it("endOfShopDay is the start of the next day", () => {
    expect(endOfShopDay("2026-07-15").toISOString()).toBe(
      "2026-07-15T21:00:00.000Z",
    );
    expect(endOfShopDay("2027-03-27").toISOString()).toBe(
      "2027-03-27T22:00:00.000Z",
    );
    expect(endOfShopDay("2027-10-31").toISOString()).toBe(
      "2027-10-31T22:00:00.000Z",
    );
  });

  it("isCalendarDay rejects impossible dates and bad shapes", () => {
    expect(isCalendarDay("2026-10-17")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("2026-1-01")).toBe(false);
    expect(() => startOfShopDay("2026-02-30")).toThrow(RangeError);
  });
});

describe("shopDayOf", () => {
  it.each([
    ["2026-07-14T23:59:00Z", "2026-07-15"], // 02:59 Beirut summer
    ["2026-07-14T20:59:00Z", "2026-07-14"],
    ["2026-11-01T00:59:00Z", "2026-11-01"], // 02:59 Beirut winter
    ["2026-10-31T21:59:00Z", "2026-10-31"],
    ["2026-10-24T20:30:00Z", "2026-10-24"], // 23:30, first occurrence
    ["2026-10-24T21:30:00Z", "2026-10-24"], // 23:30, repeated occurrence
  ])("%s is Beirut day %s", (iso, day) => {
    expect(shopDayOf(utc(iso))).toBe(day);
  });
});

/**
 * quickstart §1, row by row. `endsAt` is the end instant for the given last
 * day (00:00 Beirut the day after).
 */
describe("trialView at the boundaries", () => {
  type Row = [
    label: string,
    lastDay: string,
    nowUtc: string,
    ended: boolean,
    daysLeft: number,
  ];
  const rows: Row[] = [
    ["summer 07-15 00:30", "2026-07-15", "2026-07-14T21:30:00Z", false, 1],
    ["summer 07-15 02:59 (server day 07-14)", "2026-07-15", "2026-07-14T23:59:00Z", false, 1],
    ["summer 07-15 23:30", "2026-07-15", "2026-07-15T20:30:00Z", false, 1],
    ["summer 07-16 00:30 (server day 07-15)", "2026-07-15", "2026-07-15T21:30:00Z", true, 0],
    ["summer 07-16 02:59", "2026-07-15", "2026-07-15T23:59:00Z", true, 0],
    ["winter 11-01 00:30", "2026-11-01", "2026-10-31T22:30:00Z", false, 1],
    ["winter 11-01 02:59", "2026-11-01", "2026-11-01T00:59:00Z", false, 1],
    ["winter 11-01 23:30", "2026-11-01", "2026-11-01T21:30:00Z", false, 1],
    ["winter 11-02 00:30", "2026-11-01", "2026-11-01T22:30:00Z", true, 0],
    ["winter 11-02 02:59", "2026-11-01", "2026-11-02T00:59:00Z", true, 0],
    ["autumn DST 10-24 23:30 (1st)", "2026-10-24", "2026-10-24T20:30:00Z", false, 1],
    ["autumn DST 10-24 23:30 (2nd)", "2026-10-24", "2026-10-24T21:30:00Z", false, 1],
    ["autumn DST 10-25 00:30", "2026-10-24", "2026-10-24T22:30:00Z", true, 0],
    ["spring DST 03-27 23:30", "2027-03-27", "2027-03-27T21:30:00Z", false, 1],
    ["spring DST 03-28 01:00", "2027-03-27", "2027-03-27T22:00:00Z", true, 0],
  ];

  it.each(rows)("%s", (_label, lastDay, nowUtc, ended, daysLeft) => {
    const endsAt = endOfShopDay(lastDay);
    const view = trialView(endsAt, utc(nowUtc));
    expect(view.lastDay).toBe(lastDay);
    expect(view.ended).toBe(ended);
    expect(view.daysLeft).toBe(daysLeft);
    expect(view.endsAt).toBe(endsAt.toISOString());
  });

  it("the end instants named in quickstart §1", () => {
    expect(endOfShopDay("2026-10-24").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(endOfShopDay("2027-03-27").toISOString()).toBe(
      "2027-03-27T22:00:00.000Z",
    );
  });

  it("accepts the stored SQLite form `YYYY-MM-DD HH:MM:SS` (UTC)", () => {
    const view = trialView("2026-11-01 22:00:00", utc("2026-11-01T21:59:59Z"));
    expect(view.lastDay).toBe("2026-11-01");
    expect(view.ended).toBe(false);
    expect(view.endsAt).toBe("2026-11-01T22:00:00.000Z");
    expect(
      trialView("2026-11-01 22:00:00", utc("2026-11-01T22:00:00Z")).ended,
    ).toBe(true);
  });
});

describe("day-count convention (research R4)", () => {
  const signup = utc("2026-10-17T07:00:00Z"); // 10:00 Beirut
  const endsAt = trialEndFor(signup);

  it("sign-up day is day 1; last day = sign-up + 13", () => {
    expect(trialView(endsAt, signup).lastDay).toBe("2026-10-30");
    expect(endsAt.toISOString()).toBe("2026-10-30T22:00:00.000Z");
    expect(trialView(endsAt, signup).daysLeft).toBe(14);
  });

  it("day 3 → 12 days left", () => {
    expect(trialView(endsAt, utc("2026-10-19T09:00:00Z")).daysLeft).toBe(12);
  });

  it("last day → 1; the day after → 0 and ended", () => {
    const last = trialView(endsAt, utc("2026-10-30T09:00:00Z"));
    expect(last.daysLeft).toBe(1);
    expect(last.ended).toBe(false);
    const after = trialView(endsAt, utc("2026-10-31T09:00:00Z"));
    expect(after.daysLeft).toBe(0);
    expect(after.ended).toBe(true);
  });

  it("a 23:50 Beirut sign-up still ends at 00:00 after day 14", () => {
    // 2026-10-17 23:50 Beirut = 20:50 UTC.
    const late = trialEndFor(utc("2026-10-17T20:50:00Z"));
    expect(late.toISOString()).toBe("2026-10-30T22:00:00.000Z");
  });

  it("endsSoon at 3, 2 and 1 days left, false at 4 and when ended", () => {
    const at = (iso: string) => trialView(endsAt, utc(iso));
    expect(at("2026-10-27T09:00:00Z").daysLeft).toBe(4);
    expect(at("2026-10-27T09:00:00Z").endsSoon).toBe(false);
    expect(at("2026-10-28T09:00:00Z").daysLeft).toBe(3);
    expect(at("2026-10-28T09:00:00Z").endsSoon).toBe(true);
    expect(at("2026-10-29T09:00:00Z").endsSoon).toBe(true);
    expect(at("2026-10-30T09:00:00Z").endsSoon).toBe(true);
    expect(at("2026-10-31T09:00:00Z").endsSoon).toBe(false);
  });
});
