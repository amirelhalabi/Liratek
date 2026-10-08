/**
 * Core crypto utilities shared by Desktop and Web.
 *
 * NOTE: This is intentionally kept compatible with existing code in both backends.
 */

import crypto from "node:crypto";

const SCRYPT_PREFIX = "SCRYPT:";
const HASHED_PREFIX = "HASHED:";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hash a password using scrypt with a random salt.
 * Format: SCRYPT:<salt_hex>:<hash_hex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  return SCRYPT_PREFIX + salt.toString("hex") + ":" + derived.toString("hex");
}

/**
 * Verify a password against a stored hash.
 * Supports multiple formats for backward compatibility:
 * - SCRYPT:<salt>:<hash> (current)
 * - HASHED:<plaintext> (legacy)
 * - Plain text (legacy)
 * - Empty string with admin123 (initial seed)
 */
export function verifyPassword(password: string, stored?: string): boolean {
  if (stored == null) return false;

  // Current format: scrypt hash
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, saltHex, hashHex] = stored.split(":");
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, derived);
  }

  // Legacy: HASHED: prefix (plain text with marker)
  if (stored.startsWith(HASHED_PREFIX)) {
    return password === stored.substring(HASHED_PREFIX.length);
  }

  // Legacy: empty string with default admin password
  if (stored === "" && password === "admin123") return true;

  // Legacy: plain text
  if (stored === password) return true;

  return false;
}

/**
 * Check if a password hash needs migration to scrypt.
 */
export function needsMigration(stored?: string): boolean {
  if (!stored) return true;
  return !stored.startsWith(SCRYPT_PREFIX);
}

/**
 * Password complexity rules live in the pure `passwordPolicy.ts` (no
 * `node:crypto`), so the browser-safe zod validators can enforce the SAME
 * rule (rule 14 + rule 29). Re-exported here so existing imports keep working.
 */
export {
  PASSWORD_REQUIREMENTS,
  PASSWORD_SYMBOL_MESSAGE,
  PASSWORD_SYMBOL_PATTERN,
  validatePasswordComplexity,
} from "./passwordPolicy.js";

// =============================================================================
// Opaque tokens (LIRA-267 — sign-up invite links)
// =============================================================================

const TOKEN_BYTES = 32;

/**
 * A fresh, URL-safe random token: 32 bytes as base64url (43 characters, no
 * padding). Sent in an emailed link; only {@link hashToken} of it is stored.
 */
export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * sha256 of a token, as lowercase hex. Deterministic, so a presented token
 * is looked up by its hash; the token itself is never persisted. A plain
 * (unsalted) hash is enough here because the token carries 256 bits of
 * randomness — there is nothing to brute-force.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time string comparison. `timingSafeEqual` throws on unequal
 * lengths, and returning early on a length mismatch would leak the length
 * through timing — so both sides are padded to the longer byte length,
 * compared in full, and the length check is folded in afterwards.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const length = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const contentEqual = crypto.timingSafeEqual(paddedA, paddedB);
  return contentEqual && bufA.length === bufB.length;
}
