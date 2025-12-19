"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const index_1 = require("./index");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function ensureColumnExists(table, column, alterSql) {
    const db = (0, index_1.getDatabase)();
    try {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        const has = cols.some((c) => c.name === column);
        if (!has) {
            console.log(`[DB] Patching schema: adding ${table}.${column}`);
            db.exec(alterSql);
        }
    }
    catch (e) {
        // Don't crash startup if the patch check fails
        console.error(`[DB] Failed checking/patching ${table}.${column}:`, e);
    }
}
function runMigrations() {
    const db = (0, index_1.getDatabase)();
    const schemaPath = path_1.default.join(__dirname, "create_db.sql");
    if (fs_1.default.existsSync(schemaPath)) {
        console.log("Applying database schema...");
        const sql = fs_1.default.readFileSync(schemaPath, "utf-8");
        db.exec(sql);
        console.log("Database schema applied (Consolidated)");
    }
    else {
        console.error("Error: create_db.sql not found at", schemaPath);
    }
    // ---------------------------------------------------------------------------
    // Schema patches for existing installations
    // ---------------------------------------------------------------------------
    // debt_ledger.created_by is required by DebtRepository/SalesRepository
    ensureColumnExists("debt_ledger", "created_by", "ALTER TABLE debt_ledger ADD COLUMN created_by INTEGER;");
}
