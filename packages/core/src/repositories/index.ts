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
  NegativeStockProduct,
  ProductFilterOptions,
} from "./ProductRepository.js";

// Stock Adjustment Repository (LIRA-077 audit trail)
export {
  StockAdjustmentRepository,
  getStockAdjustmentRepository,
  resetStockAdjustmentRepository,
} from "./StockAdjustmentRepository.js";
export type {
  StockAdjustmentEntity,
  StockAdjustmentWithUser,
  CreateStockAdjustmentData,
} from "./StockAdjustmentRepository.js";

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
  RepaymentPaymentLine,
  CounterpartyDiscountData,
} from "./DebtRepository.js";

// Voucher Repository
export {
  VoucherRepository,
  getVoucherRepository,
  resetVoucherRepository,
} from "./VoucherRepository.js";
export type {
  VoucherEntity,
  VoucherStatus,
  CreateVoucherData,
  VoucherFilters,
  RedeemVoucherParams,
} from "./VoucherRepository.js";

// Exchange Repository
export {
  ExchangeRepository,
  getExchangeRepository,
  resetExchangeRepository,
} from "./ExchangeRepository.js";
export type {
  ExchangeTransactionEntity,
  CreateExchangeData,
  CreateExchangeResult,
} from "./ExchangeRepository.js";

// Exchange Lot Repository (EXCHANGE_LOT_SETTLEMENT.md Phase 2 — FIFO cost-basis engine)
export {
  ExchangeLotRepository,
  getExchangeLotRepository,
  resetExchangeLotRepository,
} from "./ExchangeLotRepository.js";
export type {
  LotSourceType,
  LotBasisSource,
  ExchangeLotEntity,
  ExchangeLotSettlementEntity,
  LotSettlementWithLot,
  ExchangePositionAdjustmentEntity,
  CreateLotInput,
  LotSettlementResult,
  FifoConsumeResult,
  ConsumeFifoInput,
  PreviewConsumeInput,
  RestoreSettlementsInput,
  VoidLotsBySourceInput,
  HasActiveSettlementsAgainstSourceInput,
  LotPosition,
  SettlerSummary,
  SourceSummary,
  AdjustInput,
  AdjustResult,
} from "./ExchangeLotRepository.js";

// Product Unit Repository (LIRA-143 phase 2 — per-IMEI phone unit tracking)
export {
  ProductUnitRepository,
  getProductUnitRepository,
  resetProductUnitRepository,
} from "./ProductUnitRepository.js";
export type {
  ProductUnitStatus,
  ProductUnitEntity,
  ProductUnitSummary,
  UnitStory,
  MarkInStockOptions,
} from "./ProductUnitRepository.js";

// Financial Service Repository (OMT, WHISH, BOB, OTHER, iPick, Katsh, WHISH_APP, OMT_APP, BINANCE)
export {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  resetFinancialServiceRepository,
} from "./FinancialServiceRepository.js";
export type {
  FinancialServiceEntity,
  CreateFinancialServiceData,
  TelecomCreditReturnLine,
  SelfChargeTelecomItemData,
  SelfChargeTelecomItemResult,
  ProviderStats,
  CurrencyStats,
  FinancialServiceAnalytics,
  UnsettledSummary,
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

// Service Provider Repository (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 1-2)
export {
  ServiceProviderRepository,
  getServiceProviderRepository,
  resetServiceProviderRepository,
} from "./ServiceProviderRepository.js";
export type {
  ServiceProviderEntity,
  CreateServiceProviderData,
  UpdateServiceProviderData,
} from "./ServiceProviderRepository.js";

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
export type {
  VirtualStock,
  RechargeData,
  RechargeEntity,
} from "./RechargeRepository.js";

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
  SettleTransactionsData,
  SupplierCashflowData,
  SupplierBalance,
  SupplierDiscountData,
} from "./SupplierRepository.js";

// Maintenance Repository
export { MaintenanceRepository } from "./MaintenanceRepository.js";
export type {
  MaintenanceJob,
  MaintenanceRow,
} from "./MaintenanceRepository.js";

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
  CheckpointAmount,
  CheckpointCarrierLineCount,
  CheckpointCarrierLineRecord,
  CreateCheckpointData,
  CheckpointRecord,
  CheckpointFilters,
  DrawerCheckpointStatus,
} from "./ClosingRepository.js";

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
  SessionCartItem,
} from "./CustomerSessionRepository.js";

// Item Cost Repository
export {
  ItemCostRepository,
  getItemCostRepository,
  resetItemCostRepository,
} from "./ItemCostRepository.js";
export type { ItemCostEntity } from "./ItemCostRepository.js";

// Voucher Image Repository
export {
  VoucherImageRepository,
  getVoucherImageRepository,
  resetVoucherImageRepository,
} from "./VoucherImageRepository.js";
export type { VoucherImageEntity } from "./VoucherImageRepository.js";

// Custom Service Repository
export {
  CustomServiceRepository,
  getCustomServiceRepository,
  resetCustomServiceRepository,
} from "./CustomServiceRepository.js";
export type {
  CustomServiceEntity,
  CustomServiceSummary,
} from "./CustomServiceRepository.js";

// Hold Money Repository
export {
  HoldMoneyRepository,
  getHoldMoneyRepository,
  resetHoldMoneyRepository,
} from "./HoldMoneyRepository.js";
export type {
  HoldMoneyEntity,
  HoldMoneyStatus,
  CreateHoldMoneyInput,
  HoldMoneyResult,
} from "./HoldMoneyRepository.js";

// Transaction Repository
export {
  TransactionRepository,
  getTransactionRepository,
  resetTransactionRepository,
} from "./TransactionRepository.js";
export type {
  TransactionEntity,
  CreateTransactionInput,
  TransactionFilters,
  TransactionWithUser,
  DailySummary,
  DebtAgingBuckets,
  OverdueDebtEntry,
  VoidCheckoutGroupResult,
  RefundLegOverride,
} from "./TransactionRepository.js";

// Category Repository
export {
  CategoryRepository,
  getCategoryRepository,
} from "./CategoryRepository.js";
export type { ProductCategory } from "./CategoryRepository.js";

// Product Supplier Repository
export {
  ProductSupplierRepository,
  getProductSupplierRepository,
  resetProductSupplierRepository,
} from "./ProductSupplierRepository.js";
export type {
  ProductSupplier,
  ProductSupplierWithCount,
  ProductSupplierItem,
} from "./ProductSupplierRepository.js";

// Supplier Purchase Repository
export {
  SupplierPurchaseRepository,
  getSupplierPurchaseRepository,
  resetSupplierPurchaseRepository,
} from "./SupplierPurchaseRepository.js";
export type {
  SupplierPurchase,
  CreateSupplierPurchaseData,
} from "./SupplierPurchaseRepository.js";

// Loto Repository (facade - backward compat)
export {
  LotoRepository,
  getLotoRepository,
  resetLotoRepository,
} from "./LotoRepository.js";
export type { LotoReportData } from "./LotoRepository.js";

// Loto Ticket Repository
export {
  LotoTicketRepository,
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "./LotoTicketRepository.js";
export type {
  LotoTicket,
  LotoTicketCreate,
  LotoTicketUpdate,
} from "./LotoTicketRepository.js";

// Loto Settings Repository
export {
  LotoSettingsRepository,
  getLotoSettingsRepository,
  resetLotoSettingsRepository,
} from "./LotoSettingsRepository.js";
export type { LotoSetting } from "./LotoSettingsRepository.js";

// Loto Monthly Fee Repository
export {
  LotoMonthlyFeeRepository,
  getLotoMonthlyFeeRepository,
  resetLotoMonthlyFeeRepository,
} from "./LotoMonthlyFeeRepository.js";
export type {
  LotoMonthlyFee,
  LotoMonthlyFeeCreate,
} from "./LotoMonthlyFeeRepository.js";

// Loto Checkpoint Repository
export {
  LotoCheckpointRepository,
  getLotoCheckpointRepository,
  resetLotoCheckpointRepository,
} from "./LotoCheckpointRepository.js";
export type {
  LotoCheckpoint,
  LotoCheckpointCreate,
  LotoCheckpointUpdate,
  LotoSettlement,
} from "./LotoCheckpointRepository.js";

// Loto Cash Prize Repository
export {
  LotoCashPrizeRepository,
  getLotoCashPrizeRepository,
  resetLotoCashPrizeRepository,
} from "./LotoCashPrizeRepository.js";
export type {
  LotoCashPrize,
  LotoCashPrizeCreate,
} from "./LotoCashPrizeRepository.js";

// Mobile Service Item Repository
export {
  MobileServiceItemRepository,
  getMobileServiceItemRepository,
  resetMobileServiceItemRepository,
} from "./MobileServiceItemRepository.js";
export type {
  MobileServiceItemEntity,
  CreateMobileServiceItemData,
  UpdateMobileServiceItemData,
} from "./MobileServiceItemRepository.js";

// Carrier Line Repository (LIRA W6.a)
export {
  CarrierLineRepository,
  getCarrierLineRepository,
  resetCarrierLineRepository,
  CARRIER_DRAWER_NAMES,
  carrierDrawerName,
} from "./CarrierLineRepository.js";
export type {
  CarrierKey,
  CarrierLineEntity,
  CreateCarrierLineData,
  UpdateCarrierLineData,
  UpdateBalanceData,
} from "./CarrierLineRepository.js";

// Carrier Line Movement Repository (LIRA-090 §8 — rule-20 reversal owner)
export {
  CarrierLineMovementRepository,
  getCarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "./CarrierLineMovementRepository.js";
export type {
  CarrierLineMovementEntity,
  CreateCarrierLineMovementData,
} from "./CarrierLineMovementRepository.js";

// Audit Repository
export {
  AuditRepository,
  getAuditRepository,
  resetAuditRepository,
} from "./AuditRepository.js";
export type {
  AuditLogEntity,
  CreateAuditLogData,
  AuditFilters,
} from "./AuditRepository.js";

// Drawer Top-Up Repository
// NOTE (Primary Cash Drawer plan §8.1/§8.7 — core-money agent, 2026-07-30):
// renamed from SYSTEM_FLOAT_DRAWER_NAMES/SystemFloatDrawerName. The
// DrawerTopUpRepository/Service consumers are owned by a parallel agent —
// this barrel now expects them to re-export the renamed identifiers below;
// see crossFileNeeds in this slice's report if that hasn't landed yet.
export {
  DrawerTopUpRepository,
  getDrawerTopUpRepository,
  resetDrawerTopUpRepository,
  GENERAL_DRAWER,
  PRIMARY_CASH_DRAWER_NAMES,
} from "./DrawerTopUpRepository.js";
export type {
  DrawerTopUpEntity,
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
  CreateSystemFloatTopupData,
  SourceDrawerBalance,
  PrimaryCashDrawerName,
} from "./DrawerTopUpRepository.js";

// Drawer Cash-Out Repository
export {
  DrawerCashoutRepository,
  getDrawerCashoutRepository,
  resetDrawerCashoutRepository,
} from "./DrawerCashoutRepository.js";
export type {
  DrawerCashoutEntity,
  CreateDrawerCashoutData,
} from "./DrawerCashoutRepository.js";

// Wallet Exchange Repository
export {
  WalletExchangeRepository,
  getWalletExchangeRepository,
  resetWalletExchangeRepository,
} from "./WalletExchangeRepository.js";
export type {
  WalletExchangeEntity,
  CreateWalletExchangeData,
  WalletDrawerName,
  WalletCurrency,
} from "./WalletExchangeRepository.js";

export {
  ServicePresetRepository,
  getServicePresetRepository,
  resetServicePresetRepository,
} from "./ServicePresetRepository.js";
export type { ServicePresetEntity } from "./ServicePresetRepository.js";

// Profit Repository (cross-entity reporting)
export {
  ProfitRepository,
  getProfitRepository,
  resetProfitRepository,
} from "./ProfitRepository.js";
export type {
  SalesRevCostRow,
  SalesProfitRow,
  FinCurrencyRow,
  MobileCurrencyRow,
  RechargeCurrencyRow,
  CustomTotalsRow,
  MaintTotalsRow,
  ExchangeTotalsRow,
  ExpenseTotalsRow,
  FinByProviderRow,
  RechargeByCarrierRow,
  ProfitByDateRow,
  PaymentMethodRow,
  CommissionTotalsRow,
  PendingCommissionByProviderRow,
  ProfitByUserRow,
  ProfitByClientRow,
  PendingSaleProfitRow,
  UnsettledCommissionRow,
} from "./ProfitRepository.js";

// Session Payment Repository (basket-payment recorder data access)
export {
  SessionPaymentRepository,
  getSessionPaymentRepository,
  resetSessionPaymentRepository,
} from "./SessionPaymentRepository.js";
export type {
  InsertSessionLegInput,
  InsertBasketDebtInput,
  SessionSaleRow,
} from "./SessionPaymentRepository.js";

// Partner Repository
export {
  PartnerRepository,
  getPartnerRepository,
  resetPartnerRepository,
} from "./PartnerRepository.js";
export type {
  Partner,
  PartnerLedgerEntry,
  PartnerBalance,
  PartnerBalanceBreakdown,
  LedgerFilters,
  CreatePartnerData,
  UpdatePartnerData,
  CreateLedgerEntryData,
} from "./PartnerRepository.js";

// Tenant Repository (control plane — plan §5, WP5/WP6)
export {
  TenantRepository,
  getTenantRepository,
  resetTenantRepository,
} from "./TenantRepository.js";
export type {
  TenantEntity,
  TenantWithStats,
  TenantStatus,
  CreateTenantData,
  UpdateTenantData,
} from "./TenantRepository.js";

// Money posting helpers (moneyPosting.ts — seeded by the Payment-Legs
// Integrity plan's S2 hard-reject leg reconciliation; grown by CQ-3 with the
// shared drawer-upsert/payments-INSERT helpers)
export {
  reconcileLegs,
  expectedTotalIn,
  LEG_RECONCILIATION_EPSILON_USD,
  applyDrawerDelta,
  insertPaymentRow,
} from "./moneyPosting.js";
export type {
  ReconciliationLeg,
  KeptChange,
  ExpectedTotals,
  ReconcileLegsInput,
  ApplyDrawerDeltaInput,
  InsertPaymentRowInput,
} from "./moneyPosting.js";
