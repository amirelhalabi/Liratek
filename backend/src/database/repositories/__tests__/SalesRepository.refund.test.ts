import { jest } from "@jest/globals";
import { SalesRepository } from "@liratek/core";
import {
  resetAllMocks,
  mockDatabase,
  mockStatement,
} from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

describe("SalesRepository.refundSaleItem", () => {
  let repo: SalesRepository;

  beforeEach(() => {
    resetAllMocks();
    (globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;
    repo = new SalesRepository();
  });

  it("prevents double refund (quantity exceeds available)", () => {
    const mockItem = {
      id: 1,
      sale_id: 10,
      product_id: 100,
      quantity: 5,
      sold_price_usd: 10,
      cost_price_snapshot_usd: 5,
      is_refunded: 0,
      refunded_quantity: 3,
      imei: null,
    };

    const mockSale = {
      id: 10,
      client_id: null,
      total_amount_usd: 50,
      discount_usd: 0,
      final_amount_usd: 50,
      paid_usd: 50,
      paid_lbp: 0,
      change_given_usd: 0,
      change_given_lbp: 0,
      exchange_rate_snapshot: 90000,
      drawer_name: "General",
      status: "completed",
      note: null,
      created_at: new Date().toISOString(),
    };

    let callCount = 0;
    mockDatabase.prepare.mockImplementation(() => {
      const stmt = { ...mockStatement };
      stmt.get = jest.fn(() => {
        if (callCount === 0) {
          callCount++;
          return mockItem;
        } else if (callCount === 1) {
          callCount++;
          return mockSale;
        }
        return undefined;
      });
      return stmt;
    });

    (mockDatabase as any).transaction = jest.fn((fn: any) => fn);

    expect(() =>
      repo.refundSaleItem({
        saleId: 10,
        saleItemId: 1,
        refundQuantity: 5,
        userId: 1,
      }),
    ).toThrow(/only 2 available/);
  });

  it("prevents refund from already fully refunded sale", () => {
    const mockItem = {
      id: 1,
      sale_id: 10,
      product_id: 100,
      quantity: 5,
      sold_price_usd: 10,
      cost_price_snapshot_usd: 5,
      is_refunded: 0,
      refunded_quantity: 0,
      imei: null,
    };

    const mockSale = {
      id: 10,
      client_id: null,
      total_amount_usd: 50,
      discount_usd: 0,
      final_amount_usd: 50,
      paid_usd: 50,
      paid_lbp: 0,
      change_given_usd: 0,
      change_given_lbp: 0,
      exchange_rate_snapshot: 90000,
      drawer_name: "General",
      status: "refunded",
      note: null,
      created_at: new Date().toISOString(),
    };

    let callCount = 0;
    mockDatabase.prepare.mockImplementation(() => {
      const stmt = { ...mockStatement };
      stmt.get = jest.fn(() => {
        if (callCount === 0) {
          callCount++;
          return mockItem;
        } else if (callCount === 1) {
          callCount++;
          return mockSale;
        }
        return undefined;
      });
      return stmt;
    });

    (mockDatabase as any).transaction = jest.fn((fn: any) => fn);

    expect(() =>
      repo.refundSaleItem({
        saleId: 10,
        saleItemId: 1,
        refundQuantity: 1,
        userId: 1,
      }),
    ).toThrow(/Cannot refund items from a fully refunded sale/);
  });

  it("prevents refund with invalid quantity (zero or negative)", () => {
    const mockItem = {
      id: 1,
      sale_id: 10,
      product_id: 100,
      quantity: 5,
      sold_price_usd: 10,
      cost_price_snapshot_usd: 5,
      is_refunded: 0,
      refunded_quantity: 0,
      imei: null,
    };

    const mockSale = {
      id: 10,
      client_id: null,
      total_amount_usd: 50,
      discount_usd: 0,
      final_amount_usd: 50,
      paid_usd: 50,
      paid_lbp: 0,
      change_given_usd: 0,
      change_given_lbp: 0,
      exchange_rate_snapshot: 90000,
      drawer_name: "General",
      status: "completed",
      note: null,
      created_at: new Date().toISOString(),
    };

    let callCount = 0;
    mockDatabase.prepare.mockImplementation(() => {
      const stmt = { ...mockStatement };
      stmt.get = jest.fn(() => {
        if (callCount === 0) {
          callCount++;
          return mockItem;
        } else if (callCount === 1) {
          callCount++;
          return mockSale;
        }
        return undefined;
      });
      return stmt;
    });

    (mockDatabase as any).transaction = jest.fn((fn: any) => fn);

    expect(() =>
      repo.refundSaleItem({
        saleId: 10,
        saleItemId: 1,
        refundQuantity: 0,
        userId: 1,
      }),
    ).toThrow(/must be greater than 0/);
  });

  it("throws error if sale item not found", () => {
    mockDatabase.prepare.mockImplementation(() => {
      const stmt = { ...mockStatement };
      stmt.get = jest.fn(() => null);
      return stmt;
    });

    (mockDatabase as any).transaction = jest.fn((fn: any) => fn);

    expect(() =>
      repo.refundSaleItem({
        saleId: 10,
        saleItemId: 999,
        refundQuantity: 1,
        userId: 1,
      }),
    ).toThrow(/sale_item.*999/);
  });

  it("throws error if sale not found", () => {
    const mockItem = {
      id: 1,
      sale_id: 10,
      product_id: 100,
      quantity: 5,
      sold_price_usd: 10,
      cost_price_snapshot_usd: 5,
      is_refunded: 0,
      refunded_quantity: 0,
      imei: null,
    };

    let callCount = 0;
    mockDatabase.prepare.mockImplementation(() => {
      const stmt = { ...mockStatement };
      stmt.get = jest.fn(() => {
        if (callCount === 0) {
          callCount++;
          return mockItem;
        }
        callCount++;
        return null;
      });
      return stmt;
    });

    (mockDatabase as any).transaction = jest.fn((fn: any) => fn);

    expect(() =>
      repo.refundSaleItem({
        saleId: 999,
        saleItemId: 1,
        refundQuantity: 1,
        userId: 1,
      }),
    ).toThrow(/sale.*999/);
  });
});
