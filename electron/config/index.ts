/**
 * Configuration loader for Liratek POS
 * Loads environment-specific .env files and validates with Zod schema
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { ConfigSchema, type Config } from "./schema";
import { ConfigurationError } from "../utils/errors";

let cachedConfig: Config | null = null;

/**
 * Get the path to the config directory
 * Works both in development (project root) and production (packaged app)
 */
function getConfigPath(): string {
  // In development, use project root/config
  // In production, this would be relative to the app
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    // Development: project root
    return path.join(__dirname, "..", "..", "config");
  }

  // Production: relative to app resources
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "config");
}

/**
 * Load configuration from environment-specific .env file
 * Falls back to .env.development if specific file not found
 */
export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = process.env.NODE_ENV || "development";
  const configDir = getConfigPath();

  // Try environment-specific file first
  const envFile = path.join(configDir, `.env.${env}`);
  const fallbackFile = path.join(configDir, ".env.development");

  let loadedFrom = "";

  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
    loadedFrom = envFile;
  } else if (fs.existsSync(fallbackFile)) {
    dotenv.config({ path: fallbackFile });
    loadedFrom = fallbackFile;
  } else {
    // No config file found - use defaults from schema
    console.warn(
      `[CONFIG] No .env file found in ${configDir}, using defaults`
    );
  }

  try {
    cachedConfig = ConfigSchema.parse(process.env);

    if (loadedFrom) {
      console.log(`[CONFIG] Loaded from: ${path.basename(loadedFrom)}`);
    }
    console.log(`[CONFIG] Environment: ${cachedConfig.NODE_ENV}`);
    console.log(`[CONFIG] Log level: ${cachedConfig.LOG_LEVEL}`);

    return cachedConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigurationError(`Invalid configuration: ${error.message}`);
    }
    throw new ConfigurationError("Failed to parse configuration");
  }
}

/**
 * Get the cached configuration
 * Throws if loadConfig() hasn't been called yet
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    // Auto-load if not initialized
    return loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset cached config (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

// Environment helper functions
export const isDevelopment = (): boolean =>
  getConfig().NODE_ENV === "development";
export const isProduction = (): boolean =>
  getConfig().NODE_ENV === "production";
export const isTest = (): boolean => getConfig().NODE_ENV === "test";

// Export config schema for external use
export { ConfigSchema, type Config } from "./schema";
