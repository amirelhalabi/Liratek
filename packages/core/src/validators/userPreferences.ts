/**
 * LIRA-331: a user's own UI language (contracts/user-preferences-api.md).
 * Shared by the IPC handler, the REST route and the adapter types (rule 21).
 */
import { z } from "zod";
import { LANGUAGES, type Language } from "../constants/languages.js";

export const languageSchema = z.enum(LANGUAGES);

export const setMyLanguageSchema = z
  .object({ language: languageSchema })
  .strict();

export type SetMyLanguageInput = z.input<typeof setMyLanguageSchema>;

/** What `user-preferences:get` / `GET /api/user-preferences/me` return. */
export interface MyPreferences {
  /** The user's own choice; null = never chose (follows the shop default). */
  language: Language | null;
  /** resolveEffectiveLanguage(language, shopDefaultLanguage). */
  effectiveLanguage: Language;
  /** system_settings.ui_default_language, missing = 'en'. */
  shopDefaultLanguage: Language;
  /** system_settings.receipt_language, missing = 'en'. */
  receiptLanguage: Language;
}
