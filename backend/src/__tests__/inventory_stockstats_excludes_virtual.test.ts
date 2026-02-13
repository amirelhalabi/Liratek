import { resetAllMocks, mockDatabase } from "../__mocks__/better-sqlite3";
import { getProductRepository, resetProductRepository } from "@liratek/core";

describe("Inventory stock stats exclude virtual telecom credits", () => {
  beforeEach(() => {
    resetAllMocks();
    resetProductRepository();
    (globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;
  });

  it("ProductRepository.getStockStats() SQL excludes Virtual_MTC and Virtual_Alfa", () => {
    const repo = getProductRepository();

    // Call; it will hit mock DB and return default.
    repo.getStockStats();

    const sqlCalls = (mockDatabase.prepare as any).mock.calls.map((c: any[]) => c[0]);
    const stockSql = sqlCalls.find((s: string) => s.includes("SUM(cost_price_usd * stock_quantity)"));

    expect(stockSql).toBeTruthy();
    expect(stockSql).toContain("item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')");
  });
});
