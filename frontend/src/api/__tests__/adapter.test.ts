import type { ApiAdapter } from "@liratek/ui";

jest.mock("../backendApi", () => ({
  login: jest.fn(async () => ({ success: true })),
  logout: jest.fn(async () => undefined),
  me: jest.fn(async () => ({ success: true })),
  getClients: jest.fn(async () => []),
  deleteClient: jest.fn(async () => ({ success: true })),
  getDebtors: jest.fn(async () => []),
  getClientDebtHistory: jest.fn(async () => []),
  getClientDebtTotal: jest.fn(async () => 0),
  addRepayment: jest.fn(async () => ({ success: true })),
  getDashboardStats: jest.fn(async () => ({})),
  getProfitSalesChart: jest.fn(async () => []),
  getTodaysSales: jest.fn(async () => []),
  getDrawerBalances: jest.fn(async () => ({})),
  getInventoryStockStats: jest.fn(async () => ({})),
  getRechargeStock: jest.fn(async () => ({})),
  getMonthlyPL: jest.fn(async () => ({})),
}));

import { backendApiAdapter } from "../adapter";
import * as backendApi from "../backendApi";

describe("backendApiAdapter", () => {
  it("maps getClients undefined to empty string", async () => {
    const adapter: ApiAdapter = backendApiAdapter;
    await adapter.getClients();
    expect(backendApi.getClients).toHaveBeenCalledWith("");
  });
});
