import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";

interface UsdLbpTotalChipsProps {
  usd: number;
  lbp: number;
  /** Word before the currency, e.g. "Total" or "Net". */
  label?: string;
}

function signed(text: string, n: number): string {
  return n < 0 ? `-${text}` : text;
}

/** Two chips for a History window header: "<label> USD" and "<label> LBP". */
export function UsdLbpTotalChips({
  usd,
  lbp,
  label: labelProp,
}: UsdLbpTotalChipsProps) {
  const { t } = useTranslation("shared");
  const label = labelProp ?? t("totals.total");
  // Compact and never wrapping: History headers already hold filters.
  const chip =
    "px-2.5 py-1 rounded-lg font-medium text-xs flex items-center gap-1.5 whitespace-nowrap bg-slate-800 text-slate-400 border border-slate-700";
  return (
    <div className="flex shrink-0 gap-1.5">
      <div className={chip} data-testid="history-total-usd">
        <span className="font-medium whitespace-nowrap">{label} USD</span>
        <span className="font-bold text-white">
          {signed(`$${Math.abs(usd).toFixed(2)}`, usd)}
        </span>
      </div>
      <div className={chip} data-testid="history-total-lbp">
        <span className="font-medium whitespace-nowrap">{label} LBP</span>
        <span className="font-bold text-white">
          {signed(formatNumber(Math.abs(lbp)), lbp)}
        </span>
      </div>
    </div>
  );
}
