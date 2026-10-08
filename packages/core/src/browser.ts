/**
 * Browser-safe entry point for @liratek/core
 *
 * This file is used by Vite (frontend build) instead of index.ts.
 * It only exports modules that are safe to run in a browser context
 * (no Node.js-only APIs: no pino, no fs, no path, no process).
 *
 * Node.js-only modules (logger, db, crypto, etc.) are excluded.
 */

// Currency converter — pure functions, zero Node.js dependencies
export * from "./utils/currencyConverter.js";

// Shared money-string formatter (rule 14 — one formatter, not five) — pure
// string formatting, zero imports. Moved out of moneyPosting.ts (which
// transitively reaches the database via utils/payments.js ->
// PaymentMethodRepository.js -> db/connection.js) so it can be exported
// here without pulling better-sqlite3 into the renderer bundle. Must be
// exported HERE, not only from index.ts — see the telecomCredit.js note
// below for the exact failure mode this avoids.
export * from "./utils/formatMoney.js";

// Telecom Only-Days credit model (LIRA-090) — pure integer math, no Node.js deps.
// The frontend (KatchForm, MobileServicesManager) imports maxReturnableCredits,
// isTelecomSplitComplete, deriveItemEconomics, deliveredCostLbp from here. index.ts
// (the Node entry) exports it too, so jest and typecheck pass — but Vite resolves
// @liratek/core to THIS file, so the export must live here or the renderer fails to
// load with "does not provide an export named 'deliveredCostLbp'".
export * from "./utils/telecomCredit.js";

// Generic calendar-date arithmetic (`addDaysToDateString`/
// `daysBetweenDateStrings`) — pure `YYYY-MM-DD` string math, no Node.js deps.
// Split out of carrierLineValidity.js (below) so a caller with no carrier-line
// involvement doesn't have to import a carrier-line module to add a day to a
// date string; carrierLineValidity.ts itself now imports from here rather
// than defining these. Must be exported HERE, not only from index.ts — see
// the telecomCredit.js note above for the exact failure mode this avoids.
export * from "./utils/calendarDate.js";

// Carrier-line validity rule (LIRA-157) — pure calendar-date arithmetic over
// `YYYY-MM-DD` strings plus `localDay()`, no Node.js deps. KatchForm imports
// `projectValidityExpiry`/`MAX_LINE_VALIDITY_DAYS` to warn before a self-charge
// that the rule would clip or refuse, and CarrierLinesPanel imports
// `classifyLineValidity` for the "burned" badge — the SAME rule the repository
// enforces on write, never a second copy of the comparison (rule 14). Must be
// exported HERE, not only from index.ts — see the telecomCredit note above for
// the exact failure mode this avoids.
export * from "./utils/carrierLineValidity.js";
// Subscription policy constants (v173). Pure data, so it belongs in BOTH
// entry points: the frontend hides non-entitled modules and must apply the
// same ungateable rule the backend enforces, rather than keeping a copy.
export * from "./constants/subscription.js";

// Validators — zod schemas, no Node.js deps
export * from "./validators/index.js";

// v196 — the password complexity rule (pure, zero imports; crypto.ts only
// re-exports it), so a form can show the same requirements the schema and
// the services enforce. And the machine-readable error codes the new account
// endpoints return, so pages compare codes, never message text. errors.ts
// has no imports, but only the CODE constants are exported here.
export * from "./utils/passwordPolicy.js";
// LIRA-291: the one wording for a user's sign-in methods (pure).
export * from "./utils/signinMethods.js";
export {
  EMAIL_ALREADY_HAS_SHOP,
  EMAIL_ALREADY_HAS_SHOP_MESSAGE,
  EMAIL_NOT_CONFIGURED,
  EMAIL_TAKEN_IN_SHOP,
  GOOGLE_ACCOUNT_IN_OTHER_SHOP,
  GOOGLE_ACCOUNT_IN_OTHER_SHOP_MESSAGE,
  IDENTITY_ALREADY_LINKED,
  SET_PASSWORD_FIRST,
  SET_PASSWORD_FIRST_MESSAGE,
} from "./utils/errors.js";

// Lebanese phone-number normalization (CARRIER_LINES_VALIDITY_PLAN.md Phase 6)
// — pure string manipulation, no Node.js deps. index.ts (the Node entry)
// exports it too, but Vite/Jest resolve @liratek/core to THIS file (see the
// telecomCredit.js note above for the exact same failure mode) — the
// frontend's Recharge/index.tsx imports isSameLebanesePhone to detect
// whether a typed phone number is the shop's own carrier line.
export * from "./utils/phoneNumber.js";

// Primary cash drawer names (OMT_System/Whish_System) — pure `as const`
// tuple + one pure function, no Node.js deps. DrawerTopUpModal.tsx (the
// General <-> PCD transfer routing decision) imports PRIMARY_CASH_DRAWER_NAMES
// from here instead of hand-maintaining a mirror copy (CLAUDE.md rule 14 —
// systemFloatDrawers.ts's own doc comment calls it the single definition).
export * from "./constants/systemFloatDrawers.js";

// Which module owns which drawer, and which drawers no module may hide
// (rule 14: this was four divergent copies, two of them gating whether
// physical till cash got counted). Pure data + predicates, no Node deps, and
// the frontend is the main consumer -- so it belongs in BOTH entry points.
export * from "./constants/drawerModules.js";

// The checkpoint-adjustment payments.method code — pure string constant, no
// Node.js deps. The Transactions audit page (transactionDisplay.ts) imports
// CHECKPOINT_ADJUSTMENT_METHOD from here to label a checkpoint leg's drawer
// (rule 14) instead of retyping the literal ClosingRepository posts it with.
export * from "./constants/checkpointAdjustment.js";

// Drawer currency policy (UNRESTRICTED_DRAWERS / isUnrestrictedDrawer) — pure
// `as const` tuple + one pure predicate, no Node.js deps. Settings →
// CurrencyManager imports `isUnrestrictedDrawer` to omit the General drawer
// from the configurable grid, rather than hardcoding the name a second time
// (rule 14). Must be exported HERE, not only from index.ts: Vite/Jest resolve
// @liratek/core to this file, so a renderer import of a symbol missing here
// fails at load with "does not provide an export named ...".
export * from "./constants/drawerCurrencyPolicy.js";

// Exchange lot policy (isLotTrackedCurrency) — pure predicate over a currency
// code, no Node.js deps. DrawerTopUpModal.tsx imports `isLotTrackedCurrency`
// to decide whether the "Acquisition rate" field applies to a foreign-
// currency top-up row (EXCHANGE_LOT_SETTLEMENT.md Q3), instead of
// hand-maintaining a second USD/LBP exemption list (rule 14). Must be
// exported HERE, not only from index.ts — see the drawerCurrencyPolicy note
// above for the exact failure mode this avoids.
export * from "./constants/exchangeLotPolicy.js";

// Market-rate orientation normalization (marketRateToUsdPerUnit) — pure
// arithmetic over `exchange_rates.market_rate`/`is_stronger`, no Node.js
// deps. DrawerTopUpModal.tsx (2026-08-23 refinement, EXCHANGE_LOT_SETTLEMENT.md
// Q3) imports it to render the same "Cost basis: market rate ..." figure the
// server will independently compute — rule 14, the ONE orientation-math
// function, never a second hand-rolled copy in the renderer. Must be
// exported HERE, not only from index.ts — see the drawerCurrencyPolicy note
// above for the exact failure mode this avoids.
export * from "./utils/lotMarketRate.js";

// Custom-service fulfilment status model (LIRA-155) — pure string-literal
// list + type + transition predicate, no Node.js deps. The insurance
// fulfilment UI (a follow-up frontend change) and CustomServiceService both
// import FULFILLMENT_STATUSES/isValidFulfillmentTransition from here rather
// than re-spelling the four status strings a second time (rule 14). Must be
// exported HERE, not only from index.ts — see the telecomCredit.js note
// above for the exact failure mode this avoids.
export * from "./utils/insuranceFulfillment.js";
export * from "./utils/customServiceWorkStatus.js";

// Profits password gate constants (PROFITS_PASSWORD_SETTING_KEY,
// PROFITS_UNLOCK_TTL_MS, PROFITS_PASSWORD_MIN_LENGTH) — pure string/number
// constants, no Node.js deps. ProfitsPasswordGate.tsx imports
// PROFITS_UNLOCK_TTL_MS to drive its client-side unlock timer instead of
// hardcoding 15 minutes a second time (rule 14). Must be exported HERE, not
// only from index.ts — see the telecomCredit.js note above for the exact
// failure mode this avoids.
export * from "./constants/profitsAccess.js";

// Database Reset (LIRA-165) — constants + types only: the confirmation
// phrase, the six table-bucket arrays, and the DatabaseResetPreview/Result
// shapes are pure data/types, no Node.js deps. The Settings › Reset Data
// modal (a frontend follow-up phase) imports
// DATABASE_RESET_CONFIRMATION_PHRASE directly to validate what the operator
// typed BEFORE calling the IPC/REST endpoint, instead of hardcoding the
// phrase a second time (rule 14) — that duplicate would drift the moment
// this file's phrase changed. `DatabaseResetRepository`/`DatabaseResetService`
// are deliberately NOT exported here: they touch the database and must stay
// out of the Vite/browser bundle. Must be exported HERE, not only from
// index.ts — see the telecomCredit.js note above for the exact failure mode
// this avoids.
export * from "./constants/resetTables.js";

// OMT App wallet cashout commission (LIRA-192, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md
// §8) — pure arithmetic over an amount/currency pair, no Node.js deps.
// OmtAppCashoutModal.tsx imports `omtAppCashoutCommission` to render the
// SAME commission preview the repository will independently stamp, rather
// than hand-rolling a second `× 0.001` in the renderer (rule 14). Must be
// exported HERE, not only from index.ts — see the telecomCredit.js note
// above for the exact failure mode this avoids.
export * from "./constants/omtAppCashout.js";

// OMT / WHISH fee tables and commission rates (LIRA-185 display lead 11) —
// pure data + arithmetic, no Node.js deps (rule 29: both files are leaves).
// The Services page imports OMT_COMMISSION_RATES, the INTRA / Western Union /
// Whish fee tiers and lookupOmtFee/lookupIntraLbpFee from here instead of
// carrying its own "must match omtFees.ts" copies (rule 14) — a copy would
// let the form's preview promise a different commission than the one the
// repository books. Must be exported HERE, not only from index.ts — see the
// telecomCredit.js note above for the exact failure mode this avoids.
export * from "./utils/omtFees.js";
export * from "./utils/whishFees.js";

// By Module row classification (PA-4.23 a, OWNER_NOTES_2026-09-21.md §6.9) —
// pure string classification, no Node.js deps. Profits.tsx imports
// `classifyProfitModuleRow` to decide whether a By Module row's expanded
// detail renders the Revenue − Cost = Profit equation, a bare "Commission:
// <amount>" or a bare "Profit: <amount>" line, instead of hand-rolling a
// second per-row if/switch in the renderer (rule 14). Must be exported HERE,
// not only from index.ts — see the telecomCredit.js note above for the exact
// failure mode this avoids.
export * from "./constants/profitRowClass.js";

// LIRA-233 (#14 slice 3 review round, finding 10) — the shared "which By
// Module keys have a getModuleDetail drill-down" list. Pure string/Set data,
// no Node.js deps. Profits.tsx imports `hasModuleDetailSupport` to gate its
// "Show transactions" button instead of hand-maintaining a second copy of
// the registry's own key list (rule 14). Must be exported HERE, not only
// from index.ts — see the telecomCredit.js note above for the exact failure
// mode this avoids.
export * from "./constants/profitModuleDetailSupport.js";

// Refund-leg amount tolerance (rule 14 fix, 2026-09-26) — the ONE definition
// of the per-currency matching tolerance shared by
// `TransactionRepository.validateRefundLegOverrideAmounts` (server) and
// `frontend/src/features/audit/refundLegOverride.ts` (client-side hint).
// Pure data, no Node.js deps. Must be exported HERE, not only from
// index.ts — see the telecomCredit.js note above for the exact failure mode
// this avoids.
export * from "./constants/refundTolerance.js";

// LIRA-232 round-3 finding #2 follow-up — `isSessionPayoutMember`, the ONE
// predicate for "is this session-basket member a netted payout", shared by
// TransactionRepository's server-side refusal and the frontend's own
// session-group derivation (useTransactionRows.ts). Pure data, no Node.js
// deps — see this module's own doc for the bug this closes.
export * from "./constants/sessionPayoutMember.js";
// LIRA-271 — the ONE session-basket fee-on-top RECEIVE rule, shared by the
// checkout modal and SessionCheckoutService (pure leaf, rule 29).
export * from "./utils/sessionFeeOnTop.js";
// A For-Partner basket item costs the walk-in customer nothing — the ONE
// rule shared by the checkout modal and SessionCheckoutService (pure leaf).
export * from "./utils/sessionForPartnerItem.js";

// Tender exchange-rate sanity band (LIRA-240, owner decision 2026-09-28) —
// pure constant + pure arithmetic, no Node.js deps. `@liratek/ui`'s
// MultiPaymentInput imports `TENDER_RATE_BAND_PCT`/`tenderRateDeviationPct`
// to render a non-blocking "rate looks off" warning using the SAME
// threshold/formula `repositories/moneyPosting.ts` used to (and still could)
// reference server-side, instead of hand-rolling a second copy in the
// renderer (rule 14). Must be exported HERE, not only from index.ts — see
// the telecomCredit.js note above for the exact failure mode this avoids.
export * from "./constants/tenderRateBand.js";

// Type exports used in electron.d.ts (type-only, no runtime impact)
export type { ProductEntity as Product } from "./repositories/ProductRepository.js";
export type { ClientEntity as Client } from "./repositories/ClientRepository.js";
export type { SaleRequest } from "./repositories/SalesRepository.js";
// LIRA-185 — the Loto page report shape (incl. kept change), derived by the
// adapter/IPC types instead of hand-copied (rule 21).
export type { LotoReportData } from "./repositories/LotoRepository.js";

// LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — session-basket
// single-item refund payload/result/preview shapes, plus the two smaller
// types they're built from. Type-only, so importing them from
// TransactionRepository.js (which is NOT otherwise browser-safe) has zero
// runtime impact — same reasoning as every other type-only export in this
// file. Must be exported HERE too, not only from index.ts (where
// `export * from "./repositories/index.js"` already covers them): Vite/Jest
// resolve @liratek/core to THIS file, so a renderer import of any of these
// missing here fails at load (same failure mode as the telecomCredit.js
// note earlier in this file).
export type {
  RefundLegOverride,
  TransactionPaymentLeg,
  RefundSessionBasketItemInput,
  RefundSessionBasketItemResult,
  SessionItemRefundPreview,
} from "./repositories/TransactionRepository.js";

// "Signed-in devices" panel shape (SESSION_RESILIENCE_AND_DEVICES_PLAN.md
// Part 2) — the frontend Settings page types its device list against this.
// Type-only, so importing it from SessionRepository.js (which itself uses
// Node's `crypto` and is NOT otherwise browser-safe) has zero runtime impact:
// `export type` is erased at compile time, no import of the module lands in
// the bundle. Must be exported HERE too, not only from index.ts — Vite
// resolves @liratek/core to THIS file, so a renderer import of SafeSession
// missing here fails at load (same failure mode as the telecomCredit.js note
// above).
export type { SafeSession } from "./repositories/SessionRepository.js";

// LIRA-252 wave 2 — the manual carrier-line (MTC/Alfa) drawer-adjustment
// read shape (`ClosingRepository.getCarrierLineAdjustments`), derived by the
// frontend adapter instead of hand-copied (rule 21). Type-only, so pulling it
// from ClosingRepository.js (which is NOT otherwise browser-safe) has zero
// runtime impact — same reasoning as every other type-only export in this
// file. Must be exported HERE too, not only from index.ts (where
// `export * from "./repositories/index.js"` already covers it): Vite/Jest
// resolve @liratek/core to THIS file, so a renderer import missing here
// fails at load (same failure mode as the telecomCredit.js note earlier).
export type {
  CarrierLineAdjustmentRecord,
  CarrierLineAdjustmentFilters,
} from "./repositories/ClosingRepository.js";

// Commissions Report shape (Profits page "Commissions" tab —
// OWNER_NOTES_2026-09-21.md §6, lane LC). Type-only, so importing it from
// CommissionsReportService.js (which imports ProfitRepository/
// FinancialServiceRepository and is NOT otherwise browser-safe) has zero
// runtime impact — same reasoning as the SafeSession export above. Must be
// exported HERE too, not only from index.ts: Vite/Jest resolve
// @liratek/core to THIS file, so a renderer import of CommissionsReport
// missing here fails at load (same failure mode as the telecomCredit.js
// note earlier in this file).
export type {
  CommissionsReport,
  CommissionProviderRow,
  CommissionReportProvider,
  ExcludedCommissionProvider,
} from "./services/CommissionsReportService.js";

// Closing report's daily-stats-snapshot shape (LIRA-219, closing profit =
// Profits page profit for the day). Type-only, so importing it from
// ClosingService.js (which imports ProfitService.js → ProfitRepository.js
// and is NOT otherwise browser-safe) has zero runtime impact — same
// reasoning as the CommissionsReport export above. Must be exported HERE
// too, not only from index.ts: Vite/Jest resolve @liratek/core to THIS
// file, so a renderer import of DailyStatsSnapshot missing here fails at
// load (same failure mode as the telecomCredit.js note earlier in this
// file).
export type { DailyStatsSnapshot } from "./services/ClosingService.js";

// Dashboard "Net Profit — last 30 days" tile shape (DC-11,
// OWNER_NOTES_2026-09-21.md §7.2; CHART-m5 verifier finding — this used to
// be hand-typed four separate times, one per consuming file). Type-only, so
// importing it from SalesService.js (which imports SalesRepository.js and
// is NOT otherwise browser-safe) has zero runtime impact — same reasoning
// as the DailyStatsSnapshot export above. Must be exported HERE too, not
// only from index.ts: Vite/Jest resolve @liratek/core to THIS file, so a
// renderer import of NetProfitWindowResult missing here fails at load (same
// failure mode as the telecomCredit.js note earlier in this file).
export type { NetProfitWindowResult } from "./services/SalesService.js";

// PFU-types-1 (verifier round-1 fix) — Profits page summary/by-module
// shapes. Type-only, so importing them from ProfitService.js (which imports
// ProfitRepository.js and is NOT otherwise browser-safe) has zero runtime
// impact — same reasoning as the CommissionsReport export above. Must be
// exported HERE too, not only from index.ts: Vite/Jest resolve
// @liratek/core to THIS file, so a renderer import of ProfitSummary/
// ProfitByModule missing here fails at load (same failure mode as the
// telecomCredit.js note earlier in this file).
export type {
  ProfitSummary,
  ProfitByModule,
} from "./services/ProfitService.js";

// PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the
// Profits page's "Show transactions" drill-down payload. Same type-only
// reasoning as ProfitSummary/ProfitByModule immediately above — must be
// exported HERE too, or a renderer import of ProfitModuleDetail/
// ProfitModuleDetailRow fails at load (Vite/Jest resolve @liratek/core to
// THIS file).
export type {
  ProfitModuleDetail,
  ProfitModuleDetailRow,
} from "./services/ProfitService.js";

// LIRA-232 phase 3 (SESSION_ITEM_REFUND_PLAN.md §4) — session-basket
// item-refund eligibility. Pure data (a Set literal built from
// TRANSACTION_TYPES), no Node.js deps. The Transactions page imports
// SESSION_ITEM_REFUNDABLE_TYPES to decide which session-member rows get a
// per-item "Refund" action, instead of hand-copying the type list a second
// time (rule 14) — that copy would silently drift the moment this file's set
// changed. Must be exported HERE, not only from index.ts — see the
// telecomCredit.js note earlier in this file for the exact failure mode this
// avoids.
export * from "./constants/transactionTypes.js";

// LIRA-185 #1 — the MTC/Alfa discount cap (pure, no Node deps). The page's
// payment-sheet `maxDiscount` and RechargeRepository's server-side cap share
// this one definition (rule 14). Must be exported HERE too (rule 29 /
// telecomCredit.js note).
export * from "./utils/rechargeDiscount.js";
export * from "./utils/walletReceivePayout.js";

// LIRA-267 — the admin invite list's row shape and the invite-check answer.
// Type-only (erased at compile time), so the Node-only service module lands
// nothing in the bundle — same reasoning as the ProfitService exports above.
// Must be exported HERE: Vite/Jest resolve @liratek/core to this file.
export type {
  SignupInvitationView,
  SignupInviteEmailStatus,
  SignupInviteCheckResult,
} from "./services/SignupInvitationService.js";

// =============================================================================
// Account features (SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md "Contracts"): one
// anchor per feature, blank-line separated so parallel branches merge
// cleanly. Add exports directly under YOUR anchor only.
// =============================================================================

// [auth-A] exports

// [auth-B] exports
// Refusal codes for Settings -> Users (pure leaf module), and the views the
// pages render — TYPE-only from the Node services, so nothing reaches the
// bundle (rule 29).
export * from "./constants/userAccountCodes.js";
export type {
  UserInvitationView,
  UserInviteCheckResult,
} from "./services/UserInvitationService.js";
export type {
  UserEmailView,
  SetUserEmailResult,
  OwnEmailView,
} from "./services/UserEmailService.js";

// [auth-C] exports
// Forgot / reset password codes + fixed messages (pure leaf module).
export * from "./constants/passwordReset.js";
export type {
  PasswordResetCheckResult,
  SetInitialPasswordResult,
} from "./services/PasswordResetService.js";

// LIRA-287: www "email me a code" sign-in — messages, limits and the
// "your shops" shape (pure leaf module). The schemas arrive through the
// validators barrel above.
export * from "./constants/signinCode.js";

// [auth-D] exports
// Continue with Google (LIRA-280): schemas, codes and input types only. The
// GoogleAuthService itself is Node-only and stays out of this entry.
export * from "./validators/googleAuth.js";
// The shop-address rule, so the Google sign-up form checks the slug with the
// server's own predicate (rule 14). Pure (errors.js only).
export { validateTenantSlug } from "./utils/tenantSlug.js";
