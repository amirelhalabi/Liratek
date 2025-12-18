/**
 * Configuration schema using Zod for type-safe environment variable parsing
 */
import { z } from "zod";

/**
 * Environment variable schema with defaults and coercion
 */
export const ConfigSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Logging
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug"])
    .default("info"),

  // Session
  SESSION_TIMEOUT: z.coerce
    .number()
    .min(60000) // Minimum 1 minute
    .default(1800000), // 30 minutes

  // Auto-updater
  ENABLE_AUTO_UPDATE: z
    .string()
    .transform((val) => val === "true")
    .default("true"),

  // Database
  DB_PATH: z.string().optional(),

  // Server
  VITE_PORT: z.coerce.number().default(5173),

  // Sync
  SYNC_INTERVAL: z.coerce
    .number()
    .min(10000) // Minimum 10 seconds
    .default(300000), // 5 minutes

  // Drawer limits
  DRAWER_LIMIT_GENERAL: z.coerce.number().min(0).default(50000),
  DRAWER_LIMIT_OMT: z.coerce.number().min(0).default(10000),
});

/**
 * Inferred configuration type from schema
 */
export type Config = z.infer<typeof ConfigSchema>;
