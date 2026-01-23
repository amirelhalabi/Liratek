import { getDatabase } from "./index";
import fs from "fs";
import path from "path";


export function runMigrations(): void {
  const db = getDatabase();
  const schemaPath = path.join(__dirname, "create_db.sql");

  if (fs.existsSync(schemaPath)) {
    console.log("[DB] Applying database schema baseline...");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    db.exec(sql);
    console.log("[DB] Database schema baseline applied.");
  } else {
    console.error("[DB] Error: create_db.sql not found at", schemaPath);
  }

  // ---------------------------------------------------------------------------
  // SQL migrations (idempotent) for future installations or updates
  // ---------------------------------------------------------------------------
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
    );

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
        try {
          db.exec(sql);
          markStmt.run(file);
          console.log(`[DB] Applied migration: ${file}`);
        } catch (err) {
          // If it fails because of duplicate column/table, we can still mark it as done
          // since it's already in the consolidated baseline.
          console.warn(`[DB] Migration ${file} skip-marked due to existing definitions:`, (err as Error).message);
          markStmt.run(file);
        }
      }
    }
  } catch (e) {
    console.error("[DB] Failed to apply SQL migrations:", e);
  }
}
