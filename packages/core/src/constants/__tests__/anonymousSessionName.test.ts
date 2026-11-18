/**
 * LIRA-393 — the automatic basket name has ONE definition with two
 * matchers (JS regex for drill-downs, SQL GLOB for By Client). This test runs
 * both over the same names so they cannot drift (rule 14).
 */

import Database from "better-sqlite3";
import {
  counterpartLabel,
  isAnonymousSessionName,
  isAnonymousSessionNameSql,
  nextAnonymousSessionName,
} from "../anonymousSessionName";

const CASES: Array<[string, boolean]> = [
  ["Client1", true],
  ["Client7", true],
  ["Client12", true],
  ["Client07", true],
  ["Client 7", false],
  ["client7", false],
  ["CLIENT7", false],
  ["Client7b", false],
  ["Client", false],
  ["Client-7", false],
  [" Client7", false],
  ["Client7 ", false],
  ["MyClient7", false],
  ["Walk-in", false],
  ["", false],
];

describe("anonymous session name — JS and SQL matchers agree", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  it.each(CASES)("%j → %s", (name, expected) => {
    expect(isAnonymousSessionName(name)).toBe(expected);
    const row = db
      .prepare(
        `SELECT ${isAnonymousSessionNameSql("x")} AS m FROM (SELECT ? AS x)`,
      )
      .get(name) as { m: number };
    expect(row.m === 1).toBe(expected);
  });

  it("NULL is not an automatic name in either matcher", () => {
    expect(isAnonymousSessionName(null)).toBe(false);
    expect(isAnonymousSessionName(undefined)).toBe(false);
    const row = db
      .prepare(
        `SELECT COALESCE(${isAnonymousSessionNameSql("x")}, 0) AS m FROM (SELECT NULL AS x)`,
      )
      .get() as { m: number };
    expect(row.m).toBe(0);
  });
});

describe("nextAnonymousSessionName — the generator the Sessions page uses", () => {
  it("picks the first free number, and every name it makes is matched", () => {
    expect(nextAnonymousSessionName([])).toBe("Client1");
    expect(nextAnonymousSessionName(["Client1", "Client3"])).toBe("Client2");
    expect(nextAnonymousSessionName(["Client1", "Client2", "Ali"])).toBe(
      "Client3",
    );
    const names: string[] = [];
    for (let i = 0; i < 12; i++) names.push(nextAnonymousSessionName(names));
    expect(names.every(isAnonymousSessionName)).toBe(true);
  });
});

describe("counterpartLabel — one rule for every drill-down", () => {
  it("an automatic name with no client id reads Walk-in", () => {
    expect(counterpartLabel("Client4", null)).toBe("Walk-in");
    expect(counterpartLabel("Client4", undefined, null)).toBe("Walk-in");
  });
  it("an automatic name with a phone shows the phone", () => {
    expect(counterpartLabel("Client4", "70111222")).toBe("70111222");
  });
  it("a real client with an id keeps the name, even Client<N>", () => {
    expect(counterpartLabel("Client4", null, 9)).toBe("Client4");
  });
  it("typed names, phone-only and nothing behave as before", () => {
    expect(counterpartLabel("Client 7", null)).toBe("Client 7");
    expect(counterpartLabel(null, "70111222")).toBe("70111222");
    expect(counterpartLabel(null, null)).toBe("Walk-in");
    expect(counterpartLabel("", "")).toBe("Walk-in");
  });
});
