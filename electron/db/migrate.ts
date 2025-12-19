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
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
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
  // Schema patches for existing installations
  // ---------------------------------------------------------------------------
  // debt_ledger.created_by is required by DebtRepository/SalesRepository
  ensureColumnExists(
    "debt_ledger",
    "created_by",
    "ALTER TABLE debt_ledger ADD COLUMN created_by INTEGER;",
  );
}
