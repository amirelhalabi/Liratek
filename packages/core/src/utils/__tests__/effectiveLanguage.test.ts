/**
 * LIRA-331 T005: the ONE resolver of a user's display language (rule 14).
 * effective = user's own choice ?? shop default ?? 'en'.
 */
import {
  resolveEffectiveLanguage,
  isLanguage,
} from "../effectiveLanguage.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "../../constants/languages.js";

describe("resolveEffectiveLanguage", () => {
  it("falls back to English when neither the user nor the shop chose", () => {
    expect(resolveEffectiveLanguage(null, undefined)).toBe("en");
    expect(DEFAULT_LANGUAGE).toBe("en");
  });

  it("the user's own choice beats the shop default", () => {
    expect(resolveEffectiveLanguage("en", "ar")).toBe("en");
    expect(resolveEffectiveLanguage("ar", "en")).toBe("ar");
  });

  it("the shop default applies when the user never chose", () => {
    expect(resolveEffectiveLanguage(null, "ar")).toBe("ar");
    expect(resolveEffectiveLanguage(undefined, "ar")).toBe("ar");
  });

  it("ignores a stored value that is not a known language", () => {
    expect(resolveEffectiveLanguage("fr", "ar")).toBe("ar");
    expect(resolveEffectiveLanguage("fr", "xx")).toBe("en");
  });
});

describe("isLanguage", () => {
  it("accepts exactly the supported languages", () => {
    expect(LANGUAGES).toEqual(["en", "ar"]);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("ar")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});
