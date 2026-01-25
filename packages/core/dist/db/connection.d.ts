/**
 * Database connection management
 * This is a placeholder that will be overridden by electron-app or backend
 */
import Database from "better-sqlite3";
export declare function getDatabase(): Database.Database;
export declare function initDatabase(database: Database.Database): void;
export declare function closeDatabase(): void;
