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
 * What counts as a symbol (LIRA-291): any character that is not a letter or
 * a digit, so browser-generated passwords (- _ . :) pass. Exported so a
 * form's requirement checklist uses the same test (rule 14).
 */
export const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

/** The message shown when a password has no symbol (LIRA-291). */
export const PASSWORD_SYMBOL_MESSAGE =
  "Password must contain a symbol (for example - _ . @ ! #)";

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
  // LIRA-291: any character that is not a letter or a digit counts as a
  // symbol, so browser-generated passwords (which use - _ . :) pass.
  if (
    PASSWORD_REQUIREMENTS.requireSpecial &&
    !PASSWORD_SYMBOL_PATTERN.test(password)
  ) {
    errors.push(PASSWORD_SYMBOL_MESSAGE);
  }

  return { valid: errors.length === 0, errors };
}
