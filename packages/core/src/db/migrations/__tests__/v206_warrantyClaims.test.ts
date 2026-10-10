/**
 * Migration v206 (LIRA-296 P2) `warranty_claims_defective_items_repair_warranty`:
 *   - new table `warranty_claims` (one unit per claim; exactly one of
 *     sale_item_id / maintenance_id; action, status CHECK lists);
 *   - new table `defective_items` (status CHECK list, starts HELD);
 *   - maintenance.warranty_months / warranty_until / warranty_claim_id;
 *   - stock_batch_consumptions.warranty_claim_id;
 *   - product_units.warranty_claim_id;
 *   - an index on every new foreign key.
 * up is idempotent and keeps rows; down removes everything it added.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V206 = MIGRATIONS.find((m) => m.version === 206);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
const hasTable = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name);
const hasIndex = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?`)
    .get(name);

const ADDED_COLUMNS: [string, string][] = [
  ["maintenance", "warranty_months"],
  ["maintenance", "warranty_until"],
  ["maintenance", "warranty_claim_id"],
  ["stock_batch_consumptions", "warranty_claim_id"],
  ["product_units", "warranty_claim_id"],
];
const INDEXES = [
  "idx_warranty_claims_sale_item",
  "idx_warranty_claims_maintenance",
  "idx_warranty_claims_unit",
  "idx_warranty_claims_repair_job",
  "idx_defective_items_claim",
  "idx_defective_items_product",
  "idx_maintenance_warranty_claim",
  "idx_stock_batch_consumptions_tenant_warranty_claim",
  "idx_product_units_warranty_claim",
];

/** A v205 database: create_db.sql minus everything v206 adds. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(CREATE_DB_SQL);
  for (const ix of INDEXES) db.exec(`DROP INDEX IF EXISTS ${ix}`);
  db.exec(
    `DROP TABLE IF EXISTS defective_items; DROP TABLE IF EXISTS warranty_claims;`,
  );
  for (const [t, c] of ADDED_COLUMNS) {
    if (cols(db, t).includes(c)) db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  }
  db.exec(`DELETE FROM schema_migrations WHERE version >= 206`);
  return db;
}

it("is registered right after v205", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  expect(V206?.name).toBe("warranty_claims_defective_items_repair_warranty");
  expect(versions.indexOf(206)).toBe(versions.indexOf(205) + 1);
});

describe("v206 up", () => {
  it("creates the two tables, the columns and the indexes (idempotent)", () => {
    const db = makeDb();
    V206!.up(db);
    V206!.up(db);
    expect(hasTable(db, "warranty_claims")).toBe(true);
    expect(hasTable(db, "defective_items")).toBe(true);
    for (const [t, c] of ADDED_COLUMNS) expect(cols(db, t)).toContain(c);
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(true);
    expect(cols(db, "warranty_claims")).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "sale_item_id",
        "maintenance_id",
        "unit_id",
        "quantity",
        "action",
        "status",
        "override_reason",
        "notes",
        "user_id",
        "repair_job_id",
        "replacement_unit_id",
        "refund_transaction_id",
        "voided_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(cols(db, "defective_items")).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "product_id",
        "unit_id",
        "quantity",
        "unit_cost_usd",
        "warranty_claim_id",
        "status",
        "created_at",
        "updated_at",
      ]),
    );
    db.close();
  });

  it("enforces the CHECK rules", () => {
    const db = makeDb();
    V206!.up(db);
    const claim = (over: string) =>
      db.exec(
        `INSERT INTO warranty_claims (tenant_id, sale_item_id, maintenance_id, quantity, action, status, user_id) VALUES ${over}`,
      );
    expect(() => claim(`(1, 5, NULL, 1, 'REPAIR', 'OPEN', 1)`)).not.toThrow();
    expect(() => claim(`(1, NULL, 7, 1, 'REPAIR', 'OPEN', 1)`)).not.toThrow();
    // exactly one of sale_item_id / maintenance_id
    expect(() => claim(`(1, 5, 7, 1, 'REPAIR', 'OPEN', 1)`)).toThrow();
    expect(() => claim(`(1, NULL, NULL, 1, 'REPAIR', 'OPEN', 1)`)).toThrow();
    // one unit per claim
    expect(() => claim(`(1, 5, NULL, 2, 'REPAIR', 'OPEN', 1)`)).toThrow();
    expect(() => claim(`(1, 5, NULL, 1, 'SWAP', 'OPEN', 1)`)).toThrow();
    expect(() => claim(`(1, 5, NULL, 1, 'REPAIR', 'LOST', 1)`)).toThrow();
    const defective = (status: string) =>
      db.exec(
        `INSERT INTO defective_items (tenant_id, product_id, quantity, unit_cost_usd, warranty_claim_id, status) VALUES (1, 3, 1, 4.5, 1, '${status}')`,
      );
    for (const s of [
      "HELD",
      "SENT_TO_SUPPLIER",
      "WRITTEN_OFF",
      "RETURNED_TO_STOCK",
    ]) {
      expect(() => defective(s)).not.toThrow();
    }
    expect(() => defective("GONE")).toThrow();
    db.close();
  });
});

describe("v206 down", () => {
  it("removes the tables, columns and indexes", () => {
    const db = makeDb();
    V206!.up(db);
    V206!.down!(db);
    expect(hasTable(db, "warranty_claims")).toBe(false);
    expect(hasTable(db, "defective_items")).toBe(false);
    for (const [t, c] of ADDED_COLUMNS) expect(cols(db, t)).not.toContain(c);
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(false);
    db.close();
  });
});

describe("create_db.sql mirror", () => {
  it("has v206 and its ledger row", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(hasTable(db, "warranty_claims")).toBe(true);
    expect(hasTable(db, "defective_items")).toBe(true);
    for (const [t, c] of ADDED_COLUMNS) expect(cols(db, t)).toContain(c);
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(true);
    expect(
      db
        .prepare(`SELECT name FROM schema_migrations WHERE version = 206`)
        .get(),
    ).toEqual({ name: "warranty_claims_defective_items_repair_warranty" });
    db.close();
  });
});
