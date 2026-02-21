// Database
export * from "./db/dbPath.js";
export * from "./db/dbKey.js";
export * from "./db/sqlcipher.js";
export * from "./db/connection.js";
// Migration system (runner infrastructure; migrations added post-production)
export * from "./db/migrations/index.js";

// Constants
export * from "./constants/index.js";

// Utilities
export * from "./utils/crypto.js";
export * from "./utils/logger.js";
export * from "./utils/errors.js";
export * from "./utils/barcode.js";
export * from "./utils/payments.js";
export * from "./utils/currency.js";

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
