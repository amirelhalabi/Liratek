/**
 * Demo recording setup: a brand-new database on every run.
 *
 * Deleting it first is the point — the recording is public, so nothing left
 * over from a previous run (or copied from anywhere else) may appear in it.
 * Schema comes from electron-app/create_db.sql, like a fresh install.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { DEMO_DB_PATH } from "../../playwright.demo.config";

const SCHEMA_PATH = path.join(
  path.dirname(DEMO_DB_PATH),
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

export const DEMO_SHOP_NAME = "Demo Phone Shop";

export default function globalSetup(): void {
  fs.mkdirSync(path.dirname(DEMO_DB_PATH), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(DEMO_DB_PATH + suffix, { force: true });
  }

  const db = new Database(DEMO_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
    db.prepare(
      "UPDATE users SET password_hash = ?, is_active = 1 WHERE username = 'admin'",
    ).run(hashPassword("admin123"));
    // An empty shop name sends a fresh install to the setup wizard.
    db.prepare(
      "UPDATE system_settings SET value = ? WHERE tenant_id = 1 AND key_name = 'shop_name'",
    ).run(DEMO_SHOP_NAME);
  } finally {
    db.close();
  }
}
