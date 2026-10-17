import { useTranslation } from "react-i18next";
import type { CatalogCurrency } from "@liratek/core";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";

/**
 * LIRA-324 — the USD | LBP switch on Whish App → Bills (same order as every
 * other currency toggle in the app), like the currency
 * selector on the Whish app's home page. Controlled: the page owns the value
 * (and remembers it per device).
 */
export function WhishCurrencySwitch({
  value,
  onChange,
}: {
  value: CatalogCurrency;
  onChange: (next: CatalogCurrency) => void;
}) {
  const { t } = useTranslation("rechargeFinancial");
  const options: CatalogCurrency[] = ["USD", "LBP"];
  return (
    <div
      role="radiogroup"
      aria-label={t("common.currency")}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-700/50 bg-slate-800 p-1"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) onChange(option);
            }}
            className={`min-w-[3.5rem] rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
              active
                ? `${PROVIDER_BRANDS.WHISH.solid} shadow`
                : "text-slate-400 hover:text-white"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
