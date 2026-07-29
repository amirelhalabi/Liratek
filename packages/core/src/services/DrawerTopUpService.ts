import {
  DrawerTopUpRepository,
  DrawerTopUpEntity,
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
  CreateSystemFloatTopupData,
  SourceDrawerBalance,
  SYSTEM_FLOAT_DRAWER_NAMES,
  GENERAL_DRAWER,
  getDrawerTopUpRepository,
} from "../repositories/DrawerTopUpRepository.js";
import { getCurrencyRepository } from "../repositories/CurrencyRepository.js";
import { toErrorString } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const drawerTopUpLogger = createChildLogger({ module: "drawer-topup" });

export interface DrawerTopUpResult {
  success: boolean;
  id?: number;
  error?: string;
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
   * `extra_currencies` (External mode only) accepts top-ups in any OTHER
   * currency already enabled for the General drawer via Settings →
   * Currencies (`currency_drawers`) — validated here (not auto-registered
   * the way ExchangeRepository does for arbitrary currencies), since a
   * manual cash top-up is a config-gated action, not a market-rate
   * conversion.
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
              error: `Currency "${code}" is not enabled for the General drawer. Enable it in Settings → Currencies first.`,
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
   * Fund the OMT_System / Whish_System spendable float (owner-confirmed
   * 2026-07-29 float model) from any drawer holding a spendable balance.
   */
  fundSystemDrawer(
    data: CreateSystemFloatTopupData,
    userId: number,
  ): DrawerTopUpResult {
    try {
      if (!SYSTEM_FLOAT_DRAWER_NAMES.includes(data.targetDrawer)) {
        return {
          success: false,
          error: `Invalid target drawer "${data.targetDrawer}" — must be one of: ${SYSTEM_FLOAT_DRAWER_NAMES.join(", ")}`,
        };
      }

      if (!data.fundingDrawer || !data.fundingDrawer.trim()) {
        return { success: false, error: "fundingDrawer is required." };
      }

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

      const id = this.repo.fundSystemDrawer(
        { ...data, fundingDrawer: data.fundingDrawer.trim() },
        userId,
      );

      drawerTopUpLogger.info(
        {
          id,
          targetDrawer: data.targetDrawer,
          fundingDrawer: data.fundingDrawer,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          notes: data.notes,
          userId,
        },
        "System float top-up recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.fundSystemDrawer error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get available source drawers (OMT_System) with their balances.
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
