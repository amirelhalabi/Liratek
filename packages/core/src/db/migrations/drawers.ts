import type Database from "better-sqlite3";

export const CANONICAL_DRAWER_RENAMES: Record<string, string> = {
  OMT: "OMT_System",
  Whish: "Whish_App",
};

export const CANONICAL_DRAWERS: string[] = [
  "General",
  "OMT_System",
  "Whish_App",
  "OMT_App",
  "Binance",
  "MTC",
  "Alfa",
];

const CURRENCIES: string[] = ["USD", "LBP"];

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

/**
 * Idempotent migration that:
 * - renames drawer identifiers in all relevant tables
 * - merges balances if both old and new exist
 * - ensures canonical drawers exist in drawer_balances for USD/LBP
 */
export function migrateDrawerNames(db: Database.Database): void {
  // If core schema isn't present yet, skip.
  if (!tableExists(db, "drawer_balances")) return;

  db.transaction(() => {
    // 1) Ensure new drawer rows exist first
    for (const drawer of CANONICAL_DRAWERS) {
      for (const ccy of CURRENCIES) {
        db.prepare(
          "INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES (?, ?, 0)",
        ).run(drawer, ccy);
      }
    }
    // Telecom drawers are USD-only in current app; keep existing behavior.
    db.prepare(
      "INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC','USD',0)",
    ).run();
    db.prepare(
      "INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Alfa','USD',0)",
    ).run();

    // 2) Migrate drawer_balances: merge old -> new and delete old
    for (const [oldName, newName] of Object.entries(CANONICAL_DRAWER_RENAMES)) {
      for (const ccy of CURRENCIES) {
        const oldRow = db
          .prepare(
            "SELECT balance FROM drawer_balances WHERE drawer_name=? AND currency_code=?",
          )
          .get(oldName, ccy) as { balance: number } | undefined;
        if (oldRow && typeof oldRow.balance === "number") {
          db.prepare(
            "UPDATE drawer_balances SET balance = balance + ? WHERE drawer_name=? AND currency_code=?",
          ).run(oldRow.balance, newName, ccy);
          db.prepare(
            "DELETE FROM drawer_balances WHERE drawer_name=? AND currency_code=?",
          ).run(oldName, ccy);
        }
      }
    }

    // 3) Update other tables that store drawer_name
    const renameInTable = (table: string) => {
      if (!tableExists(db, table)) return;
      for (const [oldName, newName] of Object.entries(
        CANONICAL_DRAWER_RENAMES,
      )) {
        db.prepare(`UPDATE ${table} SET drawer_name=? WHERE drawer_name=?`).run(
          newName,
          oldName,
        );
      }
    };

    renameInTable("payments");
    renameInTable("daily_closing_amounts");
    renameInTable("daily_closings");

    // Some legacy tables may store drawer_name as well
    if (tableExists(db, "sales")) {
      for (const [oldName, newName] of Object.entries(
        CANONICAL_DRAWER_RENAMES,
      )) {
        db.prepare(`UPDATE sales SET drawer_name=? WHERE drawer_name=?`).run(
          newName,
          oldName,
        );
      }
    }
  })();
}
