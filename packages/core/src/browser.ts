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

// Validators — zod schemas, no Node.js deps
export * from "./validators/index.js";

// Lebanese phone-number normalization (CARRIER_LINES_VALIDITY_PLAN.md Phase 6)
// — pure string manipulation, no Node.js deps. index.ts (the Node entry)
// exports it too, but Vite/Jest resolve @liratek/core to THIS file (see the
// telecomCredit.js note above for the exact same failure mode) — the
// frontend's Recharge/index.tsx imports isSameLebanesePhone to detect
// whether a typed phone number is the shop's own carrier line.
export * from "./utils/phoneNumber.js";

// Type exports used in electron.d.ts (type-only, no runtime impact)
export type { ProductEntity as Product } from "./repositories/ProductRepository.js";
export type { ClientEntity as Client } from "./repositories/ClientRepository.js";
export type { SaleRequest } from "./repositories/SalesRepository.js";
