import {
  ClosingRepository,
  DynamicSystemExpectedBalances,
  DailyActivityStats,
  CreateCheckpointData,
  DrawerCheckpointStatus,
  getClosingRepository,
} from "../repositories/ClosingRepository.js";
import { ProfitService, getProfitService } from "./ProfitService.js";
import type { DailyStatsSnapshotQuery } from "../validators/closing.js";
import { closingLogger } from "../utils/logger.js";
import { localDay } from "../utils/localDate.js";
import { clientDay } from "../utils/requestDay.js";
export interface ClosingResult {
  success: boolean;
  id?: number | bigint;
  error?: string;
}

/**
 * LIRA-219 — the pinned closing-profit-parity contract. Composed by
 * `ClosingService.getDailyStatsSnapshot` from two independently-defined
 * sources: `ClosingRepository.getDailyActivityStats` (sales/debt-payments/
 * expenses — no profit SQL, rule 13) and `ProfitService.getSummary(day, day)
 * .totals.gross_*` (the ONE definition of gross profit, rule 14 — the exact
 * figure the Profits page shows for the same day). This shape is exported
 * from BOTH `@liratek/core` entry points (`index.ts` for the value-bearing
 * export the transports/tests import, `browser.ts` as a TYPE-ONLY export —
 * rule 29, erased at compile time, so it carries zero runtime cost into the
 * Vercel bundle even though `ClosingService` itself imports `ProfitService`
 * → `ProfitRepository` → the database). Every consumer (IPC handler, REST
 * route, frontend adapter type) types against this one interface (rule 21) —
 * do not rename a field without updating every consumer in the same change.
 */
export interface DailyStatsSnapshot {
  salesCount: number;
  totalSalesUSD: number;
  totalSalesLBP: number;
  debtPaymentsUSD: number;
  debtPaymentsLBP: number;
  totalExpensesUSD: number;
  totalExpensesLBP: number;
  /** The day this snapshot was computed for (`YYYY-MM-DD`), so a PDF/UI
   *  consumer never has to re-derive it — it's the same value `day` resolved
   *  to below, echoed back. */
  profitDay: string;
  /**
   * GROSS profit (before expenses), per currency — present ONLY when
   * `opts.includeProfit` was true AND the read succeeded. Never present
   * alongside `profitHidden`/`profitUnavailable`: exactly one of "the two
   * profit fields", `profitHidden`, or `profitUnavailable` describes any
   * given response, so a caller can distinguish "profit is genuinely $0"
   * from "profit was not read" (C.6 — a money report must never let an
   * absent figure silently read as a confident $0.00).
   */
  totalProfitUSD?: number;
  totalProfitLBP?: number;
  /**
   * The caller failed the admin-or-Profits-unlocked gate (E-Q6). Set
   * whenever `opts.includeProfit` is falsy — the GATE DECISION itself is
   * each transport's job (IPC `dbHandlers.ts` / REST `closing.ts`, both
   * feeding the ONE shared predicate `canIncludeProfit` their own role +
   * `hasProfitsUnlock` read, out of this file's layer), never re-derived
   * here; this service only honors whatever `includeProfit` it was handed
   * and reports honestly that profit was left out.
   */
  profitHidden?: true;
  /** `ProfitService.getSummary` threw while computing profit (E-Q7) — the
   *  error is logged and this flag takes the place of the profit fields so
   *  the caller can print "unavailable" instead of a silent $0.00 (C.6).
   *  Activity stats (sales/debt payments) and this repository's own
   *  expense figures are still returned — only profit is missing. */
  profitUnavailable?: true;
}

/** {@link DailyActivityStats}, defaulted to all-zero — the shared fallback
 *  both the activity-read failure path and any future caller can reuse
 *  instead of hand-writing the same seven zeros twice (rule 14). */
const ZERO_ACTIVITY_STATS: DailyActivityStats = {
  salesCount: 0,
  totalSalesUSD: 0,
  totalSalesLBP: 0,
  debtPaymentsUSD: 0,
  debtPaymentsLBP: 0,
  totalExpensesUSD: 0,
  totalExpensesLBP: 0,
};

export class ClosingService {
  private repo: ClosingRepository;
  /** LIRA-219 (SOLID/DIP, mirrors `ProfitService`'s own `repo`/`rateRepo`
   *  injection pattern) — the ONE source of gross profit. Never call a
   *  repository directly for a profit figure from this service (rule 13);
   *  everything money-shaped comes through here. */
  private profitService: ProfitService;

  constructor(repo?: ClosingRepository, profitService?: ProfitService) {
    this.repo = repo ?? getClosingRepository();
    this.profitService = profitService ?? getProfitService();
  }

  /**
   * Recalculate drawer_balances from the payments journal
   */
  recalculateDrawerBalances(): { success: boolean; error?: string } {
    try {
      return this.repo.recalculateDrawerBalances();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.recalculateDrawerBalances error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get system expected balances (dynamic — keyed by drawer name)
   */
  getSystemExpectedBalancesDynamic(): DynamicSystemExpectedBalances {
    try {
      return this.repo.getSystemExpectedBalancesDynamic();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getSystemExpectedBalancesDynamic error",
      );
      return {};
    }
  }

  /**
   * Get the closing report's daily stats snapshot (LIRA-219): activity
   * stats (sales/debt-payments/expenses) ALWAYS, plus GROSS profit for the
   * SAME day the Profits page would show — composed here, never
   * re-computed, so the two surfaces can never drift (rule 14).
   *
   * `day` resolution (rule 27): the caller's own `input.day` wins; when
   * omitted, `clientDay()` resolves the REQUEST's own day (the `X-Client-Day`
   * context value on web, else this machine's `localDay()` on desktop) —
   * never the server's bare day, which on web (UTC) can be a different
   * calendar day than the shop's for up to three hours after local midnight.
   *
   * `opts.includeProfit` defaults to FALSE — fail closed. Each TRANSPORT
   * (IPC `dbHandlers.ts`, REST `closing.ts`) computes it by calling the ONE
   * shared predicate `canIncludeProfit` with the caller's own role and a
   * `hasProfitsUnlock` read (`electron-app/session.ts` on desktop,
   * `backend/src/middleware/profitsUnlock.ts` on web) — the place that knows
   * whether the caller is admin or has unlocked the Profits page (E-Q6);
   * this service never re-derives that gate, it only honors whichever
   * `includeProfit` it was handed.
   */
  getDailyStatsSnapshot(
    input?: DailyStatsSnapshotQuery,
    opts?: { includeProfit?: boolean },
  ): DailyStatsSnapshot {
    const day = input?.day ?? clientDay();
    const includeProfit = opts?.includeProfit ?? false;

    let activity: DailyActivityStats;
    try {
      activity = this.repo.getDailyActivityStats(day);
    } catch (error) {
      closingLogger.error(
        { error, day },
        "ClosingService.getDailyStatsSnapshot activity-stats error",
      );
      activity = ZERO_ACTIVITY_STATS;
    }

    const base: DailyStatsSnapshot = { ...activity, profitDay: day };

    if (!includeProfit) {
      return { ...base, profitHidden: true };
    }

    try {
      // The ONE definition of gross profit (rule 14) — same call, same
      // window, the Profits page's `getSummary` makes for its own headline
      // card. `summary.expenses` replaces the activity-stats expense figures
      // here (they already agree — see LIRA-219_CLOSING_PROFIT_PARITY.md
      // §B — this just removes any chance of the two drifting once profit is
      // actually being shown).
      const summary = this.profitService.getSummary(day, day);
      return {
        ...base,
        totalExpensesUSD: summary.expenses.total_usd,
        totalExpensesLBP: summary.expenses.total_lbp,
        totalProfitUSD: summary.totals.gross_profit_usd,
        totalProfitLBP: summary.totals.gross_profit_lbp,
      };
    } catch (error) {
      // E-Q7: print "unavailable", never a silent $0.00 — the flag takes the
      // place of the profit fields; activity stats and this repository's own
      // expense figures (already in `base`) are still returned.
      closingLogger.error(
        { error, day },
        "ClosingService.getDailyStatsSnapshot profit error",
      );
      return { ...base, profitUnavailable: true };
    }
  }

  /**
   * Get checkpoint timeline for a date
   */
  async getCheckpointTimeline(
    filters: import("../repositories/ClosingRepository.js").CheckpointFilters = {},
  ): Promise<{
    success: boolean;
    checkpoints?: import("../repositories/ClosingRepository.js").CheckpointRecord[];
    error?: string;
  }> {
    try {
      const checkpoints = this.repo.getCheckpointTimeline(filters);
      return { success: true, checkpoints };
    } catch (error) {
      closingLogger.error(
        { error, filters },
        "ClosingService.getCheckpointTimeline error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the actual amounts from the most recent checkpoint (baseline for next checkpoint).
   * Returns Record<drawerName, Record<currencyCode, amount>>
   */
  getLastCheckpointActuals(): Record<string, Record<string, number>> {
    try {
      return this.repo.getLastCheckpointActuals();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getLastCheckpointActuals error",
      );
      return {};
    }
  }

  /**
   * Check whether any drawer has a non-zero balance — i.e. the operator has
   * run the initial drawer amounts setup at least once.
   */
  hasInitialBalancesSet(): boolean {
    try {
      return this.repo.hasInitialBalancesSet();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.hasInitialBalancesSet error",
      );
      return false;
    }
  }

  /**
   * Check if there is at least one checkpoint record for today's date.
   * `day` is the client's own local calendar day (`YYYY-MM-DD`) — see
   * `ClosingRepository.hasOpeningBalanceToday`'s doc for why the server's own
   * day is only a fallback, not the source of truth, on web.
   */
  hasOpeningBalanceToday(day?: string): boolean {
    try {
      return this.repo.hasOpeningBalanceToday(day);
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.hasOpeningBalanceToday error",
      );
      return false;
    }
  }

  /**
   * Check whether a starting checkpoint has ever been recorded (timeline
   * non-empty). Returns true on error to avoid nagging the operator on a
   * transient failure (same conservative default as hasInitialBalancesSet).
   */
  hasStartingCheckpoint(): boolean {
    try {
      return this.repo.hasStartingCheckpoint();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.hasStartingCheckpoint error",
      );
      return true;
    }
  }

  /**
   * Closing date of the initial (setup) checkpoint, or null if none exists.
   */
  getInitialCheckpointDate(): string | null {
    try {
      return this.repo.getInitialCheckpointDate();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getInitialCheckpointDate error",
      );
      return null;
    }
  }

  /**
   * Update an existing daily_closings record by id.
   */
  updateDailyClosing(data: {
    id: number;
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string;
    report_path?: string;
    user_id?: number;
  }): { success: boolean; error?: string } {
    try {
      return this.repo.updateDailyClosing(data);
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.updateDailyClosing error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set opening balances for a closing date.
   * Creates a checkpoint record of type OPENING.
   */
  setOpeningBalances(data: {
    closingDate?: string;
    userId?: number;
    amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }>;
  }): ClosingResult {
    try {
      return this.repo.createCheckpoint({
        user_id: data.userId ?? 0,
        drawer_name: "AGGREGATED",
        notes: `Opening balances for ${data.closingDate ?? localDay()}`,
        amounts: data.amounts ?? [],
      });
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.setOpeningBalances error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a daily closing record (legacy — delegates to createCheckpoint).
   */
  createDailyClosing(data: {
    closingDate?: string;
    userId?: number;
    amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }>;
    notes?: string;
  }): ClosingResult {
    try {
      return this.repo.createCheckpoint({
        user_id: data.userId ?? 0,
        drawer_name: "AGGREGATED",
        notes:
          data.notes ?? `Daily closing for ${data.closingDate ?? localDay()}`,
        amounts: data.amounts ?? [],
      });
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.createDailyClosing error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Compute per-drawer variance for a given checkpoint.
   * Compares actual (physical) vs expected (opening) amounts.
   * Returns structured data with variance per drawer/currency.
   */
  getCheckpointVariance(checkpointId: number): {
    checkpointId: number;
    hasVariance: boolean;
    drawers: Array<{
      drawerName: string;
      currency: string;
      expected: number;
      actual: number;
      variance: number;
    }>;
  } {
    try {
      const amounts = this.repo.getCheckpointAmounts(checkpointId);
      const drawers = amounts
        .filter(
          (a) => a.physical_amount !== null && a.physical_amount !== undefined,
        )
        .map((a) => ({
          drawerName: a.drawer_name,
          currency: a.currency_code,
          expected: a.opening_amount || 0,
          actual: a.physical_amount || 0,
          variance: (a.physical_amount || 0) - (a.opening_amount || 0),
        }));

      const hasVariance = drawers.some((d) => Math.abs(d.variance) > 0.01);

      closingLogger.info(
        { checkpointId, hasVariance, drawerCount: drawers.length },
        "Computed checkpoint variance",
      );

      return { checkpointId, hasVariance, drawers };
    } catch (error) {
      closingLogger.error(
        { error, checkpointId },
        "ClosingService.getCheckpointVariance error",
      );
      return { checkpointId, hasVariance: false, drawers: [] };
    }
  }

  /**
   * Get the most recent checkpoint for each drawer.
   * Returns Record<drawerName, DrawerCheckpointStatus>
   */
  getLastCheckpointPerDrawer(): Record<string, DrawerCheckpointStatus> {
    try {
      return this.repo.getLastCheckpointPerDrawer();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getLastCheckpointPerDrawer error",
      );
      return {};
    }
  }

  /**
   * Create a unified checkpoint (replaces both opening and closing).
   * Records expected vs actual per drawer/currency, plus — for the MTC/Alfa
   * drawers — the per-line SIM count in `data.carrier_lines` (credits and
   * validity expiry). The line is the source of truth there and the provider
   * drawer follows it; see `ClosingRepository.createCheckpoint`.
   */
  createCheckpoint(data: CreateCheckpointData): ClosingResult {
    try {
      return this.repo.createCheckpoint(data);
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.createCheckpoint error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance
let closingServiceInstance: ClosingService | null = null;

export function getClosingService(): ClosingService {
  if (!closingServiceInstance) {
    closingServiceInstance = new ClosingService();
  }
  return closingServiceInstance;
}

export function resetClosingService(): void {
  closingServiceInstance = null;
}
