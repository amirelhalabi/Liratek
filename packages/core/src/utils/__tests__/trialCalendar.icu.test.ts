/**
 * LIRA-332 (research R3) — the server must really have time-zone data.
 *
 * A Node build without full ICU resolves an unknown zone to UTC (or throws),
 * and every trial would then end at 00:00 UTC — 2 or 3 hours late in
 * Beirut — with no error anywhere. This makes that fail loudly in CI.
 */

describe("ICU time-zone support", () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  it("resolves Asia/Beirut, not UTC", () => {
    expect(fmt.resolvedOptions().timeZone).toBe("Asia/Beirut");
  });

  it("knows Lebanon's summer (+3) and winter (+2) offsets", () => {
    expect(fmt.format(new Date("2026-07-15T12:00:00Z"))).toBe("15:00");
    expect(fmt.format(new Date("2026-11-01T12:00:00Z"))).toBe("14:00");
  });
});
