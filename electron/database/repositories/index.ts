/**
 * Repository exports
 */

// Base Repository
export { BaseRepository } from "./BaseRepository";
export type {
  BaseEntity,
  FindOptions,
  UpdateOptions,
  PaginatedResult,
} from "./BaseRepository";

// User Repository
export {
  UserRepository,
  getUserRepository,
  resetUserRepository,
} from "./UserRepository";
export type {
  UserEntity,
  SafeUser,
  CreateUserData,
  UpdateUserData,
} from "./UserRepository";

// Product Repository
export {
  ProductRepository,
  getProductRepository,
  resetProductRepository,
} from "./ProductRepository";
export type {
  ProductEntity,
  ProductDTO,
  CreateProductData,
  UpdateProductData,
  StockStats,
  LowStockProduct,
} from "./ProductRepository";

// Client Repository
export {
  ClientRepository,
  getClientRepository,
  resetClientRepository,
} from "./ClientRepository";
export type {
  ClientEntity,
  CreateClientData,
  UpdateClientData,
} from "./ClientRepository";

// Sales Repository
export {
  SalesRepository,
  getSalesRepository,
  resetSalesRepository,
} from "./SalesRepository";
export type {
  SaleEntity,
  SaleItemEntity,
  SaleWithClient,
  SaleItemWithProduct,
  DraftSaleWithItems,
  SaleRequest,
  DashboardStats,
  DrawerBalance,
  DrawerBalances,
  TopProduct,
  RecentSale,
  ChartDataPoint,
} from "./SalesRepository";

// Debt Repository
export {
  DebtRepository,
  getDebtRepository,
  resetDebtRepository,
} from "./DebtRepository";
export type {
  DebtLedgerEntity,
  DebtorSummary,
  TopDebtor,
  DebtSummary,
  CreateRepaymentData,
} from "./DebtRepository";

// Exchange Repository
export {
  ExchangeRepository,
  getExchangeRepository,
  resetExchangeRepository,
} from "./ExchangeRepository";
export type {
  ExchangeTransactionEntity,
  CreateExchangeData,
} from "./ExchangeRepository";

// Financial Service Repository (OMT, WHISH, BOB)
export {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  resetFinancialServiceRepository,
} from "./FinancialServiceRepository";
export type {
  FinancialServiceAnalytics,
} from "./FinancialServiceRepository";

// Financial Repository
export {
  FinancialRepository,
  getFinancialRepository,
} from "./FinancialRepository";
export type { MonthlyPL } from "./FinancialRepository";

// Rate Repository
export {
  RateRepository,
  getRateRepository,
  resetRateRepository,
} from "./RateRepository";
export type { ExchangeRateEntity, SetRateData } from "./RateRepository";

// Currency Repository
export {
  CurrencyRepository,
  getCurrencyRepository,
  resetCurrencyRepository,
} from "./CurrencyRepository";
export type {
  CurrencyEntity,
  CreateCurrencyData,
  UpdateCurrencyData,
} from "./CurrencyRepository";

// Recharge Repository
export {
  RechargeRepository,
  getRechargeRepository,
  resetRechargeRepository,
} from "./RechargeRepository";
export type { VirtualStock, RechargeData } from "./RechargeRepository";

// Supplier Repository
export {
  SupplierRepository,
  getSupplierRepository,
  resetSupplierRepository,
} from "./SupplierRepository";
export type {
  SupplierEntity,
  SupplierLedgerEntryEntity,
  SupplierLedgerEntryType,
  CreateSupplierData,
  CreateSupplierLedgerEntryData,
  SupplierBalance,
} from "./SupplierRepository";

// Maintenance Repository
export { MaintenanceRepository } from "./MaintenanceRepository";
export type { MaintenanceJob } from "./MaintenanceRepository";

// Settings Repository
export {
  SettingsRepository,
  getSettingsRepository,
  resetSettingsRepository,
} from "./SettingsRepository";
export type { SettingEntity } from "./SettingsRepository";

// Expense Repository
export {
  ExpenseRepository,
  getExpenseRepository,
  resetExpenseRepository,
} from "./ExpenseRepository";
export type { ExpenseEntity, CreateExpenseData } from "./ExpenseRepository";

// Closing Repository
export {
  ClosingRepository,
  getClosingRepository,
  resetClosingRepository,
} from "./ClosingRepository";
export type {
  DailyClosingEntity,
  ClosingAmountEntity,
  DrawerBalances as ClosingDrawerBalances,
  SystemExpectedBalances,
  DailyStatsSnapshot,
  OpeningBalanceAmount,
  ClosingAmount,
} from "./ClosingRepository";

// Activity Repository
export {
  ActivityRepository,
  getActivityRepository,
  resetActivityRepository,
} from "./ActivityRepository";
export type { ActivityLogEntity, SyncErrorEntity } from "./ActivityRepository";
