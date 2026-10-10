// Database
export * from "./db/dbPath.js";
export * from "./db/dbKey.js";
export * from "./db/sqlcipher.js";
export * from "./db/connection.js";
export * from "./db/tenantContext.js";
// Per-tenant connection pool (Phase A) — uses `fs`, Node-only. Exported from
// THIS entry point alone; never add it to browser.ts (rule 29).
export * from "./db/tenantDatabasePool.js";
// Shop-id listing contract (Wave 2 prep, § 12.2/§ 12.3 W3). Pure (no Node
// imports), but exported from this entry point only — nothing in the
// frontend needs it today, and keeping it out of browser.ts avoids growing
// that bundle's surface for no reason.
export * from "./db/tenantDatabaseIds.js";
// Phase D split tool (§ 12.3, offline CLI use only) — uses `fs`/`path`,
// Node-only. Never add to browser.ts.
export * from "./db/tenantSplit.js";
// Safety lock: is the platform database still holding shop data (split not
// run yet)? (§ 12.4, ticket item 1). Imports `tenantSplit.js`, so it is
// transitively Node-only too — never add to browser.ts.
export * from "./db/platformSplitGuard.js";
// Platform-db tenant-id listing (§ 12.4, ticket item 2) — pure (no Node
// imports at all, not even better-sqlite3 at runtime), but exported here
// only; nothing in the frontend needs it.
export * from "./db/listTenantIds.js";
// Migration system (runner infrastructure; migrations added post-production)
export * from "./db/migrations/index.js";

// Constants
export * from "./constants/index.js";

// Utilities
export * from "./utils/crypto.js";
export * from "./utils/logger.js";
export * from "./utils/errors.js";
// LIRA-291: the one wording for a user's sign-in methods (pure).
export * from "./utils/signinMethods.js";
// LIRA-294: the Google profile photo URL rule (pure).
export * from "./utils/googlePicture.js";
export * from "./utils/barcode.js";
export * from "./utils/payments.js";
export * from "./utils/saleMargin.js";
export * from "./utils/formatMoney.js";
export * from "./utils/visibleDrawerCurrencies.js";
export * from "./utils/currency.js";
export * from "./utils/currencyConverter.js";
export * from "./utils/tenantSlug.js";
export * from "./utils/localDate.js";
// LIRA-271 — the ONE session-basket fee-on-top RECEIVE rule, shared by the
// checkout modal and SessionCheckoutService (pure leaf, rule 29).
export * from "./utils/sessionFeeOnTop.js";
// A For-Partner basket item costs the walk-in customer nothing — the ONE
// rule shared by the checkout modal and SessionCheckoutService (pure leaf).
export * from "./utils/sessionForPartnerItem.js";
export * from "./utils/requestDay.js";
export * from "./utils/telecomCredit.js";
export * from "./utils/rechargeDiscount.js";
export * from "./utils/walletReceivePayout.js";
// Generic calendar-date arithmetic (rule 14 — the one definition, moved out
// of carrierLineValidity.js so date-neutral callers don't import a
// carrier-line module to add a day to a date). Re-exported from BOTH entry
// points for the same reason carrierLineValidity.js is: see browser.ts.
export * from "./utils/calendarDate.js";
export * from "./utils/carrierLineValidity.js";
export * from "./utils/insuranceFulfillment.js";
export * from "./utils/customServiceWorkStatus.js";
export * from "./utils/phoneNumber.js";
export * from "./utils/lotMarketRate.js";
export * from "./utils/sqlLike.js";
// LIRA-296: receipt number + warranty state (pure; also in browser.ts).
export * from "./utils/receiptNumber.js";
export * from "./utils/warrantyState.js";
// OMT / WHISH fee tables + commission rates — also exported from browser.ts.
export * from "./utils/omtFees.js";
export * from "./utils/whishFees.js";

// Repositories
export * from "./repositories/index.js";
// SafeSession (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2) — imported
// directly from the concrete file rather than through the repositories
// barrel above, which does not (yet) re-export it. Frontend-facing type: it
// crosses IPC/REST as the "signed-in devices" list shape, so it must also be
// exported from browser.ts (Vite resolves @liratek/core there, not here —
// see the telecomCredit.js note in browser.ts for the exact failure mode a
// missing export there causes).
export type { SafeSession } from "./repositories/SessionRepository.js";

// Type aliases for backwards compatibility
export type {
  ProductEntity as Product,
  ClientEntity as Client,
  SaleRequest,
  SaleItemEntity as SaleItem,
} from "./repositories/index.js";

// Loto (explicit exports due to TS wildcard issue)
export type { LotoReportData } from "./repositories/LotoRepository.js";
export {
  LotoRepository,
  getLotoRepository,
  resetLotoRepository,
} from "./repositories/LotoRepository.js";
export type {
  LotoTicket,
  LotoTicketCreate,
  LotoTicketUpdate,
} from "./repositories/LotoTicketRepository.js";
export {
  LotoTicketRepository,
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "./repositories/LotoTicketRepository.js";
export type { LotoSetting } from "./repositories/LotoSettingsRepository.js";
export {
  LotoSettingsRepository,
  getLotoSettingsRepository,
  resetLotoSettingsRepository,
} from "./repositories/LotoSettingsRepository.js";
export type {
  LotoMonthlyFee,
  LotoMonthlyFeeCreate,
} from "./repositories/LotoMonthlyFeeRepository.js";
export {
  LotoMonthlyFeeRepository,
  getLotoMonthlyFeeRepository,
  resetLotoMonthlyFeeRepository,
} from "./repositories/LotoMonthlyFeeRepository.js";
export type {
  LotoCheckpoint,
  LotoCheckpointCreate,
  LotoCheckpointUpdate,
  LotoSettlement,
} from "./repositories/LotoCheckpointRepository.js";
export {
  LotoCheckpointRepository,
  getLotoCheckpointRepository,
  resetLotoCheckpointRepository,
} from "./repositories/LotoCheckpointRepository.js";
export type {
  LotoCashPrize,
  LotoCashPrizeCreate,
} from "./repositories/LotoCashPrizeRepository.js";
export {
  LotoCashPrizeRepository,
  getLotoCashPrizeRepository,
  resetLotoCashPrizeRepository,
} from "./repositories/LotoCashPrizeRepository.js";

// Services
export * from "./services/index.js";
export {
  BackupService,
  getBackupService,
  resetBackupService,
} from "./services/BackupService.js";
export type { BackupInfo, BackupResult } from "./services/BackupService.js";
// Server/desktop only — deliberately NOT re-exported from browser.ts, which
// must never pull in `getDatabase`.
export {
  BackupRepository,
  getBackupRepository,
  resetBackupRepository,
} from "./repositories/BackupRepository.js";

// Loto Service (explicit exports)
export {
  LotoService,
  getLotoService,
  resetLotoService,
} from "./services/LotoService.js";

// Loto Logger
export { lotoLogger } from "./utils/logger.js";

// Validators
export * from "./validators/index.js";

// Configuration
export * from "./config/env.js";
// Subscription policy constants (v173). Pure data, so it belongs in BOTH
// entry points: the frontend hides non-entitled modules and must apply the
// same ungateable rule the backend enforces, rather than keeping a copy.
export * from "./constants/subscription.js";

export * from "./constants/drawerModules.js";

// The checkpoint-adjustment payments.method code — shared with browser.ts so
// the frontend's audit display can label a checkpoint leg's drawer from the
// SAME definition ClosingRepository posts it with (rule 14).
export * from "./constants/checkpointAdjustment.js";
