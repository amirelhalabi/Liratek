/**
 * LIRA-309 — the For sale list read model and details upsert.
 *
 * NOT proven failing-first (rule 17): `ResaleLineRepository` was written
 * before this file. Stated plainly rather than re-broken to manufacture a
 * red run.
 */
import Database from "better-sqlite3";
import {
  ResaleLineRepository,
  resetResaleLineRepository,
} from "../ResaleLineRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      barcode TEXT,
      name TEXT NOT NULL,
      category TEXT,
      cost_price_usd REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      stock_quantity INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE resale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      product_id INTEGER NOT NULL,
      carrier TEXT NOT NULL CHECK(carrier IN ('mtc', 'alfa')),
      credits REAL NOT NULL DEFAULT 0 CHECK(credits >= 0),
      validity_expires_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_resale_lines_product ON resale_lines(tenant_id, product_id);
    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      credits REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE drawer_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function addProduct(
  db: Database.Database,
  p: { barcode: string; name: string; category: string; stock?: number },
): number {
  const r = db
    .prepare(
      `INSERT INTO products (tenant_id, barcode, name, category, cost_price_usd, selling_price_usd, stock_quantity)
       VALUES (1, ?, ?, ?, 15, 25, ?)`,
    )
    .run(p.barcode, p.name, p.category, p.stock ?? 1);
  return Number(r.lastInsertRowid);
}

describe("ResaleLineRepository (LIRA-309)", () => {
  let db: Database.Database;
  let repo: ResaleLineRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetResaleLineRepository();
    repo = new ResaleLineRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetResaleLineRepository();
  });

  it("lists a line product with no details row as having no carrier and no expiry", () => {
    addProduct(db, { barcode: "03555101", name: "MTC line", category: "Phone Lines" });
    const rows = repo.listLines();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      phone_number: "03555101",
      resale_line_id: null,
      carrier: null,
      validity_expires_at: null,
      credits: 0,
      is_unsold: 1,
    });
  });

  it("only lists products of a lines category (whole word, not 'Online Cards')", () => {
    addProduct(db, { barcode: "03555101", name: "MTC line", category: "Phone Lines" });
    addProduct(db, { barcode: "111", name: "Netflix", category: "Online Cards" });
    addProduct(db, { barcode: "222", name: "Cable", category: "Cables" });
    expect(repo.listLines().map((r) => r.phone_number)).toEqual(["03555101"]);
  });

  it("upserts details and lists carrier, credits and expiry", () => {
    const id = addProduct(db, { barcode: "70444202", name: "Alfa line", category: "Phone Lines" });
    repo.upsertDetails(id, { carrier: "alfa", credits: 2.5, validityExpiresAt: "2026-10-20" });
    const [row] = repo.listLines();
    expect(row).toMatchObject({ carrier: "alfa", credits: 2.5, validity_expires_at: "2026-10-20" });

    repo.upsertDetails(id, { carrier: "alfa", validityExpiresAt: "2026-11-01" });
    expect(repo.getByProductId(id)).toMatchObject({ credits: 2.5, validity_expires_at: "2026-11-01" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM resale_lines`).get()).toEqual({ n: 1 });
  });

  it("leaves a sold line (stock 0) out unless includeSold", () => {
    addProduct(db, { barcode: "03555101", name: "Sold line", category: "Phone Lines", stock: 0 });
    expect(repo.listLines()).toHaveLength(0);
    const all = repo.listLines({ includeSold: true });
    expect(all).toHaveLength(1);
    expect(all[0].is_unsold).toBe(0);
  });

  it("filters by carrier", () => {
    const a = addProduct(db, { barcode: "03555101", name: "MTC line", category: "Phone Lines" });
    const b = addProduct(db, { barcode: "70444202", name: "Alfa line", category: "Phone Lines" });
    repo.upsertDetails(a, { carrier: "mtc" });
    repo.upsertDetails(b, { carrier: "alfa" });
    expect(repo.listLines({ carrier: "alfa" }).map((r) => r.product_id)).toEqual([b]);
  });

  it("C15 — saving details never touches shop lines or drawers", () => {
    db.prepare(`INSERT INTO carrier_lines (carrier, phone_number, credits) VALUES ('mtc', '03999999', 40)`).run();
    db.prepare(`INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'USD', 40)`).run();
    const snapshot = () => ({
      lines: db.prepare(`SELECT * FROM carrier_lines`).all(),
      drawers: db.prepare(`SELECT * FROM drawer_balances`).all(),
    });
    const before = snapshot();
    for (const n of ["03555101", "03555102", "03555103"]) {
      const id = addProduct(db, { barcode: n, name: `MTC ${n}`, category: "Phone Lines" });
      repo.upsertDetails(id, { carrier: "mtc", credits: 10, validityExpiresAt: "2026-12-01" });
    }
    expect(snapshot()).toEqual(before);
  });
});
