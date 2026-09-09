/**
 * Database Reset table-classification guard (LIRA-165, rule 14).
 *
 * `resetTables.ts` classifies every table `create_db.sql` declares into
 * exactly one of six buckets (KEEP / EXCLUDED / ZERO / RESEED / PARTIAL /
 * WIPE). This guard parses `create_db.sql` directly — the same "ask the
 * source, don't hand-maintain a mirror list" approach `TenantRepository
 * .tenantScopedTables()` uses for its own cascade-delete — and fails the
 * build the moment a new `CREATE TABLE` lands without a bucket decision.
 *
 * Two known extraction traps this regex must not fall into:
 *   1. `-- exist yet at CREATE TABLE time, only by the time FK enforcement
 *      runs.` (the comment directly above `product_units`) contains the
 *      literal phrase "CREATE TABLE" — `--` comment lines are stripped
 *      BEFORE matching so this line can never be mistaken for a real
 *      statement.
 *   2. `tenant_subscriptions` is a REAL table (control-plane commercial
 *      state, migration v173) that must land in KEEP, not be dismissed as
 *      a false positive.
 *
 * Failure message tells the next developer exactly what to do: classify the
 * new table in `resetTables.ts`. Leaving a ledger table out of the wipe set
 * produces data that LOOKS corrupt after a reset — e.g. a supplier owing
 * money with no transactions behind it — which is why this is a guard, not
 * a suggestion.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  RESET_KEEP_TABLES,
  RESET_EXCLUDED_TABLES,
  RESET_ZERO_TABLES,
  RESET_RESEED_TABLES,
  RESET_PARTIAL_TABLES,
  RESET_WIPE_TABLES,
  RESET_ALL_CLASSIFIED_TABLES,
} from "../resetTables";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

/** Landmark check — fails loudly (not silently) if the __dirname-relative
 *  depth above is ever wrong, instead of the guard just finding 0 tables
 *  and reporting a suspicious "everything classified" false green. */
function assertLandmark(): void {
  if (!fs.existsSync(CREATE_DB_SQL_PATH)) {
    throw new Error(
      `resetTables.guard.test.ts cannot find create_db.sql at ` +
        `${CREATE_DB_SQL_PATH} — the __dirname-relative path above no ` +
        `longer resolves to the repo root. Fix the path before trusting ` +
        `any result from this guard.`,
    );
  }
}

/**
 * Every `CREATE TABLE [IF NOT EXISTS] <name>` in `create_db.sql`, with `--`
 * line comments stripped first so a comment merely containing the phrase
 * "CREATE TABLE" can never be mistaken for a real statement. The name must
 * be followed by `(` or a newline/whitespace-then-`(` — never matched as a
 * bare substring — so a table name that happens to be a prefix of another
 * identifier cannot cause a false match either.
 */
function extractTableNames(): string[] {
  const sql = fs.readFileSync(CREATE_DB_SQL_PATH, "utf8");
  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=[(\n])/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutComments)) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

describe("resetTables classification guard (rule 14)", () => {
  beforeAll(assertLandmark);

  it("extracts a non-trivial, plausible table count (guard-is-not-blind check)", () => {
    const tables = extractTableNames();
    // create_db.sql declared 72 tables when this guard was written. A count
    // far below that means the regex went blind (e.g. a create_db.sql
    // reformat broke the comment-stripping assumption) — fail loudly rather
    // than silently "passing" a guard that is no longer checking anything.
    expect(tables.length).toBeGreaterThanOrEqual(60);
  });

  it("includes tenant_subscriptions as a real table, not a comment false-positive", () => {
    expect(extractTableNames()).toContain("tenant_subscriptions");
  });

  it("every table in create_db.sql is classified in exactly one resetTables.ts bucket", () => {
    const tables = extractTableNames();
    const buckets: Record<string, readonly string[]> = {
      RESET_KEEP_TABLES,
      RESET_EXCLUDED_TABLES,
      RESET_ZERO_TABLES,
      RESET_RESEED_TABLES,
      RESET_PARTIAL_TABLES,
      RESET_WIPE_TABLES,
    };

    const unclassified: string[] = [];
    const multiplyClassified: string[] = [];

    for (const table of tables) {
      const owningBuckets = Object.entries(buckets)
        .filter(([, members]) => members.includes(table))
        .map(([name]) => name);

      if (owningBuckets.length === 0) unclassified.push(table);
      if (owningBuckets.length > 1) {
        multiplyClassified.push(`${table} (${owningBuckets.join(", ")})`);
      }
    }

    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified table(s) found in create_db.sql, not present in any ` +
          `resetTables.ts bucket: ${unclassified.join(", ")}. Classify ` +
          `each one in packages/core/src/constants/resetTables.ts (KEEP / ` +
          `EXCLUDED / ZERO / RESEED / PARTIAL / WIPE) — leaving a ledger ` +
          `table out of the wipe set produces data that LOOKS corrupt after ` +
          `a reset (e.g. a supplier owing money with no transactions ` +
          `behind it). See docs/plans/todo_plans/DATABASE_RESET_PLAN.md.`,
      );
    }
    expect(multiplyClassified).toEqual([]);
  });

  it("no resetTables.ts bucket names a table absent from create_db.sql", () => {
    const tables = new Set(extractTableNames());
    const ghosts = RESET_ALL_CLASSIFIED_TABLES.filter((t) => !tables.has(t));
    expect(ghosts).toEqual([]);
  });

  it("the six buckets are pairwise disjoint", () => {
    const buckets: readonly (readonly string[])[] = [
      RESET_KEEP_TABLES,
      RESET_EXCLUDED_TABLES,
      RESET_ZERO_TABLES,
      RESET_RESEED_TABLES,
      RESET_PARTIAL_TABLES,
      RESET_WIPE_TABLES,
    ];
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    buckets.forEach((bucket, bucketIndex) => {
      for (const table of bucket) {
        if (seen.has(table)) {
          dupes.push(
            `${table} (buckets #${seen.get(table)} and #${bucketIndex})`,
          );
        } else {
          seen.set(table, bucketIndex);
        }
      }
    });
    expect(dupes).toEqual([]);
  });

  it("RESET_ALL_CLASSIFIED_TABLES is the exact union of all six buckets", () => {
    const union = new Set([
      ...RESET_KEEP_TABLES,
      ...RESET_EXCLUDED_TABLES,
      ...RESET_ZERO_TABLES,
      ...RESET_RESEED_TABLES,
      ...RESET_PARTIAL_TABLES,
      ...RESET_WIPE_TABLES,
    ]);
    expect(new Set(RESET_ALL_CLASSIFIED_TABLES)).toEqual(union);
  });
});
