/**
 * LIRA-331: the ONE resolver of a user's display language (rule 14), used by
 * UserPreferencesService, signup and tests. A pure leaf (rule 29).
 *
 *   effective = users.language ?? system_settings.ui_default_language ?? 'en'
 *
 * A stored value that is not a known language (a hand-edited row) is ignored,
 * never trusted.
 */
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  type Language,
} from "../constants/languages.js";

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" && (LANGUAGES as readonly string[]).includes(value)
  );
}

export function resolveEffectiveLanguage(
  userLanguage: string | null | undefined,
  shopDefault: string | null | undefined,
): Language {
  if (isLanguage(userLanguage)) return userLanguage;
  if (isLanguage(shopDefault)) return shopDefault;
  return DEFAULT_LANGUAGE;
}
