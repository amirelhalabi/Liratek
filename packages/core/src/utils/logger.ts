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

import pino, { Logger, DestinationStream } from "pino";
import path from "path";
import fs from "fs";
import env, { isDevelopment, isTest, isProduction } from "../config/env.js";

// =============================================================================
// Configuration
// =============================================================================

const isDev = isDevelopment;
const LOG_LEVEL = env.LOG_LEVEL;

// Validate production environment on startup (lazy evaluation)
if (isProduction && !isTest) {
  // Validation happens synchronously during import
  import("../config/env.js").then(({ validateProductionEnv }) => {
    try {
      validateProductionEnv();
    } catch (error) {
      process.stderr.write(`Environment validation failed: ${error}\n`);
      process.exit(1);
    }
  });
}

// Log directory (in userData for production, console for dev)
const getLogPath = (): string | undefined => {
  if (isDev) return undefined; // Use console in dev
  try {
    const logsRoot = env.LOG_DIR || process.cwd();
    const logsDir = path.join(logsRoot, "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    return path.join(
      logsDir,
      `app-${new Date().toISOString().split("T")[0]}.log`,
    );
  } catch {
    return undefined;
  }
};

// =============================================================================
// Logger Instance
// =============================================================================

/**
 * Build a synchronous pino-pretty destination stream.
 * Uses require() to avoid worker threads which crash in Electron.
 * Returns undefined if pino-pretty is not available.
 */
const buildPrettyStream = (): DestinationStream | undefined => {
  try {
    // Synchronous pino-pretty stream — avoids worker threads which crash in
    // Electron where pino-pretty's thread-stream exits prematurely.
    //
    // We need to resolve pino-pretty without `import.meta.url` (breaks Jest/CJS)
    // and without bare `require` (breaks ESM). Using globalThis check:
    const resolvePinoPretty = (): unknown => {
      // CJS context (Jest): require is available
      if (typeof globalThis.require === "function") {
        return globalThis.require("pino-pretty");
      }
      // ESM context (Electron): use createRequire
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("node:module");
      const cr = (
        mod as { createRequire: (url: string) => NodeRequire }
      ).createRequire(
        typeof __filename !== "undefined" ? __filename : process.cwd() + "/x",
      );
      return cr("pino-pretty");
    };
    const pp = resolvePinoPretty() as {
      build: (opts: Record<string, unknown>) => DestinationStream;
    };
    return pp.build({
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname,app",
      sync: true,
    });
  } catch {
    return undefined;
  }
};

const createLogger = (): Logger => {
  const logPath = getLogPath();

  const options: pino.LoggerOptions = {
    level: LOG_LEVEL,
    base: {
      pid: process.pid,
      app: "liratek",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Tests: never use transports (optional deps may be missing)
  if (isTest) {
    return pino(options);
  }

  // Development: pretty print to console (synchronous — avoids worker thread
  // crashes in Electron where pino-pretty's thread-stream can exit prematurely)
  if (isDev) {
    const prettyStream = buildPrettyStream();
    if (prettyStream) {
      return pino(options, prettyStream);
    }
    return pino(options);
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
export const createChildLogger = (context: Record<string, unknown>): Logger => {
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
// binanceLogger removed — Binance now uses financialLogger via financial_services provider
export const financialLogger = logger.child({ module: "financial" });
export const maintenanceLogger = logger.child({ module: "maintenance" });
export const rechargeLogger = logger.child({ module: "recharge" });
export const customServiceLogger = logger.child({ module: "custom-service" });
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
export const measureTime = async <T>(
  operation: string,
  fn: () => Promise<T>,
  log: Logger = logger,
): Promise<T> => {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    log.debug({ operation, duration_ms: duration }, `${operation} completed`);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    log.error(
      { operation, duration_ms: duration, error },
      `${operation} failed`,
    );
    throw error;
  }
};

/**
 * Measure execution time of a sync operation
 */
export const measureTimeSync = <T>(
  operation: string,
  fn: () => T,
  log: Logger = logger,
): T => {
  const start = performance.now();
  try {
    const result = fn();
    const duration = Math.round(performance.now() - start);
    log.debug({ operation, duration_ms: duration }, `${operation} completed`);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    log.error(
      { operation, duration_ms: duration, error },
      `${operation} failed`,
    );
    throw error;
  }
};

// =============================================================================
// Request Context Logger
// =============================================================================

/**
 * Create a logger for an IPC request with correlation ID
 */
export const createRequestLogger = (
  channel: string,
  correlationId?: string,
): Logger => {
  return logger.child({
    module: "ipc",
    channel,
    correlationId:
      correlationId ||
      `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  });
};

// =============================================================================
// Log Helpers
// =============================================================================

/**
 * Log user action for audit purposes
 */
export const logUserAction = (
  userId: number | null,
  action: string,
  details?: Record<string, unknown>,
): void => {
  logger.info(
    {
      module: "audit",
      userId,
      action,
      ...details,
    },
    `User action: ${action}`,
  );
};

/**
 * Log database query for debugging
 */
export const logQuery = (
  query: string,
  params?: unknown[],
  duration?: number,
): void => {
  dbLogger.debug(
    {
      query: query.substring(0, 200),
      paramCount: params?.length || 0,
      duration_ms: duration,
    },
    "Database query",
  );
};

/**
 * Log application startup
 */
export const logStartup = (version: string): void => {
  logger.info(
    {
      version,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    "Application starting",
  );
};

/**
 * Log application shutdown
 */
export const logShutdown = (reason?: string): void => {
  logger.info({ reason }, "Application shutting down");
};

// =============================================================================
// Export
// =============================================================================

export default logger;
export { logger };
export const voiceBotLogger = logger.child({ module: "voicebot" });
