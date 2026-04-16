/**
 * Database connection management
 * Supports both local and network database paths
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;
let databasePath: string | null = null;

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

export function initDatabase(
  database: Database.Database,
  dbPath?: string,
): void {
  db = database;
  databasePath = dbPath || null;

  // Configure for network paths if applicable
  if (dbPath && (dbPath.startsWith("\\\\") || dbPath.startsWith("//"))) {
    // Enable WAL mode for better concurrency on network shares
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("busy_timeout = 5000"); // 5 second timeout for network latency
      db.pragma("cache_size = -2000"); // 2MB cache
    } catch (error) {
      console.warn("Failed to configure WAL mode for network database:", error);
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    databasePath = null;
  }
}

export function getDatabasePath(): string | null {
  return databasePath;
}

export function isNetworkDatabase(): boolean {
  if (!databasePath) return false;
  return databasePath.startsWith("\\\\") || databasePath.startsWith("//");
}
