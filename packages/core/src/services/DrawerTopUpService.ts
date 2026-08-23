import {
  DrawerTopUpRepository,
  DrawerTopUpEntity,
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
  TransferBetweenDrawersData,
  SourceDrawerBalance,
  getDrawerTopUpRepository,
} from "../repositories/DrawerTopUpRepository.js";
import { isAppError, toErrorString } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const drawerTopUpLogger = createChildLogger({ module: "drawer-topup" });

export interface DrawerTopUpResult {
  success: boolean;
  id?: number;
  error?: string;
  /** Machine-readable error code (plan §8.5's structured contract) — set
   *  alongside `details` when the repository throws an `AppError` (e.g.
   *  `InsufficientDrawerFundsError`), so both transports and the frontend
   *  share ONE error-handling path that switches on `code`, never a message
   *  string match. */
  code?: string;
  details?: unknown;
}

export class DrawerTopUpService {
  private repo: DrawerTopUpRepository;

  constructor(repo?: DrawerTopUpRepository) {
    this.repo = repo ?? getDrawerTopUpRepository();
  }

  /**
   * Add cash to the General drawer (owner brings cash).
   * At least one of amount_usd, amount_lbp, or a valid extra_currencies
   * entry must be greater than zero.
   *
   * `extra_currencies` (External mode only) accepts a top-up in any OTHER
   * currency the shop actually deals in.
   *
   * This used to be gated on the currency already being a known ACTIVE
   * currency (before that, an explicit `currency_drawers` row for General) —
   * both of which made the app contradict itself: the Exchange module
   * deposits ANY currency into General, auto-registering an unknown code
   * on the spot, while a manual cash-in of that same currency was rejected
   * outright (owner-reported 2026-08-22, then again 2026-08-23 once the
   * currency picker was widened to mirror Exchange's own list — see
   * `useExchangeCurrencyList` on the frontend and
   * docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md /
   * EXCHANGE_LOT_SETTLEMENT.md Q3).
   *
   * The service no longer pre-validates that `currency_code` is already
   * known: `DrawerTopUpRepository.createTopUp` now auto-registers an unknown
   * code (INSERT OR IGNORE into `currencies`/`currency_drawers`, mirroring
   * `ExchangeRepository.ensureCurrency`) before it opens an exchange lot for
   * it — the same trust model Exchange already uses, extended here since the
   * frontend now sources `currency_code` from that SAME curated list
   * (configured currencies + the live FX feed), not a free-text field. USD
   * and LBP are still hard-rejected here: they have their own dedicated
   * amount_usd/amount_lbp fields and must never double-post through
   * extra_currencies.
   *
   * Every `extra_currencies` entry accepted here is, by construction, a
   * foreign (non-USD/LBP) currency landing in General — i.e. lot-tracked
   * (EXCHANGE_LOT_SETTLEMENT.md Q3). `DrawerTopUpRepository.createTopUp`
   * resolves each entry's cost basis (operator override > configured market
   * rate > client feed hint > error) and opens an exchange lot at it; this
   * service does not duplicate that resolution, it only forwards the
   * relevant fields through untouched (see the normalization step below).
   */
  addTopUp(data: CreateDrawerTopUpData, userId: number): DrawerTopUpResult {
    try {
      const rawExtraCurrencies = data.extra_currencies ?? [];

      if (rawExtraCurrencies.length > 0) {
        const seen = new Set<string>();

        for (const entry of rawExtraCurrencies) {
          const code = (entry.currency_code ?? "").trim().toUpperCase();
          if (!code) {
            return {
              success: false,
              error: "Every extra currency entry must have a currency_code.",
            };
          }
          if (code === "USD" || code === "LBP") {
            return {
              success: false,
              error: `"${code}" has its own dedicated amount field above — remove it from "other currencies".`,
            };
          }
          if (!(entry.amount > 0)) {
            return {
              success: false,
              error: `Amount for extra currency "${code}" must be greater than zero.`,
            };
          }
          if (seen.has(code)) {
            return {
              success: false,
              error: `Duplicate currency "${code}" in extra_currencies.`,
            };
          }
          seen.add(code);
        }
      }

      if (
        (data.amount_usd ?? 0) <= 0 &&
        (data.amount_lbp ?? 0) <= 0 &&
        rawExtraCurrencies.length === 0
      ) {
        return {
          success: false,
          error:
            "At least one amount (USD, LBP, or another currency) must be greater than zero.",
        };
      }

      const transactionTime = data.transaction_time;

      if (transactionTime) {
        const txTime = new Date(transactionTime);
        if (isNaN(txTime.getTime())) {
          return { success: false, error: "Invalid transaction_time format" };
        }
        if (txTime > new Date()) {
          return {
            success: false,
            error: "transaction_time cannot be in the future",
          };
        }
      }

      // Normalize currency codes (uppercase) before they reach the
      // repository — drawer_balances/currency_drawers store codes
      // uppercase, and this keeps the drawer key consistent regardless of
      // how the caller cased it (the IPC Zod schema deliberately does not
      // `.transform()` this — see electron-app/schemas/index.ts).
      const normalizedData: CreateDrawerTopUpData =
        rawExtraCurrencies.length > 0
          ? {
              ...data,
              extra_currencies: rawExtraCurrencies.map((entry) => ({
                currency_code: entry.currency_code.trim().toUpperCase(),
                amount: entry.amount,
                // Forwarded untouched (EXCHANGE_LOT_SETTLEMENT.md Q3) — the
                // repository, inside its own transaction, is the single
                // place that requires/rejects it. Dropping it here on the
                // rewrite would be exactly the "a rewrite silently loses a
                // field" trap CLAUDE.md rule 12 calls out for preload types.
                acquisition_usd_per_unit: entry.acquisition_usd_per_unit,
                // Same "forward untouched" rule as acquisition_usd_per_unit
                // above — the repository resolves it (2026-08-23 refinement).
                market_usd_per_unit_hint: entry.market_usd_per_unit_hint,
              })),
            }
          : data;

      const id = this.repo.createTopUp(normalizedData, userId);

      drawerTopUpLogger.info(
        {
          id,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          extraCurrencies: data.extra_currencies,
          notes: data.notes,
          userId,
        },
        "Drawer top-up recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.addTopUp error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Transfer funds from a source drawer (OMT_System) to General drawer.
   */
  topUpFromDrawer(
    data: CreateDrawerTopUpFromDrawerData,
    userId: number,
  ): DrawerTopUpResult {
    try {
      if ((data.amount_usd ?? 0) <= 0 && (data.amount_lbp ?? 0) <= 0) {
        return {
          success: false,
          error: "At least one amount (USD or LBP) must be greater than zero.",
        };
      }

      if (data.transaction_time) {
        const txTime = new Date(data.transaction_time);
        if (isNaN(txTime.getTime())) {
          return { success: false, error: "Invalid transaction_time format" };
        }
        if (txTime > new Date()) {
          return {
            success: false,
            error: "transaction_time cannot be in the future",
          };
        }
      }

      const id = this.repo.createTopUpFromDrawer(data, userId);

      drawerTopUpLogger.info(
        {
          id,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          sourceDrawer: data.source_drawer,
          notes: data.notes,
          userId,
        },
        "Drawer top-up from drawer recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.topUpFromDrawer error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Generic, reversible cash transfer between any two of the shop's own
   * drawers (Primary Cash Drawer plan §8.6) — General <-> the primary cash
   * drawer (OMT_System/Whish_System) is the pair the UI exposes, replacing
   * the old one-directional `fundSystemDrawer` (owner-confirmed 2026-07-29
   * float model, General -> OMT_System/Whish_System only).
   *
   * Preserves `InsufficientDrawerFundsError`'s `code`/`details` on the
   * returned result (rather than collapsing it to a bare string like the
   * other catch blocks here) — task H: the transfer's insufficient-funds
   * error reuses plan §8.5's structured contract so the frontend has ONE
   * error-handling path (switch on `code`) shared with the RECEIVE-payout
   * guard.
   */
  transferBetweenDrawers(data: TransferBetweenDrawersData): DrawerTopUpResult {
    try {
      if (!data.fromDrawer || !data.fromDrawer.trim()) {
        return { success: false, error: "fromDrawer is required." };
      }
      if (!data.toDrawer || !data.toDrawer.trim()) {
        return { success: false, error: "toDrawer is required." };
      }

      if ((data.amountUsd ?? 0) <= 0 && (data.amountLbp ?? 0) <= 0) {
        return {
          success: false,
          error: "At least one amount (USD or LBP) must be greater than zero.",
        };
      }

      if (data.transactionTime) {
        const txTime = new Date(data.transactionTime);
        if (isNaN(txTime.getTime())) {
          return { success: false, error: "Invalid transaction_time format" };
        }
        if (txTime > new Date()) {
          return {
            success: false,
            error: "transaction_time cannot be in the future",
          };
        }
      }

      const id = this.repo.transferBetweenDrawers({
        ...data,
        fromDrawer: data.fromDrawer.trim(),
        toDrawer: data.toDrawer.trim(),
      });

      drawerTopUpLogger.info(
        {
          id,
          fromDrawer: data.fromDrawer,
          toDrawer: data.toDrawer,
          amountUSD: data.amountUsd,
          amountLBP: data.amountLbp,
          notes: data.notes,
          userId: data.createdBy,
        },
        "Drawer transfer recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.transferBetweenDrawers error",
      );
      if (isAppError(error)) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get available primary-cash-drawer balances (OMT_System / Whish_System)
   * for transfer source/destination selection (Primary Cash Drawer plan
   * §8.6 — un-hardcoded from OMT_System-only, see
   * `DrawerTopUpRepository.getSourceDrawerBalances`).
   */
  getSourceDrawers(): SourceDrawerBalance[] {
    try {
      return this.repo.getSourceDrawerBalances();
    } catch (error) {
      drawerTopUpLogger.error(
        { error },
        "DrawerTopUpService.getSourceDrawers error",
      );
      return [];
    }
  }

  /**
   * Get recent drawer top-up history.
   */
  getHistory(limit?: number): DrawerTopUpEntity[] {
    try {
      return this.repo.getHistory(limit);
    } catch (error) {
      drawerTopUpLogger.error({ error }, "DrawerTopUpService.getHistory error");
      return [];
    }
  }
}

// Singleton instance
let drawerTopUpServiceInstance: DrawerTopUpService | null = null;

export function getDrawerTopUpService(): DrawerTopUpService {
  if (!drawerTopUpServiceInstance) {
    drawerTopUpServiceInstance = new DrawerTopUpService();
  }
  return drawerTopUpServiceInstance;
}

export function resetDrawerTopUpService(): void {
  drawerTopUpServiceInstance = null;
}
