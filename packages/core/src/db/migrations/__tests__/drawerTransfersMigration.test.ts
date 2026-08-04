/**
 * Migration v140 — rebuild_system_float_topups_as_drawer_transfers.
 *
 * Supersedes v139's `system_float_topups` (a float-model, fixed-role table:
 * `funding_drawer -> target_drawer`, `target_drawer` CHECK'd to a primary
 * cash drawer (PCD) name). Under the Primary Cash Drawer model
 * (`docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md` §8.6) `OMT_System`/
 * `Whish_System` is real physical cash, and the generic transfer mechanism
 * must run BOTH directions (General->PCD funding AND PCD->General
 * draining). SQLite cannot ALTER a CHECK constraint, so v140 rebuilds the
 * table as `drawer_transfers` with symmetric `from_drawer`/`to_drawer`
 * columns and NO CHECK on either side.
 *
 * This test proves:
 *  - up() creates `drawer_transfers` with the expected columns
 *  - up() drops the old CHECK entirely — both transfer directions insert
 *    cleanly (the capability v140 exists to add)
 *  - up() copies every pre-existing v139 row across ID-PRESERVING — rule:
 *    `transactions.source_id` for a SYSTEM_FLOAT_TOPUP/DRAWER_TRANSFER row
 *    points at this table BY ID, so a renumbering would orphan every
 *    historical transaction — with the column rename
 *    `funding_drawer -> from_drawer`, `target_drawer -> to_drawer`
 *  - down() round-trips: rebuilds `system_float_topups` with the
 *    `target_drawer` CHECK restored, and every row that had a legal home
 *    under the old CHECK comes back with matching data (id + amounts +
 *    is_refunded/refunded_at, needed for the generic void/refund path)
 *  - down() drops the rows the old CHECK could never have allowed — a
 *    PCD->General `drawer_transfers` row (`to_drawer = 'General'`) has no
 *    legal `target_drawer` value under the v139 CHECK
 *    (`CHECK (target_drawer IN ('OMT_System', 'Whish_System'))`) and is
 *    intentionally dropped rather than raising on a partial rollback
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function getMigration(version: number) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`Migration v${version} not found`);
  }
  if (!migration.down) {
    throw new Error(`Migration v${version} has no down()`);
  }
  return migration as Required<typeof migration>;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  return db;
}

/** Bring the db to "v139 applied" — the state v140.up() expects to find. */
function applyV139(db: Database.Database): void {
  getMigration(139).up(db);
}

describe("Migration v140 — rebuild_system_float_topups_as_drawer_transfers", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    applyV139(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("up()", () => {
    it("creates the drawer_transfers table with the expected columns", () => {
      getMigration(140).up(db);

      const tableInfo = db
        .prepare(`PRAGMA table_info(drawer_transfers)`)
        .all() as Array<{ name: string }>;
      const columns = tableInfo.map((c) => c.name);

      expect(columns).toEqual(
        expect.arrayContaining([
          "id",
          "tenant_id",
          "from_drawer",
          "to_drawer",
          "amount_usd",
          "amount_lbp",
          "notes",
          "created_by",
          "is_refunded",
          "refunded_at",
          "created_at",
          "updated_at",
        ]),
      );

      // The old table is gone — this is a rebuild, not an addition.
      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='system_float_topups'`,
          )
          .get(),
      ).toBeUndefined();
    });

    it("drops the old target_drawer CHECK — both transfer directions are now legal", () => {
      getMigration(140).up(db);

      // General -> PCD (the only direction v139 allowed) still works.
      expect(() =>
        db
          .prepare(
            `INSERT INTO drawer_transfers (from_drawer, to_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
          )
          .run("General", "OMT_System", 100, 0),
      ).not.toThrow();

      // PCD -> General (impossible under v139's CHECK on target_drawer) is
      // the new capability this migration exists to add.
      expect(() =>
        db
          .prepare(
            `INSERT INTO drawer_transfers (from_drawer, to_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
          )
          .run("OMT_System", "General", 50, 0),
      ).not.toThrow();
    });

    it("copies existing system_float_topups rows into drawer_transfers, id-preserving, with funding_drawer/target_drawer renamed", () => {
      // Two pre-existing v139 rows, explicit ids (autoincrement allows this).
      // Row A: fund OMT_System (id 5) — mirrors an existing "fund the float"
      // top-up, is_refunded=0.
      db.prepare(
        `INSERT INTO system_float_topups
           (id, tenant_id, target_drawer, funding_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        5,
        1,
        "OMT_System",
        "General",
        50,
        0,
        "Fund OMT drawer",
        1,
        0,
        null,
      );

      // Row B: fund Whish_System (id 12), already refunded — is_refunded/
      // refunded_at must survive since the generic void path keys on them.
      db.prepare(
        `INSERT INTO system_float_topups
           (id, tenant_id, target_drawer, funding_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        12,
        1,
        "Whish_System",
        "General",
        0,
        750000,
        "Fund Whish drawer",
        2,
        1,
        "2026-07-20 10:00:00",
      );

      getMigration(140).up(db);

      const rows = db
        .prepare(`SELECT * FROM drawer_transfers ORDER BY id`)
        .all() as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);

      // id 5 survives unchanged (transactions.source_id=5 must still resolve
      // to THIS row) with funding_drawer->from_drawer, target_drawer->to_drawer.
      expect(rows[0]).toMatchObject({
        id: 5,
        tenant_id: 1,
        from_drawer: "General",
        to_drawer: "OMT_System",
        amount_usd: 50,
        amount_lbp: 0,
        notes: "Fund OMT drawer",
        created_by: 1,
        is_refunded: 0,
      });

      // id 12 survives unchanged, including the refund marker.
      expect(rows[1]).toMatchObject({
        id: 12,
        tenant_id: 1,
        from_drawer: "General",
        to_drawer: "Whish_System",
        amount_usd: 0,
        amount_lbp: 750000,
        notes: "Fund Whish drawer",
        created_by: 2,
        is_refunded: 1,
        refunded_at: "2026-07-20 10:00:00",
      });
    });

    it("copying zero rows does not throw (fresh install / no prior float top-ups)", () => {
      expect(() => getMigration(140).up(db)).not.toThrow();
      expect(
        db.prepare(`SELECT COUNT(*) as n FROM drawer_transfers`).get(),
      ).toEqual({ n: 0 });
    });
  });

  describe("down()", () => {
    it("round-trips: recreates system_float_topups with the target_drawer CHECK restored", () => {
      getMigration(140).up(db);
      getMigration(140).down(db);

      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='system_float_topups'`,
          )
          .get(),
      ).toBeDefined();
      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='drawer_transfers'`,
          )
          .get(),
      ).toBeUndefined();

      // The CHECK is back: target_drawer must be a PCD name.
      expect(() =>
        db
          .prepare(
            `INSERT INTO system_float_topups (target_drawer, funding_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
          )
          .run("OMT_System", "General", 100, 0),
      ).not.toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO system_float_topups (target_drawer, funding_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
          )
          .run("General", "OMT_System", 100, 0),
      ).toThrow(/CHECK constraint failed/);
    });

    it("a General->PCD row (legal under the old CHECK) survives the up()+down() round trip with matching data", () => {
      db.prepare(
        `INSERT INTO system_float_topups
           (id, tenant_id, target_drawer, funding_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        5,
        1,
        "OMT_System",
        "General",
        50,
        0,
        "Fund OMT drawer",
        1,
        0,
        null,
      );

      getMigration(140).up(db);
      getMigration(140).down(db);

      const row = db
        .prepare(`SELECT * FROM system_float_topups WHERE id = 5`)
        .get() as Record<string, unknown>;

      expect(row).toMatchObject({
        id: 5,
        target_drawer: "OMT_System",
        funding_drawer: "General",
        amount_usd: 50,
        amount_lbp: 0,
        notes: "Fund OMT drawer",
        created_by: 1,
        is_refunded: 0,
      });
    });

    it("drops PCD->General rows that have no legal home under the old target_drawer CHECK", () => {
      getMigration(140).up(db);

      // Simulate a row created AFTER the v140 upgrade using the new
      // direction the old table could never represent: draining the PCD
      // back to General (to_drawer = 'General').
      db.prepare(
        `INSERT INTO drawer_transfers
           (id, tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        99,
        1,
        "OMT_System",
        "General",
        20,
        0,
        "Drain OMT to General",
        1,
        0,
        null,
      );

      getMigration(140).down(db);

      // Row 99 (to_drawer='General') has no legal target_drawer value under
      // `CHECK (target_drawer IN ('OMT_System', 'Whish_System'))` — dropped,
      // not raised, on a partial rollback.
      const row99 = db
        .prepare(`SELECT * FROM system_float_topups WHERE id = 99`)
        .get();
      expect(row99).toBeUndefined();

      // Total surviving rows = 0, since row 99 was the only row present.
      expect(
        db.prepare(`SELECT COUNT(*) as n FROM system_float_topups`).get(),
      ).toEqual({ n: 0 });
    });

    it("keeps General->PCD rows and drops only the PCD->General rows when both are present", () => {
      getMigration(140).up(db);

      db.prepare(
        `INSERT INTO drawer_transfers
           (id, tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(6, 1, "General", "Whish_System", 30, 0, "Fund Whish", 1, 0, null);

      db.prepare(
        `INSERT INTO drawer_transfers
           (id, tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp, notes, created_by, is_refunded, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(7, 1, "OMT_System", "General", 15, 0, "Drain OMT", 1, 0, null);

      getMigration(140).down(db);

      expect(
        db.prepare(`SELECT id FROM system_float_topups ORDER BY id`).all(),
      ).toEqual([{ id: 6 }]);
    });
  });
});
