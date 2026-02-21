/**
 * Environment Configuration
 *
 * Centralized environment variable management with Zod validation and defaults.
 * All environment variable access should go through this module.
 */

import { z } from "zod";

// =============================================================================
// Environment Variables Schema (with Zod)
// =============================================================================

const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // Logging
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    LOG_DIR: z.string().optional(),

    // Database
    DATABASE_PATH: z.string().optional(),
    DATABASE_KEY: z.string().optional(),

    // Backend-specific (only needed when running backend)
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
    JWT_SECRET: z.string().min(32).optional(),
    JWT_EXPIRES_IN: z.string().default("7d"),

    // Electron-specific (only needed when running electron app)
    ELECTRON_RENDERER_URL: z.string().url().optional(),
  })
  .transform((data) => {
    // Auto-adjust log level based on environment if not explicitly set
    if (!process.env.LOG_LEVEL) {
      if (data.NODE_ENV === "development") {
        data.LOG_LEVEL = "debug";
      } else if (data.NODE_ENV === "test") {
        data.LOG_LEVEL = "warn";
      }
    }
    return data;
  });

export type EnvConfig = z.infer<typeof envSchema>;

// =============================================================================
// Parse and Validate Environment
// =============================================================================

/**
 * Parse and validate environment variables
 * @throws {ZodError} if validation fails
 */
function parseEnv(): EnvConfig {
  const result = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_DIR: process.env.LOG_DIR?.trim(),
    DATABASE_PATH: process.env.DATABASE_PATH?.trim(),
    DATABASE_KEY: process.env.DATABASE_KEY?.trim(),
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL,
  });

  if (!result.success) {
    // Use stderr directly since logger isn't initialized yet
    process.stderr.write("❌ Environment variable validation failed:\n");
    process.stderr.write(JSON.stringify(result.error.format(), null, 2) + "\n");
    throw new Error("Invalid environment configuration");
  }

  return result.data;
}

// =============================================================================
// Exported Config
// =============================================================================

const env = parseEnv();

export default env;

// =============================================================================
// Convenience Exports
// =============================================================================

export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

// Re-export for easy access
export const {
  NODE_ENV,
  LOG_LEVEL,
  LOG_DIR,
  DATABASE_PATH,
  DATABASE_KEY,
  PORT,
  HOST,
  CORS_ORIGIN,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ELECTRON_RENDERER_URL,
} = env;

/**
 * Validate that required environment variables are set for production
 */
export function validateProductionEnv(): void {
  if (!isProduction) return;

  const requiredVars = {
    JWT_SECRET: env.JWT_SECRET,
    DATABASE_KEY: env.DATABASE_KEY,
  };

  const missing = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for production: ${missing.join(", ")}`,
    );
  }

  // Warn if using default values in production
  if (env.CORS_ORIGIN === "http://localhost:5173") {
    process.stderr.write(
      "⚠️  WARNING: Using default CORS_ORIGIN in production\n",
    );
  }
}
