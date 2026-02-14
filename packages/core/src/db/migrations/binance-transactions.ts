import type Database from "better-sqlite3";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

/**
 * Idempotent migration that creates binance_transactions table if it doesn't exist.
 */
export function migrateBinanceTransactions(db: Database.Database): void {
  if (tableExists(db, "binance_transactions")) {
    return; // Already migrated
  }

  console.log("[MIGRATION] Creating binance_transactions table...");

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS binance_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT CHECK(type IN ('SEND', 'RECEIVE')) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        currency_code TEXT NOT NULL DEFAULT 'USDT',
        description TEXT,
        client_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_binance_transactions_created_at 
        ON binance_transactions(created_at);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_binance_transactions_type_created_at 
        ON binance_transactions(type, created_at);
    `);

    console.log(
      "[MIGRATION] ✅ binance_transactions table created successfully",
    );
  })();
}
