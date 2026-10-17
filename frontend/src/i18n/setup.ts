/**
 * LIRA-331: the app's one i18next instance (research R1, plan D4).
 *
 * - English is bundled and loaded synchronously, so the first render (and
 *   every jest test, see jest.setup.ts) shows English with no flash.
 * - Arabic namespaces load on demand (`loadLanguage("ar")`), so English users
 *   download nothing extra.
 * - `fallbackLng: "en"` + no empty/null returns: a missing Arabic key shows
 *   the English text, never a blank or a raw key (FR-011).
 * - `escapeValue: false`: React already escapes, and a client named
 *   "Jo's & Co" must not render as HTML entities.
 *
 * Numbers and dates are never formatted here: callers pass values already
 * formatted by `@liratek/ui/i18n/format` (contracts/i18n-catalog.md).
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@liratek/core";
import { NAMESPACES } from "@liratek/ui/i18n/namespaces";
import { AR_LOADERS, EN_RESOURCES } from "@liratek/ui/i18n/resources";

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "ar"],
  ns: [...NAMESPACES],
  defaultNS: "common",
  resources: { en: EN_RESOURCES },
  partialBundledLanguages: true,
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
  react: { useSuspense: false },
});

const loaded = new Set<Language>(["en"]);

/**
 * Makes every namespace of `lang` available. English is already bundled;
 * Arabic is fetched once, namespace by namespace, and kept.
 */
export async function loadLanguage(lang: Language): Promise<void> {
  if (loaded.has(lang)) return;
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      const bundle = await AR_LOADERS[ns]();
      i18n.addResourceBundle(lang, ns, bundle, true, true);
    }),
  );
  loaded.add(lang);
}

/** Loads `lang` if needed, then switches the UI to it (no remount, FR-002). */
export async function switchLanguage(lang: Language): Promise<void> {
  await loadLanguage(lang);
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}
