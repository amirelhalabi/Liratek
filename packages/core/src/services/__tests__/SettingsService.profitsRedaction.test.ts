/**
 * SettingsService — redaction of PROFITS_PASSWORD_SETTING_KEY.
 *
 * Security background (see the SENSITIVE_SETTING_KEYS comment in
 * SettingsService.ts): `GET /api/settings` is deliberately unauthenticated
 * and the IPC channels settings:get-all / db:get-settings / db:get-setting
 * carry no role check, so anything in system_settings is effectively
 * world-readable through those surfaces. The profits password hash must
 * never leave through the generic settings pipe, in either direction.
 *
 * Driven against a stub SettingsRepository (rule 13 payoff — no DB), in the
 * same style as CurrencyService.drawerGuards.test.ts.
 *
 * Rule 17, by inspection — every assertion below would FAIL without the
 * redaction code:
 *  - the getAllSettings/getSetting/getSettingValue assertions fail if the
 *    `SENSITIVE_SETTING_KEYS.has(...)` guards are removed, because the stub
 *    repo happily returns the sensitive row/value like any other.
 *  - the updateSetting assertion fails (returns {success:true} and calls
 *    upsertSetting) without the write-guard.
 *  - the "normal key still round-trips" cases guard the opposite regression
 *    (over-broad redaction swallowing everything): they'd fail if someone
 *    "simplified" the guard to redact by pattern instead of exact key, or
 *    broke the filter to exclude everything.
 */

import type {
  SettingsRepository,
  SettingEntity,
} from "../../repositories/SettingsRepository";
import { SettingsService } from "../SettingsService";
import { PROFITS_PASSWORD_SETTING_KEY } from "../../constants/profitsAccess";

const NORMAL_KEY = "shop_base_system";
const NORMAL_VALUE = "OMT";
const SENSITIVE_VALUE = "SCRYPT:deadbeef:c0ffee";

function makeService() {
  const allSettings: SettingEntity[] = [
    { key_name: NORMAL_KEY, value: NORMAL_VALUE },
    { key_name: PROFITS_PASSWORD_SETTING_KEY, value: SENSITIVE_VALUE },
  ];

  const getAllSettings = jest.fn(() => allSettings);
  const getSetting = jest.fn((key: string) =>
    allSettings.find((s) => s.key_name === key),
  );
  const getSettingValue = jest.fn(
    (key: string) => allSettings.find((s) => s.key_name === key)?.value,
  );
  const upsertSetting = jest.fn();

  const repo = {
    getAllSettings,
    getSetting,
    getSettingValue,
    upsertSetting,
  } as unknown as SettingsRepository;

  return {
    service: new SettingsService(repo),
    getAllSettings,
    getSetting,
    getSettingValue,
    upsertSetting,
  };
}

describe("SettingsService — profits password key is redacted from reads", () => {
  it("getAllSettings excludes the sensitive key but keeps a normal one", () => {
    const { service } = makeService();

    const result = service.getAllSettings();

    expect(
      result.find((s) => s.key_name === PROFITS_PASSWORD_SETTING_KEY),
    ).toBeUndefined();
    expect(result.find((s) => s.key_name === NORMAL_KEY)?.value).toBe(
      NORMAL_VALUE,
    );
  });

  it("getSetting returns undefined for the sensitive key but the entity for a normal one", () => {
    const { service } = makeService();

    expect(service.getSetting(PROFITS_PASSWORD_SETTING_KEY)).toBeUndefined();
    expect(service.getSetting(NORMAL_KEY)?.value).toBe(NORMAL_VALUE);
  });

  it("getSettingValue returns undefined for the sensitive key but the value for a normal one", () => {
    const { service } = makeService();

    expect(
      service.getSettingValue(PROFITS_PASSWORD_SETTING_KEY),
    ).toBeUndefined();
    expect(service.getSettingValue(NORMAL_KEY)).toEqual({
      value: NORMAL_VALUE,
    });
  });
});

describe("SettingsService — profits password key is rejected on write", () => {
  it("updateSetting refuses to write the sensitive key and never calls the repository", () => {
    const { service, upsertSetting } = makeService();

    const result = service.updateSetting(
      PROFITS_PASSWORD_SETTING_KEY,
      "SCRYPT:attacker:hash",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it("updateSetting still round-trips a normal key (guards against over-broad redaction)", () => {
    const { service, upsertSetting } = makeService();

    const result = service.updateSetting(NORMAL_KEY, "WHISH");

    expect(result.success).toBe(true);
    expect(upsertSetting).toHaveBeenCalledWith(NORMAL_KEY, "WHISH");
  });
});
