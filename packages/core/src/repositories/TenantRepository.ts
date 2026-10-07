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
 * `listAll()` stats subqueries below DO touch
 * `users`/`transactions`/`sessions`/`audit_log` — all tenant-scoped tables in
 * the checker's list — but each subquery is
 * correlated to the tenant row being aggregated (`t.id`), not the caller's
 * ambient tenant context, so the literal `tenant_id` predicate is present in
 * every row's SQL text and the checker resolves them as `ok`.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { seedSystemSuppliers } from "../db/systemSuppliers.js";
import { DatabaseError, EmailAlreadyHasShopError } from "../utils/errors.js";
import { TELECOM_CREDIT_COST_RATE_LBP } from "../utils/telecomCredit.js";

// =============================================================================
// Types
// =============================================================================

/**
 * 'provisioning' (migration v187) is a transient PLATFORM-only status: the
 * window between the registry row committing and the shop's own database
 * file existing (per-tenant mode only — see `perTenantStorageProvisioner.ts`
 * in the backend). Login already refuses anything but 'active'
 * (backend/src/api/auth.ts), so this needs no separate enforcement here.
 */
export type TenantStatus = "provisioning" | "active" | "suspended" | "archived";

export interface TenantEntity {
  id: number;
  name: string;
  slug: string;
  status: TenantStatus;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  /** v195 (LIRA-267): lowercased; NULL for shops created without one. */
  contact_email: string | null;
  /** v197 (LIRA-280): UTC ISO instant the shop was created with Google;
   * NULL for every other shop. Counted by the public sign-up daily cap. */
  google_signup_at?: string | null;
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
  /** Must already be trimmed + lowercased (the service normalises it). */
  contact_email?: string | null;
  /** v197: set only for a shop created with Google (UTC ISO). */
  google_signup_at?: string | null;
}

/**
 * True for SQLite's UNIQUE violation on `idx_tenants_contact_email`. A slug
 * collision raises the same SQLITE_CONSTRAINT_UNIQUE code, so the column
 * named in the message is what tells the two apart.
 *
 * Duck-typed on purpose, NOT `instanceof Error`: with the `instanceof`
 * check this mapping flaked to a plain DATABASE_ERROR in the full core jest
 * suite (2 of 3 runs) while passing alone. Likely cause (unverified):
 * better-sqlite3's native addon is loaded once per jest worker, so its
 * `SqliteError` can come from another test file's vm realm and fail
 * `instanceof Error` there. Checking `code` + `message` works either way.
 */
function isContactEmailUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" &&
    typeof message === "string" &&
    message.includes("tenants.contact_email")
  );
}

export interface UpdateTenantData {
  name?: string;
  status?: TenantStatus;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// =============================================================================
// Module seed
// =============================================================================

export interface ModuleSeedRow {
  key: string;
  label: string;
  icon: string;
  route: string;
  sortOrder: number;
  isEnabled: 0 | 1;
  adminOnly: 0 | 1;
  isSystem: 0 | 1;
}

/**
 * The `modules` catalog for a freshly-provisioned (web) tenant.
 *
 * This is the single source `seedModules()` below derives its rows from —
 * that much CLAUDE.md rule 14 buys within this file. It does NOT reach the
 * other two definitions of the same catalog, because neither is a TS module
 * this file can import into:
 *
 *   - `electron-app/create_db.sql` is raw SQL executed directly by
 *     better-sqlite3 at fresh-install time; there is no runtime import path
 *     from a `.sql` seed file to a TS constant.
 *   - The ~10 `INSERT OR IGNORE INTO modules` sites in
 *     `packages/core/src/db/migrations/index.ts` are historical snapshots —
 *     each one is what a given migration version shipped at the time (some
 *     with fewer columns than the current schema) and MUST stay frozen, not
 *     re-derived from "current". Only the *latest* migration touching a row
 *     needs to agree with this constant's value for that row; earlier ones
 *     are deliberately not candidates for unification.
 *
 * Real unification would need a generator (e.g. a script that emits the
 * `create_db.sql` block from this constant, checked by CI) — that is a
 * cross-file build-tooling change outside this repository's scope; see the
 * task notes for where it should land.
 */
export const MODULE_SEED_ROWS: readonly ModuleSeedRow[] = [
  // System modules (always visible, not toggleable)
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    route: "/",
    sortOrder: 0,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 1,
  },
  {
    key: "closing",
    label: "Closing",
    icon: "SquareActivity",
    route: "",
    sortOrder: 99,
    isEnabled: 1,
    adminOnly: 1,
    isSystem: 1,
  },
  // v178 (LIRA-198): admin_only = 0 so staff see the Audit & Transactions
  // nav entry — matches create_db.sql's tenant-1 seed and the target state
  // migration v178 leaves existing tenants in. The per-channel role checks
  // in auditHandlers.ts / backend/src/api/audit.ts are a separate gate.
  {
    key: "audit",
    label: "Audit & Transactions",
    icon: "Shield",
    route: "/audit",
    sortOrder: 97,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 1,
  },
  {
    key: "settings",
    label: "Settings",
    icon: "Settings",
    route: "/settings",
    sortOrder: 100,
    isEnabled: 1,
    adminOnly: 1,
    isSystem: 1,
  },
  // Toggleable modules
  {
    key: "pos",
    label: "Point of Sale",
    icon: "ShoppingCart",
    route: "/pos",
    sortOrder: 1,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "debts",
    label: "Accounts",
    icon: "BookOpen",
    route: "/debts",
    sortOrder: 2,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: "Package",
    route: "/products",
    sortOrder: 3,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "clients",
    label: "Clients",
    icon: "Users",
    route: "/clients",
    sortOrder: 4,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "exchange",
    label: "Exchange",
    icon: "RefreshCw",
    route: "/exchange",
    sortOrder: 5,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "omt_whish",
    label: "OMT/Whish",
    icon: "Send",
    route: "/omt-whish",
    sortOrder: 6,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "recharge",
    label: "MTC/Alfa",
    icon: "Smartphone",
    route: "/recharge",
    sortOrder: 7,
    isEnabled: 0,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: "Banknote",
    route: "/expenses",
    sortOrder: 8,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "maintenance",
    label: "Maintenance",
    icon: "Wrench",
    route: "/maintenance",
    sortOrder: 9,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "binance",
    label: "Binance",
    icon: "Bitcoin",
    route: "/recharge",
    sortOrder: 10,
    isEnabled: 0,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "ipec_katch",
    label: "iPick/Katsh",
    icon: "Zap",
    route: "/recharge",
    sortOrder: 11,
    isEnabled: 0,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "custom_services",
    label: "Services",
    icon: "Briefcase",
    route: "/custom-services",
    sortOrder: 12,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  // v163 (PROFITS_GATE frozen contract): admin_only = 0. The page is visible
  // to both roles and gated by a per-page password (ProfitsAccessService)
  // instead of by role — matches create_db.sql's tenant-1 seed.
  {
    key: "profits",
    label: "Profits",
    icon: "TrendingUp",
    route: "/profits",
    sortOrder: 13,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "customer_sessions",
    label: "Sessions",
    icon: "UserCheck",
    route: "/customer-sessions",
    sortOrder: 14,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "partners",
    label: "Partners",
    icon: "Handshake",
    route: "/partners",
    sortOrder: 15,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "loto",
    label: "Loto",
    icon: "Ticket",
    route: "/loto",
    sortOrder: 16,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "suppliers",
    label: "Suppliers",
    icon: "Truck",
    route: "/suppliers",
    sortOrder: 17,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
  {
    key: "vouchers",
    label: "Vouchers",
    icon: "Gift",
    route: "/vouchers",
    sortOrder: 18,
    isEnabled: 1,
    adminOnly: 0,
    isSystem: 0,
  },
];

// =============================================================================
// Repository
// =============================================================================

export class TenantRepository {
  /** Explicit override for tests only; default resolves live (§ 11.2). */
  private readonly _db?: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  create(data: CreateTenantData): TenantEntity {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tenants (name, slug, contact_name, contact_phone, notes, contact_email, google_signup_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(
        data.name,
        data.slug,
        data.contact_name ?? null,
        data.contact_phone ?? null,
        data.notes ?? null,
        data.contact_email ?? null,
        data.google_signup_at ?? null,
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
      if (isContactEmailUniqueViolation(error)) {
        throw new EmailAlreadyHasShopError();
      }
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
   * List every tenant with per-tenant stats: active user count and when the
   * tenant was last USED. Every subquery is correlated to `t.id` — this
   * repository never resolves "the current tenant"; it enumerates ALL of
   * them, one row of stats per tenant, by construction.
   *
   * `last_activity` was the newest `transactions.created_at` alone, which
   * answered "when did this shop last SELL something". That is not the
   * question a super admin is asking of a control-plane list: a shop whose
   * staff sign in every day but have not rung up a sale yet showed a bare
   * dash, indistinguishable from one nobody has ever opened. It now takes the
   * latest of three signals:
   *
   *   transactions  real trade.
   *   sessions      someone is signed in and browsing; `last_activity_at`
   *                 slides on every authenticated request. Rows are deleted on
   *                 logout/expiry, so this covers "right now", not history.
   *   audit_log     durable. Records logins (action 'login') among much else,
   *                 and outlives the session that produced it, so a tenant
   *                 that signed in last week still reports it.
   *
   * Together they degrade sensibly: sessions give live presence, audit gives
   * history, transactions give trade.
   *
   * WHY EVERY VALUE GOES THROUGH `datetime()`. These columns do not share a
   * format — `transactions.created_at` and `audit_log.created_at` are SQLite's
   * "YYYY-MM-DD HH:MM:SS", while `sessions.last_activity_at` is a JS ISO string
   * ("...THH:MM:SS.sssZ"). `MAX()` over raw text compares them as STRINGS, and
   * 'T' (0x54) sorts above ' ' (0x20), so the session value would win every
   * same-day comparison no matter which moment was actually later:
   *
   *   MAX('2026-09-10T00:45:43.133Z', '2026-09-10 23:00:00') = the 00:45 one.
   *
   * `datetime()` parses both shapes and emits one canonical UTC form — which is
   * also exactly what the frontend's `parseDbDate` expects. It yields NULL for
   * anything unparseable, so a malformed row is ignored rather than poisoning
   * the maximum.
   *
   * COALESCE-to-'' then NULLIF back: scalar `MAX()` returns NULL if ANY
   * argument is NULL, so a tenant with no transactions would otherwise report
   * no activity at all despite being actively used. '' sorts below every real
   * timestamp, and NULLIF restores a true NULL for a tenant with nothing
   * anywhere — which the UI renders as a dash.
   */
  listAll(): TenantWithStats[] {
    try {
      return this.db
        .prepare(
          `
          SELECT
            t.*,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = 1) AS user_count,
            NULLIF(
              MAX(
                COALESCE((SELECT MAX(datetime(tr.created_at))      FROM transactions tr WHERE tr.tenant_id = t.id), ''),
                COALESCE((SELECT MAX(datetime(s.last_activity_at)) FROM sessions s      WHERE s.tenant_id  = t.id), ''),
                COALESCE((SELECT MAX(datetime(a.created_at))       FROM audit_log a     WHERE a.tenant_id  = t.id), '')
              ),
              ''
            ) AS last_activity
          FROM tenants t
          ORDER BY t.id ASC
          `,
        )
        .all() as TenantWithStats[];
    } catch (error) {
      throw new DatabaseError("Failed to list tenants", { cause: error });
    }
  }

  /**
   * Every tenant registry row, WITHOUT the cross-tenant stats subqueries
   * `listAll()` runs. Used by `TenantStatsService` in per-tenant mode, where
   * `listAll()`'s subqueries would read the (empty, in that mode) PLATFORM
   * copies of `users`/`transactions`/`sessions`/`audit_log` instead of each
   * shop's own file — harmless (the caller overwrites user_count/
   * last_activity from a per-shop fan-out anyway, see `getShopStats` below)
   * but pure waste, and confusing to read stats columns here that this
   * method makes no attempt to fill in correctly. Shared mode never calls
   * this — `listAll()` is already complete there.
   */
  listAllRows(): TenantEntity[] {
    try {
      return this.db
        .prepare(`SELECT * FROM tenants ORDER BY id ASC`)
        .all() as TenantEntity[];
    } catch (error) {
      throw new DatabaseError("Failed to list tenant rows", { cause: error });
    }
  }

  /**
   * The SAME two stats `listAll()` computes per row (active user count, most
   * recent of transactions/sessions/audit_log activity — see that method's
   * doc comment for the full "why datetime()" / COALESCE-then-NULLIF
   * rationale, unchanged here), but for a SINGLE tenant, queried from
   * whatever database is ambient when this is called.
   *
   * Per-tenant mode's use (`TenantStatsService`): call this from INSIDE
   * `runWithTenant(tenantId, ...)`, so `this.db` resolves to that shop's OWN
   * file — at which point every row in it already belongs to `tenantId` (§
   * 11.4 decision A-D1: a shop's file keeps its real id on every row), so
   * `tenantId` is passed explicitly as the query parameter rather than
   * re-deriving it from context, keeping this repository's "no ambient
   * tenant id" rule (this class never calls `getCurrentTenantId()`) intact.
   */
  getShopStats(tenantId: number): {
    user_count: number;
    last_activity: string | null;
  } {
    try {
      return this.db
        .prepare(
          `
          SELECT
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = ? AND u.is_active = 1) AS user_count,
            NULLIF(
              MAX(
                COALESCE((SELECT MAX(datetime(tr.created_at))      FROM transactions tr WHERE tr.tenant_id = ?), ''),
                COALESCE((SELECT MAX(datetime(s.last_activity_at)) FROM sessions s      WHERE s.tenant_id  = ?), ''),
                COALESCE((SELECT MAX(datetime(a.created_at))       FROM audit_log a     WHERE a.tenant_id  = ?), '')
              ),
              ''
            ) AS last_activity
          `,
        )
        .get(tenantId, tenantId, tenantId, tenantId) as {
        user_count: number;
        last_activity: string | null;
      };
    } catch (error) {
      throw new DatabaseError("Failed to compute tenant stats", {
        cause: error,
        entityId: tenantId,
      });
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
   * place of the literal `1`. Includes the system suppliers (OMT, Whish,
   * iPick, Katsh, the app wallets, Loto Liban) via `seedSystemSuppliers` —
   * the modules look them up by provider, so a shop without them cannot
   * settle with OMT. Deliberately excludes:
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
  /**
   * Change a tenant's slug.
   *
   * Separate from `update()` on purpose. The slug is a tenant's PUBLIC
   * address, not an attribute: changing it moves where its staff log in
   * and orphans any link anyone saved. Folding it into the general
   * update would let a rename ride along with an innocuous edit.
   *
   * The UNIQUE index is the real guard against collisions; this returns
   * the updated row so the caller can confirm what landed.
   */
  updateSlug(tenantId: number, slug: string): TenantEntity | null {
    try {
      this.db
        .prepare(
          `UPDATE tenants SET slug = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
        .run(slug, tenantId);
      return this.getById(tenantId);
    } catch (error) {
      throw new DatabaseError("Failed to change the tenant slug", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Every table that carries a `tenant_id`, discovered from the schema.
   *
   * Deliberately NOT a hand-written list. There are 68 such tables today and
   * the count only grows; a literal list would silently stop deleting from
   * whichever table was added last, leaving orphaned rows that the next
   * tenant to reuse that id would inherit. Asking the schema cannot go
   * stale.
   */
  private tenantScopedTables(): string[] {
    const tables = this.db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name != 'tenants'`,
      )
      .all() as { name: string }[];

    return tables
      .filter((t) => {
        const cols = this.db
          .prepare(`PRAGMA table_info("${t.name}")`)
          .all() as { name: string }[];
        return cols.some((c) => c.name === "tenant_id");
      })
      .map((t) => t.name);
  }

  /**
   * Delete a tenant and everything belonging to it, in ONE transaction.
   *
   * `defer_foreign_keys` is what makes this tractable. Foreign keys are ON at
   * runtime (backend/src/database/connection.ts), and these 68 tables
   * reference each other in ways no single delete order satisfies. Deferring
   * postpones every check to COMMIT: the deletes run in any order, and the
   * transaction still refuses to commit if it would leave a dangling
   * reference. The pragma is scoped to this transaction and resets itself,
   * so it cannot leak into other work the way `foreign_keys = OFF` would.
   *
   * All-or-nothing: a tenant half-deleted is worse than one not deleted,
   * because the leftovers are invisible in the UI and inherited by whoever
   * gets that id next.
   *
   * The CALLER is responsible for deciding whether deletion is allowed --
   * this method asks no questions (rule 13: policy is the service's job).
   */
  deleteTenantCascade(tenantId: number): {
    tablesCleared: number;
    rowsDeleted: number;
  } {
    try {
      const tables = this.tenantScopedTables();

      return this.db.transaction(() => {
        this.db.pragma("defer_foreign_keys = ON");

        let rowsDeleted = 0;
        for (const table of tables) {
          // Table names come from sqlite_master, never from a caller, so the
          // interpolation cannot carry user input. The VALUE stays bound.
          const result = this.db
            .prepare(`DELETE FROM "${table}" WHERE tenant_id = ?`)
            .run(tenantId);
          rowsDeleted += result.changes;
        }

        const gone = this.db
          .prepare(`DELETE FROM tenants WHERE id = ?`)
          .run(tenantId);
        if (gone.changes === 0) {
          // Nothing matched: roll back rather than report a success that
          // deleted a tenant's data but left the tenant itself.
          throw new DatabaseError("Tenant not found", { entityId: tenantId });
        }

        return { tablesCleared: tables.length, rowsDeleted };
      })();
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to delete tenant", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Removes ONLY the platform `tenants` row for `id` — no cascade, no
   * tenant-scoped table cleanup. Used exclusively by the per-tenant-mode
   * storage provisioner (`backend/src/database/perTenantStorageProvisioner.ts`):
   *
   *   - rolling back a FAILED provisioning attempt (§ 12.2's two-step
   *     create) — the failed tenant never had any tenant-scoped rows in the
   *     PLATFORM file to begin with, its would-be data lived only in the temp
   *     file that same rollback already deleted;
   *   - finishing a successful per-tenant DELETE, after the tenant's own
   *     database file has already been archived (B-D4).
   *
   * `deleteTenantCascade` is deliberately NOT reused for either case: in
   * per-tenant mode it would scan and (no-op) "clear" every PLATFORM table
   * that holds none of this tenant's data, and report a misleading
   * tablesCleared/rowsDeleted count for an operation whose real effect is a
   * file build/archive, not a row cascade.
   */
  deleteRegistryRow(id: number): void {
    try {
      this.db.prepare(`DELETE FROM tenants WHERE id = ?`).run(id);
    } catch (error) {
      throw new DatabaseError("Failed to delete tenant registry row", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Raises `tenants`' own AUTOINCREMENT high-water mark (`sqlite_sequence`)
   * so the NEXT insert is guaranteed to produce an id strictly greater than
   * `minId` — never lowers it. Used exclusively by the per-tenant-mode
   * storage provisioner (`backend/src/database/perTenantStorageProvisioner.ts`)
   * as the second half of the id-reuse-after-restore fix: `tenants.id` is
   * AUTOINCREMENT so the platform file itself never reissues an id on its
   * own, but the platform file and the `tenants/` directory (one file per
   * shop, plus `archive/`) are replicated as two SEPARATE Litestream streams
   * (§ 12.4). A platform-only restore rolls `sqlite_sequence` back to an
   * older snapshot while shop files newer than that snapshot are untouched
   * on disk — the very next ordinary provisioning call would otherwise
   * silently reissue one of those ids and `createTenant()`'s rename would
   * clobber that shop's live database (this is the exact scenario
   * `tenantIdReuseAfterRestore.adversarial.test.ts` reproduces).
   *
   * The CALLER computes `minId` from a directory scan (every live `<id>.db`
   * AND every archived `<id>-<timestamp>.db`, § 12.2 keeps that scan in the
   * backend, not here) and MUST call this inside the same platform
   * transaction that inserts the new `tenants` row, before that insert —
   * this only edits SQLite's own bookkeeping table, so ordering is what
   * makes it effective.
   *
   * `sqlite_sequence` has no declared UNIQUE index on `name` (it is SQLite's
   * own internal table, not one this schema defines), so this cannot use an
   * `ON CONFLICT` upsert: it updates the existing row if one exists for
   * `tenants` — `max(seq, ?)` is the two-argument SCALAR `max()`, evaluated
   * per row, never the aggregate — and falls back to inserting one only if
   * `UPDATE` matched nothing (a `tenants` table that has never had an
   * AUTOINCREMENT insert recorded, e.g. a schema built without ever seeding
   * the desktop default row).
   */
  raiseSequenceFloor(minId: number): void {
    try {
      const result = this.db
        .prepare(
          `UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'tenants'`,
        )
        .run(minId);
      if (result.changes === 0) {
        this.db
          .prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('tenants', ?)`)
          .run(minId);
      }
    } catch (error) {
      throw new DatabaseError("Failed to raise the tenants autoincrement floor", {
        cause: error,
        entityId: minId,
      });
    }
  }

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
      this.seedServiceProviders(tenantId);
      this.seedSystemSettings(tenantId, shopName);
      this.seedLotoSettings(tenantId);
      seedSystemSuppliers(this.db, tenantId);
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
    for (const row of MODULE_SEED_ROWS) {
      stmt.run(
        tenantId,
        row.key,
        row.label,
        row.icon,
        row.route,
        row.sortOrder,
        row.isEnabled,
        row.adminOnly,
        row.isSystem,
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

  /**
   * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 1 — seed the 9
   * built-in `service_providers` rows for a freshly-provisioned (web) tenant.
   * Mirrors `seedPaymentMethods` above and migration v153 / create_db.sql's
   * tenant-1 seed exactly: same codes, same drawer names (matching
   * `FinancialServiceRepository.mapDrawerName`'s hardcoded switch), same
   * is_system_provider flag (1 only for OMT/WHISH).
   */
  private seedServiceProviders(tenantId: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO service_providers (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows: [string, string, string, number, number, number, number][] = [
      ["OMT", "OMT", "OMT_System", 1, 1, 1, 0],
      ["WHISH", "Whish", "Whish_System", 1, 1, 1, 1],
      ["BOB", "BOB", "General", 0, 1, 1, 2],
      ["OTHER", "Other", "General", 0, 1, 1, 3],
      ["iPick", "iPick", "iPick", 0, 1, 1, 4],
      ["Katsh", "Katsh", "Katsh", 0, 1, 1, 5],
      ["WHISH_APP", "Whish App", "Whish_App", 0, 1, 1, 6],
      ["OMT_APP", "OMT App", "OMT_App", 0, 1, 1, 7],
      ["BINANCE", "Binance", "Binance", 0, 1, 1, 8],
    ];
    for (const [
      code,
      label,
      drawerName,
      isSystemProvider,
      isActive,
      isSystem,
      sortOrder,
    ] of rows) {
      stmt.run(
        tenantId,
        code,
        label,
        drawerName,
        isSystemProvider,
        isActive,
        isSystem,
        sortOrder,
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
    stmt.run(tenantId, "allow_out_of_stock_sales", "0");
    stmt.run(tenantId, "telecom_credit_sell_price_lbp", "100000");
    // R — the shop's cost of $1 of telecom credit (TELECOM_DAYS_COST_PLAN.md
    // §4.3/§4.6). Migration v144 seeds this for tenants that already exist;
    // a tenant provisioned AFTER that migration ran only gets it from here,
    // so the two must stay in step. Without it, days_cost_lbp cannot be
    // derived for the new tenant's catalog and every Only-Days item silently
    // reads "No split".
    stmt.run(
      tenantId,
      "telecom_credit_cost_rate_lbp",
      String(TELECOM_CREDIT_COST_RATE_LBP),
    );
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
    instance = new TenantRepository();
  }
  return instance;
}

export function resetTenantRepository(): void {
  instance = null;
}
