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
export * from "./utils/currencyConverter.js";

// Repositories
export * from "./repositories/index.js";

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
