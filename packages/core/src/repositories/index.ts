/**
 * Repository exports
 */

// Base Repository
export { BaseRepository } from "./BaseRepository.js";
export type {
  BaseEntity,
  FindOptions,
  UpdateOptions,
  PaginatedResult,
} from "./BaseRepository.js";

// User Repository
export {
  UserRepository,
  getUserRepository,
  resetUserRepository,
} from "./UserRepository.js";
export type {
  UserEntity,
  SafeUser,
  CreateUserData,
  UpdateUserData,
} from "./UserRepository.js";

// Product Repository
export {
  ProductRepository,
  getProductRepository,
  resetProductRepository,
} from "./ProductRepository.js";
export type {
  ProductEntity,
  ProductDTO,
  CreateProductData,
  UpdateProductData,
  StockStats,
  LowStockProduct,
} from "./ProductRepository.js";

// Client Repository
export {
  ClientRepository,
  getClientRepository,
  resetClientRepository,
} from "./ClientRepository.js";
export type {
  ClientEntity,
  CreateClientData,
  UpdateClientData,
} from "./ClientRepository.js";

// Sales Repository
export {
  SalesRepository,
  getSalesRepository,
  resetSalesRepository,
} from "./SalesRepository.js";
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
} from "./SalesRepository.js";

// Debt Repository
export {
  DebtRepository,
  getDebtRepository,
  resetDebtRepository,
} from "./DebtRepository.js";
export type {
  DebtLedgerEntity,
  DebtorSummary,
  TopDebtor,
  DebtSummary,
  CreateRepaymentData,
} from "./DebtRepository.js";

// Exchange Repository
export {
  ExchangeRepository,
  getExchangeRepository,
  resetExchangeRepository,
} from "./ExchangeRepository.js";
export type {
  ExchangeTransactionEntity,
  CreateExchangeData,
} from "./ExchangeRepository.js";

// Binance Repository
export {
  BinanceRepository,
  getBinanceRepository,
  resetBinanceRepository,
} from "./BinanceRepository.js";
export type {
  BinanceTransactionEntity,
  CreateBinanceTransactionData,
  BinanceTodayStats,
} from "./BinanceRepository.js";

// Financial Service Repository (OMT, WHISH, BOB)
export {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  resetFinancialServiceRepository,
} from "./FinancialServiceRepository.js";
export type {
  FinancialServiceEntity,
  CreateFinancialServiceData,
  ProviderStats,
  CurrencyStats,
  FinancialServiceAnalytics,
} from "./FinancialServiceRepository.js";

// Financial Repository
export {
  FinancialRepository,
  getFinancialRepository,
} from "./FinancialRepository.js";
export type { MonthlyPL } from "./FinancialRepository.js";

// Payment Method Repository
export {
  PaymentMethodRepository,
  getPaymentMethodRepository,
  resetPaymentMethodRepository,
} from "./PaymentMethodRepository.js";
export type {
  PaymentMethodEntity,
  CreatePaymentMethodData,
  UpdatePaymentMethodData,
} from "./PaymentMethodRepository.js";

// Rate Repository
export {
  RateRepository,
  getRateRepository,
  resetRateRepository,
} from "./RateRepository.js";
export type { ExchangeRateEntity, SetRateData } from "./RateRepository.js";

// Currency Repository
export {
  CurrencyRepository,
  getCurrencyRepository,
  resetCurrencyRepository,
} from "./CurrencyRepository.js";
export type {
  CurrencyEntity,
  CreateCurrencyData,
  UpdateCurrencyData,
} from "./CurrencyRepository.js";

// Module Repository
export {
  ModuleRepository,
  getModuleRepository,
  resetModuleRepository,
} from "./ModuleRepository.js";
export type { ModuleEntity } from "./ModuleRepository.js";

// Recharge Repository
export {
  RechargeRepository,
  getRechargeRepository,
  resetRechargeRepository,
} from "./RechargeRepository.js";
export type { VirtualStock, RechargeData } from "./RechargeRepository.js";

// Supplier Repository
export {
  SupplierRepository,
  getSupplierRepository,
  resetSupplierRepository,
} from "./SupplierRepository.js";
export type {
  SupplierEntity,
  SupplierLedgerEntryEntity,
  SupplierLedgerEntryType,
  CreateSupplierData,
  CreateSupplierLedgerEntryData,
  SupplierBalance,
} from "./SupplierRepository.js";

// Maintenance Repository
export { MaintenanceRepository } from "./MaintenanceRepository.js";
export type { MaintenanceJob } from "./MaintenanceRepository.js";

// Settings Repository
export {
  SettingsRepository,
  getSettingsRepository,
  resetSettingsRepository,
} from "./SettingsRepository.js";
export type { SettingEntity } from "./SettingsRepository.js";

// Session Repository
export {
  SessionRepository,
  getSessionRepository,
  resetSessionRepository,
  SESSION_DURATION,
} from "./SessionRepository.js";
export type {
  SessionEntity,
  CreateSessionData,
  UpdateSessionData,
} from "./SessionRepository.js";

// Expense Repository
export {
  ExpenseRepository,
  getExpenseRepository,
  resetExpenseRepository,
} from "./ExpenseRepository.js";
export type { ExpenseEntity, CreateExpenseData } from "./ExpenseRepository.js";

// Closing Repository
export {
  ClosingRepository,
  getClosingRepository,
  resetClosingRepository,
} from "./ClosingRepository.js";
export type {
  DailyClosingEntity,
  ClosingAmountEntity,
  DynamicSystemExpectedBalances,
  DailyStatsSnapshot,
  OpeningBalanceAmount,
  ClosingAmount,
} from "./ClosingRepository.js";

// Activity Repository
export {
  ActivityRepository,
  getActivityRepository,
  resetActivityRepository,
} from "./ActivityRepository.js";
export type {
  ActivityLogEntity,
  SyncErrorEntity,
} from "./ActivityRepository.js";

// Customer Session Repository
export {
  CustomerSessionRepository,
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "./CustomerSessionRepository.js";
export type {
  CustomerSession,
  CreateCustomerSessionData,
  SessionTransaction,
} from "./CustomerSessionRepository.js";
