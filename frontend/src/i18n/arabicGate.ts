/**
 * LIRA-331 OD-4: Arabic ships dark until P2 (server messages + receipts) is
 * done and the owner has reviewed the wording. Until `ARABIC_UI_READY` is
 * flipped (T095, with its release note), the app DISPLAYS English whatever
 * is stored — a user's choice, the shop default, a signup from the Arabic
 * landing, or an Arabic browser — and العربية is not offered anywhere.
 *
 * The owner can preview Arabic on one device with
 * `localStorage.liratek_arabic_preview = "1"`.
 *
 * This is the ONE gate (rule 14): LanguageContext and every language picker
 * ask it.
 */
import type { Language } from "@liratek/core";

export const ARABIC_UI_READY = false;

export const ARABIC_PREVIEW_KEY = "liratek_arabic_preview";

function readPreviewFlag(): boolean {
  try {
    return localStorage.getItem(ARABIC_PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether Arabic may be shown or offered on this device right now. */
export function isArabicAvailable(): boolean {
  return ARABIC_UI_READY || readPreviewFlag();
}

/** The language actually displayed for a requested one. */
export function displayLanguage(requested: Language): Language {
  return requested === "ar" && !isArabicAvailable() ? "en" : requested;
}
