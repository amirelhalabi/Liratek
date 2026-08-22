import {
  DrawerTopUpRepository,
  DrawerTopUpEntity,
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
  TransferBetweenDrawersData,
  SourceDrawerBalance,
  GENERAL_DRAWER,
  getDrawerTopUpRepository,
} from "../repositories/DrawerTopUpRepository.js";
import { getCurrencyRepository } from "../repositories/CurrencyRepository.js";
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
   * currency the shop actually deals in — i.e. any ACTIVE currency, plus
   * anything General still holds.
   *
   * This used to be gated on an explicit `currency_drawers` row for the
   * General drawer, which made the app contradict itself: the Exchange module
   * deposits ANY currency into General, so an EUR exchange was fine while a
   * manual EUR cash-in was rejected with "Currency EUR is not enabled for the
   * General drawer" (owner-reported 2026-08-22). General is unrestricted —
   * `getCurrenciesForDrawer(GENERAL_DRAWER)` now DERIVES its set (see
   * `constants/drawerCurrencyPolicy.ts`), so this check has become "is this a
   * real, active currency" rather than "has an admin pre-authorised it".
   *
   * Still a hard reject, not an auto-register: a garbage or unknown code must
   * not silently create a `drawer_balances` row for a currency the app has no
   * name, symbol or decimal_places for. `ExchangeRepository` may auto-register
   * because it is resolving a live market rate for a known API currency; a
   * hand-keyed cash amount has no such source of truth.
   * See docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md.
   */
  addTopUp(data: CreateDrawerTopUpData, userId: number): DrawerTopUpResult {
    try {
      const rawExtraCurrencies = data.extra_currencies ?? [];

      if (rawExtraCurrencies.length > 0) {
        const allowed = new Set(
          getCurrencyRepository()
            .getCurrenciesForDrawer(GENERAL_DRAWER)
            .filter((code) => code !== "USD" && code !== "LBP"),
        );
        const seen = new Set<string>();

        for (const entry of rawExtraCurrencies) {
          const code = (entry.currency_code ?? "").trim().toUpperCase();
          if (!code) {
            return {
              success: false,
              error: "Every extra currency entry must have a currency_code.",
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
          if (!allowed.has(code)) {
            return {
              success: false,
              error: `Currency "${code}" is not an active currency. Add it in Settings → Currencies first.`,
            };
          }
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
