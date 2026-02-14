// Database
export * from "./db/dbPath.js";
export * from "./db/dbKey.js";
export * from "./db/sqlcipher.js";
export * from "./db/connection.js";
// Migration system
export * from "./db/migrations/index.js";
export * from "./db/migrations/drawers.js";
export * from "./db/migrations/customer-sessions.js";
export * from "./db/migrations/binance-transactions.js";
export * from "./db/migrations/ikw-providers.js";

// Utilities
export * from "./utils/crypto.js";
export * from "./utils/logger.js";
export * from "./utils/errors.js";
export * from "./utils/barcode.js";
export * from "./utils/payments.js";

// Repositories
export * from "./repositories/index.js";

// Type aliases for backwards compatibility
export type {
  ProductEntity as Product,
  ClientEntity as Client,
  SaleRequest,
  SaleItemEntity as SaleItem,
} from "./repositories/index.js";

// Services
export * from "./services/index.js";

// Validators
export * from "./validators/index.js";

// Configuration
export * from "./config/env.js";
