/**
 * ElectronApiAdapter — implements the @liratek/ui ApiAdapter interface by
 * delegating every call to the existing backendApi.ts functions.
 *
 * This is a thin shim: it does NOT duplicate ipcOrHttp logic.
 * All transport branching stays in backendApi.ts (the "dual-mode facade").
 */

import type { ApiAdapter } from "@liratek/ui";
import type {
  ProductListFilters,
  CreateUserInput,
  SupplierAccountLinkInput,
  TopUpFromClientInput,
  DailyStatsSnapshotQuery,
  HoldMoneyCreateInput,
  HoldMoneyCollectPayload,
  // LIRA-231 — POS refund-leg-override payloads, derived from the core
  // schema (rule 21).
  SaleRefundPayload,
  SaleRefundItemPayload,
  // LIRA-147 — admin "Undo refund" payload, derived from the core schema
  // (rule 21).
  SaleUndoItemRefundInput,
  // LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — session-basket
  // single-item refund payload/preview shapes, derived from the core
  // schema/repository (rule 21).
  SessionItemRefundPayload,
  SessionItemRefundPreviewPayload,
  // LIRA-185 #1 — recharge payload derived from the core schema (rule 21).
  CreateRechargePayload,
  // LIRA-252 wave 2 — carrier-line manual-drawer-adjustment filters, derived
  // from ClosingRepository (rule 21).
  CarrierLineAdjustmentFilters,
  // Exchange submit payload (incl. payout kept change), derived from the
  // core schema (rule 21).
  ExchangeSubmitPayload,
  // Debts repayment / credit cash-out payloads (incl. kept change), derived
  // from the core schemas (rule 21).
  AddRepaymentPayload,
  DebtCashOutPayload,
  // LIRA-258 — loto sell/settle payloads derived from the core schemas
  // (rule 21).
  LotoSellPayload,
  CreateCustomServicePayload,
  LotoCheckpointSettlePayload,
  LotoCheckpointsSettleBatchPayload,
  // LIRA-262 — "shop used its own stock" expense payload (rule 21).
  CreateStockExpenseInput,
  CreateExpenseRequest,
} from "@liratek/core";
// LIRA-297 — write payloads derived from the core schemas (rule 21):
// `z.input<…>` aliases computed inside core, never hand-copied literals.
import type {
  SaleProcessPayload,
  SaleUpdateMetadataPayload,
  DebtAccountEntryPayload,
  DebtUseCreditPayload,
  DebtUpdateMetadataPayload,
  DebtWriteOffPayload,
  ExpenseUpdateMetadataPayload,
  FinancialUpdateMetadataPayload,
  PartnerCreatePayload,
  PartnerRecordTransactionPayload,
  PartnerUpdatePayload,
  PartnerWriteOffPayload,
  RechargeCashoutPayload,
  SelfChargeTelecomItemPayload,
  TopUpAppPayload,
  TopUpFromPartnerPayload,
  TopUpFromSupplierPayload,
  UpdateExchangeMetadataPayload,
  UpdateRechargeMetadataPayload,
  VoucherCreatePayload,
  CreateFinancialServicePayload,
  AdjustLotPositionPayload,
  CarrierLineCreatePayload,
  CarrierLineUpdateBalancePayload,
  CarrierLineUpdatePayload,
  CreateCheckpointPayload,
  CreateDrawerCashoutPayload,
  CreateDrawerTransferPayload,
  CreateServiceProviderPayload,
  CreateWalletExchangePayload,
  CustomServiceUpdateMetadataPayload,
  DatabaseResetPayload,
  LotoCashPrizePayload,
  LotoCheckpointCreatePayload,
  LotoCheckpointUpdatePayload,
  LotoFeePayload,
  LotoTicketUpdatePayload,
  LotoUpdateMetadataPayload,
  MobileServiceItemCreatePayload,
  MobileServiceItemUpdatePayload,
  PreviewLotSettlementPayload,
  ReceiveStockPayload,
  RegisterProductUnitsPayload,
  ServicePresetCreatePayload,
  ServicePresetUpdatePayload,
  SetRatePayload,
  SupplierCashflowPayload,
  SupplierLedgerEntryPayload,
  SupplierPurchaseCreatePayload,
  SupplierRecordDebtPayload,
  SupplierSettleAccountPayload,
  UpdateCustomServiceFulfillmentPayload,
  UpdateCustomServiceWorkStatusPayload,
  UpdateServiceProviderPayload,
  CreateClientPayload,
  RecordCarrierLineUsagePayload,
  StockAdjustPayload,
} from "@liratek/core";
import * as api from "./backendApi";
// LIRA-263 — maintenance save payload derived from the core schema (rule 21).
import type { SaveMaintenanceJobPayload } from "@liratek/core";
// Session basket checkout payload, derived from the core schema (rule 21).
import type { SessionCheckoutPayload } from "@liratek/core";
import type { PartnerSettleInput, SupplierSettleInput } from "@liratek/core";
import type {
  SalesDateRangeInput,
  UpdateCategoryPayload,
  WarrantySearchInput,
  CreateWarrantyClaimInput,
  WarrantyClaimsForInput,
  VoidWarrantyClaimInput,
  ListDefectiveItemsInput,
  ResolveDefectiveInput,
  CreateSupplierReturnInput,
  CloseSupplierReturnInput,
  ListSupplierReturnsInput,
  WarrantyReportInput,
} from "@liratek/core";

export class ElectronApiAdapter implements ApiAdapter {
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  login = (username: string, password: string, rememberMe?: boolean) =>
    api.login(username, password, rememberMe);
  logout = () => api.logout();
  me = () => api.me();
  /** "Signed-in devices" (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2 step
   *  4) — the caller's own active sessions, never the bearer token. Named
   *  `listUserSessions` (matching `AuthService.listUserSessions`), NOT
   *  `listSessions` — that name is already taken below by the unrelated
   *  Customer Sessions (POS basket) list. */
  listUserSessions = () => api.listUserSessions();
  revokeSession = (id: number) => api.revokeSession(id);
  revokeOtherSessions = () => api.revokeOtherSessions();

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  getClients = (search?: string) => api.getClients(search ?? "");
  createClient = (payload: CreateClientPayload) => api.createClient(payload);
  deleteClient = (id: number) => api.deleteClient(id);
  importClientDebts = (clients: api.ImportedClientPayload[]) =>
    api.importClientDebts(clients);

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  getProducts = (search?: string, filters?: ProductListFilters) =>
    api.getProducts(search ?? "", filters);
  getProductFilterOptions = () => api.getProductFilterOptions();
  getProductSuppliers = () => api.getProductSuppliers();
  /** LIRA-143 Phase 5 — Settings manager: id/name/sort_order/is_active/
   *  product_count rows, distinct from the plain-names `getProductSuppliers`
   *  above. */
  getProductSuppliersFull = () => api.getProductSuppliersFull();
  createProductSupplier = (name: string) => api.createProductSupplier(name);
  updateProductSupplier = (id: number, name: string) =>
    api.updateProductSupplier(id, name);
  deleteProductSupplier = (id: number) => api.deleteProductSupplier(id);
  createProduct = (payload: any) => api.createProduct(payload);
  updateProduct = (id: number, payload: any) => api.updateProduct(id, payload);
  deleteProduct = (id: number) => api.deleteProduct(id);
  batchDeleteProducts = (ids: number[]) => api.batchDeleteProducts(ids);
  /** Inventory grid's multi-select edit (category / min-stock-threshold /
   *  supplier for many products in one call). */
  batchUpdateProducts = (payload: api.BatchUpdateProductsPayload) =>
    api.batchUpdateProducts(payload);
  getLowStockProducts = () => api.getLowStockProducts();
  /** Look up a product by its exact barcode (null when no match) — the
   *  ProductForm barcode generator's uniqueness check. */
  getProductByBarcode = (barcode: string) => api.getProductByBarcode(barcode);
  /** LIRA-225 — single-row product read by id (null when missing), used by
   *  the edit form's Adjust Stock hand-off instead of a filtered list scan. */
  getProductById = (id: number) => api.getProductById(id);
  /** Plain category NAMES, distinct from `getCategoriesFull` below (which
   *  carries id/sort_order/tracks_imei_units). */
  getCategories = () => api.getCategories();
  receiveStock = (payload: ReceiveStockPayload) => api.receiveStock(payload);
  adjustStock = (payload: StockAdjustPayload) => api.adjustStock(payload);
  getStockAdjustments = (productId?: number) =>
    api.getStockAdjustments(productId);
  /** A product's remaining cost batches, FIFO/oldest-first — "where are my
   *  other units and what did each one cost" (owner report 2026-09-07). */
  getOpenStockBatches = (productId: number) =>
    api.getOpenStockBatches(productId);
  resolveScanCode = (code: string) => api.resolveScanCode(code);
  /** LIRA-296 — warranty lookup for any item. */
  searchWarranties = (input: WarrantySearchInput) =>
    api.searchWarranties(input);
  createWarrantyClaim = (input: CreateWarrantyClaimInput) =>
    api.createWarrantyClaim(input);
  getWarrantyClaims = (input: WarrantyClaimsForInput) =>
    api.getWarrantyClaims(input);
  voidWarrantyClaim = (input: VoidWarrantyClaimInput) =>
    api.voidWarrantyClaim(input);
  listDefectiveItems = (input: ListDefectiveItemsInput = {}) =>
    api.listDefectiveItems(input);
  resolveDefectiveItem = (input: ResolveDefectiveInput) =>
    api.resolveDefectiveItem(input);
  createSupplierReturn = (input: CreateSupplierReturnInput) =>
    api.createSupplierReturn(input);
  closeSupplierReturn = (input: CloseSupplierReturnInput) =>
    api.closeSupplierReturn(input);
  listSupplierReturns = (input: ListSupplierReturnsInput = {}) =>
    api.listSupplierReturns(input);
  getWarrantyReport = (input: WarrantyReportInput) =>
    api.getWarrantyReport(input);

  // ---------------------------------------------------------------------------
  // Categories (LIRA-143 Phase 5 — Settings manager)
  // ---------------------------------------------------------------------------
  getCategoriesFull = () => api.getCategoriesFull();
  createCategory = (name: string) => api.createCategory(name);
  updateCategory = (id: number, data: UpdateCategoryPayload) =>
    api.updateCategory(id, data);
  deleteCategory = (id: number) => api.deleteCategory(id);

  // ---------------------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------------------
  getDrafts = () => api.getDrafts();
  deleteDraft = (saleId: number) => api.deleteDraft(saleId);
  processSale = (payload: SaleProcessPayload) => api.processSale(payload);
  /** LIRA-296 SF-2 — sales between two shop days (IPC or REST). */
  getSalesByDateRange = (range: SalesDateRangeInput) =>
    api.getSalesByDateRange(range);
  getSale = (saleId: number) => api.getSale(saleId);
  getSaleItems = (saleId: number) => api.getSaleItems(saleId);
  /** Refund a WHOLE sale (admin only). LIRA-231: refundLegs optional.
   *  2026-09-26: unitExtras optional too (POS "Returned phones").
   *  LIRA-236: exchangeRate optional too. */
  refundSale = (
    saleId: number,
    refundLegs?: SaleRefundPayload["refundLegs"],
    unitExtras?: SaleRefundPayload["unitExtras"],
    exchangeRate?: number,
    keptChange?: SaleRefundPayload["keptChange"],
  ) =>
    keptChange !== undefined
      ? api.refundSale(saleId, refundLegs, unitExtras, exchangeRate, keptChange)
      : api.refundSale(saleId, refundLegs, unitExtras, exchangeRate);
  /** Refund a specific line item off a sale, by quantity (admin only).
   *  LIRA-231: refundLegs optional. 2026-09-26: unitExtras optional too.
   *  LIRA-236: exchangeRate optional too. */
  refundSaleItem = (
    saleId: number,
    saleItemId: number,
    refundQuantity: number,
    refundLegs?: SaleRefundItemPayload["refundLegs"],
    unitExtras?: SaleRefundItemPayload["unitExtras"],
    exchangeRate?: number,
    keptChange?: SaleRefundItemPayload["keptChange"],
  ) =>
    keptChange !== undefined
      ? api.refundSaleItem(
          saleId,
          saleItemId,
          refundQuantity,
          refundLegs,
          unitExtras,
          exchangeRate,
          keptChange,
        )
      : api.refundSaleItem(
          saleId,
          saleItemId,
          refundQuantity,
          refundLegs,
          unitExtras,
          exchangeRate,
        );
  /** LIRA-147 — admin-only "Undo refund" for a standalone per-item refund. */
  undoItemRefund = (
    refundTransactionId: SaleUndoItemRefundInput["refundTransactionId"],
  ) => api.undoItemRefund(refundTransactionId);
  /** LIRA-231 — POS refund preview (both refund buttons). */
  getSaleRefundPreview = (
    saleId: number,
    item?: { saleItemId: number; refundQuantity: number },
  ) => api.getSaleRefundPreview(saleId, item);
  /** Edit non-financial metadata (walk-in name/phone, note) on a sale row. */
  updateSaleMetadata = (data: SaleUpdateMetadataPayload) =>
    api.updateSaleMetadata(data);

  // ---------------------------------------------------------------------------
  // Debts
  // ---------------------------------------------------------------------------
  getDebtors = () => api.getDebtors();
  getClientDebtHistory = (clientId: number) =>
    api.getClientDebtHistory(clientId);
  getClientDebtTotal = (clientId: number) => api.getClientDebtTotal(clientId);
  addRepayment = (payload: AddRepaymentPayload) => api.addRepayment(payload);
  debtWriteOff = (payload: DebtWriteOffPayload) => api.debtWriteOff(payload);
  getClientBalance = (clientId: number) => api.getClientBalance(clientId);
  cashOut = (payload: DebtCashOutPayload) => api.debtCashOut(payload);
  addAccountEntry = (payload: DebtAccountEntryPayload) =>
    api.debtAccountEntry(payload);
  consumeCredit = (payload: DebtUseCreditPayload) => api.debtUseCredit(payload);
  updateDebtMetadata = (payload: DebtUpdateMetadataPayload) =>
    api.debtUpdateMetadata(payload);

  // ---------------------------------------------------------------------------
  // Exchange
  // ---------------------------------------------------------------------------
  getExchangeRates = () => api.getExchangeRates();
  getCurrenciesList = () => api.getCurrenciesList();
  getExchangeHistory = (limit?: number) => api.getExchangeHistory(limit);
  addExchangeTransaction = (payload: ExchangeSubmitPayload) =>
    api.addExchangeTransaction(payload);
  updateExchangeMetadata = (payload: UpdateExchangeMetadataPayload) =>
    api.updateExchangeMetadata(payload);

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------
  getTodayExpenses = () => api.getTodayExpenses();
  addExpense = (payload: CreateExpenseRequest) => api.addExpense(payload);
  deleteExpense = (id: number) => api.deleteExpense(id);
  /** LIRA-262 — the shop used one of its own items (expense at cost, no
   *  cash moves). */
  addStockExpense = (payload: CreateStockExpenseInput) =>
    api.addStockExpense(payload);
  /** Edit non-financial metadata (description/category/note) on an expense
   *  row (the History modal's inline edit). */
  updateExpenseMetadata = (data: ExpenseUpdateMetadataPayload) =>
    api.updateExpenseMetadata(data);

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  getDashboardStats = () => api.getDashboardStats();
  getProfitSalesChart = (type: "Sales" | "Profit", clientDay?: string) =>
    clientDay === undefined
      ? api.getProfitSalesChart(type)
      : api.getProfitSalesChart(type, clientDay);
  getTodaysSales = (date?: string) => api.getTodaysSales(date);
  getDrawerBalances = () => api.getDrawerBalances();
  getDebtSummary = () => api.getDebtSummary();
  getInventoryStockStats = () => api.getInventoryStockStats();
  /** DC-11 — "Net Profit — last 30 days" tile. */
  getNetProfitLast30Days = (clientDay?: string) =>
    clientDay === undefined
      ? api.getNetProfitLast30Days()
      : api.getNetProfitLast30Days(clientDay);
  getDrawerNames = () => api.getDrawerNames();

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  getAllSettings = () => api.getAllSettings();
  getSetting = (key: string) => api.getSetting(key);
  updateSetting = (key: string, value: string) => api.updateSetting(key, value);

  // ---------------------------------------------------------------------------
  // Recharge
  // ---------------------------------------------------------------------------
  getRechargeStock = () => api.getRechargeStock();
  getRechargeHistory = (provider: "MTC" | "Alfa") =>
    api.getRechargeHistory(provider);
  getRechargeTodayStats = (provider: "MTC" | "Alfa") =>
    api.getRechargeTodayStats(provider);
  getRechargeDrawerBalances = () => api.getRechargeDrawerBalances();
  processRecharge = (payload: CreateRechargePayload) =>
    api.processRecharge(payload);
  updateRechargeMetadata = (payload: UpdateRechargeMetadataPayload) =>
    api.updateRechargeMetadata(payload);
  topUpApp = (payload: TopUpAppPayload) => api.topUpApp(payload);
  topUpFromSupplier = (payload: TopUpFromSupplierPayload) =>
    api.topUpFromSupplier(payload);
  /** OMT open-credit account (LIRA-192) — mirror of topUpFromSupplier. */
  cashoutToSupplier = (payload: RechargeCashoutPayload) =>
    api.cashoutToSupplier(payload);
  topUpFromPartner = (payload: TopUpFromPartnerPayload) =>
    api.topUpFromPartner(payload);
  /** Payload type is `TopUpFromClientInput`, derived from
   *  `topUpFromClientSchema` (rule 21) — never hand-copied. */
  topUpFromClient = (payload: TopUpFromClientInput) =>
    api.topUpFromClient(payload);

  // ---------------------------------------------------------------------------
  // Services (OMT / Whish / BOB)
  // ---------------------------------------------------------------------------
  getOMTHistory = (provider?: string) => api.getOMTHistory(provider);
  getOMTAnalytics = (providers?: string[]) => api.getOMTAnalytics(providers);
  addOMTTransaction = (payload: CreateFinancialServicePayload) =>
    api.addOMTTransaction(payload);
  /** A single financial_services record by id — the Debts page's
   *  service-backed debt-detail "eye" button. */
  getFinancialServiceById = (id: number) => api.getFinancialServiceById(id);
  /** All payment rows for a unified transaction — the same debt-detail
   *  "eye" button drills into this alongside `getFinancialServiceById`. */
  getPaymentsByTransaction = (transactionId: number) =>
    api.getPaymentsByTransaction(transactionId);
  /** Edit non-financial metadata on a financial_services row (OMT/Whish/
   *  iPick/Katsh/Binance history modals' inline edit — one shared channel). */
  updateFinancialMetadata = (data: FinancialUpdateMetadataPayload) =>
    api.updateFinancialMetadata(data);
  /** LIRA-090 §5.2: charge a telecom catalog item to the shop's own carrier line.
   *  Admin or staff only. */
  selfChargeTelecomItem = (data: SelfChargeTelecomItemPayload) =>
    api.selfChargeTelecomItem(data);

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------
  getMaintenanceJobs = (statusFilter?: string) =>
    api.getMaintenanceJobs(statusFilter);
  saveMaintenanceJob = (payload: SaveMaintenanceJobPayload) =>
    api.saveMaintenanceJob(payload);
  deleteMaintenanceJob = (id: number) => api.deleteMaintenanceJob(id);
  getMaintenanceStatusHistory = (jobId: number) =>
    api.getMaintenanceStatusHistory(jobId);

  // ---------------------------------------------------------------------------
  // Currencies (CRUD)
  // ---------------------------------------------------------------------------
  getCurrencies = () => api.getCurrencies();
  createCurrency = (
    code: string,
    name: string,
    symbol?: string,
    decimalPlaces?: number,
  ) => api.createCurrency(code, name, symbol, decimalPlaces);
  updateCurrency = (id: number, data: any) => api.updateCurrency(id, data);
  deleteCurrency = (id: number) => api.deleteCurrency(id);

  // ---------------------------------------------------------------------------
  // Closing
  // ---------------------------------------------------------------------------
  getSystemExpectedBalancesDynamic = () =>
    api.getSystemExpectedBalancesDynamic();
  hasOpeningBalanceToday = (day?: string) => api.hasOpeningBalanceToday(day);
  getDailyStatsSnapshot = (input?: DailyStatsSnapshotQuery) =>
    api.getDailyStatsSnapshot(input);
  recalculateDrawerBalances = () => api.recalculateDrawerBalances();
  updateDailyClosing = (
    id: number,
    data: Parameters<typeof api.updateDailyClosing>[1],
  ) => api.updateDailyClosing(id, data);
  completeSetup = (data: {
    shop_name: string;
    admin_username: string;
    admin_password: string;
    base_system?: "OMT" | "WHISH";
    enabled_modules: string[];
    enabled_payment_methods: string[];
    session_management_enabled: boolean;
    customer_sessions_enabled: boolean;
    active_currencies?: string[];
    extra_users?: { username: string; password: string; role: string }[];
    whatsapp_phone?: string;
    whatsapp_api_key?: string;
    drawer_amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>;
    drawer_currency_config?: Array<{
      drawer_name: string;
      currency_codes: string[];
    }>;
    carrier_lines?: Array<{
      carrier: "mtc" | "alfa";
      phone_number: string;
      label?: string | null;
      credits?: number;
      validity_expires_at?: string | null;
    }>;
  }) => api.completeSetup(data);
  createCheckpoint = (data: CreateCheckpointPayload) =>
    api.createCheckpoint(data);
  getCheckpointTimeline = (filters?: {
    date_from?: string;
    date_to?: string;
    type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
    drawer_name?: string;
    user_id?: number;
  }) => api.getCheckpointTimeline(filters);
  getCarrierLineAdjustments = (filters?: CarrierLineAdjustmentFilters) =>
    api.getCarrierLineAdjustments(filters);
  getInitialCheckpointDate = () => api.getInitialCheckpointDate();
  getLastCheckpointPerDrawer = () => api.getLastCheckpointPerDrawer();
  hasInitialBalancesSet = () => api.hasInitialBalancesSet();
  hasStartingCheckpoint = () => api.hasStartingCheckpoint();

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers = (search?: string, includeInactive?: boolean) =>
    api.getSuppliers(search, includeInactive);
  getSupplierBalances = (includeInactive?: boolean) =>
    api.getSupplierBalances(includeInactive);
  getSupplierLedger = (supplierId: number, limit?: number) =>
    api.getSupplierLedger(supplierId, limit);
  /** OMT open-credit account (LIRA-188) — account parent + children rollup. */
  getSupplierAccountBalances = () => api.getSupplierAccountBalances();
  getSupplierAccountLedger = (accountSupplierId: number, limit?: number) =>
    api.getSupplierAccountLedger(accountSupplierId, limit);
  getSupplierAccountUnsettled = (accountSupplierId: number) =>
    api.getSupplierAccountUnsettled(accountSupplierId);
  /** LIRA-255 — gross owed minus unsettled commission, in OMT's own sign. */
  getSupplierAccountExpectedStatement = (accountSupplierId: number) =>
    api.getSupplierAccountExpectedStatement(accountSupplierId);
  updateSupplierAccountLink = (data: SupplierAccountLinkInput) =>
    api.updateSupplierAccountLink(data);
  createSupplier = (data: {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
    module_key?: string;
    provider?: string;
  }) => api.createSupplier(data);
  addSupplierLedgerEntry = (
    supplierId: number,
    data: Omit<SupplierLedgerEntryPayload, "supplier_id">,
  ) => api.addSupplierLedgerEntry(supplierId, data);
  getUnsettledTransactions = (provider: string) =>
    api.getUnsettledTransactions(provider);
  // Payload derived from the core supplierSettleSchema (rule 21).
  settleTransactions = (data: SupplierSettleInput) =>
    api.settleTransactions(data);
  recordSupplierCashflow = (data: SupplierCashflowPayload) =>
    api.recordSupplierCashflow(data);
  /** OMT open-credit account settlement (LIRA-189) — mirror of
   *  settleTransactions above, but scoped to the whole account and taking
   *  the account parent's id separately (matching getSupplierAccountLedger's
   *  two-arg shape) since backendApi.ts needs it to build the REST URL. */
  settleSupplierAccount = (
    accountSupplierId: number,
    data: Omit<SupplierSettleAccountPayload, "account_supplier_id">,
  ) => api.settleSupplierAccount(accountSupplierId, data);
  // supplierWriteOff REMOVED (supplier stock-intake, D8) — the standalone
  // write-off is gone; the bundled pay-form discount in
  // recordSupplierCashflow above is the only surviving forgive-debt path.
  getAllSupplierTransactions = (provider: string, limit?: number) =>
    api.getAllSupplierTransactions(provider, limit);
  getUnsettledSummary = () => api.getUnsettledSummary();
  getSupplierProductBalances = () => api.getSupplierProductBalances();
  getSupplierProductStockValue = () => api.getSupplierProductStockValue();
  getSupplierProductItems = (supplierId: number) =>
    api.getSupplierProductItems(supplierId);
  getSupplierPurchases = (supplierId: number) =>
    api.getSupplierPurchases(supplierId);
  createSupplierPurchase = (data: SupplierPurchaseCreatePayload) =>
    api.createSupplierPurchase(data);
  // LIRA-087 (migration v189)
  recordSupplierDebt = (data: SupplierRecordDebtPayload) =>
    api.recordSupplierDebt(data);
  getOpenRecordedSupplierDebts = (supplierId: number) =>
    api.getOpenRecordedSupplierDebts(supplierId);

  // ---------------------------------------------------------------------------
  // Rates
  // ---------------------------------------------------------------------------
  getRates = () => api.getRates();
  setRate = (data: SetRatePayload) => api.setRate(data);
  deleteRate = (to_code: string) => api.deleteRate(to_code);

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  getNonAdminUsers = () => api.getNonAdminUsers();
  createUser = (data: CreateUserInput) => api.createUser(data);
  setUserActive = (userId: number, is_active: boolean) =>
    api.setUserActive(userId, is_active);
  setUserRole = (userId: number, role: string) => api.setUserRole(userId, role);
  setUserPassword = (userId: number, password: string) =>
    api.setUserPassword(userId, password);

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------
  getRecentActivity = (limit?: number) => api.getRecentActivity(limit);

  // ---------------------------------------------------------------------------
  // Transactions (unified)
  // ---------------------------------------------------------------------------
  getRecentTransactions = (
    limit?: number,
    filters?: api.TransactionFiltersParam,
  ) => api.getRecentTransactions(limit, filters);
  getTransactionById = (id: number) => api.getTransactionById(id);
  /** RCP-3 service-receipt reprint (rule 19 fix). */
  getCustomerFacingLegs = (transactionId: number) =>
    api.getCustomerFacingLegs(transactionId);
  /** D1 — currency in/out by business date (the Audit page's Cash Report). */
  getCashFlowByDate = (from: string, to: string) =>
    api.getCashFlowByDate(from, to);
  getTransactionBySource = (sourceTable: string, sourceId: number) =>
    api.getTransactionBySource(sourceTable, sourceId);
  getClientTransactions = (clientId: number, limit?: number) =>
    api.getClientTransactions(clientId, limit);
  voidTransaction = (id: number) => api.voidTransaction(id);
  /** LIRA-236 — the Transactions-page refund modal's `bookedRate`/
   *  `bookedRateSource` default. */
  getRefundBookedRate = (id: number) => api.getRefundBookedRate(id);
  // Forwards EVERY argument the ApiAdapter declares. It used to stop at
  // `unitExtras`, silently dropping LIRA-236's `exchangeRate` for any caller
  // going through `useApi()` (a shorter parameter list still satisfies the
  // interface, so TypeScript never flagged it).
  refundTransaction = (
    id: number,
    refundLegs?: api.RefundLegOverride[],
    unitExtras?: api.RefundUnitExtraOverride[],
    exchangeRate?: number,
    keptChange?: Parameters<typeof api.refundTransaction>[4],
  ) =>
    api.refundTransaction(id, refundLegs, unitExtras, exchangeRate, keptChange);
  voidCheckoutGroup = (groupId: string) => api.voidCheckoutGroup(groupId);
  /** LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — whole-basket
   *  void/refund, replacing the "Basket item — see admin to reverse" dead
   *  end. Mirrors voidCheckoutGroup immediately above (rule 14). */
  voidSessionBasket = (sessionId: number) => api.voidSessionBasket(sessionId);
  refundSessionBasket = (sessionId: number) =>
    api.refundSessionBasket(sessionId);
  /** LIRA-232 phase 2 — item-level sibling of refundSessionBasket above. */
  refundSessionBasketItem = (payload: SessionItemRefundPayload) =>
    api.refundSessionBasketItem(payload);
  getSessionItemRefundPreview = (payload: SessionItemRefundPreviewPayload) =>
    api.getSessionItemRefundPreview(payload);
  getTransactionDailySummary = (date: string) =>
    api.getTransactionDailySummary(date);
  getDebtAging = (clientId: number) => api.getDebtAging(clientId);
  getOverdueDebts = () => api.getOverdueDebts();
  getRevenueByType = (from: string, to: string) =>
    api.getRevenueByType(from, to);
  getRevenueByUser = (from: string, to: string) =>
    api.getRevenueByUser(from, to);

  // ---------------------------------------------------------------------------
  // Reporting (aggregated analytics)
  // ---------------------------------------------------------------------------
  getDailySummaries = (from: string, to: string) =>
    api.getDailySummaries(from, to);
  getClientHistory = (clientId: number, limit?: number) =>
    api.getClientHistory(clientId, limit);
  getRevenueByModule = (from: string, to: string) =>
    api.getRevenueByModule(from, to);
  getReportOverdueDebts = () => api.getReportOverdueDebts();

  // ---------------------------------------------------------------------------
  // Profits (admin analytics)
  // ---------------------------------------------------------------------------
  getProfitSummary = (from: string, to: string) =>
    api.getProfitSummary(from, to);
  getProfitByModule = (from: string, to: string) =>
    api.getProfitByModule(from, to);
  getProfitByDate = (from: string, to: string) => api.getProfitByDate(from, to);
  getProfitByPaymentMethod = (from: string, to: string) =>
    api.getProfitByPaymentMethod(from, to);
  getProfitByUser = (from: string, to: string) => api.getProfitByUser(from, to);
  getProfitsPasswordStatus = () => api.getProfitsPasswordStatus();
  setProfitsPassword = (password: string) => api.setProfitsPassword(password);
  unlockProfits = (password: string) => api.unlockProfits(password);
  lockProfits = () => api.lockProfits();
  getProfitByClient = (from: string, to: string, limit?: number) =>
    api.getProfitByClient(from, to, limit);
  // PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the
  // By Module drill-down's "Show transactions" list.
  getProfitModuleDetail = (moduleKey: string, from: string, to: string) =>
    api.getProfitModuleDetail(moduleKey, from, to);
  getPendingProfit = (from: string, to: string) =>
    api.getPendingProfit(from, to);
  getProfitsCommissions = (from: string, to: string) =>
    api.getProfitsCommissions(from, to);

  // ---------------------------------------------------------------------------
  // Reports / Backup
  // ---------------------------------------------------------------------------
  generatePDF = (html: string, filename?: string) =>
    api.generatePDF(html, filename);
  backupDatabase = () => api.backupDatabase();
  listBackups = () => api.listBackups();
  verifyBackup = (path: string) => api.verifyBackup(path);
  restoreDatabase = (path: string) => api.restoreDatabase(path);

  // ---------------------------------------------------------------------------
  // Database Reset (LIRA-165)
  // ---------------------------------------------------------------------------
  getDatabaseResetPreview = () => api.getDatabaseResetPreview();
  resetDatabase = (input: DatabaseResetPayload) => api.resetDatabase(input);

  // ---------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------
  getModules = () => api.getModules();
  getEnabledModules = () => api.getEnabledModules();
  getToggleableModules = () => api.getToggleableModules();
  setModuleEnabled = (key: string, enabled: boolean) =>
    api.setModuleEnabled(key, enabled);
  reorderModules = (orderedKeys: string[]) => api.reorderModules(orderedKeys);

  // ---------------------------------------------------------------------------
  // Payment Methods
  // ---------------------------------------------------------------------------
  getPaymentMethods = () => api.getPaymentMethods();
  getActivePaymentMethods = () => api.getActivePaymentMethods();
  createPaymentMethod = (data: {
    code: string;
    label: string;
    drawer_name: string;
    affects_drawer?: number;
  }) => api.createPaymentMethod(data);
  updatePaymentMethod = (
    id: number,
    data: Parameters<typeof api.updatePaymentMethod>[1],
  ) => api.updatePaymentMethod(id, data);
  deletePaymentMethod = (id: number) => api.deletePaymentMethod(id);
  reorderPaymentMethods = (ids: number[]) => api.reorderPaymentMethods(ids);

  // ---------------------------------------------------------------------------
  // Service Providers (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 4a + 5)
  // ---------------------------------------------------------------------------
  getActiveServiceProviders = () => api.getActiveServiceProviders();
  getServiceProviders = () => api.getServiceProviders();
  createServiceProvider = (data: CreateServiceProviderPayload) =>
    api.createServiceProvider(data);
  updateServiceProvider = (id: number, data: UpdateServiceProviderPayload) =>
    api.updateServiceProvider(id, data);
  deleteServiceProvider = (id: number) => api.deleteServiceProvider(id);

  // ---------------------------------------------------------------------------
  // Carrier Lines (LIRA W6.a — shop SIM-line tracking)
  // ---------------------------------------------------------------------------
  getActiveCarrierLines = (carrier: "alfa" | "mtc") =>
    api.getActiveCarrierLines(carrier);
  getAllActiveCarrierLines = () => api.getAllActiveCarrierLines();
  getAdminCarrierLines = () => api.getAdminCarrierLines();
  createCarrierLine = (data: CarrierLineCreatePayload) =>
    api.createCarrierLine(data);
  updateCarrierLine = (
    id: number,
    data: Omit<CarrierLineUpdatePayload, "id">,
  ) => api.updateCarrierLine(id, data);
  updateCarrierLineBalance = (
    id: number,
    data: Omit<CarrierLineUpdateBalancePayload, "id">,
  ) => api.updateCarrierLineBalance(id, data);
  archiveCarrierLine = (id: number) => api.archiveCarrierLine(id);
  toggleCarrierLineActive = (id: number) => api.toggleCarrierLineActive(id);
  /** LIRA-090: get the current primary line for a carrier. */
  getPrimaryCarrierLine = (carrier: "alfa" | "mtc") =>
    api.getPrimaryCarrierLine(carrier);
  /** LIRA-090: designate a line as the primary for its carrier (admin only). */
  setPrimaryCarrierLine = (id: number) => api.setPrimaryCarrierLine(id);
  /** LIRA-145: book a line's consumed credits as a `Line_Usage` expense. */
  recordCarrierLineUsage = (data: RecordCarrierLineUsagePayload) =>
    api.recordCarrierLineUsage(data);
  /** v184 (#28, LIRA-218): the "days still to send" list. */
  getPendingCarrierLineOwedDeliveries = () =>
    api.getPendingCarrierLineOwedDeliveries();
  /** v184 (#28): mark a pending delivery as physically sent. */
  markCarrierLineOwedDeliverySent = (deliveryId: number) =>
    api.markCarrierLineOwedDeliverySent(deliveryId);

  // ---------------------------------------------------------------------------
  // Mobile Service Items — admin (LIRA W6.b) + LIRA-090
  // ---------------------------------------------------------------------------
  getActiveMobileServiceItems = () => api.getActiveMobileServiceItems();
  getAdminMobileServiceItems = () => api.getAdminMobileServiceItems();
  /** Catalog row count — used to decide whether to re-seed an empty catalog. */
  countMobileServiceItems = () => api.countMobileServiceItems();
  /** Bulk-insert the fresh-install catalog (no-ops server-side if non-empty). */
  seedMobileServiceItems = (items: MobileServiceItemCreatePayload[]) =>
    api.seedMobileServiceItems(items);
  createMobileServiceItem = (data: MobileServiceItemCreatePayload) =>
    api.createMobileServiceItem(data);
  updateMobileServiceItem = (
    id: number,
    data: Omit<MobileServiceItemUpdatePayload, "id">,
  ) => api.updateMobileServiceItem(id, data);
  toggleActiveMobileServiceItem = (id: number) =>
    api.toggleActiveMobileServiceItem(id);
  deleteMobileServiceItem = (id: number) => api.deleteMobileServiceItem(id);

  // ---------------------------------------------------------------------------
  // Currency–Module & Currency–Drawer mapping
  // ---------------------------------------------------------------------------
  getModulesForCurrency = (code: string) => api.getModulesForCurrency(code);
  getCurrenciesByModule = (moduleKey: string) =>
    api.getCurrenciesByModule(moduleKey);
  getFullCurrenciesByDrawer = (drawerName: string) =>
    api.getFullCurrenciesByDrawer(drawerName);
  setModulesForCurrency = (code: string, modules: string[]) =>
    api.setModulesForCurrency(code, modules);
  getAllDrawerCurrencies = () => api.getAllDrawerCurrencies();
  getCountableDrawerCurrencies = () => api.getCountableDrawerCurrencies();
  getCurrenciesForDrawer = (drawerName: string) =>
    api.getCurrenciesForDrawer(drawerName);
  getDrawersForCurrency = (code: string) => api.getDrawersForCurrency(code);
  setDrawerCurrencies = (drawerName: string, currencies: string[]) =>
    api.setDrawerCurrencies(drawerName, currencies);
  getConfiguredDrawerNames = () => api.getConfiguredDrawerNames();

  // ---------------------------------------------------------------------------
  // Customer Sessions
  // ---------------------------------------------------------------------------
  startSession = (data: {
    customer_name: string;
    customer_phone?: string;
    customer_notes?: string;
  }) => api.startSession(data);
  getActiveSession = () => api.getActiveSession();
  getSessionDetails = (sessionId: number) => api.getSessionDetails(sessionId);
  updateSession = (
    sessionId: number,
    data: Parameters<typeof api.updateSession>[1],
  ) => api.updateSession(sessionId, data);
  closeSession = (sessionId: number) => api.closeSession(sessionId);
  listSessions = (limit?: number, offset?: number) =>
    api.listSessions(limit, offset);
  linkTransactionToSession = (data: {
    sessionId: number;
    transactionType: string;
    transactionId: number;
    amountUsd: number;
    amountLbp: number;
    profitUsd?: number;
    profitLbp?: number;
  }) => api.linkTransactionToSession(data);

  // Nested namespace mirroring window.api.session — so the session page /
  // context call the SAME method names on desktop (IPC) and web (REST).
  session = {
    getActiveSessions: () => api.getActiveSessions(),
    getTodaySessions: () => api.getTodaySessions(),
    getTodayAllSessions: () => api.getTodayAllSessions(),
    getByDateRange: (from: string, to: string) =>
      api.getSessionsByDateRange(from, to),
    getByCustomer: (data: { customerName: string; customerPhone?: string }) =>
      api.getSessionsByCustomer(data),
    delete: (sessionId: number) => api.deleteSession(sessionId),
    getTransactions: (sessionId: number) => api.getSessionDetails(sessionId),
    cartGet: (sessionId: number) => api.sessionCartGet(sessionId),
    cartAdd: (
      sessionId: number,
      item: {
        item_id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        form_data: string;
        ipc_channel: string;
        user_id?: number;
      },
    ) => api.sessionCartAdd(sessionId, item),
    cartRemove: (sessionId: number, itemId: string) =>
      api.sessionCartRemove(sessionId, itemId),
    cartClear: (sessionId: number) => api.sessionCartClear(sessionId),
    checkout: (data: SessionCheckoutPayload) =>
      api.processSessionCheckout(data),
  };

  // Nested namespace mirroring window.api.holdMoney (dual-mode IPC/REST).
  holdMoney = {
    list: (filter?: { status?: "held" | "collected" }) =>
      api.holdMoneyList(filter),
    active: () => api.holdMoneyActive(),
    create: (data: HoldMoneyCreateInput) => api.holdMoneyCreate(data),
    pickups: (holdMoneyId: number) => api.holdMoneyPickups(holdMoneyId),
    collect: (data: HoldMoneyCollectPayload) => api.holdMoneyCollect(data),
    voidPickup: (pickupId: number) => api.holdMoneyVoidPickup(pickupId),
  };

  // Nested namespace mirroring window.api.servicePresets (dual-mode IPC/REST).
  servicePresets = {
    list: (filter?: { category?: string; includeInactive?: boolean }) =>
      api.servicePresetsList(filter),
    create: (data: ServicePresetCreatePayload) =>
      api.servicePresetsCreate(data),
    update: (id: number, data: ServicePresetUpdatePayload) =>
      api.servicePresetsUpdate(id, data),
    delete: (id: number) => api.servicePresetsDelete(id),
  };

  // Nested namespace mirroring window.api.audit (dual-mode, read-only).
  audit = {
    getRecent: (limit?: number) => api.auditGetRecent(limit),
    search: (filters: {
      userId?: number;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }) => api.auditSearch(filters),
    getByEntity: (entityType: string, entityId: string) =>
      api.auditGetByEntity(entityType, entityId),
  };

  // Nested namespace mirroring window.api.partners (dual-mode IPC/REST).
  // Reads return raw values (array / statement object) to match the IPC
  // handlers; writes return the { success, data? } envelope.
  partners = {
    getAll: (includeInactive?: boolean) =>
      api.partnersGetAll(includeInactive ?? false),
    getById: (id: number) => api.partnersGetById(id),
    getAllBalances: (includeInactive?: boolean) =>
      api.partnersGetAllBalances(includeInactive ?? false),
    getBalance: (partnerId: number) => api.partnersGetBalance(partnerId),
    getLedger: (
      partnerId: number,
      filters?: {
        startDate?: string;
        endDate?: string;
        type?: string;
        mode?: "FOR" | "THROUGH";
        provider?: string;
        direction?: "DEBIT" | "CREDIT";
      },
    ) => api.partnersGetLedger(partnerId, filters),
    create: (data: PartnerCreatePayload) => api.partnersCreate(data),
    update: (id: number, data: PartnerUpdatePayload) =>
      api.partnersUpdate(id, data),
    deactivate: (id: number) => api.partnersDeactivate(id),
    activate: (id: number) => api.partnersActivate(id),
    recordTransaction: (data: PartnerRecordTransactionPayload) =>
      api.partnersRecordTransaction(data),
    // Payload derived from the core partnerSettleSchema (rule 21).
    settle: (data: PartnerSettleInput) => api.partnersSettle(data),
    writeOff: (data: PartnerWriteOffPayload) => api.partnerWriteOff(data),
  };

  // Nested namespace mirroring window.api.vouchers (dual-mode IPC/REST).
  // All channels return the service envelope directly.
  vouchers = {
    getAll: (filters?: { status?: string; clientId?: number }, day?: string) =>
      api.vouchersGetAll(filters, day),
    create: (data: VoucherCreatePayload) => api.vouchersCreate(data),
    validate: (code: string, day?: string) => api.vouchersValidate(code, day),
    cancel: (id: number) => api.vouchersCancel(id),
  };

  // Nested namespace mirroring window.api.drawerTopUp (dual-mode).
  drawerTopUp = {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      /** External (Cash In) mode only — top-ups in currencies other than
       *  USD/LBP already enabled for the General drawer. Never sent by
       *  createFromDrawer (transfer mode). */
      extra_currencies?: {
        currency_code: string;
        amount: number;
        /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — operator
         *  cost-basis override, sent only via the modal's "edit" link. */
        acquisition_usd_per_unit?: number;
        /** NEW (2026-08-23 refinement) — live-feed USD-per-unit rate for a
         *  currency with no configured exchange_rates row. */
        market_usd_per_unit_hint?: number;
      }[];
    }) => api.drawerTopUpCreate(data),
    createFromDrawer: (data: {
      amount_usd: number;
      amount_lbp: number;
      source_drawer: string;
      notes?: string;
    }) => api.drawerTopUpCreateFromDrawer(data),
    getSourceDrawers: () => api.drawerTopUpSourceDrawers(),
    getHistory: (limit?: number) => api.drawerTopUpHistory(limit),
  };

  /** Generic, reversible cash transfer between any two of the shop's own
   *  drawers (Primary Cash Drawer plan §8.6) — replaces the retired
   *  `drawerTopUp.fundSystem`. Flat (not nested) per the plan's exact
   *  adapter contract: `useApi().transferBetweenDrawers(data)`. */
  transferBetweenDrawers = (data: CreateDrawerTransferPayload) =>
    api.transferBetweenDrawers(data);

  // Nested namespace mirroring window.api.drawerCashout (dual-mode).
  drawerCashout = {
    create: (data: CreateDrawerCashoutPayload) => api.drawerCashoutCreate(data),
    getHistory: (limit?: number) => api.drawerCashoutHistory(limit),
  };

  // Nested namespace mirroring window.api.walletExchange (dual-mode).
  walletExchange = {
    create: (data: CreateWalletExchangePayload) =>
      api.walletExchangeCreate(data),
    getHistory: (drawerName?: "OMT_App" | "Whish_App", limit?: number) =>
      api.walletExchangeHistory(drawerName, limit),
  };

  // Nested namespace mirroring window.api.exchangeLots (dual-mode) — cost-
  // basis lot tracking read/admin API (EXCHANGE_LOT_SETTLEMENT.md Phase 4a).
  exchangeLots = {
    preview: (data: PreviewLotSettlementPayload) =>
      api.previewLotSettlement(data),
    getPositions: () => api.getLotPositions(),
    getBreakdown: (exchangeId: number) => api.getLotBreakdown(exchangeId),
    adjust: (data: AdjustLotPositionPayload) => api.adjustLotPosition(data),
  };

  // Nested namespace mirroring window.api.productUnits (dual-mode) — LIRA-143
  // Phase 5 (phone IMEI units & warranty) intake/read API.
  productUnits = {
    register: (data: RegisterProductUnitsPayload) =>
      api.registerProductUnits(data),
    getForProduct: (productId: number, status?: "IN_STOCK" | "SOLD") =>
      api.getProductUnitsForProduct(productId, status),
    list: (filters: api.ProductUnitListFiltersDto) =>
      api.listProductUnits(filters),
    getSummary: (productIds: number[]) =>
      api.getProductUnitsSummary(productIds),
    delete: (unitId: number) => api.deleteProductUnit(unitId),
    getStory: (imei: string) => api.getUnitStory(imei),
    getForSaleItems: (saleItemIds: number[]) =>
      api.getProductUnitsForSaleItems(saleItemIds),
  };

  // ---------------------------------------------------------------------------
  // WhatsApp
  // ---------------------------------------------------------------------------
  sendWhatsAppTestMessage = (recipientPhone: string, shopName: string) =>
    api.sendWhatsAppTestMessage(recipientPhone, shopName);
  sendWhatsAppMessage = (recipientPhone: string, message: string) =>
    api.sendWhatsAppMessage(recipientPhone, message);

  // ---------------------------------------------------------------------------
  // Item Costs
  // ---------------------------------------------------------------------------
  getItemCosts = () => api.getItemCosts();
  setItemCost = (data: {
    provider: string;
    category: string;
    itemKey: string;
    cost: number;
    currency: string;
  }) => api.setItemCost(data);

  // ---------------------------------------------------------------------------
  // Voucher Images
  // ---------------------------------------------------------------------------
  getVoucherImages = () => api.getVoucherImages();
  setVoucherImage = (data: {
    provider: string;
    category: string;
    itemKey: string;
    imageData: string;
  }) => api.setVoucherImage(data);
  deleteVoucherImage = (id: number) => api.deleteVoucherImage(id);

  // ---------------------------------------------------------------------------
  // Custom Services
  // ---------------------------------------------------------------------------
  getCustomServices = (filter?: {
    date?: string;
    workStatus?: "Received" | "In_Progress" | "Ready" | "Delivered";
  }) => api.getCustomServices(filter);
  getCustomServicesSummary = () => api.getCustomServicesSummary();
  getCustomServiceById = (id: number) => api.getCustomServiceById(id);
  addCustomService = (data: CreateCustomServicePayload) =>
    api.addCustomService(data);
  deleteCustomService = (id: number) => api.deleteCustomService(id);
  advanceCustomServiceFulfillment = (
    data: UpdateCustomServiceFulfillmentPayload,
  ) => api.advanceCustomServiceFulfillment(data);
  /** LIRA-083 — set a custom service's WORK status. */
  setCustomServiceWorkStatus = (data: UpdateCustomServiceWorkStatusPayload) =>
    api.setCustomServiceWorkStatus(data);
  /** Edit non-financial metadata (description/client name/phone/note) on a
   *  custom_services row (the History modal's inline edit). */
  updateCustomServiceMetadata = (data: CustomServiceUpdateMetadataPayload) =>
    api.updateCustomServiceMetadata(data);

  // ---------------------------------------------------------------------------
  // Loto
  // ---------------------------------------------------------------------------
  loto = {
    sell: (data: LotoSellPayload) => api.lotoSell(data),
    get: (id: number) => api.lotoGet(id),
    getByDateRange: (from: string, to: string) =>
      api.lotoGetByDateRange(from, to),
    getUncheckpointed: () => api.lotoGetUncheckpointed(),
    update: (id: number, data: LotoTicketUpdatePayload) =>
      api.lotoUpdate(id, data),
    /** Edits a loto TICKET's note (loto_tickets) — NOT a checkpoint's;
     *  see lotoUpdateMetadata in backendApi.ts. No UI caller currently. */
    updateMetadata: (data: LotoUpdateMetadataPayload) =>
      api.lotoUpdateMetadata(data),
    report: (from: string, to: string) => api.lotoReport(from, to),
    settlement: (from: string, to: string) => api.lotoSettlement(from, to),
    checkpoint: {
      create: (data: LotoCheckpointCreatePayload) =>
        api.lotoCheckpointCreate(data),
      get: (id: number) => api.lotoCheckpointGet(id),
      getByDate: (date: string) => api.lotoCheckpointGetByDate(date),
      getByDateRange: (from: string, to: string) =>
        api.lotoCheckpointGetByDateRange(from, to),
      getUnsettled: () => api.lotoCheckpointGetUnsettled(),
      update: (id: number, data: LotoCheckpointUpdatePayload) =>
        api.lotoCheckpointUpdate(id, data),
      markSettled: (id: number, settledAt?: string, settlementId?: number) =>
        api.lotoCheckpointMarkSettled(id, settledAt, settlementId),
      settle: (data: LotoCheckpointSettlePayload) =>
        api.lotoCheckpointSettle(data),
      settleBatch: (data: LotoCheckpointsSettleBatchPayload) =>
        api.lotoCheckpointSettleBatch(data),
      getTotalSalesUnsettled: () => api.lotoCheckpointGetTotalSalesUnsettled(),
      getTotalCommissionUnsettled: () =>
        api.lotoCheckpointGetTotalCommissionUnsettled(),
      getLast: () => api.lotoCheckpointGetLast(),
      createScheduled: (checkpointDate?: string) =>
        api.lotoCheckpointCreateScheduled(checkpointDate),
      delete: (id: number) => api.lotoCheckpointDelete(id),
    },
    cashPrize: {
      create: (data: LotoCashPrizePayload) => api.lotoCashPrizeCreate(data),
      getByDateRange: (from: string, to: string) =>
        api.lotoCashPrizeGetByDateRange(from, to),
      getUnreimbursed: () => api.lotoCashPrizeGetUnreimbursed(),
      markReimbursed: (
        id: number,
        reimbursedDate?: string,
        settlementId?: number,
      ) => api.lotoCashPrizeMarkReimbursed(id, reimbursedDate, settlementId),
      getTotalUnreimbursed: () => api.lotoCashPrizeGetTotalUnreimbursed(),
    },
    fees: {
      create: (data: LotoFeePayload) => api.lotoFeesCreate(data),
      get: (year: number) => api.lotoFeesGet(year),
      pay: (id: number) => api.lotoFeesPay(id),
    },
    settings: {
      get: () => api.lotoSettingsGet(),
      update: (key: string, value: string) =>
        api.lotoSettingsUpdate(key, value),
    },
  };
}
