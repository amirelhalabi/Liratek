/**
 * LIRA-331 T008: the shop's default UI language and receipt language. No
 * seed row: a missing key reads as English (FR-005, FR-023).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { SettingsRepository } from "../SettingsRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

let db: Database.Database;
let repo: SettingsRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO tenants (id, name, slug) VALUES (3, 'Three', 'three');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new SettingsRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("SettingsRepository languages (LIRA-331)", () => {
  it("missing keys read as English", () => {
    runWithTenant(2, () => {
      expect(repo.getUiDefaultLanguage()).toBe("en");
      expect(repo.getReceiptLanguage()).toBe("en");
    });
  });

  it("reads the stored value, per shop", () => {
    runWithTenant(2, () => {
      repo.upsertSetting("ui_default_language", "ar");
      repo.upsertSetting("receipt_language", "ar");
    });
    runWithTenant(2, () => {
      expect(repo.getUiDefaultLanguage()).toBe("ar");
      expect(repo.getReceiptLanguage()).toBe("ar");
    });
    runWithTenant(3, () => {
      expect(repo.getUiDefaultLanguage()).toBe("en");
      expect(repo.getReceiptLanguage()).toBe("en");
    });
  });

  it("an unknown stored value reads as English", () => {
    runWithTenant(2, () => {
      repo.upsertSetting("ui_default_language", "fr");
      expect(repo.getUiDefaultLanguage()).toBe("en");
    });
  });
});
