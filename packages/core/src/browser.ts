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

// Telecom Only-Days credit model (LIRA-090) — pure integer math, no Node.js deps.
// The frontend (KatchForm, MobileServicesManager) imports maxReturnableCredits,
// isTelecomSplitComplete, deriveItemEconomics, deliveredCostLbp from here. index.ts
// (the Node entry) exports it too, so jest and typecheck pass — but Vite resolves
// @liratek/core to THIS file, so the export must live here or the renderer fails to
// load with "does not provide an export named 'deliveredCostLbp'".
export * from "./utils/telecomCredit.js";

// Carrier-line validity rule (LIRA-157) — pure calendar-date arithmetic over
// `YYYY-MM-DD` strings plus `localDay()`, no Node.js deps. KatchForm imports
// `projectValidityExpiry`/`MAX_LINE_VALIDITY_DAYS` to warn before a self-charge
// that the rule would clip or refuse, and CarrierLinesPanel imports
// `classifyLineValidity` for the "burned" badge — the SAME rule the repository
// enforces on write, never a second copy of the comparison (rule 14). Must be
// exported HERE, not only from index.ts — see the telecomCredit note above for
// the exact failure mode this avoids.
export * from "./utils/carrierLineValidity.js";

// Validators — zod schemas, no Node.js deps
export * from "./validators/index.js";

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

// Type exports used in electron.d.ts (type-only, no runtime impact)
export type { ProductEntity as Product } from "./repositories/ProductRepository.js";
export type { ClientEntity as Client } from "./repositories/ClientRepository.js";
export type { SaleRequest } from "./repositories/SalesRepository.js";
