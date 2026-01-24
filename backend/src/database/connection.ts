import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { resolveDatabasePath } from './dbPath.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
const DB_PATH = resolveDatabasePath();

let dbInstance: Database.Database | null = null;

function ensureSchema(db: Database.Database): void {
    // If core tables are missing, bootstrap schema from the Electron SQL file.
    const hasUsers = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();

    if (hasUsers) return;

    // Path: backend/src/database -> repo root -> electron-app/create_db.sql
    const schemaPath = path.join(__dirname, '../../../electron-app/create_db.sql');
    const sql = fs.readFileSync(schemaPath, 'utf-8');

    db.exec(sql);
    console.log(`📦 Database schema initialized from: ${schemaPath}`);
}

export function getDatabase(): Database.Database {
    if (!dbInstance) {
        // Ensure DB directory exists
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        dbInstance = new Database(DB_PATH);
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('foreign_keys = ON');
        ensureSchema(dbInstance);
        console.log(`📦 Database connected: ${DB_PATH}`);
    }
    return dbInstance;
}

export function closeDatabase(): void {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        console.log('📦 Database closed');
    }
}

// Graceful shutdown
process.on('SIGTERM', closeDatabase);
process.on('SIGINT', closeDatabase);
