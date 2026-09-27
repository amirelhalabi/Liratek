/**
 * Opens a raw connection and brings it up to this backend's connection
 * contract (pragmas, SQLCipher key) — closing it if that second step throws,
 * so a bad key or a failed pragma never leaks an open file handle (Phase A
 * review finding: `TenantDatabasePool.get()`'s factory,
 * `connection.ts#openTenantDatabase`, opened a handle and then called
 * `configureConnection(db)` with nothing closing the handle when that threw).
 *
 * Split into its own leaf module for the same reason `tenantDbResolver.ts`
 * and `idleSweep.ts` are: `connection.ts` uses `import.meta.url` and can
 * never be `require()`-d for real under backend jest.
 *
 * Factory contract this documents for any future caller of
 * `TenantDatabasePool`'s `openDatabase` option: **the factory must close its
 * own handle before throwing.** The pool does not (and cannot generically)
 * do this for it — `openDatabaseFn(filePath)` throwing propagates straight
 * out of `TenantDatabasePool.get()` before the pool ever sees the handle, so
 * there is nothing for the pool to close. This helper is what makes
 * `openTenantDatabase` honor that contract.
 */
export function openAndConfigure<TDb extends { close(): void }>(
  filePath: string,
  openRaw: (filePath: string) => TDb,
  configure: (db: TDb) => void,
): TDb {
  const db = openRaw(filePath);
  try {
    configure(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      // Already broken; nothing useful to do with a close failure here.
    }
    throw error;
  }
  return db;
}
