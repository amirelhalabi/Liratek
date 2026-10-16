/**
 * v218 (LIRA-324) — Whish App USD prices: `cost_usd` / `sell_usd` columns; the
 * crawled USD price is written only where a WHISH_APP item has none yet (sell
 * starts = cost); USD-only items are added with no LBP price; a shop with no
 * catalog is left alone; idempotent; down() keeps what the shop changed or
 * what a record references, then drops the columns.
 *
 * Written before the migration (rule 17).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";
import {
  V218_USD_PRICES,
  V218_USD_ONLY_ITEMS,
} from "../data/v218WhishUsdPrices";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function v218() {
  const m = MIGRATIONS.find((x) => x.version === 218);
  if (!m || !m.down) throw new Error("migration v218 (with down) not found");
  return { up: m.up, down: m.down };
}

const cols = (db: Database.Database): string[] =>
  (
    db.prepare(`PRAGMA table_info(mobile_service_items)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);

const PRICED = V218_USD_PRICES[0];
const OTHER = V218_USD_PRICES[1];
const ONLY = V218_USD_ONLY_ITEMS[0];

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  // create_db.sql already creates tenant 1; tenant 2 is a shop with no catalog.
  db.exec(
    `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'b', 'B')`,
  );
  return db;
}

/** A seeded shop: two items v218 knows, one already priced in USD by the shop. */
function seedTenant1(db: Database.Database): void {
  const ins = db.prepare(
    `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order)
     VALUES (1, 'WHISH_APP', ?, ?, ?, ?, ?, 0)`,
  );
  ins.run(PRICED.category, PRICED.subcategory, PRICED.label, 111, 222);
  ins.run(OTHER.category, OTHER.subcategory, OTHER.label, 333, 444);
  ins.run("mtc", "Prepaid", "7.58", 765007, 800000);
}

const row = (
  db: Database.Database,
  r: { category: string; subcategory: string; label: string },
  tenant = 1,
) =>
  db
    .prepare(
      `SELECT cost_lbp, sell_lbp, cost_usd, sell_usd FROM mobile_service_items
        WHERE tenant_id = ? AND provider = 'WHISH_APP' AND category = ? AND subcategory = ? AND label = ?`,
    )
    .get(tenant, r.category, r.subcategory, r.label) as
    | {
        cost_lbp: number;
        sell_lbp: number;
        cost_usd: number | null;
        sell_usd: number | null;
      }
    | undefined;

describe("v218 whish_app_usd_prices", () => {
  it("follows v217", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 218);
    expect(MIGRATIONS[i - 1].version).toBe(217);
  });

  it("create_db.sql declares cost_usd and sell_usd (fresh install)", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toEqual(expect.arrayContaining(["cost_usd", "sell_usd"]));
    db.close();
  });

  it("prices existing items, sell = cost, and leaves every LBP column alone", () => {
    const db = freshDb();
    seedTenant1(db);
    v218().up(db);
    expect(row(db, PRICED)).toEqual({
      cost_lbp: 111,
      sell_lbp: 222,
      cost_usd: PRICED.cost_usd,
      sell_usd: PRICED.cost_usd,
    });
    db.close();
  });

  it("never overwrites a USD price the shop already set", () => {
    const db = freshDb();
    seedTenant1(db);
    db.prepare(
      `UPDATE mobile_service_items SET cost_usd = 9, sell_usd = 12
        WHERE tenant_id = 1 AND label = ?`,
    ).run(OTHER.label);
    v218().up(db);
    expect(row(db, OTHER)).toMatchObject({ cost_usd: 9, sell_usd: 12 });
    db.close();
  });

  it("adds the USD-only items with no LBP price, and never prices a Prepaid card", () => {
    const db = freshDb();
    seedTenant1(db);
    v218().up(db);
    expect(row(db, ONLY)).toEqual({
      cost_lbp: 0,
      sell_lbp: 0,
      cost_usd: ONLY.cost_usd,
      sell_usd: ONLY.cost_usd,
    });
    const added = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM mobile_service_items
            WHERE tenant_id = 1 AND provider = 'WHISH_APP' AND cost_lbp = 0 AND sell_lbp = 0 AND cost_usd IS NOT NULL`,
        )
        .get() as { n: number }
    ).n;
    expect(added).toBe(V218_USD_ONLY_ITEMS.length);
    expect(
      row(db, { category: "mtc", subcategory: "Prepaid", label: "7.58" })
        ?.cost_usd,
    ).toBeNull();
    db.close();
  });

  it("leaves a shop with no catalog alone", () => {
    const db = freshDb();
    seedTenant1(db);
    v218().up(db);
    const n = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM mobile_service_items WHERE tenant_id = 2`,
        )
        .get() as { n: number }
    ).n;
    expect(n).toBe(0);
    db.close();
  });

  it("is idempotent", () => {
    const db = freshDb();
    seedTenant1(db);
    v218().up(db);
    const count = () =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM mobile_service_items`).get() as {
          n: number;
        }
      ).n;
    const once = count();
    v218().up(db);
    expect(count()).toBe(once);
    db.close();
  });

  it("down keeps a repriced item's USD price and drops the columns", () => {
    const db = freshDb();
    seedTenant1(db);
    v218().up(db);
    // the shop repriced one USD-only item: it must survive down()
    db.prepare(
      `UPDATE mobile_service_items SET sell_usd = sell_usd + 1
        WHERE tenant_id = 1 AND label = ?`,
    ).run(ONLY.label);
    v218().down(db);
    expect(cols(db)).not.toContain("cost_usd");
    expect(cols(db)).not.toContain("sell_usd");
    const left = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM mobile_service_items
            WHERE tenant_id = 1 AND cost_lbp = 0 AND sell_lbp = 0`,
        )
        .get() as { n: number }
    ).n;
    expect(left).toBe(1); // only the repriced USD-only item stays
    db.close();
  });
});
