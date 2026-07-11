/**
 * Tenant Repository — control plane.
 *
 * `tenants` is the registry table itself: it has NO `tenant_id` column (it
 * IS the tenant), so this repository deliberately does NOT extend
 * `BaseRepository` (whose generic CRUD centrally injects a `tenant_id`
 * predicate — meaningless here) and does not call `getCurrentTenantId()`.
 * Every method operates across every tenant explicitly, by id/slug — this is
 * the one repository plan §5 allows inside `runWithoutTenant()`.
 *
 * `scripts/check-tenant-scoping.mjs` never flags statements against `tenants`
 * itself (it's in the checker's `NON_TENANT_TABLES` exempt set). The
 * `listAll()` stats subqueries below DO touch `users`/`transactions` — both
 * tenant-scoped tables in the checker's list — but each subquery is
 * correlated to the tenant row being aggregated (`t.id`), not the caller's
 * ambient tenant context, so the literal `tenant_id` predicate is present in
 * every row's SQL text and the checker resolves them as `ok`.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { DatabaseError } from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

export type TenantStatus = "active" | "suspended" | "archived";

export interface TenantEntity {
  id: number;
  name: string;
  slug: string;
  status: TenantStatus;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantWithStats extends TenantEntity {
  user_count: number;
  last_activity: string | null;
}

export interface CreateTenantData {
  name: string;
  slug: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

export interface UpdateTenantData {
  name?: string;
  status?: TenantStatus;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// =============================================================================
// Repository
// =============================================================================

export class TenantRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateTenantData): TenantEntity {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tenants (name, slug, contact_name, contact_phone, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(
        data.name,
        data.slug,
        data.contact_name ?? null,
        data.contact_phone ?? null,
        data.notes ?? null,
      );
      const created = this.getById(result.lastInsertRowid as number);
      if (!created) {
        throw new DatabaseError("Created tenant row could not be reloaded", {
          entityId: result.lastInsertRowid as number,
        });
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create tenant", { cause: error });
    }
  }

  getById(id: number): TenantEntity | null {
    try {
      return (
        (this.db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(id) as
          | TenantEntity
          | undefined) ?? null
      );
    } catch (error) {
      throw new DatabaseError("Failed to load tenant by id", {
        cause: error,
        entityId: id,
      });
    }
  }

  getBySlug(slug: string): TenantEntity | null {
    try {
      return (
        (this.db.prepare(`SELECT * FROM tenants WHERE slug = ?`).get(slug) as
          | TenantEntity
          | undefined) ?? null
      );
    } catch (error) {
      throw new DatabaseError("Failed to load tenant by slug", {
        cause: error,
      });
    }
  }

  existsBySlug(slug: string): boolean {
    try {
      return (
        this.db.prepare(`SELECT 1 FROM tenants WHERE slug = ?`).get(slug) !==
        undefined
      );
    } catch (error) {
      throw new DatabaseError("Failed to check tenant slug existence", {
        cause: error,
      });
    }
  }

  /**
   * List every tenant with per-tenant stats: active user count and last
   * transaction activity. Both subqueries are correlated to `t.id` — this
   * repository never resolves "the current tenant"; it enumerates ALL of
   * them, one row of stats per tenant, by construction.
   */
  listAll(): TenantWithStats[] {
    try {
      return this.db
        .prepare(
          `
          SELECT
            t.*,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = 1) AS user_count,
            (SELECT MAX(tr.created_at) FROM transactions tr WHERE tr.tenant_id = t.id) AS last_activity
          FROM tenants t
          ORDER BY t.id ASC
          `,
        )
        .all() as TenantWithStats[];
    } catch (error) {
      throw new DatabaseError("Failed to list tenants", { cause: error });
    }
  }

  update(id: number, data: UpdateTenantData): TenantEntity | null {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (data.name !== undefined) {
        fields.push("name = ?");
        values.push(data.name);
      }
      if (data.status !== undefined) {
        fields.push("status = ?");
        values.push(data.status);
      }
      if (data.contact_name !== undefined) {
        fields.push("contact_name = ?");
        values.push(data.contact_name);
      }
      if (data.contact_phone !== undefined) {
        fields.push("contact_phone = ?");
        values.push(data.contact_phone);
      }
      if (data.notes !== undefined) {
        fields.push("notes = ?");
        values.push(data.notes);
      }

      if (fields.length === 0) {
        return this.getById(id);
      }

      fields.push("updated_at = CURRENT_TIMESTAMP");
      const stmt = this.db.prepare(
        `UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`,
      );
      stmt.run(...values, id);
      return this.getById(id);
    } catch (error) {
      throw new DatabaseError("Failed to update tenant", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Run `fn` inside a single SQLite transaction. Used by
   * `TenantProvisioningService.provisionTenant()` so tenant row + config
   * seed + tenant-admin user creation commit or roll back together — this is
   * the ONE place `db.transaction(...)` is invoked; the service itself never
   * touches the database directly (CLAUDE.md rule 13).
   */
  runInTransaction<R>(fn: () => R): R {
    return this.db.transaction(fn)();
  }

  /**
   * Seed the per-tenant CONFIG rows for a freshly-provisioned tenant.
   *
   * Values are extracted verbatim from `electron-app/create_db.sql`'s tenant-1
   * seed (the desktop fresh-install path), parameterized on `tenantId` in
   * place of the literal `1`. Deliberately excludes:
   *   - the example `suppliers` rows (iPick/Katsh/OMT/Whish/...) — sample
   *     data, not config;
   *   - the default `users`/`admin` row — the tenant admin is created
   *     separately by `TenantProvisioningService` with a real hashed password
   *     from the provisioning request.
   *
   * One deliberate deviation from a byte-literal copy: `system_settings`'s
   * `shop_name` seeds to the tenant's own `name` (via the `shopName` param)
   * rather than the desktop fixture's literal `'Corner Tech'` — every other
   * tenant would otherwise show a stranger's shop name until manually fixed
   * in Settings. Every other seeded value is unchanged from create_db.sql.
   *
   * Every INSERT is a fully static string (no interpolated table/column
   * names) with `tenant_id` explicit in the column list, per
   * scripts/check-tenant-scoping.mjs's static-analysis requirements.
   */
  seedConfig(tenantId: number, shopName: string): void {
    try {
      this.seedCurrencies(tenantId);
      this.seedExchangeRates(tenantId);
      this.seedProductCategories(tenantId);
      this.seedServicePresets(tenantId);
      this.seedDrawerBalances(tenantId);
      this.seedModules(tenantId);
      this.seedCurrencyModules(tenantId);
      this.seedCurrencyDrawers(tenantId);
      this.seedPaymentMethods(tenantId);
      this.seedSystemSettings(tenantId, shopName);
      this.seedLotoSettings(tenantId);
    } catch (error) {
      throw new DatabaseError("Failed to seed tenant config", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Config seed — one static statement per table (create_db.sql §-numbered
  // sections referenced in each comment for cross-checking against drift).
  // ---------------------------------------------------------------------------

  private seedCurrencies(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const rows: [string, string, string, number, number][] = [
      ["USD", "US Dollar", "$", 2, 1],
      ["LBP", "Lebanese Pound", "LBP", 0, 1],
      ["EUR", "Euro", "€", 2, 1],
      ["USDT", "Tether USD", "USDT", 2, 1],
    ];
    for (const [code, name, symbol, decimalPlaces, isActive] of rows) {
      stmt.run(tenantId, code, name, symbol, decimalPlaces, isActive);
    }
  }

  private seedExchangeRates(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(tenantId, "LBP", 89500, 89000, 90000, 1);
    stmt.run(tenantId, "EUR", 1.18, 1.16, 1.2, -1);
  }

  private seedProductCategories(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO product_categories (tenant_id, name, sort_order)
      VALUES (?, ?, ?)
    `);
    const rows: [string, number][] = [
      ["Accessories", 0],
      ["Phones", 1],
      ["Chargers", 2],
      ["Audio", 3],
      ["Parts", 4],
      ["Services", 5],
    ];
    for (const [name, sortOrder] of rows) {
      stmt.run(tenantId, name, sortOrder);
    }
  }

  private seedServicePresets(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO service_presets (tenant_id, name, category, cost_usd, price_usd, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const rows: [string, string, number, number, number][] = [
      ["Netflix Premium 1 Month", "digital_account", 7, 9, 0],
      ["Netflix Standard 1 Month", "digital_account", 5, 7, 1],
      ["Spotify Premium 1 Month", "digital_account", 3, 5, 2],
      ["Shahid VIP 1 Month", "digital_account", 4, 6, 3],
    ];
    for (const [name, category, costUsd, priceUsd, sortOrder] of rows) {
      stmt.run(tenantId, name, category, costUsd, priceUsd, sortOrder);
    }
  }

  private seedDrawerBalances(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
      VALUES (?, ?, ?, 0)
    `);
    const rows: [string, string][] = [
      ["General", "USD"],
      ["General", "LBP"],
      ["OMT_System", "USD"],
      ["OMT_System", "LBP"],
      ["OMT_App", "USD"],
      ["OMT_App", "LBP"],
      ["Whish_App", "USD"],
      ["Whish_App", "LBP"],
      ["Binance", "USDT"],
      ["MTC", "USD"],
      ["Alfa", "USD"],
      ["iPick", "USD"],
      ["iPick", "LBP"],
      ["Katsh", "USD"],
      ["Katsh", "LBP"],
      ["Whish_System", "USD"],
      ["Whish_System", "LBP"],
    ];
    for (const [drawerName, currencyCode] of rows) {
      stmt.run(tenantId, drawerName, currencyCode);
    }
  }

  private seedModules(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO modules (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows: [
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
    ][] = [
      // System modules (always visible, not toggleable)
      ["dashboard", "Dashboard", "LayoutDashboard", "/", 0, 1, 0, 1],
      ["closing", "Closing", "SquareActivity", "", 99, 1, 1, 1],
      ["audit", "Audit & Transactions", "Shield", "/audit", 97, 1, 1, 1],
      ["settings", "Settings", "Settings", "/settings", 100, 1, 1, 1],
      // Toggleable modules
      ["pos", "Point of Sale", "ShoppingCart", "/pos", 1, 1, 0, 0],
      ["debts", "Accounts", "BookOpen", "/debts", 2, 1, 0, 0],
      ["inventory", "Inventory", "Package", "/products", 3, 1, 0, 0],
      ["clients", "Clients", "Users", "/clients", 4, 1, 0, 0],
      ["exchange", "Exchange", "RefreshCw", "/exchange", 5, 1, 0, 0],
      ["omt_whish", "OMT/Whish", "Send", "/services", 6, 1, 0, 0],
      ["recharge", "MTC/Alfa", "Smartphone", "/recharge", 7, 0, 0, 0],
      ["expenses", "Expenses", "Banknote", "/expenses", 8, 1, 0, 0],
      ["maintenance", "Maintenance", "Wrench", "/maintenance", 9, 1, 0, 0],
      ["binance", "Binance", "Bitcoin", "/recharge", 10, 0, 0, 0],
      ["ipec_katch", "iPick/Katsh", "Zap", "/recharge", 11, 0, 0, 0],
      [
        "custom_services",
        "Services",
        "Briefcase",
        "/custom-services",
        12,
        1,
        0,
        0,
      ],
      ["profits", "Profits", "TrendingUp", "/profits", 13, 1, 1, 0],
      [
        "customer_sessions",
        "Sessions",
        "UserCheck",
        "/customer-sessions",
        14,
        1,
        0,
        0,
      ],
      ["partners", "Partners", "Handshake", "/partners", 15, 1, 0, 0],
      ["loto", "Loto", "Ticket", "/loto", 16, 1, 0, 0],
      ["suppliers", "Suppliers", "Truck", "/suppliers", 17, 1, 0, 0],
      ["vouchers", "Vouchers", "Gift", "/vouchers", 18, 1, 0, 0],
    ];
    for (const [
      key,
      label,
      icon,
      route,
      sortOrder,
      isEnabled,
      adminOnly,
      isSystem,
    ] of rows) {
      stmt.run(
        tenantId,
        key,
        label,
        icon,
        route,
        sortOrder,
        isEnabled,
        adminOnly,
        isSystem,
      );
    }
  }

  private seedCurrencyModules(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO currency_modules (tenant_id, currency_code, module_key)
      VALUES (?, ?, ?)
    `);
    const usdModules = [
      "pos",
      "debts",
      "exchange",
      "omt_whish",
      "recharge",
      "expenses",
      "maintenance",
      "binance",
      "ipec_katch",
      "custom_services",
      "closing",
      "loto",
      "vouchers",
    ];
    const lbpModules = [
      "pos",
      "debts",
      "exchange",
      "expenses",
      "maintenance",
      "ipec_katch",
      "custom_services",
      "recharge",
      "closing",
      "loto",
    ];
    const eurModules = ["exchange"];
    for (const moduleKey of usdModules) stmt.run(tenantId, "USD", moduleKey);
    for (const moduleKey of lbpModules) stmt.run(tenantId, "LBP", moduleKey);
    for (const moduleKey of eurModules) stmt.run(tenantId, "EUR", moduleKey);
  }

  private seedCurrencyDrawers(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO currency_drawers (tenant_id, currency_code, drawer_name)
      VALUES (?, ?, ?)
    `);
    const rows: [string, string][] = [
      ["USD", "General"],
      ["LBP", "General"],
      ["USD", "OMT_System"],
      ["LBP", "OMT_System"],
      ["USD", "OMT_App"],
      ["LBP", "OMT_App"],
      ["USD", "Whish_App"],
      ["LBP", "Whish_App"],
      ["USDT", "Binance"],
      ["USD", "MTC"],
      ["USD", "Alfa"],
      ["USD", "iPick"],
      ["LBP", "iPick"],
      ["USD", "Katsh"],
      ["LBP", "Katsh"],
      ["USD", "Whish_System"],
      ["LBP", "Whish_System"],
      // Loto's drawer mapping is registered separately in create_db.sql
      // (not part of the main block above) — not a duplicate.
      ["USD", "Loto"],
      ["LBP", "Loto"],
    ];
    for (const [currencyCode, drawerName] of rows) {
      stmt.run(tenantId, currencyCode, drawerName);
    }
  }

  private seedPaymentMethods(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_system, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows: [string, string, string, number, number, number, number][] = [
      ["CASH", "Cash", "General", 1, 0, 1, 1],
      ["OMT", "OMT Wallet", "OMT_App", 1, 1, 0, 1],
      ["WHISH", "Whish Wallet", "Whish_App", 1, 2, 0, 1],
      ["BINANCE", "Binance", "Binance", 1, 3, 0, 1],
      ["CUSTOMER_ACCOUNT", "Customer Account", "General", 0, 4, 1, 1],
      ["GIFT_CARD", "Gift Card / Voucher", "General", 0, 5, 1, 1],
    ];
    for (const [
      code,
      label,
      drawerName,
      affectsDrawer,
      sortOrder,
      isSystem,
      isActive,
    ] of rows) {
      stmt.run(
        tenantId,
        code,
        label,
        drawerName,
        affectsDrawer,
        sortOrder,
        isSystem,
        isActive,
      );
    }
  }

  private seedSystemSettings(tenantId: number, shopName: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO system_settings (tenant_id, key_name, value)
      VALUES (?, ?, ?)
    `);
    // shop_name deviates from create_db.sql's literal 'Corner Tech' — seeded
    // from the tenant's own name instead (see seedConfig's doc comment).
    stmt.run(tenantId, "shop_name", shopName);
    stmt.run(tenantId, "default_debt_term_days", "30");
    stmt.run(tenantId, "shop_base_system", "OMT");
  }

  private seedLotoSettings(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO loto_settings (tenant_id, key_name, value, description)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(tenantId, "commission_rate", "0.0445", "Commission rate (4.45%)");
    stmt.run(
      tenantId,
      "monthly_fee_amount",
      "1400000",
      "Monthly machine fee in LBP",
    );
    stmt.run(
      tenantId,
      "auto_record_monthly_fee",
      "1",
      "Enable/disable auto-recording of monthly fee",
    );
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: TenantRepository | null = null;

export function getTenantRepository(): TenantRepository {
  if (!instance) {
    instance = new TenantRepository(getDatabase());
  }
  return instance;
}

export function resetTenantRepository(): void {
  instance = null;
}
