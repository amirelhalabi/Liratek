/**
 * ProfitsAccessService — the Profits password gate (frozen contract, agent A).
 *
 * Fail-closed behaviour is the whole point of this feature: nobody (admin
 * included) enters /profits until an admin has set a password in Settings.
 * These tests drive the service against a stub `SettingsRepository` (rule 13
 * payoff — no DB needed), following the mocking style already used in
 * CurrencyService.drawerGuards.test.ts.
 *
 * Rule 17 (prove regression tests against the buggy code) — by inspection,
 * every assertion below would fail on plausible pre-fix code:
 *  - "verify false when unset" fails if verify() ever falls back to a
 *    default/empty-string password instead of checking `stored` first.
 *  - "wrong password rejected" fails if verify() short-circuited to true
 *    once ANY hash exists.
 *  - "below-minimum rejected" fails if setPassword skipped the length guard
 *    (or ran validatePasswordComplexity instead, which would also reject a
 *    valid 4-digit PIN like "1234" — the min-length assertion below catches
 *    that regression too).
 *  - "stored value is SCRYPT:, never plaintext" fails if setPassword ever
 *    stored `plain` directly instead of `hashPassword(plain)`.
 */

import type { SettingsRepository } from "../../repositories/SettingsRepository";
import { ProfitsAccessService } from "../ProfitsAccessService";
import { PROFITS_PASSWORD_SETTING_KEY } from "../../constants/profitsAccess";

/** Minimal stateful stub: backs PROFITS_PASSWORD_SETTING_KEY with a Map, like
 * the real upsert/get-by-key pair, so setPassword -> verify/isPasswordSet
 * round-trip through the same in-memory "row". */
function makeService() {
  const store = new Map<string, string>();

  const getSettingValue = jest.fn((key: string) => store.get(key));
  const upsertSetting = jest.fn((key: string, value: string) => {
    store.set(key, value);
  });

  const repo = {
    getSettingValue,
    upsertSetting,
  } as unknown as SettingsRepository;

  return {
    service: new ProfitsAccessService(repo),
    store,
    getSettingValue,
    upsertSetting,
  };
}

describe("ProfitsAccessService — fail-closed when unset", () => {
  it("isPasswordSet is false before any password is set", () => {
    const { service } = makeService();
    expect(service.isPasswordSet()).toBe(false);
  });

  it("verify returns false when nothing is set, for any input including empty string", () => {
    const { service } = makeService();
    expect(service.verify("anything")).toBe(false);
    expect(service.verify("")).toBe(false);
  });
});

describe("ProfitsAccessService — setPassword", () => {
  it("rejects a password shorter than PROFITS_PASSWORD_MIN_LENGTH and never writes it", () => {
    const { service, upsertSetting } = makeService();

    const result = service.setPassword("123"); // 3 chars, min is 4

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least/i);
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it("accepts a password exactly at PROFITS_PASSWORD_MIN_LENGTH (a short PIN is legal)", () => {
    const { service } = makeService();

    const result = service.setPassword("1234"); // 4 chars

    expect(result.success).toBe(true);
  });

  it("stores a SCRYPT: hash, never the plaintext password", () => {
    const { service, store } = makeService();

    service.setPassword("hunter2pin");

    const stored = store.get(PROFITS_PASSWORD_SETTING_KEY);
    expect(stored).toBeDefined();
    expect(stored).toMatch(/^SCRYPT:/);
    expect(stored).not.toBe("hunter2pin");
    expect(stored).not.toContain("hunter2pin");
  });
});

describe("ProfitsAccessService — set then verify / isPasswordSet transitions", () => {
  it("verify is true for the right password and false for the wrong one after set", () => {
    const { service } = makeService();

    const setResult = service.setPassword("correct-pin");
    expect(setResult.success).toBe(true);

    expect(service.verify("correct-pin")).toBe(true);
    expect(service.verify("wrong-pin")).toBe(false);
  });

  it("isPasswordSet flips from false to true once a password is set", () => {
    const { service } = makeService();

    expect(service.isPasswordSet()).toBe(false);
    service.setPassword("some-pin");
    expect(service.isPasswordSet()).toBe(true);
  });
});
