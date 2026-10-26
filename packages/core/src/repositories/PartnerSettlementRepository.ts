/**
 * LIRA-346 — partner settlement by day (specs/346-partner-settle-by-day).
 *
 * Owns `partner_settlement_coverage` (v225) and everything that reads or
 * writes it:
 *  - the unit loader (`loadUnits`): every USD / LBP partner_ledger row of a
 *    partner, grouped by `utils/partnerSettleUnits.ts` (the ONE definition);
 *  - the calendar reads (open rows, month rows, day detail);
 *  - settle picked days (`settleDays`), through the generic allocator;
 *  - the ONE coverage writer (`writeCoverage`) and the ONE profit sync
 *    (`syncObligationCovered`): `covered_amount = legacy_covered_amount + Σ
 *    active PAYMENT / NETTING / WAIVE / DISCOUNT coverage` on obligation
 *    heads (D6, owner decision 2026-10-26: a row cleared by netting is
 *    earned at that settlement; RELIEF never counts);
 *  - the old balance-based settle's coverage (`applyLegacyPathCoverage`),
 *    exact undo (`planReversal` / `applyReversal`) and the bounded
 *    newest-first give-back for settlements from before v225.
 *
 * Every query filters `tenant_id`. Shop days come from `localDayExpr`
 * (rule 27); money runs in minor units inside the pure helpers.
 */
import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { requestNow } from "../utils/requestNow.js";
import { localDayExpr } from "./reportingTimeFragments.js";
import {
  partnerObligationCoverableSql,
  partnerObligationHeadRowSql,
} from "../constants/partnerObligation.js";
import {
  buildPartnerSettleUnits,
  isPartnerUnitOpen,
  partnerCoverSide,
  partnerCoverageEffect,
  partnerUnitScope,
  type PartnerCurrency,
  type PartnerSettleUnit,
  type PartnerSide,
  type PartnerUnitCoverage,
  type PartnerUnitLedgerRow,
} from "../utils/partnerSettleUnits.js";
import {
  allocateAccountSettlement,
  type AccountSettleAllocResult,
  type AccountSettleAllocRow,
} from "../utils/accountSettleAllocation.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import {
  buildPartnerEntryDetails,
  getPartnerRepository,
  type PartnerLedgerEntry,
} from "./PartnerRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { paymentMethodToDrawerName } from "../utils/payments.js";
import {
  applyDrawerDelta,
  cashierRateStamp,
  insertPaymentRow,
} from "./moneyPosting.js";
import { buildPaymentSnapshot } from "../utils/paymentSnapshot.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import {
  partnerSettlementMethod,
  partnerSettlementNet,
  type PartnerSettleDaysInput,
} from "../validators/partner.js";

// =============================================================================
// Types
// =============================================================================

export type PartnerCoverageSource =
  | "PAYMENT"
  | "NETTING"
  | "WAIVE"
  | "DISCOUNT"
  | "RELIEF";

/**
 * The coverage sources that count as PAID for profit (D6). The ONE list.
 * NETTING counts (owner decision 2026-10-26, LIRA-346 D6 reversed): a For
 * row cleared in a settlement by netting against what the shop owes the
 * partner is earned at that settlement; undoing the settlement reverses the
 * coverage row and the next sync takes it back out. RELIEF (an undo's
 * kept-coverage move onto the undone settlement's own row) never counts.
 */
export const PARTNER_PROFIT_COVERAGE_SOURCES: readonly PartnerCoverageSource[] =
  ["PAYMENT", "NETTING", "WAIVE", "DISCOUNT"];

export interface PartnerCoverageWrite {
  transaction_id: number | null;
  settlement_ledger_id: number;
  partner_ledger_id: number;
  partner_id: number;
  currency: PartnerCurrency;
  side: PartnerSide;
  amount: number;
  source: PartnerCoverageSource;
  closes_row?: boolean;
}

/** One calendar row (generic `SettleDayRow` shape + partner fields). */
export interface PartnerSettleRow {
  kind: "LEDGER";
  /** Head row id: the key for selections and unticked rows. */
  id: number;
  partner_id: number;
  currency: PartnerCurrency;
  transaction_type: string | null;
  direction: PartnerSide;
  reference_table: string | null;
  reference_id: number | null;
  notes: string | null;
  /** The unified transaction of the row's source (label, ↺ ref). */
  source_txn_id: number | null;
  created_at: string;
  shop_day: string;
  /** Signed: + the partner owes the shop. */
  amount_usd: number;
  amount_lbp: number;
  /** Magnitude paid so far. */
  covered_usd: number;
  covered_lbp: number;
  /** Signed; 0 when closed. */
  remaining_usd: number;
  remaining_lbp: number;
  row_scope: "DAY" | "ACCOUNT";
  unit_class: "DAY" | "PAYER";
  relief_origin: "UNDO" | "VOID" | null;
  relief_ref: string | null;
}

export interface PartnerDaySettlement {
  transaction_id: number;
  settled_at: string;
  currency: PartnerCurrency;
  amount: number;
  source: string;
}

export interface PartnerDayDetailRow extends PartnerSettleRow {
  settlements: PartnerDaySettlement[];
  added_after_settlement: boolean;
}

/** What `planReversal` saw before the reversal rows were written. */
export interface PartnerReversalPlan {
  partnerId: number;
  ledgerIds: number[];
  /** Σ legacy attributed per currency and settlement side (pre-v225). */
  legacy: Array<{
    currency: PartnerCurrency;
    direction: PartnerSide;
    budget: number;
  }>;
}

const EPS: Record<PartnerCurrency, number> = { USD: 0.005, LBP: 0.5 };
const round = (x: number, c: PartnerCurrency): number =>
  c === "USD" ? Math.round(x * 100) / 100 : Math.round(x);
const ID_BATCH = 400;
function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// =============================================================================
// Repository
// =============================================================================

export class PartnerSettlementRepository extends BaseRepository<{
  id: number;
}> {
  constructor() {
    super("partner_settlement_coverage", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, tenant_id, transaction_id, settlement_ledger_id, partner_ledger_id, partner_id, currency, side, amount, source, closes_row, is_reversed, created_at, updated_at";
  }

  /** v225 present (hand-rolled jest fixtures predate it). Not cached:
   *  fixtures swap databases between tests. */
  hasCoverageTable(): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_settlement_coverage'`,
      )
      .get();
  }

  private _hasLegacyColumn(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(partner_ledger)`)
      .all() as Array<{ name: string }>;
    return cols.some((c) => c.name === "legacy_covered_amount");
  }

  private _requireSchema(): void {
    if (!this.hasCoverageTable() || !this._hasLegacyColumn()) {
      throw new DatabaseError(
        "Settling partners by day needs a database update. " +
          "(partner_settlement_coverage is missing — migration v225)",
      );
    }
  }

  // ── Loader ────────────────────────────────────────────────────────────────

  /** Every USD / LBP partner_ledger row of the partner, as the units see it. */
  private _loadLedgerRows(
    partnerId: number,
    tenantId: number,
  ): PartnerUnitLedgerRow[] {
    const rows = this.db
      .prepare(
        `SELECT pl.id, pl.partner_id, pl.transaction_type, pl.reference_table, pl.reference_id,
                tx.source_table AS tx_source_table, tx.source_id AS tx_source_id,
                pl.amount, pl.currency, pl.direction, pl.created_at,
                COALESCE(strftime('%Y-%m-%d %H:%M:%S', pl.created_at), pl.created_at) AS sort_at,
                ${localDayExpr("pl.created_at")} AS shop_day,
                CASE WHEN EXISTS (
                  SELECT 1 FROM transactions tp
                   WHERE tp.type = 'PARTNER_PAYMENT' AND tp.source_table = 'partner_ledger'
                     AND tp.source_id = pl.id AND tp.tenant_id = pl.tenant_id
                ) THEN 1 ELSE 0 END AS is_cash_moved,
                CASE WHEN ${partnerObligationHeadRowSql("pl")} THEN 1 ELSE 0 END AS is_obligation_head,
                pl.legacy_covered_amount AS legacy_covered_amount,
                pl.notes,
                CASE
                  WHEN pl.reference_table = 'transactions' THEN pl.reference_id
                  WHEN pl.reference_table IS NOT NULL AND pl.reference_table <> 'partner_ledger' THEN (
                    SELECT MIN(ts.id) FROM transactions ts
                     WHERE ts.source_table = pl.reference_table AND ts.source_id = pl.reference_id
                       AND ts.tenant_id = pl.tenant_id)
                  ELSE (
                    SELECT MIN(ts2.id) FROM transactions ts2
                     WHERE ts2.source_table = 'partner_ledger'
                       AND ts2.source_id = CASE WHEN pl.reference_table = 'partner_ledger'
                                                THEN pl.reference_id ELSE pl.id END
                       AND ts2.tenant_id = pl.tenant_id)
                END AS source_txn_id
           FROM partner_ledger pl
           LEFT JOIN transactions tx
             ON pl.reference_table = 'transactions' AND tx.id = pl.reference_id
            AND tx.tenant_id = pl.tenant_id
          WHERE pl.partner_id = ? AND pl.tenant_id = ? AND pl.currency IN ('USD', 'LBP')
          ORDER BY pl.id`,
      )
      .all(partnerId, tenantId) as Array<
      Omit<PartnerUnitLedgerRow, "is_cash_moved" | "is_obligation_head"> & {
        is_cash_moved: number;
        is_obligation_head: number;
      }
    >;
    return rows.map((r) => ({
      ...r,
      legacy_covered_amount: r.legacy_covered_amount ?? 0,
      is_cash_moved: r.is_cash_moved === 1,
      is_obligation_head: r.is_obligation_head === 1,
    }));
  }

  /** Every unit of the partner (all days, open and closed). */
  loadUnits(partnerId: number): PartnerSettleUnit[] {
    this._requireSchema();
    const tenantId = getCurrentTenantId();
    const rows = this._loadLedgerRows(partnerId, tenantId);
    const coverage = this.db
      .prepare(
        `SELECT partner_ledger_id, currency, side, SUM(amount) AS amount
           FROM partner_settlement_coverage
          WHERE tenant_id = ? AND partner_id = ? AND is_reversed = 0
          GROUP BY partner_ledger_id, currency, side`,
      )
      .all(tenantId, partnerId) as PartnerUnitCoverage[];
    const payers = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT settlement_ledger_id AS id FROM partner_settlement_coverage
              WHERE tenant_id = ? AND partner_id = ?`,
          )
          .all(tenantId, partnerId) as Array<{ id: number }>
      ).map((r) => r.id),
    );
    // A payer that only received coverage (another settlement used its
    // credit) also wrote nothing itself; only `settlement_ledger_id` counts.
    return buildPartnerSettleUnits(rows, coverage, payers);
  }

  // ── Calendar reads ────────────────────────────────────────────────────────

  /** The rows a unit shows as (one, or two when a DAY unit flipped). */
  static rowsOfUnit(u: PartnerSettleUnit): PartnerSettleRow[] {
    const pair = (v: number): { usd: number; lbp: number } =>
      u.currency === "USD" ? { usd: v, lbp: 0 } : { usd: 0, lbp: v };
    const absNet = Math.abs(u.net);
    const base = {
      kind: "LEDGER" as const,
      id: u.id,
      partner_id: u.partner_id,
      currency: u.currency,
      transaction_type: u.transaction_type,
      direction: u.direction,
      reference_table: u.reference_table,
      reference_id: u.reference_id,
      notes: u.notes,
      source_txn_id: u.source_txn_id,
      created_at: u.created_at,
      unit_class: u.unit_class,
    };
    const build = (
      scope: "DAY" | "ACCOUNT",
      day: string,
      amount: number,
      covered: number,
      remaining: number,
      origin: "UNDO" | "VOID" | null,
    ): PartnerSettleRow => {
      const a = pair(amount);
      const c = pair(round(Math.max(0, covered), u.currency));
      const r = pair(remaining);
      return {
        ...base,
        shop_day: day,
        amount_usd: a.usd,
        amount_lbp: a.lbp,
        covered_usd: c.usd,
        covered_lbp: c.lbp,
        remaining_usd: r.usd,
        remaining_lbp: r.lbp,
        row_scope: scope,
        relief_origin: origin,
        relief_ref: origin && u.source_txn_id ? `#${u.source_txn_id}` : null,
      };
    };
    const reliefDay = u.last_reversal_day ?? u.shop_day;
    if (u.unit_class === "DAY") {
      if (!u.flipped) {
        return [
          build(
            "DAY",
            u.shop_day,
            u.net,
            absNet - Math.abs(u.remaining),
            u.remaining,
            null,
          ),
        ];
      }
      return [
        build("DAY", u.shop_day, u.net, absNet, 0, null),
        build("ACCOUNT", reliefDay, u.remaining, 0, u.remaining, "VOID"),
      ];
    }
    return [
      build(
        "ACCOUNT",
        u.flipped ? reliefDay : u.shop_day,
        u.net,
        u.flipped ? absNet : absNet - Math.abs(u.remaining),
        u.remaining,
        u.flipped ? "UNDO" : null,
      ),
    ];
  }

  /** The settle queue: open DAY rows (any day) + open ACCOUNT rows. */
  getOpenRows(partnerId: number): PartnerSettleRow[] {
    try {
      return this.loadUnits(partnerId)
        .filter(isPartnerUnitOpen)
        .flatMap((u) => PartnerSettlementRepository.rowsOfUnit(u))
        .filter((r) => r.remaining_usd !== 0 || r.remaining_lbp !== 0);
    } catch (e) {
      throw new DatabaseError("Failed to get partner open rows", {
        cause: e,
        entityId: partnerId,
      });
    }
  }

  /** One month (`YYYY-MM`) of the calendar: every DAY row whose shop day is
   *  in it (open or closed) and the open ↺ account rows dated in it. */
  getMonthRows(partnerId: number, month: string): PartnerSettleRow[] {
    try {
      return this.loadUnits(partnerId)
        .flatMap((u) => PartnerSettlementRepository.rowsOfUnit(u))
        .filter((r) =>
          r.row_scope === "DAY"
            ? r.shop_day.startsWith(`${month}-`)
            : r.relief_origin !== null &&
              r.shop_day.startsWith(`${month}-`) &&
              (r.remaining_usd !== 0 || r.remaining_lbp !== 0),
        );
    } catch (e) {
      throw new DatabaseError("Failed to get partner month rows", {
        cause: e,
        entityId: partnerId,
      });
    }
  }

  /** What is behind one shop day: its DAY rows with the settlements that
   *  paid them (active coverage) and the "added after settlement" tag. */
  getDayDetail(partnerId: number, day: string): PartnerDayDetailRow[] {
    try {
      const units = this.loadUnits(partnerId).filter(
        (u) => u.unit_class === "DAY",
      );
      const rows = units
        .flatMap((u) => PartnerSettlementRepository.rowsOfUnit(u))
        .filter((r) => r.row_scope === "DAY" && r.shop_day === day);
      const members = new Map<number, number>(); // member id → head id
      for (const u of units) for (const m of u.member_ids) members.set(m, u.id);
      const ids = rows.flatMap(
        (r) => units.find((u) => u.id === r.id)?.member_ids ?? [],
      );
      const byHead = new Map<number, PartnerDaySettlement[]>();
      const tenantId = getCurrentTenantId();
      for (const part of chunk(ids, ID_BATCH)) {
        if (part.length === 0) continue;
        const found = this.db
          .prepare(
            `SELECT c.partner_ledger_id, c.transaction_id, c.currency, c.source,
                    SUM(c.amount) AS amount,
                    COALESCE((SELECT t.created_at FROM transactions t
                               WHERE t.id = c.transaction_id AND t.tenant_id = c.tenant_id),
                             MIN(c.created_at)) AS settled_at
               FROM partner_settlement_coverage c
              WHERE c.tenant_id = ? AND c.is_reversed = 0 AND c.transaction_id IS NOT NULL
                AND c.partner_ledger_id IN (${part.map(() => "?").join(", ")})
              GROUP BY c.partner_ledger_id, c.transaction_id, c.currency, c.source
              ORDER BY c.transaction_id, MIN(c.id)`,
          )
          .all(tenantId, ...part) as Array<{
          partner_ledger_id: number;
          transaction_id: number;
          currency: PartnerCurrency;
          source: string;
          amount: number;
          settled_at: string;
        }>;
        for (const f of found) {
          const head = members.get(f.partner_ledger_id) ?? f.partner_ledger_id;
          const list = byHead.get(head) ?? [];
          list.push({
            transaction_id: f.transaction_id,
            settled_at: f.settled_at,
            currency: f.currency,
            amount: f.amount,
            source: f.source,
          });
          byHead.set(head, list);
        }
      }
      const detail: PartnerDayDetailRow[] = rows.map((r) => ({
        ...r,
        settlements: byHead.get(r.id) ?? [],
        added_after_settlement: false,
      }));
      // Ids only grow in insert order: an open row whose own transaction is
      // newer than a settlement that paid ANOTHER row of the day was
      // recorded after that settlement (LIRA-343 R7).
      for (const row of detail) {
        const open = row.remaining_usd !== 0 || row.remaining_lbp !== 0;
        if (!open || row.source_txn_id === null) continue;
        const txn = row.source_txn_id;
        row.added_after_settlement = detail.some(
          (o) => o !== row && o.settlements.some((s) => s.transaction_id < txn),
        );
      }
      return detail;
    } catch (e) {
      throw new DatabaseError("Failed to get partner day detail", {
        cause: e,
        entityId: partnerId,
      });
    }
  }

  // ── The ONE coverage writer + profit sync ─────────────────────────────────

  /** Insert coverage rows (amounts ≤ eps are skipped), then re-sync the
   *  profit stamp of every obligation head they touch. */
  writeCoverage(entries: readonly PartnerCoverageWrite[]): void {
    const tenantId = getCurrentTenantId();
    const ins = this.db.prepare(
      `INSERT INTO partner_settlement_coverage
         (tenant_id, transaction_id, settlement_ledger_id, partner_ledger_id, partner_id,
          currency, side, amount, source, closes_row, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = requestNow();
    const touched = new Map<number, Set<number>>();
    for (const e of entries) {
      const amount = round(e.amount, e.currency);
      if (amount <= EPS[e.currency]) continue;
      ins.run(
        tenantId,
        e.transaction_id,
        e.settlement_ledger_id,
        e.partner_ledger_id,
        e.partner_id,
        e.currency,
        e.side,
        amount,
        e.source,
        e.closes_row ? 1 : 0,
        now,
        now,
      );
      const set = touched.get(e.partner_id) ?? new Set<number>();
      set.add(e.partner_ledger_id);
      touched.set(e.partner_id, set);
    }
    for (const [partnerId, ids] of touched)
      this.syncObligationCovered(partnerId, ids);
  }

  /** Stamp the settlement transaction on coverage written before it existed. */
  linkTransaction(settlementLedgerId: number, transactionId: number): void {
    if (!this.hasCoverageTable()) return;
    this.db
      .prepare(
        `UPDATE partner_settlement_coverage SET transaction_id = ?, updated_at = ?
          WHERE tenant_id = ? AND settlement_ledger_id = ? AND transaction_id IS NULL`,
      )
      .run(
        transactionId,
        requestNow(),
        getCurrentTenantId(),
        settlementLedgerId,
      );
  }

  /**
   * D6 — the ONE profit writer. For each unit containing a touched row:
   * C = Σ active PAYMENT / NETTING / WAIVE / DISCOUNT coverage
   * (`PARTNER_PROFIT_COVERAGE_SOURCES`) on its rows, signed
   * toward the head's side; shared oldest first over its obligation heads
   * up to (coverable − legacy) each, the rest on the last head; then
   * `covered_amount = max(0, legacy_covered_amount + share)`.
   */
  syncObligationCovered(partnerId: number, rowIds: ReadonlySet<number>): void {
    if (rowIds.size === 0) return;
    const tenantId = getCurrentTenantId();
    const units = this.loadUnits(partnerId).filter(
      (u) => u.has_obligation_head && u.member_ids.some((m) => rowIds.has(m)),
    );
    const marks = PARTNER_PROFIT_COVERAGE_SOURCES.map(() => "?").join(", ");
    const upd = this.db.prepare(
      `UPDATE partner_ledger SET covered_amount = ? WHERE id = ? AND tenant_id = ?`,
    );
    for (const u of units) {
      const idMarks = u.member_ids.map(() => "?").join(", ");
      const heads = this.db
        .prepare(
          `SELECT pl_h.id, pl_h.legacy_covered_amount AS legacy,
                  ${partnerObligationCoverableSql("pl_h")} AS coverable
             FROM partner_ledger pl_h
            WHERE pl_h.tenant_id = ? AND pl_h.id IN (${idMarks})
              AND ${partnerObligationHeadRowSql("pl_h")}
            ORDER BY pl_h.id`,
        )
        .all(tenantId, ...u.member_ids) as Array<{
        id: number;
        legacy: number;
        coverable: number;
      }>;
      if (heads.length === 0) continue;
      const sum = this.db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN side = ? THEN amount ELSE -amount END), 0) AS c
             FROM partner_settlement_coverage
            WHERE tenant_id = ? AND is_reversed = 0 AND source IN (${marks})
              AND partner_ledger_id IN (${idMarks})`,
        )
        .get(
          u.direction,
          tenantId,
          ...PARTNER_PROFIT_COVERAGE_SOURCES,
          ...u.member_ids,
        ) as {
        c: number;
      };
      let left = sum.c;
      heads.forEach((h, i) => {
        const room = Math.max(0, h.coverable - (h.legacy ?? 0));
        const give =
          i === heads.length - 1 ? left : Math.min(Math.max(left, 0), room);
        left -= give;
        upd.run(
          Math.max(0, round((h.legacy ?? 0) + give, u.currency)),
          h.id,
          tenantId,
        );
      });
    }
  }

  // ── Old balance-based settle (D8) ─────────────────────────────────────────

  /**
   * The coverage of the old `partners:settle` path, a bundled / standalone
   * forgive and a cash-moved manual entry: oldest first over the partner's
   * open obligation units on the other side (today's FIFO), written through
   * the ONE writer, plus the payer row's own coverage for what it applied
   * (its leftover stays open as account credit). `transaction_id` is filled
   * by `linkTransaction` once the transaction exists.
   */
  applyLegacyPathCoverage(
    entry: Pick<
      PartnerLedgerEntry,
      "id" | "partner_id" | "currency" | "direction" | "amount"
    >,
    source: "PAYMENT" | "DISCOUNT",
  ): void {
    if (entry.currency !== "USD" && entry.currency !== "LBP") return;
    const currency: PartnerCurrency = entry.currency === "LBP" ? "LBP" : "USD";
    const amount = Math.abs(entry.amount);
    if (amount <= EPS[currency]) return;
    const target: PartnerSide =
      entry.direction === "CREDIT" ? "DEBIT" : "CREDIT";
    const open = this.loadUnits(entry.partner_id)
      .filter(
        (u) =>
          u.unit_class === "DAY" &&
          u.has_obligation_head &&
          u.currency === currency &&
          !u.flipped &&
          isPartnerUnitOpen(u) &&
          partnerCoverSide(u.remaining) === target,
      )
      .sort((a, b) =>
        a.sort_at !== b.sort_at
          ? a.sort_at < b.sort_at
            ? -1
            : 1
          : a.id - b.id,
      );
    const takes = allocateFifo(
      open.map((u) => ({ id: u.id, outstanding: Math.abs(u.remaining) })),
      amount,
      EPS[currency],
    );
    if (takes.length === 0) return;
    const applied = takes.reduce((s, t) => s + t.take, 0);
    this.writeCoverage([
      ...takes.map((t) => ({
        transaction_id: null,
        settlement_ledger_id: entry.id,
        partner_ledger_id: Number(t.id),
        partner_id: entry.partner_id,
        currency,
        side: target,
        amount: t.take,
        source,
      })),
      {
        transaction_id: null,
        settlement_ledger_id: entry.id,
        partner_ledger_id: entry.id,
        partner_id: entry.partner_id,
        currency,
        side: entry.direction,
        amount: applied,
        source,
      },
    ]);
  }

  // ── Undo (D9) ─────────────────────────────────────────────────────────────

  /** Read BEFORE the reversal rows are written: the pre-v225 part to give
   *  back the old way (Σ legacy matched to these payer rows, D7). */
  planReversal(
    partnerId: number,
    ledgerIds: readonly number[],
  ): PartnerReversalPlan {
    const plan: PartnerReversalPlan = {
      partnerId,
      ledgerIds: [...ledgerIds],
      legacy: [],
    };
    if (!this.hasCoverageTable() || !this._hasLegacyColumn()) return plan;
    const ids = new Set(ledgerIds);
    for (const u of this.loadUnits(partnerId)) {
      if (u.legacy_attributed <= EPS[u.currency]) continue;
      if (!u.member_ids.some((m) => ids.has(m))) continue;
      plan.legacy.push({
        currency: u.currency,
        direction: u.direction,
        budget: u.legacy_attributed,
      });
    }
    return plan;
  }

  /**
   * Undo a settlement's coverage exactly (any order). Coverage this
   * settlement wrote on a row that a LATER, still-active settlement also
   * paid is kept, and a RELIEF row owned by the undo moves the same amount
   * onto the settlement's own row in that currency (the later day stays as
   * it was; the account shows the difference). The pre-v225 part found by
   * `planReversal` is given back newest first, as before v225.
   */
  applyReversal(plan: PartnerReversalPlan, reversalTxnId: number | null): void {
    if (!this.hasCoverageTable() || !this._hasLegacyColumn()) return;
    const tenantId = getCurrentTenantId();
    const own = new Set(plan.ledgerIds);
    const idMarks = plan.ledgerIds.map(() => "?").join(", ");
    const rows = plan.ledgerIds.length
      ? (this.db
          .prepare(
            `SELECT id, partner_ledger_id, currency, side, amount, source
               FROM partner_settlement_coverage
              WHERE tenant_id = ? AND is_reversed = 0 AND settlement_ledger_id IN (${idMarks})
              ORDER BY id`,
          )
          .all(tenantId, ...plan.ledgerIds) as Array<{
          id: number;
          partner_ledger_id: number;
          currency: PartnerCurrency;
          side: PartnerSide;
          amount: number;
          source: PartnerCoverageSource;
        }>)
      : [];
    const touched = new Set<number>();
    if (rows.length > 0) {
      const units = this.loadUnits(plan.partnerId);
      const headOf = new Map<number, PartnerSettleUnit>();
      for (const u of units) for (const m of u.member_ids) headOf.set(m, u);
      const later = this.db.prepare(
        `SELECT 1 FROM partner_settlement_coverage
          WHERE tenant_id = ? AND is_reversed = 0 AND id > ?
            AND settlement_ledger_id NOT IN (${idMarks})
            AND partner_ledger_id IN (SELECT value FROM json_each(?))
          LIMIT 1`,
      );
      const keep = new Map<PartnerCurrency, number>();
      const reverse: number[] = [];
      for (const c of rows) {
        const unit = headOf.get(c.partner_ledger_id);
        const isOwn =
          own.has(c.partner_ledger_id) ||
          (unit ? unit.member_ids.some((m) => own.has(m)) : false);
        // Only a DAY row a later settlement also paid stays as it is; a
        // credit this settlement used simply becomes available again.
        const shared =
          !isOwn &&
          unit !== undefined &&
          unit.unit_class === "DAY" &&
          !!later.get(
            tenantId,
            c.id,
            ...plan.ledgerIds,
            JSON.stringify(unit.member_ids),
          );
        if (shared) {
          keep.set(
            c.currency,
            (keep.get(c.currency) ?? 0) +
              partnerCoverageEffect(c.side, c.amount),
          );
        } else {
          reverse.push(c.id);
        }
        touched.add(c.partner_ledger_id);
      }
      // Where the kept part goes: the settlement's own row in that currency.
      const ownRows = this.db
        .prepare(
          `SELECT id, currency, transaction_type FROM partner_ledger
            WHERE tenant_id = ? AND id IN (${idMarks}) ORDER BY id`,
        )
        .all(tenantId, ...plan.ledgerIds) as Array<{
        id: number;
        currency: string;
        transaction_type: string | null;
      }>;
      const relief: PartnerCoverageWrite[] = [];
      for (const [currency, k] of keep) {
        const kRounded = round(k, currency);
        if (Math.abs(kRounded) <= EPS[currency]) continue;
        const target =
          ownRows.find(
            (r) =>
              r.currency === currency && r.transaction_type === "SETTLEMENT",
          ) ?? ownRows.find((r) => r.currency === currency);
        if (!target) {
          // Nothing of this settlement can carry it: reopen instead.
          for (const c of rows) {
            if (c.currency === currency && !reverse.includes(c.id))
              reverse.push(c.id);
          }
          continue;
        }
        relief.push({
          transaction_id: reversalTxnId,
          settlement_ledger_id: plan.ledgerIds[0],
          partner_ledger_id: target.id,
          partner_id: plan.partnerId,
          currency,
          side: kRounded > 0 ? "CREDIT" : "DEBIT",
          amount: Math.abs(kRounded),
          source: "RELIEF",
        });
      }
      const mark = this.db.prepare(
        `UPDATE partner_settlement_coverage SET is_reversed = 1, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
      );
      const now = requestNow();
      for (const id of reverse) mark.run(now, id, tenantId);
      if (relief.length > 0) this.writeCoverage(relief);
    }
    for (const l of plan.legacy) {
      for (const id of this._unwindLegacy(
        plan.partnerId,
        l.currency,
        l.direction,
        l.budget,
      )) {
        touched.add(id);
      }
    }
    this.syncObligationCovered(plan.partnerId, touched);
  }

  /** Pre-v225 give-back: newest first over the other side's obligation
   *  heads, lowering `legacy_covered_amount` only (never table coverage). */
  private _unwindLegacy(
    partnerId: number,
    currency: PartnerCurrency,
    payerDirection: PartnerSide,
    budget: number,
  ): number[] {
    const tenantId = getCurrentTenantId();
    const target: PartnerSide =
      payerDirection === "CREDIT" ? "DEBIT" : "CREDIT";
    const open = this.query<{ id: number; legacy: number }>(
      `SELECT pl_cov.id, pl_cov.legacy_covered_amount AS legacy FROM partner_ledger pl_cov
        WHERE pl_cov.partner_id = ? AND pl_cov.tenant_id = ? AND pl_cov.currency = ?
          AND pl_cov.direction = ?
          AND ${partnerObligationHeadRowSql("pl_cov")}
          AND pl_cov.legacy_covered_amount > 0
        ORDER BY pl_cov.created_at DESC, pl_cov.id DESC`,
      partnerId,
      tenantId,
      currency,
      target,
    );
    const takes = allocateFifo(
      open.map((r) => ({ id: r.id, outstanding: r.legacy })),
      budget,
      EPS[currency],
    );
    const upd = this.db.prepare(
      `UPDATE partner_ledger SET legacy_covered_amount = legacy_covered_amount - ? WHERE id = ? AND tenant_id = ?`,
    );
    for (const t of takes) upd.run(t.take, t.id, tenantId);
    return takes.map((t) => Number(t.id));
  }

  // ── Settle picked days ────────────────────────────────────────────────────

  /**
   * Settle the picked days (contracts mirror LIRA-343
   * `settle-account-days.md`, partner sign D1). One PARTNER_SETTLEMENT
   * transaction; one SETTLEMENT row per currency (the first is the anchor,
   * the second references it); a DISCOUNT row per forgiven currency; the
   * legs' payments and drawer moves; coverage through the ONE writer.
   */
  settleDays(data: PartnerSettleDaysInput & { userId: number }): {
    id: number;
  } {
    this._requireSchema();
    const tenantId = getCurrentTenantId();
    const sections = (["USD", "LBP"] as const).flatMap((currency) => {
      const s = data.per_currency[currency];
      return s ? [{ currency, ...s }] : [];
    });
    if (sections.length === 0) {
      throw new DatabaseError("Enter an amount in at least one currency.");
    }
    const includeAccount = data.include_account_credits === true;
    const creditUsed: Record<PartnerCurrency, number> = {
      USD: Math.abs(data.credit_used?.usd ?? 0),
      LBP: Math.abs(data.credit_used?.lbp ?? 0),
    };
    for (const c of ["USD", "LBP"] as const) {
      if (creditUsed[c] > 0 && !data.per_currency[c]) {
        throw new DatabaseError(
          `Add the ${c} section to use partner credit in ${c}.`,
        );
      }
    }

    const partnerRepo = getPartnerRepository();
    return this.transaction(() => {
      const partner = partnerRepo.getById(data.partnerId);
      if (!partner)
        throw new DatabaseError(`Partner ${data.partnerId} not found`);
      const label = partner.name;

      // ── 1. Scope ─────────────────────────────────────────────────────────
      const units = this.loadUnits(data.partnerId);
      const byId = new Map(units.map((u) => [u.id, u]));
      const scopeDay: PartnerSettleUnit[] = [];
      for (const id of data.selections) {
        const u = byId.get(id);
        if (
          !u ||
          u.unit_class !== "DAY" ||
          partnerUnitScope(u) !== "DAY" ||
          !isPartnerUnitOpen(u)
        ) {
          throw new DatabaseError(
            "A picked row is no longer open — close the sheet and open it again. " +
              `(partner row #${id})`,
          );
        }
        scopeDay.push(u);
      }
      const scopeAccount = includeAccount
        ? units.filter(
            (u) => isPartnerUnitOpen(u) && partnerUnitScope(u) === "ACCOUNT",
          )
        : [];

      // ── 2. Stale check ───────────────────────────────────────────────────
      const owed = { USD: 0, LBP: 0 };
      for (const u of [...scopeDay, ...scopeAccount])
        owed[u.currency] += u.remaining;
      if (
        Math.abs(owed.USD - data.expected_owed.usd) > EPS.USD ||
        Math.abs(owed.LBP - data.expected_owed.lbp) > EPS.LBP
      ) {
        throw new DatabaseError(
          `${label}'s balance changed since you opened this sheet. Check the new amounts. ` +
            `(expected $${data.expected_owed.usd.toFixed(2)} + ${data.expected_owed.lbp} LBP, ` +
            `found $${owed.USD.toFixed(2)} + ${round(owed.LBP, "LBP")} LBP)`,
        );
      }

      // ── 3. Allocate per currency ─────────────────────────────────────────
      const toAlloc = (u: PartnerSettleUnit): AccountSettleAllocRow => ({
        kind: "LEDGER",
        id: u.id,
        member_supplier_id: data.partnerId,
        created_at: u.sort_at,
        remaining: u.remaining,
        commission_model1: false,
        cashout_commission: 0,
      });
      const plans = sections.map((s) => {
        const net = partnerSettlementNet(s.payments);
        if (net < -EPS[s.currency]) {
          throw new DatabaseError(
            `The change handed back is more than what was paid in ${s.currency}.`,
          );
        }
        const paid = s.payer === "PARTNER" ? net : -net;
        const waive = s.forgive?.amount ?? 0;
        const alloc: AccountSettleAllocResult = allocateAccountSettlement({
          currency: s.currency,
          rows: scopeDay.filter((u) => u.currency === s.currency).map(toAlloc),
          paid,
          commission: 0,
          waive,
          eps: EPS[s.currency],
          account_credits: scopeAccount
            .filter((u) => u.currency === s.currency)
            .map(toAlloc),
          credit_used: creditUsed[s.currency],
        });
        if (alloc.credit_used_too_high) {
          throw new DatabaseError(
            `That is more partner credit than can be used in ${s.currency}. ` +
              "Lower the partner credit amount.",
          );
        }
        const waiveTakes = alloc.takes.filter((t) => t.source === "WAIVE");
        const waiveApplied = round(
          waiveTakes.reduce((x, t) => x + t.amount, 0),
          s.currency,
        );
        if (waive > EPS[s.currency] && waiveApplied + EPS[s.currency] < waive) {
          throw new DatabaseError(
            `The forgive is more than the picked days owe in ${s.currency}.`,
          );
        }
        const moneyApplied = round(
          alloc.takes
            .filter((t) => t.source === "PAYMENT")
            .reduce((x, t) => x + t.amount, 0),
          s.currency,
        );
        return {
          section: s,
          net: round(net, s.currency),
          paid,
          alloc,
          waiveApplied,
          moneyApplied,
        };
      });
      const anything = plans.some(
        (p) => p.alloc.takes.length > 0 || p.section.payments.length > 0,
      );
      if (!anything) {
        throw new DatabaseError(
          "There is nothing to settle for the days and amounts entered.",
        );
      }

      // ── 4. Ledger rows ───────────────────────────────────────────────────
      const notes = data.notes?.trim() || undefined;
      const settleRowOf = new Map<PartnerCurrency, PartnerLedgerEntry>();
      let anchor: PartnerLedgerEntry | null = null;
      for (const p of plans) {
        const direction: PartnerSide = p.paid < 0 ? "DEBIT" : "CREDIT";
        const method =
          p.section.payments.length > 0
            ? partnerSettlementMethod(p.section.payments, "CASH")
            : undefined;
        const entry = partnerRepo.addLedgerEntry({
          partner_id: data.partnerId,
          transaction_type: "SETTLEMENT",
          ...(anchor
            ? { reference_table: "partner_ledger", reference_id: anchor.id }
            : {}),
          amount: p.net,
          currency: p.section.currency,
          direction,
          notes: notes ?? `Settled picked days (${p.section.currency})`,
          user_id: data.userId,
          ...(method
            ? {
                settlement_method: method as
                  | "CASH"
                  | "OMT"
                  | "WHISH"
                  | "BINANCE"
                  | "SPLIT",
              }
            : {}),
          skipCoverage: true,
        });
        if (!anchor) anchor = entry;
        settleRowOf.set(p.section.currency, entry);
      }
      if (!anchor) throw new DatabaseError("Settlement aborted: no anchor row");
      const anchorId = anchor.id;

      // ── 5. The ONE PARTNER_SETTLEMENT transaction + legs ─────────────────
      const signedOf = (c: PartnerCurrency): number => {
        const p = plans.find((x) => x.section.currency === c);
        return p ? round(p.paid, c) : 0;
      };
      const allLegs = plans.flatMap((p) =>
        p.section.payments.map((leg) => ({ ...leg, payer: p.section.payer })),
      );
      const firstFlow = plans[0].section.payer === "PARTNER" ? "IN" : "OUT";
      const methodAll = partnerSettlementMethod(
        allLegs,
        allLegs.length ? "CASH" : "LEDGER",
      );
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.PARTNER_SETTLEMENT,
        source_table: "partner_ledger",
        source_id: anchorId,
        details: buildPartnerEntryDetails({
          partnerId: data.partnerId,
          action: "SETTLE",
          notes: notes ?? null,
        }),
        ...(allLegs.length > 0
          ? {
              payment_snapshot: buildPaymentSnapshot({
                flow: firstFlow === "IN" ? "IN" : "PAYOUT",
                payments: allLegs.map((leg) => ({
                  method: leg.method,
                  currency_code:
                    leg.method === "BINANCE" ? "USDT" : leg.currency_code,
                  amount: leg.amount,
                  ...(leg.direction ? { direction: leg.direction } : {}),
                  flow:
                    leg.payer === "PARTNER"
                      ? ("IN" as const)
                      : ("PAYOUT" as const),
                })),
              }),
            }
          : {}),
        user_id: data.userId,
        amount_usd: signedOf("USD"),
        amount_lbp: signedOf("LBP"),
        profit_usd: 0,
        profit_lbp: 0,
        ...cashierRateStamp(data.exchange_rate),
        client_id: null,
        summary: `Partner settlement: picked days — ${label} — ${plans
          .map(
            (p) =>
              `${p.paid >= 0 ? "received" : "paid"} ${Math.abs(p.net)} ${p.section.currency}`,
          )
          .join(" / ")}`,
        metadata_json: {
          partner_id: data.partnerId,
          mode: "DAYS",
          settlement_method: methodAll,
          direction: anchor.direction,
          selections: data.selections,
          expected_owed: data.expected_owed,
          ...(includeAccount
            ? {
                include_account_credits: true,
                credit_used: { usd: creditUsed.USD, lbp: creditUsed.LBP },
              }
            : {}),
          per_currency: Object.fromEntries(
            plans.map((p) => [
              p.section.currency,
              {
                payer: p.section.payer,
                paid: p.net,
                applied: p.moneyApplied,
                extra: p.alloc.extra,
                forgiven: p.waiveApplied,
                credit_applied: p.alloc.account_credit_applied,
                remaining_after: p.alloc.remaining_after,
              },
            ]),
          ),
          counterparty: buildCounterpartyMetadata({
            kind: "partner",
            id: data.partnerId,
            name: label,
            flow: firstFlow,
            method: methodAll,
            ledgerEntryId: anchorId,
          }),
        },
      });
      for (const leg of allLegs) {
        const drawerName = paymentMethodToDrawerName(leg.method);
        const drawerCurrency =
          leg.method === "BINANCE" ? "USDT" : leg.currency_code;
        const flowSigned =
          leg.payer === "PARTNER"
            ? Math.abs(leg.amount)
            : -Math.abs(leg.amount);
        const isChange = leg.direction === "OUT";
        const signed = isChange ? -flowSigned : flowSigned;
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: leg.method,
          drawerName,
          currencyCode: drawerCurrency,
          amount: signed,
          note: isChange
            ? `Change returned (${label})`
            : `Partner settlement (${label})`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: drawerCurrency,
          delta: signed,
          tenantId,
        });
      }

      // ── 6. Forgive rows (+ COUNTERPARTY_DISCOUNT, profit as today) ───────
      const discountRowOf = new Map<PartnerCurrency, PartnerLedgerEntry>();
      for (const p of plans) {
        if (p.waiveApplied <= EPS[p.section.currency]) continue;
        const firstWaive = p.alloc.takes.find((t) => t.source === "WAIVE");
        const coveredUnit = firstWaive ? byId.get(firstWaive.id) : undefined;
        // Forgiving what the partner owes is a CREDIT (like a settlement the
        // partner pays); forgiving what the shop owes is a DEBIT.
        const direction: PartnerSide =
          coveredUnit && coveredUnit.remaining < 0 ? "DEBIT" : "CREDIT";
        const entry = partnerRepo.addLedgerEntry({
          partner_id: data.partnerId,
          transaction_type: "DISCOUNT",
          reference_table: "partner_ledger",
          reference_id: anchorId,
          amount: p.waiveApplied,
          currency: p.section.currency,
          direction,
          notes: p.section.forgive?.reason ?? notes,
          user_id: data.userId,
          skipCoverage: true,
        });
        partnerRepo.recordDiscount(
          entry,
          data.userId,
          p.section.forgive?.reason ?? null,
        );
        discountRowOf.set(p.section.currency, entry);
      }

      // ── 7. Coverage through the ONE writer ───────────────────────────────
      const writes: PartnerCoverageWrite[] = [];
      for (const p of plans) {
        const c = p.section.currency;
        for (const t of p.alloc.takes) {
          const u = byId.get(t.id);
          if (!u) continue;
          writes.push({
            transaction_id: txnId,
            settlement_ledger_id: anchorId,
            partner_ledger_id: u.id,
            partner_id: data.partnerId,
            currency: c,
            side: partnerCoverSide(u.remaining),
            amount: t.amount,
            source:
              t.source === "WAIVE"
                ? "WAIVE"
                : t.source === "NETTING"
                  ? "NETTING"
                  : "PAYMENT",
            closes_row: p.alloc.closed.some((r) => r.id === u.id),
          });
        }
        const own = settleRowOf.get(c);
        if (own && p.moneyApplied > EPS[c]) {
          writes.push({
            transaction_id: txnId,
            settlement_ledger_id: anchorId,
            partner_ledger_id: own.id,
            partner_id: data.partnerId,
            currency: c,
            side: own.direction,
            amount: p.moneyApplied,
            source: "PAYMENT",
          });
        }
        const disc = discountRowOf.get(c);
        if (disc) {
          writes.push({
            transaction_id: txnId,
            settlement_ledger_id: anchorId,
            partner_ledger_id: disc.id,
            partner_id: data.partnerId,
            currency: c,
            side: disc.direction,
            amount: p.waiveApplied,
            source: "DISCOUNT",
            closes_row: true,
          });
        }
      }
      this.writeCoverage(writes);
      return { id: txnId };
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: PartnerSettlementRepository | null = null;

export function getPartnerSettlementRepository(): PartnerSettlementRepository {
  if (!instance) instance = new PartnerSettlementRepository();
  return instance;
}

export function resetPartnerSettlementRepository(): void {
  instance = null;
}
