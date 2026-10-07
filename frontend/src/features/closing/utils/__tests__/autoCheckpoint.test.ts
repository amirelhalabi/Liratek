/**
 * Which drawers the after-sign-in Checkpoint window lists.
 *
 * Owner decision 2026-10-07: ONE window lists EVERY visible drawer (General
 * first, then the dashboard's order), each marked counted-today or not, so
 * the owner counts and saves each drawer on its own. The window opens only
 * while at least one visible drawer is not counted today — "today" being the
 * shop's own local day (rule 27: never the server's). Hidden drawers (module
 * off) are left out, exactly as the dashboard hides their cards.
 */
import { listDrawersForCheckpoint } from "../autoCheckpoint";

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

describe("listDrawersForCheckpoint", () => {
  it("lists every visible drawer, General first, then the dashboard's order", () => {
    expect(
      listDrawersForCheckpoint(
        ["Alfa", "Binance", "General", "OMT_System"],
        {},
        TODAY,
        visibleAll,
      ),
    ).toEqual([
      { name: "General", countedToday: false },
      { name: "Alfa", countedToday: false },
      { name: "Binance", countedToday: false },
      { name: "OMT_System", countedToday: false },
    ]);
  });

  it("keeps a drawer already counted today in the list, marked counted", () => {
    expect(
      listDrawersForCheckpoint(
        ["General", "OMT_System", "MTC"],
        { General: status(TODAY), OMT_System: status("2026-10-06") },
        TODAY,
        visibleAll,
      ),
    ).toEqual([
      { name: "General", countedToday: true },
      { name: "OMT_System", countedToday: false },
      { name: "MTC", countedToday: false },
    ]);
  });

  it("uses the LOCAL day of the checkpoint: 00:30 local today counts as today", () => {
    expect(
      listDrawersForCheckpoint(
        ["General", "MTC"],
        { General: status(TODAY, 0) },
        TODAY,
        visibleAll,
      ),
    ).toEqual([
      { name: "General", countedToday: true },
      { name: "MTC", countedToday: false },
    ]);
  });

  it("leaves out drawers whose module is off", () => {
    expect(
      listDrawersForCheckpoint(
        ["General", "Binance", "MTC"],
        {},
        TODAY,
        (name) => name !== "Binance",
      )?.map((d) => d.name),
    ).toEqual(["General", "MTC"]);
  });

  it("null when every visible drawer was counted today (no window)", () => {
    expect(
      listDrawersForCheckpoint(
        ["General", "MTC"],
        { General: status(TODAY), MTC: status(TODAY, 23) },
        TODAY,
        visibleAll,
      ),
    ).toBeNull();
  });

  it("null when there are no drawers", () => {
    expect(listDrawersForCheckpoint([], null, TODAY, visibleAll)).toBeNull();
  });
});
