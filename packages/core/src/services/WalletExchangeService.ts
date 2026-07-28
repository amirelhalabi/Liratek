import {
  WalletExchangeRepository,
  WalletExchangeEntity,
  CreateWalletExchangeData,
  WalletDrawerName,
  WalletCurrency,
  getWalletExchangeRepository,
} from "../repositories/WalletExchangeRepository.js";
import { toErrorString } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const walletExchangeLogger = createChildLogger({ module: "wallet-exchange" });

const VALID_DRAWERS: readonly WalletDrawerName[] = ["OMT_App", "Whish_App"];
const VALID_CURRENCIES: readonly WalletCurrency[] = ["USD", "LBP"];

export interface WalletExchangeInput {
  drawerName: WalletDrawerName;
  fromCurrency: WalletCurrency;
  toCurrency: WalletCurrency;
  /** Amount of fromCurrency the operator wants to convert. */
  amountIn: number;
  /** LBP-per-USD rate (e.g. 89000), regardless of conversion direction. */
  rate: number;
  note?: string;
  transaction_time?: string;
}

export interface WalletExchangeResult {
  success: boolean;
  id?: number;
  amountOut?: number;
  error?: string;
}

export class WalletExchangeService {
  private repo: WalletExchangeRepository;

  constructor(repo?: WalletExchangeRepository) {
    this.repo = repo ?? getWalletExchangeRepository();
  }

  /**
   * Convert a provider wallet's own USD balance to LBP, or LBP to USD, at an
   * operator-entered rate — both directions share the SAME `rate` field
   * (always LBP-per-USD): USD→LBP multiplies, LBP→USD divides. No spread —
   * the shop books neither profit nor loss on the conversion itself.
   */
  exchange(data: WalletExchangeInput, userId: number): WalletExchangeResult {
    try {
      if (!VALID_DRAWERS.includes(data.drawerName)) {
        return {
          success: false,
          error: "Wallet exchange is only available for OMT App / Whish App.",
        };
      }
      if (
        !VALID_CURRENCIES.includes(data.fromCurrency) ||
        !VALID_CURRENCIES.includes(data.toCurrency)
      ) {
        return { success: false, error: "Currency must be USD or LBP." };
      }
      if (data.fromCurrency === data.toCurrency) {
        return {
          success: false,
          error: "From and to currency must be different.",
        };
      }
      if (!(data.amountIn > 0)) {
        return { success: false, error: "Amount must be greater than 0." };
      }
      if (!(data.rate > 0)) {
        return { success: false, error: "Exchange rate must be greater than 0." };
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

      // `rate` is always LBP-per-USD, regardless of direction.
      const amountOut =
        data.fromCurrency === "USD"
          ? Math.round(data.amountIn * data.rate)
          : Math.round((data.amountIn / data.rate) * 100) / 100;

      const createData: CreateWalletExchangeData = {
        drawerName: data.drawerName,
        fromCurrency: data.fromCurrency,
        toCurrency: data.toCurrency,
        amountIn: data.amountIn,
        amountOut,
        rate: data.rate,
        note: data.note,
        transaction_time: data.transaction_time,
      };

      const id = this.repo.createTransaction(createData, userId);

      walletExchangeLogger.info(
        {
          id,
          drawerName: data.drawerName,
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
          amountOut,
          rate: data.rate,
          userId,
        },
        "Wallet exchange recorded",
      );

      return { success: true, id, amountOut };
    } catch (error) {
      walletExchangeLogger.error(
        { error, data },
        "WalletExchangeService.exchange error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  getHistory(
    drawerName?: WalletDrawerName,
    limit?: number,
  ): WalletExchangeEntity[] {
    try {
      return this.repo.getHistory(drawerName, limit);
    } catch (error) {
      walletExchangeLogger.error(
        { error },
        "WalletExchangeService.getHistory error",
      );
      return [];
    }
  }
}

// Singleton instance
let walletExchangeServiceInstance: WalletExchangeService | null = null;

export function getWalletExchangeService(): WalletExchangeService {
  if (!walletExchangeServiceInstance) {
    walletExchangeServiceInstance = new WalletExchangeService();
  }
  return walletExchangeServiceInstance;
}

export function resetWalletExchangeService(): void {
  walletExchangeServiceInstance = null;
}
