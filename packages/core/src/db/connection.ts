/**
 * Database connection management
 * This is a placeholder that will be overridden by electron-app or backend
 */
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  // Test hook: allow injecting a mock DB without calling initDatabase()
  const testDb = (globalThis as any).__LIRATEK_TEST_DB__ as
    | Database.Database
    | undefined;
  if (testDb) {
    return testDb;
  }

  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function initDatabase(database: Database.Database): void {
  db = database;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
