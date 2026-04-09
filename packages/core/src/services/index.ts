/**
 * Services exports
 */

// Auth Service
export {
  AuthService,
  getAuthService,
  resetAuthService,
} from "./AuthService.js";
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
export type {
  ProductResult,
  StockAdjustmentResult,
} from "./InventoryService.js";

// Client Service
export {
  ClientService,
  getClientService,
  resetClientService,
} from "./ClientService.js";
export type { ClientResult } from "./ClientService.js";

// Debt Service
export {
  DebtService,
  getDebtService,
  resetDebtService,
} from "./DebtService.js";
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

// Financial Service (OMT/WHISH/BOB/OTHER/IPEC/KATCH/WISH_APP/OMT_APP/BINANCE)
export {
  FinancialService,
  getFinancialService,
  resetFinancialService,
} from "./FinancialService.js";
export type { FinancialServiceResult } from "./FinancialService.js";

// Rate Service
export {
  RateService,
  getRateService,
  resetRateService,
} from "./RateService.js";
export type { RateResult } from "./RateService.js";

// Currency Service
export {
  CurrencyService,
  getCurrencyService,
  resetCurrencyService,
} from "./CurrencyService.js";
export type { CurrencyResult } from "./CurrencyService.js";

// Module Service
export {
  ModuleService,
  getModuleService,
  resetModuleService,
} from "./ModuleService.js";
export type { ModuleResult } from "./ModuleService.js";

// Recharge Service
export {
  RechargeService,
  getRechargeService,
  resetRechargeService,
} from "./RechargeService.js";
export type { RechargeResult } from "./RechargeService.js";

// Maintenance Service
export {
  MaintenanceService,
  getMaintenanceService,
  resetMaintenanceService,
} from "./MaintenanceService.js";
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

// Payment Method Service
export {
  PaymentMethodService,
  getPaymentMethodService,
  resetPaymentMethodService,
} from "./PaymentMethodService.js";
export type { PaymentMethodResult } from "./PaymentMethodService.js";

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

// Activity Service (legacy adapter — delegates to TransactionService)
export {
  ActivityService,
  getActivityService,
  resetActivityService,
} from "./ActivityService.js";
export type { ActivityLogEntity, SyncErrorEntity } from "./ActivityService.js";

// Supplier Service
export {
  SupplierService,
  getSupplierService,
  resetSupplierService,
} from "./SupplierService.js";
export type { SupplierResult } from "./SupplierService.js";

// Customer Session Service
export { CustomerSessionService } from "./CustomerSessionService.js";

// WhatsApp Service
export {
  WhatsAppService,
  getWhatsAppService,
  resetWhatsAppService,
} from "./WhatsAppService.js";
export type { WhatsAppResult } from "./WhatsAppService.js";

// Item Cost Service
export {
  ItemCostService,
  getItemCostService,
  resetItemCostService,
} from "./ItemCostService.js";

// Voucher Image Service
export {
  VoucherImageService,
  getVoucherImageService,
  resetVoucherImageService,
} from "./VoucherImageService.js";

// Custom Service
export {
  CustomServiceService,
  getCustomServiceService,
  resetCustomServiceService,
} from "./CustomServiceService.js";
export type { CustomServiceResult } from "./CustomServiceService.js";

// Transaction Service
export {
  TransactionService,
  getTransactionService,
  resetTransactionService,
} from "./TransactionService.js";

// Reporting Service
export {
  ReportingService,
  getReportingService,
  resetReportingService,
} from "./ReportingService.js";
export type { PeriodSummary, ClientHistory } from "./ReportingService.js";

// Profit Service
export {
  ProfitService,
  getProfitService,
  resetProfitService,
} from "./ProfitService.js";
export type {
  ProfitSummary,
  ProfitByModule,
  ProfitByDate,
  ProfitByPaymentMethod,
  ProfitByUser,
  ProfitByClient,
  PendingProfitRow,
} from "./ProfitService.js";

// Voice Bot Service
export {
  VoiceBotService,
  getVoiceBotService,
  resetVoiceBotService,
} from "./VoiceBotService.js";
export type { VoiceCommand, VoiceCommandPattern } from "./VoiceBotService.js";

// Loto Service
export {
  LotoService,
  getLotoService,
  resetLotoService,
} from "./LotoService.js";
export type { SellTicketData, SettlementData } from "./LotoService.js";
