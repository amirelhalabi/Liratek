// Database
export * from './db/dbPath.js';
export * from './db/connection.js';

// Utilities
export * from './utils/crypto.js';
export * from './utils/logger.js';
export * from './utils/errors.js';
export * from './utils/barcode.js';

// Repositories
export * from './repositories/index.js';

// Type aliases for backwards compatibility
export type {
  ProductEntity as Product,
  ClientEntity as Client,
  SaleRequest,
  SaleItemEntity as SaleItem,
} from './repositories/index.js';


// Services
export * from './services/index.js';
