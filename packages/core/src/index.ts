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
// LIRA-331: UI language (pure leaves, also exported from browser.ts).
export * from "./constants/languages.js";
export * from "./utils/effectiveLanguage.js";
export * from "./messages/serverMessages.js";
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
// LIRA-270 — the ONE "nothing left to collect" rule, shared by the checkout
// modal and SessionPaymentService (pure leaf, rule 29).
export * from "./utils/sessionNothingToCollect.js";
// LIRA-304 — the ONE debt-repayment allocation (which items a payment pays,
// how much cash goes to the primary cash drawer), shared by the repayment
// modal preview and DebtRepository.addRepayment (pure leaf, rule 29).
export * from "./utils/debtRepaymentAllocation.js";
// LIRA-322 — the ONE amount-first OMT account allocator (preview + write).
export * from "./utils/accountSettleAllocation.js";
// LIRA-343 — OMT settle by day: day vs account rows (R4), calendar days and
// the ONE picked-days payload builder (rule 22). Pure leaves (rule 29).
export * from "./utils/accountRowScope.js";
export * from "./utils/settleDays.js";
export * from "./utils/settleDaySelections.js";
// LIRA-346 — partner settle units (server side; the repository uses them).
export * from "./utils/partnerSettleUnits.js";
export * from "./utils/debtSettleDays.js";
// LIRA-345 — which suppliers settle on the day calendar (pure leaf, rule 29).
export * from "./utils/settlesByDay.js";
// LIRA-322 — the one audit/summary text for suppliers:settle-account.
export * from "./utils/settleAccountAudit.js";
// LIRA-304 — basket checkout cash split, OMT first: shared by the session
// checkout "Goes to" preview and SessionPaymentService (pure leaf, rule 29).
export * from "./utils/sessionCashSplit.js";
export * from "./utils/requestDay.js";
export * from "./utils/telecomCredit.js";
export * from "./utils/rechargeDiscount.js";
export * from "./utils/walletReceivePayout.js";
// Owner decision 2026-10-16 — the LBP change note rounding (pure; the
// payment box and the change-rounding expense share it, rule 14).
export * from "./utils/changeRounding.js";
export * from "./utils/walletTransfer.js";
// LIRA-301 — transaction titles and summary wording, shared by web, desktop and phone (pure).
export * from "./utils/transactionText.js";
export * from "./utils/transactionVisibility.js";
export * from "./utils/cashFlow.js";
// LIRA-333 — the one WhatsApp phone rule (FR-014/015).
export * from "./utils/whatsappPhone.js";
export * from "./utils/transactionRowDisplay.js";
// LIRA-302 — catalog cart payload (web + phone) and the USD/LBP rate reader (pure).
export * from "./utils/catalogSale.js";
export * from "./utils/exchangeRates.js";
// Generic calendar-date arithmetic (rule 14 — the one definition, moved out
// of carrierLineValidity.js so date-neutral callers don't import a
// carrier-line module to add a day to a date). Re-exported from BOTH entry
// points for the same reason carrierLineValidity.js is: see browser.ts.
export * from "./utils/calendarDate.js";
// LIRA-332 — the free-trial calendar (explicit Asia/Beirut zone, DST-aware)
// and the WhatsApp activation link. Pure leaves, in BOTH entry points: the
// web banner and the phone render the server's trial view and build the same
// link, while the server enforces with the same calendar (rule 14, rule 29).
export * from "./utils/trialCalendar.js";
export * from "./utils/activationLink.js";
export * from "./utils/carrierLineValidity.js";
// LIRA-309 — line status (OK/EXPIRING/IN_GRACE/LOST) for both kinds of line.
export * from "./utils/lineStatus.js";
// LIRA-337 — give-back figures, shared by the Phone Lines panel and the service.
export * from "./utils/lineGiveBack.js";
// LIRA-338 — which providers' cards can be charged to the shop's own lines.
export * from "./constants/lineChargeProviders.js";
export * from "./utils/insuranceFulfillment.js";
export * from "./utils/customServiceWorkStatus.js";
export * from "./utils/phoneNumber.js";
export * from "./utils/lotMarketRate.js";
export * from "./utils/sqlLike.js";
// LIRA-296: receipt number + warranty state (pure; also in browser.ts).
export * from "./utils/receiptNumber.js";
export * from "./utils/warrantyState.js";
// LIRA-296 P3: what a unit serial is called (IMEI | Serial).
export * from "./utils/serialLabel.js";
// OMT / WHISH fee tables + commission rates — also exported from browser.ts.
export * from "./utils/omtFees.js";
// LIRA-256 — OMT statement covered-types predicate (pure leaf, rule 29).
export * from "./utils/omtCoveredTypes.js";
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
export * from "./constants/accountCreditWriteOff.js";

// LIRA-335 — checkpoint open differences: the one status derivation
// (pure leaf, no imports beyond constants), shared by core and the timeline.
export * from "./utils/checkpointDifference.js";

// LIRA-306 offline desktop fallback — pure modules (also in browser.ts).
export * from "./offline/index.js";
// LIRA-306 — server-only replay readers (tenant context; never in browser.ts).
export * from "./utils/requestNow.js";
export * from "./utils/effectiveRate.js";
// LIRA-306 — server-only replay pieces (never in browser.ts, rule 29).
export * from "./db/replayGuard.js";
export * from "./offline/ReplayEngine.js";
export * from "./offline/bindings/index.js";
// LIRA-306 US2/US3 (Agent A2) — clock correction, duplicates, review list (server-only).
export * from "./offline/skew.js";
export * from "./services/DuplicateDetector.js";
export * from "./services/OfflineReviewService.js";
// LIRA-306 US4 (Agent D) — shop copy builder + its cache service (server-only).
export {
  buildTenantSnapshot,
  SNAPSHOT_STRIPPED_TABLES,
  SNAPSHOT_KEPT_TABLES,
  SNAPSHOT_GLOBAL_TABLES_ALLOWED,
  SNAPSHOT_NULLED_COLUMNS,
  SNAPSHOT_KEPT_COLUMNS,
  SNAPSHOT_SECRET_SETTING_PATTERN,
  SNAPSHOT_KEPT_SETTING_KEYS,
  type TenantSnapshot,
  type BuildTenantSnapshotOptions,
} from "./db/tenantSnapshot.js";
export {
  OfflineSnapshotService,
  getOfflineSnapshotService,
  resetOfflineSnapshotService,
  type OfflineSnapshotServiceDeps,
} from "./services/OfflineSnapshotService.js";
