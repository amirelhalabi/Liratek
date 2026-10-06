/**
 * The ONE definition (rule 14) of "this partner_ledger row is a partner
 * OBLIGATION whose settlement decides when the shop's profit is realized".
 *
 * Shared by every reader and writer that must agree on it:
 *  - ProfitRepository's partner deferral fragments (`notPartnerPending`,
 *    `partnerCoverageRatio`, `hasPartnerObligation`, `txnNotPartnerPending`,
 *    `txnPartnerCoverageRatio`) — which rows hold profit back;
 *  - PartnerRepository.applySettlementCoverage — which rows a partner
 *    settlement covers, FIFO;
 *  - TransactionRepository._unwindPartnerSettlementCoverage — which rows a
 *    settlement void/refund gives that coverage back from.
 * If these drift, profit is either released early or deferred forever.
 *
 * Members:
 *  1. Every `FOR_%` row (PFT-6, owner decision Model A) — unchanged.
 *  2. LIRA-258 / owner decision D5 (2026-10-06, "count it when the partner
 *     pays"): a Via-Partner PAYOUT's `THROUGH_CUSTOM_SERVICE` DEBIT — the
 *     partner owes the shop the price (CustomServiceRepository.createService,
 *     `isPayout` branch).
 *
 * Deliberately NOT members:
 *  - A Via-Partner IN service's `THROUGH_CUSTOM_SERVICE` CREDIT: the customer
 *    already paid the shop and the shop owes the PARTNER the cost. The
 *    partner owes the shop nothing, so there is nothing to wait for.
 *  - The `THROUGH_CUSTOM_SERVICE` DEBIT that voiding/refunding such an IN
 *    service writes (`TransactionRepository._reversePartnerLedger` books the
 *    same type, opposite direction). It cancels the shop's debt to the
 *    partner; it is not money the partner owes. It is told apart from a
 *    payout's DEBIT by its source row's history: an IN service's FIRST
 *    THROUGH_CUSTOM_SERVICE row is a CREDIT, a payout's never is (a payout
 *    books DEBITs only; its own reversal CREDITs come later, with higher
 *    ids). This reads partner_ledger alone — no join to `custom_services` —
 *    so every caller works on any schema that already has partner_ledger.
 *  - Other `THROUGH_%` rows (OMT/WHISH/Binance/iPick/Katsh sends/receives)
 *    stay out — no owner decision covers them.
 *
 * `alias` is the partner_ledger alias (or the bare table name) in scope at
 * the call site. Returns a parenthesized boolean SQL expression with no
 * bind parameters. Not stamped anywhere: coverage is re-read on every query,
 * so a settlement void corrects recognition on the next read (rule 20).
 */
export function partnerObligationRowSql(alias: string): string {
  return `(${alias}.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
    OR (${alias}.transaction_type = 'THROUGH_CUSTOM_SERVICE'
        AND ${alias}.direction = 'DEBIT'
        AND NOT EXISTS (
          SELECT 1 FROM partner_ledger plo_first
          WHERE plo_first.reference_table = ${alias}.reference_table
            AND plo_first.reference_id = ${alias}.reference_id
            AND plo_first.transaction_type = 'THROUGH_CUSTOM_SERVICE'
            AND plo_first.direction = 'CREDIT'
            AND plo_first.id < ${alias}.id
        )))`;
}

/*
 * LIRA-258 / G36 — NET obligation. A partner settlement pays down what the
 * partner STILL OWES, so every coverage reader and writer works on the net
 * of an obligation and its reversals, never on the raw row amount. Before
 * this, a refunded sale's original row kept absorbing settlements meant for
 * later sales.
 *
 * Shared, unchanged, by (rule 14):
 *  - PartnerRepository.applySettlementCoverage (FIFO cover),
 *  - TransactionRepository._unwindPartnerSettlementCoverage (reverse FIFO),
 *  - ProfitRepository's partner fragments (`notPartnerPending`,
 *    `partnerCoverageRatio`, `hasPartnerObligation`, `txnNotPartnerPending`,
 *    `txnPartnerCoverageRatio`).
 *
 * The model:
 *  - An obligation GROUP is the rows of one `transaction_type` and one
 *    currency that belong to one source row (a source row has one partner,
 *    and reference_table + reference_id identify it globally, so no partner
 *    or tenant correlation is needed — same convention as the profit gates). A row belongs to source
 *    row S when it references S directly (`reference_table`/`reference_id`)
 *    or when it references a TRANSACTION whose own `source_table`/
 *    `source_id` is S. The second shape is the per-item refund and its undo
 *    (SalesRepository.refundSaleItem / undoSaleItemRefund write FOR_POS rows
 *    referencing the REFUND / UNDO transaction, which carries the sale's
 *    source) — no metadata parsing needed.
 *  - The group's obligation direction is the direction of its FIRST direct
 *    row (lowest id) — the original booking. The generic reversal
 *    (`TransactionRepository._reversePartnerLedger`) writes the same type
 *    and reference in the OPPOSITE direction, always later. This is the same
 *    "first row decides" rule `partnerObligationRowSql` already uses to tell
 *    a Via-Partner payout from an IN service's reversal. No writer books
 *    opposite-direction rows of one type/currency/reference at creation
 *    (`partnerOwedDelta` returns one direction for all its lines).
 *  - HEAD rows ({@link partnerObligationHeadRowSql}) are the direct rows in
 *    the obligation direction that pass `partnerObligationRowSql`. Only heads
 *    are ever covered. Reversal rows and transaction-linked rows are never
 *    heads — they only change the group's net.
 *  - Group NET = Σ amounts in the obligation direction − Σ amounts in the
 *    opposite direction, over every row of the group (an undo's re-charge
 *    adds back what its refund took off).
 *  - A head's COVERABLE amount ({@link partnerObligationCoverableSql}) is its
 *    share of the net, oldest head first: MAX(0, MIN(amount, net − Σ earlier
 *    heads)). A group with one head (the normal case) gets MIN(amount, net).
 *    A fully reversed obligation has nothing left to cover.
 *
 * Not handled here (unchanged behaviour): coverage already stamped on an
 * obligation BEFORE it was reversed stays on that row (it is not moved to
 * later obligations). The ratio clamps it to 1.
 *
 * Every fragment reads `partner_ledger` and `transactions` and has no bind
 * parameters. `alias` is the partner_ledger alias of the row being judged;
 * it must not be the bare table name (the inner sub-queries scan
 * partner_ledger again).
 */

/** Rows `r` of the same obligation group as head row `h` (see above). */
function sameObligationGroupSql(r: string, h: string): string {
  return `(${r}.transaction_type = ${h}.transaction_type
    AND ${r}.currency = ${h}.currency
    AND (${r}.id = ${h}.id
      OR (${h}.reference_table IS NOT NULL AND ${h}.reference_id IS NOT NULL
        AND ((${r}.reference_table = ${h}.reference_table
              AND ${r}.reference_id = ${h}.reference_id)
          OR (${r}.reference_table = 'transactions'
              AND EXISTS (
                SELECT 1 FROM transactions ${r}_tx
                WHERE ${r}_tx.id = ${r}.reference_id
                  AND ${r}_tx.source_table = ${h}.reference_table
                  AND ${r}_tx.source_id = ${h}.reference_id))))))`;
}

/**
 * Is `alias` an obligation HEAD — a row a settlement may cover? An
 * obligation row (`partnerObligationRowSql`) that references its source
 * directly and is in its group's obligation direction (no earlier direct row
 * of the same type/currency/reference in the opposite direction).
 */
export function partnerObligationHeadRowSql(alias: string): string {
  return `(${partnerObligationRowSql(alias)}
    AND COALESCE(${alias}.reference_table, '') <> 'transactions'
    AND NOT EXISTS (
      SELECT 1 FROM partner_ledger plh_prev
      WHERE plh_prev.reference_table = ${alias}.reference_table
        AND plh_prev.reference_id = ${alias}.reference_id
        AND plh_prev.transaction_type = ${alias}.transaction_type
        AND plh_prev.currency = ${alias}.currency
        AND plh_prev.direction IS NOT ${alias}.direction
        AND plh_prev.id < ${alias}.id
    ))`;
}

/**
 * The amount of head row `alias` a settlement can still be applied to: its
 * oldest-first share of the group's net (see above). Scalar, ≥ 0, ≤ amount.
 * Meaningful only for rows passing {@link partnerObligationHeadRowSql}.
 */
export function partnerObligationCoverableSql(alias: string): string {
  return `MAX(0.0, MIN(${alias}.amount,
    (SELECT COALESCE(SUM(CASE WHEN plg.direction IS ${alias}.direction
                              THEN plg.amount ELSE -plg.amount END), 0)
       FROM partner_ledger plg
      WHERE ${sameObligationGroupSql("plg", alias)})
    - (SELECT COALESCE(SUM(plh_earlier.amount), 0)
         FROM partner_ledger plh_earlier
        WHERE plh_earlier.reference_table = ${alias}.reference_table
          AND plh_earlier.reference_id = ${alias}.reference_id
          AND plh_earlier.transaction_type = ${alias}.transaction_type
          AND plh_earlier.currency = ${alias}.currency
          AND plh_earlier.direction IS ${alias}.direction
          AND plh_earlier.id < ${alias}.id)))`;
}

/**
 * Settlement-coverage ratio over the heads selected by `refWhere` (a SQL
 * condition on alias `plr`): Σ covered / Σ coverable, each head's covered
 * amount capped at its coverable amount, clamped to [0, 1]. 1.0 when there
 * is no head or nothing is left to cover (net 0 — nothing to wait for).
 */
export function partnerCoverageRatioWhereSql(refWhere: string): string {
  return `COALESCE(
    (
      SELECT CASE WHEN SUM(plr_cov.coverable) > 0.005
        THEN MAX(0.0, MIN(1.0,
          SUM(MIN(plr_cov.covered_amount, plr_cov.coverable)) / SUM(plr_cov.coverable)))
        ELSE 1.0 END
      FROM (
        SELECT plr.covered_amount AS covered_amount,
               ${partnerObligationCoverableSql("plr")} AS coverable
        FROM partner_ledger plr
        WHERE ${refWhere}
          AND ${partnerObligationHeadRowSql("plr")}
      ) plr_cov
    ),
    1.0
  )`;
}

/**
 * Does a head selected by `refWhere` (condition on alias `plp`) still have an
 * uncovered net amount? The binary sibling of
 * {@link partnerCoverageRatioWhereSql}: true exactly when that ratio is < 1.
 */
export function partnerUncoveredExistsWhereSql(refWhere: string): string {
  return `EXISTS (
    SELECT 1 FROM partner_ledger plp
    WHERE ${refWhere}
      AND ${partnerObligationHeadRowSql("plp")}
      AND plp.covered_amount < ${partnerObligationCoverableSql("plp")} - 0.005
  )`;
}
