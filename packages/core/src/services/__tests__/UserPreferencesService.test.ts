/**
 * LIRA-331 T009: UserPreferencesService with mocked repositories (rule 13).
 * Field names come from the schema (rule 24): the input is parsed through
 * setMyLanguageSchema, never hand-built past it.
 */
import { UserPreferencesService } from "../UserPreferencesService.js";
import { setMyLanguageSchema } from "../../validators/userPreferences.js";
import { ValidationError, NotFoundError } from "../../utils/errors.js";
import type { UserRepository } from "../../repositories/UserRepository.js";
import type { SettingsRepository } from "../../repositories/SettingsRepository.js";

function makeService(opts: {
  userLanguage?: "en" | "ar" | null;
  shopDefault?: "en" | "ar";
  receipt?: "en" | "ar";
  setOk?: boolean;
}) {
  let stored = opts.userLanguage ?? null;
  const users = {
    getLanguage: jest.fn(() => stored),
    setLanguage: jest.fn((_id: number, lang: "en" | "ar") => {
      if (opts.setOk === false) return false;
      stored = lang;
      return true;
    }),
  };
  const settings = {
    getUiDefaultLanguage: jest.fn(() => opts.shopDefault ?? "en"),
    getReceiptLanguage: jest.fn(() => opts.receipt ?? "en"),
  };
  const service = new UserPreferencesService(
    users as unknown as UserRepository,
    settings as unknown as SettingsRepository,
  );
  return { service, users, settings };
}

describe("UserPreferencesService.getMine", () => {
  it("a user who never chose follows the shop default", () => {
    const { service } = makeService({ userLanguage: null, shopDefault: "ar" });
    expect(service.getMine(7)).toEqual({
      language: null,
      effectiveLanguage: "ar",
      shopDefaultLanguage: "ar",
      receiptLanguage: "en",
    });
  });

  it("the user's own choice wins over the shop default", () => {
    const { service } = makeService({
      userLanguage: "en",
      shopDefault: "ar",
      receipt: "ar",
    });
    expect(service.getMine(7)).toEqual({
      language: "en",
      effectiveLanguage: "en",
      shopDefaultLanguage: "ar",
      receiptLanguage: "ar",
    });
  });
});

describe("UserPreferencesService.setMine", () => {
  it("validates through setMyLanguageSchema and returns the new preferences", () => {
    const { service, users } = makeService({ userLanguage: null });
    const input = setMyLanguageSchema.parse({ language: "ar" });
    const result = service.setMine(7, input);
    expect(users.setLanguage).toHaveBeenCalledWith(7, "ar");
    expect(result.language).toBe("ar");
    expect(result.effectiveLanguage).toBe("ar");
  });

  it("refuses an unknown language with a ValidationError", () => {
    const { service, users } = makeService({});
    expect(() => service.setMine(7, { language: "fr" } as never)).toThrow(
      ValidationError,
    );
    expect(users.setLanguage).not.toHaveBeenCalled();
  });

  it("refuses a user that is not in this shop", () => {
    const { service } = makeService({ setOk: false });
    expect(() => service.setMine(99, { language: "en" })).toThrow(NotFoundError);
  });
});
