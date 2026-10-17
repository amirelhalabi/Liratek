/**
 * LIRA-331 T013 — `ui_default_language` / `receipt_language` ride the generic
 * settings pipe (`settings:update` / `db:update-setting` IPC and
 * `PUT /api/settings/:key`, all admin). Both transports call
 * SettingsService.updateSetting, so the per-key rule lives here once.
 *
 * Rule 23 three-way diff of the channel (2026-10-17): schema = per-key value
 * rule only; preload type = (key: string, value: string); handler and route
 * forward exactly (key, value). No key can be dropped by this change.
 */
import Database from "better-sqlite3";
import { SettingsRepository } from "../../repositories/SettingsRepository";
import { SettingsService } from "../SettingsService";

function makeService() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      key_name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );
  `);
  return { db, service: new SettingsService(new SettingsRepository(db)) };
}

describe.each(["ui_default_language", "receipt_language"])("%s setting", (key) => {
  it.each(["en", "ar"])("accepts %s", (value) => {
    const { service } = makeService();
    expect(service.updateSetting(key, value)).toEqual({ success: true });
    expect(service.getSettingValue(key)?.value).toBe(value);
  });

  it("refuses an unknown language with VALIDATION_ERROR and writes nothing", () => {
    const { service } = makeService();
    const result = service.updateSetting(key, "fr");
    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(service.getSettingValue(key)).toBeUndefined();
  });
});

describe("other keys", () => {
  it("still accept any string, as before", () => {
    const { service } = makeService();
    expect(service.updateSetting("shop_name", "fr")).toEqual({ success: true });
  });
});
