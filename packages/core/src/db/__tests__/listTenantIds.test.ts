/**
 * `listTenantIdsFromPlatformDb()` — brand-new module (rule 17: no "before"
 * version exists, so nothing here is proven failing-first; each test is the
 * specification instead). Real `better-sqlite3` file in a temp dir, per the
 * project convention for db-layer tests, rather than a mock — this function
 * exists specifically to be exercised against a real file by
 * `backend/src/scripts/listTenantIds.ts` inside the container.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { listTenantIdsFromPlatformDb } from "../listTenantIds.js";

function makeTmpDb(): { db: Database.Database; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-list-tenant-ids-"));
  const db = new Database(path.join(dir, "platform.db"));
  db.exec(`CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT)`);
  return { db, dir };
}

describe("listTenantIdsFromPlatformDb", () => {
  let db: Database.Database;
  let dir: string;

  afterEach(() => {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty array when the tenants table has no rows", () => {
    ({ db, dir } = makeTmpDb());
    expect(listTenantIdsFromPlatformDb(db)).toEqual([]);
  });

  it("returns every tenant id, sorted ascending regardless of insertion order", () => {
    ({ db, dir } = makeTmpDb());
    db.prepare(`INSERT INTO tenants (id, name) VALUES (5, 'Test')`).run();
    db.prepare(`INSERT INTO tenants (id, name) VALUES (1, 'CornerTech')`).run();
    db.prepare(`INSERT INTO tenants (id, name) VALUES (12, 'Newest')`).run();

    expect(listTenantIdsFromPlatformDb(db)).toEqual([1, 5, 12]);
  });
});
