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
import { isUnrestrictedDrawer } from "../constants/drawerCurrencyPolicy.js";
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

  /** Get full active currency entities for a drawer */
  getFullCurrenciesForDrawer(drawerName: string): CurrencyEntity[] {
    return this.currencyRepo.getFullCurrenciesForDrawer(drawerName);
  }

  /** Get drawer names enabled for a currency */
  getDrawersForCurrency(code: string): string[] {
    return this.currencyRepo.getDrawersForCurrency(code);
  }

  /**
   * Set currencies for a drawer (replace-all).
   *
   * Two guards, both of which MUST live here rather than in the IPC handler —
   * the REST route calls this same service and would otherwise bypass them
   * (rule 19). See `docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md` §1a.
   *
   * Layer 3 — an unrestricted drawer (General) has no configurable list at
   * all; its set is derived. Silently accepting a write would let the caller
   * believe a restriction was applied.
   *
   * Layer 2 — this is a DESTRUCTIVE replace-all (DELETE then INSERT), so
   * unticking a currency in Settings is one click. Combined with the closing
   * sheet filtering its count fields by this same allowlist, that used to
   * make real cash **uncountable**: the balance stayed visible on the
   * Dashboard but lost its count field, i.e. a permanent silent variance.
   * (Live example when this was written: `Katsh` held 2,957,925 LBP with LBP
   * in its allowlist — one untick away from stranding it.) So a currency the
   * drawer still holds cannot be removed. Zero-balance removals stay allowed.
   */
  setCurrenciesForDrawer(
    drawerName: string,
    currencies: string[],
  ): CurrencyResult {
    try {
      if (isUnrestrictedDrawer(drawerName)) {
        return {
          success: false,
          error: `The ${drawerName} drawer accepts every currency — its currency list is not configurable.`,
        };
      }

      const requested = new Set(currencies.map((c) => c.toUpperCase()));
      const stranded = this.currencyRepo
        .getNonZeroBalancesForDrawer(drawerName)
        .filter((held) => !requested.has(held.currency_code.toUpperCase()));

      if (stranded.length > 0) {
        const detail = stranded
          .map(
            (held) =>
              `${held.currency_code} (${held.balance.toLocaleString("en-US")})`,
          )
          .join(", ");
        return {
          success: false,
          error: `Cannot remove ${detail} from ${drawerName} — the drawer still holds that balance. Move or spend it first, then remove the currency.`,
        };
      }

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

  /**
   * Count-sheet currency sets for every drawer (plan §1a Layer 1, decisions
   * D2 + D5): `base ∪ {non-zero balances}` per drawer, never smaller than
   * the money a drawer actually holds. Pure delegation — rule 13, no SQL
   * lives in the service.
   */
  getCountableCurrenciesByDrawer(): Record<string, string[]> {
    return this.currencyRepo.getCountableCurrenciesByDrawer();
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
