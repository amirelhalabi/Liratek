/**
 * LIRA-079 → LIRA-388 — plain-language "can't refund here, because…" texts
 * for the rows the Transactions page cannot refund. Since LIRA-388 every
 * other row has a "Refund" (core's one classification, `refundPlanOf` in
 * packages/core/src/constants/refundKinds.ts, decides; this file only
 * words its reasons):
 *   - the structural types (`NON_REFUNDABLE_TRANSACTION_TYPES`): reversal
 *     rows, basket-only lines, counts, settlements, client audit entries;
 *   - two legacy-only types (old MTC/Alfa customer top-ups);
 *   - a row-level case: a carrier-line edit that recorded no previous
 *     credits (`carrierLineNoValues`).
 *
 * Every text names an action that EXISTS (FR-008) —
 * `nonReversibleReasons.guard.test.ts` pins the key set to core's and
 * scans for actions that no longer exist ("Void" on a single row, "from the
 * Loto page" for a prize).
 *
 * The page shows the i18n string (`audit.json` → `nonReversible.<key>`);
 * this English map is its `defaultValue` and the guard's source.
 */

export const NON_REVERSIBLE_REASONS: Readonly<Record<string, string>> = {
  LOTO_SETTLEMENT:
    "A Loto settlement is final — if it was wrong, correct the Loto balance with an opposite Add Credit/Debt entry for Loto on the Suppliers page.",
  REFUND:
    'This row is itself a refund — it can\'t be refunded or voided again. An admin can undo a per-item refund right from this row ("Undo refund"); other refunds have no undo yet.',
  REFUND_UNDO:
    "This row already undoes a refund — it can't be refunded, voided, or undone again.",
  KEPT_CHANGE:
    "Nothing to reverse on this row by itself — the kept change stays in the drawer either way. Refund the customer's basket instead; that removes it too.",
  EXTRA_CHARGE:
    "Nothing to reverse on this row by itself — it only records the extra charged at checkout. Void or refund the customer's basket instead; that removes it too.",
  WAIVED_SHORTFALL:
    "Nothing to reverse on this row by itself — it only records the amount waived at checkout. Void or refund the customer's basket instead; that removes it too.",
  BASKET_DISCOUNT:
    "Nothing to reverse on this row by itself — it only records the discount given at checkout. Void or refund the customer's basket instead; that removes it too.",
  HOLD_MONEY_COLLECT_VOID:
    "This row already reverses a Hold Money pickup — it can't be reversed again.",
  CHECKPOINT:
    "Checkpoints are a point-in-time count, not a transaction to undo — correct a bad count with a new checkpoint.",
  CLIENT_CREATED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
  CLIENT_UPDATED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
  CLIENT_DELETED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
  VOUCHER_CANCEL:
    "A voucher cancel is final — it can't be refunded or voided. Sell a new voucher from the Vouchers page if needed.",
  MTC_TOPUP:
    "This old customer top-up was recorded before carrier lines were tracked, so its credits can't be taken back automatically — correct the line's credits on the Recharge page.",
  ALFA_TOPUP:
    "This old customer top-up was recorded before carrier lines were tracked, so its credits can't be taken back automatically — correct the line's credits on the Recharge page.",
  carrierLineNoValues:
    "This line edit did not record the line's previous credits, so it can't be put back automatically — edit the line again on the Recharge page.",
};

/**
 * The reason a row can't be refunded from this page, by core's reason key
 * (a type, or `carrierLineNoValues`), or `null` when the key has no text
 * (a reversal row, or a live refundable row).
 */
export function getNonReversibleReason(reasonKey: string): string | null {
  return NON_REVERSIBLE_REASONS[reasonKey] ?? null;
}
