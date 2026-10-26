/**
 * LIRA-348 — the Audit Log tab opens on today, 50 at a time. `search()`
 * therefore takes:
 *   - `dayFrom` / `dayTo`: the OPERATOR's days (rule 27). The old `from` /
 *     `to` compared the raw UTC string, so `to: "2026-10-26"` dropped every
 *     row OF the 26th and a 00:30 Beirut row landed on the day before.
 *   - `beforeId`: the last id the client already has (keyset on `id DESC`,
 *     the log's own order — never OFFSET), so a row written while the
 *     operator scrolls cannot shift the next page.
 *
 * Written before the repository change (rule 17).
 */
import Database from "better-sqlite3";
import { AuditRepository } from "../AuditRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: AuditRepository;

function seed(createdAt: string, tenantId = 1, summary = "row"): number {
  return Number(
    db
      .prepare(
        `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary, created_at, updated_at)
         VALUES (?, 1, 'alice', 'admin', 'CREATE', 'sale', ?, ?, ?)`,
      )
      .run(tenantId, summary, createdAt, createdAt).lastInsertRowid,
  );
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      user_id INTEGER NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL,
      action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      summary TEXT NOT NULL, old_values TEXT, new_values TEXT, metadata TEXT,
      impersonator_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new AuditRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

const BEIRUT = { clientTzOffsetMinutes: 180 };

describe("AuditRepository.search — LIRA-348 day range + keyset paging", () => {
  it("today (Beirut +180) includes a 00:30 Beirut row stored as 21:30 UTC the day before", () => {
    const at0030 = seed("2026-10-25 21:30:00"); // 00:30 Beirut, 26 Oct
    const at2300 = seed("2026-10-25 20:00:00"); // 23:00 Beirut, 25 Oct
    const at1000 = seed("2026-10-26 07:00:00"); // 10:00 Beirut, 26 Oct

    const day = (d: string) =>
      runWithTenant(1, () => repo.search({ dayFrom: d, dayTo: d }), BEIRUT);

    const today = day("2026-10-26");
    expect(today.rows.map((r) => r.id)).toEqual([at1000, at0030]);
    expect(today.total).toBe(2);
    expect(day("2026-10-25").rows.map((r) => r.id)).toEqual([at2300]);
  });

  it("pages with beforeId: no duplicate, no gap, total ignores the cursor", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7].map(() => seed("2026-10-26 07:00:01"));
    seed("2026-10-26 07:00:01", 2); // another shop

    const paged: number[] = [];
    let beforeId: number | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = runWithTenant(1, () =>
        repo.search({ limit: 3, ...(beforeId ? { beforeId } : {}) }),
      );
      expect(page.total).toBe(7);
      paged.push(...page.rows.map((r) => r.id as number));
      if (page.rows.length < 3) break;
      beforeId = page.rows[page.rows.length - 1].id as number;
    }
    expect(paged).toEqual([...ids].reverse());
  });

  it("a row written between two pages does not shift the next page", () => {
    const ids = [1, 2, 3, 4].map(() => seed("2026-10-26 07:00:01"));
    const first = runWithTenant(1, () => repo.search({ limit: 2 }));
    seed("2026-10-26 07:00:02"); // new row lands on top while scrolling
    const second = runWithTenant(1, () =>
      repo.search({ limit: 2, beforeId: first.rows[1].id as number }),
    );
    expect(second.rows.map((r) => r.id)).toEqual([ids[1], ids[0]]);
  });
});
