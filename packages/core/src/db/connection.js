let db = null;
export function getDatabase() {
  // Test hook: allow injecting a mock DB without calling initDatabase()
  const testDb = globalThis.__LIRATEK_TEST_DB__;
  if (testDb) {
    return testDb;
  }
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
