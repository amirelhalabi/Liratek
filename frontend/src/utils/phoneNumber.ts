/**
 * Phone number utility functions
 */

/**
 * Normalizes a phone number by removing spaces, dashes, and parentheses
 * @param phone - The phone number to normalize
 * @returns Normalized phone number string (empty string if input is falsy)
 */
export function normalizePhoneNumber(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/[\s\-()]/g, "");
}

/**
 * Checks if a phone number is valid
 * @param phone - The phone number to validate
 * @returns true if valid, false otherwise
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^\+?[\d\s-]{8,}$/.test(phone);
}

/**
 * Checks if two phone numbers are equal (after normalization)
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns true if equal, false otherwise
 */
export function arePhoneNumbersEqual(
  phone1?: string | null,
  phone2?: string | null,
): boolean {
  const normalized1 = normalizePhoneNumber(phone1);
  const normalized2 = normalizePhoneNumber(phone2);

  if (!normalized1 || !normalized2) return false;
  return normalized1 === normalized2;
}
