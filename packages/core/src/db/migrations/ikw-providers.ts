/**
 * Migration: IPEC / Katch / Wish App providers
 *
 * Expands the financial_services CHECK constraint to include
 * 'IPEC', 'KATCH', 'WISH_APP' and seeds their drawer balances.
 */
import type Database from "better-sqlite3";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

export function migrateIKWProviders(db: Database.Database): void {
  if (!tableExists(db, "financial_services")) return;

  // Check if migration already done by inspecting the CHECK constraint SQL
  const tableInfo = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_services'",
    )
    .get() as { sql: string } | undefined;

  if (tableInfo?.sql?.includes("IPEC")) {
    // Already migrated — just ensure drawer seeds exist
    seedDrawers(db);
    return;
  }

  db.transaction(() => {
    // 1) Rename old table
    db.exec("ALTER TABLE financial_services RENAME TO financial_services_old");

    // 2) Create with expanded CHECK
    db.exec(`
      CREATE TABLE financial_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'IPEC', 'KATCH', 'WISH_APP')) NOT NULL,
        service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL_PAYMENT')) NOT NULL,
        amount_usd DECIMAL(10, 2) DEFAULT 0,
        amount_lbp DECIMAL(15, 2) DEFAULT 0,
        commission_usd DECIMAL(10, 2) DEFAULT 0,
        commission_lbp DECIMAL(15, 2) DEFAULT 0,
        client_name TEXT,
        reference_number TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3) Copy data
    db.exec(
      "INSERT INTO financial_services SELECT * FROM financial_services_old",
    );

    // 4) Drop old
    db.exec("DROP TABLE financial_services_old");

    // 5) Recreate indexes
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at)",
    );

    // 6) Seed drawers
    seedDrawers(db);
  })();

  console.log("[migration] IPEC/Katch/WishApp providers migrated successfully");
}

function seedDrawers(db: Database.Database): void {
  const seed = db.prepare(
    "INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES (?, ?, 0)",
  );
  seed.run("IPEC", "USD");
  seed.run("IPEC", "LBP");
  seed.run("Katch", "USD");
  seed.run("Katch", "LBP");
  seed.run("Wish_App_Money", "USD");
  seed.run("Wish_App_Money", "LBP");
}
