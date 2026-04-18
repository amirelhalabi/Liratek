/**
 * Shared password validation — mirrors backend validatePasswordComplexity
 * from packages/core/src/utils/crypto.ts
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain an uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain a lowercase letter");
  }
  if (!/\d/.test(password)) {
    errors.push("Password must contain a digit");
  }
  if (!/[@$!%*?&]/.test(password)) {
    errors.push("Password must contain a special character (@$!%*?&)");
  }

  return { valid: errors.length === 0, errors };
}
