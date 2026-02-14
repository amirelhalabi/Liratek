import fs from "fs";
import os from "os";
import path from "path";
import env from "../config/env.js";

export type DbKeyResolutionSource =
  | "env:DATABASE_KEY"
  | "file:db-key.txt"
  | "none";

export interface ResolvedDbKey {
  key?: string;
  source: DbKeyResolutionSource;
  configFile?: string;
}

/**
 * Resolve the SQLCipher encryption key.
 *
 * Resolution order:
 * 1) DATABASE_KEY env var
 * 2) ~/Documents/LiraTek/db-key.txt (one-line key)
 * 3) none
 */
export function resolveDatabaseKey(): ResolvedDbKey {
  const dbKey = env.DATABASE_KEY;
  if (dbKey) {
    return { key: dbKey, source: "env:DATABASE_KEY" };
  }

  const configFile = path.join(
    os.homedir(),
    "Documents",
    "LiraTek",
    "db-key.txt",
  );
  if (fs.existsSync(configFile)) {
    const key = fs.readFileSync(configFile, "utf8").trim();
    if (key) {
      return { key, source: "file:db-key.txt", configFile };
    }
  }

  return { source: "none" };
}
