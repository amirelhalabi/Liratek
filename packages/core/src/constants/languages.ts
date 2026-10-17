/**
 * LIRA-331: the languages the app UI can be shown in. A pure leaf (rule 29):
 * reachable from browser.ts, so no imports at all.
 *
 * Language changes what is SHOWN, never what is saved (FR-018).
 */
export const LANGUAGES = ["en", "ar"] as const;

export type Language = (typeof LANGUAGES)[number];

/** What a shop that changes nothing sees (FR-005). */
export const DEFAULT_LANGUAGE: Language = "en";

/** `system_settings` key: the shop's default UI language (admin). */
export const UI_DEFAULT_LANGUAGE_SETTING_KEY = "ui_default_language";

/** `system_settings` key: the language receipts print in (admin, P2). */
export const RECEIPT_LANGUAGE_SETTING_KEY = "receipt_language";
