/**
 * UTC-column-vs-localtime-"now" guard (CLAUDE.md rule 27).
 *
 * Every timestamp column (`created_at`, `started_at`, ...) is stored in UTC.
 * SQLite's `DATE('now', 'localtime')` / `strftime(fmt, 'now', 'localtime')` —
 * used everywhere as "today" / "this month" — convert to the MACHINE's local
 * time (Beirut, UTC+3, on desktop; UTC on the Fly web backend). A predicate
 * that compares a BARE `DATE(col)` / `strftime(fmt, col)` (still UTC) against
 * that localtime-converted "now" is comparing a UTC day to a Beirut day: for
 * the three hours after local midnight (21:00-00:00 UTC) the two disagree,
 * and any "today" analytics built on the broken shape returns 0 for
 * transactions that genuinely happened that night — a nightly three-hour
 * blackout.
 *
 * Measured against the live web e2e DB at 00:44 local / 21:44 UTC:
 *   DATE(created_at)             = DATE('now','localtime')  ->  0
 *   DATE(created_at,'localtime') = DATE('now','localtime')  -> 11
 *
 * The fix is always to localtime-convert BOTH sides:
 *   DATE(created_at, 'localtime') = DATE('now', 'localtime')
 * (see `utils/localDate.ts` and `ClosingRepository.dateEqualsLocalToday()`,
 * which already document and centralize this exact convention — 37+ other
 * queries in this codebase already follow it). The six sites this guard was
 * written against (`FinancialServiceRepository.getAnalytics()`,
 * `CustomServiceRepository.getTodaySummary()`) were never exercised by an
 * offline test clock, so nothing but a source scan catches a regression here.
 *
 * `db/migrations/` is excluded — it is historical SQL that already ran
 * against a real database; rewriting it retroactively changes nothing.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");

const EXCLUDED_DIRS = new Set(["__tests__", "node_modules", "migrations"]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Matches `DATE(<col>) <op> DATE('now', 'localtime')`, or the mirrored
 * operand order, where <col> carries NO 'localtime' modifier of its own.
 * Case-insensitive: a couple of call sites spell it lowercase (`date(...)`).
 */
const BARE_DATE_VS_LOCALTIME_NOW = new RegExp(
  "DATE\\(\\s*((?!'now')[A-Za-z_][\\w.]*)\\s*\\)\\s*(?:=|<=|>=|<|>)\\s*DATE\\(\\s*'now'\\s*,\\s*'localtime'\\s*\\)" +
    "|" +
    "DATE\\(\\s*'now'\\s*,\\s*'localtime'\\s*\\)\\s*(?:=|<=|>=|<|>)\\s*DATE\\(\\s*((?!'now')[A-Za-z_][\\w.]*)\\s*\\)",
  "gi",
);

/**
 * Matches `strftime(<fmt>, <col>) = strftime(<fmt>, 'now', 'localtime')`
 * with the SAME format string on both sides (backreference), where <col>
 * carries no 'localtime' modifier.
 */
const BARE_STRFTIME_VS_LOCALTIME_NOW = new RegExp(
  "strftime\\(\\s*('[^']+')\\s*,\\s*((?!'now')[A-Za-z_][\\w.]*)\\s*\\)\\s*=\\s*strftime\\(\\s*\\1\\s*,\\s*'now'\\s*,\\s*'localtime'\\s*\\)",
  "gi",
);

interface Offense {
  file: string;
  line: number;
  text: string;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function findOffenses(source: string, rel: string): Offense[] {
  const offenses: Offense[] = [];
  for (const pattern of [
    BARE_DATE_VS_LOCALTIME_NOW,
    BARE_STRFTIME_VS_LOCALTIME_NOW,
  ]) {
    for (const match of source.matchAll(pattern)) {
      offenses.push({
        file: rel,
        line: lineOf(source, match.index ?? 0),
        text: match[0].trim(),
      });
    }
  }
  return offenses;
}

describe("no UTC column compared to a localtime-converted 'now' (rule 27 guard)", () => {
  const files = collectSourceFiles(SRC_ROOT);
  const offenses = files.flatMap((file) =>
    findOffenses(
      fs.readFileSync(file, "utf8"),
      path.relative(SRC_ROOT, file).replace(/\\/g, "/"),
    ),
  );

  it("has zero occurrences of a bare UTC column vs. localtime 'now'", () => {
    if (offenses.length > 0) {
      const message = offenses
        .map((o) => `${o.file}:${o.line}  ${o.text}`)
        .join("\n");
      throw new Error(
        `Found ${offenses.length} UTC-column-vs-localtime-'now' comparison(s). ` +
          `These compare a UTC timestamp column against SQLite's localtime-` +
          `converted 'now', which disagree for ~3h after local midnight ` +
          `(Beirut, UTC+3) and make "today"/"this month" queries return 0 ` +
          `for real transactions during that window. Add the column-side ` +
          `'localtime' modifier, e.g. ` +
          `DATE(created_at, 'localtime') = DATE('now', 'localtime'):\n${message}`,
      );
    }
  });

  it("actually scanned real source files (not vacuously empty)", () => {
    expect(files.length).toBeGreaterThan(50);
  });
});
