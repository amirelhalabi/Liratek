/**
 * LIRA-331 (FR-004): a compact English / العربية switch for screens shown
 * before sign-in (Login, Signup, the desktop setup wizard). Before sign-in the
 * choice is kept for this device only; after sign-in LanguageContext saves it
 * to the user's account.
 *
 * Renders nothing while Arabic is gated off (OD-4), so shops see no change
 * until the release flag is flipped.
 */
import { useTranslation } from "react-i18next";
import type { Language } from "@liratek/core";
import { useLanguage } from "@/contexts/LanguageContext";

const OPTIONS: readonly Language[] = ["en", "ar"];

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { t } = useTranslation("common");
  const { language, setLanguage, arabicAvailable } = useLanguage();
  if (!arabicAvailable) return null;

  return (
    <div
      role="radiogroup"
      aria-label={t("language.title")}
      className={`inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5 text-xs ${className}`}
      data-testid="language-switch"
    >
      {OPTIONS.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={language === code}
          lang={code}
          onClick={() => void setLanguage(code)}
          data-testid={`language-switch-${code}`}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            language === code
              ? "bg-violet-600 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {t(`language.${code}`)}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitch;
