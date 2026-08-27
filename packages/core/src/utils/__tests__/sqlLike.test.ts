/**
 * `utils/sqlLike.ts` — LIKE metacharacter escaping (LIRA-143 item 5).
 *
 * Two layers here: the pure string function, and a real in-memory SQLite
 * `LIKE … ESCAPE` round-trip. The round-trip is the one that matters — the
 * pure function's output is only "correct" relative to what SQLite actually
 * does with it, and a plausible-looking escaper (e.g. one that forgets the
 * escape character itself) passes a naive string assertion while still
 * returning the wrong ROWS.
 */

import Database from "better-sqlite3";
import {
  escapeLike,
  LIKE_ESCAPE_CHAR,
  LIKE_ESCAPE_CLAUSE,
} from "../sqlLike.js";

describe("escapeLike", () => {
  it("leaves a term with no metacharacters untouched", () => {
    expect(escapeLike("356938035643809")).toBe("356938035643809");
    expect(escapeLike("iPhone 13 Pro")).toBe("iPhone 13 Pro");
    expect(escapeLike("")).toBe("");
  });

  it("escapes % (the any-run wildcard)", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("12%34")).toBe("12\\%34");
    expect(escapeLike("%%")).toBe("\\%\\%");
  });

  it("escapes _ (the single-character wildcard)", () => {
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("81_9")).toBe("81\\_9");
  });

  it("escapes the escape character itself, exactly once", () => {
    expect(escapeLike("\\")).toBe("\\\\");
    // ONE regex pass: the backslash this function inserts in front of the %
    // is not itself re-escaped on a second sweep.
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });

  it("exposes a matching one-character ESCAPE clause", () => {
    expect(LIKE_ESCAPE_CHAR).toHaveLength(1);
    expect(LIKE_ESCAPE_CLAUSE).toBe("ESCAPE '\\'");
  });
});

describe("escapeLike + LIKE_ESCAPE_CLAUSE against real SQLite", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE t (v TEXT NOT NULL);`);
    const insert = db.prepare(`INSERT INTO t (v) VALUES (?)`);
    for (const v of [
      "12%34567890123", // literal %
      "129999934567890", // decoy: matched by the UNESCAPED %12%34%
      "81_9000000000001", // literal _
      "8139000000000001", // decoy: matched by the UNESCAPED %81_9%
      "91\\9000000000001", // literal backslash
      "700000000000001", // plain
    ]) {
      insert.run(v);
    }
  });

  afterAll(() => db.close());

  /** The exact pair a repository is expected to use. */
  function search(term: string): string[] {
    return (
      db
        .prepare(
          `SELECT v FROM t WHERE v LIKE ? ${LIKE_ESCAPE_CLAUSE} ORDER BY v`,
        )
        .all(`%${escapeLike(term)}%`) as { v: string }[]
    ).map((r) => r.v);
  }

  /** The pre-fix shape, kept as the contrast that names the bug. */
  function searchUnescaped(term: string): string[] {
    return (
      db
        .prepare(`SELECT v FROM t WHERE v LIKE ? ORDER BY v`)
        .all(`%${term}%`) as { v: string }[]
    ).map((r) => r.v);
  }

  it("a bare % finds only the row that literally contains one", () => {
    expect(search("%")).toEqual(["12%34567890123"]);
    // Contrast: unescaped, `%%%` matches the whole table.
    expect(searchUnescaped("%")).toHaveLength(6);
  });

  it("an embedded % does not wildcard-span the decoy", () => {
    expect(search("12%34")).toEqual(["12%34567890123"]);
    expect(searchUnescaped("12%34")).toEqual([
      "12%34567890123",
      "129999934567890",
    ]);
  });

  it("an _ matches only a literal underscore", () => {
    expect(search("81_9")).toEqual(["81_9000000000001"]);
    expect(searchUnescaped("81_9")).toEqual([
      "8139000000000001",
      "81_9000000000001",
    ]);
  });

  it("a backslash matches only a literal backslash", () => {
    // Rule 17: verified RED with the `\\` case dropped from escapeLike's
    // regex (escape the two wildcards but not the escape char) — the pattern
    // degenerates to `%\%`, whose trailing `\%` is a LITERAL percent with no
    // wildcard after it, so the search returned [] instead of this row.
    expect(search("\\")).toEqual(["91\\9000000000001"]);
  });

  it("still finds an ordinary substring", () => {
    expect(search("7000000")).toEqual(["700000000000001"]);
  });
});
