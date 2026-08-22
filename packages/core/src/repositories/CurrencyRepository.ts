/**
 * Currency Repository
 *
 * Handles all currencies table operations.
 */

import { BaseRepository } from "./BaseRepository.js";
import {
  UNRESTRICTED_DRAWERS,
  isUnrestrictedDrawer,
} from "../constants/drawerCurrencyPolicy.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
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
      "SELECT id, code, name, symbol, decimal_places, is_active FROM currencies WHERE tenant_id = ? ORDER BY code ASC",
    );
    return stmt.all(getCurrentTenantId()) as CurrencyEntity[];
  }

  /**
   * Create a new currency
   */
  createCurrency(data: CreateCurrencyData): { id: number } {
    try {
      const stmt = this.db.prepare(
        "INSERT INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id) VALUES (?, ?, ?, ?, 1, ?)",
      );
      const result = stmt.run(
        data.code.toUpperCase(),
        data.name,
        data.symbol ?? "",
        data.decimal_places ?? 2,
        getCurrentTenantId(),
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
    const tenantId = getCurrentTenantId();
    // Use direct query — don't filter by is_active since we may be activating an inactive currency
    const current = this.db
      .prepare(
        "SELECT id, code, name, symbol, decimal_places, is_active FROM currencies WHERE id = ? AND tenant_id = ?",
      )
      .get(id, tenantId) as CurrencyEntity | undefined;
    if (!current) return false;

    const code = (data.code ?? current.code).toUpperCase();
    const name = data.name ?? current.name;
    const symbol = data.symbol ?? current.symbol;
    const decimalPlaces = data.decimal_places ?? current.decimal_places;
    const isActive = data.is_active ?? current.is_active;

    this.db
      .prepare(
        "UPDATE currencies SET code = ?, name = ?, symbol = ?, decimal_places = ?, is_active = ? WHERE id = ? AND tenant_id = ?",
      )
      .run(code, name, symbol, decimalPlaces, isActive, id, tenantId);

    return true;
  }

  /**
   * Delete a currency
   */
  deleteCurrency(id: number): void {
    this.db
      .prepare("DELETE FROM currencies WHERE id = ? AND tenant_id = ?")
      .run(id, getCurrentTenantId());
  }

  /**
   * Check if currency code exists
   */
  codeExists(code: string, excludeId?: number): boolean {
    let query = "SELECT 1 FROM currencies WHERE code = ? AND tenant_id = ?";
    const params: (string | number)[] = [
      code.toUpperCase(),
      getCurrentTenantId(),
    ];

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
        `SELECT module_key FROM currency_modules WHERE currency_code = ? AND tenant_id = ?`,
      )
      .all(code.toUpperCase(), getCurrentTenantId()) as {
      module_key: string;
    }[];
    return rows.map((r) => r.module_key);
  }

  /** Get active currencies enabled for a module */
  getCurrenciesForModule(moduleKey: string): CurrencyEntity[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `
      SELECT c.id, c.code, c.name, c.symbol, c.decimal_places, c.is_active
      FROM currencies c
      JOIN currency_modules cm ON c.code = cm.currency_code AND cm.tenant_id = c.tenant_id
      WHERE cm.module_key = ? AND c.is_active = 1 AND c.tenant_id = ?
      ORDER BY c.code
    `,
      )
      .all(moduleKey, tenantId) as CurrencyEntity[];
  }

  /** Set modules for a currency (replace all) */
  setModulesForCurrency(code: string, modules: string[]): void {
    const tenantId = getCurrentTenantId();
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM currency_modules WHERE currency_code = ? AND tenant_id = ?`,
        )
        .run(code.toUpperCase(), tenantId);
      const insert = this.db.prepare(
        `INSERT INTO currency_modules (currency_code, module_key, tenant_id) VALUES (?, ?, ?)`,
      );
      for (const m of modules) {
        insert.run(code.toUpperCase(), m, tenantId);
      }
    })();
  }

  // =========================================================================
  // Currency–Drawer Junction Methods
  // =========================================================================

  /**
   * Codes with a NON-ZERO balance in a drawer — the money that actually
   * exists there, as opposed to what `currency_drawers` says is allowed.
   *
   * Two callers depend on this being the "fact" side of the drawer:
   *  - the derived set below (an unrestricted drawer shows what it holds even
   *    if the currency was later deactivated),
   *  - `CurrencyService.setCurrenciesForDrawer`'s guard, which refuses to
   *    un-configure a currency the drawer still holds (plan §1a Layer 2 —
   *    doing so left the balance on the Dashboard but dropped it from the
   *    closing count sheet, i.e. a permanent silent variance).
   *
   * `balance != 0` rather than `> 0` on purpose: a negative balance is still
   * money (the primary cash drawer is allowed to go negative), and stranding
   * a deficit is just as wrong as stranding a surplus.
   */
  getNonZeroBalancesForDrawer(
    drawerName: string,
  ): { currency_code: string; balance: number }[] {
    return this.db
      .prepare(
        `SELECT currency_code, balance FROM drawer_balances
         WHERE drawer_name = ? AND tenant_id = ? AND balance != 0
         ORDER BY currency_code`,
      )
      .all(drawerName, getCurrentTenantId()) as {
      currency_code: string;
      balance: number;
    }[];
  }

  /**
   * The DERIVED currency set for an unrestricted drawer (`General`): every
   * ACTIVE currency, plus anything the drawer still physically holds — so a
   * currency that was deactivated while holding cash stays visible and
   * countable instead of silently vanishing.
   *
   * Not read from `currency_drawers` at all: see
   * `constants/drawerCurrencyPolicy.ts` for why General has no allowlist.
   */
  private derivedCurrencyCodesForDrawer(drawerName: string): string[] {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT code FROM currencies
         WHERE tenant_id = ?
           AND (is_active = 1
                OR code IN (SELECT currency_code FROM drawer_balances
                            WHERE drawer_name = ? AND tenant_id = ? AND balance != 0))
         ORDER BY code`,
      )
      .all(tenantId, drawerName, tenantId) as { code: string }[];

    // A `drawer_balances` row can in principle name a code with no
    // `currencies` row (that table has no FK to `currencies`, and
    // `applyDrawerDelta` upserts freely). Union those in so held money is
    // never invisible, even in that degenerate case.
    const codes = new Set(rows.map((r) => r.code));
    for (const held of this.getNonZeroBalancesForDrawer(drawerName)) {
      codes.add(held.currency_code);
    }
    return [...codes].sort();
  }

  /**
   * Get all currency-drawer mappings: { drawer_name → currency_code[] }
   *
   * Two behaviours beyond the raw table read:
   *  - unrestricted drawers report their DERIVED set (never their rows);
   *  - the KEY set is the drawer **registry**, unioned from
   *    `currency_drawers`, `drawer_balances` and `UNRESTRICTED_DRAWERS`.
   *    This table used to be the sole registry, which made deleting a
   *    drawer's allowlist rows delete the drawer from Settings/Opening
   *    entirely. Money rows (and the policy constant) now keep a drawer
   *    alive on their own.
   */
  getAllDrawerCurrencies(): Record<string, string[]> {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT drawer_name, currency_code FROM currency_drawers WHERE tenant_id = ? ORDER BY drawer_name, currency_code`,
      )
      .all(tenantId) as {
      drawer_name: string;
      currency_code: string;
    }[];

    const result: Record<string, string[]> = {};
    for (const row of rows) {
      if (!result[row.drawer_name]) result[row.drawer_name] = [];
      result[row.drawer_name].push(row.currency_code);
    }

    for (const name of this.getConfiguredDrawerNames()) {
      if (!result[name]) result[name] = [];
    }

    for (const name of Object.keys(result)) {
      if (isUnrestrictedDrawer(name)) {
        result[name] = this.derivedCurrencyCodesForDrawer(name);
      }
    }

    return result;
  }

  /** Get currency codes enabled for a specific drawer */
  getCurrenciesForDrawer(drawerName: string): string[] {
    if (isUnrestrictedDrawer(drawerName)) {
      return this.derivedCurrencyCodesForDrawer(drawerName);
    }
    const rows = this.db
      .prepare(
        `SELECT currency_code FROM currency_drawers WHERE drawer_name = ? AND tenant_id = ? ORDER BY currency_code`,
      )
      .all(drawerName, getCurrentTenantId()) as { currency_code: string }[];
    return rows.map((r) => r.currency_code);
  }

  /** Get full active currency entities for a drawer (mirrors getCurrenciesForModule) */
  getFullCurrenciesForDrawer(drawerName: string): CurrencyEntity[] {
    const tenantId = getCurrentTenantId();

    // Unrestricted drawer: the derived set, resolved to entities. Mirrors
    // `derivedCurrencyCodesForDrawer` exactly (active, OR still held here) so
    // the picker offers precisely what the top-up gate will accept.
    if (isUnrestrictedDrawer(drawerName)) {
      return this.db
        .prepare(
          `
      SELECT c.id, c.code, c.name, c.symbol, c.decimal_places, c.is_active
      FROM currencies c
      WHERE c.tenant_id = ?
        AND (c.is_active = 1
             OR c.code IN (SELECT currency_code FROM drawer_balances
                           WHERE drawer_name = ? AND tenant_id = ? AND balance != 0))
      ORDER BY c.code
    `,
        )
        .all(tenantId, drawerName, tenantId) as CurrencyEntity[];
    }

    return this.db
      .prepare(
        `
      SELECT c.id, c.code, c.name, c.symbol, c.decimal_places, c.is_active
      FROM currencies c
      JOIN currency_drawers cd ON c.code = cd.currency_code AND cd.tenant_id = c.tenant_id
      WHERE cd.drawer_name = ? AND c.is_active = 1 AND c.tenant_id = ?
      ORDER BY c.code
    `,
      )
      .all(drawerName, tenantId) as CurrencyEntity[];
  }

  /** Get drawer names enabled for a specific currency */
  getDrawersForCurrency(code: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT drawer_name FROM currency_drawers WHERE currency_code = ? AND tenant_id = ? ORDER BY drawer_name`,
      )
      .all(code.toUpperCase(), getCurrentTenantId()) as {
      drawer_name: string;
    }[];
    return rows.map((r) => r.drawer_name);
  }

  /** Set currencies for a drawer (replace all) */
  setCurrenciesForDrawer(drawerName: string, currencies: string[]): void {
    const tenantId = getCurrentTenantId();
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM currency_drawers WHERE drawer_name = ? AND tenant_id = ?`,
        )
        .run(drawerName, tenantId);
      const insert = this.db.prepare(
        `INSERT INTO currency_drawers (currency_code, drawer_name, tenant_id) VALUES (?, ?, ?)`,
      );
      for (const code of currencies) {
        insert.run(code.toUpperCase(), drawerName, tenantId);
      }
    })();
  }

  /**
   * The drawer **registry** — every drawer the app should render a card for.
   *
   * Unioned from three sources, because `currency_drawers` alone was
   * load-bearing in a way nothing enforced: it was the sole registry, so
   * deleting a drawer's allowlist rows (or setting an unrestricted drawer's
   * list to empty) made the drawer disappear from Settings and Opening
   * altogether. Now:
   *  - `currency_drawers` — configured provider drawers (this is the ONLY
   *    source for a drawer that has never held money, e.g. a freshly seeded
   *    `Loto`),
   *  - `drawer_balances`  — anything that has ever held money, so a drawer
   *    with real cash can never be un-registered by a config edit,
   *  - `UNRESTRICTED_DRAWERS` — General has no allowlist rows to depend on by
   *    design, so it is registered structurally.
   *
   * Deliberately does NOT introduce a new hardcoded drawer-name list: the
   * registry is already duplicated across `PRIMARY_CASH_DRAWER_NAMES`,
   * `CARRIER_DRAWER_NAMES`, `WalletDrawerName`, `SalesRepository`'s static
   * allow-list and the frontend's `DRAWER_LABELS`. A sixth copy would make
   * rule 14 worse; consolidating them into a real `drawers` table is the
   * named follow-up in the plan doc's non-goals.
   */
  getConfiguredDrawerNames(): string[] {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT DISTINCT drawer_name FROM currency_drawers WHERE tenant_id = ?
         UNION
         SELECT DISTINCT drawer_name FROM drawer_balances  WHERE tenant_id = ?
         ORDER BY drawer_name`,
      )
      .all(tenantId, tenantId) as { drawer_name: string }[];

    const names = new Set(rows.map((r) => r.drawer_name));
    for (const name of UNRESTRICTED_DRAWERS) names.add(name);
    return [...names].sort();
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
