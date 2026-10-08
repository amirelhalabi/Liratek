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
  ScanCodeResolution,
} from "./InventoryService.js";

// Client Service
export {
  ClientService,
  getClientService,
  resetClientService,
} from "./ClientService.js";
export type {
  ClientResult,
  ImportedDebtEntry,
  ImportedClientData,
  ImportResult,
} from "./ClientService.js";

// Debt Service
export {
  DebtService,
  getDebtService,
  resetDebtService,
} from "./DebtService.js";
export type {
  RepaymentResult,
  RepaymentData,
  AddCreditData,
} from "./DebtService.js";

// Voucher Service
export {
  VoucherService,
  getVoucherService,
  resetVoucherService,
  redeemVoucherLines,
} from "./VoucherService.js";
export type {
  CreateVoucherInput,
  VoucherResult,
  VoucherListResult,
  VoucherRedemptionLine,
} from "./VoucherService.js";

// Sales Service
export {
  SalesService,
  getSalesService,
  resetSalesService,
} from "./SalesService.js";
export type { SaleResult, NetProfitWindowResult } from "./SalesService.js";

// Exchange Service
export {
  ExchangeService,
  getExchangeService,
  resetExchangeService,
} from "./ExchangeService.js";
export type { ExchangeResult, ExchangeHistoryRow } from "./ExchangeService.js";

// Exchange Lot Service (EXCHANGE_LOT_SETTLEMENT.md Phase 4a — read/admin API
// over the ExchangeLotRepository FIFO engine; does not touch ExchangeService)
export {
  ExchangeLotService,
  getExchangeLotService,
  resetExchangeLotService,
} from "./ExchangeLotService.js";
export type {
  PreviewSettlementInput,
  PreviewSettlementResult,
  NotLotTrackedPreview,
  LotTrackedPreview,
  PreviewSettlementFailure,
  LotPositionWithMarket,
  LotBreakdown,
  AdjustPositionInput,
  AdjustPositionResult,
} from "./ExchangeLotService.js";

// Product Unit Service (LIRA-143 phase 2 — per-IMEI phone unit tracking)
export {
  ProductUnitService,
  getProductUnitService,
  resetProductUnitService,
  computeWarrantyStatus,
} from "./ProductUnitService.js";
export type {
  WarrantySource,
  WarrantyState,
  WarrantyStatusInput,
  WarrantyStatus,
  UnitStoryWithWarranty,
  UnitListRowWithWarranty,
  UnitListResult,
  RegisterUnitsDrift,
  RegisterUnitsResult,
} from "./ProductUnitService.js";

// Financial Service (OMT/WHISH/BOB/OTHER/IPEC/KATCH/WHISH_APP/OMT_APP/BINANCE)
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

// Profits Access Service (Profits password gate — frozen contract)
export {
  ProfitsAccessService,
  getProfitsAccessService,
  resetProfitsAccessService,
} from "./ProfitsAccessService.js";
export type { ProfitsPasswordResult } from "./ProfitsAccessService.js";

// Payment Method Service
export {
  PaymentMethodService,
  getPaymentMethodService,
  resetPaymentMethodService,
} from "./PaymentMethodService.js";
export type { PaymentMethodResult } from "./PaymentMethodService.js";

// Service Provider Service (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 4a + 5)
export {
  ServiceProviderService,
  getServiceProviderService,
  resetServiceProviderService,
} from "./ServiceProviderService.js";
export type { ServiceProviderResult } from "./ServiceProviderService.js";

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
export type { ClosingResult, DailyStatsSnapshot } from "./ClosingService.js";

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

// Session Payment Service (basket-payment recorder)
export {
  SessionPaymentService,
  getSessionPaymentService,
  resetSessionPaymentService,
} from "./SessionPaymentService.js";
export type {
  BasketPaymentLeg,
  RecordBasketPaymentInput,
  RecordBasketPaymentResult,
} from "./SessionPaymentService.js";

// Session Checkout Service (basket checkout orchestration — WP4)
export {
  SessionCheckoutService,
  getSessionCheckoutService,
  resetSessionCheckoutService,
} from "./SessionCheckoutService.js";
export type {
  CheckoutRequest,
  CheckoutCartItem,
  CheckoutPayment,
  CheckoutItemResult,
  CheckoutResult,
} from "./SessionCheckoutService.js";

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
export type {
  CustomServiceResult,
  FulfillmentUpdateResult,
} from "./CustomServiceService.js";

// Hold Money Service
export {
  HoldMoneyService,
  getHoldMoneyService,
  resetHoldMoneyService,
} from "./HoldMoneyService.js";

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
  ProfitModuleDetail,
  ProfitModuleDetailRow,
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

// Mobile Service Item Service
export {
  MobileServiceItemService,
  getMobileServiceItemService,
  resetMobileServiceItemService,
} from "./MobileServiceItemService.js";
export type {
  MobileServiceItemResult,
  MobileServiceItemBulkResult,
} from "./MobileServiceItemService.js";

// Carrier Line Service (LIRA W6.a)
export {
  CarrierLineService,
  getCarrierLineService,
  resetCarrierLineService,
} from "./CarrierLineService.js";
export type {
  CarrierLineResult,
  ApplyMovementInput,
  ApplyMovementData,
  ApplyMovementResult,
  ReverseMovementResult,
  RecordUsageResult,
  OwedDeliveryListResult,
  MarkOwedDeliverySentResult,
} from "./CarrierLineService.js";

// Audit Service
export {
  AuditService,
  getAuditService,
  resetAuditService,
  auditLogger,
} from "./AuditService.js";
export type {
  CreateAuditLogData,
  AuditLogEntity,
  AuditFilters,
  AdminActionAuditInput,
} from "./AuditService.js";

// Audit utilities
export { diffObjects } from "../utils/audit.js";

// Drawer Top-Up Service
export {
  DrawerTopUpService,
  getDrawerTopUpService,
  resetDrawerTopUpService,
} from "./DrawerTopUpService.js";
export type { DrawerTopUpResult } from "./DrawerTopUpService.js";

// Drawer Cash-Out Service
export {
  DrawerCashoutService,
  getDrawerCashoutService,
  resetDrawerCashoutService,
} from "./DrawerCashoutService.js";
export type { DrawerCashoutResult } from "./DrawerCashoutService.js";

// Wallet Exchange Service
export {
  WalletExchangeService,
  getWalletExchangeService,
  resetWalletExchangeService,
} from "./WalletExchangeService.js";
export type {
  WalletExchangeInput,
  WalletExchangeResult,
} from "./WalletExchangeService.js";

export {
  ServicePresetService,
  getServicePresetService,
  resetServicePresetService,
} from "./ServicePresetService.js";

// Partner Service
export {
  PartnerService,
  getPartnerService,
  resetPartnerService,
} from "./PartnerService.js";

// Tenant Provisioning Service (control plane — plan §5, WP5)
export {
  TenantProvisioningService,
  getTenantProvisioningService,
  resetTenantProvisioningService,
} from "./TenantProvisioningService.js";
export type { ProvisionTenantData } from "./TenantProvisioningService.js";

// Sign-up invitations (LIRA-267) — server-only: uses node:crypto via
// utils/crypto.js. Exported from index.ts alone, never browser.ts (rule 29).
export {
  SignupInvitationService,
  getSignupInvitationService,
  resetSignupInvitationService,
  formatInviteExpiry,
  toSignupInvitationView,
  toSignupInviteEmailStatus,
  SIGNUP_INVITE_TTL_MS,
  SIGNUP_INVITE_CLAIM_STALE_MS,
  SIGNUP_INVITE_TEMPLATE,
  SIGNUP_INVITE_URL_KEY,
  SIGNUP_INVITE_INVALID_MESSAGE,
  SIGNUP_INVITATION_LIST_LIMIT,
  SELF_SERVE_PER_EMAIL_LIMIT,
  SELF_SERVE_PER_EMAIL_WINDOW_MS,
  SELF_SERVE_DAILY_WINDOW_MS,
} from "./SignupInvitationService.js";
export type {
  CreateSignupInvitationParams,
  SignupInvitationView,
  RevokeSignupInvitationResult,
  RequestSelfServeParams,
  SelfServeRequestReason,
  SelfServeRequestResult,
  SignupInviteCheckResult,
  SignupInviteEmailStatus,
  ConsumeSignupInviteOutcome,
} from "./SignupInvitationService.js";

// Tenant Storage Provisioner port (Phase C, PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12.2/12.3)
export {
  SharedTenantStorageProvisioner,
  adminEmailFields,
  setTenantStorageProvisioner,
  getTenantStorageProvisionerOverride,
  resetTenantStorageProvisioner,
} from "./TenantStorageProvisioner.js";
export type {
  TenantStorageProvisioner,
  CreateTenantStorageInput,
  TenantStorageDeleteResult,
} from "./TenantStorageProvisioner.js";

// Tenant Stats Service (Phase C fan-out, § 12.3 wave 2)
export {
  TenantStatsService,
  getTenantStatsService,
  resetTenantStatsService,
} from "./TenantStatsService.js";

// Subscription Service (control plane — commercial standing, v173)
export {
  SubscriptionService,
  getSubscriptionService,
  resetSubscriptionService,
  GRACE_PERIOD_DAYS,
  UNGATEABLE_MODULES,
} from "./SubscriptionService.js";
export type { SubscriptionStatusView } from "./SubscriptionService.js";

// Commissions Report Service (Profits page "Commissions" tab —
// OWNER_NOTES_2026-09-21.md §6, lane LC)
export {
  CommissionsReportService,
  getCommissionsReportService,
  resetCommissionsReportService,
  COMMISSION_REPORT_PROVIDERS,
} from "./CommissionsReportService.js";
export type {
  CommissionsReport,
  CommissionProviderRow,
  CommissionReportProvider,
  ExcludedCommissionProvider,
} from "./CommissionsReportService.js";

// Database Reset Service (LIRA-165 — Settings › Reset Data)
export {
  DatabaseResetService,
  getDatabaseResetService,
  resetDatabaseResetService,
} from "./DatabaseResetService.js";
export type {
  DatabaseResetRequest,
  DatabaseResetOutcome,
} from "./DatabaseResetService.js";

// Session Sweep Service (plan § 12.3 wave 2 — per-tenant session sweep fan-out)
export {
  SessionSweepService,
  getSessionSweepService,
  resetSessionSweepService,
} from "./SessionSweepService.js";
export type { SessionSweepResult } from "./SessionSweepService.js";
export {
  AuthTokenCleanupService,
  getAuthTokenCleanupService,
  resetAuthTokenCleanupService,
  AUTH_TOKEN_PURGE_GRACE_MS,
} from "./AuthTokenCleanupService.js";
export type {
  AuthTokenCleanupResult,
  AuthTokenCleanupRepositories,
} from "./AuthTokenCleanupService.js";

// =============================================================================
// Account features (SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md "Contracts"): one
// anchor per feature, blank-line separated so parallel branches merge
// cleanly. Add exports directly under YOUR anchor only.
// =============================================================================

// [auth-A] exports

// [auth-B] exports
// The Node entry (index.ts) reaches the refusal codes through here; the
// browser entry re-exports the same leaf module directly.
export { USER_ACCOUNT_CODES } from "../constants/userAccountCodes.js";
export type { UserAccountCode } from "../constants/userAccountCodes.js";
export {
  UserInvitationService,
  getUserInvitationService,
  resetUserInvitationService,
  UsernameTakenError,
  UserInvitationUsedError,
  UserInviteRateLimitedError,
  UserInvitationNotFoundError,
  UserInviteShopInactiveError,
  JoinGoogleEmailMismatchError,
  userInviteIdempotencyKey,
  USER_INVITE_CLAIM_STALE_MS,
  USER_INVITE_DAILY_LIMIT,
  USER_INVITE_DAILY_WINDOW_MS,
  USER_INVITATION_LIST_LIMIT,
  USER_INVITE_TEMPLATE,
  USER_INVITE_URL_KEY,
  USER_INVITE_INVALID_MESSAGE,
  USER_INVITE_SHOP_INACTIVE_MESSAGE,
} from "./UserInvitationService.js";
export type {
  UserInvitationView,
  UserInviteCheckResult,
  UserInviteSendContext,
  CreateUserInvitationParams,
  RevokeUserInvitationResult,
  AcceptUserInvitationParams,
  AcceptUserInvitationOutcome,
  AcceptUserInvitationWithGoogleParams,
  JoinGoogleIdentity,
} from "./UserInvitationService.js";
export {
  UserEmailService,
  getUserEmailService,
  resetUserEmailService,
  UserNotFoundInShopError,
  UserHasNoEmailError,
  EmailAlreadyVerifiedError,
  EmailVerifyRateLimitedError,
  verifyEmailIdempotencyKey,
  EMAIL_VERIFY_TTL_HOURS,
  EMAIL_VERIFY_PER_USER_LIMIT,
  EMAIL_VERIFY_WINDOW_MS,
  VERIFY_EMAIL_TEMPLATE,
  EMAIL_VERIFY_URL_KEY,
  EMAIL_VERIFY_INVALID_MESSAGE,
} from "./UserEmailService.js";
export type {
  UserEmailView,
  SetUserEmailResult,
  UserEmailSendContext,
  AdminUnlinkGoogleResult,
} from "./UserEmailService.js";

// [auth-C] exports
export {
  PasswordResetService,
  PasswordResetRefusedError,
  getPasswordResetService,
  resetPasswordResetService,
  PASSWORD_RESET_TEMPLATE,
  PASSWORD_RESET_URL_KEY,
} from "./PasswordResetService.js";
export type {
  PasswordResetRequestReason,
  PasswordResetMailOptions,
  RequestPasswordResetParams,
  SendPasswordResetParams,
  PasswordResetCheckResult,
  PasswordResetDone,
  PasswordResetServiceDeps,
  SetInitialPasswordParams,
  SetInitialPasswordResult,
} from "./PasswordResetService.js";
export * from "../constants/passwordReset.js";

// LIRA-287: www "email me a code" sign-in. The service is Node-only
// (node:crypto); the constants + schemas are pure and ALSO exported from
// browser.ts.
export {
  SigninCodeService,
  getSigninCodeService,
  resetSigninCodeService,
  generateSigninCode,
  hashSigninCode,
  SIGNIN_CODE_TEMPLATE,
} from "./SigninCodeService.js";
export type {
  SigninCodeRequestReason,
  RequestSigninCodeParams,
  VerifySigninCodeParams,
  SigninCodeServiceDeps,
} from "./SigninCodeService.js";
export * from "../constants/signinCode.js";

// LIRA-288: the www sign-in directory (platform level, v200). Node-only.
export {
  SigninDirectoryService,
  getSigninDirectoryService,
  resetSigninDirectoryService,
  buildDirectoryRows,
} from "./SigninDirectoryService.js";
export type {
  SigninDirectorySync,
  DirectoryIdentityFacts,
  SigninDirectoryDiff,
  SigninDirectoryRebuildResult,
  SigninDirectoryServiceDeps,
} from "./SigninDirectoryService.js";

// LIRA-290: a shop's contact email = its first admin's confirmed email
// (filled, never overwritten). Node-only.
export {
  ShopContactEmailService,
  getShopContactEmailService,
  resetShopContactEmailService,
} from "./ShopContactEmailService.js";
export type {
  ShopContactEmailFill,
  ShopContactEmailBackfillResult,
  ShopContactEmailServiceDeps,
} from "./ShopContactEmailService.js";

// [auth-D] exports
// Continue with Google (LIRA-280). The service is Node-only (node:crypto,
// network) — never export it from browser.ts (rule 29). The validators file
// is pure and is ALSO exported from browser.ts.
export {
  GoogleAuthService,
  GoogleTokenError,
  getGoogleAuthService,
  resetGoogleAuthService,
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_JWKS_URL,
  GOOGLE_ISSUERS,
  SSO_HANDOFF_TTL_MS,
} from "./GoogleAuthService.js";
export type {
  FetchLike,
  GoogleIdentityClaims,
  GoogleAuthServiceOptions,
} from "./GoogleAuthService.js";
export * from "../validators/googleAuth.js";
