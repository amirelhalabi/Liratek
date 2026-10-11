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
 *     `isPayout` branch). A Pay out also counts NETTING as paying — LIRA-305,
 *     owner decisions Y6/Y13/Y14: netting counts as paying; paper credits
 *     never do. See {@link partnerEffectiveCoveredSql}. FOR rows stay
 *     cash-only (Y7).
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
 * Netting (LIRA-305) is read-time too — nothing is written for it, so a void
 * or refund of a SEND, a RECEIVE or a settlement re-derives it on the next
 * read; rule 20 needs no new reversal owner.
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

/*
 * LIRA-305 — PARTNER NETTING for a Custom Services Pay out (owner decisions
 * Y6 / Y13 / Y14, `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §3).
 *
 * In a two-way corridor (SEND = Via Partner, the shop owes the partner the
 * cost; RECEIVE = Via Partner + Pay out, the partner owes the shop what
 * arrived) the two sides cancel on the partner's account without any cash
 * changing hands. Cash coverage alone (`covered_amount`, stamped by
 * `PartnerRepository.applySettlementCoverage`) never sees that, so a Pay
 * out's commission would wait forever. The rule, read-time only:
 *
 *  - N = the partner's netting balance in the head's currency
 *    ({@link partnerNettingBalanceSql}): Σ DEBIT − Σ CREDIT, leaving out paper
 *    credits only. N > 0 means the partner still owes the shop N.
 *  - Of the Pay out money still not cash-covered ({@link partnerPayoutUncoveredSql}),
 *    the NEWEST Pay outs are held first, up to N; the oldest count first —
 *    the same FIFO every other coverage path uses. "Newer" is
 *    `julianday(created_at)` then `id`, never text order: two formats are
 *    stored (ISO `…T…Z` from a transaction_time, `YYYY-MM-DD HH:MM:SS` from
 *    CURRENT_TIMESTAMP).
 *  - effective covered(h) = coverable(h) − held(h). Every other head keeps
 *    MIN(covered_amount, coverable) — FOR rows of every module are unchanged.
 *
 * Nothing is stored. `covered_amount` keeps meaning "cash covered"; netting
 * must never be written into it (`applySettlementCoverage` and
 * `TransactionRepository._unwindPartnerSettlementCoverage` stay on raw
 * stamps). Undo (Y14): delete `partnerEffectiveCoveredSql` and point the two
 * consumers below back at `covered_amount`; no data to migrate.
 *
 * Reserved inner aliases — callers must not pass these as `alias`: `plb`,
 * `plb_tx`, `plb_tx2`, `ph`, `pg`, `g`, plus the existing `plg`, `plg_tx`,
 * `plh_earlier`, `plh_prev`, `plo_first`.
 *
 * Tenant scoping: every new sub-query filters `tenant_id = <alias>.tenant_id`
 * (`check-tenant-scoping` does not scan `constants/`; the guard is
 * `ProfitRepository.syriaCorridorNetting.test.ts` case (n)).
 */

/**
 * The partner's NETTING balance for `alias`'s partner / currency / tenant —
 * the ONE definition (rule 14). Equal to `PartnerRepository.getBalance`
 * minus paper credits only:
 *  1. a CREDIT that sources a `PARTNER_ADJUSTMENT` transaction (a manual
 *     entry with "Cash moved" off — `PartnerRepository.recordAdjustmentTransaction`;
 *     non-reversible, so such rows never have reversals), and
 *  2. a LEGACY manual CREDIT from before LIRA-066: no reference, not a
 *     SETTLEMENT/DISCOUNT, and no `PARTNER_PAYMENT`/`PARTNER_SETTLEMENT` link
 *     (it has no transactions row at all and cannot be voided).
 * Every other row — obligations, settlements, discounts, cash-moved entries,
 * `WHISH_TOPUP`, and every reversal row — counts. Credit TYPES are
 * deliberately not whitelisted: a reversal never carries its own
 * `PARTNER_ADJUSTMENT` link, so it always counts exactly like its original,
 * which keeps every void symmetric (a type whitelist left commission stuck
 * after voiding a cash-moved entry or a top-up).
 *
 * The unary `+` on `+plb_tx.tenant_id` / `+plb_tx2.tenant_id` is REQUIRED:
 * it stops SQLite from choosing `idx_transactions_tenant_id` (a scan of the
 * whole tenant's transactions per CREDIT row — measured 14.7 s / 56 s on the
 * guard's perf fixtures) and keeps `idx_transactions_source` (≈1 s / 4 s).
 * Guarded by case (t) of the netting test.
 */
export function partnerNettingBalanceSql(alias: string): string {
  return `(SELECT COALESCE(SUM(CASE
      WHEN plb.direction = 'DEBIT' THEN plb.amount
      WHEN EXISTS (
        SELECT 1 FROM transactions plb_tx
        WHERE plb_tx.type = 'PARTNER_ADJUSTMENT'
          AND plb_tx.source_table = 'partner_ledger'
          AND plb_tx.source_id = plb.id
          AND +plb_tx.tenant_id = plb.tenant_id) THEN 0
      WHEN plb.reference_table IS NULL
        AND COALESCE(plb.transaction_type, '') NOT IN ('SETTLEMENT', 'DISCOUNT')
        AND NOT EXISTS (
          SELECT 1 FROM transactions plb_tx2
          WHERE plb_tx2.type IN ('PARTNER_PAYMENT', 'PARTNER_SETTLEMENT')
            AND plb_tx2.source_table = 'partner_ledger'
            AND plb_tx2.source_id = plb.id
            AND +plb_tx2.tenant_id = plb.tenant_id) THEN 0
      ELSE -plb.amount END), 0)
    FROM partner_ledger plb
    WHERE plb.partner_id = ${alias}.partner_id
      AND plb.currency = ${alias}.currency
      AND plb.tenant_id = ${alias}.tenant_id)`;
}

/**
 * @internal Exported only so the netting test (case o) can pin it to
 * `partnerObligationCoverableSql` − MIN(covered, coverable) (rule 14).
 *
 * Pay out head `alias`'s amount still not cash-covered: MAX(0, MIN(amount,
 * group net) − covered_amount), where the group is the head's own
 * same-type/currency/reference rows (DEBIT +, CREDIT −), filtered by
 * partner and tenant too so `idx_partner_ledger_partner_id` is used.
 */
export function partnerPayoutUncoveredSql(alias: string): string {
  return `MAX(0.0, MIN(${alias}.amount,
    (SELECT COALESCE(SUM(CASE WHEN ph.direction = 'DEBIT' THEN ph.amount ELSE -ph.amount END), 0)
       FROM partner_ledger ph
      WHERE ph.partner_id = ${alias}.partner_id
        AND ph.tenant_id = ${alias}.tenant_id
        AND ph.currency = ${alias}.currency
        AND ph.transaction_type = ${alias}.transaction_type
        AND ph.reference_table = ${alias}.reference_table
        AND ph.reference_id = ${alias}.reference_id))
    - ${alias}.covered_amount)`;
}

/**
 * @internal Exported only so the netting test (case o) can pin it.
 *
 * Σ uncovered of the Pay out groups on `alias`'s partner / currency / tenant
 * whose head is NEWER than `alias` (julianday(created_at), then id). One
 * grouped pass over the partner's `THROUGH_CUSTOM_SERVICE` rows: a group
 * whose first row (lowest id) is a DEBIT is a Pay out (the same "first row
 * decides" rule as `partnerObligationRowSql`). `head_jd` reads the DEBIT
 * row's time only (a Pay out group has exactly one DEBIT, its head), so a
 * reversal written in the other text format is never taken for the head.
 */
export function payoutNewerSumSql(alias: string): string {
  return `(SELECT COALESCE(SUM(g.unc), 0) FROM (
      SELECT pg.reference_id,
             MIN(pg.id) AS head_id,
             MIN(CASE WHEN pg.direction = 'DEBIT' THEN julianday(pg.created_at) END) AS head_jd,
             MAX(0.0, MIN(SUM(CASE WHEN pg.direction = 'DEBIT' THEN pg.amount ELSE 0 END),
                          SUM(CASE WHEN pg.direction = 'DEBIT' THEN pg.amount ELSE -pg.amount END))
                      - SUM(pg.covered_amount)) AS unc
        FROM partner_ledger pg
       WHERE pg.partner_id = ${alias}.partner_id
         AND pg.currency = ${alias}.currency
         AND pg.tenant_id = ${alias}.tenant_id
         AND pg.transaction_type = 'THROUGH_CUSTOM_SERVICE'
         AND pg.reference_table = 'custom_services'
       GROUP BY pg.reference_id
      HAVING MIN(CASE WHEN pg.direction = 'DEBIT' THEN pg.id END) = MIN(pg.id)
    ) g
    WHERE g.head_jd > julianday(${alias}.created_at)
       OR (g.head_jd = julianday(${alias}.created_at) AND g.head_id > ${alias}.id))`;
}

/**
 * The amount of obligation head `alias` that counts as PAID — the value both
 * profit consumers use in place of the raw `covered_amount` (LIRA-305).
 * Scalar in [0, coverable(alias)]; meaningful only for rows passing
 * {@link partnerObligationHeadRowSql}.
 *  - A Custom Services Pay out head (`THROUGH_CUSTOM_SERVICE` DEBIT — by
 *    construction a Pay out, since the IN-reversal DEBIT is excluded by
 *    `partnerObligationRowSql`): coverable minus the part still held by
 *    netting. The first two arms are cheap guards (already cash-covered;
 *    the partner owes nothing) that return the same value the ELSE arm would
 *    — they only skip the grouped newer-sum.
 *  - Any other head: MIN(covered_amount, coverable) — unchanged.
 */
export function partnerEffectiveCoveredSql(alias: string): string {
  const coverable = partnerObligationCoverableSql(alias);
  const unc = partnerPayoutUncoveredSql(alias);
  const n = partnerNettingBalanceSql(alias);
  return `(CASE
    WHEN ${alias}.transaction_type = 'THROUGH_CUSTOM_SERVICE' AND ${alias}.direction = 'DEBIT' THEN (CASE
      WHEN ${unc} <= 0.005 THEN ${coverable}
      WHEN ${n} <= 0.005 THEN ${coverable}
      ELSE ${coverable} - MAX(0.0, MIN(${unc}, ${n} - ${payoutNewerSumSql(alias)}))
    END)
    ELSE MIN(${alias}.covered_amount, ${coverable})
  END)`;
}

/**
 * Settlement-coverage ratio over the heads selected by `refWhere` (a SQL
 * condition on alias `plr`): Σ effective covered / Σ coverable, each head's
 * effective covered amount ({@link partnerEffectiveCoveredSql} — cash, plus
 * netting for a Pay out) capped at its coverable amount, clamped to [0, 1]. 1.0 when there
 * is no head or nothing is left to cover (net 0 — nothing to wait for).
 */
export function partnerCoverageRatioWhereSql(refWhere: string): string {
  return `COALESCE(
    (
      SELECT CASE WHEN SUM(plr_cov.coverable) > 0.005
        THEN MAX(0.0, MIN(1.0,
          SUM(MIN(plr_cov.effective, plr_cov.coverable)) / SUM(plr_cov.coverable)))
        ELSE 1.0 END
      FROM (
        SELECT ${partnerEffectiveCoveredSql("plr")} AS effective,
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
      AND ${partnerEffectiveCoveredSql("plp")} < ${partnerObligationCoverableSql("plp")} - 0.005
  )`;
}
