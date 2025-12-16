// __mocks__/electron/db/index.ts
import BetterSqlite3, { mockDatabase } from '../../__mocks__/better-sqlite3';

// Ensure the mockDatabase is used here
export function getDatabase() {
    return mockDatabase;
}

export function closeDatabase() {
    mockDatabase.close();
}
