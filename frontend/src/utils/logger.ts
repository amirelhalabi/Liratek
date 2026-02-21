/**
 * Frontend Logger
 *
 * Simple logging utility for frontend that works in both browser and Electron contexts.
 * In development, logs to console with pretty formatting.
 * In production, logs are more minimal to avoid exposing sensitive information.
 */

// Use process.env for Jest compatibility
const isDevelopment =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  private log(level: LogLevel, message: string, data?: LogContext): void {
    const timestamp = new Date().toISOString();
    const ctx = { ...this.context, ...data };

    if (isDevelopment) {
      // Pretty logging for development
      const styles = {
        debug: "color: #888",
        info: "color: #0066cc",
        warn: "color: #ff9900",
        error: "color: #cc0000; font-weight: bold",
      };

      // eslint-disable-next-line no-console
      console[level](
        `%c[${timestamp}] ${level.toUpperCase()}: ${message}`,
        styles[level],
        Object.keys(ctx).length > 0 ? ctx : "",
      );
    } else {
      // Minimal logging for production
      if (level === "error" || level === "warn") {
        // eslint-disable-next-line no-console
        console[level](`[${timestamp}] ${message}`, ctx);
      }
    }
  }

  debug(message: string, data?: LogContext): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: LogContext): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: LogContext): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: LogContext | unknown): void {
    // Handle both LogContext and Error objects
    const logData =
      data instanceof Error
        ? { error: data.message, stack: data.stack }
        : typeof data === "object" && data !== null
          ? (data as LogContext)
          : { data };
    this.log("error", message, logData);
  }

  child(context: LogContext): Logger {
    return new Logger({ ...this.context, ...context });
  }
}

export const logger = new Logger();

export default logger;
