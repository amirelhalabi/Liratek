/**
 * Services exports
 */

// Auth Service
export { AuthService, getAuthService, resetAuthService } from "./AuthService.js";
export type {
  LoginResult,
  CreateUserResult,
  ChangePasswordResult,
} from "./AuthService.js";

// Inventory Service
export {
  InventoryService,
  getInventoryService,
  resetInventoryService,
} from "./InventoryService.js";
export type { ProductResult, StockAdjustmentResult } from "./InventoryService.js";

// Client Service
export {
  ClientService,
  getClientService,
  resetClientService,
} from "./ClientService.js";
export type { ClientResult } from "./ClientService.js";

// Debt Service
export { DebtService, getDebtService, resetDebtService } from "./DebtService.js";
export type { RepaymentResult, RepaymentData } from "./DebtService.js";

// Sales Service
export {
  SalesService,
  getSalesService,
  resetSalesService,
} from "./SalesService.js";
export type { SaleResult } from "./SalesService.js";

// Exchange Service
export {
  ExchangeService,
  getExchangeService,
  resetExchangeService,
} from "./ExchangeService.js";
export type { ExchangeResult } from "./ExchangeService.js";

// Financial Service (OMT/WHISH/BOB)
export {
  FinancialService,
  getFinancialService,
  resetFinancialService,
} from "./FinancialService.js";
export type { FinancialServiceResult } from "./FinancialService.js";

// Rate Service
export { RateService, getRateService, resetRateService } from "./RateService.js";
export type { RateResult } from "./RateService.js";

// Currency Service
export {
  CurrencyService,
  getCurrencyService,
  resetCurrencyService,
} from "./CurrencyService.js";
export type { CurrencyResult } from "./CurrencyService.js";

// Recharge Service
export {
  RechargeService,
  getRechargeService,
  resetRechargeService,
} from "./RechargeService.js";
export type { RechargeResult } from "./RechargeService.js";

// Maintenance Service
export { MaintenanceService } from "./MaintenanceService.js";
export type { SaveJobParams } from "./MaintenanceService.js";

// Report Service - Requires Electron APIs, not available in backend mode
// export { ReportService } from "./ReportService";
// export type {
//   GeneratePdfResult,
//   BackupResult,
//   ListBackupsResult,
//   RestoreDbResult,
//   VerifyBackupResult,
// } from "./ReportService";

// Settings Service
export {
  SettingsService,
  getSettingsService,
  resetSettingsService,
} from "./SettingsService.js";
export type { SettingResult } from "./SettingsService.js";

// Expense Service
export {
  ExpenseService,
  getExpenseService,
  resetExpenseService,
} from "./ExpenseService.js";
export type { ExpenseResult } from "./ExpenseService.js";

// Closing Service
export {
  ClosingService,
  getClosingService,
  resetClosingService,
} from "./ClosingService.js";
export type {
  ClosingResult,
  SetOpeningBalancesData,
  CreateClosingData,
  UpdateClosingData,
} from "./ClosingService.js";

// Activity Service
export {
  ActivityService,
  getActivityService,
  resetActivityService,
} from "./ActivityService.js";

// Supplier Service
export {
  SupplierService,
  getSupplierService,
  resetSupplierService,
} from "./SupplierService.js";
export type { SupplierResult } from "./SupplierService.js";

// Customer Session Service
export { CustomerSessionService } from "./CustomerSessionService.js";
