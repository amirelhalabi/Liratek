import { migrateDrawerNames } from "@liratek/core";

type Row = Record<string, any>;

describe("@liratek/core drawer migration", () => {
  function makeDb(opts: {
    tables?: string[];
    // drawer_balances balances by (drawer,currency)
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
      prepare: (sql: string) => {
        const stmt = {
          get: (...args: any[]): Row | undefined => {
            calls.push({ sql, args });
            // sqlite_master tableExists checks
            if (sql.includes("sqlite_master") && sql.includes("type='table'")) {
              const name = args[0];
              return tables.has(name) ? { name } : undefined;
            }

            // drawer_balances select
            if (sql.startsWith("SELECT balance FROM drawer_balances")) {
              const [drawer, ccy] = args;
              const v = balances.get(key(drawer, ccy));
              return v == null ? undefined : { balance: v };
            }

            return undefined;
          },
          run: (...args: any[]) => {
            calls.push({ sql, args });

            // Minimal simulation for a few SQL statements used by migration
            if (sql.startsWith("INSERT OR IGNORE INTO drawer_balances")) {
              // handle both forms: with placeholders or hard-coded
              let drawer = args[0];
              let ccy = args[1];
              if (!drawer && sql.includes("'MTC'")) {
                drawer = "MTC";
                ccy = "USD";
              }
              if (!drawer && sql.includes("'Alfa'")) {
                drawer = "Alfa";
                ccy = "USD";
              }
              balances.set(
                key(drawer, ccy),
                balances.get(key(drawer, ccy)) ?? 0,
              );
            }

            if (
              sql.startsWith("UPDATE drawer_balances SET balance = balance +")
            ) {
              const [delta, drawer, ccy] = args;
              balances.set(
                key(drawer, ccy),
                (balances.get(key(drawer, ccy)) ?? 0) + delta,
              );
            }

            if (sql.startsWith("DELETE FROM drawer_balances")) {
              const [drawer, ccy] = args;
              balances.delete(key(drawer, ccy));
            }

            // We don't need to simulate other UPDATEs; just record.
            return { changes: 1 };
          },
        };
        return stmt;
      },
    };

    return { db, calls, balances };
  }

  it("does nothing if drawer_balances table doesn't exist", () => {
    const { db, calls } = makeDb({ tables: [] });
    migrateDrawerNames(db);
    // Should only have checked for table existence via sqlite_master
    expect(calls.some((c) => c.sql.includes("sqlite_master"))).toBe(true);
    // No inserts/updates/deletes should happen
    expect(
      calls.filter(
        (c) =>
          c.sql.startsWith("INSERT") ||
          c.sql.startsWith("UPDATE") ||
          c.sql.startsWith("DELETE"),
      ),
    ).toHaveLength(0);
  });

  it("renames OMT->OMT_System and Whish->Whish_App in balances (merge + delete old)", () => {
    const { db, balances } = makeDb({
      tables: [
        "drawer_balances",
        "payments",
        "daily_closing_amounts",
        "daily_closings",
        "sales",
      ],
      balances: {
        "OMT::USD": 10,
        "OMT::LBP": 20,
        "Whish::USD": 3,
        "Whish::LBP": 4,
        "OMT_System::USD": 100,
      },
    });

    migrateDrawerNames(db);

    expect(balances.get("OMT::USD")).toBeUndefined();
    expect(balances.get("OMT::LBP")).toBeUndefined();
    expect(balances.get("Whish::USD")).toBeUndefined();
    expect(balances.get("Whish::LBP")).toBeUndefined();

    // merged into existing OMT_System::USD
    expect(balances.get("OMT_System::USD")).toBe(110);
    expect(balances.get("OMT_System::LBP")).toBe(20);

    expect(balances.get("Whish_App::USD")).toBe(3);
    expect(balances.get("Whish_App::LBP")).toBe(4);

    // ensured OMT_App exists
    expect(balances.get("OMT_App::USD")).toBeDefined();
    expect(balances.get("OMT_App::LBP")).toBeDefined();
  });
});
