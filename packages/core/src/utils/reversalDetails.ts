/**
 * LIRA-329 (T038) — the ONE builder of a reversal row's `reversal` details
 * and of its client name/phone (rule 14). Used by every void, refund and
 * refund undo: the two direct INSERTs in TransactionRepository (void, whole
 * refund) and every REFUND / REFUND_UNDO `createTransaction` writer.
 *
 *  - `originalTransactionId`: the transaction this row reverses (an undo
 *    names the refund it undoes).
 *  - `refundUnits`: the returned phones and the flags the cashier set on
 *    each, from the refund's `refundUnitExtras` / `unitExtras`, in the
 *    fixed vocabulary below.
 *  - The client: the ORIGINAL transaction's own name and phone, copied —
 *    never resolved afresh, which could disagree with the original (a
 *    partner label, a typed walk-in name).
 *
 * A row that already carries explicit details keeps them: a warranty
 * refund (`refundSaleItem` with a claim) keeps its `warranty_claim`
 * details — the caller passes those instead of these (data-model.md).
 *
 * Pure; imports only types, so it stays browser-safe (rule 29).
 */
import {
  TRANSACTION_DETAILS_VERSION,
  type TransactionDetails,
} from "../validators/transactionDetails.js";

/** The flags a returned phone may carry on `refundUnits[].flags`. */
export const REFUND_UNIT_FLAGS = {
  DEFECTIVE: "DEFECTIVE",
  NOT_DEFECTIVE: "NOT_DEFECTIVE",
  /** Followed by `:YYYY-MM-DD`, the warranty end day the cashier set. */
  WARRANTY_UNTIL: "WARRANTY_UNTIL",
  WARRANTY_OVERRIDE_CLEARED: "WARRANTY_OVERRIDE_CLEARED",
} as const;

/** Structurally the repositories' `RefundUnitExtra` (kept here so this
 *  module imports no repository). */
export interface RefundUnitExtraForDetails {
  unit_id: number;
  is_defective?: boolean;
  warranty_override_until?: string | null;
}

type ReversalDetails = Extract<TransactionDetails, { kind: "reversal" }>;

/** A unit's flags, in the order the cashier sets them; an unset option
 *  (`undefined`) leaves the unit as it was and adds no flag. */
export function refundUnitFlags(extra: RefundUnitExtraForDetails): string[] {
  const flags: string[] = [];
  if (extra.is_defective === true) flags.push(REFUND_UNIT_FLAGS.DEFECTIVE);
  if (extra.is_defective === false) {
    flags.push(REFUND_UNIT_FLAGS.NOT_DEFECTIVE);
  }
  if (typeof extra.warranty_override_until === "string") {
    const until = extra.warranty_override_until.trim();
    if (until !== "") {
      flags.push(`${REFUND_UNIT_FLAGS.WARRANTY_UNTIL}:${until}`);
    }
  } else if (extra.warranty_override_until === null) {
    flags.push(REFUND_UNIT_FLAGS.WARRANTY_OVERRIDE_CLEARED);
  }
  return flags;
}

export function buildReversalDetails(input: {
  originalTransactionId: number;
  refundUnitExtras?: ReadonlyArray<RefundUnitExtraForDetails> | null;
}): ReversalDetails {
  const refundUnits = (input.refundUnitExtras ?? []).map((extra) => {
    const flags = refundUnitFlags(extra);
    return { unitId: extra.unit_id, ...(flags.length > 0 ? { flags } : {}) };
  });
  return {
    v: TRANSACTION_DETAILS_VERSION,
    kind: "reversal",
    originalTransactionId: input.originalTransactionId,
    ...(refundUnits.length > 0 ? { refundUnits } : {}),
  };
}

/** The original transaction's client, for its reversal row. A phone is
 *  copied only with a name (the "phone requires name" guard). */
export function reversalClientOf(original: {
  client_name?: string | null;
  client_phone?: string | null;
}): { client_name: string | null; client_phone: string | null } {
  const name =
    original.client_name != null && original.client_name.trim() !== ""
      ? original.client_name
      : null;
  const phone =
    name !== null &&
    original.client_phone != null &&
    original.client_phone.trim() !== ""
      ? original.client_phone
      : null;
  return { client_name: name, client_phone: phone };
}
