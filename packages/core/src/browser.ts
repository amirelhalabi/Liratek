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

// Constants — pure data, no Node.js deps
export * from "./constants/index.js";

// Validators — zod schemas, no Node.js deps
export * from "./validators/index.js";

// Type exports used in electron.d.ts (type-only, no runtime impact)
export type { ProductEntity as Product } from "./repositories/ProductRepository.js";
export type { ClientEntity as Client } from "./repositories/ClientRepository.js";
export type { SaleRequest } from "./repositories/SalesRepository.js";
