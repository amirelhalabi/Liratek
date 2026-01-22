import { getDatabase } from "./index";
import fs from "fs";
import path from "path";

interface _Migration {
  id: number;
  name: string;
  applied_at: string;
}

function ensureColumnExists(table: string, column: string, alterSql: string) {
  const db = getDatabase();
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    const has = cols.some((c) => c.name === column);
    if (!has) {
      console.log(`[DB] Patching schema: adding ${table}.${column}`);
      db.exec(alterSql);
    }
  } catch (e) {
    // Don't crash startup if the patch check fails
    console.error(`[DB] Failed checking/patching ${table}.${column}:`, e);
  }
}

export function runMigrations(): void {
  const db = getDatabase();
  const schemaPath = path.join(__dirname, "create_db.sql");

  if (fs.existsSync(schemaPath)) {
    console.log("Applying database schema...");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    db.exec(sql);
    console.log("Database schema applied (Consolidated)");
  } else {
    console.error("Error: create_db.sql not found at", schemaPath);
  }

  // ---------------------------------------------------------------------------
  // SQL migrations (idempotent) for existing installations
  // ---------------------------------------------------------------------------
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);

    const migrationsDir = path.join(__dirname, "migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      const hasStmt = db.prepare(
        "SELECT 1 as ok FROM schema_migrations WHERE name = ? LIMIT 1",
      );
      const markStmt = db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)",
      );

      for (const file of files) {
        const already = hasStmt.get(file) as { ok: 1 } | undefined;
        if (already?.ok) continue;

        const fullPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(fullPath, "utf-8");
        db.exec(sql);
        markStmt.run(file);
      }
    }
  } catch (e) {
    console.error("[DB] Failed to apply SQL migrations:", e);
  }

  // ---------------------------------------------------------------------------
  // Schema patches for existing installations
  // ---------------------------------------------------------------------------
  // debt_ledger.created_by is required by DebtRepository/SalesRepository
  ensureColumnExists(
    "debt_ledger",
    "created_by",
    "ALTER TABLE debt_ledger ADD COLUMN created_by INTEGER;",
  );

  // Ensure activity_logs has details_json for unified logging
  ensureColumnExists(
    "activity_logs",
    "details_json",
    "ALTER TABLE activity_logs ADD COLUMN details_json TEXT;",
  );

  // expenses.paid_by_method (for routing expense outflows to a drawer)
  ensureColumnExists(
    "expenses",
    "paid_by_method",
    "ALTER TABLE expenses ADD COLUMN paid_by_method TEXT DEFAULT 'CASH';",
  );
}
