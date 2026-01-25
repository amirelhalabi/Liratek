export type BarcodeExistsFn = (barcode: string) => boolean;
/**
 * Generate a unique numeric 8-digit barcode using an existence callback.
 *
 * Note: this is intentionally callback-based to keep it testable and to avoid
 * direct DB access in utility code.
 */
export declare function generateUniqueNumericBarcode(exists: BarcodeExistsFn): string;
export declare function suggestDuplicateBarcode(original: string, exists: BarcodeExistsFn): string;
