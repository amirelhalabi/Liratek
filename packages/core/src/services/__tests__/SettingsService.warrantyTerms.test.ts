/**
 * LIRA-296 (T007) — the shop's warranty terms text (`warranty_terms_text`).
 *
 * There is no settings-key whitelist, so the setting rides the generic
 * settings pipe (`settings:update` / `PUT /api/settings/:key`, both admin).
 * What this pins: it saves and reads back unchanged, an empty value clears
 * it, and a value over 1000 characters is refused before it reaches the
 * repository (so a receipt can never be flooded).
 */
import Database from "better-sqlite3";
import { SettingsRepository } from "../../repositories/SettingsRepository";
import { SettingsService } from "../SettingsService";
import {
  WARRANTY_TERMS_MAX_LENGTH,
  WARRANTY_TERMS_SETTING_KEY,
} from "../../validators/warranty";

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
  const service = new SettingsService(new SettingsRepository(db));
  return { db, service };
}

describe("warranty_terms_text setting", () => {
  it("is the documented key, at most 1000 characters", () => {
    expect(WARRANTY_TERMS_SETTING_KEY).toBe("warranty_terms_text");
    expect(WARRANTY_TERMS_MAX_LENGTH).toBe(1000);
  });

  it("saves and reads back", () => {
    const { service } = makeService();
    const terms = "Warranty covers manufacturing faults only.\nNo water damage.";
    expect(service.updateSetting("warranty_terms_text", terms)).toEqual({
      success: true,
    });
    expect(service.getSettingValue("warranty_terms_text")?.value).toBe(terms);
  });

  it("accepts exactly 1000 characters", () => {
    const { service } = makeService();
    const terms = "x".repeat(1000);
    expect(service.updateSetting("warranty_terms_text", terms).success).toBe(
      true,
    );
    expect(service.getSettingValue("warranty_terms_text")?.value).toBe(terms);
  });

  it("refuses more than 1000 characters and keeps the old value", () => {
    const { service } = makeService();
    service.updateSetting("warranty_terms_text", "old terms");
    const result = service.updateSetting(
      "warranty_terms_text",
      "x".repeat(1001),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/1000/);
    expect(service.getSettingValue("warranty_terms_text")?.value).toBe("old terms");
  });

  it("an empty value clears it", () => {
    const { service } = makeService();
    service.updateSetting("warranty_terms_text", "old terms");
    expect(service.updateSetting("warranty_terms_text", "").success).toBe(true);
    expect(service.getSettingValue("warranty_terms_text")?.value).toBe("");
  });
});
