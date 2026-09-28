/**
 * LIRA-221 — drift guard between the two independent sources of the
 * tenant-1 module seed.
 *
 * The module seed has three historical definitions that nothing forces to
 * agree: `electron-app/create_db.sql`'s tenant-1 `INSERT`s,
 * `TenantRepository.MODULE_SEED_ROWS`, and ~10 historical
 * `INSERT OR IGNORE INTO modules` sites in `migrations/index.ts`. That is
 * exactly how `audit`/`profits` ended up with `admin_only = 1` for every
 * tenant provisioned after v163/v178 while tenant 1 (seeded by
 * create_db.sql) held `admin_only = 0` — see
 * `backend/src/__tests__/wp5_wp6_admin_tenant.api.test.ts`'s "seeds every
 * module row's admin_only / is_enabled / is_system identical to tenant 1's"
 * test, which caught that bug at the DB-row level after provisioning.
 *
 * LIRA-198 already unified `seedModules()` behind `MODULE_SEED_ROWS` WITHIN
 * `TenantRepository.ts` — that is as far as one file's ownership reaches.
 * This guard closes the other half: it parses create_db.sql's own tenant-1
 * seed text and compares it, column for column, against `MODULE_SEED_ROWS`
 * directly (no database, no migrations replay — a pure text/data compare),
 * so a change to either source that the other doesn't mirror is caught at
 * `yarn test` time rather than discovered later as a provisioned-tenant bug.
 *
 * Deliberately excludes:
 *  - The ~10 historical `INSERT OR IGNORE INTO modules` sites in
 *    `migrations/index.ts` — each is a frozen point-in-time snapshot of what
 *    that migration version shipped (some predate columns the current
 *    schema has); re-deriving them from "current" would itself be a bug
 *    (see the docblock above `MODULE_SEED_ROWS`).
 *  - The third `INSERT OR IGNORE INTO modules` site in create_db.sql itself
 *    (the "Seed Loto module" block near `loto_monthly_fees`, ~line 1947):
 *    it targets the SAME (tenant_id, key) primary key the toggleable-modules
 *    block above already inserted, so `INSERT OR IGNORE` makes it a
 *    permanent no-op by construction, and it doesn't even carry an
 *    `is_system` column — a historical remnant, not a second live
 *    definition. The ticket names only "the two `INSERT OR IGNORE INTO
 *    modules` blocks (tenant_id = 1)" for exactly this reason.
 *
 * Rule 17 (failing-first proof) — HOW this was proven, under this batch's
 * strict variant ("never make even a temporary edit to finished code to
 * prove a test"): both sources agree today (2026-09-23 note: "all 22 rows
 * agree on all 7 columns, so it passes today"), so there is no pre-fix bug
 * state on the real files to revert to. Editing create_db.sql or
 * MODULE_SEED_ROWS — even temporarily — to watch this fail is exactly what
 * that rule forbids. Instead, `parseCreateDbModuleSeed` (the parsing logic
 * this guard depends on) is proven capable of catching drift with an
 * inline SQL FIXTURE string that never touches a repo file — see the
 * "fixture-driven" describe block below, run FIRST against the parser and
 * observed failing before the real-file describe block was written.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODULE_SEED_ROWS,
  type ModuleSeedRow,
} from "../../repositories/TenantRepository.js";

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const CREATE_DB_SQL_REL = "electron-app/create_db.sql";

interface CreateDbModuleRow {
  key: string;
  label: string;
  icon: string;
  route: string;
  sort_order: number;
  is_enabled: number;
  admin_only: number;
  is_system: number;
}

const MODULES_INSERT_COLUMNS =
  "tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system";

/** Strip `-- ...` line comments so they never leak into a parsed tuple —
 *  create_db.sql has inline comments (e.g. the v178/v163 notes) sitting
 *  between VALUES tuples of the very blocks this guard parses. */
function stripSqlLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

/**
 * Parses every
 * `INSERT OR IGNORE INTO modules (tenant_id, key, label, icon, route,
 * sort_order, is_enabled, admin_only, is_system) VALUES (...), (...), ...;`
 * statement out of a create_db.sql-shaped string and returns one row per
 * tuple whose `tenant_id` is 1 (rows for any other tenant_id, if this ever
 * seeds more than tenant 1, are intentionally excluded — same scope as the
 * ticket).
 *
 * Exported so the fixture-driven tests below can prove it detects drift
 * without touching the real schema file.
 */
export function parseCreateDbModuleSeed(sql: string): CreateDbModuleRow[] {
  const clean = stripSqlLineComments(sql);
  const rows: CreateDbModuleRow[] = [];

  const blockRe = new RegExp(
    `INSERT OR IGNORE INTO modules \\(${MODULES_INSERT_COLUMNS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*VALUES\\s*([\\s\\S]*?);`,
    "g",
  );

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(clean)) !== null) {
    const tupleRe = /\(([^()]*)\)/g;
    let tupleMatch: RegExpExecArray | null;
    while ((tupleMatch = tupleRe.exec(blockMatch[1])) !== null) {
      const fields = tupleMatch[1].split(",").map((f) => f.trim());
      if (fields.length !== 9) {
        throw new Error(
          `parseCreateDbModuleSeed: expected 9 fields (${MODULES_INSERT_COLUMNS}), ` +
            `got ${fields.length}: "${tupleMatch[1]}"`,
        );
      }
      const [
        tenantId,
        key,
        label,
        icon,
        route,
        sortOrder,
        isEnabled,
        adminOnly,
        isSystem,
      ] = fields;
      if (tenantId !== "1") continue; // tenant-1 rows only, per the ticket

      const unquote = (s: string): string => {
        const m = s.match(/^'(.*)'$/);
        if (!m) {
          throw new Error(
            `parseCreateDbModuleSeed: expected a single-quoted string, got "${s}"`,
          );
        }
        return m[1];
      };

      rows.push({
        key: unquote(key),
        label: unquote(label),
        icon: unquote(icon),
        route: unquote(route),
        sort_order: Number(sortOrder),
        is_enabled: Number(isEnabled),
        admin_only: Number(adminOnly),
        is_system: Number(isSystem),
      });
    }
  }
  return rows;
}

/** MODULE_SEED_ROWS uses camelCase; create_db.sql/the modules table use
 *  snake_case. Convert once, here, so every comparison below is a plain
 *  structural `toEqual` rather than a hand-matched field list per test. */
function toSnakeCase(row: ModuleSeedRow): CreateDbModuleRow {
  return {
    key: row.key,
    label: row.label,
    icon: row.icon,
    route: row.route,
    sort_order: row.sortOrder,
    is_enabled: row.isEnabled,
    admin_only: row.adminOnly,
    is_system: row.isSystem,
  };
}

describe("parseCreateDbModuleSeed — fixture-driven (proves the parser/diff can fail without editing repo files)", () => {
  it("a drifted column on a matching key is detected as NOT equal", () => {
    // Mirrors the exact shape of the LIRA-198 bug: two sources agree on
    // key/label/icon/route/sort_order/is_enabled/is_system but disagree on
    // admin_only.
    const fixtureSql = `
      INSERT OR IGNORE INTO modules (${MODULES_INSERT_COLUMNS}) VALUES
        (1, 'audit', 'Audit & Transactions', 'Shield', '/audit', 97, 1, 0, 1);
    `;
    const fixtureSeedRow: ModuleSeedRow = {
      key: "audit",
      label: "Audit & Transactions",
      icon: "Shield",
      route: "/audit",
      sortOrder: 97,
      isEnabled: 1,
      adminOnly: 1, // drifted from the SQL fixture's 0
      isSystem: 1,
    };

    const parsed = parseCreateDbModuleSeed(fixtureSql);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).not.toEqual(toSnakeCase(fixtureSeedRow));
    expect(parsed[0].admin_only).toBe(0);
    expect(fixtureSeedRow.adminOnly).toBe(1);
  });

  it("a key present in one source and missing from the other is detected via array length", () => {
    const fixtureSql = `
      INSERT OR IGNORE INTO modules (${MODULES_INSERT_COLUMNS}) VALUES
        (1, 'pos', 'Point of Sale', 'ShoppingCart', '/pos', 1, 1, 0, 0);
    `;
    const fixtureSeedRows: ModuleSeedRow[] = [
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
    ];

    const parsed = parseCreateDbModuleSeed(fixtureSql);
    expect(parsed.length).not.toBe(fixtureSeedRows.length);
  });

  it("ignores rows for a different tenant_id and strips inline `--` comments sitting between tuples", () => {
    const fixtureSql = `
      INSERT OR IGNORE INTO modules (${MODULES_INSERT_COLUMNS}) VALUES
        (1, 'pos', 'Point of Sale', 'ShoppingCart', '/pos', 1, 1, 0, 0),
        -- a comment sitting between two tuples, exactly like create_db.sql has
        (2, 'pos', 'Point of Sale', 'ShoppingCart', '/pos', 1, 1, 0, 0);
    `;
    const parsed = parseCreateDbModuleSeed(fixtureSql);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("pos");
  });
});

describe("LIRA-221 — MODULE_SEED_ROWS vs create_db.sql's tenant-1 seed (real files)", () => {
  const fullPath = path.join(REPO_ROOT, CREATE_DB_SQL_REL);

  it("REPO_ROOT resolves to the actual repository root (landmark check)", () => {
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `REPO_ROOT resolved to "${REPO_ROOT}" but "${CREATE_DB_SQL_REL}" does not exist ` +
          `there (looked at "${fullPath}"). The __dirname-relative depth in this test is ` +
          `wrong — every other assertion below reads from a bogus path until this is fixed.`,
      );
    }
  });

  const sql = fs.readFileSync(fullPath, "utf8");
  const createDbRows = parseCreateDbModuleSeed(sql);

  it("create_db.sql's tenant-1 seed parses to a non-empty, de-duplicated row set", () => {
    // Anti-vacuous-pass: if the two INSERT blocks' shape ever changes enough
    // that the parser stops matching, this fails loudly instead of the
    // real-comparison test below silently comparing "[] === []".
    expect(createDbRows.length).toBeGreaterThan(0);
    const keys = new Set(createDbRows.map((r) => r.key));
    expect(keys.size).toBe(createDbRows.length);
  });

  it("MODULE_SEED_ROWS agrees with create_db.sql's tenant-1 seed on every row, key for key, column for column", () => {
    expect(MODULE_SEED_ROWS.length).toBe(createDbRows.length);

    const byKey = new Map(createDbRows.map((r) => [r.key, r]));
    for (const seedRow of MODULE_SEED_ROWS) {
      const dbRow = byKey.get(seedRow.key);
      if (!dbRow) {
        throw new Error(
          `MODULE_SEED_ROWS has key "${seedRow.key}" which create_db.sql's tenant-1 seed ` +
            `does not. Add it to ${CREATE_DB_SQL_REL} (rule 10 — both sources must be updated).`,
        );
      }
      expect(dbRow).toEqual(toSnakeCase(seedRow));
    }
  });
});
