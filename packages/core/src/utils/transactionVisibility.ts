/**
 * Which transactions the operator-facing lists hide by DEFAULT — the web
 * Transactions page with no type filter, and the phone's Activity tab. One
 * definition for both (rule 14); the web page's per-filter overrides (an
 * explicit "Expense" filter reveals auto expenses, …) stay in the frontend.
 *
 * Pure and dependency-free: reachable from browser.ts and from the phone.
 */

/** Types hidden from the default list whatever their metadata (client-log noise). */
export const DEFAULT_HIDDEN_TRANSACTION_TYPES: readonly string[] = ["CLIENT_CREATED"];

/**
 * Types whose system-written siblings (`metadata_json.is_auto = true`, rule 26)
 * are hidden by default. A manual row of the same type stays visible.
 */
export const AUTO_HIDDEN_TRANSACTION_TYPES: readonly string[] = [
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "WARRANTY_COST",
];

/** True only when the metadata explicitly says `is_auto: true`. Missing or
 *  unparsable metadata reads as NOT auto, i.e. visible (rule 26a). */
export function isAutoRow(metaJson: string | null | undefined): boolean {
  if (!metaJson) return false;
  try {
    const meta = JSON.parse(metaJson) as unknown;
    return (
      typeof meta === "object" &&
      meta !== null &&
      (meta as Record<string, unknown>).is_auto === true
    );
  } catch {
    return false;
  }
}

/** Whether a row is hidden from the default (unfiltered) transactions list. */
export function isHiddenByDefault(row: {
  type: string;
  metadata_json: string | null | undefined;
}): boolean {
  if (DEFAULT_HIDDEN_TRANSACTION_TYPES.includes(row.type)) return true;
  return AUTO_HIDDEN_TRANSACTION_TYPES.includes(row.type) && isAutoRow(row.metadata_json);
}
