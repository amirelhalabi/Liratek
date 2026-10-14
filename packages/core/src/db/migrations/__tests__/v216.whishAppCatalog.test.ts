/**
 * v216 — Whish App catalog additions: added to every shop that already has a
 * catalog, never to an empty one; existing items and prices untouched;
 * idempotent; down() removes only what v216 wrote and nothing references.
 *
 * Not proven failing-first: written together with the migration.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";
import { V216_WHISH_APP_ITEMS } from "../data/v216WhishAppCatalog";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function v216() {
  const m = MIGRATIONS.find((x) => x.version === 216);
  if (!m || !m.down) throw new Error("migration v216 (with down) not found");
  return { up: m.up, down: m.down };
}

const TOTAL = Object.values(V216_WHISH_APP_ITEMS).reduce(
  (n, subs) =>
    n +
    Object.values(subs).reduce((k, items) => k + Object.keys(items).length, 0),
  0,
);

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  // create_db.sql already creates tenant 1; tenant 2 is a shop with no catalog.
  db.exec(
    `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'b', 'B')`,
  );
  return db;
}

const whishCount = (db: Database.Database, tenant: number): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM mobile_service_items WHERE tenant_id = ? AND provider = 'WHISH_APP'`,
      )
      .get(tenant) as { n: number }
  ).n;

function seedTenant1(db: Database.Database): void {
  // An already-seeded shop: one Prepaid card, plus an item v216 also carries
  // but at the shop's own price.
  const ins = db.prepare(
    `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order)
     VALUES (1, 'WHISH_APP', ?, ?, ?, ?, ?, ?)`,
  );
  ins.run("alfa", "Prepaid", "7.58", 765007, 800000, 0);
  ins.run("mtc", "Validity", "30 days", 111, 222, 0);
}

describe("v216 whish_app_catalog_additions", () => {
  it("follows v215", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 216);
    expect(MIGRATIONS[i - 1].version).toBe(215);
  });

  it("adds every missing item to a seeded shop and leaves an empty shop alone", () => {
    const db = freshDb();
    seedTenant1(db);
    v216().up(db);
    // 2 pre-existing rows; one of them ("mtc|Validity|30 days") is also an addition
    expect(whishCount(db, 1)).toBe(2 + TOTAL - 1);
    expect(whishCount(db, 2)).toBe(0);
    db.close();
  });

  it("never changes an existing item's price", () => {
    const db = freshDb();
    seedTenant1(db);
    v216().up(db);
    const row = db
      .prepare(
        `SELECT cost_lbp, sell_lbp FROM mobile_service_items
          WHERE tenant_id = 1 AND provider = 'WHISH_APP' AND category = 'mtc' AND subcategory = 'Validity' AND label = '30 days'`,
      )
      .get() as { cost_lbp: number; sell_lbp: number };
    expect(row).toEqual({ cost_lbp: 111, sell_lbp: 222 });
    db.close();
  });

  it("sells new items at cost and keeps the alfa 1.22 card's credits", () => {
    const db = freshDb();
    seedTenant1(db);
    v216().up(db);
    const card = db
      .prepare(
        `SELECT cost_lbp, sell_lbp, credits FROM mobile_service_items
          WHERE tenant_id = 1 AND provider = 'WHISH_APP' AND category = 'alfa' AND subcategory = 'Prepaid' AND label = '1.22'`,
      )
      .get() as { cost_lbp: number; sell_lbp: number; credits: number };
    expect(card.sell_lbp).toBe(card.cost_lbp);
    expect(card.credits).toBe(1.22);
    db.close();
  });

  it("is idempotent", () => {
    const db = freshDb();
    seedTenant1(db);
    v216().up(db);
    const once = whishCount(db, 1);
    v216().up(db);
    expect(whishCount(db, 1)).toBe(once);
    db.close();
  });

  it("down removes only unchanged, unreferenced additions", () => {
    const db = freshDb();
    seedTenant1(db);
    v216().up(db);
    // the shop repriced one added item: it must survive down()
    db.prepare(
      `UPDATE mobile_service_items SET sell_lbp = sell_lbp + 1
        WHERE tenant_id = 1 AND provider = 'WHISH_APP' AND category = 'Transportation' AND label = 'ACTC 100'`,
    ).run();
    v216().down(db);
    const left = db
      .prepare(
        `SELECT category || '|' || subcategory || '|' || label AS k FROM mobile_service_items
          WHERE tenant_id = 1 AND provider = 'WHISH_APP' ORDER BY k`,
      )
      .all()
      .map((r) => (r as { k: string }).k);
    expect(left).toEqual([
      "Transportation|ACTC|ACTC 100",
      "alfa|Prepaid|7.58",
      "mtc|Validity|30 days",
    ]);
    db.close();
  });
});
