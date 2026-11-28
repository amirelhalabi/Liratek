/**
 * Owner 2026-11-28 / rule 27 — a date-filtered history files each row under
 * its BUSINESS (local) day, the same day its Date / Time column shows.
 *
 * `created_at` arrives as SQLite UTC ("YYYY-MM-DD HH:MM:SS", no zone). The
 * old filter cut the raw string, i.e. the UTC day: a sale at 01:30 in Beirut
 * (22:30 UTC the day before) showed the local date but was filtered under the
 * previous day. A bare `YYYY-MM-DD` is already a day and is kept as is.
 *
 * Fixtures are built from LOCAL instants so the test holds in any timezone;
 * it only discriminates when the process zone is not UTC (run with
 * `TZ=Asia/Beirut`).
 *
 * Rule 17: run with TZ=Asia/Beirut before the fix and seen failing.
 */
import { renderHook, act } from "@testing-library/react";
import { useDateRangeFilter } from "../useDateRangeFilter";

/** A local wall-clock instant as SQLite stores it (UTC, no zone marker). */
function sqliteUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("useDateRangeFilter — business (local) day", () => {
  const rows = [
    { id: 1, created_at: sqliteUtc(new Date(2026, 8, 5, 1, 30)) },
    { id: 2, created_at: sqliteUtc(new Date(2026, 8, 4, 23, 0)) },
    { id: 3, created_at: "2026-09-05" },
  ];

  it("files a timestamp under its local day, and a bare day as is", () => {
    const { result } = renderHook(() => useDateRangeFilter(rows));
    act(() => {
      result.current.setFrom("2026-09-05");
      result.current.setTo("2026-09-05");
    });
    expect(result.current.filteredData.map((r) => r.id)).toEqual([1, 3]);
  });
});
