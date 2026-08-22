/**
 * Exchange Lot Repository — cost-basis lot tracking for exotic-currency
 * (non-USD, non-LBP) exchange positions.
 *
 * Phase 2 of EXCHANGE_LOT_SETTLEMENT.md: the FIFO engine over the three
 * tables Phase 1 (migration v156) created — `exchange_lots`,
 * `exchange_lot_settlements`, `exchange_position_adjustments`. This
 * repository is a standalone engine: it does NOT call
 * `getTransactionRepository()`, post payments, or touch drawers — it is a
 * pure cost-basis decomposition of whatever `ExchangeRepository` already
 * moves (rule 13's "item 14" — lots are not a second obligation ledger,
 * they are a lens on the existing General-drawer balance). Phase 3 wires
 * this repository into `ExchangeRepository.createTransaction`'s existing
 * `db.transaction` and into the void/refund reversal paths — none of that
 * happens here.
 *
 * Every method that reads/writes `exchange_lots` or
 * `exchange_lot_settlements` is scoped to the current tenant
 * (`getCurrentTenantId()`); no method opens its own `db.transaction()`
 * except `adjust()`, which is a standalone write path with no outer caller
 * transaction to join.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { isLotTrackedCurrency, LOT_QTY_EPSILON } from "../constants/index.js";
import { exchangeLogger } from "../utils/logger.js";

// =============================================================================
// Entity Types
// =============================================================================

export type LotSourceType = "EXCHANGE_BUY" | "DRAWER_TOPUP" | "ADJUSTMENT";
export type LotBasisSource = "LOT" | "MARKET";

export interface ExchangeLotEntity {
  id: number;
  tenant_id: number | null;
  currency_code: string;
  drawer_name: string;
  source_type: LotSourceType;
  source_table: string | null;
  source_id: number | null;
  original_qty: number;
  remaining_qty: number;
  unit_cost_usd: number;
  acquired_at: string;
  is_voided: number;
  created_at: string;
  updated_at: string;
}

export interface ExchangeLotSettlementEntity {
  id: number;
  tenant_id: number | null;
  lot_id: number | null;
  basis_source: LotBasisSource;
  settled_by_table: string;
  settled_by_id: number;
  qty: number;
  unit_cost_usd: number;
  unit_proceeds_usd: number;
  profit_usd: number;
  is_refunded: number;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A settlement row joined with its lot's provenance — feeds the sell-side
 *  history breakdown (`getSettlementsBySettler`). MARKET rows (no lot) carry
 *  null lot fields. */
export interface LotSettlementWithLot extends ExchangeLotSettlementEntity {
  lot_acquired_at: string | null;
  lot_source_table: string | null;
  lot_source_id: number | null;
}

export interface ExchangePositionAdjustmentEntity {
  id: number;
  tenant_id: number | null;
  currency_code: string;
  qty: number;
  unit_cost_usd: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Method Input/Output Types
// =============================================================================

export interface CreateLotInput {
  currencyCode: string;
  drawerName?: string;
  sourceType: LotSourceType;
  sourceTable: string;
  sourceId: number;
  qty: number;
  unitCostUsd: number;
  /** SQLite `CURRENT_TIMESTAMP` format (`YYYY-MM-DD HH:MM:SS`) — never
   *  `toISOString()` (FEATURE_GUIDE §2). */
  acquiredAt: string;
}

/** One settlement's computed numbers — used for BOTH a persisted row
 *  (`consumeFifo`, `id` populated) and a dry-run preview (`previewConsume`,
 *  `id` always null since nothing was written). Deliberately a narrower
 *  shape than `ExchangeLotSettlementEntity`: callers of `consumeFifo`/
 *  `previewConsume` (the form's live preview, the loss-confirm dialog, the
 *  eventual Phase 3 call site) only ever need the per-lot cost/proceeds/
 *  profit breakdown, never the persistence metadata
 *  (`tenant_id`/`settled_by_*`/`is_refunded`) — that stays on the full
 *  entity, read back via `getSettlementsBySettler`/`getSettlementsAgainstSource`. */
export interface LotSettlementResult {
  id: number | null;
  lot_id: number | null;
  basis_source: LotBasisSource;
  qty: number;
  unit_cost_usd: number;
  unit_proceeds_usd: number;
  profit_usd: number;
}

export interface FifoConsumeResult {
  settlements: LotSettlementResult[];
  /** Exact sum of the rounded per-row `profit_usd` values, itself rounded to
   *  cents to clean up float-addition noise (e.g. 0.10 + 0.20) — never a
   *  re-derivation from the raw qty/rate inputs. */
  realizedProfitUsd: number;
  /** Quantity covered by real lots (basis_source = 'LOT'). */
  coveredQty: number;
  /** Uncovered quantity settled at market basis (Q6) — 0 when fully covered. */
  marketQty: number;
}

export interface ConsumeFifoInput {
  currencyCode: string;
  /** Quantity of `currencyCode` being disbursed — must be > 0. */
  qty: number;
  /** USD proceeds per unit realized on this consumption (the executed sell
   *  rate's USD value per unit of the exotic currency). */
  unitProceedsUsd: number;
  settledByTable: string;
  settledById: number;
  /** Basis for the Q6 uncovered-oversell slice — that day's stamped market
   *  rate, USD-normalized. */
  marketUnitCostUsd: number;
}

export type PreviewConsumeInput = Omit<
  ConsumeFifoInput,
  "settledByTable" | "settledById"
>;

export interface RestoreSettlementsInput {
  settledByTable: string;
  settledById: number;
}

export interface VoidLotsBySourceInput {
  sourceTable: string;
  sourceId: number;
}

export interface HasActiveSettlementsAgainstSourceInput {
  sourceTable: string;
  sourceId: number;
}

export interface LotPosition {
  currency_code: string;
  open_qty: number;
  /** Weighted by each open lot's `remaining_qty` (not `original_qty` — a
   *  partially-settled lot contributes only its unsold remainder to the
   *  average, matching what the position actually represents). */
  avg_unit_cost_usd: number;
  lot_count: number;
}

export interface SettlerSummary {
  /** ACTIVE-settlement qty only — a refunded settlement no longer
   *  represents quantity this settler actually consumed (its lot got the
   *  quantity back via `restoreSettlements`). */
  settled_qty: number;
  /** ACTIVE settlements only. */
  realized_profit_usd: number;
}

export interface SourceSummary extends SettlerSummary {
  /** Sum of `original_qty` across the lot(s) this source created (normally
   *  exactly one — every source type creates a single lot). */
  original_qty: number;
  /** Sum of `remaining_qty` — already reflects any `restoreSettlements()`
   *  credit-back, so `original_qty - remaining_qty` always equals the
   *  ACTIVE `settled_qty` above. */
  remaining_qty: number;
  /** 1 if ANY lot from this source is voided. */
  is_voided: number;
}

export interface AdjustInput {
  currencyCode: string;
  /** Signed: positive adds to the position, negative writes it off. Never 0. */
  qty: number;
  /** Required (and must be > 0) when `qty > 0`. Ignored for a write-off
   *  (`qty < 0`) — a write-off has no basis of its own, it consumes
   *  existing lots at THEIR cost (see `adjust()` doc). */
  unitCostUsd?: number;
  note?: string;
  createdBy: string;
}

export interface AdjustResult {
  adjustment: ExchangePositionAdjustmentEntity;
  /** Present only for an add (`qty > 0`). */
  lot?: ExchangeLotEntity;
  /** Present only for a write-off (`qty < 0`). */
  consume?: FifoConsumeResult;
}

// =============================================================================
// Named fragments (rule 14 — defined once, never re-typed at a second call site)
// =============================================================================

/**
 * A lot is "open" (eligible for FIFO consumption / counted in positions)
 * when it hasn't been voided and still has more than
 * `LOT_QTY_EPSILON` remaining. The epsilon exists because float
 * subtraction across repeated partial consumptions can leave a lot at
 * e.g. `remaining_qty = 1e-13` instead of exactly 0 — without a tolerance
 * that residue would keep showing up as an "open" lot forever.
 */
const OPEN_LOT_PREDICATE = `is_voided = 0 AND remaining_qty > ${LOT_QTY_EPSILON}`;

/**
 * FIFO scan order. `id ASC` is NOT a cosmetic tiebreak — `acquired_at` is
 * only as precise as its stamped datetime (second-granular, same trap rule
 * 15 documents for `transactions.created_at`), so two lots acquired in the
 * same second would otherwise sort arbitrarily. `id` (insertion order) is
 * the only column guaranteed to reflect true acquisition order for same-
 * second lots.
 */
const FIFO_ORDER = `acquired_at ASC, id ASC`;

/** Round a USD amount to the cent — the only rounding this repository ever
 *  applies to money (quantities are always kept at full float precision). */
function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// =============================================================================
// Repository
// =============================================================================

export class ExchangeLotRepository extends BaseRepository<ExchangeLotEntity> {
  constructor() {
    super("exchange_lots", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "tenant_id",
      "currency_code",
      "drawer_name",
      "source_type",
      "source_table",
      "source_id",
      "original_qty",
      "remaining_qty",
      "unit_cost_usd",
      "acquired_at",
      "is_voided",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Lot creation
  // ---------------------------------------------------------------------------

  /**
   * Insert one lot (`original_qty = remaining_qty = qty`). No own
   * transaction — every caller (Phase 3's `ExchangeRepository`, `adjust()`
   * below) runs this inside a transaction it already owns.
   */
  createLot(input: CreateLotInput): ExchangeLotEntity {
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `INSERT INTO exchange_lots (
           tenant_id, currency_code, drawer_name, source_type, source_table,
           source_id, original_qty, remaining_qty, unit_cost_usd, acquired_at,
           is_voided, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        tenantId,
        input.currencyCode,
        input.drawerName ?? "General",
        input.sourceType,
        input.sourceTable,
        input.sourceId,
        input.qty,
        input.qty,
        input.unitCostUsd,
        input.acquiredAt,
      );

    const lot = this.findById(Number(result.lastInsertRowid));
    if (!lot) {
      // Cannot happen outside a corrupted DB — findById immediately after
      // an own successful INSERT, same tenant. Thrown rather than `!`-
      // asserted so a future refactor that breaks this invariant fails
      // loudly instead of producing a silent `undefined as ExchangeLotEntity`.
      throw new Error("createLot: failed to read back the inserted lot");
    }
    exchangeLogger.info(
      { lotId: lot.id, currencyCode: input.currencyCode, qty: input.qty },
      "Exchange lot created",
    );
    return lot;
  }

  // ---------------------------------------------------------------------------
  // FIFO consumption
  // ---------------------------------------------------------------------------

  /**
   * Consume `qty` of `currencyCode` FIFO across open lots, writing one
   * settlement row per lot touched (frozen `unit_cost_usd` from the lot,
   * `unit_proceeds_usd` from the caller, `profit_usd = qty * (proceeds -
   * cost)` rounded to the cent) and decrementing each lot's
   * `remaining_qty`. Any shortfall (`qty` exceeds total open quantity)
   * writes exactly ONE additional settlement with `lot_id = NULL`,
   * `basis_source = 'MARKET'`, priced at `marketUnitCostUsd` — the Q6
   * uncovered-oversell slice, never blocked. No own transaction — the
   * caller (Phase 3) runs this inside its existing `db.transaction`.
   */
  consumeFifo(input: ConsumeFifoInput): FifoConsumeResult {
    if (!(input.qty > 0)) {
      throw new Error("consumeFifo: qty must be greater than 0");
    }
    return this.walkFifo({
      currencyCode: input.currencyCode,
      qty: input.qty,
      mode: "SETTLE",
      unitProceedsUsd: input.unitProceedsUsd,
      marketUnitCostUsd: input.marketUnitCostUsd,
      settledByTable: input.settledByTable,
      settledById: input.settledById,
      write: true,
    });
  }

  /**
   * Identical math to `consumeFifo`, with ZERO writes — feeds the exchange
   * form's live realized-profit preview and the Q10 loss-confirm dialog
   * before submit. The eventual submit recomputes authoritatively via
   * `consumeFifo` server-side; this never persists anything a caller could
   * mistake for a real settlement.
   */
  previewConsume(input: PreviewConsumeInput): FifoConsumeResult {
    if (!(input.qty > 0)) {
      throw new Error("previewConsume: qty must be greater than 0");
    }
    return this.walkFifo({
      currencyCode: input.currencyCode,
      qty: input.qty,
      mode: "SETTLE",
      unitProceedsUsd: input.unitProceedsUsd,
      marketUnitCostUsd: input.marketUnitCostUsd,
      settledByTable: "",
      settledById: 0,
      write: false,
    });
  }

  /**
   * The ONE FIFO walker (rule 14) — shared by `consumeFifo`/`previewConsume`
   * (`mode: "SETTLE"`) and `adjust()`'s write-off branch
   * (`mode: "WRITE_OFF"`, via the private `writeOffFifo` below). `write`
   * controls persistence independently of `mode`, so `previewConsume` can
   * run the exact same SETTLE-mode math with `write: false`.
   *
   * WRITE_OFF mode settles each lot against ITS OWN `unit_cost_usd` (proceeds
   * := cost), so every write-off settlement's `profit_usd` is exactly 0 — a
   * write-off corrects known physical shrinkage, it is not a sale, and must
   * never manufacture a gain or loss. WRITE_OFF also never emits a MARKET
   * shortfall row: `adjust()` guards the write-off quantity against the open
   * position BEFORE calling this, so any residual left after the loop is
   * float noise below `LOT_QTY_EPSILON`, not a real uncovered slice.
   */
  private walkFifo(params: {
    currencyCode: string;
    qty: number;
    mode: "SETTLE" | "WRITE_OFF";
    /** Required for SETTLE; unused for WRITE_OFF. */
    unitProceedsUsd?: number;
    /** Required for SETTLE; unused for WRITE_OFF. */
    marketUnitCostUsd?: number;
    settledByTable: string;
    settledById: number;
    write: boolean;
  }): FifoConsumeResult {
    const tenantId = getCurrentTenantId();

    const openLots = this.db
      .prepare(
        `SELECT id, remaining_qty, unit_cost_usd FROM exchange_lots
         WHERE tenant_id = ? AND currency_code = ? AND ${OPEN_LOT_PREDICATE}
         ORDER BY ${FIFO_ORDER}`,
      )
      .all(tenantId, params.currencyCode) as {
      id: number;
      remaining_qty: number;
      unit_cost_usd: number;
    }[];

    const insertSettlement = params.write
      ? this.db.prepare(
          `INSERT INTO exchange_lot_settlements (
             tenant_id, lot_id, basis_source, settled_by_table, settled_by_id,
             qty, unit_cost_usd, unit_proceeds_usd, profit_usd, is_refunded,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
      : null;
    const decrementLot = params.write
      ? this.db.prepare(
          `UPDATE exchange_lots SET remaining_qty = remaining_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
      : null;

    const settlements: LotSettlementResult[] = [];
    let remaining = params.qty;
    let coveredQty = 0;

    for (const lot of openLots) {
      if (remaining <= LOT_QTY_EPSILON) break;
      const take = Math.min(remaining, lot.remaining_qty);
      if (take <= LOT_QTY_EPSILON) continue;

      const unitProceeds =
        params.mode === "WRITE_OFF"
          ? lot.unit_cost_usd
          : (params.unitProceedsUsd as number);
      const profit = roundMoney(take * (unitProceeds - lot.unit_cost_usd));

      let id: number | null = null;
      if (params.write) {
        const result = insertSettlement!.run(
          tenantId,
          lot.id,
          "LOT",
          params.settledByTable,
          params.settledById,
          take,
          lot.unit_cost_usd,
          unitProceeds,
          profit,
        );
        id = Number(result.lastInsertRowid);
        decrementLot!.run(take, lot.id);
      }

      settlements.push({
        id,
        lot_id: lot.id,
        basis_source: "LOT",
        qty: take,
        unit_cost_usd: lot.unit_cost_usd,
        unit_proceeds_usd: unitProceeds,
        profit_usd: profit,
      });
      remaining -= take;
      coveredQty += take;
    }

    let marketQty = 0;
    if (params.mode === "SETTLE" && remaining > LOT_QTY_EPSILON) {
      marketQty = remaining;
      const unitProceeds = params.unitProceedsUsd as number;
      const marketCost = params.marketUnitCostUsd as number;
      const profit = roundMoney(marketQty * (unitProceeds - marketCost));

      let id: number | null = null;
      if (params.write) {
        const result = insertSettlement!.run(
          tenantId,
          null,
          "MARKET",
          params.settledByTable,
          params.settledById,
          marketQty,
          marketCost,
          unitProceeds,
          profit,
        );
        id = Number(result.lastInsertRowid);
      }

      settlements.push({
        id,
        lot_id: null,
        basis_source: "MARKET",
        qty: marketQty,
        unit_cost_usd: marketCost,
        unit_proceeds_usd: unitProceeds,
        profit_usd: profit,
      });
    }

    const realizedProfitUsd = roundMoney(
      settlements.reduce((sum, s) => sum + s.profit_usd, 0),
    );

    if (params.write) {
      exchangeLogger.info(
        {
          currencyCode: params.currencyCode,
          mode: params.mode,
          settledByTable: params.settledByTable,
          settledById: params.settledById,
          coveredQty,
          marketQty,
          realizedProfitUsd,
        },
        "Exchange lot FIFO consumption settled",
      );
    }

    return { settlements, realizedProfitUsd, coveredQty, marketQty };
  }

  /** WRITE_OFF-mode consumption for `adjust()`'s negative-qty branch — see
   *  `walkFifo`'s doc for why this is a mode flag on the shared walker
   *  rather than a second copy-pasted loop (rule 14). */
  private writeOffFifo(input: {
    currencyCode: string;
    qty: number;
    settledByTable: string;
    settledById: number;
  }): FifoConsumeResult {
    return this.walkFifo({
      currencyCode: input.currencyCode,
      qty: input.qty,
      mode: "WRITE_OFF",
      settledByTable: input.settledByTable,
      settledById: input.settledById,
      write: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Reversals (Phase 3 calls these from TransactionRepository's void path)
  // ---------------------------------------------------------------------------

  /**
   * Restore every ACTIVE (`is_refunded = 0`) settlement this consumer
   * (`settledByTable`/`settledById`) wrote: credit `qty` back onto its lot
   * (MARKET rows have no lot — skipped, nothing to credit) and flag the
   * settlement `is_refunded = 1` + `refunded_at`. Idempotent: a second call
   * finds no more active rows and restores nothing. No own transaction —
   * the caller (the void/refund reversal path) runs this inside its own.
   */
  restoreSettlements(input: RestoreSettlementsInput): number {
    const tenantId = getCurrentTenantId();
    const activeSettlements = this.db
      .prepare(
        `SELECT id, lot_id, qty FROM exchange_lot_settlements
         WHERE tenant_id = ? AND settled_by_table = ? AND settled_by_id = ? AND is_refunded = 0`,
      )
      .all(tenantId, input.settledByTable, input.settledById) as {
      id: number;
      lot_id: number | null;
      qty: number;
    }[];

    if (activeSettlements.length === 0) return 0;

    const restoreLot = this.db.prepare(
      `UPDATE exchange_lots SET remaining_qty = remaining_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );
    const flagRefunded = this.db.prepare(
      `UPDATE exchange_lot_settlements SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );

    for (const settlement of activeSettlements) {
      if (settlement.lot_id !== null) {
        restoreLot.run(settlement.qty, settlement.lot_id);
      }
      flagRefunded.run(settlement.id);
    }

    exchangeLogger.info(
      {
        settledByTable: input.settledByTable,
        settledById: input.settledById,
        restoredCount: activeSettlements.length,
      },
      "Exchange lot settlements restored",
    );
    return activeSettlements.length;
  }

  /**
   * Void every lot created by `sourceTable`/`sourceId` (sets
   * `is_voided = 1`). The caller (Phase 3's `_assertExchangeLotsVoidable`
   * guard) guarantees no active settlement references these lots before
   * calling — this method does not re-check that itself.
   */
  voidLotsBySource(input: VoidLotsBySourceInput): number {
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `UPDATE exchange_lots SET is_voided = 1, updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ? AND source_table = ? AND source_id = ?`,
      )
      .run(tenantId, input.sourceTable, input.sourceId);

    if (result.changes > 0) {
      exchangeLogger.info(
        { sourceTable: input.sourceTable, sourceId: input.sourceId },
        "Exchange lots voided",
      );
    }
    return result.changes;
  }

  /**
   * True when any ACTIVE (`is_refunded = 0`) settlement consumes a lot
   * created by `sourceTable`/`sourceId` — powers the block-void-of-
   * partially-settled-BUY guard (Q12).
   */
  hasActiveSettlementsAgainstSource(
    input: HasActiveSettlementsAgainstSourceInput,
  ): boolean {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT 1
         FROM exchange_lot_settlements s
         JOIN exchange_lots l ON l.id = s.lot_id AND l.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? AND l.source_table = ? AND l.source_id = ? AND s.is_refunded = 0
         LIMIT 1`,
      )
      .get(tenantId, input.sourceTable, input.sourceId);
    return row !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Per-currency open position: total open quantity, weighted-average unit
   * cost (weighted by each lot's `remaining_qty`), and how many open lots
   * make it up. Powers the Q11/Q16 open-positions panel.
   */
  getPositions(): LotPosition[] {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT
           currency_code,
           SUM(remaining_qty) AS open_qty,
           SUM(remaining_qty * unit_cost_usd) AS weighted_cost,
           COUNT(*) AS lot_count
         FROM exchange_lots
         WHERE tenant_id = ? AND ${OPEN_LOT_PREDICATE}
         GROUP BY currency_code
         ORDER BY currency_code ASC`,
      )
      .all(tenantId) as {
      currency_code: string;
      open_qty: number;
      weighted_cost: number;
      lot_count: number;
    }[];

    return rows.map((row) => ({
      currency_code: row.currency_code,
      open_qty: row.open_qty,
      avg_unit_cost_usd: row.open_qty > 0 ? row.weighted_cost / row.open_qty : 0,
      lot_count: row.lot_count,
    }));
  }

  /**
   * All settlements a given sell/adjustment event wrote, LEFT JOINed to
   * their lot for provenance (`acquired_at`/`source_table`/`source_id`).
   * MARKET rows carry null lot fields. Feeds the history modal's
   * expandable per-row settlement breakdown.
   */
  getSettlementsBySettler(
    settledByTable: string,
    settledById: number,
  ): LotSettlementWithLot[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
           s.id, s.tenant_id, s.lot_id, s.basis_source, s.settled_by_table,
           s.settled_by_id, s.qty, s.unit_cost_usd, s.unit_proceeds_usd,
           s.profit_usd, s.is_refunded, s.refunded_at, s.created_at, s.updated_at,
           l.acquired_at AS lot_acquired_at,
           l.source_table AS lot_source_table,
           l.source_id AS lot_source_id
         FROM exchange_lot_settlements s
         LEFT JOIN exchange_lots l ON l.id = s.lot_id
         WHERE s.tenant_id = ? AND s.settled_by_table = ? AND s.settled_by_id = ?
         ORDER BY s.id ASC`,
      )
      .all(tenantId, settledByTable, settledById) as LotSettlementWithLot[];
  }

  /**
   * All settlements (active + refunded) consuming the lot(s) a given BUY
   * created — feeds that buy row's own history breakdown (how it has been
   * sold down over time).
   */
  getSettlementsAgainstSource(
    sourceTable: string,
    sourceId: number,
  ): ExchangeLotSettlementEntity[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
           s.id, s.tenant_id, s.lot_id, s.basis_source, s.settled_by_table,
           s.settled_by_id, s.qty, s.unit_cost_usd, s.unit_proceeds_usd,
           s.profit_usd, s.is_refunded, s.refunded_at, s.created_at, s.updated_at
         FROM exchange_lot_settlements s
         JOIN exchange_lots l ON l.id = s.lot_id AND l.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? AND l.source_table = ? AND l.source_id = ?
         ORDER BY s.id ASC`,
      )
      .all(tenantId, sourceTable, sourceId) as ExchangeLotSettlementEntity[];
  }

  /**
   * Batched per-settler aggregates (ACTIVE settlements only, both fields —
   * a refunded settlement no longer represents quantity this settler
   * consumed) for the history list. `ids.length === 0` short-circuits to
   * `{}` with no query. Refunded rows are excluded from the WHERE clause
   * itself (not zeroed via a `CASE` inside `SUM`) so a settler whose
   * settlements were ALL refunded produces no group at all — the caller
   * gets `undefined` for that id, not a misleading `{settled_qty: 0, ...}`
   * that looks identical to "never settled".
   */
  getSummaryForSettlers(
    table: string,
    ids: number[],
  ): Record<number, SettlerSummary> {
    if (ids.length === 0) return {};
    const tenantId = getCurrentTenantId();
    const placeholders = ids.map(() => "?").join(", ");

    const rows = this.db
      .prepare(
        `SELECT
           settled_by_id AS id,
           SUM(qty) AS settled_qty,
           SUM(profit_usd) AS realized_profit_usd
         FROM exchange_lot_settlements
         WHERE tenant_id = ? AND settled_by_table = ? AND settled_by_id IN (${placeholders}) AND is_refunded = 0
         GROUP BY settled_by_id`,
      )
      .all(tenantId, table, ...ids) as {
      id: number;
      settled_qty: number;
      realized_profit_usd: number;
    }[];

    const out: Record<number, SettlerSummary> = {};
    for (const row of rows) {
      out[row.id] = {
        settled_qty: row.settled_qty,
        realized_profit_usd: row.realized_profit_usd,
      };
    }
    return out;
  }

  /**
   * Batched per-source aggregates for the buy-side history list: settled
   * qty + realized profit (ACTIVE only, same reasoning as
   * `getSummaryForSettlers`) PLUS the lot's own `original_qty`/
   * `remaining_qty`/`is_voided` so the caller can derive an Open/Partial/
   * Settled/Voided status without a second round trip. `ids.length === 0`
   * short-circuits to `{}`.
   */
  getSummaryForSources(
    table: string,
    ids: number[],
  ): Record<number, SourceSummary> {
    if (ids.length === 0) return {};
    const tenantId = getCurrentTenantId();
    const placeholders = ids.map(() => "?").join(", ");

    // Lot facts. SUM/MAX guard against a hypothetical future 1:many
    // source->lot relationship; every current source type creates exactly
    // one lot.
    const lotRows = this.db
      .prepare(
        `SELECT
           source_id AS id,
           SUM(original_qty) AS original_qty,
           SUM(remaining_qty) AS remaining_qty,
           MAX(is_voided) AS is_voided
         FROM exchange_lots
         WHERE tenant_id = ? AND source_table = ? AND source_id IN (${placeholders})
         GROUP BY source_id`,
      )
      .all(tenantId, table, ...ids) as {
      id: number;
      original_qty: number;
      remaining_qty: number;
      is_voided: number;
    }[];

    // Refunded settlements are excluded via WHERE (not zeroed via a `CASE`
    // inside SUM) — see `getSummaryForSettlers`' doc for why. Here it's
    // harmless either way (a source's `remaining_qty`/`is_voided` from the
    // lotRows pass above already stand on their own), but keeping BOTH
    // aggregate queries in this class shaped the same way (rule 14) avoids
    // a silent behavioral drift if this method is ever queried standalone.
    const settlementRows = this.db
      .prepare(
        `SELECT
           l.source_id AS id,
           SUM(s.qty) AS settled_qty,
           SUM(s.profit_usd) AS realized_profit_usd
         FROM exchange_lot_settlements s
         JOIN exchange_lots l ON l.id = s.lot_id AND l.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? AND l.source_table = ? AND l.source_id IN (${placeholders}) AND s.is_refunded = 0
         GROUP BY l.source_id`,
      )
      .all(tenantId, table, ...ids) as {
      id: number;
      settled_qty: number;
      realized_profit_usd: number;
    }[];

    const out: Record<number, SourceSummary> = {};
    for (const row of lotRows) {
      out[row.id] = {
        original_qty: row.original_qty,
        remaining_qty: row.remaining_qty,
        is_voided: row.is_voided,
        settled_qty: 0,
        realized_profit_usd: 0,
      };
    }
    for (const row of settlementRows) {
      // Defensive: a settlement always joins a lot from this same source, so
      // `out[row.id]` is always already populated by the lotRows pass above.
      if (!out[row.id]) continue;
      out[row.id].settled_qty = row.settled_qty;
      out[row.id].realized_profit_usd = row.realized_profit_usd;
    }
    return out;
  }

  private getOpenQtyForCurrency(currencyCode: string, tenantId: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(remaining_qty), 0) AS open_qty
         FROM exchange_lots
         WHERE tenant_id = ? AND currency_code = ? AND ${OPEN_LOT_PREDICATE}`,
      )
      .get(tenantId, currencyCode) as { open_qty: number };
    return row.open_qty;
  }

  private now(): string {
    return (
      this.db.prepare(`SELECT CURRENT_TIMESTAMP AS ts`).get() as { ts: string }
    ).ts;
  }

  // ---------------------------------------------------------------------------
  // Admin position adjustment (Q15)
  // ---------------------------------------------------------------------------

  /**
   * Admin-only manual position adjustment (drift correction) — Q15. Moves
   * no money (no drawer delta, no unified transaction row: rule 20 does not
   * attach — see the migration's comment) and rejects lot-exempt currencies
   * (USD/LBP have no lots to adjust).
   *
   * `qty > 0` (add): inserts the adjustment row, then creates a new
   * ADJUSTMENT-source lot at the stated `unitCostUsd` (required, must be
   * > 0) — establishing a basis with no prior sale.
   *
   * `qty < 0` (write-off): THROWS if `|qty|` exceeds the currency's total
   * open quantity — a write-off corrects KNOWN physical state, so
   * fabricating an uncovered MARKET slice (as a real oversell sale would)
   * makes no sense here. Otherwise inserts the adjustment row (`unit_cost_usd
   * = NULL` — a write-off has no basis of its own) then consumes FIFO in
   * WRITE-OFF mode: each settlement's proceeds equal its own lot's cost, so
   * `profit_usd` is exactly 0 (a shrinkage sync, not a sale).
   *
   * `qty === 0` throws — there is nothing to adjust.
   *
   * Wraps its own transaction: unlike every other write method here, there
   * is no Phase-3 caller transaction to join — this IS the top-level write.
   */
  adjust(input: AdjustInput): AdjustResult {
    if (!isLotTrackedCurrency(input.currencyCode)) {
      throw new Error(
        `Exchange lot adjustments only apply to exotic currencies — ${input.currencyCode} uses the spread model, not lots`,
      );
    }
    if (input.qty === 0) {
      throw new Error(
        "adjust: qty must not be 0 — pass a positive qty to add or a negative qty to write off",
      );
    }

    return this.transaction(() => {
      const tenantId = getCurrentTenantId();

      if (input.qty > 0) {
        if (!(input.unitCostUsd && input.unitCostUsd > 0)) {
          throw new Error(
            "adjust: unitCostUsd must be greater than 0 when adding to a position",
          );
        }

        const adjResult = this.db
          .prepare(
            `INSERT INTO exchange_position_adjustments (
               tenant_id, currency_code, qty, unit_cost_usd, note, created_by,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .run(
            tenantId,
            input.currencyCode,
            input.qty,
            input.unitCostUsd,
            input.note ?? null,
            input.createdBy,
          );
        const adjustment = this.getAdjustmentById(
          Number(adjResult.lastInsertRowid),
          tenantId,
        );

        const lot = this.createLot({
          currencyCode: input.currencyCode,
          sourceType: "ADJUSTMENT",
          sourceTable: "exchange_position_adjustments",
          sourceId: adjustment.id,
          qty: input.qty,
          unitCostUsd: input.unitCostUsd,
          acquiredAt: this.now(),
        });

        exchangeLogger.info(
          {
            adjustmentId: adjustment.id,
            currencyCode: input.currencyCode,
            qty: input.qty,
          },
          "Exchange position adjustment: added to position",
        );
        return { adjustment, lot };
      }

      // Write-off: qty < 0.
      const writeOffQty = Math.abs(input.qty);
      const openQty = this.getOpenQtyForCurrency(input.currencyCode, tenantId);
      if (writeOffQty > openQty + LOT_QTY_EPSILON) {
        throw new Error(
          `adjust: cannot write off ${writeOffQty} ${input.currencyCode} — only ${openQty} is open`,
        );
      }

      const adjResult = this.db
        .prepare(
          `INSERT INTO exchange_position_adjustments (
             tenant_id, currency_code, qty, unit_cost_usd, note, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .run(
          tenantId,
          input.currencyCode,
          input.qty,
          input.note ?? null,
          input.createdBy,
        );
      const adjustment = this.getAdjustmentById(
        Number(adjResult.lastInsertRowid),
        tenantId,
      );

      const consume = this.writeOffFifo({
        currencyCode: input.currencyCode,
        qty: writeOffQty,
        settledByTable: "exchange_position_adjustments",
        settledById: adjustment.id,
      });

      exchangeLogger.info(
        {
          adjustmentId: adjustment.id,
          currencyCode: input.currencyCode,
          qty: input.qty,
        },
        "Exchange position adjustment: written off",
      );
      return { adjustment, consume };
    });
  }

  private getAdjustmentById(
    id: number,
    tenantId: number,
  ): ExchangePositionAdjustmentEntity {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id, currency_code, qty, unit_cost_usd, note, created_by, created_at, updated_at
         FROM exchange_position_adjustments
         WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, tenantId) as ExchangePositionAdjustmentEntity | undefined;
    if (!row) {
      throw new Error("adjust: failed to read back the inserted adjustment");
    }
    return row;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeLotRepositoryInstance: ExchangeLotRepository | null = null;

export function getExchangeLotRepository(): ExchangeLotRepository {
  if (!exchangeLotRepositoryInstance) {
    exchangeLotRepositoryInstance = new ExchangeLotRepository();
  }
  return exchangeLotRepositoryInstance;
}

export function resetExchangeLotRepository(): void {
  exchangeLotRepositoryInstance = null;
}
