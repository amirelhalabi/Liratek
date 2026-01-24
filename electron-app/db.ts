import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "phone_shop.db");

    db = new Database(dbPath);

    // Enable WAL mode for better performance
    db.pragma("journal_mode = WAL");

    // Enforce foreign key constraints
    db.pragma("foreign_keys = ON");

    // Non-fatal FK integrity scan (logs violations)
    try {
      const violations = db.pragma("foreign_key_check") as unknown;
      const violationCount = Array.isArray(violations) ? violations.length : 0;

      // Persist last FK check summary for the Diagnostics screen (avoid importing SettingsService here)
      try {
        const upsert = db.prepare(
          "INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON CONFLICT(key_name) DO UPDATE SET value=excluded.value",
        );
        upsert.run("fk_last_check_at", new Date().toISOString());
        upsert.run("fk_last_violation_count", String(violationCount));
      } catch {}

      if (violationCount > 0) {
        console.warn(
          `[DB] foreign_key_check found ${violationCount} violation(s)`,
          violations,
        );
      }
    } catch (e) {
      console.warn("[DB] foreign_key_check failed:", e);
    }

    console.log(`Database initialized at: ${dbPath}`);
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
