import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  resolveDatabasePath,
  resolveDatabaseKey,
  applySqlCipherKey,
  initDatabase as initCoreDatabase,
} from "@liratek/core";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { dbLogger } from "@liratek/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
const resolved = resolveDatabasePath();
const DB_PATH = resolved.path;

// Optional SQLCipher key
const resolvedKey = resolveDatabaseKey();

let dbInstance: Database.Database | null = null;

function ensureSchema(db: Database.Database): void {
  // If core tables are missing, bootstrap schema from the Electron SQL file.
  const hasUsers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();

  if (hasUsers) return;

  // Path: backend/src/database -> repo root -> electron-app/create_db.sql
  const schemaPath = path.join(
    __dirname,
    "../../../electron-app/create_db.sql",
  );
  const sql = fs.readFileSync(schemaPath, "utf-8");

  db.exec(sql);
  dbLogger.info({ schemaPath }, "Database schema initialized");
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    // Ensure DB directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(DB_PATH);

    // Apply SQLCipher key (if provided) BEFORE any other access
    const keyResult = applySqlCipherKey(dbInstance, resolvedKey.key);

    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    ensureSchema(dbInstance);

    // Initialize the @liratek/core database singleton
    initCoreDatabase(dbInstance);

    dbLogger.info(
      { path: DB_PATH, source: resolved.source },
      "Database connected",
    );
    dbLogger.info(
      {
        keySource: resolvedKey.source,
        applied: keyResult.applied,
        supported: keyResult.supported,
        error: keyResult.error,
      },
      "SQLCipher key status",
    );

    if (resolvedKey.source !== "none" && !keyResult.applied) {
      throw new Error(
        keyResult.supported
          ? `SQLCipher key could not be applied: ${keyResult.error || "unknown error"}`
          : `SQLCipher is not supported by this SQLite build. Provide a SQLCipher-enabled build of SQLite/better-sqlite3. (details: ${keyResult.error || "unknown"})`,
      );
    }
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbLogger.info("Database closed");
  }
}

// Note: shutdown is handled centrally in server.ts
