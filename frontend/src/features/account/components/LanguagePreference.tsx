/**
 * LIRA-331 (US2): My account → Language, for every role. The choice belongs
 * to the signed-in user (saved through setMyLanguage on desktop and web) and
 * applies at once, without a reload (FR-002).
 *
 * The section is shown only when the OD-4 gate allows Arabic on this device
 * (`arabicAvailable`); until then it renders nothing.
 * Texts come from the `common` namespace, so the rest of the account module
 * is not yet guarded (its own conversion is a module task).
 */
import { useTranslation } from "react-i18next";
import type { Language } from "@liratek/core";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LanguagePreference() {
  const { t } = useTranslation("common");
  const { language, setLanguage, arabicAvailable } = useLanguage();
  // OD-4: nothing to choose until Arabic is released (or previewed here), so
  // shops see no change before then.
  if (!arabicAvailable) return null;
  const options: Language[] = ["en", "ar"];

  return (
    <section
      aria-labelledby="language-pref-heading"
      className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6 space-y-3"
    >
      <div>
        <h2 id="language-pref-heading" className="text-sm font-semibold text-white">
          {t("language.title")}
        </h2>
        <p className="text-xs text-slate-500 mt-1">{t("language.hint")}</p>
      </div>
      <div role="radiogroup" aria-labelledby="language-pref-heading" className="flex gap-3">
        {options.map((code) => (
          <label
            key={code}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 cursor-pointer"
          >
            <input
              type="radio"
              name="ui-language"
              value={code}
              checked={language === code}
              onChange={() => void setLanguage(code)}
              data-testid={`language-option-${code}`}
            />
            <span lang={code}>{t(`language.${code}`)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
