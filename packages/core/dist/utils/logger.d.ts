/**
 * Structured Logging with Pino
 *
 * Centralized logging for the Electron main process.
 * Uses Pino for high-performance structured logging.
 *
 * Features:
 * - Structured JSON logs in production
 * - Pretty-printed logs in development
 * - Context-aware child loggers
 * - Performance timing utilities
 */
import pino, { Logger } from "pino";
declare const logger: pino.Logger;
/**
 * Create a child logger with additional context
 */
export declare const createChildLogger: (context: Record<string, unknown>) => Logger;
export declare const authLogger: pino.Logger<never, boolean>;
export declare const dbLogger: pino.Logger<never, boolean>;
export declare const ipcLogger: pino.Logger<never, boolean>;
export declare const salesLogger: pino.Logger<never, boolean>;
export declare const inventoryLogger: pino.Logger<never, boolean>;
export declare const clientLogger: pino.Logger<never, boolean>;
export declare const debtLogger: pino.Logger<never, boolean>;
export declare const exchangeLogger: pino.Logger<never, boolean>;
export declare const financialLogger: pino.Logger<never, boolean>;
export declare const maintenanceLogger: pino.Logger<never, boolean>;
export declare const rechargeLogger: pino.Logger<never, boolean>;
export declare const settingsLogger: pino.Logger<never, boolean>;
export declare const expenseLogger: pino.Logger<never, boolean>;
export declare const closingLogger: pino.Logger<never, boolean>;
export declare const syncLogger: pino.Logger<never, boolean>;
/**
 * Measure execution time of an async operation
 */
export declare const measureTime: <T>(operation: string, fn: () => Promise<T>, log?: Logger) => Promise<T>;
/**
 * Measure execution time of a sync operation
 */
export declare const measureTimeSync: <T>(operation: string, fn: () => T, log?: Logger) => T;
/**
 * Create a logger for an IPC request with correlation ID
 */
export declare const createRequestLogger: (channel: string, correlationId?: string) => Logger;
/**
 * Log user action for audit purposes
 */
export declare const logUserAction: (userId: number | null, action: string, details?: Record<string, unknown>) => void;
/**
 * Log database query for debugging
 */
export declare const logQuery: (query: string, params?: unknown[], duration?: number) => void;
/**
 * Log application startup
 */
export declare const logStartup: (version: string) => void;
/**
 * Log application shutdown
 */
export declare const logShutdown: (reason?: string) => void;
export default logger;
export { logger };
