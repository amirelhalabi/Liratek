/**
 * Receipt-printing gating (LIRA-069 / W1.a).
 *
 * The Transactions viewer's per-row Print button, each module's History-modal
 * Print button, and the auto-print-on-success hook must ALL agree on which
 * transactions get a customer receipt. Before this file, that decision was
 * TYPE-ONLY (RECEIPTABLE_TYPES in auditConstants.ts), which wrongly showed
 * Print on every FINANCIAL_SERVICE row -- including OMT System, Whish System,
 * OMT App / Whish App money transfers, and Binance, none of which the ticket
 * wants a customer receipt for.
 *
 * isReceiptableTransaction is the ONE place that decision is made -- every
 * consumer (TransactionsViewer, module History modals, useAutoPrintReceipt)
 * calls this, never a copy-pasted provider list (rule 14 spirit).
 *
 * Provider values are the exact enum strings persisted at write time
 * (FinancialServiceRepository.ts metadata_json.provider -- see
 * packages/core/src/constants/rechargeProviders.ts for the canonical
 * spellings: "OMT_APP"/"WHISH_APP" post-v105, "iPick"/"Katsh" case as-is).
 *
 * Whish App Bills vs Transfers (investigated 2026-07-19): both are persisted
 * as FINANCIAL_SERVICE rows with provider "WHISH_APP" -- the ONLY reliable,
 * already-used discriminator in persisted data is metadata.item_key.
 *   - Bills flow through FinancialForm.tsx (whishAppMode === "bills"),
 *     which ALWAYS sets itemKey: line.item.key on every submit
 *     (FinancialForm.tsx handleSubmit/handleForPartnerSubmit).
 *   - Transfers flow through OmtWhishAppTransferForm.tsx, which NEVER sets
 *     an item key (SEND/RECEIVE money movement, no catalog item).
 *   - This is the SAME marker TransactionRepository's has_item_key filter
 *     already uses to split "Whish App Bills" from "Whish App Send/Recv" in
 *     auditConstants.ts's FILTER_GROUPS -- not a new invention, just reused.
 * Conclusion: Whish App Bills ARE receiptable (item_key present); Whish App
 * transfers are NOT (item_key absent). No owner follow-up needed here.
 */

import { parseMetaSafe, RECEIPTABLE_TYPES } from "./auditConstants";

/**
 * Unified transaction types that are ALWAYS receiptable -- no provider check
 * needed (single-service modules with no system-transfer/wallet concept).
 * Derived from RECEIPTABLE_TYPES (the base "candidate types" set, guarded by
 * actionGating.guard.test.ts to stay a real TransactionType) minus
 * FINANCIAL_SERVICE, which is the ONE type that needs the provider/item_key
 * refinement below -- one list of candidate types, not two hand-maintained
 * copies (rule 14 spirit).
 */
const ALWAYS_RECEIPTABLE_TYPES: ReadonlySet<string> = new Set(
  [...RECEIPTABLE_TYPES].filter((t) => t !== "FINANCIAL_SERVICE"),
);

/** FINANCIAL_SERVICE providers that are customer catalog/bill purchases,
 *  never a system/wallet transfer -- always receiptable regardless of
 *  item_key or service_type. */
const RECEIPTABLE_FINANCIAL_PROVIDERS: ReadonlySet<string> = new Set([
  "iPick",
  "Katsh",
]);

/** FINANCIAL_SERVICE providers that are ALWAYS a system/wallet transfer or
 *  crypto exchange -- never a customer receipt. Kept as an explicit allow-list
 *  complement (documentation only; the default branch already excludes
 *  these -- see the guard test for the exhaustive matrix). */
const EXCLUDED_FINANCIAL_PROVIDERS: ReadonlySet<string> = new Set([
  "OMT", // OMT System
  "WHISH", // Whish System
  "OMT_APP", // OMT App -- transfer only, no bills sub-mode
  "BINANCE",
]);

export interface ReceiptGatingFields {
  /** Unified transaction `type` column (e.g. "FINANCIAL_SERVICE", "RECHARGE"). */
  type: string;
  /** metadata.provider -- only meaningful for FINANCIAL_SERVICE rows. */
  provider?: string | null;
  /** metadata.item_key (or the module row's own item_key column) -- presence,
   *  not value, is what matters. Whish App Bills carry one; Whish App
   *  transfers never do. */
  itemKey?: unknown;
}

/**
 * Single source of truth: does this transaction get a customer receipt?
 *
 * Include: RECHARGE (telecom/mobile), MAINTENANCE, CUSTOM_SERVICE, LOTO, and
 * FINANCIAL_SERVICE rows for iPick/Katsh (catalog + bills) or Whish App Bills
 * (item_key set).
 * Exclude: OMT/Whish System, OMT App / Whish App transfers, Binance, and any
 * type outside the always-receiptable set above (e.g. RECHARGE_TOPUP-class
 * drawer top-ups are excluded by TYPE MISMATCH alone -- they are never typed
 * "RECHARGE"/"FINANCIAL_SERVICE").
 */
export function isReceiptableTransaction(fields: ReceiptGatingFields): boolean {
  if (ALWAYS_RECEIPTABLE_TYPES.has(fields.type)) return true;
  if (fields.type !== "FINANCIAL_SERVICE") return false;

  const provider = fields.provider ?? "";
  if (RECEIPTABLE_FINANCIAL_PROVIDERS.has(provider)) return true;
  if (provider === "WHISH_APP") return fields.itemKey != null;

  // Explicit documentation branch -- OMT/WHISH/OMT_APP/BINANCE (and anything
  // unrecognized) all fall through to false regardless of this set's
  // membership; kept only so EXCLUDED_FINANCIAL_PROVIDERS isn't flagged
  // unused and the guard test has something concrete to assert against.
  void EXCLUDED_FINANCIAL_PROVIDERS;
  return false;
}

/** Parse metadata_json defensively and decide receiptability in one step --
 *  for callers holding a persisted transaction row (metadata_json string)
 *  rather than already-destructured fields (the Transactions viewer and
 *  module History modals fall in this bucket). Reuses auditConstants'
 *  parseMetaSafe so there's one JSON-parse-safe helper, not two. */
export function isReceiptableRow(row: {
  type: string;
  metadata_json?: string | null;
}): boolean {
  const meta = parseMetaSafe(row.metadata_json);
  return isReceiptableTransaction({
    type: row.type,
    provider: typeof meta.provider === "string" ? meta.provider : null,
    itemKey: meta.item_key,
  });
}
