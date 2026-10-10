/**
 * LIRA-296 (T016 support) — `getSaleItems` carries each line's SOLD unit
 * override (`warranty_override_until`), so the sale details can show the
 * same state the warranty search shows (override > refund > stamp).
 */
import type Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addProduct,
  addSale,
  addLine,
  addUnit,
} from "../testHelpers/warrantyDb";

let db: Database.Database;

beforeEach(() => {
  db = installWarrantyTestDb();
  addProduct(db, { id: 11, name: "Phone X" });
  addProduct(db, { id: 12, name: "Cable" });
  addSale(db, { id: 101 });
  addLine(db, { id: 1010, saleId: 101, productId: 11, warrantyUntil: "2026-09-15" });
  addLine(db, { id: 1011, saleId: 101, productId: 12, warrantyUntil: null });
  addUnit(db, {
    id: 5,
    productId: 11,
    imei: "356789012345678",
    saleItemId: 1010,
    overrideUntil: "2027-03-01",
  });
});

afterEach(() => uninstallWarrantyTestDb(db));

it("returns the SOLD unit's override per line, null otherwise", () => {
  const items = new SalesRepository().getSaleItems(101);
  const byId = new Map(items.map((i) => [i.id, i]));
  expect(byId.get(1010)?.warranty_override_until).toBe("2027-03-01");
  expect(byId.get(1011)?.warranty_override_until).toBeNull();
});

it("ignores a unit a refund put back in stock", () => {
  db.prepare(`UPDATE product_units SET status = 'IN_STOCK' WHERE id = 5`).run();
  const items = new SalesRepository().getSaleItems(101);
  expect(items.find((i) => i.id === 1010)?.warranty_override_until).toBeNull();
});
