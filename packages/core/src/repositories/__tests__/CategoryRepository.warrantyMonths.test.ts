/**
 * LIRA-296 (T017) — a default warranty per category (`warranty_months`,
 * 0–60 months; NULL = none) through the repository and the shared schema.
 */
import type Database from "better-sqlite3";
import { CategoryRepository } from "../CategoryRepository";
import { updateCategorySchema } from "../../validators/productUnit";
import { runWithTenant } from "../../db/tenantContext";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb";

let db: Database.Database;
const repo = new CategoryRepository();

beforeEach(() => {
  db = installWarrantyTestDb();
});
afterEach(() => uninstallWarrantyTestDb(db));

const accessoriesId = () =>
  (
    db
      .prepare(
        `SELECT id FROM product_categories WHERE tenant_id = 1 AND name = 'Accessories'`,
      )
      .get() as { id: number }
  ).id;

describe("CategoryRepository — warranty_months", () => {
  it("getAll returns warranty_months (NULL by default)", () => {
    const acc = repo.getAll().find((c) => c.name === "Accessories");
    expect(acc).toHaveProperty("warranty_months", null);
  });

  it("update sets, changes and clears the default", () => {
    const id = accessoriesId();
    expect(repo.update(id, { warrantyMonths: 1 })).toBe(true);
    expect(repo.getAll().find((c) => c.id === id)?.warranty_months).toBe(1);
    repo.update(id, { warrantyMonths: 12 });
    expect(repo.getAll().find((c) => c.id === id)?.warranty_months).toBe(12);
    repo.update(id, { warrantyMonths: null });
    expect(repo.getAll().find((c) => c.id === id)?.warranty_months).toBeNull();
  });

  it("leaves the default untouched when only the name changes", () => {
    const id = accessoriesId();
    repo.update(id, { warrantyMonths: 3 });
    repo.update(id, { name: "Accessories & Cases" });
    expect(repo.getAll().find((c) => c.id === id)).toMatchObject({
      name: "Accessories & Cases",
      warranty_months: 3,
    });
  });

  it("never touches another tenant's category", () => {
    const id = accessoriesId();
    expect(runWithTenant(2, () => repo.update(id, { warrantyMonths: 6 }))).toBe(
      false,
    );
    expect(repo.getAll().find((c) => c.id === id)?.warranty_months).toBeNull();
  });
});

describe("updateCategorySchema — warranty_months", () => {
  it.each([0, 1, 12, 60, null])("accepts %p", (v) => {
    expect(updateCategorySchema.parse({ warranty_months: v })).toEqual({
      warranty_months: v,
    });
  });

  it.each([-1, 61, 1.5, "3"])("rejects %p", (v) => {
    expect(updateCategorySchema.safeParse({ warranty_months: v }).success).toBe(
      false,
    );
  });

  it("still refuses an empty update", () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});
