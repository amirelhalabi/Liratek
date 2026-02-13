import type Database from "better-sqlite3";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

/**
 * Idempotent migration that creates customer_sessions tables if they don't exist.
 */
export function migrateCustomerSessions(db: Database.Database): void {
  // Check if customer_sessions table already exists
  if (tableExists(db, "customer_sessions")) {
    return; // Already migrated
  }

  console.log("[MIGRATION] Creating customer_sessions tables...");

  db.transaction(() => {
    // Create customer_sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        customer_phone TEXT,
        customer_notes TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        started_by TEXT NOT NULL,
        closed_by TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        CHECK (is_active IN (0, 1))
      );
    `);

    // Create customer_session_transactions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_session_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        transaction_id INTEGER NOT NULL,
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_lbp REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
      );
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_customer_sessions_active 
        ON customer_sessions(is_active, started_at DESC);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_customer_session_transactions_session 
        ON customer_session_transactions(session_id);
    `);

    console.log("[MIGRATION] ✅ customer_sessions tables created successfully");
  })();
}
