/**
 * LIRA-331: which language the app shows (plan D2/D3, data-model §5).
 *
 * - Before sign-in: the device's last language (`localStorage.liratek_language`);
 *   on a device never used before, `navigator.language` if it starts with
 *   "ar", else English (FR-004).
 * - After sign-in: the user's effective language from the server (their own
 *   choice, else the shop default). It is written back to the device, so the
 *   next sign-in screen opens in it. If the server cannot be reached
 *   (offline desktop), the cached language is kept.
 * - A switch changes i18next's language and `<html dir lang>` in place — no
 *   remount, so a half-typed form keeps its input (FR-002).
 * - Every displayed language goes through the OD-4 gate (`displayLanguage`):
 *   while Arabic is not ready, English is shown whatever is stored.
 *
 * `api` is read through a ref (rule 25). Theme stays per device
 * (ThemeContext); only the language follows the user.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isLanguage, type Language } from "@liratek/core";
import { useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { switchLanguage } from "@/i18n/setup";
import { displayLanguage, isArabicAvailable } from "@/i18n/arabicGate";
import logger from "@/utils/logger";

export const DEVICE_LANGUAGE_KEY = "liratek_language";

interface LanguageContextValue {
  /** The language on screen (after the OD-4 gate). */
  language: Language;
  /** "rtl" for Arabic, else "ltr". */
  dir: "rtl" | "ltr";
  /** Whether العربية may be offered on this device (OD-4). */
  arabicAvailable: boolean;
  /** Switch now; saved for the signed-in user, and for this device. */
  setLanguage: (lang: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  dir: "ltr",
  arabicAvailable: false,
  setLanguage: async () => {},
});

function readDeviceLanguage(): Language {
  try {
    const stored = localStorage.getItem(DEVICE_LANGUAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // storage blocked: fall through to the browser language
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function writeDeviceLanguage(lang: Language): void {
  try {
    localStorage.setItem(DEVICE_LANGUAGE_KEY, lang);
  } catch {
    // storage blocked: the language still applies for this session
  }
}

/** The one place the document direction is set. */
function applyToDocument(lang: Language): void {
  const root = document.documentElement;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const apiRef = useRef(api);
  // Rule 25: `api` is read through the ref, never put in a dependency list.
  // Kept current in an effect (refs are not written during render).
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const { isAuthenticated } = useAuth();

  // What the person/device asked for (before the gate).
  const [requested, setRequested] = useState<Language>(readDeviceLanguage);
  const shown = displayLanguage(requested);

  useEffect(() => {
    applyToDocument(shown);
    void switchLanguage(shown).catch((error: unknown) => {
      logger.error("Failed to load language", error);
    });
  }, [shown]);

  // After sign-in, the user's own language (or the shop default) wins.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    // Inside a promise chain so even a synchronous failure keeps the cache.
    Promise.resolve()
      .then(() => apiRef.current.getMyPreferences())
      .then((prefs) => {
        if (cancelled) return;
        writeDeviceLanguage(prefs.effectiveLanguage);
        setRequested(prefs.effectiveLanguage);
      })
      .catch((error: unknown) => {
        // Offline desktop / super admin: keep the cached language.
        logger.warn("Could not load language preference", { error });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const setLanguage = useCallback(
    async (lang: Language) => {
      writeDeviceLanguage(lang);
      setRequested(lang);
      if (!isAuthenticated) return;
      const result = await apiRef.current.setMyLanguage({ language: lang });
      if (!result.success) {
        logger.warn("Could not save language preference", {
          error: result.error,
        });
      }
    },
    [isAuthenticated],
  );

  return (
    <LanguageContext.Provider
      value={{
        language: shown,
        dir: shown === "ar" ? "rtl" : "ltr",
        arabicAvailable: isArabicAvailable(),
        setLanguage,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
