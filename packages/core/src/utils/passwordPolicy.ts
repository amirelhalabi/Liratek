/**
 * Password complexity policy — the ONE rule every password-setting path
 * enforces (user creation, set password, tenant provisioning, invite accept,
 * password reset). Pure: no imports, so it is safe for the browser bundle
 * (rule 29) and the zod validators can apply it at the edge while the
 * services keep re-checking it. Moved out of `crypto.ts` (which imports
 * `node:crypto`); `crypto.ts` re-exports it.
 */

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
 * Validate password meets complexity requirements.
 */
export function validatePasswordComplexity(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(
      `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`,
    );
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
