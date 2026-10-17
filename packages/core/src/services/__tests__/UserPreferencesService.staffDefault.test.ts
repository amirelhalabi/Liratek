/**
 * LIRA-331 T034 (US2 AC-5): a staff user who never chose a language follows
 * the shop default — including a default set AFTER they were created — on the
 * real schema. Expected to pass on the T009 code (not failing-first by
 * nature: it pins behaviour the resolver already has).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { SettingsRepository } from "../../repositories/SettingsRepository.js";
import { UserPreferencesService } from "../UserPreferencesService.js";

type TestGlobal = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

let db: Database.Database;
let service: UserPreferencesService;
let settings: SettingsRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', 'h', 'admin', 1),
      (21, 2, 'old_staff', 'h', 'staff', 1);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  settings = new SettingsRepository();
  service = new UserPreferencesService(new UserRepository(), settings);
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

it("a user who existed before the update (NULL) follows the shop default", () => {
  runWithTenant(2, () => {
    expect(service.getMine(21).effectiveLanguage).toBe("en");
    settings.upsertSetting("ui_default_language", "ar");
    expect(service.getMine(21)).toMatchObject({
      language: null,
      effectiveLanguage: "ar",
      shopDefaultLanguage: "ar",
    });
  });
});

it("a staff user created after the admin set Arabic starts in Arabic", () => {
  runWithTenant(2, () => {
    settings.upsertSetting("ui_default_language", "ar");
    db.exec(
      `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (22, 2, 'new_staff', 'h', 'staff', 1)`,
    );
    expect(service.getMine(22).effectiveLanguage).toBe("ar");
  });
});

it("a user's own English choice still wins over an Arabic shop default", () => {
  runWithTenant(2, () => {
    settings.upsertSetting("ui_default_language", "ar");
    service.setMine(21, { language: "en" });
    expect(service.getMine(21).effectiveLanguage).toBe("en");
  });
});
