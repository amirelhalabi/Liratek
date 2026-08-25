/**
 * ProductUnitService — orchestration + the pure `computeWarrantyStatus`
 * function (LIRA-143 Phase 2, decision #11's lookup precedence).
 *
 * Repositories are mocked throughout — this suite never touches SQLite.
 */

import {
  ProductUnitService,
  computeWarrantyStatus,
  type WarrantyStatusInput,
  type WarrantyStatus,
} from "../ProductUnitService";
import type {
  ProductUnitRepository,
  ProductUnitEntity,
} from "../../repositories/ProductUnitRepository";
import type {
  ProductRepository,
  ProductEntity,
} from "../../repositories/ProductRepository";

function makeUnit(overrides: Partial<ProductUnitEntity> = {}): ProductUnitEntity {
  return {
    id: 1,
    tenant_id: 1,
    product_id: 1,
    imei: "111111111111111",
    status: "IN_STOCK",
    sale_item_id: null,
    is_defective: 0,
    warranty_override_until: null,
    created_at: "2026-08-25 10:00:00",
    updated_at: "2026-08-25 10:00:00",
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductEntity> = {}): ProductEntity {
  return {
    id: 1,
    barcode: "123",
    name: "iPhone 13",
    category: "Phones",
    item_type: "Product",
    cost_price_usd: 500,
    selling_price_usd: 700,
    stock_quantity: 5,
    min_stock_level: 1,
    image_url: null,
    imei: null,
    color: null,
    status: "Active",
    is_active: 1,
    is_deleted: 0,
    supplier: null,
    created_at: "2026-08-25 10:00:00",
    updated_at: "2026-08-25 10:00:00",
    ...overrides,
  };
}

describe("ProductUnitService", () => {
  describe("registerUnits", () => {
    it("computes drift.matches = true when countInStock equals the product's stock_quantity", () => {
      const units = [makeUnit()];
      const mockRepo = {
        addUnits: jest.fn().mockReturnValue(units),
        countInStock: jest.fn().mockReturnValue(5),
      } as unknown as ProductUnitRepository;
      const mockProductRepo = {
        findById: jest.fn().mockReturnValue(makeProduct({ stock_quantity: 5 })),
      } as unknown as ProductRepository;

      const service = new ProductUnitService(mockRepo, mockProductRepo);
      const result = service.registerUnits(1, ["111111111111111"]);

      expect(result.units).toBe(units);
      expect(result.drift).toEqual({
        inStockUnits: 5,
        stockQuantity: 5,
        matches: true,
      });
    });

    it("computes drift.matches = false and still returns the units — drift never blocks", () => {
      const units = [makeUnit()];
      const mockRepo = {
        addUnits: jest.fn().mockReturnValue(units),
        countInStock: jest.fn().mockReturnValue(3),
      } as unknown as ProductUnitRepository;
      const mockProductRepo = {
        findById: jest.fn().mockReturnValue(makeProduct({ stock_quantity: 5 })),
      } as unknown as ProductRepository;

      const service = new ProductUnitService(mockRepo, mockProductRepo);
      const result = service.registerUnits(1, ["111111111111111"]);

      expect(result.units).toBe(units);
      expect(result.drift).toEqual({
        inStockUnits: 3,
        stockQuantity: 5,
        matches: false,
      });
    });

    it("throws when the product does not exist and never calls addUnits", () => {
      const mockRepo = {
        addUnits: jest.fn(),
        countInStock: jest.fn(),
      } as unknown as ProductUnitRepository;
      const mockProductRepo = {
        findById: jest.fn().mockReturnValue(null),
      } as unknown as ProductRepository;

      const service = new ProductUnitService(mockRepo, mockProductRepo);
      expect(() => service.registerUnits(999, ["111111111111111"])).toThrow(
        /product 999 not found/,
      );
      expect(mockRepo.addUnits).not.toHaveBeenCalled();
    });
  });

  describe("thin pass-throughs", () => {
    it("getUnitsForProduct/getSummaryForProducts/deleteUnit/findActiveByImei/getUnitsForSaleItems delegate to the repository", () => {
      const mockRepo = {
        getUnitsForProduct: jest.fn().mockReturnValue([makeUnit()]),
        getSummaryForProducts: jest
          .fn()
          .mockReturnValue({ 1: { in_stock: 1, sold: 0, defective: 0 } }),
        deleteUnit: jest.fn(),
        findActiveByImei: jest.fn().mockReturnValue(makeUnit()),
        findBySaleItemIds: jest.fn().mockReturnValue([makeUnit()]),
      } as unknown as ProductUnitRepository;
      const mockProductRepo = {} as unknown as ProductRepository;
      const service = new ProductUnitService(mockRepo, mockProductRepo);

      expect(service.getUnitsForProduct(1, "IN_STOCK")).toEqual([makeUnit()]);
      expect(mockRepo.getUnitsForProduct).toHaveBeenCalledWith(1, "IN_STOCK");

      expect(service.getSummaryForProducts([1])).toEqual({
        1: { in_stock: 1, sold: 0, defective: 0 },
      });
      expect(mockRepo.getSummaryForProducts).toHaveBeenCalledWith([1]);

      service.deleteUnit(1);
      expect(mockRepo.deleteUnit).toHaveBeenCalledWith(1);

      expect(service.findActiveByImei("111111111111111")).toEqual(makeUnit());
      expect(mockRepo.findActiveByImei).toHaveBeenCalledWith(
        "111111111111111",
      );

      // Phase 6 refund UI — the units linked to a sale being refunded.
      expect(service.getUnitsForSaleItems([10, 11])).toEqual([makeUnit()]);
      expect(mockRepo.findBySaleItemIds).toHaveBeenCalledWith([10, 11]);
    });
  });

  describe("getUnitStory", () => {
    it("stamps each row with a computed warranty status using the injected today", () => {
      const mockRepo = {
        getUnitStoryByImei: jest.fn().mockReturnValue([
          {
            ...makeUnit({ status: "SOLD", sale_item_id: 501 }),
            product_name: "iPhone 13",
            warranty_until: "2026-12-31",
            is_refunded: 0,
            refunded_quantity: 0,
            quantity: 1,
            sold_price_usd: 999,
            sale_id: 10,
            sold_at: "2026-08-01 10:00:00",
            client_id: 5,
            client_name: "Jane Doe",
          },
        ]),
      } as unknown as ProductUnitRepository;
      const mockProductRepo = {} as unknown as ProductRepository;
      const service = new ProductUnitService(mockRepo, mockProductRepo);

      const story = service.getUnitStory("111111111111111", "2026-08-25");
      expect(story).toHaveLength(1);
      expect(story[0].warranty).toEqual({
        source: "SALE",
        until: "2026-12-31",
        state: "COVERED",
      });
    });

    it("treats is_refunded truthy as a refunded sale even when quantity is null-ish", () => {
      const mockRepo = {
        getUnitStoryByImei: jest.fn().mockReturnValue([
          {
            ...makeUnit({ status: "SOLD", sale_item_id: 501 }),
            product_name: "iPhone 13",
            warranty_until: "2026-12-31",
            is_refunded: 1,
            refunded_quantity: 1,
            quantity: 1,
            sold_price_usd: 999,
            sale_id: 10,
            sold_at: "2026-08-01 10:00:00",
            client_id: 5,
            client_name: "Jane Doe",
          },
        ]),
      } as unknown as ProductUnitRepository;
      const service = new ProductUnitService(
        mockRepo,
        {} as unknown as ProductRepository,
      );

      const story = service.getUnitStory("111111111111111", "2026-08-25");
      expect(story[0].warranty.state).toBe("VOID");
    });

    it("never-sold unit (sale_item_id null) is not treated as refunded", () => {
      const mockRepo = {
        getUnitStoryByImei: jest.fn().mockReturnValue([
          {
            ...makeUnit({ status: "IN_STOCK", sale_item_id: null }),
            product_name: "iPhone 13",
            warranty_until: null,
            is_refunded: null,
            refunded_quantity: null,
            quantity: null,
            sold_price_usd: null,
            sale_id: null,
            sold_at: null,
            client_id: null,
            client_name: null,
          },
        ]),
      } as unknown as ProductUnitRepository;
      const service = new ProductUnitService(
        mockRepo,
        {} as unknown as ProductRepository,
      );

      const story = service.getUnitStory("111111111111111", "2026-08-25");
      expect(story[0].warranty).toEqual({
        source: null,
        until: null,
        state: "NONE",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // computeWarrantyStatus — pure function, table-driven (decision #11)
  // ---------------------------------------------------------------------------

  describe("computeWarrantyStatus", () => {
    const cases: {
      name: string;
      input: WarrantyStatusInput;
      expected: WarrantyStatus;
    }[] = [
      {
        name: "override, not yet expired -> OVERRIDE/COVERED",
        input: {
          overrideUntil: "2026-12-31",
          saleRefunded: false,
          stampedUntil: null,
          today: "2026-08-25",
        },
        expected: { source: "OVERRIDE", until: "2026-12-31", state: "COVERED" },
      },
      {
        name: "override, in the past -> OVERRIDE/EXPIRED",
        input: {
          overrideUntil: "2026-01-01",
          saleRefunded: false,
          stampedUntil: null,
          today: "2026-08-25",
        },
        expected: { source: "OVERRIDE", until: "2026-01-01", state: "EXPIRED" },
      },
      {
        name: "no override, refunded sale -> REFUND/VOID regardless of stamped date",
        input: {
          overrideUntil: null,
          saleRefunded: true,
          stampedUntil: "2026-12-31",
          today: "2026-08-25",
        },
        expected: { source: "REFUND", until: null, state: "VOID" },
      },
      {
        name: "override present AND sale refunded -> OVERRIDE wins outright",
        input: {
          overrideUntil: "2026-12-31",
          saleRefunded: true,
          stampedUntil: "2020-01-01",
          today: "2026-08-25",
        },
        expected: { source: "OVERRIDE", until: "2026-12-31", state: "COVERED" },
      },
      {
        name: "no override, not refunded, stamped covered -> SALE/COVERED",
        input: {
          overrideUntil: null,
          saleRefunded: false,
          stampedUntil: "2026-12-31",
          today: "2026-08-25",
        },
        expected: { source: "SALE", until: "2026-12-31", state: "COVERED" },
      },
      {
        name: "no override, not refunded, stamped expired -> SALE/EXPIRED",
        input: {
          overrideUntil: null,
          saleRefunded: false,
          stampedUntil: "2026-01-01",
          today: "2026-08-25",
        },
        expected: { source: "SALE", until: "2026-01-01", state: "EXPIRED" },
      },
      {
        name: "nothing set -> NONE",
        input: {
          overrideUntil: null,
          saleRefunded: false,
          stampedUntil: null,
          today: "2026-08-25",
        },
        expected: { source: null, until: null, state: "NONE" },
      },
      {
        name: "boundary: override until === today -> COVERED",
        input: {
          overrideUntil: "2026-08-25",
          saleRefunded: false,
          stampedUntil: null,
          today: "2026-08-25",
        },
        expected: { source: "OVERRIDE", until: "2026-08-25", state: "COVERED" },
      },
      {
        name: "boundary: stamped until === today -> COVERED",
        input: {
          overrideUntil: null,
          saleRefunded: false,
          stampedUntil: "2026-08-25",
          today: "2026-08-25",
        },
        expected: { source: "SALE", until: "2026-08-25", state: "COVERED" },
      },
    ];

    for (const { name, input, expected } of cases) {
      it(name, () => {
        expect(computeWarrantyStatus(input)).toEqual(expected);
      });
    }
  });
});
