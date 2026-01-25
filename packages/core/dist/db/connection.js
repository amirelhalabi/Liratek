let db = null;
export function getDatabase() {
    if (!db) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return db;
}
export function initDatabase(database) {
    db = database;
}
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
