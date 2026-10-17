/**
 * LIRA-331: the formatters with the displayed language bound in
 * (contracts/i18n-catalog.md). Converted components use this instead of
 * `toLocale*` / `Intl` (guard G3). Numbers and money are en-US in both
 * languages (FR-016); dates follow the language (OD-5) and never shift the
 * calendar day (FR-020).
 */
import { useMemo } from "react";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  type DateInput,
} from "@liratek/ui/i18n/format";
import { useLanguage } from "@/contexts/LanguageContext";

export function useFormat() {
  const { language } = useLanguage();
  return useMemo(
    () => ({
      language,
      formatNumber,
      formatMoney,
      formatDate: (v: DateInput, o?: Intl.DateTimeFormatOptions) =>
        formatDate(v, language, o),
      formatTime: (v: DateInput, o?: Intl.DateTimeFormatOptions) =>
        formatTime(v, language, o),
      formatDateTime: (v: DateInput, o?: Intl.DateTimeFormatOptions) =>
        formatDateTime(v, language, o),
    }),
    [language],
  );
}
