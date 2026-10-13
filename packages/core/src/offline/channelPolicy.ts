/**
 * Desktop channel policy (LIRA-306, R1, FR-009) — PURE, browser-safe.
 *
 * Every desktop IPC channel has exactly one class:
 *   - `offline`     runs on the PC's working copy; write + event in one
 *                   transaction; replayed on the server through a binding.
 *   - `checkpoint`  recorded like `offline`, but HELD on replay (N8).
 *   - `online_only` refused while offline (settings, users, Reset Data,
 *                   supplier/partner settlement, licensing, setup, catalog).
 *   - `read`        runs; any write it attempts is refused (FR-036).
 *   - `local`       runs, never recorded (sign-in bookkeeping, print, …).
 * Anything not listed is `unclassified` and refused (fail closed).
 *
 * Generated from specs/306-offline-desktop-fallback/contracts/channel-policy.md
 * and the read inventory of `electron-app/handlers/*.ts` (414 channels,
 * 2026-10-11) + the 8 planned `offline:*` channels. Guarded by
 * `electron-app/offline/__tests__/channelPolicy.complete.test.ts` (every
 * registered channel classified exactly once) and
 * `offline/__tests__/channelPolicy.test.ts` / `argEnvelope.test.ts`.
 *
 * `recordedSchema(channel)` is the ONE schema the IPC recorder, the replay
 * binding and the id-position walk all use (rule 14): the core body schema,
 * wrapped — only when a positional IPC argument is not already one of its
 * keys — in an envelope that declares that argument, so Zod can never strip
 * it silently (rule 23).
 */
import { z } from "zod";
import * as validators from "../validators/index.js";
import { defOf } from "./schemaShape.js";

export type ChannelClass =
  | "offline"
  | "checkpoint"
  | "online_only"
  | "read"
  | "local";

export type ChannelFamily =
  | "clients"
  | "transactions"
  | "sales"
  | "sessions"
  | "financial"
  | "recharge"
  | "debts"
  | "expenses"
  | "exchange"
  | "maintenance"
  | "customServices"
  | "loto"
  | "stock"
  | "drawers"
  | "checkpoints";

export type ChannelRole = "admin" | "staff";

export interface ChannelPolicyEntry {
  channel: string;
  cls: ChannelClass;
  /** recordable entries only */
  family?: ChannelFamily;
  /** plain words for the review list */
  label?: string;
  /** same roles as the IPC handler's requireRole */
  roles?: readonly ChannelRole[];
  /** export name in `validators/index.ts`; absent ⇔ the channel is in PENDING_LIFT */
  coreSchema?: string;
  /** names for the handler's leading positional arguments */
  argNames?: readonly string[];
  /** `spread`: one more (object) argument follows argNames and is merged
   *  into the named payload; `none`: the handler takes argNames only */
  body?: "spread" | "none";
}

const RECORDABLE: readonly ChannelPolicyEntry[] = [
  { channel: "carrier-lines:record-usage", cls: "offline", family: "recharge", label: "Line usage recorded", roles: ["admin", "staff"], coreSchema: "recordCarrierLineUsageSchema" },
  { channel: "carrier-lines:mark-owed-delivery-sent", cls: "offline", family: "recharge", label: "Owed line credit marked as sent", roles: ["admin", "staff"], coreSchema: "markCarrierLineOwedDeliverySentSchema" },
  { channel: "clients:create", cls: "offline", family: "clients", label: "New customer", roles: ["admin", "staff"], coreSchema: "clientWriteSchema" },
  { channel: "clients:update", cls: "offline", family: "clients", label: "Customer edited", roles: ["admin", "staff"], coreSchema: "clientWriteSchema" },
  { channel: "custom-services:add", cls: "offline", family: "customServices", label: "Custom service sale", roles: ["admin"], coreSchema: "createCustomServiceSchema" },
  { channel: "custom-services:delete", cls: "offline", family: "customServices", label: "Custom service deleted", roles: ["admin"], coreSchema: "customServiceIdParamSchema", argNames: ["id"], body: "none" },
  { channel: "custom-services:update-metadata", cls: "offline", family: "customServices", label: "Custom service details edited", roles: ["admin", "staff"], coreSchema: "customServiceUpdateMetadataSchema" },
  { channel: "custom-services:advance-fulfillment", cls: "offline", family: "customServices", label: "Custom service fulfilment step", roles: ["admin", "staff"], coreSchema: "updateCustomServiceFulfillmentSchema" },
  { channel: "custom-services:set-work-status", cls: "offline", family: "customServices", label: "Custom service work status", roles: ["admin", "staff"], coreSchema: "updateCustomServiceWorkStatusSchema" },
  { channel: "db:add-expense", cls: "offline", family: "expenses", label: "Expense", roles: ["admin", "staff"], coreSchema: "createExpenseSchema" },
  { channel: "expenses:add-stock-use", cls: "offline", family: "expenses", label: "Stock used as an expense", roles: ["admin", "staff"], coreSchema: "createStockExpenseSchema" },
  { channel: "db:delete-expense", cls: "offline", family: "expenses", label: "Expense deleted", roles: ["admin"], coreSchema: "expenseIdParamSchema", argNames: ["id"], body: "none" },
  { channel: "expenses:update-metadata", cls: "offline", family: "expenses", label: "Expense details edited", roles: ["admin", "staff"], coreSchema: "expenseUpdateMetadataSchema" },
  { channel: "debt:add-repayment", cls: "offline", family: "debts", label: "Debt repayment", roles: ["admin", "staff"], coreSchema: "addRepaymentSchema" },
  { channel: "debt:cash-out", cls: "offline", family: "debts", label: "Customer credit cashed out", roles: ["admin", "staff"], coreSchema: "debtCashOutSchema" },
  { channel: "debt:add-account-entry", cls: "offline", family: "debts", label: "Customer account entry", roles: ["admin", "staff"], coreSchema: "debtAccountEntrySchema" },
  { channel: "debts:update-metadata", cls: "offline", family: "debts", label: "Debt note edited", roles: ["admin", "staff"], coreSchema: "debtUpdateMetadataSchema" },
  { channel: "debt:add-credit", cls: "offline", family: "debts", label: "Customer credit added", roles: ["admin", "staff"], coreSchema: "addCreditSchema" },
  { channel: "debt:use-credit", cls: "offline", family: "debts", label: "Customer credit used", roles: ["admin", "staff"], coreSchema: "debtUseCreditSchema" },
  { channel: "debt:write-off", cls: "offline", family: "debts", label: "Debt written off", roles: ["admin"], coreSchema: "debtWriteOffSchema" },
  { channel: "drawer-cashout:create", cls: "offline", family: "drawers", label: "Drawer cash-out", roles: ["admin"], coreSchema: "createDrawerCashoutSchema" },
  { channel: "drawer-topup:create", cls: "offline", family: "drawers", label: "Drawer top-up", roles: ["admin", "staff"], coreSchema: "drawerTopUpCreateSchema" },
  { channel: "drawer-topup:create-from-drawer", cls: "offline", family: "drawers", label: "Drawer top-up from another drawer", roles: ["admin", "staff"], coreSchema: "drawerTopUpFromDrawerSchema" },
  { channel: "drawer-topup:transfer", cls: "offline", family: "drawers", label: "Drawer transfer", roles: ["admin", "staff"], coreSchema: "createDrawerTransferSchema" },
  { channel: "exchange:add-transaction", cls: "offline", family: "exchange", label: "Currency exchange", roles: ["admin", "staff"], coreSchema: "exchangeSubmitSchema" },
  { channel: "exchange:update-metadata", cls: "offline", family: "exchange", label: "Exchange details edited", roles: ["admin", "staff"], coreSchema: "updateExchangeMetadataSchema" },
  { channel: "hold-money:create", cls: "offline", family: "drawers", label: "Money held for a customer", roles: ["admin", "staff"], coreSchema: "holdMoneyCreateSchema" },
  { channel: "hold-money:collect", cls: "offline", family: "drawers", label: "Held money collected", roles: ["admin", "staff"], coreSchema: "holdMoneyCollectSchema" },
  { channel: "hold-money:void-pickup", cls: "offline", family: "drawers", label: "Held-money pickup voided", roles: ["admin", "staff"], coreSchema: "holdMoneyVoidPickupSchema" },
  { channel: "inventory:adjust-stock", cls: "offline", family: "stock", label: "Stock adjusted", roles: ["admin", "staff"], coreSchema: "stockAdjustSchema" },
  { channel: "inventory:receive-stock", cls: "offline", family: "stock", label: "Stock received", roles: ["admin", "staff"], coreSchema: "receiveStockSchema" },
  { channel: "loto:sell", cls: "offline", family: "loto", label: "Loto ticket sale", roles: ["admin"], coreSchema: "lotoSellSchema" },
  { channel: "loto:update", cls: "offline", family: "loto", label: "Loto ticket edited", roles: ["admin"], coreSchema: "lotoTicketUpdateSchema", argNames: ["id"], body: "spread" },
  { channel: "loto:cash-prize:create", cls: "offline", family: "loto", label: "Loto prize paid", roles: ["admin"], coreSchema: "lotoCashPrizeSchema" },
  { channel: "loto:update-metadata", cls: "offline", family: "loto", label: "Loto ticket note edited", roles: ["admin", "staff"], coreSchema: "lotoUpdateMetadataSchema" },
  { channel: "maintenance:save", cls: "offline", family: "maintenance", label: "Repair job saved", roles: ["admin", "staff"], coreSchema: "saveMaintenanceJobSchema" },
  { channel: "maintenance:delete", cls: "offline", family: "maintenance", label: "Repair job deleted", roles: ["admin"], coreSchema: "maintenanceIdParamSchema", argNames: ["id"], body: "none" },
  { channel: "maintenance:update-metadata", cls: "offline", family: "maintenance", label: "Repair job details edited", roles: ["admin", "staff"], coreSchema: "maintenanceUpdateMetadataSchema" },
  { channel: "omt:add-transaction", cls: "offline", family: "financial", label: "OMT / Whish transfer", roles: ["admin", "staff"], coreSchema: "createFinancialServiceSchema" },
  { channel: "financial:update-metadata", cls: "offline", family: "financial", label: "Transfer details edited", roles: ["admin", "staff"], coreSchema: "financialUpdateMetadataSchema" },
  { channel: "financial:self-charge-telecom-item", cls: "offline", family: "financial", label: "Shop line self-charge", roles: ["admin", "staff"], coreSchema: "selfChargeTelecomItemSchema" },
  { channel: "product-units:register", cls: "offline", family: "stock", label: "Serial units registered", roles: ["admin", "staff"], coreSchema: "registerProductUnitsSchema" },
  { channel: "product-units:delete", cls: "offline", family: "stock", label: "Serial unit deleted", roles: ["admin", "staff"], coreSchema: "productUnitIdSchema" },
  { channel: "recharge:process", cls: "offline", family: "recharge", label: "Recharge sale", roles: ["admin", "staff"], coreSchema: "createRechargeSchema" },
  { channel: "recharge:top-up-from-client", cls: "offline", family: "recharge", label: "App wallet funded by a customer", roles: ["admin", "staff"], coreSchema: "topUpFromClientSchema" },
  { channel: "recharge:update-metadata", cls: "offline", family: "recharge", label: "Recharge details edited", roles: ["admin", "staff"], coreSchema: "updateRechargeMetadataSchema" },
  { channel: "sales:process", cls: "offline", family: "sales", label: "POS sale", roles: ["admin", "staff"], coreSchema: "saleProcessSchema" },
  { channel: "sales:delete-draft", cls: "offline", family: "sales", label: "Draft sale deleted", roles: ["admin", "staff"], coreSchema: "saleDeleteDraftSchema", argNames: ["saleId"], body: "none" },
  { channel: "sales:refund", cls: "offline", family: "sales", label: "Sale refunded", roles: ["admin"], coreSchema: "saleRefundSchema", argNames: ["saleId", "refundLegs", "unitExtras", "exchangeRate", "keptChange"], body: "none" },
  { channel: "sales:refund-item", cls: "offline", family: "sales", label: "Sale item refunded", roles: ["admin"], coreSchema: "saleRefundItemSchema" },
  { channel: "sales:undo-item-refund", cls: "offline", family: "sales", label: "Item refund undone", roles: ["admin"], coreSchema: "saleUndoItemRefundSchema" },
  { channel: "sales:update-metadata", cls: "offline", family: "sales", label: "Sale details edited", roles: ["admin", "staff"], coreSchema: "saleUpdateMetadataSchema" },
  { channel: "session:start", cls: "offline", family: "sessions", label: "Customer basket opened", roles: ["admin", "staff"], coreSchema: "startSessionIpcSchema" },
  { channel: "session:update", cls: "offline", family: "sessions", label: "Customer basket edited", roles: ["admin", "staff"], coreSchema: "updateSessionSchema", argNames: ["sessionId"], body: "spread" },
  { channel: "session:close", cls: "offline", family: "sessions", label: "Customer basket closed", roles: ["admin", "staff"], coreSchema: "sessionIdPayloadSchema", argNames: ["sessionId"], body: "none" },
  { channel: "session:delete", cls: "offline", family: "sessions", label: "Customer basket deleted", roles: ["admin", "staff"], coreSchema: "sessionIdPayloadSchema", argNames: ["sessionId"], body: "none" },
  { channel: "session:linkTransaction", cls: "offline", family: "sessions", label: "Item added to a customer basket", roles: ["admin", "staff"], coreSchema: "linkSessionTransactionSchema" },
  { channel: "session:checkout", cls: "offline", family: "sessions", label: "Customer basket checkout", roles: ["admin", "staff"], coreSchema: "sessionCheckoutSchema" },
  { channel: "session:cart:add", cls: "offline", family: "sessions", label: "Basket line added", roles: ["admin", "staff"], coreSchema: "sessionCartAddSchema", argNames: ["sessionId"], body: "spread" },
  { channel: "session:cart:remove", cls: "offline", family: "sessions", label: "Basket line removed", roles: ["admin", "staff"], coreSchema: "sessionCartRemoveSchema", argNames: ["sessionId", "itemId"], body: "none" },
  { channel: "session:cart:clear", cls: "offline", family: "sessions", label: "Basket cleared", roles: ["admin", "staff"], coreSchema: "sessionIdPayloadSchema", argNames: ["sessionId"], body: "none" },
  { channel: "transactions:void", cls: "offline", family: "transactions", label: "Transaction voided", roles: ["admin"], coreSchema: "transactionVoidSchema", argNames: ["transactionId"], body: "none" },
  { channel: "transactions:refund", cls: "offline", family: "transactions", label: "Transaction refunded", roles: ["admin"], coreSchema: "transactionRefundSchema", argNames: ["transactionId", "refundLegs", "refundUnitExtras", "exchangeRate", "keptChange"], body: "none" },
  { channel: "transactions:void-checkout-group", cls: "offline", family: "sessions", label: "Checkout group voided", roles: ["admin"], coreSchema: "voidCheckoutGroupSchema" },
  { channel: "transactions:void-session-basket", cls: "offline", family: "sessions", label: "Customer basket voided", roles: ["admin"], coreSchema: "sessionBasketReversalSchema" },
  { channel: "transactions:refund-session-basket", cls: "offline", family: "sessions", label: "Customer basket refunded", roles: ["admin"], coreSchema: "sessionBasketReversalSchema" },
  { channel: "transactions:refund-session-basket-item", cls: "offline", family: "sessions", label: "Customer basket item refunded", roles: ["admin"], coreSchema: "sessionItemRefundSchema" },
  { channel: "wallet-exchange:create", cls: "offline", family: "financial", label: "Wallet exchange", roles: ["admin", "staff"], coreSchema: "createWalletExchangeSchema" },
  { channel: "warranty:claim", cls: "offline", family: "maintenance", label: "Warranty claim", roles: ["admin", "staff"], coreSchema: "createWarrantyClaimSchema" },
  { channel: "warranty:void-claim", cls: "offline", family: "maintenance", label: "Warranty claim voided", roles: ["admin"], coreSchema: "voidWarrantyClaimSchema" },
  { channel: "carrier-lines:update-balance", cls: "checkpoint", family: "checkpoints", label: "Line balance reading", roles: ["admin", "staff"], coreSchema: "carrierLineUpdateBalanceSchema", argNames: ["id"], body: "spread" },
  { channel: "closing:create-checkpoint", cls: "checkpoint", family: "checkpoints", label: "Drawer count / checkpoint", roles: ["admin"], coreSchema: "createCheckpointSchema" },
  { channel: "closing:update-daily-closing", cls: "checkpoint", family: "checkpoints", label: "Closing edited", roles: ["admin", "staff"], coreSchema: "updateDailyClosingIpcSchema" },
  { channel: "loto:checkpoint:create", cls: "checkpoint", family: "checkpoints", label: "Loto checkpoint", roles: ["admin"], coreSchema: "lotoCheckpointCreateSchema" },
  { channel: "loto:checkpoint:update", cls: "checkpoint", family: "checkpoints", label: "Loto checkpoint edited", roles: ["admin"], coreSchema: "lotoCheckpointUpdateSchema", argNames: ["id"], body: "spread" },
  { channel: "loto:checkpoint:create-scheduled", cls: "checkpoint", family: "checkpoints", label: "Scheduled loto checkpoint", roles: ["admin"], coreSchema: "lotoCheckpointCreateScheduledSchema", argNames: ["checkpointDate"], body: "none" },
  { channel: "loto:checkpoint:delete", cls: "checkpoint", family: "checkpoints", label: "Loto checkpoint deleted", roles: ["admin"], coreSchema: "lotoCheckpointDeleteSchema", argNames: ["id"], body: "none" },
];

/** Refused offline: settings, users, Reset Data, supplier/partner settlement, licensing, setup, catalog (N2, O-new-6, O-new-9). */
const ONLINE_ONLY: readonly string[] = [
  "auth:revoke-session",
  "auth:revoke-other-sessions",
  "auth:change-own-password",
  "resale-lines:recharge",
  "resale-lines:save",
  "resale-lines:write-off",
  "users:create",
  "users:set-password",
  "users:set-active",
  "users:set-role",
  "backup:create",
  "backup:delete",
  "backup:setDir",
  "carrier-lines:create",
  "carrier-lines:update",
  "carrier-lines:archive",
  "carrier-lines:toggle-active",
  "carrier-lines:set-primary",
  "clients:delete",
  "clients:import-debts",
  "currencies:create",
  "currencies:update",
  "currencies:delete",
  "currencies:setModules",
  "currencies:setDrawerCurrencies",
  "service-presets:create",
  "service-presets:update",
  "service-presets:delete",
  "database:reset",
  "db:update-setting",
  "settings:update",
  "closing:recalculate-drawer-balances",
  "database:changePath",
  "exchange-lots:adjust",
  "inventory:create-product",
  "inventory:update-product",
  "inventory:batch-update",
  "inventory:delete-product",
  "inventory:batch-delete",
  "inventory:create-category",
  "inventory:update-category",
  "inventory:delete-category",
  "inventory:create-product-supplier",
  "inventory:update-product-supplier",
  "inventory:delete-product-supplier",
  "item-costs:set",
  "license:setKey",
  "license:check",
  "loto:fees:create",
  "loto:fees:pay",
  "loto:settings:update",
  "loto:checkpoint:mark-settled",
  "loto:checkpoint:settle",
  "loto:checkpoints:settle-batch",
  "loto:cash-prize:mark-reimbursed",
  "mobile-service-items:create",
  "mobile-service-items:update",
  "mobile-service-items:toggle-active",
  "mobile-service-items:delete",
  "mobile-service-items:seed",
  "modules:setEnabled",
  "modules:bulkSetEnabled",
  "modules:reorder",
  "partners:create",
  "partners:update",
  "partners:deactivate",
  "partners:activate",
  "partners:record-transaction",
  "partners:settle",
  "partners:write-off",
  "payment-methods:create",
  "payment-methods:update",
  "payment-methods:delete",
  "payment-methods:reorder",
  "profits:set-password",
  "rates:set",
  "rates:delete",
  "recharge:top-up-app",
  "recharge:top-up-from-supplier",
  "recharge:cashout-to-supplier",
  "recharge:top-up-from-partner",
  "report:backup-db",
  "report:restore-db",
  "service-providers:create",
  "service-providers:update",
  "service-providers:delete",
  "setup:complete",
  "setup:reset",
  "setup:joinExistingShop",
  "suppliers:create",
  "suppliers:update-account-link",
  "suppliers:add-ledger-entry",
  "suppliers:settle-transactions",
  "suppliers:settle-account",
  "suppliers:purchase-create",
  "suppliers:record-debt",
  "suppliers:record-cashflow",
  "updater:check",
  "updater:download",
  "updater:quit-and-install",
  "voucher:create",
  // O-impl-C-1 (LIRA-306): owner 2026-10-11 "vouchers … online-only" — cancel too
  // (O-new-6 had kept cancel offline). Undo: move back to RECORDABLE (drawers).
  "voucher:cancel",
  "voucher-images:set",
  "voucher-images:delete",
  "warranty:defective-resolve",
  "warranty:supplier-return-create",
  "warranty:supplier-return-close",
  "whatsapp:send-test",
  "whatsapp:send-message",
];

/** Run offline, never recorded: sign-in bookkeeping, print, dialogs, voice, offline controls. */
const LOCAL: readonly string[] = [
  "auth:login",
  "auth:logout",
  "auth:restore-session",
  "backup:pickDir",
  "database:browse",
  "print:silent",
  "print:with-dialog",
  "profits:unlock",
  "profits:lock",
  "report:generate-pdf",
  "setup:browseForDatabase",
  "setup:relaunch",
  "voicebot:qwen:connect",
  "voicebot:qwen:disconnect",
  "voicebot:qwen:send-audio",
  "voicebot:qwen:stop",
  "offline:status",
  "offline:pair",
  "offline:unpair",
  "offline:go-offline",
  "offline:back-to-web",
  "offline:send-now",
  "offline:open-web-app",
  "offline:install-update",
];

/** Reads — run under the write guard offline (FR-036). */
const READ: readonly string[] = [
  "activity:get-recent",
  "audit:get-by-entity",
  "audit:get-recent",
  "audit:search",
  "auth:get-current-user",
  "auth:list-sessions",
  "backup:getDir",
  "backup:list",
  "carrier-lines:get-active-by-carrier",
  "carrier-lines:get-all-active",
  "carrier-lines:get-all-admin",
  "carrier-lines:get-owed-deliveries-pending",
  "carrier-lines:get-primary",
  "clients:get-all",
  "clients:get-one",
  "closing:get-daily-stats-snapshot",
  "closing:get-initial-checkpoint-date",
  "closing:get-last-checkpoint-actuals",
  "closing:get-last-checkpoint-per-drawer",
  "closing:get-since-last-count",
  "closing:get-system-expected-balances-dynamic",
  "closing:getCarrierLineAdjustments",
  "closing:getCheckpointTimeline",
  "closing:has-initial-balances-set",
  "closing:has-opening-balance-today",
  "closing:has-starting-checkpoint",
  "currencies:allDrawerCurrencies",
  "currencies:byModule",
  "currencies:configuredDrawers",
  "currencies:countableDrawerCurrencies",
  "currencies:forDrawer",
  "currencies:fullForDrawer",
  "currencies:getDrawers",
  "currencies:getModules",
  "currencies:list",
  "custom-services:get",
  "custom-services:list",
  "custom-services:summary",
  "dashboard:get-debt-summary",
  "dashboard:get-drawer-balances",
  "dashboard:get-net-profit-last-30-days",
  "dashboard:get-profit-sales-chart",
  "database:isJoinInstallation",
  "database:resetPreview",
  "db:get-expense-history",
  "db:get-setting",
  "db:get-settings",
  "db:get-today-expenses",
  "debt:client-balance",
  "debt:get-client-history",
  "debt:get-client-total",
  "debt:get-debtors",
  "debt:get-open-items",
  "diagnostics:foreign-key-check",
  "diagnostics:get-sync-errors",
  "diagnostics:getDbPath",
  "drawer-cashout:history",
  "drawer-topup:history",
  "drawer-topup:source-drawers",
  "exchange-lots:breakdown",
  "exchange-lots:positions",
  "exchange-lots:preview",
  "exchange:get-history",
  "financial:get-drawer-names",
  "hold-money:active",
  "hold-money:list",
  "hold-money:pickups",
  "inventory:get-categories",
  "inventory:get-categories-full",
  "inventory:get-low-stock-products",
  "inventory:get-negative-stock",
  "inventory:get-open-stock-batches",
  "inventory:get-product",
  "inventory:get-product-by-barcode",
  "inventory:get-product-filter-options",
  "inventory:get-product-suppliers",
  "inventory:get-product-suppliers-full",
  "inventory:get-products",
  "inventory:get-stock-adjustments",
  "inventory:get-stock-stats",
  "inventory:resolve-scan-code",
  "item-costs:get-all",
  "license:status",
  "loto:cash-prize:get-by-date-range",
  "loto:cash-prize:get-total-unreimbursed",
  "loto:cash-prize:get-unreimbursed",
  "loto:checkpoint:get",
  "loto:checkpoint:get-by-date",
  "loto:checkpoint:get-by-date-range",
  "loto:checkpoint:get-last",
  "loto:checkpoint:get-total-commission-unsettled",
  "loto:checkpoint:get-total-sales-unsettled",
  "loto:checkpoint:get-unsettled",
  "loto:fees:get",
  "loto:get",
  "loto:get-by-date-range",
  "loto:get-uncheckpointed",
  "loto:report",
  "loto:settings:get",
  "loto:settlement",
  "loto:settlement:get-history",
  "maintenance:get-jobs",
  "maintenance:getStatusHistory",
  "mobile-service-items:count",
  "mobile-service-items:get-all",
  "mobile-service-items:get-all-admin",
  "mobile-service-items:get-by-provider",
  "mobile-service-items:get-by-provider-category",
  "mobile-service-items:get-categories",
  "mobile-service-items:get-subcategories",
  "modules:enabled",
  "modules:list",
  "modules:toggleable",
  "omt:get-analytics",
  "omt:get-by-id",
  "omt:get-history",
  "omt:get-payments-by-transaction",
  "partners:get-all",
  "partners:get-all-balances",
  "partners:get-balance",
  "partners:get-by-id",
  "partners:get-ledger",
  "payment-methods:list",
  "payment-methods:list-active",
  "print:get-printers",
  "product-units:for-product",
  "product-units:for-sale-items",
  "product-units:list",
  "product-units:story",
  "product-units:summary",
  "profits:by-client",
  "profits:by-date",
  "profits:by-module",
  "profits:by-payment-method",
  "profits:by-user",
  "profits:commissions",
  "profits:module-detail",
  "profits:password-status",
  "profits:pending",
  "profits:summary",
  "rates:list",
  "recharge:get-drawer-balances",
  "recharge:get-history",
  "recharge:get-stock",
  "recharge:get-today-stats",
  "report:list-backups",
  "report:verify-backup",
  "reports:client-history",
  "reports:daily-summaries",
  "reports:overdue-debts",
  "reports:revenue-by-module",
  "resale-lines:list",
  "sales:get",
  "sales:get-by-date-range",
  "sales:get-dashboard-stats",
  "sales:get-drafts",
  "sales:get-items",
  "sales:get-todays-sales",
  "sales:get-top-products",
  "sales:refund-preview",
  "service-presets:list",
  "service-providers:list",
  "service-providers:list-active",
  "session:byDateRange",
  "session:cart:get",
  "session:getActive",
  "session:getActiveSessions",
  "session:getByCustomer",
  "session:getDetails",
  "session:list",
  "session:today",
  "session:todayAll",
  "settings:get-all",
  "setup:detectNetworkDb",
  "setup:isRequired",
  "suppliers:account-balances",
  "suppliers:account-expected-statement",
  "suppliers:account-ledger",
  "suppliers:account-unsettled",
  "suppliers:all-transactions",
  "suppliers:balances",
  "suppliers:ledger",
  "suppliers:list",
  "suppliers:open-recorded-debts",
  "suppliers:product-balances",
  "suppliers:product-items",
  "suppliers:product-stock-value",
  "suppliers:purchases",
  "suppliers:unsettled-summary",
  "suppliers:unsettled-transactions",
  "transactions:cash-flow-by-date",
  "transactions:daily-summary",
  "transactions:debt-aging",
  "transactions:get-by-client",
  "transactions:get-by-date-range",
  "transactions:get-by-id",
  "transactions:get-by-source",
  "transactions:get-customer-legs",
  "transactions:get-recent",
  "transactions:get-refund-booked-rate",
  "transactions:overdue-debts",
  "transactions:revenue-by-type",
  "transactions:revenue-by-user",
  "transactions:session-basket-item-refund-preview",
  "updater:get-status",
  "users:get-non-admins",
  "voicebot:execute",
  "voicebot:parse",
  "voucher-images:get-all",
  "voucher:get-all",
  "voucher:validate",
  "wallet-exchange:history",
  "warranty:claims-for",
  "warranty:defective",
  "warranty:report",
  "warranty:search",
  "warranty:supplier-returns",
];

/** Classified ahead of registration (T122/T136 register them). */
/** Classified ahead of registration — empty since T136 registered the last offline:* channels. */
export const PLANNED_CHANNELS: readonly string[] = [];

/** Recordable channels with no shared core schema yet (rule 23 lifts) — 23 at design time, 18 after the US1 lifts (T041). Must be empty before release (T077). */
export const PENDING_LIFT: readonly string[] = [
];

function plain(cls: ChannelClass, names: readonly string[]): ChannelPolicyEntry[] {
  return names.map((channel) => ({ channel, cls }));
}

/** Every classified channel, once. */
export const CHANNEL_POLICY: readonly ChannelPolicyEntry[] = [
  ...RECORDABLE,
  ...plain("online_only", ONLINE_ONLY),
  ...plain("local", LOCAL),
  ...plain("read", READ),
];

const BY_CHANNEL = new Map<string, ChannelPolicyEntry>(
  CHANNEL_POLICY.map((e) => [e.channel, e]),
);

export function policyEntry(channel: string): ChannelPolicyEntry | undefined {
  return BY_CHANNEL.get(channel);
}

/** The channel's class, or `unclassified` (refused — fail closed). */
export function classOf(channel: string): ChannelClass | "unclassified" {
  return BY_CHANNEL.get(channel)?.cls ?? "unclassified";
}

export function isRecordableChannel(channel: string): boolean {
  const c = classOf(channel);
  return c === "offline" || c === "checkpoint";
}

export function policyCounts(): Record<ChannelClass | "total", number> {
  const out = { offline: 0, online_only: 0, checkpoint: 0, read: 0, local: 0, total: 0 };
  for (const e of CHANNEL_POLICY) {
    out[e.cls] += 1;
    out.total += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// recordedSchema — the envelope (analyze pass 3, D1)
// ---------------------------------------------------------------------------

type AnyObjectSchema = z.ZodObject<z.ZodRawShape>;

/** The object shape under a schema (looks through a transform pipe). */
export function objectShapeOf(schema: z.ZodType): Record<string, z.ZodType> | null {
  const def = defOf(schema);
  if (def.type === "pipe" && def.in) return objectShapeOf(def.in);
  if (def.type === "object") return (def.shape ?? null) as Record<string, z.ZodType> | null;
  return null;
}

/** Positional ids are positive integers; everything else positional is kept
 *  as given (it is never an id position). */
function envelopeKey(name: string): z.ZodType {
  return name === "id" || /Id$/.test(name) ? z.number().int().positive() : z.unknown();
}

const schemaCache = new Map<string, z.ZodType | null>();

/**
 * The schema a channel's NAMED payload is parsed with — on the PC before
 * recording and on the server before replay. `null` for non-recordable
 * channels and for channels still in {@link PENDING_LIFT}.
 */
export function recordedSchema(channel: string): z.ZodType | null {
  if (schemaCache.has(channel)) return schemaCache.get(channel)!;
  const entry = BY_CHANNEL.get(channel);
  let result: z.ZodType | null = null;
  if (entry && (entry.cls === "offline" || entry.cls === "checkpoint") && entry.coreSchema) {
    const body = (validators as Record<string, unknown>)[entry.coreSchema] as z.ZodType | undefined;
    if (!body || typeof (body as { safeParse?: unknown }).safeParse !== "function") {
      throw new Error(`channel policy: ${channel} names unknown core schema ${entry.coreSchema}`);
    }
    const shape = objectShapeOf(body);
    const missing = (entry.argNames ?? []).filter((a) => !shape || !(a in shape));
    if (missing.length === 0) {
      result = body;
    } else {
      if (!shape || defOf(body).type !== "object") {
        throw new Error(`channel policy: ${channel} needs an envelope but its schema is not a plain object`);
      }
      const extra: Record<string, z.ZodType> = {};
      for (const a of missing) extra[a] = envelopeKey(a);
      const obj = body as unknown as AnyObjectSchema & {
        safeExtend?: (s: Record<string, z.ZodType>) => z.ZodType;
      };
      result = typeof obj.safeExtend === "function" ? obj.safeExtend(extra) : obj.extend(extra);
    }
  }
  schemaCache.set(channel, result);
  return result;
}

/**
 * Positional IPC arguments → the named payload the schema parses
 * (`session:update(7, {customer_name})` → `{ sessionId: 7, customer_name }`).
 * Channels without argNames take their single object argument as is.
 */
export function namedPayload(channel: string, args: readonly unknown[]): Record<string, unknown> {
  const entry = BY_CHANNEL.get(channel);
  if (!entry?.argNames) {
    const first = args[0];
    return first && typeof first === "object" ? { ...(first as Record<string, unknown>) } : {};
  }
  const out: Record<string, unknown> = {};
  if (entry.body === "spread") {
    const bodyArg = args[entry.argNames.length];
    if (bodyArg && typeof bodyArg === "object") Object.assign(out, bodyArg);
  }
  entry.argNames.forEach((name, i) => {
    if (args[i] !== undefined) out[name] = args[i];
  });
  return out;
}
