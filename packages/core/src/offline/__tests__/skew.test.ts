/**
 * LIRA-306 T054 — PC clock correction (FR-022, R5, O-new-15).
 *
 * skew = server receipt − PC clock (measured at upload). |skew| ≤ 2 min → no
 * correction; above it the event's instant is shifted by the skew, clamped to
 * ≤ receipt and ≥ copy built − 5 min (a note on every clamp); a skew that moved
 * more than 2 min since the last online check-in → the note says the clock
 * changed; an event earlier than the PC's previous event → a note; the day is
 * recomputed from the corrected instant + the event's offset.
 */
import { correctEventTime, dayAt } from "../skew";

const MIN = 60_000;
const base = {
  occurredAt: "2026-10-10T10:10:00.000Z",
  receivedAt: "2026-10-10T10:40:00.000Z",
  copyBuiltAt: "2026-10-10T10:00:00.000Z",
  onlineSkewMs: null as number | null,
  previousOccurredAt: null as string | null,
};

describe("correctEventTime", () => {
  it("|skew| ≤ 2 min → no correction, no note", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: 2 * MIN });
    expect(r.correctedAt).toBe(base.occurredAt);
    expect(r.corrected).toBe(false);
    expect(r.note).toBeNull();
  });

  it("a PC clock 10 min slow is corrected forward, with a note", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: 10 * MIN });
    expect(r.correctedAt).toBe("2026-10-10T10:20:00.000Z");
    expect(r.corrected).toBe(true);
    expect(r.note?.text).toMatch(/10 min slow/);
  });

  it("a PC clock 7 min fast is corrected backward, with a note", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: -7 * MIN });
    expect(r.correctedAt).toBe("2026-10-10T10:03:00.000Z");
    expect(r.note?.text).toMatch(/7 min fast/);
  });

  it("never later than the server's receipt — clamped, with a note", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: 60 * MIN });
    expect(r.correctedAt).toBe(base.receivedAt);
    expect(r.clamped).toBe("receipt");
    expect(r.note?.text).toMatch(/limited/i);
  });

  it("never earlier than 5 min before the copy was built — clamped, with a note (even without correction)", () => {
    const r = correctEventTime({ ...base, occurredAt: "2026-10-10T09:50:00.000Z", uploadSkewMs: 0 });
    expect(r.correctedAt).toBe("2026-10-10T09:55:00.000Z");
    expect(r.clamped).toBe("copy");
    expect(r.note).not.toBeNull();
  });

  it("skew changed by more than 2 min since the last online check-in → the note says the clock changed (upload skew used)", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: 10 * MIN, onlineSkewMs: 0 });
    expect(r.correctedAt).toBe("2026-10-10T10:20:00.000Z");
    expect(r.clockChanged).toBe(true);
    expect(r.note?.text).toMatch(/clock changed/i);
  });

  it("an event earlier than the PC's previous event → a note, even with no correction", () => {
    const r = correctEventTime({ ...base, uploadSkewMs: 0, previousOccurredAt: "2026-10-10T10:13:00.000Z" });
    expect(r.correctedAt).toBe(base.occurredAt);
    expect(r.backwards).toBe(true);
    expect(r.note?.text).toMatch(/earlier than/i);
  });

  it("no copy row known → only the receipt bound applies", () => {
    const r = correctEventTime({ ...base, copyBuiltAt: null, occurredAt: "2026-10-09T09:00:00.000Z", uploadSkewMs: 0 });
    expect(r.correctedAt).toBe("2026-10-09T09:00:00.000Z");
    expect(r.note).toBeNull();
  });
});

describe("dayAt — the day of the corrected instant in the event's offset", () => {
  it("23:50 Beirut (UTC+3) is that day; a correction past midnight moves the day", () => {
    expect(dayAt("2026-10-10T20:50:00.000Z", 180)).toBe("2026-10-10");
    expect(dayAt("2026-10-10T21:05:00.000Z", 180)).toBe("2026-10-11");
    expect(dayAt("2026-10-10T02:00:00.000Z", -300)).toBe("2026-10-09");
  });
});
