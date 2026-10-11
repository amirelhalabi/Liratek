/**
 * LIRA-306 T024 — server ids must stay below the offline range (10¹²) or a
 * server row could be mistaken for a PC row and rewritten. The web server
 * refuses to start when any `sqlite_sequence` value reached it. Desktop never
 * calls this (a PC's working copy legitimately holds ids ≥ 10¹²).
 */
import Database from "better-sqlite3";
import { assertServerIdsBelowOfflineRange } from "../connection";

function db(seqs: Record<string, number>): Database.Database {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT);
          CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT);`);
  for (const [t, s] of Object.entries(seqs)) {
    d.prepare(`INSERT INTO ${t} (id, x) VALUES (?, 'r')`).run(s);
  }
  return d;
}

describe("assertServerIdsBelowOfflineRange", () => {
  it("passes when every sequence is below 10^12 (and on an empty database)", () => {
    expect(() => assertServerIdsBelowOfflineRange(db({}))).not.toThrow();
    expect(() => assertServerIdsBelowOfflineRange(db({ sales: 999_999_999_999, clients: 5 }))).not.toThrow();
  });

  it("refuses, naming the table, when a sequence reached the offline range", () => {
    expect(() => assertServerIdsBelowOfflineRange(db({ sales: 1_000_000_000_000 }))).toThrow(/sales/);
  });
});
