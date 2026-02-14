import type { ApiAdapter } from "@liratek/ui";
import * as backendApi from "./backendApi";

export const backendApiAdapter: ApiAdapter = {
  login: backendApi.login,
  logout: backendApi.logout,
  me: backendApi.me,

  getClients: (search?: string) => backendApi.getClients(search ?? ""),
  deleteClient: backendApi.deleteClient,

  getDebtors: backendApi.getDebtors,
  getClientDebtHistory: backendApi.getClientDebtHistory,
  getClientDebtTotal: backendApi.getClientDebtTotal,
  addRepayment: backendApi.addRepayment,

  getDashboardStats: backendApi.getDashboardStats,
  getProfitSalesChart: backendApi.getProfitSalesChart,
  getTodaysSales: backendApi.getTodaysSales,
  getDrawerBalances: backendApi.getDrawerBalances,
  getInventoryStockStats: backendApi.getInventoryStockStats,
  getRechargeStock: backendApi.getRechargeStock,
  getMonthlyPL: backendApi.getMonthlyPL,
};
