/**
 * Database instance getter
 * Re-exports getDb from main.ts
 */

import Database from "better-sqlite3";
import { getDb } from "./main.js";

export function getDatabase(): Database.Database {
  return getDb();
}
