/**
 * Which drawer the Checkpoint window opens for right after a sign-in.
 *
 * The first drawer, in the dashboard's order with General first, whose last
 * checkpoint is not from the shop's own today (the browser's local day —
 * rule 27: never the server's). Hidden drawers (module off) are skipped,
 * exactly as the dashboard hides their cards.
 */
import { pickDrawerToCheckpoint } from "../autoCheckpoint";

const TODAY = "2026-10-07";
const visibleAll = () => true;

/** A UTC `created_at` as SQLite stamps it, for a LOCAL time on `day`. */
function stampAt(day: string, hh: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const local = new Date(y!, m! - 1, d!, hh, 30, 0);
  return local.toISOString().replace("T", " ").slice(0, 19);
}

function status(day: string, hh = 10) {
  return { drawer_name: "x", checked_at: stampAt(day, hh), amounts: {} };
}

describe("pickDrawerToCheckpoint", () => {
  it("General first, even when the dashboard lists it later", () => {
    expect(
      pickDrawerToCheckpoint(["Alfa", "Binance", "General", "OMT_System"], {}, TODAY, visibleAll),
    ).toBe("General");
  });

  it("skips a drawer already counted today and opens the next one in order", () => {
    expect(
      pickDrawerToCheckpoint(
        ["General", "OMT_System", "MTC"],
        { General: status(TODAY), OMT_System: status("2026-10-06") },
        TODAY,
        visibleAll,
      ),
    ).toBe("OMT_System");
  });

  it("uses the LOCAL day of the checkpoint: 00:30 local today counts as today", () => {
    expect(
      pickDrawerToCheckpoint(
        ["General", "MTC"],
        { General: status(TODAY, 0) },
        TODAY,
        visibleAll,
      ),
    ).toBe("MTC");
  });

  it("skips drawers whose module is off", () => {
    expect(
      pickDrawerToCheckpoint(
        ["General", "Binance", "MTC"],
        { General: status(TODAY) },
        TODAY,
        (name) => name !== "Binance",
      ),
    ).toBe("MTC");
  });

  it("null when every visible drawer was counted today", () => {
    expect(
      pickDrawerToCheckpoint(
        ["General", "MTC"],
        { General: status(TODAY), MTC: status(TODAY, 23) },
        TODAY,
        visibleAll,
      ),
    ).toBeNull();
  });

  it("null when there are no drawers", () => {
    expect(pickDrawerToCheckpoint([], null, TODAY, visibleAll)).toBeNull();
  });
});
