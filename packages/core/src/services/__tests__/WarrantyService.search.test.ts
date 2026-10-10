/**
 * LIRA-296 (T011) — `WarrantyService.search`: validates the input, reads the
 * lines, and stamps each with its state from the ONE helper
 * (`warrantyState`), using the CLIENT's day (rule 27).
 */
import type Database from "better-sqlite3";
import { WarrantyService } from "../WarrantyService";
import { WarrantyRepository } from "../../repositories/WarrantyRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addClient,
  addProduct,
  addSale,
  addLine,
  addUnit,
} from "../../repositories/testHelpers/warrantyDb";

let db: Database.Database;
const service = new WarrantyService(new WarrantyRepository());

beforeEach(() => {
  db = installWarrantyTestDb();
  addClient(db, { id: 1, name: "Rami Haddad", phone: "71 123 456" });
  addProduct(db, { id: 10, name: "Earbuds Pro", barcode: "EB-777" });
  addProduct(db, { id: 11, name: "Phone X", barcode: "PX-1" });
  addProduct(db, { id: 12, name: "Speaker", barcode: "SP-1" });

  // 3 earbuds, 1 refunded → 2 still covered.
  addSale(db, { id: 100, clientId: 1, createdAt: "2026-09-01 10:00:00" });
  addLine(db, {
    id: 1000,
    saleId: 100,
    productId: 10,
    quantity: 3,
    refundedQuantity: 1,
    warrantyUntil: "2026-12-01",
  });
  // A fully refunded line → VOID.
  addSale(db, { id: 102, clientId: 1, createdAt: "2026-09-03 10:00:00" });
  addLine(db, {
    id: 1020,
    saleId: 102,
    productId: 12,
    quantity: 2,
    refundedQuantity: 2,
    warrantyUntil: "2026-12-03",
  });
  // An expired one.
  addSale(db, { id: 103, clientId: 1, createdAt: "2025-01-01 10:00:00" });
  addLine(db, {
    id: 1030,
    saleId: 103,
    productId: 12,
    warrantyUntil: "2025-02-01",
  });
  // A phone with two... one unit with an override extending its warranty.
  addSale(db, { id: 101, walkInName: "Walk Guy", createdAt: "2026-09-05 12:00:00" });
  addLine(db, { id: 1010, saleId: 101, productId: 11, warrantyUntil: "2026-10-01" });
  addUnit(db, {
    id: 5,
    productId: 11,
    imei: "356789012345678",
    saleItemId: 1010,
    overrideUntil: "2027-01-01",
  });
});

afterEach(() => uninstallWarrantyTestDb(db));

describe("WarrantyService.search", () => {
  it("builds one row per line with its customer, product, receipt and state", () => {
    const rows = service.search({ client_day: "2026-10-10", q: "earbuds" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      source: "SALE",
      saleId: 100,
      receiptNumber: "RCP-100",
      saleItemId: 1000,
      maintenanceId: null,
      soldAt: "2026-09-01 10:00:00",
      customer: { id: 1, name: "Rami Haddad", phone: "71 123 456" },
      product: { id: 10, name: "Earbuds Pro", barcode: "EB-777" },
      quantity: 3,
      refundedQuantity: 1,
      coveredQuantity: 2,
      units: [],
      warrantyUntil: "2026-12-01",
      warrantyMonths: null,
      state: "COVERED",
      openClaimId: null,
    });
  });

  it("a fully refunded line is VOID with nothing covered", () => {
    const [row] = service.search({ client_day: "2026-10-10", q: "RCP-102" });
    expect(row).toMatchObject({ state: "VOID", coveredQuantity: 0 });
  });

  it("an old line is EXPIRED", () => {
    const [row] = service.search({ client_day: "2026-10-10", q: "RCP-103" });
    expect(row?.state).toBe("EXPIRED");
  });

  it("a unit's override wins over the line's stamped date", () => {
    const [row] = service.search({ client_day: "2026-10-10", q: "RCP-101" });
    expect(row?.state).toBe("COVERED");
    expect(row?.units).toEqual([
      {
        id: 5,
        serial: "356789012345678",
        state: "COVERED",
        overrideUntil: "2027-01-01",
      },
    ]);
  });

  it("a unit put back in stock by a refund is VOID", () => {
    db.prepare(`UPDATE product_units SET status = 'IN_STOCK', warranty_override_until = NULL WHERE id = 5`).run();
    db.prepare(`UPDATE sale_items SET refunded_quantity = 1 WHERE id = 1010`).run();
    const [row] = service.search({ client_day: "2026-09-10", q: "RCP-101" });
    expect(row?.units[0]?.state).toBe("VOID");
    expect(row?.state).toBe("VOID");
  });

  it("filters by state, and still honours the limit", () => {
    const covered = service.search({ client_day: "2026-10-10", state: "COVERED" });
    expect(covered.map((r) => r.saleItemId)).toEqual([1010, 1000]);
    expect(
      service.search({ client_day: "2026-10-10", state: "EXPIRED" }).map(
        (r) => r.saleItemId,
      ),
    ).toEqual([1030]);
    expect(
      service.search({ client_day: "2026-10-10", state: "VOID" }).map(
        (r) => r.saleItemId,
      ),
    ).toEqual([1020]);
    expect(
      service.search({ client_day: "2026-10-10", state: "COVERED", limit: 1 }),
    ).toHaveLength(1);
  });

  // Rule 27: "today" is the shop's day, sent by the client — never the
  // server's clock. A warranty ending 2026-12-01 is still covered all day on
  // 2026-12-01 for the shop, even at 23:30 UTC (02:30 the next day in
  // Beirut is irrelevant: the client says what day it is).
  it("uses the client's day: covered on the end day, expired the day after", () => {
    expect(
      service.search({ client_day: "2026-12-01", q: "RCP-100" })[0]?.state,
    ).toBe("COVERED");
    expect(
      service.search({ client_day: "2026-12-02", q: "RCP-100" })[0]?.state,
    ).toBe("EXPIRED");
  });

  it("refuses an invalid input", () => {
    expect(() =>
      service.search({ client_day: "not-a-day" } as never),
    ).toThrow();
  });
});

/**
 * LIRA-296 follow-up (owner decision 2026-10-10) — searching the serial of a
 * phone still on the shelf finds no warranty (it starts when it is sold), so
 * the same search response says so: `inStockUnits` lists the in-stock units
 * whose IMEI/serial IS the query (exact, trimmed), only when no warranty row
 * came back. Tenant-scoped.
 */
describe("WarrantyService.searchWithStock", () => {
  const IN_STOCK_IMEI = "350000111122223";
  beforeEach(() => {
    addUnit(db, { id: 7, productId: 11, imei: IN_STOCK_IMEI, status: "IN_STOCK" });
    // Same serial in ANOTHER tenant — never ours to report.
    addProduct(db, { id: 90, name: "Other Shop Phone", tenant: 2 });
    addUnit(db, {
      id: 8,
      productId: 90,
      imei: "350000999988887",
      status: "IN_STOCK",
      tenant: 2,
    });
  });

  it("names the in-stock unit when its serial is the query and no warranty matched", () => {
    const result = service.searchWithStock({
      client_day: "2026-10-10",
      q: ` ${IN_STOCK_IMEI} `,
    });
    expect(result.rows).toEqual([]);
    expect(result.inStockUnits).toEqual([
      { imei: IN_STOCK_IMEI, productName: "Phone X" },
    ]);
  });

  it("matches the whole serial only, never a fragment", () => {
    const result = service.searchWithStock({
      client_day: "2026-10-10",
      q: "35000011",
    });
    expect(result.rows).toEqual([]);
    expect(result.inStockUnits).toBeUndefined();
  });

  it("is absent when the search found warranty rows", () => {
    const result = service.searchWithStock({
      client_day: "2026-10-10",
      q: "356789012345678",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.inStockUnits).toBeUndefined();
  });

  it("is absent with no query, and never reports another tenant's unit", () => {
    expect(
      service.searchWithStock({ client_day: "2026-10-10" }).inStockUnits,
    ).toBeUndefined();
    expect(
      service.searchWithStock({ client_day: "2026-10-10", q: "350000999988887" })
        .inStockUnits,
    ).toBeUndefined();
  });

  it("returns the same rows as search()", () => {
    const input = { client_day: "2026-10-10", q: "Rami" };
    expect(service.searchWithStock(input).rows).toEqual(service.search(input));
  });
});
