import { migrateIKWProviders } from "@liratek/core";

type Row = Record<string, any>;

describe("@liratek/core IKW providers migration", () => {
  /**
   * Builds a fake Database object that records every SQL call and
   * simulates just enough state to exercise migrateIKWProviders().
   */
  function makeDb(opts: {
    tables?: string[];
    /** The CREATE TABLE sql returned for financial_services (for CHECK detection) */
    financialServicesSql?: string;
    /** Existing drawer_balances keyed by "drawer::currency" */
    balances?: Record<string, number>;
  }) {
    const calls: Array<{ sql: string; args: any[] }> = [];
    const tables = new Set(opts.tables ?? []);
    const balances = new Map<string, number>(
      Object.entries(opts.balances ?? {}).map(([k, v]) => [k, v]),
    );

    const key = (drawer: string, ccy: string) => `${drawer}::${ccy}`;

    const db: any = {
      transaction: (fn: any) => {
        return (...args: any[]) => fn(...args);
      },
      exec: (sql: string) => {
        calls.push({ sql, args: [] });
      },
      prepare: (sql: string) => {
        const stmt = {
          get: (...args: any[]): Row | undefined => {
            calls.push({ sql, args });

            // tableExists check
            if (
              sql.includes("sqlite_master") &&
              sql.includes("type='table'") &&
              sql.includes("name=?")
            ) {
              const name = args[0];
              return tables.has(name) ? { name } : undefined;
            }

            // CHECK constraint inspection (sql column)
            if (
              sql.includes("sqlite_master") &&
              sql.includes("type='table'") &&
              sql.includes("name='financial_services'")
            ) {
              if (!tables.has("financial_services")) return undefined;
              return {
                sql:
                  opts.financialServicesSql ??
                  "CREATE TABLE financial_services (provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER')))",
              };
            }

            return undefined;
          },
          run: (...args: any[]) => {
            calls.push({ sql, args });

            // Seed drawer inserts
            if (sql.startsWith("INSERT OR IGNORE INTO drawer_balances")) {
              const drawer = args[0] as string;
              const ccy = args[1] as string;
              const k = key(drawer, ccy);
              if (!balances.has(k)) {
                balances.set(k, 0);
              }
            }

            return { changes: 1 };
          },
        };
        return stmt;
      },
    };

    return { db, calls, balances };
  }

  // ---------------------------------------------------------------------------
  // 1. No-op: table doesn't exist
  // ---------------------------------------------------------------------------
  it("does nothing if financial_services table doesn't exist", () => {
    const { db, calls } = makeDb({ tables: [] });
    migrateIKWProviders(db);

    // Only sqlite_master look-up should have happened
    expect(calls.some((c) => c.sql.includes("sqlite_master"))).toBe(true);

    // No inserts, renames, drops, or creates
    expect(
      calls.filter(
        (c) =>
          c.sql.startsWith("INSERT") ||
          c.sql.includes("RENAME") ||
          c.sql.includes("DROP") ||
          c.sql.includes("CREATE TABLE"),
      ),
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Already migrated — just seeds drawers
  // ---------------------------------------------------------------------------
  it("only seeds drawers when IPEC is already in CHECK constraint", () => {
    const { db, calls, balances } = makeDb({
      tables: ["financial_services"],
      financialServicesSql:
        "CREATE TABLE financial_services (provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER','IPEC','KATCH','WISH_APP')))",
    });

    migrateIKWProviders(db);

    // Should NOT rename or recreate the table
    expect(calls.filter((c) => c.sql.includes("RENAME")).length).toBe(0);
    expect(
      calls.filter((c) => c.sql.includes("DROP TABLE financial_services_old"))
        .length,
    ).toBe(0);

    // Drawer seeds should still be inserted
    expect(balances.has("IPEC::USD")).toBe(true);
    expect(balances.has("IPEC::LBP")).toBe(true);
    expect(balances.has("Katch::USD")).toBe(true);
    expect(balances.has("Katch::LBP")).toBe(true);
    expect(balances.has("Wish_App_Money::USD")).toBe(true);
    expect(balances.has("Wish_App_Money::LBP")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. Full migration path
  // ---------------------------------------------------------------------------
  it("migrates table: renames, recreates with expanded CHECK, copies data, drops old, seeds drawers", () => {
    const { db, calls, balances } = makeDb({
      tables: ["financial_services"],
      // Old CHECK — no IPEC
      financialServicesSql:
        "CREATE TABLE financial_services (provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER')))",
    });

    // Suppress console.log from migration
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    migrateIKWProviders(db);
    logSpy.mockRestore();

    const execCalls = calls
      .filter((c) => c.args.length === 0 && c.sql.length > 20)
      .map((c) => c.sql);

    // Should rename old table
    expect(
      execCalls.some((s) => s.includes("RENAME TO financial_services_old")),
    ).toBe(true);

    // Should create new table with IPEC/KATCH/WISH_APP in CHECK
    expect(
      execCalls.some(
        (s) =>
          s.includes("CREATE TABLE financial_services") &&
          s.includes("IPEC") &&
          s.includes("KATCH") &&
          s.includes("WISH_APP"),
      ),
    ).toBe(true);

    // Should copy data from old → new
    expect(
      execCalls.some(
        (s) =>
          s.includes("INSERT INTO financial_services") &&
          s.includes("financial_services_old"),
      ),
    ).toBe(true);

    // Should drop old table
    expect(
      execCalls.some((s) => s.includes("DROP TABLE financial_services_old")),
    ).toBe(true);

    // Should recreate indexes
    expect(
      execCalls.some((s) =>
        s.includes("idx_financial_services_provider_type_created_at"),
      ),
    ).toBe(true);
    expect(
      execCalls.some((s) => s.includes("idx_financial_services_created_at")),
    ).toBe(true);

    // Drawer seeds
    expect(balances.has("IPEC::USD")).toBe(true);
    expect(balances.has("IPEC::LBP")).toBe(true);
    expect(balances.has("Katch::USD")).toBe(true);
    expect(balances.has("Katch::LBP")).toBe(true);
    expect(balances.has("Wish_App_Money::USD")).toBe(true);
    expect(balances.has("Wish_App_Money::LBP")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. seedDrawers is idempotent — re-running doesn't duplicate
  // ---------------------------------------------------------------------------
  it("seedDrawers is idempotent (INSERT OR IGNORE)", () => {
    const { db, balances } = makeDb({
      tables: ["financial_services"],
      financialServicesSql:
        "CREATE TABLE financial_services (provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER','IPEC','KATCH','WISH_APP')))",
      balances: {
        "IPEC::USD": 50,
        "IPEC::LBP": 1000,
        "Katch::USD": 20,
        "Katch::LBP": 500,
        "Wish_App_Money::USD": 10,
        "Wish_App_Money::LBP": 200,
      },
    });

    migrateIKWProviders(db);

    // Existing balances should be untouched (INSERT OR IGNORE preserves them)
    expect(balances.get("IPEC::USD")).toBe(50);
    expect(balances.get("IPEC::LBP")).toBe(1000);
    expect(balances.get("Katch::USD")).toBe(20);
    expect(balances.get("Katch::LBP")).toBe(500);
    expect(balances.get("Wish_App_Money::USD")).toBe(10);
    expect(balances.get("Wish_App_Money::LBP")).toBe(200);
  });
});
