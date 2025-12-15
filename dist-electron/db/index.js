"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabase = getDatabase;
exports.closeDatabase = closeDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
let db = null;
function getDatabase() {
    if (!db) {
        const userDataPath = electron_1.app.getPath('userData');
        const dbPath = path_1.default.join(userDataPath, 'phone_shop.db');
        db = new better_sqlite3_1.default(dbPath);
        // Enable WAL mode for better performance
        db.pragma('journal_mode = WAL');
        console.log(`Database initialized at: ${dbPath}`);
    }
    return db;
}
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
