/**
 * Cryptographic utilities for password hashing and verification
 *
 * Re-exported from @liratek/core so desktop and web remain identical.
 */

export {
  hashPassword,
  verifyPassword,
  needsMigration,
  PASSWORD_REQUIREMENTS,
  validatePasswordComplexity,
} from "@liratek/core";
