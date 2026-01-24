// Barcode utilities
// - generateUniqueNumericBarcode: generates an 8-digit numeric barcode not present in products
// - suggestDuplicateBarcode: given an existing barcode, suggests next available suffix DUP{n}

export type BarcodeExistsFn = (barcode: string) => boolean;

/** Generate a random 8-digit numeric barcode as a string. */
function random8Digits(): string {
  const n = Math.floor(Math.random() * 100_000_000);
  return n.toString().padStart(8, "0");
}

/**
 * Generate a unique numeric 8-digit barcode using an existence callback.
 *
 * Note: this is intentionally callback-based to keep it testable and to avoid
 * direct DB access in utility code.
 */
export function generateUniqueNumericBarcode(exists: BarcodeExistsFn): string {
  // Try a bounded number of attempts to avoid infinite loops.
  for (let i = 0; i < 500; i++) {
    const code = random8Digits();
    if (!exists(code)) return code;
  }

  // Fallback: deterministic scan (rare). This is slower but guarantees a result.
  for (let i = 0; i < 100_000_000; i++) {
    const code = i.toString().padStart(8, "0");
    if (!exists(code)) return code;
  }

  throw new Error("Failed to generate a unique 8-digit barcode");
}

export function suggestDuplicateBarcode(
  original: string,
  exists: BarcodeExistsFn,
): string {
  // Strip any existing DUP suffixes and re-append incrementally
  // Example: 12345 -> 12345DUP1, 12345DUP2...
  const base = original.replace(/DUP\d+$/i, "");

  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base}DUP${i}`;
    if (!exists(candidate)) return candidate;
  }

  throw new Error("Failed to generate a unique duplicate barcode suggestion");
}
