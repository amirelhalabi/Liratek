/**
 * Currency Service
 *
 * Business logic layer for currency operations.
 */

import {
  CurrencyRepository,
  getCurrencyRepository,
  type CurrencyEntity,
  type CreateCurrencyData,
  type UpdateCurrencyData,
} from "../repositories/index.js";
import { toErrorString, getRepoConstraintCode } from "../utils/errors.js";
import { clearCurrencyCache } from "../utils/currency.js";

// =============================================================================
// Types
// =============================================================================

export interface CurrencyResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Currency Service Class
// =============================================================================

export class CurrencyService {
  private currencyRepo: CurrencyRepository;

  constructor(currencyRepo?: CurrencyRepository) {
    this.currencyRepo = currencyRepo ?? getCurrencyRepository();
  }

  /**
   * Get all currencies
   */
  listCurrencies(): CurrencyEntity[] | { error: string } {
    try {
      return this.currencyRepo.findAllCurrencies();
    } catch (e) {
      return { error: toErrorString(e) };
    }
  }

  /**
   * Create a new currency
   */
  createCurrency(data: CreateCurrencyData): CurrencyResult {
    try {
      const result = this.currencyRepo.createCurrency(data);
      clearCurrencyCache();
      return { success: true, id: result.id };
    } catch (e) {
      const sqliteCode = (e as { code?: string })?.code;
      if (
        getRepoConstraintCode(e) === "DUPLICATE_CURRENCY_CODE" ||
        sqliteCode === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        return { success: false, error: "Currency code already exists" };
      }
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * Update a currency
   */
  updateCurrency(id: number, data: UpdateCurrencyData): CurrencyResult {
    try {
      const updated = this.currencyRepo.updateCurrency(id, data);
      if (!updated) {
        return { success: false, error: "Not found" };
      }
      clearCurrencyCache();
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * Delete a currency
   */
  deleteCurrency(id: number): CurrencyResult {
    try {
      this.currencyRepo.deleteCurrency(id);
      clearCurrencyCache();
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  // =========================================================================
  // Currency–Module Junction
  // =========================================================================

  /** Get module keys enabled for a currency */
  getModulesForCurrency(code: string): string[] {
    return this.currencyRepo.getModulesForCurrency(code);
  }

  /** Get active currencies enabled for a module */
  getCurrenciesForModule(moduleKey: string): CurrencyEntity[] {
    return this.currencyRepo.getCurrenciesForModule(moduleKey);
  }

  /** Set which modules a currency is allowed in */
  setModulesForCurrency(code: string, modules: string[]): CurrencyResult {
    try {
      this.currencyRepo.setModulesForCurrency(code, modules);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  // =========================================================================
  // Currency–Drawer Junction
  // =========================================================================

  /** Get all drawer-currency mappings */
  getAllDrawerCurrencies(): Record<string, string[]> {
    return this.currencyRepo.getAllDrawerCurrencies();
  }

  /** Get currency codes enabled for a drawer */
  getCurrenciesForDrawer(drawerName: string): string[] {
    return this.currencyRepo.getCurrenciesForDrawer(drawerName);
  }

  /** Get drawer names enabled for a currency */
  getDrawersForCurrency(code: string): string[] {
    return this.currencyRepo.getDrawersForCurrency(code);
  }

  /** Set currencies for a drawer */
  setCurrenciesForDrawer(
    drawerName: string,
    currencies: string[],
  ): CurrencyResult {
    try {
      this.currencyRepo.setCurrenciesForDrawer(drawerName, currencies);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /** Get all configured drawer names */
  getConfiguredDrawerNames(): string[] {
    return this.currencyRepo.getConfiguredDrawerNames();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let currencyServiceInstance: CurrencyService | null = null;

export function getCurrencyService(): CurrencyService {
  if (!currencyServiceInstance) {
    currencyServiceInstance = new CurrencyService();
  }
  return currencyServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetCurrencyService(): void {
  currencyServiceInstance = null;
}
