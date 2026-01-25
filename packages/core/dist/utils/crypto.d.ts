/**
 * Core crypto utilities shared by Desktop and Web.
 *
 * NOTE: This is intentionally kept compatible with existing code in both backends.
 */
/**
 * Hash a password using scrypt with a random salt.
 * Format: SCRYPT:<salt_hex>:<hash_hex>
 */
export declare function hashPassword(password: string): string;
/**
 * Verify a password against a stored hash.
 * Supports multiple formats for backward compatibility:
 * - SCRYPT:<salt>:<hash> (current)
 * - HASHED:<plaintext> (legacy)
 * - Plain text (legacy)
 * - Empty string with admin123 (initial seed)
 */
export declare function verifyPassword(password: string, stored?: string): boolean;
/**
 * Check if a password hash needs migration to scrypt.
 */
export declare function needsMigration(stored?: string): boolean;
/**
 * Password complexity requirements
 */
export declare const PASSWORD_REQUIREMENTS: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSpecial: boolean;
};
/**
 * Validate password meets complexity requirements.
 */
export declare function validatePasswordComplexity(password: string): {
    valid: boolean;
    errors: string[];
};
