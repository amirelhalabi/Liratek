/**
 * Cryptographic utilities for password hashing and verification
 * Uses Node's native scrypt (avoids native bcrypt build issues)
 */
import crypto from "node:crypto";

const SCRYPT_PREFIX = "SCRYPT:";
const HASHED_PREFIX = "HASHED:";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hash a password using scrypt with a random salt
 * Format: SCRYPT:<salt_hex>:<hash_hex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  return SCRYPT_PREFIX + salt.toString("hex") + ":" + derived.toString("hex");
}

/**
 * Verify a password against a stored hash
 * Supports multiple formats for backward compatibility:
 * - SCRYPT:<salt>:<hash> (current)
 * - HASHED:<plaintext> (legacy)
 * - Plain text (legacy, auto-migrates on login)
 * - Empty string with admin123 (initial seed)
 */
export function verifyPassword(password: string, stored?: string): boolean {
  if (!stored) return false;

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

  // Legacy: plain text (auto-migrate on login)
  if (stored === password) return true;

  return false;
}

/**
 * Check if a password hash needs migration to scrypt
 */
export function needsMigration(stored?: string): boolean {
  if (!stored) return true;
  return !stored.startsWith(SCRYPT_PREFIX);
}

/**
 * Password complexity requirements
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

/**
 * Validate password meets complexity requirements
 */
export function validatePasswordComplexity(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain an uppercase letter");
  }
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain a lowercase letter");
  }
  if (PASSWORD_REQUIREMENTS.requireNumber && !/\d/.test(password)) {
    errors.push("Password must contain a number");
  }
  if (PASSWORD_REQUIREMENTS.requireSpecial && !/[@$!%*?&]/.test(password)) {
    errors.push("Password must contain a special character (@$!%*?&)");
  }

  return { valid: errors.length === 0, errors };
}
