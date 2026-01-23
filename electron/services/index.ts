/**
 * Services exports
 */

// Auth Service
export { AuthService, getAuthService, resetAuthService } from "./AuthService";
export type {
  LoginResult,
  CreateUserResult,
  ChangePasswordResult,
} from "./AuthService";

// Inventory Service
export {
  InventoryService,
  getInventoryService,
  resetInventoryService,
} from "./InventoryService";
export type { ProductResult, StockAdjustmentResult } from "./InventoryService";

// Client Service
export {
  ClientService,
  getClientService,
  resetClientService,
} from "./ClientService";
export type { ClientResult } from "./ClientService";

// Debt Service
export { DebtService, getDebtService, resetDebtService } from "./DebtService";
export type { RepaymentResult, RepaymentData } from "./DebtService";

// Sales Service
export {
  SalesService,
  getSalesService,
  resetSalesService,
} from "./SalesService";
export type { SaleResult } from "./SalesService";

// Exchange Service
export {
  ExchangeService,
  getExchangeService,
  resetExchangeService,
} from "./ExchangeService";
export type { ExchangeResult } from "./ExchangeService";

// Financial Service (OMT/WHISH/BOB)
export {
  FinancialService,
  getFinancialService,
  resetFinancialService,
} from "./FinancialService";
export type { FinancialServiceResult } from "./FinancialService";

// Rate Service
export { RateService, getRateService, resetRateService } from "./RateService";
export type { RateResult } from "./RateService";

// Currency Service
export {
  CurrencyService,
  getCurrencyService,
  resetCurrencyService,
} from "./CurrencyService";
export type { CurrencyResult } from "./CurrencyService";

// Recharge Service
export {
  RechargeService,
  getRechargeService,
  resetRechargeService,
} from "./RechargeService";
export type { RechargeResult } from "./RechargeService";

// Maintenance Service
export { MaintenanceService } from "./MaintenanceService";
export type { SaveJobParams } from "./MaintenanceService";

// Report Service
export { ReportService } from "./ReportService";
export type {
  GeneratePdfResult,
  BackupResult,
  ListBackupsResult,
  RestoreDbResult,
  VerifyBackupResult,
} from "./ReportService";

// Settings Service
export {
  SettingsService,
  getSettingsService,
  resetSettingsService,
} from "./SettingsService";
export type { SettingResult } from "./SettingsService";

// Expense Service
export {
  ExpenseService,
  getExpenseService,
  resetExpenseService,
} from "./ExpenseService";
export type { ExpenseResult } from "./ExpenseService";

// Closing Service
export {
  ClosingService,
  getClosingService,
  resetClosingService,
} from "./ClosingService";
export type {
  ClosingResult,
  SetOpeningBalancesData,
  CreateClosingData,
  UpdateClosingData,
} from "./ClosingService";

// Activity Service
export {
  ActivityService,
  getActivityService,
  resetActivityService,
} from "./ActivityService";

// Supplier Service
export {
  SupplierService,
  getSupplierService,
  resetSupplierService,
} from "./SupplierService";
export type { SupplierResult } from "./SupplierService";
