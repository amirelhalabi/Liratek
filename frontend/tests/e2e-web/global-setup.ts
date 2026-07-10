/**
 * Global setup for the web e2e suite.
 *
 * Ensures the test database exists (bootstrapped from electron-app/create_db.sql,
 * the same fresh-install schema the app itself uses) and that the seeded admin
 * user has a known password (admin / admin123).
 *
 * NOTE: the DB accumulates across runs, mirroring the Electron suite's model —
 * write specs with identity-matched rows and delta assertions, never absolute
 * totals or "newest row" lookups. Delete frontend/test-results/e2e-web/ for a
 * clean slate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_DIR = path.join(__dirname, "..", "..", "test-results", "e2e-web");
const DB_PATH = path.join(DB_DIR, "phone_shop.web.db");
const SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

export default function globalSetup(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  try {
    db.pragma("journal_mode = WAL");

    const hasUsers = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      )
      .get();
    if (!hasUsers) {
      db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
      console.warn(`[e2e-web] fresh schema bootstrapped at ${DB_PATH}`);
    }

    // create_db.sql seeds admin with an empty password hash — set a real one
    // so the UI login flow works.
    db.prepare(
      "UPDATE users SET password_hash = ?, is_active = 1 WHERE username = 'admin'",
    ).run(hashPassword("admin123"));
  } finally {
    db.close();
  }
}
