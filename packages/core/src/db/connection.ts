/**
 * Database connection management
 * This is a placeholder that will be overridden by electron-app or backend
 */
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
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
