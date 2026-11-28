/**
 * The Only Days panel of an MTC / Alfa card: the "Only Days" tick, the
 * returned credit, and (when the card has a days price) the editable days
 * price, credit price, kept credit and total. Shared by the Katsh / iPick and
 * Whish App grids (LIRA-406) — moved verbatim from KatshForm's ItemCard so
 * both show the exact same controls (one look per control).
 */
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { DecimalInput } from "@liratek/ui";
import { PriceChangeWarning } from "@/shared/components/PriceChangeWarning";
import type { ProviderBrand } from "@/shared/brand/providerBrands";
import type { ServiceItem } from "../hooks/useMobileServiceItems";
import type { OnlyDaysPricingResult } from "../utils/onlyDaysPricing";

export interface OnlyDaysPanelProps {
  item: ServiceItem;
  /** The grid's brand: input focus takes its colour. */
  brand: ProviderBrand;
  onlyDays: boolean;
  returnedCreditsUsd: number;
  /** Undefined when the item is not in the cart — the pricing rows only
   *  render when `onlyDays` is true, which implies a cart line. */
  onlyDaysPricing?: OnlyDaysPricingResult | undefined;
  onOnlyDaysChange: (item: ServiceItem, checked: boolean) => void;
  onReturnedCreditsChange: (item: ServiceItem, value: number) => void;
  onSellDaysLbpChange: (item: ServiceItem, value: number) => void;
  onCreditPriceLbpChange: (item: ServiceItem, value: number) => void;
}

export function OnlyDaysPanel({
  item,
  brand,
  onlyDays,
  returnedCreditsUsd,
  onlyDaysPricing,
  onOnlyDaysChange,
  onReturnedCreditsChange,
  onSellDaysLbpChange,
  onCreditPriceLbpChange,
}: OnlyDaysPanelProps) {
  const { t } = useTranslation("recharge");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="checkbox"
            id={`onlydays-${item.key}`}
            checked={onlyDays}
            onChange={(e) => onOnlyDaysChange(item, e.target.checked)}
            className={`w-4 h-4 rounded border-slate-600 ${brand.text} ${brand.focusRing} cursor-pointer`}
          />
          <label
            htmlFor={`onlydays-${item.key}`}
            className="text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap"
          >
            {t("katsh.onlyDays")}
          </label>
        </div>
        {onlyDays && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {t("katsh.credits")}
            </span>
            <DecimalInput
              data-testid="katsh-onlydays-credits"
              aria-label={t("katsh.credits")}
              value={returnedCreditsUsd}
              onChange={(n) => onReturnedCreditsChange(item, n)}
              decimals={2}
              zeroAsEmpty={false}
              className={`w-14 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none ${brand.focusBorder}`}
            />
          </div>
        )}
      </div>
      {/* Owner pricing model (2026-08-05): total = sell_days_lbp +
          kept_credits * credit_price — both editable, prefilled from
          the catalog. Renders ONLY when the item has a computed days
          price; items without one (FALLBACK) keep the plain
          Credits input above with no extra panel. */}
      {onlyDays && onlyDaysPricing?.hasSellDaysPrice && (
        <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-700/60">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {t("katsh.daysPrice")}
            </span>
            <DecimalInput
              value={onlyDaysPricing.sellDaysLbp ?? 0}
              onChange={(n) => onSellDaysLbpChange(item, n)}
              decimals={0}
              zeroAsEmpty={false}
              aria-label={t("katsh.onlyDaysPrice")}
              className={`w-20 min-w-0 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-white text-end font-mono focus:outline-none ${brand.focusBorder}`}
            />
          </div>
          <PriceChangeWarning
            catalogPrice={onlyDaysPricing.catalogSellDaysLbp}
            currentPrice={onlyDaysPricing.sellDaysLbp}
            currency="LBP"
            className="text-[10px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {t("katsh.creditPrice")}
            </span>
            <DecimalInput
              value={onlyDaysPricing.creditPriceLbp}
              onChange={(n) => onCreditPriceLbpChange(item, n)}
              decimals={0}
              zeroAsEmpty={false}
              aria-label={t("katsh.onlyDaysCreditPrice")}
              className={`w-20 min-w-0 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-white text-end font-mono focus:outline-none ${brand.focusBorder}`}
            />
          </div>
          <PriceChangeWarning
            catalogPrice={onlyDaysPricing.catalogCreditPriceLbp}
            currentPrice={onlyDaysPricing.creditPriceLbp}
            currency="LBP"
            className="text-[10px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {t("katsh.keptCredits")}
            </span>
            <span className="text-[11px] text-slate-300 font-mono">
              ${onlyDaysPricing.keptCredits.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 font-semibold">
              {t("katsh.total")}
            </span>
            <span className="text-xs text-emerald-400 font-mono font-semibold">
              {formatNumber(onlyDaysPricing.total ?? 0)} LBP
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
