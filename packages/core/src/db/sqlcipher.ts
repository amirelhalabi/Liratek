import type Database from "better-sqlite3";

export interface ApplySqlCipherKeyResult {
  applied: boolean;
  supported: boolean;
  error?: string;
}

function escapeSqlStringLiteral(value: string): string {
  // SQL string literal escaping: single quotes doubled
  return value.replace(/'/g, "''");
}

/**
 * Attempt to apply a SQLCipher key to an opened database connection.
 *
 * Notes:
 * - If SQLCipher is not compiled in, `PRAGMA key` will fail (unknown pragma).
 * - If no key is provided, this is a no-op.
 */
export function applySqlCipherKey(
  db: Database.Database,
  key: string | undefined,
): ApplySqlCipherKeyResult {
  if (!key) {
    return { applied: false, supported: false };
  }

  const safeKey = escapeSqlStringLiteral(key);

  try {
    // SQLCipher expects PRAGMA key to be set BEFORE any other access.
    db.exec(`PRAGMA key = '${safeKey}';`);

    // Touch the DB to validate the key / format early.
    // If the key is wrong or SQLCipher isn't supported, this can throw.
    db.prepare("SELECT count(*) as c FROM sqlite_master").get();

    return { applied: true, supported: true };
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : String(e);

    // If pragma isn't recognized, we treat it as "not supported".
    const notSupported =
      /unknown pragma/i.test(msg) || /no such pragma/i.test(msg);

    return {
      applied: false,
      supported: !notSupported,
      error: msg,
    };
  }
}
