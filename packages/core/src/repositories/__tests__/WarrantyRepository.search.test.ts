/**
 * LIRA-296 (T010) — `WarrantyRepository.search`: find any warranty line
 * without an IMEI — by customer name, phone, receipt number, product, or
 * serial/IMEI — over a real schema (create_db.sql).
 *
 * The repository returns raw lines (quantity, refunded quantity, stamped
 * date) and their units; the STATE is the service's job (one helper, rule 14).
 */
import type Database from "better-sqlite3";
import { WarrantyRepository } from "../WarrantyRepository";
import { runWithTenant } from "../../db/tenantContext";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addClient,
  addProduct,
  addSale,
  addLine,
  addUnit,
} from "../testHelpers/warrantyDb";

let db: Database.Database;
const repo = new WarrantyRepository();

beforeEach(() => {
  db = installWarrantyTestDb();
  addClient(db, { id: 1, name: "Rami Haddad", phone: "71 123 456" });
  addProduct(db, { id: 10, name: "Earbuds Pro", barcode: "EB-777" });
  addProduct(db, { id: 11, name: "Phone X", barcode: "PX-1" });
  addProduct(db, { id: 12, name: "USB Cable", barcode: "CB-1" });

  // Sale 100: named client — 3 earbuds (1 refunded) + a cable with NO warranty.
  addSale(db, { id: 100, clientId: 1, createdAt: "2026-09-01 10:00:00" });
  addLine(db, {
    id: 1000,
    saleId: 100,
    productId: 10,
    quantity: 3,
    refundedQuantity: 1,
    warrantyUntil: "2026-12-01",
    warrantyMonths: 3,
  });
  addLine(db, { id: 1001, saleId: 100, productId: 12, warrantyUntil: null });

  // Sale 101: walk-in (no client row), a phone with a tracked unit.
  addSale(db, {
    id: 101,
    walkInName: "Walk Guy",
    walkInPhone: "03 999 888",
    createdAt: "2026-09-05 12:00:00",
  });
  addLine(db, {
    id: 1010,
    saleId: 101,
    productId: 11,
    warrantyUntil: "2027-09-05",
    imei: "356789012345678",
  });
  addUnit(db, {
    id: 5,
    productId: 11,
    imei: "356789012345678",
    saleItemId: 1010,
  });

  // Tenant 2: same customer name and product name — must never leak.
  addClient(db, { id: 2, name: "Rami Haddad", phone: "71 123 456", tenant: 2 });
  addProduct(db, { id: 20, name: "Earbuds Pro", barcode: "EB-777", tenant: 2 });
  addSale(db, { id: 200, clientId: 2, tenant: 2 });
  addLine(db, { id: 2000, saleId: 200, productId: 20, tenant: 2 });
});

afterEach(() => uninstallWarrantyTestDb(db));

const ids = (rows: { sale_item_id: number }[]) =>
  rows.map((r) => r.sale_item_id).sort();

describe("WarrantyRepository.search", () => {
  it("returns only lines that carry a warranty, newest sale first", () => {
    const rows = repo.search({ limit: 50 });
    expect(rows.map((r) => r.sale_item_id)).toEqual([1010, 1000]);
  });

  it("finds a line by customer name (partial, any case)", () => {
    expect(ids(repo.search({ q: "rami", limit: 50 }))).toEqual([1000]);
  });

  it("finds a line by phone number, ignoring spaces", () => {
    expect(ids(repo.search({ q: "71123456", limit: 50 }))).toEqual([1000]);
    expect(ids(repo.search({ q: "71 123", limit: 50 }))).toEqual([1000]);
  });

  it.each(["RCP-100", "rcp100", "100"])(
    "finds every warranty line of a sale by receipt number %p",
    (q) => {
      expect(ids(repo.search({ q, limit: 50 }))).toEqual([1000]);
    },
  );

  it("finds a walk-in sale by receipt number and by its walk-in name/phone", () => {
    expect(ids(repo.search({ q: "RCP-101", limit: 50 }))).toEqual([1010]);
    expect(ids(repo.search({ q: "walk guy", limit: 50 }))).toEqual([1010]);
    expect(ids(repo.search({ q: "03999888", limit: 50 }))).toEqual([1010]);
  });

  it("finds a line by product name and by barcode", () => {
    expect(ids(repo.search({ q: "earbuds", limit: 50 }))).toEqual([1000]);
    expect(ids(repo.search({ q: "EB-777", limit: 50 }))).toEqual([1000]);
  });

  it("finds a line by unit serial/IMEI (partial)", () => {
    expect(ids(repo.search({ q: "3567890123", limit: 50 }))).toEqual([1010]);
  });

  it("filters by sale day range (inclusive)", () => {
    expect(
      ids(repo.search({ from: "2026-09-02", to: "2026-09-30", limit: 50 })),
    ).toEqual([1010]);
    expect(
      ids(repo.search({ from: "2026-09-01", to: "2026-09-01", limit: 50 })),
    ).toEqual([1000]);
  });

  it("carries the customer (client row or walk-in), the product, quantities and the stamp", () => {
    const [phone, earbuds] = repo.search({ limit: 50 });
    expect(earbuds).toMatchObject({
      sale_id: 100,
      sale_item_id: 1000,
      client_id: 1,
      customer_name: "Rami Haddad",
      customer_phone: "71 123 456",
      product_id: 10,
      product_name: "Earbuds Pro",
      barcode: "EB-777",
      quantity: 3,
      refunded_quantity: 1,
      is_refunded: 0,
      warranty_until: "2026-12-01",
      warranty_months: 3,
      sold_at: "2026-09-01 10:00:00",
    });
    expect(phone).toMatchObject({
      sale_id: 101,
      client_id: null,
      customer_name: "Walk Guy",
      customer_phone: "03 999 888",
    });
  });

  it("returns each line's tracked units", () => {
    const units = repo.unitsForLines([1000, 1010]);
    expect(units).toEqual([
      {
        id: 5,
        sale_item_id: 1010,
        imei: "356789012345678",
        status: "SOLD",
        warranty_override_until: null,
      },
    ]);
    expect(repo.unitsForLines([])).toEqual([]);
  });

  it("respects the limit", () => {
    expect(repo.search({ limit: 1 }).map((r) => r.sale_item_id)).toEqual([
      1010,
    ]);
  });

  it("never returns another tenant's lines", () => {
    expect(ids(repo.search({ q: "Rami", limit: 50 }))).toEqual([1000]);
    const otherTenant = runWithTenant(2, () =>
      repo.search({ q: "Rami", limit: 50 }),
    );
    expect(ids(otherTenant)).toEqual([2000]);
    // A tenant-1 unit never shows up under tenant 2.
    expect(runWithTenant(2, () => repo.unitsForLines([1010]))).toEqual([]);
  });

  it("treats LIKE wildcards in the text literally", () => {
    expect(repo.search({ q: "%", limit: 50 })).toEqual([]);
    expect(repo.search({ q: "_", limit: 50 })).toEqual([]);
  });
});
