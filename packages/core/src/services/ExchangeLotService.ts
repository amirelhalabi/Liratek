/**
 * Exchange Lot Service — the read/admin API surface over
 * `ExchangeLotRepository` (EXCHANGE_LOT_SETTLEMENT.md Phase 4a).
 *
 * This service does NOT wire the lot engine into `ExchangeRepository`'s
 * create/void/refund paths (Phase 3, a concurrent change to
 * `ExchangeRepository.ts`/`ExchangeService.ts` — deliberately untouched
 * here). It exposes four read/admin operations, one per Electron IPC
 * channel + REST route:
 *
 *   - `previewSettlement` — FIFO dry-run (Q10): feeds the exchange form's
 *     live realized-profit display and the loss-confirm dialog BEFORE
 *     submit. Resolves `marketUnitCostUsd` server-side (never trusts a
 *     client-sent value) since the client cannot be trusted with the Q6
 *     oversold-slice basis.
 *   - `getPositions` — per-currency open position + Q11 indicative
 *     unrealized P&L (display-only, never touches `ProfitRepository`).
 *   - `getBreakdown` — the history modal's expandable per-row settlement
 *     breakdown (both directions: as a settler and as a settled-against
 *     source).
 *   - `adjustPosition` — Q15 admin-only drift correction.
 */

import {
  getExchangeLotRepository,
  type ExchangeLotRepository,
  type LotPosition,
  type FifoConsumeResult,
  type LotSettlementWithLot,
  type ExchangeLotSettlementEntity,
  type AdjustResult,
} from "../repositories/ExchangeLotRepository.js";
import {
  getRateRepository,
  type RateRepository,
} from "../repositories/RateRepository.js";
import { isLotTrackedCurrency } from "../constants/index.js";
import {
  marketRateToUsdPerUnit,
  crossPairHasUsdAnchor,
} from "../utils/lotMarketRate.js";
import { toErrorString } from "../utils/errors.js";
import { exchangeLogger } from "../utils/logger.js";

// =============================================================================
// Method Input/Output Types
// =============================================================================

export interface PreviewSettlementInput {
  currencyCode: string;
  qty: number;
  unitProceedsUsd: number;
  /**
   * The OTHER leg's currency (the acquire side; `currencyCode` above is
   * always the consume/disburse side). Optional — omitted by any caller that
   * predates this field, which keeps the old USD/LBP-only short-circuit
   * behavior. When provided AND the pair is a CROSS (both sides non-USD)
   * with no USD anchor (adversarial review, FIX 2), the preview mirrors
   * `ExchangeRepository._crossUsdNotional`'s submit-side "skip lot tracking
   * entirely" decision via the shared `crossPairHasUsdAnchor` predicate,
   * instead of showing a realized-profit figure the server would then
   * silently discard.
   */
  fromCurrency?: string;
}

/** The currency has no lot tracking (USD/LBP, Q1) — the form silently skips
 *  the preview/loss-dialog for these instead of erroring. */
export interface NotLotTrackedPreview {
  success: true;
  lotTracked: false;
  /**
   * Set ONLY for the FIX 2 cross-with-no-anchor case (never for the plain
   * USD/LBP short-circuit above) — lets the caller show a specific
   * "configure a rate to enable this" note instead of silently doing
   * nothing.
   */
  reason?: "NO_RATE_ANCHOR";
}

export interface LotTrackedPreview extends FifoConsumeResult {
  success: true;
  lotTracked: true;
  /** The Q6 oversell-basis rate actually used, resolved server-side —
   *  surfaced so the UI can show it, never accepted from the client. */
  marketUnitCostUsd: number;
}

export interface PreviewSettlementFailure {
  success: false;
  error: string;
}

export type PreviewSettlementResult =
  | NotLotTrackedPreview
  | LotTrackedPreview
  | PreviewSettlementFailure;

/** `LotPosition` (open qty / weighted-avg cost) plus the Q11 indicative,
 *  display-only market comparison. Both market fields are `null` when the
 *  currency has no configured `exchange_rates` row — never a fabricated 0,
 *  which would misleadingly plot as "at cost". */
export interface LotPositionWithMarket extends LotPosition {
  current_market_unit_usd: number | null;
  unrealized_profit_usd: number | null;
}

export interface LotBreakdown {
  /** Settlements THIS exchange wrote as a settler (a SELL consuming lots). */
  asSettler: LotSettlementWithLot[];
  /** Settlements consuming the lot(s) THIS exchange created (a BUY sold
   *  down over time). */
  againstSource: ExchangeLotSettlementEntity[];
}

/** Mirrors `AdjustInput` minus `createdBy` — the service (never the
 *  caller/client) attaches the actor, matching rule 19's "inject
 *  userId/actor from the authenticated request, never trust the client". */
export interface AdjustPositionInput {
  currencyCode: string;
  qty: number;
  unitCostUsd?: number;
  note?: string;
}

export type AdjustPositionResult =
  | { success: true; data: AdjustResult }
  | { success: false; error: string };

// =============================================================================
// Service
// =============================================================================

export class ExchangeLotService {
  private repo: ExchangeLotRepository;
  private rateRepo: RateRepository;

  constructor(repo?: ExchangeLotRepository, rateRepo?: RateRepository) {
    this.repo = repo ?? getExchangeLotRepository();
    this.rateRepo = rateRepo ?? getRateRepository();
  }

  /**
   * Resolve the USD-per-unit basis for the Q6 uncovered-oversell slice.
   * `market_rate` (never `buy_rate`/`sell_rate` — the lot engine's cost
   * basis must be the unbiased mid-market price, not the shop's own
   * spread) normalized via `marketRateToUsdPerUnit`. When the currency has
   * no `exchange_rates` row at all, falls back to the executed
   * `unitProceedsUsd` itself — the same fallback Phase 3's repository path
   * uses, which makes the MARKET slice preview exactly 0 profit
   * (proceeds === cost) instead of throwing and blocking the whole preview
   * over a missing rate row.
   */
  private resolveMarketUnitCostUsd(
    currencyCode: string,
    unitProceedsUsdFallback: number,
  ): number {
    const rate = this.rateRepo.findByCode(currencyCode);
    if (!rate) {
      return unitProceedsUsdFallback;
    }
    return marketRateToUsdPerUnit(rate.market_rate, rate.is_stronger);
  }

  /**
   * FIFO dry-run preview (Q10) — zero writes. Non-lot-tracked currencies
   * (USD/LBP) short-circuit to `{ lotTracked: false }` WITHOUT calling the
   * repository at all, rather than throwing — the caller (the exchange
   * form) uses this to silently skip the preview/loss-dialog for USD/LBP
   * legs instead of treating it as an error.
   */
  previewSettlement(input: PreviewSettlementInput): PreviewSettlementResult {
    if (!isLotTrackedCurrency(input.currencyCode)) {
      return { success: true, lotTracked: false };
    }

    // FIX 2 (adversarial review, EXCHANGE_LOT_SETTLEMENT.md): a CROSS pair
    // (both sides non-USD) with no USD anchor skips lot tracking entirely at
    // submit (`ExchangeRepository._crossUsdNotional` returns `null` ->
    // `touched: false`, warn-and-continue). `currencyCode` is already known
    // non-USD/non-LBP here (the guard above), so this pair is a cross
    // whenever `fromCurrency` is also not USD.
    if (
      input.fromCurrency !== undefined &&
      input.fromCurrency !== "USD" &&
      !crossPairHasUsdAnchor(
        input.fromCurrency,
        input.currencyCode,
        (code) => this.rateRepo.findByCode(code) !== null,
      )
    ) {
      return { success: true, lotTracked: false, reason: "NO_RATE_ANCHOR" };
    }

    try {
      const marketUnitCostUsd = this.resolveMarketUnitCostUsd(
        input.currencyCode,
        input.unitProceedsUsd,
      );
      const consumeResult = this.repo.previewConsume({
        currencyCode: input.currencyCode,
        qty: input.qty,
        unitProceedsUsd: input.unitProceedsUsd,
        marketUnitCostUsd,
      });
      return {
        success: true,
        lotTracked: true,
        marketUnitCostUsd,
        ...consumeResult,
      };
    } catch (error) {
      exchangeLogger.error(
        { error, input },
        "ExchangeLotService.previewSettlement failed",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Per-currency open positions plus the Q11 indicative unrealized P&L —
   * display-only, NEVER fed into `ProfitRepository`/the Profits card. A
   * currency with no configured market rate gets `null` for both market
   * fields (not a fabricated 0, which would misleadingly read as
   * "break-even").
   */
  getPositions(): LotPositionWithMarket[] {
    try {
      return this.repo.getPositions().map((position) => {
        const rate = this.rateRepo.findByCode(position.currency_code);
        if (!rate) {
          return {
            ...position,
            current_market_unit_usd: null,
            unrealized_profit_usd: null,
          };
        }
        const currentMarketUnitUsd = marketRateToUsdPerUnit(
          rate.market_rate,
          rate.is_stronger,
        );
        const unrealizedProfitUsd = roundMoney(
          position.open_qty * (currentMarketUnitUsd - position.avg_unit_cost_usd),
        );
        return {
          ...position,
          current_market_unit_usd: currentMarketUnitUsd,
          unrealized_profit_usd: unrealizedProfitUsd,
        };
      });
    } catch (error) {
      exchangeLogger.error({ error }, "ExchangeLotService.getPositions failed");
      return [];
    }
  }

  /**
   * Both directions of settlement history for one exchange transaction —
   * the history modal shows whichever side is non-empty (a row is either a
   * settler or a settled-against source, never both).
   */
  getBreakdown(exchangeId: number): LotBreakdown {
    try {
      return {
        asSettler: this.repo.getSettlementsBySettler(
          "exchange_transactions",
          exchangeId,
        ),
        againstSource: this.repo.getSettlementsAgainstSource(
          "exchange_transactions",
          exchangeId,
        ),
      };
    } catch (error) {
      exchangeLogger.error(
        { error, exchangeId },
        "ExchangeLotService.getBreakdown failed",
      );
      return { asSettler: [], againstSource: [] };
    }
  }

  /**
   * Q15 admin-only manual position adjustment. `createdBy` is supplied by
   * the caller (the IPC handler/REST route, which derives it from the
   * authenticated session/JWT — never from the request payload).
   */
  adjustPosition(
    input: AdjustPositionInput,
    createdBy: string,
  ): AdjustPositionResult {
    try {
      const data = this.repo.adjust({ ...input, createdBy });
      return { success: true, data };
    } catch (error) {
      exchangeLogger.error(
        { error, input, createdBy },
        "ExchangeLotService.adjustPosition failed",
      );
      return { success: false, error: toErrorString(error) };
    }
  }
}

/** Round a USD amount to the cent — same tolerance `ExchangeLotRepository`
 *  applies to every settlement's `profit_usd`; the unrealized figure here is
 *  indicative display math, not a persisted settlement, so it gets its own
 *  small copy rather than importing a private repository helper. */
function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeLotServiceInstance: ExchangeLotService | null = null;

export function getExchangeLotService(): ExchangeLotService {
  if (!exchangeLotServiceInstance) {
    exchangeLotServiceInstance = new ExchangeLotService();
  }
  return exchangeLotServiceInstance;
}

export function resetExchangeLotService(): void {
  exchangeLotServiceInstance = null;
}
