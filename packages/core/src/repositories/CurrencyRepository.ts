/**
 * Currency Repository
 *
 * Handles all currencies table operations.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface CurrencyEntity {
  id: number;
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: number;
}

export interface CreateCurrencyData {
  code: string;
  name: string;
  symbol?: string;
  decimal_places?: number;
}

export interface UpdateCurrencyData {
  code?: string;
  name?: string;
  symbol?: string;
  decimal_places?: number;
  is_active?: number;
}

// =============================================================================
// Currency Repository Class
// =============================================================================

export class CurrencyRepository extends BaseRepository<CurrencyEntity> {
  constructor() {
    super("currencies", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, code, name, symbol, decimal_places, is_active, created_at";
  }

  /**
   * Get all currencies
   */
  findAllCurrencies(): CurrencyEntity[] {
    const stmt = this.db.prepare(
      "SELECT id, code, name, symbol, decimal_places, is_active FROM currencies ORDER BY code ASC",
    );
    return stmt.all() as CurrencyEntity[];
  }

  /**
   * Create a new currency
   */
  createCurrency(data: CreateCurrencyData): { id: number } {
    try {
      const stmt = this.db.prepare(
        "INSERT INTO currencies (code, name, symbol, decimal_places, is_active) VALUES (?, ?, ?, ?, 1)",
      );
      const result = stmt.run(
        data.code.toUpperCase(),
        data.name,
        data.symbol ?? "",
        data.decimal_places ?? 2,
      );
      return { id: Number(result.lastInsertRowid) };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError("Currency code already exists", {
          code: "DUPLICATE_CURRENCY_CODE",
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Update a currency
   */
  updateCurrency(id: number, data: UpdateCurrencyData): boolean {
    // Use direct query — don't filter by is_active since we may be activating an inactive currency
    const current = this.db
      .prepare(
        "SELECT id, code, name, symbol, decimal_places, is_active FROM currencies WHERE id = ?",
      )
      .get(id) as CurrencyEntity | undefined;
    if (!current) return false;

    const code = (data.code ?? current.code).toUpperCase();
    const name = data.name ?? current.name;
    const symbol = data.symbol ?? current.symbol;
    const decimalPlaces = data.decimal_places ?? current.decimal_places;
    const isActive = data.is_active ?? current.is_active;

    this.db
      .prepare(
        "UPDATE currencies SET code = ?, name = ?, symbol = ?, decimal_places = ?, is_active = ? WHERE id = ?",
      )
      .run(code, name, symbol, decimalPlaces, isActive, id);

    return true;
  }

  /**
   * Delete a currency
   */
  deleteCurrency(id: number): void {
    this.db.prepare("DELETE FROM currencies WHERE id = ?").run(id);
  }

  /**
   * Check if currency code exists
   */
  codeExists(code: string, excludeId?: number): boolean {
    let query = "SELECT 1 FROM currencies WHERE code = ?";
    const params: (string | number)[] = [code.toUpperCase()];

    if (excludeId) {
      query += " AND id != ?";
      params.push(excludeId);
    }

    return !!this.db.prepare(query).get(...params);
  }

  // =========================================================================
  // Currency–Module Junction Methods
  // =========================================================================

  /** Get module keys enabled for a currency */
  getModulesForCurrency(code: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT module_key FROM currency_modules WHERE currency_code = ?`,
      )
      .all(code.toUpperCase()) as { module_key: string }[];
    return rows.map((r) => r.module_key);
  }

  /** Get active currencies enabled for a module */
  getCurrenciesForModule(moduleKey: string): CurrencyEntity[] {
    return this.db
      .prepare(
        `
      SELECT c.id, c.code, c.name, c.symbol, c.decimal_places, c.is_active
      FROM currencies c
      JOIN currency_modules cm ON c.code = cm.currency_code
      WHERE cm.module_key = ? AND c.is_active = 1
      ORDER BY c.code
    `,
      )
      .all(moduleKey) as CurrencyEntity[];
  }

  /** Set modules for a currency (replace all) */
  setModulesForCurrency(code: string, modules: string[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM currency_modules WHERE currency_code = ?`)
        .run(code.toUpperCase());
      const insert = this.db.prepare(
        `INSERT INTO currency_modules (currency_code, module_key) VALUES (?, ?)`,
      );
      for (const m of modules) {
        insert.run(code.toUpperCase(), m);
      }
    })();
  }

  // =========================================================================
  // Currency–Drawer Junction Methods
  // =========================================================================

  /** Get all currency-drawer mappings: { drawer_name → currency_code[] } */
  getAllDrawerCurrencies(): Record<string, string[]> {
    const rows = this.db
      .prepare(
        `SELECT drawer_name, currency_code FROM currency_drawers ORDER BY drawer_name, currency_code`,
      )
      .all() as { drawer_name: string; currency_code: string }[];

    const result: Record<string, string[]> = {};
    for (const row of rows) {
      if (!result[row.drawer_name]) result[row.drawer_name] = [];
      result[row.drawer_name].push(row.currency_code);
    }
    return result;
  }

  /** Get currency codes enabled for a specific drawer */
  getCurrenciesForDrawer(drawerName: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT currency_code FROM currency_drawers WHERE drawer_name = ? ORDER BY currency_code`,
      )
      .all(drawerName) as { currency_code: string }[];
    return rows.map((r) => r.currency_code);
  }

  /** Get full active currency entities for a drawer (mirrors getCurrenciesForModule) */
  getFullCurrenciesForDrawer(drawerName: string): CurrencyEntity[] {
    return this.db
      .prepare(
        `
      SELECT c.id, c.code, c.name, c.symbol, c.decimal_places, c.is_active
      FROM currencies c
      JOIN currency_drawers cd ON c.code = cd.currency_code
      WHERE cd.drawer_name = ? AND c.is_active = 1
      ORDER BY c.code
    `,
      )
      .all(drawerName) as CurrencyEntity[];
  }

  /** Get drawer names enabled for a specific currency */
  getDrawersForCurrency(code: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT drawer_name FROM currency_drawers WHERE currency_code = ? ORDER BY drawer_name`,
      )
      .all(code.toUpperCase()) as { drawer_name: string }[];
    return rows.map((r) => r.drawer_name);
  }

  /** Set currencies for a drawer (replace all) */
  setCurrenciesForDrawer(drawerName: string, currencies: string[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM currency_drawers WHERE drawer_name = ?`)
        .run(drawerName);
      const insert = this.db.prepare(
        `INSERT INTO currency_drawers (currency_code, drawer_name) VALUES (?, ?)`,
      );
      for (const code of currencies) {
        insert.run(code.toUpperCase(), drawerName);
      }
    })();
  }

  /** Get all distinct drawer names from currency_drawers */
  getConfiguredDrawerNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT drawer_name FROM currency_drawers ORDER BY drawer_name`,
      )
      .all() as { drawer_name: string }[];
    return rows.map((r) => r.drawer_name);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let currencyRepositoryInstance: CurrencyRepository | null = null;

export function getCurrencyRepository(): CurrencyRepository {
  if (!currencyRepositoryInstance) {
    currencyRepositoryInstance = new CurrencyRepository();
  }
  return currencyRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetCurrencyRepository(): void {
  currencyRepositoryInstance = null;
}
