/**
 * LIRA-296 P3 (T047) — a category's serial label ('IMEI' | 'Serial') and its
 * rule for a sale without the unit ('BLOCK' | 'WARN'), through the
 * repository and the shared schema. (The screens read the label from the
 * category list — `getCategoriesFull` — not from product rows.)
 */
import type Database from "better-sqlite3";
import { CategoryRepository } from "../CategoryRepository";
import { updateCategorySchema } from "../../validators/productUnit";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";

let db: Database.Database;
const repo = new CategoryRepository();

beforeEach(() => {
  db = installWarrantyTestDb();
  initFixedTenantContext(1);
});
afterEach(() => {
  resetTenantContext();
  uninstallWarrantyTestDb(db);
});

const byName = (name: string) => repo.getAll().find((c) => c.name === name)!;

it("getAll returns serial_label and serial_required (Phones are IMEI, others Serial; BLOCK by default)", () => {
  expect(byName("Phones")).toMatchObject({
    serial_label: "IMEI",
    serial_required: "BLOCK",
  });
  expect(byName("Accessories")).toMatchObject({
    serial_label: "Serial",
    serial_required: "BLOCK",
  });
});

it("update sets the label and the rule, leaving the rest alone", () => {
  const id = byName("Accessories").id;
  repo.update(id, { warrantyMonths: 6 });
  expect(repo.update(id, { serialLabel: "IMEI", serialRequired: "WARN" })).toBe(
    true,
  );
  expect(byName("Accessories")).toMatchObject({
    serial_label: "IMEI",
    serial_required: "WARN",
    warranty_months: 6,
  });
});

describe("updateCategorySchema", () => {
  it("accepts the label or the rule alone", () => {
    expect(updateCategorySchema.safeParse({ serial_label: "IMEI" }).success).toBe(
      true,
    );
    expect(
      updateCategorySchema.safeParse({ serial_required: "WARN" }).success,
    ).toBe(true);
  });
  it("refuses anything else", () => {
    expect(
      updateCategorySchema.safeParse({ serial_label: "Barcode" }).success,
    ).toBe(false);
    expect(
      updateCategorySchema.safeParse({ serial_required: "MAYBE" }).success,
    ).toBe(false);
  });
});
