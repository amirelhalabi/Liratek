/**
 * Environment Configuration
 *
 * Centralized environment variable management with Zod validation and defaults.
 * All environment variable access should go through this module.
 */

import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from root directory
// Use process.cwd() for better Jest and Node.js compatibility
import path from "path";

const envPath = path.join(process.cwd(), ".env");
dotenv.config({ path: envPath });
dotenv.config();

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

    // Super admin bootstrap (web/backend only — desktop never sets these).
    // When BOTH are set and no active super_admin exists, backend startup
    // creates one (role 'super_admin', tenant_id NULL). Absent = no-op.
    SUPER_ADMIN_USERNAME: z.string().optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),

    // Subdomain-scoped tenancy. When APP_BASE_DOMAIN is set (e.g.
    // "liratek.app"), the tenant is resolved from the request Host:
    // <slug>.liratek.app is that tenant's realm and the apex is the
    // platform (super_admin) realm. Login then REFUSES credentials that do
    // not belong to the host's tenant.
    //
    // Left UNSET, host-based tenancy is disabled and login behaves exactly
    // as it always has. That default is deliberate: the app is currently
    // served from liratek.vercel.app and a bare IP, neither of which is a
    // tenant subdomain, so enforcing host resolution before a domain exists
    // would lock every user out.
    APP_BASE_DOMAIN: z.string().optional(),

    // Shared secret required by POST /api/auth/signup.
    //
    // UNSET DISABLES SIGNUP ENTIRELY, which is the safe default: an
    // open tenant-creation endpoint on a POS platform invites junk tenants,
    // and every signup permanently consumes a globally-unique slug. Opting in
    // is setting one variable; forgetting to set one cannot accidentally
    // expose it.
    SIGNUP_INVITE_CODE: z.string().optional(),

    // ── Automatic tenant subdomains ──────────────────────────────────
    //
    // When a tenant is provisioned, give it <slug>.<APP_BASE_DOMAIN>
    // without anyone touching a dashboard: a CNAME at Cloudflare plus the
    // hostname registered on the Vercel project. BOTH are needed —
    // Vercel routes by Host, so DNS alone yields a 404, and the Vercel
    // domain alone never resolves.
    //
    // Every one is OPTIONAL and the feature is OFF unless the full set is
    // present. Same safe default as SIGNUP_INVITE_CODE: a half-configured
    // deployment must not half-create subdomains, and a missing token
    // must never be able to fail a signup.
    CLOUDFLARE_API_TOKEN: z.string().optional(),
    CLOUDFLARE_ZONE_ID: z.string().optional(),
    VERCEL_TOKEN: z.string().optional(),
    VERCEL_PROJECT_ID: z.string().optional(),

    // What a tenant CNAME points at. Vercel's documented generic target
    // works for any project; the per-project alias Vercel shows in its UI
    // (<hash>.vercel-dns-NNN.com) also works and can be set here.
    VERCEL_DNS_TARGET: z.string().default("cname.vercel-dns.com"),

    // Vercel team/scope id. Required only when the project belongs to a
    // team rather than a personal account -- the API needs it as a query
    // parameter and silently 404s the project without it.
    VERCEL_TEAM_ID: z.string().optional(),

    // Resolve the tenant from an X-Tenant-Slug header instead of the Host.
    // DEVELOPMENT AND TESTS ONLY: a client can send any header it likes, so
    // with this enabled tenant scoping is advisory, not enforced. It exists
    // to exercise the feature before DNS does. Never enable in production.
    TENANT_HOST_HEADER_OVERRIDE: z.coerce.boolean().optional(),

    // Electron-specific (only needed when running electron app)
    ELECTRON_RENDERER_URL: z.string().url().optional(),

    // Voice Transcription (Qwen-ASR)
    DASHSCOPE_API_KEY: z.string().optional(),
    QWEN_ASR_MODEL: z.string().default("qwen3-asr-flash-realtime"),
    QWEN_ASR_REGION: z.string().default("singapore"),
    QWEN_ASR_LANGUAGE: z.string().default("en"),
  })
  .transform((data) => {
    // Auto-adjust log level based on environment if not explicitly set
    const hasLogLevel =
      typeof process !== "undefined" &&
      typeof process.env !== "undefined" &&
      !!process.env.LOG_LEVEL;
    if (!hasLogLevel) {
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
 * Parse and validate environment variables.
 * Browser-safe: returns defaults if process is not available (Vite/frontend context).
 */
function parseEnv(): EnvConfig {
  // In browser/Vite context, process is not defined — return safe defaults
  const isBrowser =
    typeof process === "undefined" || typeof process.env === "undefined";
  if (isBrowser) {
    return envSchema.parse({});
  }

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
    SUPER_ADMIN_USERNAME: process.env.SUPER_ADMIN_USERNAME?.trim(),
    SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD,
    APP_BASE_DOMAIN: process.env.APP_BASE_DOMAIN?.trim().toLowerCase(),
    SIGNUP_INVITE_CODE: process.env.SIGNUP_INVITE_CODE,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    VERCEL_DNS_TARGET: process.env.VERCEL_DNS_TARGET,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    TENANT_HOST_HEADER_OVERRIDE:
      process.env.TENANT_HOST_HEADER_OVERRIDE === "true" ||
      process.env.TENANT_HOST_HEADER_OVERRIDE === "1",
    ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    QWEN_ASR_MODEL: process.env.QWEN_ASR_MODEL,
    QWEN_ASR_REGION: process.env.QWEN_ASR_REGION,
    QWEN_ASR_LANGUAGE: process.env.QWEN_ASR_LANGUAGE,
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
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_PASSWORD,
  APP_BASE_DOMAIN,
  SIGNUP_INVITE_CODE,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ZONE_ID,
  VERCEL_TOKEN,
  VERCEL_PROJECT_ID,
  VERCEL_DNS_TARGET,
  VERCEL_TEAM_ID,
  TENANT_HOST_HEADER_OVERRIDE,
  ELECTRON_RENDERER_URL,
  DASHSCOPE_API_KEY,
  QWEN_ASR_MODEL,
  QWEN_ASR_REGION,
  QWEN_ASR_LANGUAGE,
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
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(
        "⚠️  WARNING: Using default CORS_ORIGIN in production\n",
      );
    } else {
      console.warn("⚠️  WARNING: Using default CORS_ORIGIN in production");
    }
  }
}
