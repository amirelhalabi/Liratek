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
import pino from "pino";
import path from "path";
import fs from "fs";
// =============================================================================
// Configuration
// =============================================================================
const isDev = process.env.NODE_ENV !== "production";
const LOG_LEVEL = process.env.LOG_LEVEL || (isDev ? "debug" : "info");
// Log directory (in userData for production, console for dev)
const getLogPath = () => {
    if (isDev)
        return undefined; // Use console in dev
    try {
        const logsRoot = process.env.LOG_DIR || process.cwd();
        const logsDir = path.join(logsRoot, "logs");
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        return path.join(logsDir, `app-${new Date().toISOString().split("T")[0]}.log`);
    }
    catch {
        return undefined;
    }
};
// =============================================================================
// Logger Instance
// =============================================================================
const createLogger = () => {
    const logPath = getLogPath();
    const options = {
        level: LOG_LEVEL,
        base: {
            pid: process.pid,
            app: "liratek",
        },
        timestamp: pino.stdTimeFunctions.isoTime,
    };
    // Development: pretty print to console
    if (isDev) {
        return pino({
            ...options,
            transport: {
                target: "pino-pretty",
                options: {
                    colorize: true,
                    translateTime: "HH:MM:ss",
                    ignore: "pid,hostname,app",
                },
            },
        });
    }
    // Production: JSON to file and console
    if (logPath) {
        const streams = [
            { stream: fs.createWriteStream(logPath, { flags: "a" }) },
            { stream: process.stdout },
        ];
        return pino(options, pino.multistream(streams));
    }
    return pino(options);
};
// Main logger instance
const logger = createLogger();
// =============================================================================
// Child Loggers (Context-Aware)
// =============================================================================
/**
 * Create a child logger with additional context
 */
export const createChildLogger = (context) => {
    return logger.child(context);
};
// Pre-configured child loggers for each module
export const authLogger = logger.child({ module: "auth" });
export const dbLogger = logger.child({ module: "database" });
export const ipcLogger = logger.child({ module: "ipc" });
export const salesLogger = logger.child({ module: "sales" });
export const inventoryLogger = logger.child({ module: "inventory" });
export const clientLogger = logger.child({ module: "client" });
export const debtLogger = logger.child({ module: "debt" });
export const exchangeLogger = logger.child({ module: "exchange" });
export const financialLogger = logger.child({ module: "financial" });
export const maintenanceLogger = logger.child({ module: "maintenance" });
export const rechargeLogger = logger.child({ module: "recharge" });
export const settingsLogger = logger.child({ module: "settings" });
export const expenseLogger = logger.child({ module: "expense" });
export const closingLogger = logger.child({ module: "closing" });
export const syncLogger = logger.child({ module: "sync" });
// =============================================================================
// Performance Timing Utility
// =============================================================================
/**
 * Measure execution time of an async operation
 */
export const measureTime = async (operation, fn, log = logger) => {
    const start = performance.now();
    try {
        const result = await fn();
        const duration = Math.round(performance.now() - start);
        log.debug({ operation, duration_ms: duration }, `${operation} completed`);
        return result;
    }
    catch (error) {
        const duration = Math.round(performance.now() - start);
        log.error({ operation, duration_ms: duration, error }, `${operation} failed`);
        throw error;
    }
};
/**
 * Measure execution time of a sync operation
 */
export const measureTimeSync = (operation, fn, log = logger) => {
    const start = performance.now();
    try {
        const result = fn();
        const duration = Math.round(performance.now() - start);
        log.debug({ operation, duration_ms: duration }, `${operation} completed`);
        return result;
    }
    catch (error) {
        const duration = Math.round(performance.now() - start);
        log.error({ operation, duration_ms: duration, error }, `${operation} failed`);
        throw error;
    }
};
// =============================================================================
// Request Context Logger
// =============================================================================
/**
 * Create a logger for an IPC request with correlation ID
 */
export const createRequestLogger = (channel, correlationId) => {
    return logger.child({
        module: "ipc",
        channel,
        correlationId: correlationId ||
            `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
};
// =============================================================================
// Log Helpers
// =============================================================================
/**
 * Log user action for audit purposes
 */
export const logUserAction = (userId, action, details) => {
    logger.info({
        module: "audit",
        userId,
        action,
        ...details,
    }, `User action: ${action}`);
};
/**
 * Log database query for debugging
 */
export const logQuery = (query, params, duration) => {
    dbLogger.debug({
        query: query.substring(0, 200),
        paramCount: params?.length || 0,
        duration_ms: duration,
    }, "Database query");
};
/**
 * Log application startup
 */
export const logStartup = (version) => {
    logger.info({
        version,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
    }, "Application starting");
};
/**
 * Log application shutdown
 */
export const logShutdown = (reason) => {
    logger.info({ reason }, "Application shutting down");
};
// =============================================================================
// Export
// =============================================================================
export default logger;
export { logger };
