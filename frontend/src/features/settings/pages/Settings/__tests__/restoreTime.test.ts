/**
 * LIRA-377 restore picker time helpers — zone-independent: expectations are
 * built from the same instant's local getters, never a hard-coded zone.
 * NOT proven failing-first (rule 17): written with the helpers.
 */
import { browserTzOffsetMin, isoToLocalInput, localInputToUtcIso } from "../restoreTime";

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

describe("restoreTime", () => {
  it("shows a UTC instant in the browser's local wall clock", () => {
    const iso = "2026-11-10T12:39:30Z";
    expect(isoToLocalInput(iso)).toBe(local(new Date(iso)));
  });

  it("rounds the earliest moment UP to the next whole minute", () => {
    const iso = "2026-11-03T12:40:10Z";
    expect(isoToLocalInput(iso, true)).toBe(local(new Date("2026-11-03T12:41:00Z")));
    expect(isoToLocalInput("2026-11-03T12:40:00Z", true)).toBe(local(new Date("2026-11-03T12:40:00Z")));
  });

  it("sends the picked local time as a UTC instant ending in Z, round-tripping", () => {
    const picked = isoToLocalInput("2026-11-10T12:00:00Z");
    expect(localInputToUtcIso(picked)).toBe("2026-11-10T12:00:00.000Z");
    expect(localInputToUtcIso("")).toBeNull();
    expect(localInputToUtcIso("not a date")).toBeNull();
  });

  it("reports the browser's offset east-positive, never -0", () => {
    const expected = -new Date().getTimezoneOffset();
    expect(browserTzOffsetMin()).toBe(expected === 0 ? 0 : expected);
    expect(Object.is(browserTzOffsetMin(), -0)).toBe(false);
  });
});
