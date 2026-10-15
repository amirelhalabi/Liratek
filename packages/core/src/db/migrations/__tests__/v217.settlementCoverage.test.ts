/**
 * LIRA-322 v217 — supplier_settlement_coverage: what one settlement applied
 * to one OMT-account queue row, in one currency, from one source.
 * Columns, CHECKs and indexes per specs/322-omt-amount-first-settle/data-model.md.
 *
 * Rule 17: written BEFORE the migration and run against the code without it.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const TABLE = "supplier_settlement_coverage";

type Col = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function v217() {
  const m = MIGRATIONS.find((x) => x.version === 217);
  if (!m) throw new Error("migration v217 not found");
  return m;
}

function hasTable(db: Database.Database): boolean {
  return !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(TABLE);
}

function cols(db: Database.Database): Col[] {
  return db.prepare(`PRAGMA table_info(${TABLE})`).all() as Col[];
}

function indexColumns(db: Database.Database): string[][] {
  const idx = db.prepare(`PRAGMA index_list(${TABLE})`).all() as Array<{
    name: string;
    origin: string;
  }>;
  return idx
    .filter((i) => i.origin === "c")
    .map((i) =>
      (
        db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{
          seqno: number;
          name: string;
        }>
      )
        .sort((a, b) => a.seqno - b.seqno)
        .map((c) => c.name),
    );
}

function freshPreV217(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
  return db;
}

const insert = (
  db: Database.Database,
  over: Partial<{
    row_kind: string;
    currency: string;
    amount: number;
    source: string;
  }> = {},
) =>
  db
    .prepare(
      `INSERT INTO ${TABLE}
         (tenant_id, transaction_id, anchor_ledger_id, row_kind, row_id,
          member_supplier_id, currency, amount, source)
       VALUES (1, 10, 20, ?, 30, 40, ?, ?, ?)`,
    )
    .run(
      over.row_kind ?? "FINANCIAL_SERVICE",
      over.currency ?? "USD",
      over.amount ?? 47,
      over.source ?? "PAYMENT",
    );

function assertShape(db: Database.Database): void {
  const c = cols(db);
  const byName = new Map(c.map((x) => [x.name, x]));
  expect(c.map((x) => x.name)).toEqual([
    "id",
    "tenant_id",
    "transaction_id",
    "anchor_ledger_id",
    "row_kind",
    "row_id",
    "member_supplier_id",
    "currency",
    "amount",
    "source",
    "closes_row",
    "is_reversed",
    "created_at",
    "updated_at",
  ]);
  expect(byName.get("id")!.pk).toBe(1);
  for (const n of [
    "tenant_id",
    "transaction_id",
    "anchor_ledger_id",
    "row_kind",
    "row_id",
    "member_supplier_id",
    "currency",
    "amount",
    "source",
    "closes_row",
    "is_reversed",
    "created_at",
    "updated_at",
  ]) {
    expect({ n, notnull: byName.get(n)!.notnull }).toEqual({ n, notnull: 1 });
  }
  expect(byName.get("amount")!.type).toBe("REAL");
  expect(byName.get("closes_row")!.dflt_value).toBe("0");
  expect(byName.get("is_reversed")!.dflt_value).toBe("0");
  expect(byName.get("created_at")!.dflt_value).toBe("datetime('now')");
  expect(byName.get("updated_at")!.dflt_value).toBe("datetime('now')");

  const idx = indexColumns(db);
  expect(idx).toEqual(
    expect.arrayContaining([
      ["tenant_id", "row_kind", "row_id", "is_reversed"],
      ["tenant_id", "transaction_id"],
    ]),
  );
}

describe("v217 supplier_settlement_coverage", () => {
  it("follows v216", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 217);
    expect(i).toBeGreaterThan(0);
    expect(MIGRATIONS[i - 1].version).toBe(216);
    expect(v217().name).toBe("supplier_settlement_coverage");
    expect(typeof v217().down).toBe("function");
  });

  it("the fresh schema (create_db.sql) declares the table, its CHECKs and indexes", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(hasTable(db)).toBe(true);
    assertShape(db);
    db.close();
  });

  describe("up() on an older DB", () => {
    let db: Database.Database;
    beforeEach(() => {
      db = freshPreV217();
      v217().up(db);
      db.pragma("foreign_keys = OFF");
    });
    afterEach(() => db.close());

    it("creates the table with the columns, defaults and indexes", () => {
      expect(hasTable(db)).toBe(true);
      assertShape(db);
    });

    it("defaults closes_row/is_reversed to 0 and stamps created_at/updated_at", () => {
      insert(db);
      const row = db
        .prepare(
          `SELECT closes_row, is_reversed, created_at, updated_at FROM ${TABLE}`,
        )
        .get() as {
        closes_row: number;
        is_reversed: number;
        created_at: string;
        updated_at: string;
      };
      expect(row.closes_row).toBe(0);
      expect(row.is_reversed).toBe(0);
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it("rejects amount = 0, currency EUR, an unknown row_kind or source", () => {
      expect(() => insert(db)).not.toThrow();
      expect(() => insert(db, { currency: "LBP", source: "NETTING" })).not.toThrow();
      expect(() => insert(db, { row_kind: "LEDGER", source: "COMMISSION" })).not.toThrow();
      expect(() => insert(db, { source: "WAIVE" })).not.toThrow();
      expect(() => insert(db, { amount: 0 })).toThrow(/CHECK/);
      expect(() => insert(db, { amount: -1 })).toThrow(/CHECK/);
      expect(() => insert(db, { currency: "EUR" })).toThrow(/CHECK/);
      expect(() => insert(db, { row_kind: "SALE" })).toThrow(/CHECK/);
      expect(() => insert(db, { source: "DISCOUNT" })).toThrow(/CHECK/);
    });

    it("up() is idempotent", () => {
      expect(() => v217().up(db)).not.toThrow();
    });

    it("down() drops the table and its indexes", () => {
      v217().down!(db);
      expect(hasTable(db)).toBe(false);
      const leftover = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
        )
        .all(TABLE);
      expect(leftover).toEqual([]);
    });
  });
});
